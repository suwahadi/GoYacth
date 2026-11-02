package auth

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"

	"goyacht/internal/modules/audit"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/validate"
)

const (
	providerPassword = "password"
	bcryptCost       = 12
	minPasswordChars = 12
	maxPasswordBytes = 72 // bcrypt ignores anything past this length.
)

var (
	ErrInvalidCredentials = httpx.NewError(http.StatusUnauthorized, "INVALID_CREDENTIALS", "email or password is incorrect")
	ErrAdminExists        = httpx.Conflict("ADMIN_EXISTS", "an admin with this email already exists")
)

// absentAccountHash is compared when no usable account exists, so response time does not reveal
// which emails belong to admins.
var absentAccountHash = sync.OnceValue(func() []byte {
	h, err := bcrypt.GenerateFromPassword([]byte("no account uses this value"), bcryptCost)
	if err != nil {
		panic(err)
	}
	return h
})

func normalizeEmail(email string) string { return strings.ToLower(strings.TrimSpace(email)) }

func passwordFieldError(password string) string {
	switch {
	case utf8.RuneCountInString(password) < minPasswordChars:
		return "PASSWORD_TOO_SHORT"
	case len(password) > maxPasswordBytes:
		return "PASSWORD_TOO_LONG"
	}
	return ""
}

func hashPassword(password string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	return string(h), err
}

// CreateAdmin adds an admin account. actor is nil for the CLI bootstrap.
func CreateAdmin(ctx context.Context, pool *pgxpool.Pool, email, fullName, password string, actor *uuid.UUID) error {
	email = normalizeEmail(email)
	fields := httpx.FieldErrors{}
	if !validate.Email(email) {
		fields.Add("email", "INVALID_EMAIL")
	}
	if code := passwordFieldError(password); code != "" {
		fields.Add("password", code)
	}
	if err := fields.Err(); err != nil {
		return err
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.InsertAdminAccount(ctx, dbq.InsertAdminAccountParams{Email: email, FullName: strings.TrimSpace(fullName), PasswordHash: hash})
		if db.IsUniqueViolation(err) {
			return ErrAdminExists
		}
		if err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "admin.created", EntityType: "user", EntityID: u.ID.String(), After: map[string]string{"email": email}})
	})
}

// ResetAdminPassword is the recovery path for a forgotten password, reachable only from the CLI.
func ResetAdminPassword(ctx context.Context, pool *pgxpool.Pool, email, password string) error {
	if code := passwordFieldError(password); code != "" {
		return httpx.Validation(map[string]string{"password": code})
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	return db.InTx(ctx, pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetUserByProvider(ctx, dbq.GetUserByProviderParams{Provider: providerPassword, ProviderSubject: normalizeEmail(email)})
		if err != nil {
			return err
		}
		if err := q.SetUserPassword(ctx, dbq.SetUserPasswordParams{ID: u.ID, PasswordHash: hash}); err != nil {
			return err
		}
		if err := q.RevokeUserSessions(ctx, u.ID); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{Action: "admin.password_reset", EntityType: "user", EntityID: u.ID.String()})
	})
}

// AdminLogin answers every failure the same way and always spends one bcrypt comparison, so
// neither the response nor its timing separates a wrong password from an unknown, disabled or
// locked account.
func (s *Service) AdminLogin(ctx context.Context, w http.ResponseWriter, r *http.Request, email, password string) error {
	q := dbq.New(s.pool)
	u, err := q.GetUserByProvider(ctx, dbq.GetUserByProviderParams{Provider: providerPassword, ProviderSubject: normalizeEmail(email)})
	if err != nil && !db.IsNoRows(err) {
		return err
	}
	found := err == nil
	hash := absentAccountHash()
	if found {
		hash = []byte(u.PasswordHash)
	}
	matches := len(password) <= maxPasswordBytes && bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	usable := found && u.Role == RoleAdmin && u.Status == "ACTIVE" && (u.LockedUntil == nil || !u.LockedUntil.After(time.Now()))
	if !usable {
		return ErrInvalidCredentials
	}
	if !matches {
		if err := q.RecordFailedLogin(ctx, u.ID); err != nil {
			return err
		}
		if err := audit.Record(ctx, q, audit.Entry{ActorID: &u.ID, Action: "admin.login_failed", EntityType: "user", EntityID: u.ID.String()}); err != nil {
			return err
		}
		return ErrInvalidCredentials
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.ResetFailedLogins(ctx, u.ID); err != nil {
			return err
		}
		if current := FromContext(ctx); current != nil {
			if err := q.RevokeSession(ctx, current.SessionID); err != nil {
				return err
			}
		}
		if err := s.sessions.Create(ctx, q, w, r, u.ID); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: &u.ID, Action: "admin.login", EntityType: "user", EntityID: u.ID.String()})
	})
}

// ChangePassword ends every other session, so a leaked session cannot outlive the new password.
func (s *Service) ChangePassword(ctx context.Context, w http.ResponseWriter, r *http.Request, p *Principal, current, next string) error {
	q := dbq.New(s.pool)
	u, err := q.GetUserByID(ctx, p.UserID)
	if err != nil {
		return err
	}
	if bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(current)) != nil {
		return ErrInvalidCredentials
	}
	if code := passwordFieldError(next); code != "" {
		return httpx.Validation(map[string]string{"new_password": code})
	}
	hash, err := hashPassword(next)
	if err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		if err := q.SetUserPassword(ctx, dbq.SetUserPasswordParams{ID: u.ID, PasswordHash: hash}); err != nil {
			return err
		}
		if err := q.RevokeUserSessions(ctx, u.ID); err != nil {
			return err
		}
		if err := s.sessions.Create(ctx, q, w, r, u.ID); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: &u.ID, Action: "admin.password_changed", EntityType: "user", EntityID: u.ID.String()})
	})
}
