package bookings

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/modules/auth"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/idempotency"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) PublicRoutes(r chi.Router) {
	limiter := httpx.NewRateLimiter(60, time.Minute)
	r.With(limiter.Middleware("quote")).Post("/quotes", h.quote)
	r.Get("/availability", h.availability)
}

func (h *Handler) CustomerRoutes(r chi.Router) {
	limiter := httpx.NewRateLimiter(20, time.Minute)
	r.With(limiter.Middleware("booking")).Post("/bookings", h.create)
	r.Get("/account/bookings", h.list)
	r.Get("/account/bookings/{id}", h.get)
	r.Post("/bookings/{id}/cancel-unpaid", h.cancelUnpaid)
}

func (h *Handler) quote(w http.ResponseWriter, r *http.Request) {
	var in QuoteInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	qu, err := h.svc.quoter.Build(r.Context(), dbq.New(h.svc.pool), in, false)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, qu)
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
	p := auth.FromContext(r.Context())
	if !p.EmailVerified {
		httpx.WriteError(w, r, auth.ErrEmailUnverified)
		return
	}
	res, err := idempotency.Do(r.Context(), h.svc.pool, "booking.create", &p.UserID, key, in, func(tx pgx.Tx) (int, any, error) {
		b, err := h.svc.Create(r.Context(), tx, in, CreateOptions{UserID: p.UserID, UserEmail: p.Email})
		if err != nil {
			return 0, nil, err
		}
		return http.StatusCreated, ToDTO(b, b.Locale, true, time.Now()), nil
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	idempotency.Write(w, res)
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) {
	p := auth.FromContext(r.Context())
	page := httpx.ParsePage(r, 10, 50)
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	q := dbq.New(h.svc.pool)
	rows, err := q.ListUserBookings(r.Context(), dbq.ListUserBookingsParams{UserID: p.UserID, Limit: int32(page.PerPage), Offset: int32(page.Offset())})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	total, err := q.CountUserBookings(r.Context(), p.UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	now := time.Now()
	out := make([]BookingDTO, 0, len(rows))
	for _, b := range rows {
		out = append(out, ToDTO(b, loc, false, now))
	}
	page.Total = int(total)
	httpx.JSONMeta(w, http.StatusOK, out, page)
}

// OwnedBooking loads a booking by its public ID and returns 404 unless the caller owns it, so the
// response never reveals whether someone else's booking exists.
func OwnedBooking(r *http.Request, q *dbq.Queries) (dbq.Booking, error) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		return dbq.Booking{}, ErrBookingNotFound
	}
	b, err := q.GetBookingByPublicID(r.Context(), id)
	if err != nil {
		if db.IsNoRows(err) {
			return b, ErrBookingNotFound
		}
		return b, err
	}
	p := auth.FromContext(r.Context())
	if p == nil || b.UserID != p.UserID {
		return dbq.Booking{}, ErrBookingNotFound
	}
	return b, nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.svc.pool)
	b, err := OwnedBooking(r, q)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	loc := i18n.Normalize(r.URL.Query().Get("locale"))
	d := ToDTO(b, loc, true, time.Now())
	guests, err := q.ListBookingGuests(r.Context(), []uuid.UUID{b.ID})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var ident *dbq.BookingIdentity
	if id, err := q.GetBookingIdentity(r.Context(), b.ID); err == nil {
		ident = &id
	}
	WithPeople(&d, b, guests, ident)
	httpx.JSON(w, http.StatusOK, d)
}

func (h *Handler) cancelUnpaid(w http.ResponseWriter, r *http.Request) {
	id, err := uuid.Parse(chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, ErrBookingNotFound)
		return
	}
	if err := h.svc.CancelUnpaid(r.Context(), auth.FromContext(r.Context()).UserID, id); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

type busyRange struct {
	StartsAt time.Time `json:"starts_at"`
	EndsAt   time.Time `json:"ends_at"`
	Kind     string    `json:"kind"`
}

// availability returns occupied ranges for one boat so the date picker can grey out busy times.
// It is informational; the booking transaction re-checks everything.
func (h *Handler) availability(w http.ResponseWriter, r *http.Request) {
	qs := r.URL.Query()
	boatID, err := uuid.Parse(qs.Get("boat_id"))
	if err != nil {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"boat_id": "REQUIRED"}))
		return
	}
	from, err1 := time.Parse(time.RFC3339, qs.Get("from"))
	to, err2 := time.Parse(time.RFC3339, qs.Get("to"))
	if err1 != nil || err2 != nil || !to.After(from) || to.Sub(from) > 62*24*time.Hour {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"from": "INVALID_RANGE"}))
		return
	}
	rows, err := dbq.New(h.svc.pool).ListBoatReservations(r.Context(), dbq.ListBoatReservationsParams{BoatIds: []uuid.UUID{boatID}, FromTime: from, ToTime: to})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	seen := map[string]bool{}
	out := []busyRange{}
	for _, x := range rows {
		k := x.StartsAt.String() + x.EndsAt.String()
		if seen[k] {
			continue
		}
		seen[k] = true
		kind := "BUSY"
		if x.Kind == "DEPARTURE" {
			kind = "DEPARTURE"
		}
		out = append(out, busyRange{StartsAt: x.StartsAt, EndsAt: x.EndsAt, Kind: kind})
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, out)
}
