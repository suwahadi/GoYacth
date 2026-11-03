package auth

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/crypto/bcrypt"

	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
	"goyacht/internal/platform/validate"
)

const (
	customerMinPasswordChars = 8
	verifyTokenTTL           = 48 * time.Hour
	resetTokenTTL            = time.Hour

	PurposeVerify = "VERIFY"
	PurposeReset  = "RESET"

	TemplateVerify        = "verify_email"
	TemplateReset         = "password_reset"
	TemplateAccountExists = "account_exists"
)

var (
	ErrEmailUnverified = httpx.NewError(http.StatusForbidden, "EMAIL_NOT_VERIFIED", "confirm your email address first")
	ErrTokenInvalid    = httpx.BadRequest("TOKEN_INVALID", "this link has expired or was already used")
)

type RegisterInput struct {
	Email    string
	FullName string
	Locale   string
	ReturnTo string
}

// Register answers the same way whether or not the address already has an account, so it cannot
// be used to learn who is a customer. It never takes a password: the owner of the inbox chooses
// one on the page the emailed link opens, so nobody can sign up with someone else's address and
// keep a way in. A confirmed address gets a link to set a password instead.
func (s *Service) Register(ctx context.Context, in RegisterInput) error {
	email := normalizeEmail(in.Email)
	name := strings.TrimSpace(in.FullName)
	f := httpx.FieldErrors{}
	if !validate.Email(email) {
		f.Add("email", "INVALID_EMAIL")
	}
	if !validate.Length(name, 1, 120) {
		f.Add("full_name", "INVALID_LENGTH")
	}
	if err := f.Err(); err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetCustomerByEmail(ctx, email)
		switch {
		case db.IsNoRows(err):
			u, err = q.InsertEmailCustomer(ctx, dbq.InsertEmailCustomerParams{Email: email, FullName: name, PreferredLocale: i18n.Normalize(in.Locale)})
			if err != nil {
				return err
			}
		case err != nil:
			return err
		case u.Status != "ACTIVE":
			return nil
		case u.EmailVerifiedAt != nil:
			return s.sendToken(ctx, tx, q, u, TemplateAccountExists, "")
		}
		return s.sendToken(ctx, tx, q, u, TemplateVerify, SafeReturnPath(in.ReturnTo))
	})
}

// sendToken stores only the token's hash and mails the raw value. A new link replaces the open one
// of the same kind.
func (s *Service) sendToken(ctx context.Context, tx pgx.Tx, q *dbq.Queries, u dbq.User, template, returnTo string) error {
	purpose, ttl := PurposeVerify, verifyTokenTTL
	if template != TemplateVerify {
		purpose, ttl = PurposeReset, resetTokenTTL
	}
	if err := q.DropOpenEmailTokens(ctx, dbq.DropOpenEmailTokensParams{UserID: u.ID, Purpose: purpose}); err != nil {
		return err
	}
	token := secure.RandomToken(32)
	if err := q.InsertEmailToken(ctx, dbq.InsertEmailTokenParams{UserID: u.ID, Purpose: purpose, TokenHash: secure.HashToken(token), ExpiresAt: time.Now().Add(ttl)}); err != nil {
		return err
	}
	if s.enqueue == nil {
		return nil
	}
	return s.enqueue.EnqueueTx(ctx, tx, jobs.SendAuthEmail{UserID: u.ID, Template: template, Token: token, ReturnTo: returnTo})
}

// CustomerLogin mirrors AdminLogin: one answer for every failure and one bcrypt comparison per try.
// An account only has a password once its address is confirmed.
func (s *Service) CustomerLogin(ctx context.Context, w http.ResponseWriter, r *http.Request, email, password string) error {
	q := dbq.New(s.pool)
	u, err := q.GetCustomerByEmail(ctx, normalizeEmail(email))
	if err != nil && !db.IsNoRows(err) {
		return err
	}
	found := err == nil && u.PasswordHash != "" && u.EmailVerifiedAt != nil
	hash := absentAccountHash()
	if found {
		hash = []byte(u.PasswordHash)
	}
	matches := len(password) <= maxPasswordBytes && bcrypt.CompareHashAndPassword(hash, []byte(password)) == nil
	if !found || u.Status != "ACTIVE" || (u.LockedUntil != nil && u.LockedUntil.After(time.Now())) {
		return ErrInvalidCredentials
	}
	if !matches {
		if err := q.RecordFailedLogin(ctx, u.ID); err != nil {
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
		return s.sessions.Create(ctx, q, w, r, u.ID)
	})
}

// VerifyEmail confirms the address with the password its owner just chose, and signs them in.
func (s *Service) VerifyEmail(ctx context.Context, w http.ResponseWriter, r *http.Request, token, password string) error {
	if token == "" || len(token) > 128 {
		return ErrTokenInvalid
	}
	if code := passwordError(password, customerMinPasswordChars); code != "" {
		return httpx.Validation(map[string]string{"password": code})
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		t, err := q.ConsumeEmailToken(ctx, dbq.ConsumeEmailTokenParams{TokenHash: secure.HashToken(token), Purpose: PurposeVerify})
		if db.IsNoRows(err) {
			return ErrTokenInvalid
		}
		if err != nil {
			return err
		}
		u, err := q.GetUserByID(ctx, t.UserID)
		if err != nil {
			return err
		}
		if u.Status != "ACTIVE" {
			return ErrAccountDisabled
		}
		if err := q.SetUserPassword(ctx, dbq.SetUserPasswordParams{ID: u.ID, PasswordHash: hash}); err != nil {
			return err
		}
		if err := q.MarkEmailVerified(ctx, u.ID); err != nil {
			return err
		}
		if u.EmailVerifiedAt == nil && s.enqueue != nil {
			if err := s.enqueue.EnqueueTx(ctx, tx, jobs.SendWelcome{UserID: u.ID}); err != nil {
				return err
			}
		}
		return s.sessions.Create(ctx, q, w, r, u.ID)
	})
}

// ForgotPassword is silent about unknown addresses. A customer who only used Google can set a
// password this way too.
func (s *Service) ForgotPassword(ctx context.Context, email string) error {
	email = normalizeEmail(email)
	if !validate.Email(email) {
		return httpx.Validation(map[string]string{"email": "INVALID_EMAIL"})
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		u, err := q.GetCustomerByEmail(ctx, email)
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if u.Status != "ACTIVE" {
			return nil
		}
		return s.sendToken(ctx, tx, q, u, TemplateReset, "")
	})
}

// ResetPassword also confirms the address, since the link reached its inbox, and ends every
// session so a stolen one does not outlive the old password.
func (s *Service) ResetPassword(ctx context.Context, token, password string) error {
	if token == "" || len(token) > 128 {
		return ErrTokenInvalid
	}
	if code := passwordError(password, customerMinPasswordChars); code != "" {
		return httpx.Validation(map[string]string{"password": code})
	}
	hash, err := hashPassword(password)
	if err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		t, err := q.ConsumeEmailToken(ctx, dbq.ConsumeEmailTokenParams{TokenHash: secure.HashToken(token), Purpose: PurposeReset})
		if db.IsNoRows(err) {
			return ErrTokenInvalid
		}
		if err != nil {
			return err
		}
		if err := q.SetUserPassword(ctx, dbq.SetUserPasswordParams{ID: t.UserID, PasswordHash: hash}); err != nil {
			return err
		}
		if err := q.MarkEmailVerified(ctx, t.UserID); err != nil {
			return err
		}
		if err := q.DropOpenEmailTokens(ctx, dbq.DropOpenEmailTokensParams{UserID: t.UserID, Purpose: PurposeVerify}); err != nil {
			return err
		}
		return q.RevokeUserSessions(ctx, t.UserID)
	})
}
