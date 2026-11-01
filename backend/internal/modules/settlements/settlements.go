package settlements

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
	"goyacht/internal/modules/pricing"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
)

type Handler struct {
	pool *pgxpool.Pool
}

func NewHandler(pool *pgxpool.Pool) *Handler { return &Handler{pool: pool} }

func (h *Handler) AdminRoutes(r chi.Router) {
	r.Get("/settlements", h.report)
	r.Get("/payouts", h.listPayouts)
	r.Post("/payouts", h.recordPayout)
}

type Line struct {
	BookingID     uuid.UUID  `json:"booking_id"`
	BookingNumber string     `json:"booking_number"`
	Status        string     `json:"status"`
	EndsAt        time.Time  `json:"ends_at"`
	Basis         int64      `json:"basis"`
	Commission    int64      `json:"commission"`
	Refunded      int64      `json:"refunded"`
	PartnerAmount int64      `json:"partner_amount"`
	PayoutID      *uuid.UUID `json:"payout_id"`
	internalID    uuid.UUID
}

// PartnerShare implements PRD 10.4. For completed trips the basis is the pre-tax subtotal; for
// forfeited deposits it is the forfeited share of the subtotal. Commission uses the snapshot,
// and principal refunds net of taxes reduce the partner's amount proportionally.
func PartnerShare(subtotal, grandTotal, amountPaid, amountRefunded, forfeited int64, status string, c bookings.CommissionSnapshot) (basis, commission, refunded, partner int64) {
	if grandTotal <= 0 {
		return 0, 0, 0, 0
	}
	if status == string(bookings.StatusCancelled) {
		basis = forfeited * subtotal / grandTotal
	} else {
		basis = subtotal
		refunded = amountRefunded * subtotal / grandTotal
	}
	if c.Type != nil {
		commission = pricing.CommissionFor(basis, *c.Type, c.Value)
	}
	partner = basis - commission - refunded
	if partner < 0 {
		partner = 0
	}
	return
}

func (h *Handler) lines(ctx context.Context, q *dbq.Queries, partnerID uuid.UUID, start, end time.Time) ([]Line, error) {
	rows, err := q.ListSettlementBookings(ctx, dbq.ListSettlementBookingsParams{PartnerID: &partnerID, PeriodStart: start, PeriodEnd: end})
	if err != nil {
		return nil, err
	}
	out := make([]Line, 0, len(rows))
	for _, b := range rows {
		snap := bookings.LoadSnapshot(dbq.Booking{Snapshot: b.Snapshot})
		grand := b.Subtotal
		if snap.Quote != nil {
			grand = snap.Quote.GrandTotal
		}
		basis, comm, ref, partner := PartnerShare(b.Subtotal, grand, b.AmountPaid, b.AmountRefunded, b.ForfeitedAmount, b.Status, snap.Commission)
		out = append(out, Line{BookingID: b.PublicID, BookingNumber: b.BookingNumber, Status: b.Status, EndsAt: b.EndsAt, Basis: basis, Commission: comm,
			Refunded: ref, PartnerAmount: partner, PayoutID: b.PayoutID, internalID: b.ID})
	}
	return out, nil
}

func parsePeriod(r *http.Request) (uuid.UUID, time.Time, time.Time, error) {
	qs := r.URL.Query()
	pid, err := uuid.Parse(qs.Get("partner_id"))
	start, e1 := time.Parse("2006-01-02", qs.Get("period_start"))
	end, e2 := time.Parse("2006-01-02", qs.Get("period_end"))
	if err != nil || e1 != nil || e2 != nil || end.Before(start) {
		return uuid.Nil, time.Time{}, time.Time{}, httpx.Validation(map[string]string{"period_start": "INVALID_RANGE"})
	}
	return pid, start, end, nil
}

func (h *Handler) report(w http.ResponseWriter, r *http.Request) {
	pid, start, end, err := parsePeriod(r)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	lines, err := h.lines(r.Context(), dbq.New(h.pool), pid, start, end)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	var due, paid int64
	for _, l := range lines {
		if l.PayoutID == nil {
			due += l.PartnerAmount
		} else {
			paid += l.PartnerAmount
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]any{"lines": lines, "unpaid_total": due, "paid_total": paid})
}

func (h *Handler) listPayouts(w http.ResponseWriter, r *http.Request) {
	var pid *uuid.UUID
	if id, err := uuid.Parse(r.URL.Query().Get("partner_id")); err == nil {
		pid = &id
	}
	rows, err := dbq.New(h.pool).ListPayouts(r.Context(), pid)
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusOK, rows)
}

type payoutInput struct {
	PartnerID    uuid.UUID   `json:"partner_id"`
	PeriodStart  string      `json:"period_start"`
	PeriodEnd    string      `json:"period_end"`
	BookingIDs   []uuid.UUID `json:"booking_ids"`
	PaidOn       string      `json:"paid_on"`
	ProofMediaID *uuid.UUID  `json:"proof_media_id"`
	Notes        string      `json:"notes"`
}

// recordPayout pays out the selected unpaid settlement lines. payout_bookings.booking_id is
// unique, so a booking can never be paid out twice even under concurrent requests.
func (h *Handler) recordPayout(w http.ResponseWriter, r *http.Request) {
	var in payoutInput
	if err := httpx.Decode(w, r, &in); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	start, e1 := time.Parse("2006-01-02", in.PeriodStart)
	end, e2 := time.Parse("2006-01-02", in.PeriodEnd)
	paidOn, e3 := time.Parse("2006-01-02", in.PaidOn)
	if e1 != nil || e2 != nil || e3 != nil || end.Before(start) || len(in.BookingIDs) == 0 {
		httpx.WriteError(w, r, httpx.Validation(map[string]string{"period_start": "INVALID"}))
		return
	}
	actor := auth.FromContext(r.Context()).UserID
	var payout dbq.Payout
	err := db.InTx(r.Context(), h.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		lines, err := h.lines(r.Context(), q, in.PartnerID, start, end)
		if err != nil {
			return err
		}
		byPublic := map[uuid.UUID]Line{}
		for _, l := range lines {
			byPublic[l.BookingID] = l
		}
		var total int64
		selected := []Line{}
		for _, id := range in.BookingIDs {
			l, ok := byPublic[id]
			if !ok || l.PayoutID != nil {
				return httpx.Conflict("SETTLEMENT_LINE_UNAVAILABLE", "a selected booking is not payable in this period or is already paid")
			}
			total += l.PartnerAmount
			selected = append(selected, l)
		}
		if in.ProofMediaID != nil {
			if m, err := q.GetMedia(r.Context(), *in.ProofMediaID); err != nil || m.Bucket != "PRIVATE" {
				return httpx.Validation(map[string]string{"proof_media_id": "INVALID"})
			}
		}
		payout, err = q.InsertPayout(r.Context(), dbq.InsertPayoutParams{PartnerID: in.PartnerID, PeriodStart: start, PeriodEnd: end, Amount: total, PaidOn: paidOn,
			ProofMediaID: in.ProofMediaID, Notes: strings.TrimSpace(in.Notes), RecordedBy: &actor})
		if err != nil {
			return err
		}
		for _, l := range selected {
			if err := q.InsertPayoutBooking(r.Context(), dbq.InsertPayoutBookingParams{PayoutID: payout.ID, BookingID: l.internalID, PartnerAmount: l.PartnerAmount}); err != nil {
				if db.IsUniqueViolation(err) {
					return httpx.Conflict("SETTLEMENT_ALREADY_PAID", "a booking was already paid out")
				}
				return err
			}
		}
		return audit.Record(r.Context(), q, audit.Entry{ActorID: &actor, Action: "payout.recorded", EntityType: "payout", EntityID: payout.ID.String(),
			After: map[string]any{"partner_id": in.PartnerID, "amount": total, "bookings": len(selected)}})
	})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	httpx.JSON(w, http.StatusCreated, payout)
}
