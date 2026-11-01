package refunds

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	"goyacht/internal/integrations/midtrans"
	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/pricing"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/jobs"
)

var (
	ErrRefundNotFound = httpx.NotFound("REFUND_NOT_FOUND")
	ErrRefundState    = httpx.Conflict("REFUND_INVALID_TRANSITION", "refund cannot move to that status")
)

type RefundStatus string

const (
	RefundRequested  RefundStatus = "REQUESTED"
	RefundApproved   RefundStatus = "APPROVED"
	RefundProcessing RefundStatus = "PROCESSING"
	RefundCompleted  RefundStatus = "COMPLETED"
	RefundRejected   RefundStatus = "REJECTED"
)

var refundTransitions = map[RefundStatus][]RefundStatus{
	RefundRequested:  {RefundApproved, RefundRejected},
	RefundApproved:   {RefundProcessing, RefundCompleted, RefundRejected},
	RefundProcessing: {RefundCompleted, RefundApproved},
}

func canMove(from, to RefundStatus) bool {
	for _, s := range refundTransitions[from] {
		if s == to {
			return true
		}
	}
	return false
}

type Service struct {
	pool    *pgxpool.Pool
	gateway midtrans.Gateway
	enqueue jobs.Enqueuer
	now     func() time.Time
}

func NewService(pool *pgxpool.Pool, gw midtrans.Gateway, enqueue jobs.Enqueuer) *Service {
	return &Service{pool: pool, gateway: gw, enqueue: enqueue, now: time.Now}
}

type cancellationSnapshot struct {
	Tiers []pricing.Tier `json:"tiers"`
}

// RefundDue implements PRD 10.1–10.2. Operator-side cancellations return everything paid,
// including payment method fees (agreed decision). Customer cancellations follow the policy
// snapshot on the principal only. An overdue balance forfeits the deposit.
func RefundDue(b dbq.Booking, cancelType string, now time.Time) (principal, fees int64) {
	switch cancelType {
	case bookings.CancelOperator, bookings.CancelDepartureCancelled:
		return b.AmountPaid, b.FeesPaid
	case bookings.CancelCustomer:
		var cp cancellationSnapshot
		snap := bookings.LoadSnapshot(b)
		_ = json.Unmarshal(snap.CancellationPolicy, &cp)
		days := int(b.StartsAt.Sub(now).Hours() / 24)
		if days < 0 {
			days = 0
		}
		amt, _ := pricing.RefundAmount(b.AmountPaid, cp.Tiers, days)
		return amt, 0
	}
	return 0, 0
}

// Cancel cancels a booking inside the caller's transaction, releases inventory, revokes the
// ticket token and creates the refund ledger rows. It satisfies departures.Canceller.
func (s *Service) Cancel(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, cancelType, reason string, actor *uuid.UUID) error {
	q := dbq.New(tx)
	b, err := q.LockBooking(ctx, bookingID)
	if err != nil {
		return bookings.ErrBookingNotFound
	}
	st := bookings.Status(b.Status)
	if err := bookings.CheckTransition(st, bookings.StatusCancelled); err != nil {
		return err
	}
	now := s.now()
	principal, fees := int64(0), int64(0)
	if st == bookings.StatusConfirmed {
		principal, fees = RefundDue(b, cancelType, now)
	}
	forfeited := b.AmountPaid - principal
	if forfeited < 0 {
		forfeited = 0
	}
	updated, err := q.CancelBookingRow(ctx, dbq.CancelBookingRowParams{ID: b.ID, CancelType: &cancelType, CancelReason: reason, ForfeitedAmount: forfeited})
	if err != nil {
		return err
	}
	if err := bookings.ReleaseHolds(ctx, q, b.ID); err != nil {
		return err
	}
	if _, err := q.CancelPendingPayments(ctx, b.ID); err != nil {
		return err
	}
	if principal+fees > 0 {
		reasonType := "CUSTOMER"
		if cancelType == bookings.CancelOperator {
			reasonType = "OPERATOR"
		} else if cancelType == bookings.CancelDepartureCancelled {
			reasonType = "DEPARTURE_CANCELLED"
		}
		if err := s.createRefunds(ctx, tx, updated, principal, fees, reasonType, actor); err != nil {
			return err
		}
	}
	bid := b.ID
	if err := s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: "booking_cancelled", BookingID: &bid, DedupeKey: "booking_cancelled:" + b.ID.String(), Audience: jobs.AudienceCustomer}); err != nil {
		return err
	}
	return audit.Record(ctx, q, audit.Entry{ActorID: actor, Action: "booking.cancelled", EntityType: "booking", EntityID: b.ID.String(),
		Before: map[string]any{"status": b.Status}, After: map[string]any{"status": "CANCELLED", "cancel_type": cancelType, "refund_principal": principal, "refund_fees": fees, "forfeited": forfeited}})
}

// createRefunds spreads the refund over the booking's succeeded payments, newest first, so each
// ledger row points at the payment it returns money from. Card payments go back through
// Midtrans; everything else is a manual transfer that needs proof.
func (s *Service) createRefunds(ctx context.Context, tx pgx.Tx, b dbq.Booking, principal, fees int64, reasonType string, actor *uuid.UUID) error {
	q := dbq.New(tx)
	pays, err := q.ListBookingPayments(ctx, b.ID)
	if err != nil {
		return err
	}
	sort.Slice(pays, func(i, j int) bool { return pays[i].CreatedAt.After(pays[j].CreatedAt) })
	remainingPrincipal, remainingFees := principal, fees
	for _, p := range pays {
		if p.Status != "SUCCEEDED" || p.IsException || remainingPrincipal+remainingFees <= 0 {
			continue
		}
		pp := min(p.PrincipalAmount, remainingPrincipal)
		pf := min(p.FeeAmount, remainingFees)
		if pp+pf <= 0 {
			continue
		}
		remainingPrincipal -= pp
		remainingFees -= pf
		channel := "MANUAL"
		if p.Provider == "MIDTRANS" && midtrans.SupportsProviderRefund(p.Method) {
			channel = "PROVIDER"
		}
		pid := p.ID
		rf, err := q.InsertRefund(ctx, dbq.InsertRefundParams{BookingID: b.ID, PaymentID: &pid, ReasonType: reasonType, Amount: pp + pf,
			IncludesFeeAmount: pf, Channel: channel, Status: string(RefundApproved), RequestedBy: actor, ApprovedBy: actor})
		if err != nil {
			return err
		}
		if channel == "PROVIDER" {
			if err := s.enqueue.EnqueueTx(ctx, tx, jobs.RefundProvider{RefundID: rf.ID}); err != nil {
				return err
			}
		}
		rid := rf.ID
		if err := s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: "refund", BookingID: &b.ID, RefundID: &rid, DedupeKey: "refund:" + rf.ID.String() + ":APPROVED", Audience: jobs.AudienceCustomer}); err != nil {
			return err
		}
	}
	if remainingPrincipal+remainingFees > 0 {
		return fmt.Errorf("refund allocation left %d unassigned", remainingPrincipal+remainingFees)
	}
	return nil
}

// RefundException creates a refund for money received on a booking that could not use it.
func (s *Service) RefundException(ctx context.Context, tx pgx.Tx, paymentID uuid.UUID, actor uuid.UUID) error {
	q := dbq.New(tx)
	p, err := q.GetPayment(ctx, paymentID)
	if err != nil || !p.IsException || p.Status != "SUCCEEDED" {
		return httpx.NotFound("PAYMENT_NOT_FOUND")
	}
	open, err := q.ListBookingRefunds(ctx, p.BookingID)
	if err != nil {
		return err
	}
	for _, r := range open {
		if r.PaymentID != nil && *r.PaymentID == p.ID && r.Status != string(RefundRejected) {
			return httpx.Conflict("REFUND_EXISTS", "a refund for this payment already exists")
		}
	}
	channel := "MANUAL"
	if p.Provider == "MIDTRANS" && midtrans.SupportsProviderRefund(p.Method) {
		channel = "PROVIDER"
	}
	rf, err := q.InsertRefund(ctx, dbq.InsertRefundParams{BookingID: p.BookingID, PaymentID: &p.ID, ReasonType: "EXCEPTION", Amount: p.GrossAmount,
		IncludesFeeAmount: p.FeeAmount, Channel: channel, Status: string(RefundApproved), RequestedBy: &actor, ApprovedBy: &actor})
	if err != nil {
		return err
	}
	if channel == "PROVIDER" {
		if err := s.enqueue.EnqueueTx(ctx, tx, jobs.RefundProvider{RefundID: rf.ID}); err != nil {
			return err
		}
	}
	if err := q.ClearBookingException(ctx, p.BookingID); err != nil {
		return err
	}
	return audit.Record(ctx, q, audit.Entry{ActorID: &actor, Action: "refund.exception_created", EntityType: "refund", EntityID: rf.ID.String(), After: map[string]any{"payment_id": p.ID, "amount": p.GrossAmount}})
}

type TransitionInput struct {
	Status       string     `json:"status"`
	ProofMediaID *uuid.UUID `json:"proof_media_id"`
	Notes        string     `json:"notes"`
}

// Transition moves a refund forward. COMPLETED for a manual refund requires transfer proof;
// provider refunds are completed only by the provider job.
func (s *Service) Transition(ctx context.Context, refundID uuid.UUID, in TransitionInput, actor uuid.UUID) (dbq.Refund, error) {
	var out dbq.Refund
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rf, err := q.LockRefund(ctx, refundID)
		if err != nil {
			return ErrRefundNotFound
		}
		to := RefundStatus(in.Status)
		if !canMove(RefundStatus(rf.Status), to) {
			return ErrRefundState
		}
		if to == RefundCompleted {
			if rf.Channel == "PROVIDER" {
				return httpx.Conflict("REFUND_PROVIDER_MANAGED", "provider refunds complete automatically")
			}
			if in.ProofMediaID == nil && rf.ProofMediaID == nil {
				return httpx.Validation(map[string]string{"proof_media_id": "REQUIRED"})
			}
			if in.ProofMediaID != nil {
				m, err := q.GetMedia(ctx, *in.ProofMediaID)
				if err != nil || m.Bucket != "PRIVATE" {
					return httpx.Validation(map[string]string{"proof_media_id": "INVALID"})
				}
			}
		}
		out, err = q.UpdateRefundStatus(ctx, dbq.UpdateRefundStatusParams{ID: rf.ID, Status: string(to), ProofMediaID: in.ProofMediaID, ApprovedBy: &actor, Notes: strings.TrimSpace(in.Notes)})
		if err != nil {
			return err
		}
		if to == RefundApproved && rf.Channel == "PROVIDER" {
			if err := s.enqueue.EnqueueTx(ctx, tx, jobs.RefundProvider{RefundID: rf.ID}); err != nil {
				return err
			}
		}
		if err := s.afterChange(ctx, tx, out); err != nil {
			return err
		}
		return audit.Record(ctx, q, audit.Entry{ActorID: &actor, Action: "refund." + strings.ToLower(in.Status), EntityType: "refund", EntityID: rf.ID.String(),
			Before: map[string]string{"status": rf.Status}, After: map[string]any{"status": in.Status, "proof_media_id": in.ProofMediaID}})
	})
	return out, err
}

// afterChange keeps the booking's refunded total and payment status in step with the ledger.
func (s *Service) afterChange(ctx context.Context, tx pgx.Tx, rf dbq.Refund) error {
	q := dbq.New(tx)
	b, err := q.LockBooking(ctx, rf.BookingID)
	if err != nil {
		return err
	}
	total, err := q.SumCompletedRefunds(ctx, b.ID)
	if err != nil {
		return err
	}
	ps := bookings.DerivePaymentStatus(b.GrandTotal, b.AmountPaid, total)
	if _, err := q.SetBookingRefunded(ctx, dbq.SetBookingRefundedParams{ID: b.ID, AmountRefunded: total, PaymentStatus: string(ps)}); err != nil {
		return err
	}
	if RefundStatus(rf.Status) == RefundCompleted || RefundStatus(rf.Status) == RefundRejected {
		rid := rf.ID
		return s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: "refund", BookingID: &b.ID, RefundID: &rid, DedupeKey: "refund:" + rf.ID.String() + ":" + rf.Status, Audience: jobs.AudienceCustomer})
	}
	return nil
}

// ProcessProvider issues a Midtrans refund. The refund key is the refund ID, so a retried job
// cannot refund twice: Midtrans rejects a repeated key.
func (s *Service) ProcessProvider(ctx context.Context, refundID uuid.UUID) error {
	var orderID string
	var amount int64
	err := db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rf, err := q.LockRefund(ctx, refundID)
		if err != nil {
			return river.JobCancel(err)
		}
		if rf.Channel != "PROVIDER" || (rf.Status != string(RefundApproved) && rf.Status != string(RefundProcessing)) {
			return river.JobCancel(fmt.Errorf("refund %s not eligible", refundID))
		}
		p, err := q.GetPayment(ctx, *rf.PaymentID)
		if err != nil {
			return err
		}
		orderID, amount = p.OrderID, rf.Amount
		key := rf.ID.String()
		_, err = q.UpdateRefundStatus(ctx, dbq.UpdateRefundStatusParams{ID: rf.ID, Status: string(RefundProcessing), ProviderRefundKey: &key})
		return err
	})
	if err != nil {
		return err
	}
	if err := s.gateway.Refund(ctx, orderID, refundID.String(), amount, "Booking cancellation"); err != nil {
		slog.WarnContext(ctx, "provider refund failed", "error", err, "refund_id", refundID)
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rf, err := q.UpdateRefundStatus(ctx, dbq.UpdateRefundStatusParams{ID: refundID, Status: string(RefundCompleted)})
		if err != nil {
			return err
		}
		return s.afterChange(ctx, tx, rf)
	})
}

type BankInput struct {
	BankName          string `json:"bank_name"`
	BankAccountName   string `json:"bank_account_name"`
	BankAccountNumber string `json:"bank_account_number"`
}

// SetBankDetails lets the booking owner supply the destination account for a manual refund.
func (s *Service) SetBankDetails(ctx context.Context, userID, refundID uuid.UUID, in BankInput) error {
	f := httpx.FieldErrors{}
	if l := len(strings.TrimSpace(in.BankName)); l < 2 || l > 80 {
		f.Add("bank_name", "INVALID_LENGTH")
	}
	if l := len(strings.TrimSpace(in.BankAccountName)); l < 2 || l > 120 {
		f.Add("bank_account_name", "INVALID_LENGTH")
	}
	if l := len(strings.TrimSpace(in.BankAccountNumber)); l < 5 || l > 40 {
		f.Add("bank_account_number", "INVALID_LENGTH")
	}
	if err := f.Err(); err != nil {
		return err
	}
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		rf, err := q.GetRefund(ctx, refundID)
		if err != nil {
			return ErrRefundNotFound
		}
		b, err := q.GetBooking(ctx, rf.BookingID)
		if err != nil || b.UserID != userID {
			return ErrRefundNotFound
		}
		if _, err := q.SetRefundBankDetails(ctx, dbq.SetRefundBankDetailsParams{ID: refundID, BankName: strings.TrimSpace(in.BankName),
			BankAccountName: strings.TrimSpace(in.BankAccountName), BankAccountNumber: strings.TrimSpace(in.BankAccountNumber)}); err != nil {
			if db.IsNoRows(err) {
				return httpx.Conflict("REFUND_NOT_EDITABLE", "bank details can no longer be changed")
			}
			return err
		}
		return nil
	})
}
