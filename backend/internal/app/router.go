package app

import (
	"context"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"goyacht/internal/integrations/google"
	"goyacht/internal/integrations/turnstile"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/media"
	"goyacht/internal/platform/httpx"
)

// Modules exposes route registration for every feature module. Each module owns its routes; the
// router only decides which authentication and rate-limit group they belong to.
type Modules struct {
	Auth     *auth.Handler
	Sessions *auth.Sessions
	Media    *media.Handler
	Public   []func(chi.Router)
	Customer []func(chi.Router)
	Admin    []func(chi.Router)
	Webhooks []func(chi.Router)
}

func NewModules(d *Deps, s *Services) *Modules {
	cfg := d.Config
	sessions := auth.NewSessions(d.Pool, cfg.SessionCookieName, cfg.SessionTTL, cfg.CookieSecure)
	g := google.New(cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.APIURL.JoinPath("/api/v1/auth/google/callback").String())
	authSvc := auth.NewService(d.Pool, g, sessions, d.Enqueuer())
	m := &Modules{
		Auth:     auth.NewHandler(authSvc, cfg.AppURL, turnstile.New(cfg.TurnstileSecret).Verify),
		Sessions: sessions,
		Media:    media.NewHandler(s.Media, d.Pool, d.Store),
	}
	registerFeatureModules(d, m, s)
	return m
}

func NewRouter(d *Deps, m *Modules) http.Handler {
	cfg := d.Config
	r := chi.NewRouter()
	r.Use(httpx.RequestContext(cfg.TrustProxy))
	r.Use(httpx.Recover)
	r.Use(httpx.AccessLog)
	r.Use(httpx.SecurityHeaders(cfg.IsProduction()))

	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
	r.Get("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
		defer cancel()
		if err := d.Pool.Ping(ctx); err != nil {
			w.WriteHeader(http.StatusServiceUnavailable)
			return
		}
		w.WriteHeader(http.StatusOK)
	})

	authLimit := httpx.NewRateLimiter(30, time.Minute)
	generalLimit := httpx.NewRateLimiter(600, time.Minute)
	webhookLimit := httpx.NewRateLimiter(300, time.Minute)

	r.Route("/api/v1", func(api chi.Router) {
		api.Use(httpx.CORS(cfg.CORSOrigin))
		api.Group(func(wh chi.Router) {
			wh.Use(webhookLimit.Middleware("webhook"))
			for _, reg := range m.Webhooks {
				reg(wh)
			}
		})
		api.Group(func(s chi.Router) {
			s.Use(m.Sessions.Middleware)
			s.Use(auth.CSRF)
			s.Use(generalLimit.Middleware("general"))
			s.Group(func(a chi.Router) {
				a.Use(authLimit.Middleware("auth"))
				m.Auth.Routes(a)
			})
			for _, reg := range m.Public {
				reg(s)
			}
			s.Group(func(c chi.Router) {
				c.Use(auth.RequireUser)
				for _, reg := range m.Customer {
					reg(c)
				}
			})
			s.Route("/admin", func(a chi.Router) {
				a.Use(auth.RequireAdmin)
				m.Media.AdminRoutes(a)
				for _, reg := range m.Admin {
					reg(a)
				}
			})
		})
		api.NotFound(func(w http.ResponseWriter, r *http.Request) { httpx.WriteError(w, r, httpx.ErrNotFound) })
		api.MethodNotAllowed(func(w http.ResponseWriter, r *http.Request) {
			httpx.WriteError(w, r, httpx.NewError(http.StatusMethodNotAllowed, "METHOD_NOT_ALLOWED", "method not allowed"))
		})
	})
	return r
}
