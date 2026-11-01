package scenarios

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/testutil"
)

type bookingResp struct {
	ID            uuid.UUID `json:"id"`
	BookingNumber string    `json:"booking_number"`
	Status        string    `json:"status"`
	GrandTotal    int64     `json:"grand_total"`
	Subtotal      int64     `json:"subtotal"`
	Lines         []struct {
		Amount int64 `json:"amount"`
	} `json:"lines"`
}

func key() string { return uuid.NewString() }

// Scenario 1: 20 parallel requests for the same charter slot -> exactly 1 succeeds, 19 get 409.
func TestScenario01ParallelCharter(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	date := testutil.LocalDate(10)
	var wg sync.WaitGroup
	statuses := make([]int, 20)
	for i := 0; i < 20; i++ {
		c, _ := env.Login(t, fmt.Sprintf("u%d@test.dev", i), "CUSTOMER")
		wg.Add(1)
		go func(i int, c *testutil.Client) {
			defer wg.Done()
			statuses[i] = c.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "09:00", 3, 2), key()).Status
		}(i, c)
	}
	wg.Wait()
	created, conflicts := 0, 0
	for _, s := range statuses {
		switch s {
		case http.StatusCreated:
			created++
		case http.StatusConflict:
			conflicts++
		}
	}
	if created != 1 || conflicts != 19 {
		t.Fatalf("expected 1 created and 19 conflicts, got %d/%d (%v)", created, conflicts, statuses)
	}
}

// Scenario 2: a charter overlapping a departure or a maintenance block is rejected.
func TestScenario02CharterVsDepartureAndBlock(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	cust, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	date := testutil.LocalDate(12)
	res := admin.Post(t, "/api/v1/admin/departures", map[string]any{
		"boat_id": f.BoatID, "route_id": f.RouteID, "departs_date": date, "departs_time": "10:00", "returns_date": date, "returns_time": "13:00",
		"close_hours_before": 2, "slots": []map[string]any{{"slot_type": "SEAT_POOL", "area_ids": f.AreaIDs, "price": 500000, "seat_capacity": 10, "min_pax": 1, "max_pax": 10}},
	})
	if res.Status != http.StatusCreated {
		t.Fatalf("create departure: %d %s", res.Status, res.Body)
	}
	if r := cust.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "12:00", 2, 2), key()); r.Status != http.StatusConflict {
		t.Fatalf("charter over departure should conflict, got %d %s", r.Status, r.Body)
	}
	loc, _ := time.LoadLocation(f.Timezone)
	d2 := testutil.LocalDate(13)
	day, _ := time.ParseInLocation("2006-01-02", d2, loc)
	block := admin.Post(t, "/api/v1/admin/boats/"+f.BoatID.String()+"/blocks", map[string]any{
		"kind": "MAINTENANCE", "starts_at": day.Add(8 * time.Hour), "ends_at": day.Add(18 * time.Hour), "reason": "engine service"})
	if block.Status != http.StatusCreated {
		t.Fatalf("block: %d %s", block.Status, block.Body)
	}
	if r := cust.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, d2, "09:00", 2, 2), key()); r.Status != http.StatusConflict {
		t.Fatalf("charter over maintenance should conflict, got %d %s", r.Status, r.Body)
	}
}

// Scenario 3: a second charter closer than the turnaround buffer is rejected; one after is fine.
func TestScenario03Buffer(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{BufferMinutes: 60})
	c1, _ := env.Login(t, "a@test.dev", "CUSTOMER")
	c2, _ := env.Login(t, "b@test.dev", "CUSTOMER")
	date := testutil.LocalDate(10)
	if r := c1.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "09:00", 2, 2), key()); r.Status != http.StatusCreated {
		t.Fatalf("first: %d %s", r.Status, r.Body)
	}
	if r := c2.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "12:00", 2, 2), key()); r.Status != http.StatusConflict {
		t.Fatalf("within buffer should conflict, got %d %s", r.Status, r.Body)
	}
	if r := c2.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "13:00", 2, 2), key()); r.Status != http.StatusCreated {
		t.Fatalf("after buffer should succeed, got %d %s", r.Status, r.Body)
	}
}

func createDeparture(t *testing.T, env *testutil.Env, admin *testutil.Client, f testutil.Fixture, date string, slots []map[string]any) (uuid.UUID, []uuid.UUID) {
	t.Helper()
	res := admin.Post(t, "/api/v1/admin/departures", map[string]any{
		"boat_id": f.BoatID, "route_id": f.RouteID, "departs_date": date, "departs_time": "16:00", "returns_date": date, "returns_time": "19:00",
		"close_hours_before": 1, "slots": slots})
	if res.Status != http.StatusCreated {
		t.Fatalf("create departure: %d %s", res.Status, res.Body)
	}
	var d struct {
		ID    uuid.UUID `json:"id"`
		Slots []struct {
			ID uuid.UUID `json:"id"`
		} `json:"slots"`
	}
	res.Data(t, &d)
	ids := []uuid.UUID{}
	for _, s := range d.Slots {
		ids = append(ids, s.ID)
	}
	return d.ID, ids
}

func departureBooking(slot uuid.UUID, pax int) map[string]any {
	return map[string]any{
		"product":        map[string]any{"mode": "DEPARTURE", "departure_slot_id": slot},
		"pax":            pax,
		"payment_method": "CREDIT_CARD",
		"lead":           testutil.Lead("GB", "PASSPORT", "X1234567"),
		"guests":         testutil.Guests(pax - 1),
		"consents":       testutil.Consents(),
	}
}

// Scenario 4: parallel requests for the same private area -> exactly one wins.
func TestScenario04PrivateAreaRace(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	_, slots := createDeparture(t, env, admin, f, testutil.LocalDate(9), []map[string]any{
		{"slot_type": "PRIVATE_AREA", "area_ids": []uuid.UUID{f.AreaIDs[0]}, "price": 3000000, "min_pax": 1, "max_pax": 8},
		{"slot_type": "SEAT_POOL", "area_ids": []uuid.UUID{f.AreaIDs[1]}, "price": 400000, "seat_capacity": 10, "min_pax": 1, "max_pax": 10},
	})
	var wg sync.WaitGroup
	statuses := make([]int, 10)
	for i := 0; i < 10; i++ {
		c, _ := env.Login(t, fmt.Sprintf("p%d@test.dev", i), "CUSTOMER")
		wg.Add(1)
		go func(i int, c *testutil.Client) {
			defer wg.Done()
			statuses[i] = c.PostIdem(t, "/api/v1/bookings", departureBooking(slots[0], 4), key()).Status
		}(i, c)
	}
	wg.Wait()
	created := 0
	for _, s := range statuses {
		if s == http.StatusCreated {
			created++
		} else if s != http.StatusConflict {
			t.Fatalf("unexpected status %d", s)
		}
	}
	if created != 1 {
		t.Fatalf("expected exactly 1 private-area booking, got %d (%v)", created, statuses)
	}
}

// Scenario 5: parallel seat bookings never exceed the slot seats or the boat's legal capacity.
func TestScenario05SeatPoolCapacity(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{MaxPassengers: 12})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	depID, slots := createDeparture(t, env, admin, f, testutil.LocalDate(9), []map[string]any{
		{"slot_type": "SEAT_POOL", "area_ids": f.AreaIDs, "price": 400000, "seat_capacity": 10, "min_pax": 1, "max_pax": 3},
	})
	var wg sync.WaitGroup
	for i := 0; i < 15; i++ {
		c, _ := env.Login(t, fmt.Sprintf("s%d@test.dev", i), "CUSTOMER")
		wg.Add(1)
		go func(c *testutil.Client) {
			defer wg.Done()
			c.PostIdem(t, "/api/v1/bookings", departureBooking(slots[0], 3), key())
		}(c)
	}
	wg.Wait()
	var total int
	if err := env.Pool.QueryRow(context.Background(), `SELECT COALESCE(sum(pax),0) FROM bookings WHERE departure_id = $1 AND status IN ('PENDING_PAYMENT','CONFIRMED')`, depID).Scan(&total); err != nil {
		t.Fatal(err)
	}
	if total > 10 || total < 9 {
		t.Fatalf("seat pool should fill to at most 10 seats (3-seat bookings => 9), got %d", total)
	}
}

// Scenario 6: a double click with the same Idempotency-Key creates one booking and replays the
// identical response.
func TestScenario06Idempotency(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	body := testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2)
	k := key()
	var wg sync.WaitGroup
	res := make([]testutil.Response, 2)
	for i := range res {
		wg.Add(1)
		go func(i int) { defer wg.Done(); res[i] = c.PostIdem(t, "/api/v1/bookings", body, k) }(i)
	}
	wg.Wait()
	if res[0].Status != http.StatusCreated || res[1].Status != http.StatusCreated || string(res[0].Body) != string(res[1].Body) {
		t.Fatalf("responses differ: %d %s / %d %s", res[0].Status, res[0].Body, res[1].Status, res[1].Body)
	}
	var n int
	_ = env.Pool.QueryRow(context.Background(), `SELECT count(*) FROM bookings`).Scan(&n)
	if n != 1 {
		t.Fatalf("expected 1 booking, got %d", n)
	}
	body["pax"] = 3
	body["guests"] = testutil.Guests(2)
	if r := c.PostIdem(t, "/api/v1/bookings", body, k); r.Status != http.StatusConflict || r.ErrorCode(t) != "IDEMPOTENCY_KEY_REUSED" {
		t.Fatalf("same key with a different body must be 409, got %d %s", r.Status, r.Body)
	}
}

// Scenario 7: an expired hold that the cleanup job has not processed yet does not block the slot.
func TestScenario07ExpiredHoldWithoutJob(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c1, _ := env.Login(t, "a@test.dev", "CUSTOMER")
	c2, _ := env.Login(t, "b@test.dev", "CUSTOMER")
	date := testutil.LocalDate(10)
	r := c1.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "09:00", 2, 2), key())
	if r.Status != http.StatusCreated {
		t.Fatalf("first: %d %s", r.Status, r.Body)
	}
	if _, err := env.Pool.Exec(context.Background(), `UPDATE bookings SET hold_expires_at = now() - interval '1 minute'; UPDATE area_reservations SET expires_at = now() - interval '1 minute'`); err != nil {
		t.Fatal(err)
	}
	if r := c2.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, date, "09:00", 2, 2), key()); r.Status != http.StatusCreated {
		t.Fatalf("second booking should take the expired hold, got %d %s", r.Status, r.Body)
	}
	var st string
	_ = env.Pool.QueryRow(context.Background(), `SELECT status FROM bookings ORDER BY created_at LIMIT 1`).Scan(&st)
	if st != "EXPIRED" {
		t.Fatalf("first booking should be EXPIRED, got %s", st)
	}
}

// Scenario 13: client-supplied price or status fields are refused and cannot affect the price.
func TestScenario13ClientPriceIgnored(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{HourlyPrice: 1_000_000})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	body := testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2)
	body["grand_total"] = 1
	body["status"] = "CONFIRMED"
	if r := c.PostIdem(t, "/api/v1/bookings", body, key()); r.Status != http.StatusUnprocessableEntity {
		t.Fatalf("unknown price fields must be rejected, got %d %s", r.Status, r.Body)
	}
	delete(body, "grand_total")
	delete(body, "status")
	r := c.PostIdem(t, "/api/v1/bookings", body, key())
	var b bookingResp
	r.Data(t, &b)
	if b.GrandTotal != 2_000_000 || b.Status != "PENDING_PAYMENT" {
		t.Fatalf("server must compute price and status, got %+v", b)
	}
}

// Scenario 14: another customer's booking is a 404, never a 403.
func TestScenario14Ownership(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	owner, _ := env.Login(t, "o@test.dev", "CUSTOMER")
	other, _ := env.Login(t, "x@test.dev", "CUSTOMER")
	var b bookingResp
	owner.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2), key()).Data(t, &b)
	for _, p := range []string{"/api/v1/account/bookings/" + b.ID.String(), "/api/v1/bookings/" + b.ID.String() + "/payments", "/api/v1/bookings/" + b.ID.String() + "/ticket.pdf"} {
		if r := other.Get(t, p); r.Status != http.StatusNotFound {
			t.Fatalf("%s: expected 404, got %d", p, r.Status)
		}
	}
	if r := owner.Get(t, "/api/v1/account/bookings/"+b.ID.String()); r.Status != http.StatusOK {
		t.Fatalf("owner should see the booking, got %d", r.Status)
	}
}

// Scenario 15: public tracking never exposes names, phone numbers, identity numbers or guests.
func TestScenario15TrackingHasNoPII(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "track@test.dev", "CUSTOMER")
	var b bookingResp
	c.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 3, 3), key()).Data(t, &b)
	anon := env.Anonymous()
	for _, r := range []testutil.Response{
		anon.Post(t, "/api/v1/orders/track", map[string]string{"booking_number": b.BookingNumber, "email": "track@test.dev"}),
		anon.Get(t, "/api/v1/orders/"+b.ID.String()),
		anon.Get(t, "/api/v1/orders/"+b.ID.String()+"/status"),
	} {
		if r.Status != http.StatusOK {
			t.Fatalf("tracking: %d %s", r.Status, r.Body)
		}
		for _, secret := range []string{"John", "Smith", "+62812", "3171234567890123", "0123", "Guest Number", "track@test.dev"} {
			if contains(r.Body, secret) {
				t.Fatalf("tracking leaked %q: %s", secret, r.Body)
			}
		}
	}
	if r := anon.Post(t, "/api/v1/orders/track", map[string]string{"booking_number": b.BookingNumber, "email": "wrong@test.dev"}); r.Status != http.StatusNotFound {
		t.Fatalf("wrong email must be 404, got %d", r.Status)
	}
}

func contains(b []byte, s string) bool { return len(s) > 0 && json.Valid(b) && stringContains(string(b), s) }

func stringContains(h, n string) bool {
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return true
		}
	}
	return false
}

// Scenario 16: changing prices or policies after booking leaves the booking's snapshot intact.
func TestScenario16Snapshot(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{HourlyPrice: 1_000_000})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	var b bookingResp
	c.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2), key()).Data(t, &b)
	ctx := context.Background()
	if _, err := env.Pool.Exec(ctx, `UPDATE boat_rates SET price = 9000000; UPDATE cancellation_policy_tiers SET refund_basis_points = 0;
		INSERT INTO tax_lines (code, basis_points) VALUES ('VAT', 1100)`); err != nil {
		t.Fatal(err)
	}
	var after bookingResp
	c.Get(t, "/api/v1/account/bookings/"+b.ID.String()).Data(t, &after)
	if after.GrandTotal != b.GrandTotal || after.Lines[0].Amount != 2_000_000 {
		t.Fatalf("snapshot changed: before %d after %d", b.GrandTotal, after.GrandTotal)
	}
	var tiers string
	_ = env.Pool.QueryRow(ctx, `SELECT snapshot->'cancellation_policy'->>'tiers' FROM bookings`).Scan(&tiers)
	if !stringContains(tiers, "10000") {
		t.Fatalf("cancellation snapshot changed: %s", tiers)
	}
}

// Scenario 20: KTP is only valid for Indonesian nationals.
func TestScenario20KTPForeigner(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	body := testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2)
	body["lead"] = testutil.Lead("US", "KTP", "3171234567890123")
	r := c.PostIdem(t, "/api/v1/bookings", body, key())
	if r.Status != http.StatusUnprocessableEntity || !stringContains(string(r.Body), "ID_TYPE_NOT_ALLOWED") {
		t.Fatalf("expected ID_TYPE_NOT_ALLOWED, got %d %s", r.Status, r.Body)
	}
}

// Scenario 21: the number of guests must equal pax - 1.
func TestScenario21GuestCount(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	body := testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 4)
	body["guests"] = testutil.Guests(1)
	r := c.PostIdem(t, "/api/v1/bookings", body, key())
	if r.Status != http.StatusUnprocessableEntity || !stringContains(string(r.Body), "COUNT_MISMATCH") {
		t.Fatalf("expected COUNT_MISMATCH, got %d %s", r.Status, r.Body)
	}
}
