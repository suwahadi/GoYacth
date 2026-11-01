package scenarios

import (
	"bytes"
	"net/http"
	"testing"

	"goyacht/internal/testutil"
)

// Ticket, invoice and manifest are rendered on demand after the first payment.
func TestPaidBookingDocuments(t *testing.T) {
	env := testutil.NewEnv(t)
	f := testutil.NewFixture(t, env.Pool, testutil.FixtureOptions{})
	c, _ := env.Login(t, "c@test.dev", "CUSTOMER")
	admin, _ := env.Login(t, "admin@test.dev", "ADMIN")
	b := book(t, c, testutil.CharterBooking(f, testutil.LocalDate(10), "09:00", 2, 2))
	if r := c.Get(t, "/api/v1/bookings/"+b.ID.String()+"/ticket.pdf"); r.Status != http.StatusConflict {
		t.Fatalf("ticket before payment should be 409, got %d", r.Status)
	}
	p := startPayment(t, c, b.ID, "CREDIT_CARD")
	settle(env, p, "settlement", p.GrossAmount)
	env.Anonymous().Post(t, "/api/v1/webhooks/midtrans", notification(env, p.OrderID, "settlement", p.GrossAmount, true))
	for _, path := range []string{"/api/v1/bookings/" + b.ID.String() + "/ticket.pdf?locale=id", "/api/v1/bookings/" + b.ID.String() + "/invoice.pdf"} {
		r := c.Get(t, path)
		if r.Status != http.StatusOK || !bytes.HasPrefix(r.Body, []byte("%PDF")) {
			t.Fatalf("%s: %d %.120s", path, r.Status, r.Body)
		}
	}
	r := admin.Get(t, "/api/v1/admin/manifests/booking/"+b.ID.String())
	if r.Status != http.StatusOK || !bytes.HasPrefix(r.Body, []byte("%PDF")) {
		t.Fatalf("manifest pdf: %d", r.Status)
	}
	csv := admin.Get(t, "/api/v1/admin/manifests/booking/"+b.ID.String()+"?format=csv")
	if csv.Status != http.StatusOK || !bytes.Contains(csv.Body, []byte("****0123")) || bytes.Contains(csv.Body, []byte("3171234567890123")) {
		t.Fatalf("manifest csv must mask identity numbers: %s", csv.Body)
	}
}
