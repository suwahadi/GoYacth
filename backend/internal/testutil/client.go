package testutil

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"

	"goyacht/internal/platform/i18n"
)

type Client struct {
	base   string
	http   *http.Client
	cookie string
	csrf   string
}

type Response struct {
	Status int
	Body   []byte
}

func (r Response) JSON(t testing.TB, v any) {
	t.Helper()
	if err := json.Unmarshal(r.Body, v); err != nil {
		t.Fatalf("decode %s: %v", r.Body, err)
	}
}

// Data decodes the "data" member of the success envelope.
func (r Response) Data(t testing.TB, v any) {
	t.Helper()
	var env struct {
		Data json.RawMessage `json:"data"`
	}
	r.JSON(t, &env)
	if err := json.Unmarshal(env.Data, v); err != nil {
		t.Fatalf("decode data %s: %v", env.Data, err)
	}
}

func (r Response) ErrorCode(t testing.TB) string {
	t.Helper()
	var env struct {
		Error struct {
			Code string `json:"code"`
		} `json:"error"`
	}
	_ = json.Unmarshal(r.Body, &env)
	return env.Error.Code
}

func (c *Client) Do(t testing.TB, method, path string, body any, headers map[string]string) Response {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		switch b := body.(type) {
		case []byte:
			rdr = bytes.NewReader(b)
		default:
			raw, err := json.Marshal(body)
			if err != nil {
				t.Fatal(err)
			}
			rdr = bytes.NewReader(raw)
		}
	}
	req, err := http.NewRequestWithContext(context.Background(), method, c.base+path, rdr)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	if c.cookie != "" {
		req.AddCookie(&http.Cookie{Name: "gy_session", Value: c.cookie})
		req.Header.Set("X-CSRF-Token", c.csrf)
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := c.http.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = res.Body.Close() }()
	for _, ck := range res.Cookies() {
		switch ck.Name {
		case "gy_session":
			c.cookie = ck.Value
		case "gy_csrf":
			c.csrf = ck.Value
		}
	}
	raw, _ := io.ReadAll(res.Body)
	return Response{Status: res.StatusCode, Body: raw}
}

func (c *Client) Get(t testing.TB, path string) Response {
	return c.Do(t, http.MethodGet, path, nil, nil)
}

func (c *Client) Post(t testing.TB, path string, body any) Response {
	return c.Do(t, http.MethodPost, path, body, nil)
}

func (c *Client) PostIdem(t testing.TB, path string, body any, key string) Response {
	return c.Do(t, http.MethodPost, path, body, map[string]string{"Idempotency-Key": key})
}

// Fixture is a minimal but complete catalog: one region, port, route, boat with two areas,
// hourly and fixed rates, and default policies.
type Fixture struct {
	RegionID, PortID, RouteID, BoatID uuid.UUID
	AreaIDs                           []uuid.UUID
	PaymentPolicyID, CancelPolicyID   uuid.UUID
	PartnerID                         uuid.UUID
	Timezone                          string
}

func mustExec(t testing.TB, pool *pgxpool.Pool, sql string, args ...any) {
	t.Helper()
	if _, err := pool.Exec(context.Background(), sql, args...); err != nil {
		t.Fatalf("exec %q: %v", sql, err)
	}
}

func mustID(t testing.TB, pool *pgxpool.Pool, sql string, args ...any) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := pool.QueryRow(context.Background(), sql, args...).Scan(&id); err != nil {
		t.Fatalf("query %q: %v", sql, err)
	}
	return id
}

type FixtureOptions struct {
	BufferMinutes  int
	MaxPassengers  int
	DepositPercent int64
	BalanceDueDays int
	HourlyPrice    int64
}

func NewFixture(t testing.TB, pool *pgxpool.Pool, o FixtureOptions) Fixture {
	t.Helper()
	if o.MaxPassengers == 0 {
		o.MaxPassengers = 20
	}
	if o.HourlyPrice == 0 {
		o.HourlyPrice = 1_000_000
	}
	mustExec(t, pool, `INSERT INTO payment_method_fees (method, fee_type, fee_value, hold_minutes, enabled) VALUES
		('CREDIT_CARD','FIXED',0,15,true),('QRIS','FIXED',0,15,true),('BCA_VA','FIXED',4000,60,true) ON CONFLICT DO NOTHING`)
	f := Fixture{Timezone: "Asia/Makassar"}
	f.RegionID = mustID(t, pool, `INSERT INTO regions (status) VALUES ('PUBLISHED') RETURNING id`)
	mustExec(t, pool, `INSERT INTO region_translations (region_id, locale, name, slug) VALUES ($1,'en','Bali','bali-`+uuid.NewString()[:6]+`')`, f.RegionID)
	f.PortID = mustID(t, pool, `INSERT INTO ports (region_id, timezone) VALUES ($1, 'Asia/Makassar') RETURNING id`, f.RegionID)
	mustExec(t, pool, `INSERT INTO port_translations (port_id, locale, name) VALUES ($1,'en','Benoa')`, f.PortID)
	f.RouteID = mustID(t, pool, `INSERT INTO routes (region_id, departure_port_id, return_port_id, duration_minutes, status) VALUES ($1,$2,$2,120,'PUBLISHED') RETURNING id`, f.RegionID, f.PortID)
	mustExec(t, pool, `INSERT INTO route_translations (route_id, locale, name, slug) VALUES ($1,'en','Sunset','sunset-`+uuid.NewString()[:6]+`')`, f.RouteID)
	if o.DepositPercent > 0 {
		f.PaymentPolicyID = mustID(t, pool, `INSERT INTO payment_policies (name, type, deposit_type, deposit_value, balance_due_days) VALUES ('DP','DEPOSIT','PERCENTAGE',$1,$2) RETURNING id`, o.DepositPercent*100, o.BalanceDueDays)
	} else {
		f.PaymentPolicyID = mustID(t, pool, `INSERT INTO payment_policies (name, type) VALUES ('Full','FULL') RETURNING id`)
	}
	f.CancelPolicyID = mustID(t, pool, `INSERT INTO cancellation_policies (name) VALUES ('Std') RETURNING id`)
	mustExec(t, pool, `INSERT INTO cancellation_policy_tiers (policy_id, min_days_before, refund_basis_points) VALUES ($1,8,10000),($1,3,5000),($1,0,0)`, f.CancelPolicyID)
	cat := mustID(t, pool, `INSERT INTO boat_categories DEFAULT VALUES RETURNING id`)
	cls := mustID(t, pool, `INSERT INTO boat_classes DEFAULT VALUES RETURNING id`)
	f.PartnerID = mustID(t, pool, `INSERT INTO partners (name) VALUES ('Partner') RETURNING id`)
	f.BoatID = mustID(t, pool, `INSERT INTO boats (code, category_id, class_id, ownership, partner_id, commission_type, commission_value, home_port_id, max_passengers,
		turnaround_buffer_minutes, operating_start_minute, operating_end_minute, overnight_allowed, payment_policy_id, cancellation_policy_id, status)
		VALUES ($1,$2,$3,'PARTNER',$4,'PERCENTAGE',2000,$5,$6,$7,0,1440,true,$8,$9,'PUBLISHED') RETURNING id`,
		"B"+uuid.NewString()[:6], cat, cls, f.PartnerID, f.PortID, o.MaxPassengers, o.BufferMinutes, f.PaymentPolicyID, f.CancelPolicyID)
	mustExec(t, pool, `INSERT INTO boat_translations (boat_id, locale, name, slug) VALUES ($1,'en','Ocean Majesty',$2)`, f.BoatID, "ocean-"+uuid.NewString()[:8])
	mustExec(t, pool, `INSERT INTO boat_routes (boat_id, route_id) VALUES ($1,$2)`, f.BoatID, f.RouteID)
	mustExec(t, pool, `INSERT INTO boat_rates (boat_id, rate_unit, price, min_units, max_units) VALUES ($1,'HOURLY',$2,1,12),($1,'FIXED',5000000,1,1)`, f.BoatID, o.HourlyPrice)
	for i := 0; i < 2; i++ {
		id := mustID(t, pool, `INSERT INTO areas (boat_id, max_pax, sort_order) VALUES ($1,$2,$3) RETURNING id`, f.BoatID, o.MaxPassengers/2, i)
		f.AreaIDs = append(f.AreaIDs, id)
	}
	return f
}

// LocalDate returns a date string far enough ahead to satisfy the lead-time rule.
func LocalDate(daysAhead int) string {
	loc, _ := time.LoadLocation("Asia/Makassar")
	return time.Now().In(loc).AddDate(0, 0, daysAhead).Format("2006-01-02")
}

func Lead(nationality, idType, idNumber string) map[string]any {
	return map[string]any{"full_name": "John Smith", "phone": "+6281234567890", "nationality": nationality, "id_type": idType, "id_number": idNumber}
}

func Consents() map[string]bool {
	return map[string]bool{"terms": true, "cancellation": true, "deposit_forfeit": true, "data_processing": true}
}

func Guests(n int) []map[string]string {
	out := []map[string]string{}
	for i := 0; i < n; i++ {
		out = append(out, map[string]string{"full_name": "Guest Number"})
	}
	return out
}

func CharterBooking(f Fixture, date, start string, hours, pax int) map[string]any {
	return map[string]any{
		"product":        map[string]any{"mode": "PRIVATE_CHARTER", "boat_id": f.BoatID, "route_id": f.RouteID, "date": date, "start_time": start, "rate_unit": "HOURLY", "units": hours},
		"pax":            pax,
		"payment_method": "CREDIT_CARD",
		"lead":           Lead("ID", "KTP", "3171234567890123"),
		"guests":         Guests(pax - 1),
		"consents":       Consents(),
		"locale":         i18n.Default,
	}
}
