package scenarios

import (
	"context"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/integrations/midtrans"
	"goyacht/internal/testutil"
)

type paymentResp struct {
	ID          uuid.UUID `json:"id"`
	OrderID     string    `json:"order_id"`
	GrossAmount int64     `json:"gross_amount"`
	Status      string    `json:"status"`
}

func book(t *testing.T, c *testutil.Client, body map[string]any) bookingResp {
	t.Helper()
	r := c.PostIdem(t, "/api/v1/bookings", body, key())
	if r.Status != http.StatusCreated {
		t.Fatalf("booking: %d %s", r.Status, r.Body)
	}
	var b bookingResp
	r.Data(t, &b)
	return b
}

func startPayment(t *testing.T, c *testutil.Client, bookingID uuid.UUID, method string) paymentResp {
	t.Helper()
	r := c.PostIdem(t, "/api/v1/bookings/"+bookingID.String()+"/payments", map[string]string{"method": method}, key())
	if r.Status != http.StatusCreated {
		t.Fatalf("payment: %d %s", r.Status, r.Body)
	}
	var p paymentResp
	r.Data(t, &p)
	return p
}

func notification(env *testutil.Env, orderID, status string, gross int64, valid bool) map[string]string {
	amount := fmt.Sprintf("%d.00", gross)
	sig := midtrans.Signature(env.Gateway.ServerKey, orderID, "200", amount)
	if !valid {
		sig = midtrans.Signature("wrong-key", orderID, "200", amount)
	}
	return map[string]string{"order_id": orderID, "status_code": "200", "gross_amount": amount, "signature_key": sig, "transaction_status": status}
}

func settle(env *testutil.Env, p paymentResp, status string, gross int64) {
	env.Gateway.SetStatus(midtrans.Status{OrderID: p.OrderID, TransactionID: "trx-" + p.OrderID, TransactionStatus: status, FraudStatus: "accept",
		StatusCode: "200", GrossAmount: fmt.Sprintf("%d.00", gross), Currency: "IDR", PaymentType: "credit_card"})
}

func bookingState(t *testing.T, env *testutil.Env, id uuid.UUID) (status, payStatus string, paid int64, exception *string) {
	t.Helper()
	if err := env.Pool.QueryRow(context.Background(), `SELECT status, payment_status, amount_paid, exception_reason FROM bookings WHERE public_id = $1`, id).
		Scan(&status, &payStatus, &paid, &exception); err != nil {
		t.Fatal(err)
	}
	return
}

func countJobs(t *testing.T, env *testutil.Env, template string) int {
	t.Helper()
	var n int
	_ = env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = 'notify' AND args->>'template' = $1`, template).Scan(&n)
	return n
}

// Scenario 8: a webhook with a wrong signature is rejected and changes nothing.
func TestScenario08BadSignature(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount)
	r := env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, false))
	if r.Status != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d %s", r.Status, r.Body)
	}
	if st, _, _, _ := bookingState(t, env, b.ID); st != "PENDING_PAYMENT" {
		t.Fatalf("status changed to %s", st)
	}
}

// Scenario 9: the same valid webhook three times in parallel causes one transition and one email.
func TestScenario09DuplicateWebhooks(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount)
	var wg sync.WaitGroup
	codes := make([]int, 3)
	for i := range codes {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			codes[i] = env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true)).Status
		}(i)
	}
	wg.Wait()
	for _, c := range codes {
		if c != http.StatusOK {
			t.Fatalf("webhook status %v", codes)
		}
	}
	st, ps, paid, _ := bookingState(t, env, b.ID)
	if st != "CONFIRMED" || ps != "PAID" || paid != b.GrandTotal {
		t.Fatalf("unexpected state %s %s %d", st, ps, paid)
	}
	if n := countJobs(t, env, "booking_confirmed"); n != 1 {
		t.Fatalf("expected one confirmation email job, got %d", n)
	}
	var events int
	_ = env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM payment_events WHERE verdict = 'APPLIED'`).Scan(&events)
	if events != 1 {
		t.Fatalf("expected one applied event, got %d", events)
	}
}

// Scenario 10: a settled amount that differs from our record never confirms the booking.
func TestScenario10AmountMismatch(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount-1000)
	env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount-1000, true))
	st, _, paid, exc := bookingState(t, env, b.ID)
	if st != "PENDING_PAYMENT" || paid != 0 || exc == nil {
		t.Fatalf("mismatch must not confirm and must flag an exception: %s %d %v", st, paid, exc)
	}
}

// Scenario 11: settlement delivered before pending still ends SUCCEEDED.
func TestScenario11OutOfOrder(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "BCA_VA")
	ctx := context.Background()
	settle(env, p, "settlement", p.GrossAmount)
	if err := env.Services.Payments.Apply(ctx, env.Gateway.Statuses[p.OrderID], "WEBHOOK"); err != nil {
		t.Fatal(err)
	}
	late := env.Gateway.Statuses[p.OrderID]
	late.TransactionStatus = "pending"
	if err := env.Services.Payments.Apply(ctx, late, "WEBHOOK"); err != nil {
		t.Fatal(err)
	}
	var pst string
	_ = env.Pool.QueryRow(ctx, `SELECT status FROM payments WHERE order_id = $1`, p.OrderID).Scan(&pst)
	if pst != "SUCCEEDED" {
		t.Fatalf("payment moved backwards to %s", pst)
	}
	if st, _, _, _ := bookingState(t, env, b.ID); st != "CONFIRMED" {
		t.Fatalf("booking %s", st)
	}
}

// Scenario 12: money arriving for an EXPIRED or CANCELLED booking is recorded but never
// reactivates it; the booking lands in the exception queue.
func TestScenario12PaymentAfterExpiry(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "BCA_VA")
	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `UPDATE bookings SET hold_expires_at = now() - interval '1 minute'; UPDATE area_reservations SET expires_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if err := env.Services.Scheduler.ExpireHolds(ctx); err != nil {
		t.Fatal(err)
	}
	settle(env, p, "settlement", p.GrossAmount)
	if r := env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true)); r.Status != http.StatusOK {
		t.Fatalf("webhook: %d %s", r.Status, r.Body)
	}
	st, _, paid, exc := bookingState(t, env, b.ID)
	if st != "EXPIRED" || paid != 0 || exc == nil {
		t.Fatalf("expired booking reactivated or not flagged: %s %d %v", st, paid, exc)
	}
	var pst string
	var isExc bool
	_ = env.Pool.QueryRow(ctx, `SELECT status, is_exception FROM payments WHERE order_id = $1`, p.OrderID).Scan(&pst, &isExc)
	if pst != "SUCCEEDED" || !isExc {
		t.Fatalf("payment should be recorded as SUCCEEDED exception, got %s %v", pst, isExc)
	}
}

// Scenario 17: an overdue balance cancels the booking, forfeits the deposit and emails once.
func TestScenario17BalanceOverdue(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{DepositPercent: 30, BalanceDueDays: 7})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	body := testutil.CharterBooking(f, testutil.LocalDate(20), "09:00", 2, 2)
	body["payment_scheme"] = "DEPOSIT"
	b := book(t, c, body)
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount)
	env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true))
	if _, ps, paid, _ := bookingState(t, env, b.ID); ps != "DEPOSIT_PAID" || paid != b.GrandTotal*30/100 {
		t.Fatalf("deposit not applied: %s %d", ps, paid)
	}
	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `UPDATE bookings SET balance_due_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 2; i++ {
		if err := env.Services.Scheduler.CancelOverdueBalances(ctx); err != nil {
			t.Fatal(err)
		}
	}
	var st string
	var forfeited, paid int64
	_ = env.Pool.QueryRow(ctx, `SELECT status, forfeited_amount, amount_paid FROM bookings WHERE public_id = $1`, b.ID).Scan(&st, &forfeited, &paid)
	if st != "CANCELLED" || forfeited != paid {
		t.Fatalf("expected CANCELLED with forfeited deposit, got %s forfeited=%d paid=%d", st, forfeited, paid)
	}
	var refunds int
	_ = env.Pool.QueryRow(ctx, `SELECT count(*) FROM refunds`).Scan(&refunds)
	if refunds != 0 {
		t.Fatalf("forfeited deposit must not be refunded, got %d refunds", refunds)
	}
	if n := countJobs(t, env, "booking_cancelled"); n != 1 {
		t.Fatalf("expected one cancellation email, got %d", n)
	}
}

// Scenario 18: cancelling a departure cancels every booking and refunds 100% of what was paid.
func TestScenario18DepartureCancelled(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	depID, slots := createDeparture(t, env, admin, f, testutil.LocalDate(9), []map[string]any{
		{"slot_type": "SEAT_POOL", "area_ids": f.AreaIDs, "price": 400000, "seat_capacity": 10, "min_pax": 1, "max_pax": 5},
	})
	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `UPDATE payment_method_fees SET fee_value = 2500 WHERE method = 'CREDIT_CARD'`); err != nil {
		t.Fatal(err)
	}
	var paidTotal int64
	for i := 0; i < 2; i++ {
		c, _ := env.Login(t, fmt.Sprintf("d%d@test.dev", i), "CUSTOMER")
		b := book(t, c, departureBooking(slots[0], 2))
		p := startPayment(t, c, b.ID, "CREDIT_CARD")
		settle(env, p, "settlement", p.GrossAmount)
		env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true))
		paidTotal += p.GrossAmount
	}
	pending, _ := env.Login(t, "pending@test.dev", "CUSTOMER")
	book(t, pending, departureBooking(slots[0], 1))
	if r := admin.Post(t, "/api/v1/admin/departures/"+depID.String()+"/cancel", map[string]string{"reason": "bad weather"}); r.Status != http.StatusNoContent {
		t.Fatalf("cancel departure: %d %s", r.Status, r.Body)
	}
	var active int
	_ = env.Pool.QueryRow(ctx, `SELECT count(*) FROM bookings WHERE departure_id = $1 AND status <> 'CANCELLED'`, depID).Scan(&active)
	if active != 0 {
		t.Fatalf("%d bookings still active", active)
	}
	var refunded int64
	_ = env.Pool.QueryRow(ctx, `SELECT COALESCE(sum(amount),0) FROM refunds WHERE reason_type = 'DEPARTURE_CANCELLED'`).Scan(&refunded)
	if refunded != paidTotal {
		t.Fatalf("expected full refund including fees %d, got %d", paidTotal, refunded)
	}
	var reservations int
	_ = env.Pool.QueryRow(ctx, `SELECT count(*) FROM area_reservations WHERE departure_id = $1`, depID).Scan(&reservations)
	if reservations != 0 {
		t.Fatalf("departure inventory not released")
	}
}

// Scenario 19: an admin cannot record a manual payment above the outstanding balance.
func TestScenario19ManualOverpayment(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	today := time.Now().Format("2006-01-02")
	r := admin.PostIdem(t, "/api/v1/admin/bookings/"+b.ID.String()+"/payments", map[string]any{"method": "BANK_TRANSFER", "amount": b.GrandTotal + 1, "paid_on": today}, key())
	if r.Status != http.StatusUnprocessableEntity || r.ErrorCode(t) != "PAYMENT_EXCEEDS_BALANCE" {
		t.Fatalf("expected PAYMENT_EXCEEDS_BALANCE, got %d %s", r.Status, r.Body)
	}
	r = admin.PostIdem(t, "/api/v1/admin/bookings/"+b.ID.String()+"/payments", map[string]any{"method": "BANK_TRANSFER", "amount": b.GrandTotal, "paid_on": today}, key())
	if r.Status != http.StatusCreated {
		t.Fatalf("exact balance should be accepted: %d %s", r.Status, r.Body)
	}
	if st, ps, _, _ := bookingState(t, env, b.ID); st != "CONFIRMED" || ps != "PAID" {
		t.Fatalf("manual payment did not confirm: %s %s", st, ps)
	}
	var audits int
	_ = env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM audit_logs WHERE action = 'payment.manual_recorded'`).Scan(&audits)
	if audits != 1 {
		t.Fatalf("manual payment not audited")
	}
}

// Scenario 26: scanning the QR of a cancelled booking shows it as cancelled.
func TestScenario26CancelledQR(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount)
	env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true))
	var token string
	_ = env.Pool.QueryRow(context.Background(), `SELECT verify_token FROM bookings WHERE public_id = $1`, b.ID).Scan(&token)
	var v struct {
		Valid    bool   `json:"valid"`
		Status   string `json:"status"`
		LeadName string `json:"lead_name"`
	}
	env.Anonymous().Get(t, "/api/v1/verify/"+token).Data(t, &v)
	if !v.Valid || v.LeadName != "J*** S****" {
		t.Fatalf("paid booking should verify with a masked name: %+v", v)
	}
	if r := admin.Post(t, "/api/v1/admin/bookings/"+b.ID.String()+"/cancel", map[string]string{"cancel_type": "OPERATOR", "reason": "engine failure"}); r.Status != http.StatusNoContent {
		t.Fatalf("cancel: %d %s", r.Status, r.Body)
	}
	env.Anonymous().Get(t, "/api/v1/verify/"+token).Data(t, &v)
	if v.Valid || v.Status != "CANCELLED" {
		t.Fatalf("cancelled booking must show CANCELLED: %+v", v)
	}
}
