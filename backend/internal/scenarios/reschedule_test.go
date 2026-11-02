package scenarios

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/testutil"
)

func payInFull(t *testing.T, admin *testutil.Client, b bookingResp) {
	t.Helper()
	r := admin.PostIdem(t, "/api/v1/admin/bookings/"+b.ID.String()+"/payments", map[string]any{
		"method": "BANK_TRANSFER", "amount": b.GrandTotal, "paid_on": time.Now().Format("2006-01-02"),
	}, uuid.NewString())
	if r.Status != http.StatusCreated {
		t.Fatalf("payment: %d %s", r.Status, r.Body)
	}
}

func reschedule(t *testing.T, admin *testutil.Client, id uuid.UUID, body map[string]any) testutil.Response {
	t.Helper()
	return admin.Post(t, "/api/v1/admin/bookings/"+id.String()+"/reschedule", body)
}

func TestAdminReschedulesACharter(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	oldDate, newDate := testutil.LocalDate(10), testutil.LocalDate(12)
	b := book(t, c, testutil.CharterBooking(f, oldDate, "09:00", 2, 2))
	payInFull(t, admin, b)

	ctx := context.Background()
	var oldToken string
	var oldStart time.Time
	if err := env.Pool.QueryRow(ctx, `SELECT verify_token, starts_at FROM bookings WHERE public_id = $1`, b.ID).Scan(&oldToken, &oldStart); err != nil {
		t.Fatal(err)
	}

	if r := reschedule(t, admin, b.ID, map[string]any{"date": newDate, "start_time": "10:00"}); r.Status != http.StatusNoContent {
		t.Fatalf("reschedule: %d %s", r.Status, r.Body)
	}

	var token string
	var start time.Time
	if err := env.Pool.QueryRow(ctx, `SELECT verify_token, starts_at FROM bookings WHERE public_id = $1`, b.ID).Scan(&token, &start); err != nil {
		t.Fatal(err)
	}
	if token == oldToken {
		t.Fatal("the old ticket must stop working after a reschedule")
	}
	if want := oldStart.AddDate(0, 0, 2).Add(time.Hour); !start.Equal(want) {
		t.Fatalf("starts_at = %s, want %s", start, want)
	}
	other, _ := env.Login(t, "other@test.dev", "CUSTOMER")
	if r := other.PostIdem(t, "/api/v1/bookings", testutil.CharterBooking(f, oldDate, "09:00", 2, 2), uuid.NewString()); r.Status != http.StatusCreated {
		t.Fatalf("the old time should be free again: %d %s", r.Status, r.Body)
	}
}

func TestRescheduleRefusesATakenTime(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	first := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	payInFull(t, admin, first)
	taken := testutil.LocalDate(12)
	second := book(t, c, testutil.CharterBooking(f, taken, "09:00", 2, 2))
	payInFull(t, admin, second)

	if r := reschedule(t, admin, first.ID, map[string]any{"date": taken, "start_time": "09:00"}); r.Status != http.StatusConflict {
		t.Fatalf("double booking the boat: %d %s", r.Status, r.Body)
	}
	var starts time.Time
	if err := env.Pool.QueryRow(context.Background(), `SELECT starts_at FROM bookings WHERE public_id = $1`, first.ID).Scan(&starts); err != nil {
		t.Fatal(err)
	}
	if got := starts.In(time.FixedZone("WITA", 8*3600)).Format("2006-01-02"); got == taken {
		t.Fatal("a refused reschedule must leave the booking where it was")
	}
}

func TestAdminReschedulesADeparture(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	slot := map[string]any{"slot_type": "SEAT_POOL", "area_ids": f.AreaIDs, "price": 400000, "seat_capacity": 10, "min_pax": 1, "max_pax": 5}
	_, from := createDeparture(t, env, admin, f, testutil.LocalDate(9), []map[string]any{slot})
	_, to := createDeparture(t, env, admin, f, testutil.LocalDate(15), []map[string]any{slot})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	b := book(t, c, departureBooking(from[0], 2))
	payInFull(t, admin, b)

	if r := reschedule(t, admin, b.ID, map[string]any{"departure_slot_id": to[0]}); r.Status != http.StatusNoContent {
		t.Fatalf("reschedule: %d %s", r.Status, r.Body)
	}
	var got uuid.UUID
	if err := env.Pool.QueryRow(context.Background(), `SELECT departure_slot_id FROM bookings WHERE public_id = $1`, b.ID).Scan(&got); err != nil {
		t.Fatal(err)
	}
	if got.String() != to[0].String() {
		t.Fatalf("booking stayed on slot %s", got)
	}
}

func TestOnlyAConfirmedBookingCanBeRescheduled(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	if r := reschedule(t, admin, b.ID, map[string]any{"date": testutil.LocalDate(12), "start_time": "10:00"}); r.Status < 400 || r.Status >= 500 {
		t.Fatalf("unpaid booking: %d %s", r.Status, r.Body)
	}
}
