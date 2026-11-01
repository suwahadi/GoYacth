package auth

import (
	"errors"
	"log/slog"
	"net/http"
	"net/url"

	"github.com/go-chi/chi/v5"

	"goyacht/internal/integrations/google"
	"goyacht/internal/platform/httpx"
)

type Handler struct {
	svc    *Service
	appURL *url.URL
}

func NewHandler(svc *Service, appURL *url.URL) *Handler {
	return &Handler{svc: svc, appURL: appURL}
}

func (h *Handler) Routes(r chi.Router) {
	r.Get("/auth/google", h.begin)
	r.Get("/auth/google/callback", h.callback)
	r.Post("/auth/logout", h.logout)
	r.Get("/auth/me", h.me)
}

func (h *Handler) begin(w http.ResponseWriter, r *http.Request) {
	u, err := h.svc.BeginLogin(r.Context(), r.URL.Query().Get("return_to"))
	if err != nil {
		if errors.Is(err, google.ErrNotConfigured) {
			h.redirectError(w, r, "LOGIN_NOT_CONFIGURED")
			return
		}
		slog.ErrorContext(r.Context(), "begin login", "error", err)
		h.redirectError(w, r, "LOGIN_FAILED")
		return
	}
	http.Redirect(w, r, u, http.StatusFound)
}

func (h *Handler) callback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	if q.Get("error") != "" {
		h.redirectError(w, r, "LOGIN_CANCELLED")
		return
	}
	res, err := h.svc.CompleteLogin(r.Context(), w, r, q.Get("state"), q.Get("code"))
	if err != nil {
		code := "LOGIN_FAILED"
		if e, ok := httpx.AsError(err); ok {
			code = e.Code
		}
		if code == "LOGIN_FAILED" || code == "OAUTH_EXCHANGE_FAILED" {
			slog.WarnContext(r.Context(), "complete login", "error", err)
		}
		h.redirectError(w, r, code)
		return
	}
	target := *h.appURL
	target.Path = SafeReturnPath(res.ReturnTo)
	if p, err := url.Parse(res.ReturnTo); err == nil {
		target.Path = p.Path
		target.RawQuery = p.RawQuery
	}
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (h *Handler) redirectError(w http.ResponseWriter, r *http.Request, code string) {
	target := *h.appURL
	target.Path = "/login"
	target.RawQuery = url.Values{"error": {code}}.Encode()
	http.Redirect(w, r, target.String(), http.StatusFound)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	if err := h.svc.Logout(r.Context(), w, FromContext(r.Context())); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type meResponse struct {
	ID       string `json:"id"`
	Email    string `json:"email"`
	FullName string `json:"full_name"`
	Role     string `json:"role"`
	Locale   string `json:"locale"`
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	p := FromContext(r.Context())
	if p == nil {
		httpx.WriteError(w, r, httpx.ErrUnauthenticated)
		return
	}
	httpx.JSON(w, http.StatusOK, meResponse{ID: p.UserID.String(), Email: p.Email, FullName: p.FullName, Role: p.Role, Locale: p.Locale})
}
