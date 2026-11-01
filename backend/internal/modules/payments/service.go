package payments

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/integrations/midtrans"
	"goyacht/internal/modules/audit"
	"goyacht/internal/modules/bookings"
	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/pricing"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/jobs"
	"goyacht/internal/platform/secure"
)

var (
	ErrNothingToPay      = httpx.Conflict("PAYMENT_NOT_DUE", "there is nothing to pay for this booking")
	ErrPaymentInProgress = httpx.Conflict("PAYMENT_IN_PROGRESS", "a payment for this booking is already in progress")
	ErrHoldExpired       = httpx.NewError(http.StatusGone, "BOOKING_HOLD_EXPIRED", "the booking hold has expired, please book again")
	ErrOverpayment       = httpx.Unprocessable("PAYMENT_EXCEEDS_BALANCE", "amount exceeds the outstanding balance")
	ErrGateway           = httpx.NewError(http.StatusBadGateway, "PAYMENT_GATEWAY_ERROR", "payment provider is unavailable, please try again")
)

type Service struct {
	pool     *pgxpool.Pool
	gateway  midtrans.Gateway
	enqueue  jobs.Enqueuer
	appURL   string
	merchant string
	now      func() time.Time
}

func NewService(pool *pgxpool.Pool, gw midtrans.Gateway, enqueue jobs.Enqueuer, appURL, merchantID string) *Service {
	return &Service{pool: pool, gateway: gw, enqueue: enqueue, appURL: strings.TrimRight(appURL, "/"), merchant: merchantID, now: time.Now}
}

func (s *Service) Gateway() midtrans.Gateway { return s.gateway }

type CreateInput struct {
	Method string `json:"method"`
}

type PaymentDTO struct {
	ID              uuid.UUID       `json:"id"`
	Kind            string          `json:"kind"`
	Provider        string          `json:"provider"`
	Method          string          `json:"method"`
	OrderID         string          `json:"order_id"`
	PrincipalAmount int64           `json:"principal_amount"`
	FeeAmount       int64           `json:"fee_amount"`
	GrossAmount     int64           `json:"gross_amount"`
	Status          string          `json:"status"`
	SnapToken       string          `json:"snap_token,omitempty"`
	SnapRedirectURL string          `json:"snap_redirect_url,omitempty"`
	VANumbers       json.RawMessage `json:"va_numbers"`
	ExpiresAt       *time.Time      `json:"expires_at"`
	PaidAt          *time.Time      `json:"paid_at"`
	IsException     bool            `json:"is_exception"`
	CreatedAt       time.Time       `json:"created_at"`
}

func ToDTO(p dbq.Payment) PaymentDTO {
	d := PaymentDTO{ID: p.ID, Kind: p.Kind, Provider: p.Provider, Method: p.Method, OrderID: p.OrderID, PrincipalAmount: p.PrincipalAmount,
		FeeAmount: p.FeeAmount, GrossAmount: p.GrossAmount, Status: p.Status, VANumbers: p.VaNumbers, ExpiresAt: p.ExpiresAt,
		PaidAt: p.PaidAt, IsException: p.IsException, CreatedAt: p.CreatedAt}
	if p.Status == "PENDING" {
		d.SnapToken, d.SnapRedirectURL = p.SnapToken, p.SnapRedirectUrl
	}
	return d
}

func newOrderID(bookingNumber string) string {
	return "GY-" + bookingNumber + "-" + secure.RandomCode(6, secure.BookingAlphabet)
}

// CreateForCustomer starts a Snap payment for the next amount due: the first payment (full or
// deposit) while the booking is held, or the balance after a deposit. Snap never outlives the
// inventory hold or the balance deadline.
func (s *Service) CreateForCustomer(ctx context.Context, tx pgx.Tx, b dbq.Booking, in CreateInput) (dbq.Payment, error) {
	q := dbq.New(tx)
	b, err := q.LockBooking(ctx, b.ID)
	if err != nil {
		return dbq.Payment{}, err
	}
	now := s.now()
	if b.CreatedByAdmin != nil {
		return dbq.Payment{}, httpx.Conflict("MANUAL_PAYMENT_ONLY", "this booking is paid through the operator")
	}
	fee, err := q.GetPaymentMethodFee(ctx, in.Method)
	if err != nil || !fee.Enabled {
		return dbq.Payment{}, bookings.ErrMethodDisabled
	}
	var kind string
	var principal int64
	var expiry time.Time
	switch bookings.Status(b.Status) {
	case bookings.StatusPendingPayment:
		if b.HoldExpiresAt == nil || !b.HoldExpiresAt.After(now.Add(time.Minute)) {
			return dbq.Payment{}, ErrHoldExpired
		}
		kind, principal = "FULL", b.GrandTotal
		if b.PaymentScheme == "DEPOSIT" {
			kind, principal = "DEPOSIT", b.DepositAmount
		}
		expiry = *b.HoldExpiresAt
	case bookings.StatusConfirmed:
		if b.AmountPaid >= b.GrandTotal || b.BalanceDueAt == nil || !b.BalanceDueAt.After(now.Add(time.Minute)) {
			return dbq.Payment{}, ErrNothingToPay
		}
		kind, principal = "BALANCE", b.GrandTotal-b.AmountPaid
		expiry = now.Add(time.Duration(fee.HoldMinutes) * time.Minute)
		if expiry.After(*b.BalanceDueAt) {
			expiry = *b.BalanceDueAt
		}
	default:
		return dbq.Payment{}, ErrNothingToPay
	}
	if err := s.supersedePending(ctx, q, b.ID); err != nil {
		return dbq.Payment{}, err
	}
	feeAmount := pricing.FeeRule{Type: fee.FeeType, Value: fee.FeeValue}.For(principal)
	p, err := q.InsertPayment(ctx, dbq.InsertPaymentParams{BookingID: b.ID, Kind: kind, Provider: "MIDTRANS", Method: in.Method,
		OrderID: newOrderID(b.BookingNumber), PrincipalAmount: principal, FeeAmount: feeAmount, GrossAmount: principal + feeAmount,
		Status: "PENDING", ExpiresAt: &expiry})
	if err != nil {
		return dbq.Payment{}, err
	}
	snap := bookings.LoadSnapshot(b)
	items := []midtrans.Item{{ID: kind, Price: principal, Quantity: 1, Name: truncate(fmt.Sprintf("%s %s", catalog.Pick(snap.BoatName, b.Locale), b.BookingNumber), 50)}}
	if feeAmount > 0 {
		items = append(items, midtrans.Item{ID: "FEE", Price: feeAmount, Quantity: 1, Name: "Payment fee"})
	}
	minutes := int(expiry.Sub(now).Minutes())
	if minutes < 1 {
		minutes = 1
	}
	snapRes, err := s.gateway.CreateSnap(ctx, midtrans.SnapRequest{OrderID: p.OrderID, GrossAmount: p.GrossAmount, Items: items,
		Customer: midtrans.Customer{FirstName: truncate(b.LeadFullName, 50), Email: b.LeadEmail, Phone: b.LeadPhone},
		Method:   in.Method, ExpiryMinutes: minutes, FinishURL: s.statusURL(b)})
	if err != nil {
		slog.ErrorContext(ctx, "snap create", "error", err, "order_id", p.OrderID)
		return dbq.Payment{}, ErrGateway.Wrap(err)
	}
	return q.SetPaymentSnap(ctx, dbq.SetPaymentSnapParams{ID: p.ID, SnapToken: snapRes.Token, SnapRedirectUrl: snapRes.RedirectURL})
}

func (s *Service) statusURL(b dbq.Booking) string {
	prefix := ""
	if b.Locale != "en" {
		prefix = "/" + b.Locale
	}
	return s.appURL + prefix + "/orders/" + b.PublicID.String() + "/status"
}

// supersedePending cancels an unpaid earlier attempt so only one Snap order can be paid. If the
// provider reports the earlier order as already paid, the new attempt is refused.
func (s *Service) supersedePending(ctx context.Context, q *dbq.Queries, bookingID uuid.UUID) error {
	old, err := q.GetPendingPayment(ctx, bookingID)
	if db.IsNoRows(err) {
		return nil
	}
	if err != nil {
		return err
	}
	if old.Provider == "MIDTRANS" {
		if st, err := s.gateway.GetStatus(ctx, old.OrderID); err == nil {
			if m := midtrans.MapStatus(st.TransactionStatus, st.FraudStatus); m == midtrans.PaymentSucceeded {
				return ErrPaymentInProgress
			}
			if err := s.gateway.Cancel(ctx, old.OrderID); err != nil && !errors.Is(err, midtrans.ErrNotFound) {
				return ErrPaymentInProgress
			}
		} else if !errors.Is(err, midtrans.ErrNotFound) {
			return ErrPaymentInProgress
		}
	}
	_, err = q.CancelPendingPayments(ctx, bookingID)
	return err
}

func truncate(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n])
	}
	return s
}

type Notification struct {
	OrderID           string `json:"order_id"`
	StatusCode        string `json:"status_code"`
	GrossAmount       string `json:"gross_amount"`
	SignatureKey      string `json:"signature_key"`
	TransactionStatus string `json:"transaction_status"`
	FraudStatus       string `json:"fraud_status"`
	TransactionID     string `json:"transaction_id"`
}

var (
	ErrBadSignature = httpx.NewError(http.StatusUnauthorized, "WEBHOOK_SIGNATURE_INVALID", "invalid signature")
	ErrUnknownOrder = httpx.NotFound("WEBHOOK_ORDER_UNKNOWN")
)

// HandleNotification follows AGENTS.md section 7: verify the signature, ask the Status API for
// the truth, match it against our records, store the event, then apply the transition.
func (s *Service) HandleNotification(ctx context.Context, raw []byte) error {
	var n Notification
	if err := json.Unmarshal(raw, &n); err != nil || n.OrderID == "" {
		return httpx.BadRequest("WEBHOOK_INVALID", "malformed notification")
	}
	if !s.gateway.VerifySignature(n.OrderID, n.StatusCode, n.GrossAmount, n.SignatureKey) {
		s.recordRejected(ctx, n, "WEBHOOK", "invalid signature")
		return ErrBadSignature
	}
	if _, err := dbq.New(s.pool).GetPaymentByOrderID(ctx, n.OrderID); err != nil {
		if db.IsNoRows(err) {
			s.recordRejected(ctx, n, "WEBHOOK", "unknown order")
			return ErrUnknownOrder
		}
		return err
	}
	st, err := s.gateway.GetStatus(ctx, n.OrderID)
	if err != nil {
		return fmt.Errorf("status api: %w", err)
	}
	return s.Apply(ctx, st, "WEBHOOK")
}

func (s *Service) recordRejected(ctx context.Context, n Notification, source, reason string) {
	payload, _ := json.Marshal(map[string]string{"order_id": n.OrderID, "transaction_status": n.TransactionStatus, "status_code": n.StatusCode, "gross_amount": n.GrossAmount})
	_, err := dbq.New(s.pool).InsertPaymentEvent(ctx, dbq.InsertPaymentEventParams{OrderID: truncate(n.OrderID, 80),
		DedupeKey: "rejected:" + secure.HexSHA256(append(payload, []byte(reason+n.SignatureKey)...)), Source: source,
		TransactionStatus: truncate(n.TransactionStatus, 40), StatusCode: truncate(n.StatusCode, 10), GrossAmount: truncate(n.GrossAmount, 30),
		Verdict: "REJECTED", VerdictReason: reason, Payload: payload})
	if err != nil && !db.IsNoRows(err) {
		slog.ErrorContext(ctx, "record rejected payment event", "error", err)
	}
	slog.WarnContext(ctx, "payment notification rejected", "reason", reason, "order_id", n.OrderID)
}

func sanitizedPayload(st midtrans.Status) json.RawMessage {
	b, _ := json.Marshal(map[string]any{"order_id": st.OrderID, "transaction_id": st.TransactionID, "transaction_status": st.TransactionStatus,
		"fraud_status": st.FraudStatus, "status_code": st.StatusCode, "gross_amount": st.GrossAmount, "currency": st.Currency,
		"payment_type": st.PaymentType, "settlement_time": st.SettlementTime})
	return b
}

func vaNumbers(st midtrans.Status) json.RawMessage {
	list := []map[string]string{}
	for _, v := range st.VANumbers {
		list = append(list, map[string]string{"bank": v.Bank, "number": v.VANumber})
	}
	if st.PermataVANumber != "" {
		list = append(list, map[string]string{"bank": "permata", "number": st.PermataVANumber})
	}
	if st.BillKey != "" {
		list = append(list, map[string]string{"bank": "mandiri", "number": st.BillKey, "biller_code": st.BillerCode})
	}
	b, _ := json.Marshal(list)
	return b
}

// Apply records an authoritative provider status and moves payment and booking state forward in a
// single transaction. Duplicate and out-of-order deliveries converge on the same final state:
// the event is deduplicated, and a SUCCEEDED payment never moves again.
func (s *Service) Apply(ctx context.Context, st midtrans.Status, source string) error {
	return db.InTx(ctx, s.pool, func(tx pgx.Tx) error {
		q := dbq.New(tx)
		p, err := q.LockPaymentByOrderID(ctx, st.OrderID)
		if err != nil {
			if db.IsNoRows(err) {
				return ErrUnknownOrder
			}
			return err
		}
		mapped := midtrans.MapStatus(st.TransactionStatus, st.FraudStatus)
		verdict, reason := "APPLIED", ""
		amount, amountErr := midtrans.ParseAmount(st.GrossAmount)
		switch {
		case amountErr != nil || amount != p.GrossAmount:
			verdict, reason = "REJECTED", "amount mismatch"
		case st.Currency != "" && st.Currency != "IDR":
			verdict, reason = "REJECTED", "currency mismatch"
		case s.merchant != "" && st.MerchantID != "" && st.MerchantID != s.merchant:
			verdict, reason = "REJECTED", "merchant mismatch"
		case p.Status == "SUCCEEDED":
			verdict, reason = "IGNORED", "payment already succeeded"
		case p.Status != "PENDING" && mapped != midtrans.PaymentSucceeded:
			verdict, reason = "IGNORED", "payment already final"
		}
		dedupe := fmt.Sprintf("%s:%s:%s:%s", st.OrderID, st.TransactionStatus, st.FraudStatus, st.TransactionID)
		_, err = q.InsertPaymentEvent(ctx, dbq.InsertPaymentEventParams{PaymentID: &p.ID, OrderID: st.OrderID, DedupeKey: dedupe, Source: source,
			TransactionStatus: st.TransactionStatus, FraudStatus: st.FraudStatus, StatusCode: st.StatusCode, GrossAmount: st.GrossAmount,
			Verdict: verdict, VerdictReason: reason, Payload: sanitizedPayload(st)})
		if db.IsNoRows(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if verdict == "REJECTED" {
			if err := q.SetBookingException(ctx, dbq.SetBookingExceptionParams{ID: p.BookingID, ExceptionReason: strPtr("PAYMENT_" + strings.ToUpper(strings.ReplaceAll(reason, " ", "_")))}); err != nil {
				return err
			}
			slog.WarnContext(ctx, "payment status rejected", "order_id", st.OrderID, "reason", reason)
			return s.notifyAdmin(ctx, tx, "admin_exception", p.BookingID, "exception:"+p.ID.String()+":"+reason)
		}
		if verdict == "IGNORED" {
			return nil
		}
		var paidAt *time.Time
		if mapped == midtrans.PaymentSucceeded {
			now := s.now()
			paidAt = &now
		}
		lateSuccess := p.Status != "PENDING" && mapped == midtrans.PaymentSucceeded
		p, err = q.UpdatePaymentFromProvider(ctx, dbq.UpdatePaymentFromProviderParams{ID: p.ID, Status: string(mapped), ProviderStatus: st.TransactionStatus,
			ProviderFraud: st.FraudStatus, ProviderTxnID: st.TransactionID, ProviderPaymentType: st.PaymentType, VaNumbers: vaNumbers(st),
			PaidAt: paidAt, IsException: lateSuccess})
		if err != nil {
			return err
		}
		if mapped != midtrans.PaymentSucceeded {
			return nil
		}
		return s.applySuccess(ctx, tx, p, lateSuccess)
	})
}

func strPtr(s string) *string { return &s }

// applySuccess credits a succeeded payment to its booking. Money that arrives for an expired or
// cancelled booking, or for an attempt we had already superseded, is never used to reactivate
// anything: it is flagged for an admin to refund or restore manually.
func (s *Service) applySuccess(ctx context.Context, tx pgx.Tx, p dbq.Payment, late bool) error {
	q := dbq.New(tx)
	b, err := q.LockBooking(ctx, p.BookingID)
	if err != nil {
		return err
	}
	st := bookings.Status(b.Status)
	exception := func(reason string) error {
		if _, err := tx.Exec(ctx, `UPDATE payments SET is_exception = true, updated_at = now() WHERE id = $1`, p.ID); err != nil {
			return err
		}
		if err := q.SetBookingException(ctx, dbq.SetBookingExceptionParams{ID: b.ID, ExceptionReason: &reason}); err != nil {
			return err
		}
		return s.notifyAdmin(ctx, tx, "admin_exception", b.ID, "exception:"+p.ID.String())
	}
	if late {
		return exception("PAYMENT_AFTER_SUPERSEDED_ATTEMPT")
	}
	switch st {
	case bookings.StatusExpired, bookings.StatusCancelled:
		return exception("PAYMENT_AFTER_" + string(st))
	case bookings.StatusPendingPayment:
		if b.Mode == bookings.ModeCharter {
			n, err := q.CountBookingReservations(ctx, &b.ID)
			if err != nil {
				return err
			}
			if n == 0 {
				if _, err := q.SetBookingStatus(ctx, dbq.SetBookingStatusParams{ID: b.ID, Status: string(bookings.StatusExpired)}); err != nil {
					return err
				}
				if err := bookings.ReleaseHolds(ctx, q, b.ID); err != nil {
					return err
				}
				return exception("PAYMENT_AFTER_HOLD_RELEASED")
			}
			if _, err := q.ActivateBookingReservations(ctx, &b.ID); err != nil {
				return err
			}
		}
		if err := q.UsePromotionRedemptions(ctx, b.ID); err != nil {
			return err
		}
		return s.credit(ctx, tx, b, p, bookings.StatusConfirmed)
	case bookings.StatusConfirmed, bookings.StatusInProgress:
		if b.AmountPaid+p.PrincipalAmount > b.GrandTotal {
			return exception("PAYMENT_EXCEEDS_BALANCE")
		}
		return s.credit(ctx, tx, b, p, st)
	}
	return exception("PAYMENT_UNEXPECTED_STATE")
}

func (s *Service) credit(ctx context.Context, tx pgx.Tx, b dbq.Booking, p dbq.Payment, next bookings.Status) error {
	q := dbq.New(tx)
	if bookings.Status(b.Status) != next {
		if err := bookings.CheckTransition(bookings.Status(b.Status), next); err != nil {
			return err
		}
	}
	var invoice *string
	if b.InvoiceNumber == nil {
		year := s.now().Year()
		n, err := q.NextInvoiceNumber(ctx, int32(year))
		if err != nil {
			return err
		}
		v := fmt.Sprintf("INV/%d/%06d", year, n)
		invoice = &v
	}
	payStatus := bookings.DerivePaymentStatus(b.GrandTotal, b.AmountPaid+p.PrincipalAmount, b.AmountRefunded)
	updated, err := q.ApplyBookingPayment(ctx, dbq.ApplyBookingPaymentParams{ID: b.ID, Principal: p.PrincipalAmount, Fee: p.FeeAmount,
		PaymentStatus: string(payStatus), Status: string(next), InvoiceNumber: invoice})
	if err != nil {
		return err
	}
	bid := updated.ID
	notes := []jobs.Notify{
		{Template: "payment_succeeded", BookingID: &bid, DedupeKey: "payment_succeeded:" + p.ID.String(), Audience: jobs.AudienceCustomer},
		{Template: "admin_payment_received", BookingID: &bid, DedupeKey: "admin_payment_received:" + p.ID.String(), Audience: jobs.AudienceAdmin},
	}
	if bookings.Status(b.Status) == bookings.StatusPendingPayment {
		notes = append(notes, jobs.Notify{Template: "booking_confirmed", BookingID: &bid, DedupeKey: "booking_confirmed:" + b.ID.String(), Audience: jobs.AudienceCustomer})
	}
	for _, n := range notes {
		if err := s.enqueue.EnqueueTx(ctx, tx, n); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) notifyAdmin(ctx context.Context, tx pgx.Tx, template string, bookingID uuid.UUID, key string) error {
	return s.enqueue.EnqueueTx(ctx, tx, jobs.Notify{Template: template, BookingID: &bookingID, DedupeKey: template + ":" + key, Audience: jobs.AudienceAdmin})
}

// Reconcile asks Midtrans about payments still pending so a lost webhook never leaves a paid
// booking unconfirmed.
func (s *Service) Reconcile(ctx context.Context) error {
	rows, err := dbq.New(s.pool).ListStalePendingProviderPayments(ctx)
	if err != nil {
		return err
	}
	for _, p := range rows {
		st, err := s.gateway.GetStatus(ctx, p.OrderID)
		if errors.Is(err, midtrans.ErrNotFound) {
			if p.ExpiresAt != nil && s.now().After(p.ExpiresAt.Add(10*time.Minute)) {
				if _, err := s.pool.Exec(ctx, `UPDATE payments SET status = 'EXPIRED', updated_at = now() WHERE id = $1 AND status = 'PENDING'`, p.ID); err != nil {
					return err
				}
			}
			continue
		}
		if err != nil {
			slog.WarnContext(ctx, "reconcile status", "error", err, "order_id", p.OrderID)
			continue
		}
		if err := s.Apply(ctx, st, "RECONCILE"); err != nil {
			slog.ErrorContext(ctx, "reconcile apply", "error", err, "order_id", p.OrderID)
		}
	}
	return nil
}

type ManualInput struct {
	Method       string     `json:"method"`
	Amount       int64      `json:"amount"`
	PaidOn       string     `json:"paid_on"`
	ProofMediaID *uuid.UUID `json:"proof_media_id"`
	Notes        string     `json:"notes"`
}

// RecordManual books a bank transfer or cash payment entered by an admin. It can never exceed
// the outstanding balance and is written to the audit log.
func (s *Service) RecordManual(ctx context.Context, tx pgx.Tx, bookingID uuid.UUID, in ManualInput, actor uuid.UUID) (dbq.Payment, error) {
	q := dbq.New(tx)
	f := httpx.FieldErrors{}
	if in.Method != "BANK_TRANSFER" && in.Method != "CASH" {
		f.Add("method", "INVALID")
	}
	paidOn, err := time.Parse("2006-01-02", in.PaidOn)
	if err != nil || paidOn.After(s.now().Add(24*time.Hour)) {
		f.Add("paid_on", "INVALID_DATE")
	}
	if in.Amount <= 0 {
		f.Add("amount", "OUT_OF_RANGE")
	}
	if len(in.Notes) > 1000 {
		f.Add("notes", "TOO_LONG")
	}
	if err := f.Err(); err != nil {
		return dbq.Payment{}, err
	}
	b, err := q.LockBooking(ctx, bookingID)
	if err != nil {
		return dbq.Payment{}, bookings.ErrBookingNotFound
	}
	st := bookings.Status(b.Status)
	if st != bookings.StatusPendingPayment && st != bookings.StatusConfirmed && st != bookings.StatusInProgress {
		return dbq.Payment{}, ErrNothingToPay
	}
	outstanding := b.GrandTotal - b.AmountPaid
	if in.Amount > outstanding {
		return dbq.Payment{}, ErrOverpayment
	}
	if in.ProofMediaID != nil {
		m, err := q.GetMedia(ctx, *in.ProofMediaID)
		if err != nil || m.Bucket != "PRIVATE" {
			return dbq.Payment{}, httpx.Validation(map[string]string{"proof_media_id": "INVALID"})
		}
	}
	kind := "BALANCE"
	if b.AmountPaid == 0 {
		kind = "FULL"
		if in.Amount < b.GrandTotal {
			kind = "DEPOSIT"
		}
	}
	if st == bookings.StatusPendingPayment {
		if err := s.supersedePending(ctx, q, b.ID); err != nil {
			return dbq.Payment{}, err
		}
		if b.Mode == bookings.ModeCharter {
			n, err := q.CountBookingReservations(ctx, &b.ID)
			if err != nil {
				return dbq.Payment{}, err
			}
			if n == 0 {
				return dbq.Payment{}, ErrHoldExpired
			}
			if _, err := q.ActivateBookingReservations(ctx, &b.ID); err != nil {
				return dbq.Payment{}, err
			}
		}
		if err := q.UsePromotionRedemptions(ctx, b.ID); err != nil {
			return dbq.Payment{}, err
		}
	}
	now := s.now()
	p, err := q.InsertPayment(ctx, dbq.InsertPaymentParams{BookingID: b.ID, Kind: kind, Provider: "MANUAL", Method: in.Method,
		OrderID: newOrderID(b.BookingNumber), PrincipalAmount: in.Amount, GrossAmount: in.Amount, Status: "SUCCEEDED", PaidAt: &now,
		ManualPaidOn: &paidOn, ProofMediaID: in.ProofMediaID, RecordedBy: &actor, Notes: strings.TrimSpace(in.Notes)})
	if err != nil {
		return dbq.Payment{}, err
	}
	next := st
	if st == bookings.StatusPendingPayment {
		next = bookings.StatusConfirmed
	}
	if err := s.credit(ctx, tx, b, p, next); err != nil {
		return dbq.Payment{}, err
	}
	return p, audit.Record(ctx, q, audit.Entry{ActorID: &actor, Action: "payment.manual_recorded", EntityType: "booking", EntityID: b.ID.String(),
		After: map[string]any{"payment_id": p.ID, "method": in.Method, "amount": in.Amount, "paid_on": in.PaidOn}})
}
