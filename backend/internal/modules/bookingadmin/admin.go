// Package bookingadmin holds booking operations that span several modules: admin booking
// management, customer requests, refunds and the public tracking and verification pages.
package bookingadmin

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/payments"
	"goyacht/internal/modules/refunds"
	"goyacht/internal/modules/settings"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/idempotency"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
	"goyacht/internal/platform/validate"
)

type Handler struct {
	pool      *pgxpool.Pool
	bookings  *bookings.Service
	refunds   *refunds.Service
	cipher    *secure.Cipher
	enqueue   jobs.Enqueuer
	turnstile func(ctx context.Context, token, ip string) bool
}

func NewHandler(pool *pgxpool.Pool, b *bookings.Service, rf *refunds.Service, cipher *secure.Cipher, enqueue jobs.Enqueuer, turnstile func(ctx context.Context, token, ip string) bool) *Handler {
	return &Handler{pool: pool, bookings: b, refunds: rf, cipher: cipher, enqueue: enqueue, turnstile: turnstile}
}

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/bookings", h.list)
	r.Post("/bookings", h.createManual)
	r.Get("/bookings/{id}", h.detail)
	r.Put("/bookings/{id}/guests", h.editGuests)
	r.Post("/bookings/{id}/identity/reveal", h.revealIdentity)
	r.Post("/bookings/{id}/cancel", h.cancel)
	r.Post("/bookings/{id}/reschedule", h.reschedule)
	r.Post("/bookings/{id}/clear-exception", h.clearException)
	r.Get("/requests", h.pendingRequests)
	r.Post("/requests/{id}/resolve", h.resolveRequest)
	r.Get("/refunds", h.listRefunds)
	r.Post("/refunds/{id}/transition", h.transitionRefund)
	r.Post("/payments/{id}/refund-exception", h.refundException)
}

func (h *Handler) CustomerRoutes(r chi.Router) {
	r.Post("/bookings/{id}/cancel-request", h.request("CANCEL"))
	r.Post("/bookings/{id}/reschedule-request", h.request("RESCHEDULE"))
	r.Get("/bookings/{id}/refunds", h.customerRefunds)
	r.Get("/bookings/{id}/requests", h.customerRequests)
	r.Put("/refunds/{id}/bank-details", h.bankDetails)
}

func (h *Handler) PublicRoutes(r chi.Router) {
	limiter := httpx.NewRateLimiter(10, time.Minute)
	r.With(limiter.Middleware("track")).Post("/orders/track", h.track)
	r.With(limiter.Middleware("track")).Get("/orders/{id}", h.trackByID)
	r.Get("/orders/{id}/status", h.paymentStatus)
	r.Get("/verify/{token}", h.verify)
}

func bookingByPublic(ctx context.Context, q *dbq.Queries, raw string) (dbq.Booking, error) {
	id, err := uuid.Parse(raw)
	if err != nil {
		return dbq.Booking{}, bookings.ErrBookingNotFound
	}
	b, err := q.GetBookingByPublicID(ctx, id)
	if err != nil {
		return dbq.Booking{}, bookings.ErrBookingNotFound
	}
	return b, nil
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 25, 100)
	qs := r.URL.Query()
	opt := func(k string) *string {
		if v := strings.TrimSpace(qs.Get(k)); v != "" {
			return &v
		}
		return nil
	}
	optID := func(k string) *uuid.UUID {
		if id, err := uuid.Parse(qs.Get(k)); err == nil {
			return &id
		}
		return nil
	}
	optTime := func(k string) *time.Time {
		if t, err := time.Parse(time.RFC3339, qs.Get(k)); err == nil {
			return &t
		}
		return nil
	}
	var userID *uuid.UUID
	if u := optID("user_id"); u != nil {
		userID = u
	}
	var depID *uuid.UUID
	if d := optID("departure_id"); d != nil {
		depID = d
	}
	params := dbq.ListBookingsAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Status: opt("status"), PaymentStatus: opt("payment_status"),
		BoatID: optID("boat_id"), DepartureID: depID, UserID: userID, FromTime: optTime("from"), ToTime: optTime("to"), Search: opt("search"),
		ExceptionsOnly: qs.Get("exceptions") == "true"}
	q := dbq.New(h.pool)
	rows, err := q.ListBookingsAdmin(r.Context(), params)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountBookingsAdmin(r.Context(), dbq.CountBookingsAdminParams{Status: params.Status, PaymentStatus: params.PaymentStatus, BoatID: params.BoatID,
		DepartureID: params.DepartureID, UserID: params.UserID, FromTime: params.FromTime, ToTime: params.ToTime, Search: params.Search, ExceptionsOnly: params.ExceptionsOnly})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	now := time.Now()
	type row struct {
		bookings.BookingDTO
		LeadName        string  `json:"lead_name"`
		LeadEmail       string  `json:"lead_email"`
		ExceptionReason *string `json:"exception_reason"`
	}
	out := make([]row, 0, len(rows))
	for _, b := range rows {
		out = append(out, row{BookingDTO: bookings.ToDTO(b, i18n.Default, false, now), LeadName: b.LeadFullName, LeadEmail: b.LeadEmail, ExceptionReason: b.ExceptionReason})
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

type adminDetail struct {
	bookings.BookingDTO
	UserID          uuid.UUID                   `json:"user_id"`
	ExceptionReason *string                     `json:"exception_reason"`
	CreatedByAdmin  *uuid.UUID                  `json:"created_by_admin"`
	VerifyRevoked   bool                        `json:"verify_token_revoked"`
	Payments        []payments.PaymentDTO       `json:"payments"`
	Refunds         []dbq.Refund                `json:"refunds"`
	Requests        []dbq.BookingRequest        `json:"requests"`
	Commission      bookings.CommissionSnapshot `json:"commission"`
	ForfeitedAmount int64                       `json:"forfeited_amount"`
	DepartureID     *uuid.UUID                  `json:"departure_id"`
	RouteID         uuid.UUID                   `json:"route_id"`
	Consents        any                         `json:"consents"`
}

func (h *Handler) detail(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookingByPublic(r.Context(), q, chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	d := bookings.ToDTO(b, i18n.Default, true, time.Now())
	guests, err := q.ListBookingGuests(r.Context(), []uuid.UUID{b.ID})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var ident *dbq.BookingIdentity
	if id, err := q.GetBookingIdentity(r.Context(), b.ID); err == nil {
		ident = &id
	}
	bookings.WithPeople(&d, b, guests, ident)
	pays, err := q.ListBookingPayments(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	payDTOs := make([]payments.PaymentDTO, 0, len(pays))
	for _, p := range pays {
		payDTOs = append(payDTOs, payments.ToDTO(p))
	}
	rfs, err := q.ListBookingRefunds(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	reqs, err := q.ListBookingRequests(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	snap := bookings.LoadSnapshot(b)
	httpx.JSON(w, http.StatusOK, adminDetail{BookingDTO: d, UserID: b.UserID, ExceptionReason: b.ExceptionReason, CreatedByAdmin: b.CreatedByAdmin,
		VerifyRevoked: b.VerifyTokenRevoked, Payments: payDTOs, Refunds: rfs, Requests: reqs, Commission: snap.Commission,
		ForfeitedAmount: b.ForfeitedAmount, DepartureID: b.DepartureID, RouteID: b.RouteID, Consents: b.Consents})
}

type manualInput struct {
	UserID uuid.UUID `json:"user_id"`
	bookings.CreateInput
}

func (h *Handler) createManual(w http.ResponseWriter, r *http.Request) {
	key, err := idempotency.KeyFromRequest(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var in manualInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	res, err := idempotency.Do(r.Context(), h.pool, "booking.manual", &actor, key, in, func(tx pgx.Tx) (int, any, error) {
		q := dbq.New(tx)
		u, err := q.GetUserByID(r.Context(), in.UserID)
		if err != nil || u.Status != "ACTIVE" {
			return 0, nil, httpx.Validation(map[string]string{"user_id": "USER_NOT_FOUND"})
		}
		cfg, err := settings.Load(r.Context(), q, "booking", settings.DefaultBooking())
		if err != nil {
			return 0, nil, err
		}
		in.PaymentMethod = ""
		b, err := h.bookings.Create(r.Context(), tx, in.CreateInput, bookings.CreateOptions{UserID: u.ID, UserEmail: u.Email, AdminID: &actor, HoldMinutes: int32(cfg.AdminHoldMinutes)})
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, bookings.ToDTO(b, i18n.Default, true, time.Now()), nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idempotency.Write(w, res)
}

type guestsInput struct {
	LeadFullName string                `json:"lead_full_name"`
	LeadPhone    string                `json:"lead_phone"`
	Guests       []bookings.GuestInput `json:"guests"`
}

// editGuests is the only way to change passenger data after checkout (PRD 8.3). Pax is fixed.
func (h *Handler) editGuests(w http.ResponseWriter, r *http.Request) {
	var in guestsInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		b, err := bookingByPublic(r.Context(), q, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		b, err = q.LockBooking(r.Context(), b.ID)
		if err != nil {
			return err
		}
		f := httpx.FieldErrors{}
		if len(in.Guests) != int(b.Pax)-1 {
			f.Add("guests", "COUNT_MISMATCH")
		}
		if !validate.Length(in.LeadFullName, 2, 120) {
			f.Add("lead_full_name", "INVALID_LENGTH")
		}
		if !validate.Phone(in.LeadPhone) {
			f.Add("lead_phone", "INVALID_PHONE")
		}
		for i, g := range in.Guests {
			if !validate.Length(g.FullName, 2, 120) {
				f.Add("guests."+itoa(i)+".full_name", "INVALID_LENGTH")
			}
			if g.Phone != "" && !validate.Phone(g.Phone) {
				f.Add("guests."+itoa(i)+".phone", "INVALID_PHONE")
			}
		}
		if err := f.Err(); err != nil {
			return err
		}
		before, err := q.ListBookingGuests(r.Context(), []uuid.UUID{b.ID})
		if err != nil {
			return err
		}
		if err := q.DeleteBookingGuests(r.Context(), b.ID); err != nil {
			return err
		}
		for i, g := range in.Guests {
			if err := q.InsertBookingGuest(r.Context(), dbq.InsertBookingGuestParams{BookingID: b.ID, SortOrder: int32(i + 1), FullName: strings.TrimSpace(g.FullName), Phone: strings.TrimSpace(g.Phone)}); err != nil {
				return err
			}
		}
		if _, err := tx.Exec(r.Context(), `UPDATE bookings SET lead_full_name = $2, lead_phone = $3, updated_at = now() WHERE id = $1`, b.ID, strings.TrimSpace(in.LeadFullName), in.LeadPhone); err != nil {
			return err
		}
		names := func(gs []dbq.BookingGuest) []string {
			out := []string{}
			for _, g := range gs {
				out = append(out, g.FullName)
			}
			return out
		}
		after := []string{}
		for _, g := range in.Guests {
			after = append(after, g.FullName)
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "booking.guests_edited", EntityType: "booking", EntityID: b.ID.String(),
			Before: map[string]any{"lead": b.LeadFullName, "guests": names(before)}, After: map[string]any{"lead": in.LeadFullName, "guests": after}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

// revealIdentity decrypts the full identity number for an admin and records the access.
func (h *Handler) revealIdentity(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context()).UserID
	var number, idType string
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		b, err := bookingByPublic(r.Context(), q, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		ident, err := q.GetBookingIdentity(r.Context(), b.ID)
		if err != nil || ident.Ciphertext == nil || ident.KeyID == nil {
			return httpx.NewError(http.StatusGone, "IDENTITY_PURGED", "identity number is no longer stored")
		}
		plain, err := h.cipher.Decrypt(ident.Ciphertext, *ident.KeyID, b.ID[:])
		if err != nil {
			return err
		}
		number, idType = string(plain), ident.IDType
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "booking.identity_revealed", EntityType: "booking", EntityID: b.ID.String()})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, map[string]string{"id_type": idType, "id_number": number})
}

type cancelInput struct {
	CancelType string `json:"cancel_type"`
	Reason     string `json:"reason"`
}

func (h *Handler) cancel(w http.ResponseWriter, r *http.Request) {
	var in cancelInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if in.CancelType != bookings.CancelOperator && in.CancelType != bookings.CancelCustomer {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"cancel_type": "INVALID"}))
		return
	}
	if !validate.Length(in.Reason, 3, 500) {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"reason": "INVALID_LENGTH"}))
		return
	}
	actor := auth.UserIDPtr(auth.FromContext(r.Context()))
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		b, err := bookingByPublic(r.Context(), dbq.New(tx), chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		return h.refunds.Cancel(r.Context(), tx, b.ID, in.CancelType, in.Reason, actor)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) clearException(w http.ResponseWriter, r *http.Request) {
	actor := auth.FromContext(r.Context()).UserID
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		b, err := bookingByPublic(r.Context(), q, chi.URLParam(r, "id"))
		if err != nil {
			return err
		}
		if err := q.ClearBookingException(r.Context(), b.ID); err != nil {
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "booking.exception_cleared", EntityType: "booking", EntityID: b.ID.String(), Before: map[string]any{"reason": b.ExceptionReason}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) refundException(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("PAYMENT_NOT_FOUND"))
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		return h.refunds.RefundException(r.Context(), tx, id, actor)
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) listRefunds(w http.ResponseWriter, r *http.Request) {
	page := httpx.ParsePage(r, 50, 200)
	var status *string
	if s := r.URL.Query().Get("status"); s != "" {
		status = &s
	}
	q := dbq.New(h.pool)
	rows, err := q.ListRefundsAdmin(r.Context(), dbq.ListRefundsAdminParams{Limit: int32(page.PerPage), Offset: int32(page.Offset()), Status: status})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountRefundsAdmin(r.Context(), status)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, rows, page)
}

func (h *Handler) transitionRefund(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, refunds.ErrRefundNotFound)
		return
	}
	var in refunds.TransitionInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rf, err := h.refunds.Transition(r.Context(), id, in, auth.FromContext(r.Context()).UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rf)
}

type requestInput struct {
	Message string `json:"message"`
}

func (h *Handler) request(kind string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var in requestInput
		if err := httpx.Decode(w, r, &in); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if !validate.Length(in.Message, 0, 2000) {
			httpx.WriteError(w, r, httpx.Validation(map[string]string{"message": "TOO_LONG"}))
			return
		}
		var req dbq.BookingRequest
		err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
			q := dbq.New(tx)
			b, err := bookings.OwnedBooking(r, q)
			if err != nil {
				return err
			}
			if bookings.Status(b.Status) != bookings.StatusConfirmed || !b.StartsAt.After(time.Now()) {
				return httpx.Conflict("REQUEST_NOT_ALLOWED", "this booking cannot be changed")
			}
			req, err = q.InsertBookingRequest(r.Context(), dbq.InsertBookingRequestParams{BookingID: b.ID, Type: kind, Message: strings.TrimSpace(in.Message)})
			if db.IsUniqueViolation(err) {
				return httpx.Conflict("REQUEST_PENDING", "a request is already pending")
			}
			if err != nil {
				return err
			}
			return h.enqueue.EnqueueTx(r.Context(), tx, jobs.Notify{Template: "admin_request", BookingID: &b.ID, DedupeKey: "admin_request:" + req.ID.String(), Audience: jobs.AudienceAdmin})
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.JSON(w, http.StatusCreated, req)
	}
}

func (h *Handler) pendingRequests(w http.ResponseWriter, r *http.Request) {
	rows, err := dbq.New(h.pool).ListPendingRequests(r.Context())
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rows)
}

type resolveInput struct {
	Approve    bool   `json:"approve"`
	Resolution string `json:"resolution"`
}

// resolveRequest approves or rejects a customer request. An approved cancellation cancels the
// booking with the snapshot policy; an approved reschedule is recorded and the admin performs the
// move with the reschedule action.
func (h *Handler) resolveRequest(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.NotFound("REQUEST_NOT_FOUND"))
		return
	}
	var in resolveInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	err = db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		req, err := q.LockBookingRequest(r.Context(), id)
		if err != nil {
			return httpx.NotFound("REQUEST_NOT_FOUND")
		}
		status := "REJECTED"
		if in.Approve {
			status = "APPROVED"
		}
		if _, err := q.ResolveBookingRequest(r.Context(), dbq.ResolveBookingRequestParams{ID: id, Status: status, Resolution: strings.TrimSpace(in.Resolution), ResolvedBy: &actor}); err != nil {
			if db.IsNoRows(err) {
				return httpx.Conflict("REQUEST_ALREADY_RESOLVED", "request is already resolved")
			}
			return err
		}
		if in.Approve && req.Type == "CANCEL" {
			if err := h.refunds.Cancel(r.Context(), tx, req.BookingID, bookings.CancelCustomer, "customer request approved", &actor); err != nil {
				return err
			}
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "booking_request.resolved", EntityType: "booking", EntityID: req.BookingID.String(), After: map[string]any{"type": req.Type, "status": status}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type customerRefund struct {
	ID              uuid.UUID  `json:"id"`
	Amount          int64      `json:"amount"`
	Channel         string     `json:"channel"`
	Status          string     `json:"status"`
	NeedsBank       bool       `json:"needs_bank_details"`
	BankName        string     `json:"bank_name"`
	BankAccountName string     `json:"bank_account_name"`
	CompletedAt     *time.Time `json:"completed_at"`
}

func (h *Handler) customerRefunds(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := q.ListBookingRefunds(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]customerRefund, 0, len(rows))
	for _, rf := range rows {
		out = append(out, customerRefund{ID: rf.ID, Amount: rf.Amount, Channel: rf.Channel, Status: rf.Status,
			NeedsBank: rf.Channel == "MANUAL" && rf.BankAccountNumber == "" && (rf.Status == "REQUESTED" || rf.Status == "APPROVED"),
			BankName:  rf.BankName, BankAccountName: rf.BankAccountName, CompletedAt: rf.CompletedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}

func (h *Handler) bankDetails(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, refunds.ErrRefundNotFound)
		return
	}
	var in refunds.BankInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if err := h.refunds.SetBankDetails(r.Context(), auth.FromContext(r.Context()).UserID, id, in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type customerRequest struct {
	ID         uuid.UUID  `json:"id"`
	Type       string     `json:"type"`
	Status     string     `json:"status"`
	Message    string     `json:"message"`
	Resolution string     `json:"resolution"`
	CreatedAt  time.Time  `json:"created_at"`
	ResolvedAt *time.Time `json:"resolved_at"`
}

func (h *Handler) customerRequests(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookings.OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	rows, err := q.ListBookingRequests(r.Context(), b.ID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := make([]customerRequest, 0, len(rows))
	for _, x := range rows {
		out = append(out, customerRequest{ID: x.ID, Type: x.Type, Status: x.Status, Message: x.Message, Resolution: x.Resolution, CreatedAt: x.CreatedAt, ResolvedAt: x.ResolvedAt})
	}
	httpx.JSON(w, http.StatusOK, out)
}
