package auth

import (
	"context"
	"log/slog"
	"net/http"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/secure"
)

const (
	RoleAdmin    = "ADMIN"
	RoleCustomer = "CUSTOMER"

	CSRFCookieName = "gy_csrf"
	CSRFHeader     = "X-CSRF-Token"
)

type Principal struct {
	SessionID uuid.UUID
	UserID    uuid.UUID
	Email     string
	FullName  string
	Role      string
	Locale    string
	CSRFToken string
	// EmailVerified is false only for a password account that never confirmed its address.
	EmailVerified bool
}

func (p *Principal) IsAdmin() bool { return p != nil && p.Role == RoleAdmin }

type ctxKey struct{}

func FromContext(ctx context.Context) *Principal {
	p, _ := ctx.Value(ctxKey{}).(*Principal)
	return p
}

func WithPrincipal(ctx context.Context, p *Principal) context.Context {
	return context.WithValue(ctx, ctxKey{}, p)
}

type Sessions struct {
	pool       *pgxpool.Pool
	cookieName string
	ttl        time.Duration
	secure     bool
}

func NewSessions(pool *pgxpool.Pool, cookieName string, ttl time.Duration, secureCookie bool) *Sessions {
	return &Sessions{pool: pool, cookieName: cookieName, ttl: ttl, secure: secureCookie}
}

func (s *Sessions) Create(ctx context.Context, q *dbq.Queries, w http.ResponseWriter, r *http.Request, userID uuid.UUID) error {
	token := secure.RandomToken(32)
	csrf := secure.RandomToken(24)
	ua := r.UserAgent()
	if len(ua) > 300 {
		ua = ua[:300]
	}
	expires := time.Now().Add(s.ttl)
	if _, err := q.InsertSession(ctx, dbq.InsertSessionParams{
		TokenHash: secure.HashToken(token), UserID: userID, CsrfToken: csrf,
		UserAgent: ua, IpAddress: httpx.ClientIP(ctx), ExpiresAt: expires,
	}); err != nil {
		return err
	}
	s.setCookies(w, token, csrf, expires)
	return nil
}

func (s *Sessions) setCookies(w http.ResponseWriter, token, csrf string, expires time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: s.cookieName, Value: token, Path: "/", Expires: expires,
		HttpOnly: true, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
	// The CSRF cookie is readable by the frontend so it can echo the value in X-CSRF-Token.
	http.SetCookie(w, &http.Cookie{
		Name: CSRFCookieName, Value: csrf, Path: "/", Expires: expires,
		HttpOnly: false, Secure: s.secure, SameSite: http.SameSiteLaxMode,
	})
}

func (s *Sessions) Clear(w http.ResponseWriter) {
	for _, name := range []string{s.cookieName, CSRFCookieName} {
		http.SetCookie(w, &http.Cookie{
			Name: name, Value: "", Path: "/", MaxAge: -1,
			HttpOnly: name == s.cookieName, Secure: s.secure, SameSite: http.SameSiteLaxMode,
		})
	}
}

// Middleware resolves the session cookie into a Principal. It never rejects a request; the
// Require* middlewares decide whether authentication is mandatory.
func (s *Sessions) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		c, err := r.Cookie(s.cookieName)
		if err != nil || c.Value == "" || len(c.Value) > 128 {
			next.ServeHTTP(w, r)
			return
		}
		q := dbq.New(s.pool)
		row, err := q.GetSessionWithUser(r.Context(), secure.HashToken(c.Value))
		if err != nil {
			if !db.IsNoRows(err) {
				slog.ErrorContext(r.Context(), "load session", "error", err)
			}
			next.ServeHTTP(w, r)
			return
		}
		if row.User.Status != "ACTIVE" {
			next.ServeHTTP(w, r)
			return
		}
		if time.Since(row.Session.LastSeenAt) > time.Hour {
			expires := time.Now().Add(s.ttl)
			if err := q.TouchSession(r.Context(), dbq.TouchSessionParams{ID: row.Session.ID, ExpiresAt: expires}); err == nil {
				s.setCookies(w, c.Value, row.Session.CsrfToken, expires)
			}
		}
		p := &Principal{
			SessionID: row.Session.ID, UserID: row.User.ID, Email: row.User.Email, FullName: row.User.FullName,
			Role: row.User.Role, Locale: row.User.PreferredLocale, CSRFToken: row.Session.CsrfToken,
			EmailVerified: row.User.EmailVerifiedAt != nil,
		}
		next.ServeHTTP(w, r.WithContext(WithPrincipal(r.Context(), p)))
	})
}

// CSRF enforces the double-submit token on every state-changing request made with a session.
func CSRF(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.Method {
		case http.MethodGet, http.MethodHead, http.MethodOptions:
			next.ServeHTTP(w, r)
			return
		}
		p := FromContext(r.Context())
		if p != nil && !secure.ConstantTimeEqual(r.Header.Get(CSRFHeader), p.CSRFToken) {
			httpx.WriteError(w, r, httpx.ErrCSRF)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if FromContext(r.Context()) == nil {
			httpx.WriteError(w, r, httpx.ErrUnauthenticated)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func RequireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := FromContext(r.Context())
		if p == nil {
			httpx.WriteError(w, r, httpx.ErrUnauthenticated)
			return
		}
		if !p.IsAdmin() {
			httpx.WriteError(w, r, httpx.ErrForbidden)
			return
		}
		next.ServeHTTP(w, r)
	})
}
