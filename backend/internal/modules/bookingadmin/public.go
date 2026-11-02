package bookingadmin

import (
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/auth"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/payments"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
	"goyacht/internal/platform/secure"
)

func itoa(i int) string { return strconv.Itoa(i) }

// TrackingDTO is the public view. It deliberately carries no names, phone numbers, identity
// numbers or guests (PRD 11.5).
type TrackingDTO struct {
	ID            uuid.UUID `json:"id"`
	BookingNumber string    `json:"booking_number"`
	Status        string    `json:"status"`
	PaymentStatus string    `json:"payment_status"`
	StartsAt      time.Time `json:"starts_at"`
	Timezone      string    `json:"timezone"`
	BoatName      string    `json:"boat_name"`
	RouteName     string    `json:"route_name"`
}

func toTracking(b dbq.Booking, loc string) TrackingDTO {
	snap := bookings.LoadSnapshot(b)
	return TrackingDTO{ID: b.PublicID, BookingNumber: b.BookingNumber, Status: b.Status, PaymentStatus: b.PaymentStatus, StartsAt: b.StartsAt,
		Timezone: b.Timezone, BoatName: catalog.Pick(snap.BoatName, loc), RouteName: catalog.Pick(snap.RouteName, loc)}
}

type trackInput struct {
	BookingNumber  string `json:"booking_number"`
	Email          string `json:"email"`
	TurnstileToken string `json:"turnstile_token"`
	Locale         string `json:"locale"`
}

func (h *Handler) track(w http.ResponseWriter, r *http.Request) {
	var in trackInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	if !h.turnstile(r.Context(), in.TurnstileToken, httpx.ClientIP(r.Context())) {
		httpx.WriteError(w, r, httpx.NewError(http.StatusForbidden, "CAPTCHA_FAILED", "verification failed"))
		return
	}
	b, err := dbq.New(h.pool).GetBookingByNumber(r.Context(), strings.ToUpper(strings.TrimSpace(in.BookingNumber)))
	// The same error for "no such booking" and "wrong email" prevents enumerating bookings.
	if err != nil || !secure.ConstantTimeEqual(strings.ToLower(b.LeadEmail), strings.ToLower(strings.TrimSpace(in.Email))) {
		httpx.WriteError(w, r, bookings.ErrBookingNotFound)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, toTracking(b, i18n.Normalize(in.Locale)))
}

func (h *Handler) trackByID(w http.ResponseWriter, r *http.Request) {
	b, err := bookingByPublic(r.Context(), dbq.New(h.pool), chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, toTracking(b, i18n.Normalize(r.URL.Query().Get("locale"))))
}

type statusDTO struct {
	TrackingDTO
	HoldExpiresAt *time.Time           `json:"hold_expires_at"`
	Payment       *payments.PaymentDTO `json:"payment"`
}

// paymentStatus backs the polling page Snap redirects to. Anyone with the UUID sees the
// tracking fields; only the logged-in owner also gets the latest payment with VA instructions.
func (h *Handler) paymentStatus(w http.ResponseWriter, r *http.Request) {
	q := dbq.New(h.pool)
	b, err := bookingByPublic(r.Context(), q, chi.URLParam(r, "id"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out := statusDTO{TrackingDTO: toTracking(b, i18n.Normalize(r.URL.Query().Get("locale")))}
	if p := auth.FromContext(r.Context()); p != nil && p.UserID == b.UserID {
		out.HoldExpiresAt = b.HoldExpiresAt
		pays, err := q.ListBookingPayments(r.Context(), b.ID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if len(pays) > 0 {
			d := payments.ToDTO(pays[len(pays)-1])
			out.Payment = &d
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, out)
}

// MaskName turns "John Smith" into "J*** S****" for the public verification page.
func MaskName(full string) string {
	parts := strings.Fields(full)
	for i, p := range parts {
		n := utf8.RuneCountInString(p)
		first, _ := utf8.DecodeRuneInString(p)
		parts[i] = string(first) + strings.Repeat("*", n-1)
	}
	return strings.Join(parts, " ")
}

type verifyDTO struct {
	Valid         bool      `json:"valid"`
	Status        string    `json:"status"`
	BookingNumber string    `json:"booking_number"`
	StartsAt      time.Time `json:"starts_at"`
	Timezone      string    `json:"timezone"`
	BoatName      string    `json:"boat_name"`
	Pax           int32     `json:"pax"`
	LeadName      string    `json:"lead_name"`
}

func (h *Handler) verify(w http.ResponseWriter, r *http.Request) {
	token := chi.URLParam(r, "token")
	if len(token) < 16 || len(token) > 64 {
		httpx.WriteError(w, r, bookings.ErrBookingNotFound)
		return
	}
	b, err := dbq.New(h.pool).GetBookingByVerifyToken(r.Context(), token)
	if err != nil {
		httpx.WriteError(w, r, bookings.ErrBookingNotFound)
		return
	}
	st := bookings.Status(b.Status)
	valid := !b.VerifyTokenRevoked && b.AmountPaid > 0 && (st == bookings.StatusConfirmed || st == bookings.StatusInProgress || st == bookings.StatusCompleted)
	status := b.Status
	if b.VerifyTokenRevoked && st != bookings.StatusCancelled {
		status = "REVOKED"
	}
	snap := bookings.LoadSnapshot(b)
	w.Header().Set("Cache-Control", "no-store")
	httpx.JSON(w, http.StatusOK, verifyDTO{Valid: valid, Status: status, BookingNumber: b.BookingNumber, StartsAt: b.StartsAt, Timezone: b.Timezone,
		BoatName: catalog.Pick(snap.BoatName, i18n.Normalize(r.URL.Query().Get("locale"))), Pax: b.Pax, LeadName: MaskName(b.LeadFullName)})
}

type rescheduleInput struct {
	Date            string     `json:"date"`
	StartTime       string     `json:"start_time"`
	DepartureSlotID *uuid.UUID `json:"departure_slot_id"`
	Note            string     `json:"note"`
}

// reschedule moves a confirmed booking (PRD 10.2). Inventory is re-reserved under the same
// constraints as a new booking; the old ticket token is revoked and a new one issued. Price
// differences are settled manually, so amounts and the snapshot stay unchanged.
func (h *Handler) reschedule(w http.ResponseWriter, r *http.Request) {
	var in rescheduleInput
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
		if bookings.Status(b.Status) != bookings.StatusConfirmed {
			return bookings.ErrInvalidTransition
		}
		newStart, newEnd, newDep, newSlot, err := h.moveInventory(r, tx, q, b, in)
		if err != nil {
			return err
		}
		if _, err := tx.Exec(r.Context(), `UPDATE bookings SET starts_at = $2::timestamptz, ends_at = $3, departure_id = $4, departure_slot_id = $5,
			verify_token = $6, verify_token_revoked = false, balance_due_at = CASE WHEN balance_due_at IS NULL THEN NULL ELSE $2::timestamptz - (starts_at - balance_due_at) END,
			updated_at = now() WHERE id = $1`, b.ID, newStart, newEnd, newDep, newSlot, secure.RandomToken(16)); err != nil {
			if db.UniqueConstraint(err) == "bookings_private_slot_unique_idx" {
				return bookings.ErrSlotTaken
			}
			return err
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "booking.rescheduled", EntityType: "booking", EntityID: b.ID.String(),
			Before: map[string]any{"starts_at": b.StartsAt, "departure_slot_id": b.DepartureSlotID}, After: map[string]any{"starts_at": newStart, "departure_slot_id": newSlot, "note": in.Note}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.NoContent(w)
}

func (h *Handler) moveInventory(r *http.Request, tx pgx.Tx, q *dbq.Queries, b dbq.Booking, in rescheduleInput) (time.Time, time.Time, *uuid.UUID, *uuid.UUID, error) {
	ctx := r.Context()
	if b.Mode == bookings.ModeDeparture {
		if in.DepartureSlotID == nil {
			return time.Time{}, time.Time{}, nil, nil, httpx.Validation(map[string]string{"departure_slot_id": "REQUIRED"})
		}
		slot, err := q.GetDepartureSlot(ctx, *in.DepartureSlotID)
		if err != nil {
			return time.Time{}, time.Time{}, nil, nil, httpx.Validation(map[string]string{"departure_slot_id": "NOT_FOUND"})
		}
		dep, err := q.LockDeparture(ctx, slot.DepartureID)
		if err != nil || dep.Status != "SCHEDULED" {
			return time.Time{}, time.Time{}, nil, nil, httpx.Validation(map[string]string{"departure_slot_id": "NOT_AVAILABLE"})
		}
		if slot.SlotType != bookings.LoadSnapshot(b).SlotLabel {
			return time.Time{}, time.Time{}, nil, nil, httpx.Validation(map[string]string{"departure_slot_id": "SLOT_TYPE_MISMATCH"})
		}
		boat, err := q.GetBoat(ctx, dep.BoatID)
		if err != nil {
			return time.Time{}, time.Time{}, nil, nil, err
		}
		total, err := q.SumDeparturePax(ctx, &dep.ID)
		if err != nil {
			return time.Time{}, time.Time{}, nil, nil, err
		}
		if b.DepartureID != nil && *b.DepartureID == dep.ID {
			total -= int64(b.Pax)
		}
		if total+int64(b.Pax) > int64(boat.MaxPassengers) || int32(b.Pax) > slot.MaxPax {
			return time.Time{}, time.Time{}, nil, nil, bookings.ErrCapacityExceeded
		}
		if slot.SlotType == bookings.SlotSeatPool {
			used, err := q.SumSlotPax(ctx, &slot.ID)
			if err != nil {
				return time.Time{}, time.Time{}, nil, nil, err
			}
			if b.DepartureSlotID != nil && *b.DepartureSlotID == slot.ID {
				used -= int64(b.Pax)
			}
			if slot.SeatCapacity == nil || used+int64(b.Pax) > int64(*slot.SeatCapacity) {
				return time.Time{}, time.Time{}, nil, nil, bookings.ErrCapacityExceeded
			}
		}
		depID, slotID := dep.ID, slot.ID
		return dep.DepartsAt, dep.ReturnsAt, &depID, &slotID, nil
	}
	loc, err := time.LoadLocation(b.Timezone)
	if err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	start, err := time.ParseInLocation("2006-01-02 15:04", in.Date+" "+in.StartTime, loc)
	if err != nil || !start.After(time.Now()) {
		return time.Time{}, time.Time{}, nil, nil, httpx.Validation(map[string]string{"date": "INVALID_DATE"})
	}
	end := start.Add(b.EndsAt.Sub(b.StartsAt))
	boat, err := q.LockBoat(ctx, b.BoatID)
	if err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	if err := q.DeleteBookingReservations(ctx, &b.ID); err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	buffer := time.Duration(boat.TurnaroundBufferMinutes) * time.Minute
	areas, err := q.ListBoatAreaIDs(ctx, b.BoatID)
	if err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	stale, err := q.ListExpiredHeldOverlapping(ctx, dbq.ListExpiredHeldOverlappingParams{BoatID: b.BoatID, StartsAt: start.Add(-buffer), EndsAt: end.Add(buffer)})
	if err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	for _, id := range stale {
		if id != nil {
			if _, err := bookings.ExpireIfStale(ctx, q, *id, time.Now()); err != nil {
				return time.Time{}, time.Time{}, nil, nil, err
			}
		}
	}
	sp, err := tx.Begin(ctx)
	if err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	bid := b.ID
	for _, a := range areas {
		if err := dbq.New(sp).InsertAreaReservation(ctx, dbq.InsertAreaReservationParams{AreaID: a, BoatID: b.BoatID, StartsAt: start.Add(-buffer), EndsAt: end.Add(buffer),
			Kind: "CHARTER", BookingID: &bid, Status: "ACTIVE"}); err != nil {
			_ = sp.Rollback(ctx)
			if db.IsExclusionViolation(err) {
				return time.Time{}, time.Time{}, nil, nil, bookings.ErrSlotTaken
			}
			return time.Time{}, time.Time{}, nil, nil, err
		}
	}
	if err := sp.Commit(ctx); err != nil {
		return time.Time{}, time.Time{}, nil, nil, err
	}
	return start, end, nil, nil, nil
}
