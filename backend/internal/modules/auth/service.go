package auth

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/google"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
)

const providerGoogle = "google"

var (
	ErrEmailNotVerified = httpx.NewError(http.StatusForbidden, "EMAIL_NOT_VERIFIED", "google account email is not verified")
	ErrAccountDisabled  = httpx.NewError(http.StatusForbidden, "ACCOUNT_DISABLED", "account is disabled")
	ErrInvalidState     = httpx.BadRequest("OAUTH_STATE_INVALID", "login session expired, please try again")
)

type Service struct {
	pool     *pgxpool.Pool
	google   google.Authenticator
	sessions *Sessions
	enqueue  jobs.Enqueuer
}

func NewService(pool *pgxpool.Pool, g google.Authenticator, s *Sessions, enqueue jobs.Enqueuer) *Service {
	return &Service{pool: pool, google: g, sessions: s, enqueue: enqueue}
}

// SafeReturnPath only allows same-site relative paths so the login flow cannot be used as an
// open redirect.
func SafeReturnPath(p string) string {
	if p == "" || !strings.HasPrefix(p, "/") || strings.HasPrefix(p, "//") || strings.ContainsAny(p, "\\\r\n") || len(p) > 512 {
		return "/"
	}
	return p
}

func (s *Service) BeginLogin(ctx context.Context, returnTo string) (string, error) {
	state := secure.RandomToken(24)
	verifier := secure.RandomToken(48)
	nonce := secure.RandomToken(24)
	q := dbq.New(s.pool)
	if err := q.InsertOAuthState(ctx, dbq.InsertOAuthStateParams{
		State: state, CodeVerifier: verifier, Nonce: nonce, ReturnTo: SafeReturnPath(returnTo),
		ExpiresAt: time.Now().Add(10 * time.Minute),
	}); err != nil {
		return "", err
	}
	return s.google.AuthURL(state, verifier, nonce)
}

type LoginResult struct {
	ReturnTo string
	User     dbq.User
	Created  bool
}

func (s *Service) CompleteLogin(ctx context.Context, w http.ResponseWriter, r *http.Request, state, code string) (LoginResult, error) {
	if state == "" || code == "" {
		return LoginResult{}, ErrInvalidState
	}
	st, err := dbq.New(s.pool).ConsumeOAuthState(ctx, state)
	if err != nil {
		if db.IsNoRows(err) {
			return LoginResult{}, ErrInvalidState
		}
		return LoginResult{}, err
	}
	ident, err := s.google.Exchange(ctx, code, st.CodeVerifier, st.Nonce)
	if err != nil {
		return LoginResult{}, httpx.BadRequest("OAUTH_EXCHANGE_FAILED", "could not complete Google login").Wrap(err)
	}
	return s.loginIdentity(ctx, w, r, ident, st.ReturnTo)
}

func (s *Service) loginIdentity(ctx context.Context, w http.ResponseWriter, r *http.Request, ident google.Identity, returnTo string) (LoginResult, error) {
	if !ident.EmailVerified {
		return LoginResult{}, ErrEmailNotVerified
	}
	if ident.Subject == "" || ident.Email == "" {
		return LoginResult{}, httpx.BadRequest("OAUTH_EXCHANGE_FAILED", "identity incomplete")
	}
	res := LoginResult{ReturnTo: returnTo}
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		user, err := q.GetUserByProvider(ctx, dbq.GetUserByProviderParams{Provider: providerGoogle, ProviderSubject: ident.Subject})
		found := err == nil
		if err != nil && !db.IsNoRows(err) {
			return err
		}
		if found && user.Status != "ACTIVE" {
			return ErrAccountDisabled
		}
		role := RoleCustomer
		if found {
			role = user.Role
		}
		if found {
			user, err = q.UpdateUserLogin(ctx, dbq.UpdateUserLoginParams{ID: user.ID, Email: ident.Email, AvatarUrl: ident.Picture, Role: role, FullName: ident.Name})
		} else {
			user, err = q.InsertUser(ctx, dbq.InsertUserParams{
				Provider: providerGoogle, ProviderSubject: ident.Subject, Email: ident.Email,
				FullName: ident.Name, AvatarUrl: ident.Picture, Role: role, PreferredLocale: "en",
			})
			res.Created = true
		}
		if err != nil {
			return fmt.Errorf("upsert user: %w", err)
		}
		if res.Created && s.enqueue != nil {
			if err := s.enqueue.EnqueueTx(ctx, tx, jobs.SendWelcome{UserID: user.ID}); err != nil {
				return err
			}
		}
		res.User = user
		return s.sessions.Create(ctx, q, w, r, user.ID)
	})
	return res, err
}

func (s *Service) Logout(ctx context.Context, w http.ResponseWriter, p *Principal) error {
	s.sessions.Clear(w)
	if p == nil {
		return nil
	}
	return dbq.New(s.pool).RevokeSession(ctx, p.SessionID)
}

func UserIDPtr(p *Principal) *uuid.UUID {
	if p == nil {
		return nil
	}
	id := p.UserID
	return &id
}
