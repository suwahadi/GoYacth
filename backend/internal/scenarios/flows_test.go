package scenarios

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/testutil"
)

func mustBe(t *testing.T, what string, r testutil.Response, want int) {
	t.Helper()
	if r.Status != want {
		t.Fatalf("%s: got %d, want %d: %s", what, r.Status, want, r.Body)
	}
}

// bookedAndPaid returns a confirmed charter owned by a logged-in customer.
func bookedAndPaid(t *testing.T, env *testutil.Env, f testutil.Fixture) (customer, admin *testutil.Client, b bookingResp) {
	t.Helper()
	customer, _ = env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ = env.Login(t, "admin@test.dev", "ADMIN")
	b = book(t, customer, testutil.CharterBooking(f, testutil.LocalDate(20), "09:00", 2, 2))
	payInFull(t, admin, b)
	return customer, admin, b
}

func TestCustomerCancelRequestApprovedByAdmin(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	customer, admin, b := bookedAndPaid(t, env, f)

	r := customer.Post(t, "/api/v1/bookings/"+b.ID.String()+"/cancel-request", map[string]string{"message": "Our flight moved"})
	mustBe(t, "cancel request", r, http.StatusCreated)
	var req struct {
		ID string `json:"id"`
	}
	r.Data(t, &req)
	mustBe(t, "approve", admin.Post(t, "/api/v1/admin/requests/"+req.ID+"/resolve", map[string]any{"approve": true, "resolution": "Refund on its way"}), http.StatusNoContent)

	status, _, _, _ := bookingState(t, env, b.ID)
	if status != "CANCELLED" {
		t.Fatalf("status = %s", status)
	}
	var refund uuid.UUID
	if err := env.Pool.QueryRow(context.Background(), `SELECT r.id FROM refunds r JOIN bookings b ON b.id = r.booking_id WHERE b.public_id = $1 LIMIT 1`, b.ID).Scan(&refund); err != nil {
		t.Fatal(err)
	}
	mustBe(t, "bank details", customer.Do(t, http.MethodPut, "/api/v1/refunds/"+refund.String()+"/bank-details",
		map[string]string{"bank_name": "BCA", "bank_account_name": "Test Customer", "bank_account_number": "1234567890"}, nil), http.StatusNoContent)
}

func TestCustomerRescheduleRequestDeclinedByAdmin(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	customer, admin, b := bookedAndPaid(t, env, f)

	r := customer.Post(t, "/api/v1/bookings/"+b.ID.String()+"/reschedule-request", map[string]string{"message": "One day later, please"})
	mustBe(t, "reschedule request", r, http.StatusCreated)
	var req struct {
		ID string `json:"id"`
	}
	r.Data(t, &req)
	mustBe(t, "decline", admin.Post(t, "/api/v1/admin/requests/"+req.ID+"/resolve", map[string]any{"approve": false, "resolution": "Boat is taken that day"}), http.StatusNoContent)
	if status, _, _, _ := bookingState(t, env, b.ID); status != "CONFIRMED" {
		t.Fatalf("a declined request must leave the booking confirmed, got %s", status)
	}
}

func TestCustomerCancelsAnUnpaidBooking(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(20), "09:00", 2, 2))
	r := c.Post(t, "/api/v1/bookings/"+b.ID.String()+"/cancel-unpaid", map[string]any{})
	if r.Status >= 300 {
		t.Fatalf("cancel unpaid: %d %s", r.Status, r.Body)
	}
	if status, _, _, _ := bookingState(t, env, b.ID); status != "CANCELLED" && status != "EXPIRED" {
		t.Fatalf("status = %s", status)
	}
}

func TestReviewGoesFromCustomerToPublicPage(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	customer, admin, b := bookedAndPaid(t, env, f)
	if _, err := env.Pool.Exec(context.Background(), `UPDATE bookings SET status = 'COMPLETED', starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE public_id = $1`, b.ID); err != nil {
		t.Fatal(err)
	}
	r := customer.Post(t, "/api/v1/bookings/"+b.ID.String()+"/review", map[string]any{
		"rating_overall": 5, "rating_boat": 4, "rating_service": 5, "rating_crew": 5, "title": "Lovely day", "body": "The crew looked after us very well.", "locale": "en",
	})
	mustBe(t, "review", r, http.StatusCreated)
	var review struct {
		ID string `json:"id"`
	}
	r.Data(t, &review)
	mustBe(t, "publish", admin.Post(t, "/api/v1/admin/reviews/"+review.ID+"/moderate", map[string]any{"status": "PUBLISHED", "is_featured": true}), http.StatusNoContent)
	var list []map[string]any
	env.Anonymous().Get(t, "/api/v1/reviews?featured=true").Data(t, &list)
	if len(list) != 1 {
		t.Fatalf("published reviews = %d", len(list))
	}
}

func TestCustomerManagesTheirAccount(t *testing.T) {
	env := testutil.NewEnv(t)
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	mustBe(t, "profile", c.Do(t, http.MethodPut, "/api/v1/account/profile", map[string]string{"full_name": "New Name", "phone": "+628123456789", "nationality": "ID", "locale": "id"}, nil), http.StatusOK)
	r := c.Post(t, "/api/v1/account/delete", map[string]any{})
	if r.Status >= 300 {
		t.Fatalf("delete account: %d %s", r.Status, r.Body)
	}
	if r := c.Get(t, "/api/v1/auth/me"); r.Status != http.StatusUnauthorized {
		t.Fatalf("a deleted account must lose its session: %d", r.Status)
	}
}

func TestAdminEditsGuestsAndRevealsIdentity(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	_, admin, b := bookedAndPaid(t, env, f)
	mustBe(t, "guests", admin.Do(t, http.MethodPut, "/api/v1/admin/bookings/"+b.ID.String()+"/guests", map[string]any{
		"lead_full_name": "Lead Guest", "lead_phone": "+628123456789", "guests": []map[string]string{{"full_name": "Second Guest", "phone": ""}},
	}, nil), http.StatusNoContent)
	r := admin.Post(t, "/api/v1/admin/bookings/"+b.ID.String()+"/identity/reveal", map[string]any{})
	if r.Status >= 500 {
		t.Fatalf("reveal: %d %s", r.Status, r.Body)
	}
}

func TestAdminBlocksABoatAndUnblocksIt(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	start := time.Now().Add(30 * 24 * time.Hour).Truncate(time.Hour)
	r := admin.Post(t, "/api/v1/admin/boats/"+f.BoatID.String()+"/blocks", map[string]any{"kind": "MAINTENANCE", "starts_at": start, "ends_at": start.Add(48 * time.Hour), "reason": "Hull cleaning"})
	mustBe(t, "block", r, http.StatusCreated)
	var block struct {
		ID string `json:"id"`
	}
	r.Data(t, &block)
	mustBe(t, "unblock", admin.Do(t, http.MethodDelete, "/api/v1/admin/blocks/"+block.ID, nil, nil), http.StatusNoContent)
}

func TestAdminOverridesAPriceAndAMethodFee(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	ctx := context.Background()
	var rate uuid.UUID
	if err := env.Pool.QueryRow(ctx, `SELECT id FROM boat_rates WHERE boat_id = $1 LIMIT 1`, f.BoatID).Scan(&rate); err != nil {
		t.Fatal(err)
	}
	r := admin.Post(t, "/api/v1/admin/price-overrides", map[string]any{"boat_rate_id": rate, "rule_type": "DATE", "on_date": testutil.LocalDate(40), "price": 999000})
	if r.Status != http.StatusCreated && r.Status != http.StatusOK {
		t.Fatalf("override: %d %s", r.Status, r.Body)
	}
	var o struct {
		ID string `json:"id"`
	}
	r.Data(t, &o)
	mustBe(t, "delete override", admin.Do(t, http.MethodDelete, "/api/v1/admin/price-overrides/"+o.ID, nil, nil), http.StatusNoContent)

	var fees []map[string]any
	admin.Get(t, "/api/v1/admin/payment-method-fees").Data(t, &fees)
	if len(fees) == 0 {
		t.Fatal("no method fees")
	}
	method, _ := fees[0]["method"].(string)
	if r := admin.Do(t, http.MethodPut, "/api/v1/admin/payment-method-fees/"+method, fees[0], nil); r.Status >= 300 {
		t.Fatalf("save fee: %d %s", r.Status, r.Body)
	}
}

func TestAdminManagesAUser(t *testing.T) {
	env := testutil.NewEnv(t)
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	_, _ = env.Login(t, "other-admin@test.dev", "ADMIN")
	_, customer := env.Login(t, "c@test.dev", "CUSTOMER")
	_, secondAdmin := env.Login(t, "third@test.dev", "ADMIN")
	mustBe(t, "disable", admin.Post(t, "/api/v1/admin/users/"+customer.String()+"/status", map[string]string{"status": "DISABLED"}), http.StatusNoContent)
	mustBe(t, "enable", admin.Post(t, "/api/v1/admin/users/"+customer.String()+"/status", map[string]string{"status": "ACTIVE"}), http.StatusNoContent)
	mustBe(t, "demote", admin.Post(t, "/api/v1/admin/users/"+secondAdmin.String()+"/demote", map[string]any{}), http.StatusNoContent)
	mustBe(t, "anonymize", admin.Post(t, "/api/v1/admin/users/"+customer.String()+"/anonymize", map[string]any{}), http.StatusNoContent)
}

func TestAdminRefundsAndClearsALatePayment(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
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
	mustBe(t, "webhook", env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true)), http.StatusOK)

	var payment uuid.UUID
	if err := env.Pool.QueryRow(ctx, `SELECT id FROM payments WHERE order_id = $1`, p.OrderID).Scan(&payment); err != nil {
		t.Fatal(err)
	}
	if r := admin.Post(t, "/api/v1/admin/payments/"+payment.String()+"/refund-exception", map[string]any{}); r.Status >= 300 {
		t.Fatalf("refund exception: %d %s", r.Status, r.Body)
	}
	var refunds int
	if err := env.Pool.QueryRow(ctx, `SELECT count(*) FROM refunds WHERE payment_id = $1`, payment).Scan(&refunds); err != nil {
		t.Fatal(err)
	}
	if refunds != 1 {
		t.Fatalf("refunds = %d", refunds)
	}
	if r := admin.Post(t, "/api/v1/admin/bookings/"+b.ID.String()+"/clear-exception", map[string]any{}); r.Status >= 300 {
		t.Fatalf("clear exception: %d %s", r.Status, r.Body)
	}
	if _, _, _, exc := bookingState(t, env, b.ID); exc != nil {
		t.Fatalf("exception still set: %s", *exc)
	}
}

func TestAdminManagesBoatAreas(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	body := map[string]any{"deck_label": "Upper", "min_pax": 1, "max_pax": 4, "base_price": 0, "sort_order": 9, "status": "ACTIVE",
		"translations": map[string]any{"en": map[string]string{"name": "Sky Lounge", "description": "Open deck"}}, "facility_ids": []string{}, "gallery_ids": []string{}}
	path := "/api/v1/admin/boats/" + f.BoatID.String() + "/areas"
	r := admin.Post(t, path, body)
	if r.Status >= 300 {
		t.Fatalf("create area: %d %s", r.Status, r.Body)
	}
	var area struct {
		ID string `json:"id"`
	}
	r.Data(t, &area)
	body["max_pax"] = 6
	if r := admin.Do(t, http.MethodPut, path+"/"+area.ID, body, nil); r.Status >= 300 {
		t.Fatalf("update area: %d %s", r.Status, r.Body)
	}
	if r := admin.Do(t, http.MethodDelete, path+"/"+area.ID, nil, nil); r.Status >= 300 {
		t.Fatalf("delete area: %d %s", r.Status, r.Body)
	}
}

func TestAdminRecordsAPartnerPayout(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	_, admin, b := bookedAndPaid(t, env, f)
	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `UPDATE bookings SET status = 'COMPLETED', starts_at = now() - interval '3 days', ends_at = now() - interval '2 days' WHERE public_id = $1`, b.ID); err != nil {
		t.Fatal(err)
	}
	body := map[string]any{"partner_id": f.PartnerID, "period_start": testutil.LocalDate(-10), "period_end": testutil.LocalDate(0), "booking_ids": []uuid.UUID{b.ID}, "paid_on": testutil.LocalDate(0), "notes": "October run"}
	r := admin.Post(t, "/api/v1/admin/payouts", body)
	if r.Status >= 300 {
		t.Fatalf("payout: %d %s", r.Status, r.Body)
	}
	if r := admin.Post(t, "/api/v1/admin/payouts", body); r.Status != http.StatusConflict {
		t.Fatalf("paying the same booking twice: %d %s", r.Status, r.Body)
	}
}
