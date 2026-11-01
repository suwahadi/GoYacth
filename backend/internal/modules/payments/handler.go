package payments

import (
	"io"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/idempotency"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) CustomerRoutes(r chi.Router) {
	limiter := httpx.NewRateLimiter(20, time.Minute)
	r.With(limiter.Middleware("payment")).Post("/bookings/{id}/payments", h.create)
	r.Get("/bookings/{id}/payments", h.list)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	r.Get("/payments/config", h.config)
}

func (h *Handler) WebhookRoutes(r chi.Router) {
	r.Post("/webhooks/midtrans", h.webhook)
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/payments", h.adminList)
	r.Get("/payment-events", h.adminEvents)
	r.Post("/bookings/{id}/payments", h.manual)
}

func (h *Handler) config(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "public, max-age=300")
	httpx.JSON(w, http.StatusOK, map[string]string{"client_key": h.svc.gateway.ClientKey(), "snap_js_url": h.svc.gateway.SnapJSURL()})
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) {
	key, err := idempotency.KeyFromRequest(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in CreateInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	b, err := bookings.OwnedBooking(r, dbq.New(h.svc.pool))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	p := auth.FromContext(r.Context())
	scope := "payment.create:" + b.ID.String()
	res, err := idempotency.Do(r.Context(), h.svc.pool, scope, &p.UserID, key, in, func(tx pgx.Tx) (int, any, error) {
		pay, err := h.svc.CreateForCustomer(r.Context(), tx, b, in)
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, ToDTO(pay), nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idempotency.Write(w, res)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.svc.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := q.ListBookingPayments(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]PaymentDTO, 0, len(rows))
	for _, p := range rows {
		out = append(out, ToDTO(p))
	}
	httpx.JSON(w, http.StatusOK, out)
}

// webhook answers Midtrans per its retry semantics: 2xx stops retries, anything else makes
// Midtrans retry. Forged and unknown notifications get 4xx and are logged; transient failures
// return 500 so the notification is delivered again.
func (h *Handler) webhook(w http.ResponseWriter, r *http.Request) {
	raw, err := io.ReadAll(io.LimitReader(r.Body, 64<<10))
	if err != nil {
		httpx.WriteError(w, r, httpx.BadRequest("WEBHOOK_INVALID", "cannot read body"))
		return
	}
	if err := h.svc.HandleNotification(r.Context(), raw); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

type adminPaymentRow struct {
	PaymentDTO
	BookingNumber   string     `json:"booking_number"`
	BookingPublicID uuid.UUID  `json:"booking_id"`
	ProviderStatus  string     `json:"provider_status"`
	Notes           string     `json:"notes"`
	ProofMediaID    *uuid.UUID `json:"proof_media_id"`
}

func (h *Handler) adminList(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 50, 200)
	qs := r.URL.Query()
	opt := func(k string) *string {
		if v := qs.Get(k); v != "" {
			return &v
		}
		return nil
	}
	exceptions := qs.Get("exceptions") == "true"
	q := dbq.New(h.svc.pool)
	rows, err := q.ListPaymentsAdmin(r.Context(), dbq.ListPaymentsAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Status: opt("status"), Method: opt("method"), ExceptionsOnly: exceptions})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountPaymentsAdmin(r.Context(), dbq.CountPaymentsAdminParams{Status: opt("status"), Method: opt("method"), ExceptionsOnly: exceptions})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]adminPaymentRow, 0, len(rows))
	for _, p := range rows {
		d := ToDTO(dbq.Payment{ID: p.ID, Kind: p.Kind, Provider: p.Provider, Method: p.Method, OrderID: p.OrderID, PrincipalAmount: p.PrincipalAmount,
			FeeAmount: p.FeeAmount, GrossAmount: p.GrossAmount, Status: p.Status, VaNumbers: p.VaNumbers, ExpiresAt: p.ExpiresAt, PaidAt: p.PaidAt,
			IsException: p.IsException, CreatedAt: p.CreatedAt})
		out = append(out, adminPaymentRow{PaymentDTO: d, BookingNumber: p.BookingNumber, BookingPublicID: p.BookingPublicID, ProviderStatus: p.ProviderStatus, Notes: p.Notes, ProofMediaID: p.ProofMediaID})
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

func (h *Handler) adminEvents(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 50, 200)
	var order *string
	if v := r.URL.Query().Get("order_id"); v != "" {
		order = &v
	}
	q := dbq.New(h.svc.pool)
	rows, err := q.ListPaymentEvents(r.Context(), dbq.ListPaymentEventsParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), OrderID: order})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountPaymentEvents(r.Context(), order)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, rows, page)
}

func (h *Handler) manual(w http.ResponseWriter, r *http.Request) {
	key, err := idempotency.KeyFromRequest(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in ManualInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	publicID, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, bookings.ErrBookingNotFound)
		return
	}
	b, err := dbq.New(h.svc.pool).GetBookingByPublicID(r.Context(), publicID)
	if err != nil {
		httpx.WriteError(w, r, bookings.ErrBookingNotFound)
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	res, err := idempotency.Do(r.Context(), h.svc.pool, "payment.manual:"+b.ID.String(), &actor, key, in, func(tx pgx.Tx) (int, any, error) {
		p, err := h.svc.RecordManual(r.Context(), tx, b.ID, in, actor)
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, ToDTO(p), nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idempotency.Write(w, res)
}
