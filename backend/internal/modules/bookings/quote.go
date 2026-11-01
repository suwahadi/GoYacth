package bookings

import (
	"context"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"goyacht/internal/modules/catalog"
	"goyacht/internal/modules/pricing"
	"goyacht/internal/modules/settings"
	"goyacht/internal/platform/db"
	"goyacht/internal/platform/db/dbq"
	"goyacht/internal/platform/httpx"
	"goyacht/internal/platform/i18n"
)

type ProductInput struct {
	Mode              string     `json:"mode"`
	BoatID            *uuid.UUID `json:"boat_id,omitempty"`
	RouteID           *uuid.UUID `json:"route_id,omitempty"`
	Date              string     `json:"date,omitempty"`
	StartTime         string     `json:"start_time,omitempty"`
	RateUnit          string     `json:"rate_unit,omitempty"`
	Units             int        `json:"units,omitempty"`
	DepartureSlotID   *uuid.UUID `json:"departure_slot_id,omitempty"`
	PackageID         *uuid.UUID `json:"package_id,omitempty"`
	PackageOfferingID *uuid.UUID `json:"package_offering_id,omitempty"`
}

type QuoteInput struct {
	Product       ProductInput `json:"product"`
	Pax           int          `json:"pax"`
	PromoCode     string       `json:"promo_code,omitempty"`
	PaymentMethod string       `json:"payment_method,omitempty"`
	PaymentScheme string       `json:"payment_scheme,omitempty"`
	Locale        string       `json:"locale,omitempty"`
}

// resolved is a product turned into concrete times, inventory and a base price.
type resolved struct {
	Mode           string
	Boat           dbq.Boat
	RouteID        uuid.UUID
	DepartureID    *uuid.UUID
	Slot           *dbq.DepartureSlot
	PackageID      *uuid.UUID
	StartsAt       time.Time
	EndsAt         time.Time
	Timezone       string
	ReserveFrom    time.Time
	ReserveTo      time.Time
	UnitPrice      int64
	Quantity       int64
	BaseAmount     int64
	Rule           pricing.RuleType
	PriceLabel     string
	PaymentPolicy  dbq.PaymentPolicy
	CancelPolicyID uuid.UUID
	MinPax, MaxPax int32
}

type PriceLine struct {
	Kind      string `json:"kind"`
	Label     string `json:"label"`
	UnitPrice int64  `json:"unit_price"`
	Quantity  int64  `json:"quantity"`
	Amount    int64  `json:"amount"`
	Rule      string `json:"rule,omitempty"`
}

type DiscountInfo struct {
	PromotionID uuid.UUID `json:"promotion_id"`
	Name        string    `json:"name"`
	Code        string    `json:"code,omitempty"`
	Amount      int64     `json:"amount"`
}

type PaymentQuote struct {
	Method           string     `json:"method"`
	Scheme           string     `json:"scheme"`
	DepositAvailable bool       `json:"deposit_available"`
	DepositAmount    int64      `json:"deposit_amount"`
	PrincipalDueNow  int64      `json:"principal_due_now"`
	Fee              int64      `json:"fee"`
	TotalDueNow      int64      `json:"total_due_now"`
	BalanceDueAt     *time.Time `json:"balance_due_at"`
	HoldMinutes      int32      `json:"hold_minutes"`
}

type Quote struct {
	Mode        string             `json:"mode"`
	BoatID      uuid.UUID          `json:"boat_id"`
	RouteID     uuid.UUID          `json:"route_id"`
	DepartureID *uuid.UUID         `json:"departure_id,omitempty"`
	SlotID      *uuid.UUID         `json:"departure_slot_id,omitempty"`
	PackageID   *uuid.UUID         `json:"package_id,omitempty"`
	StartsAt    time.Time          `json:"starts_at"`
	EndsAt      time.Time          `json:"ends_at"`
	Timezone    string             `json:"timezone"`
	Pax         int                `json:"pax"`
	Lines       []PriceLine        `json:"lines"`
	Discount    *DiscountInfo      `json:"discount"`
	Subtotal    int64              `json:"subtotal"`
	Taxes       []pricing.TaxLine  `json:"taxes"`
	TaxTotal    int64              `json:"tax_total"`
	GrandTotal  int64              `json:"grand_total"`
	Payment     PaymentQuote       `json:"payment"`
	USDEstimate int64              `json:"usd_estimate"`
	Currency    string             `json:"currency"`
	Commission  CommissionSnapshot `json:"-"`
	resolved    *resolved
}

type CommissionSnapshot struct {
	Ownership string     `json:"ownership"`
	PartnerID *uuid.UUID `json:"partner_id"`
	Type      *string    `json:"type"`
	Value     int64      `json:"value"`
	Amount    int64      `json:"amount"`
}

var timeRe = regexp.MustCompile(`^([01][0-9]|2[0-3]):([0-5][0-9])$`)

func parseLocal(date, clock, tz string) (time.Time, error) {
	loc, err := time.LoadLocation(tz)
	if err != nil {
		return time.Time{}, err
	}
	m := timeRe.FindStringSubmatch(clock)
	if m == nil {
		return time.Time{}, fmt.Errorf("bad time")
	}
	d, err := time.ParseInLocation("2006-01-02", date, loc)
	if err != nil {
		return time.Time{}, err
	}
	h, _ := strconv.Atoi(m[1])
	mi, _ := strconv.Atoi(m[2])
	return time.Date(d.Year(), d.Month(), d.Day(), h, mi, 0, 0, loc), nil
}

func minuteOfDay(t time.Time) int32 { return int32(t.Hour()*60 + t.Minute()) }

func atMinute(day time.Time, minute int32) time.Time {
	return time.Date(day.Year(), day.Month(), day.Day(), 0, 0, 0, 0, day.Location()).Add(time.Duration(minute) * time.Minute)
}

type Quoter struct {
	now func() time.Time
}

func NewQuoter() *Quoter { return &Quoter{now: time.Now} }

func (qt *Quoter) checkLead(cfg settings.Booking, startsAt time.Time, extraCutoffHours int32) error {
	now := qt.now()
	lead := time.Duration(cfg.MinLeadHours) * time.Hour
	if c := time.Duration(extraCutoffHours) * time.Hour; c > lead {
		lead = c
	}
	if startsAt.Sub(now) < lead || startsAt.After(now.AddDate(0, 0, cfg.MaxAdvanceDays)) {
		return ErrLeadTime
	}
	return nil
}

func overridesFromRows[T any](rows []T, conv func(T) pricing.Override) []pricing.Override {
	out := make([]pricing.Override, 0, len(rows))
	for _, r := range rows {
		out = append(out, conv(r))
	}
	return out
}

func rateOverride(o dbq.ListOverridesForRateRow) pricing.Override {
	po := pricing.Override{Rule: pricing.RuleType(o.RuleType), Price: o.Price}
	if o.OnDate != nil {
		po.OnDate = *o.OnDate
	}
	if o.SeasonKind != nil {
		po.SeasonKind = *o.SeasonKind
		po.SeasonStart, po.SeasonEnd = deref(o.SeasonStartsOn), deref(o.SeasonEndsOn)
	}
	return po
}

func offeringOverride(o dbq.ListOverridesForOfferingRow) pricing.Override {
	po := pricing.Override{Rule: pricing.RuleType(o.RuleType), Price: o.Price}
	if o.OnDate != nil {
		po.OnDate = *o.OnDate
	}
	if o.SeasonKind != nil {
		po.SeasonKind = *o.SeasonKind
		po.SeasonStart, po.SeasonEnd = deref(o.SeasonStartsOn), deref(o.SeasonEndsOn)
	}
	return po
}

func deref(t *time.Time) time.Time {
	if t == nil {
		return time.Time{}
	}
	return *t
}

func localDate(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

func (qt *Quoter) routePort(ctx context.Context, q *dbq.Queries, routeID uuid.UUID) (dbq.Route, dbq.Port, error) {
	rt, err := q.GetRouteAdmin(ctx, routeID)
	if err != nil {
		return dbq.Route{}, dbq.Port{}, ErrProductNotFound
	}
	port, err := q.GetPort(ctx, rt.DeparturePortID)
	if err != nil {
		return dbq.Route{}, dbq.Port{}, err
	}
	return dbq.Route{ID: rt.ID, RegionID: rt.RegionID, DeparturePortID: rt.DeparturePortID, ReturnPortID: rt.ReturnPortID, DurationMinutes: rt.DurationMinutes, Status: rt.Status}, port, nil
}

// resolve validates the product against the catalog and turns it into concrete times and a base
// price. allowUnpublished is used for admin-created bookings.
func (qt *Quoter) resolve(ctx context.Context, q *dbq.Queries, in QuoteInput, cfg settings.Booking, allowUnpublished bool) (*resolved, error) {
	p := in.Product
	f := httpx.FieldErrors{}
	if in.Pax < 1 || in.Pax > 500 {
		f.Add("pax", "OUT_OF_RANGE")
	}
	if err := f.Err(); err != nil {
		return nil, err
	}
	switch {
	case p.Mode == ModeDeparture && p.DepartureSlotID != nil:
		return qt.resolveDeparture(ctx, q, in, cfg, allowUnpublished)
	case p.Mode == ModeCharter && p.PackageID != nil:
		return qt.resolveCharterPackage(ctx, q, in, cfg, allowUnpublished)
	case p.Mode == ModeCharter && p.BoatID != nil && p.RouteID != nil:
		return qt.resolveCharter(ctx, q, in, cfg, allowUnpublished)
	}
	return nil, httpx.Validation(map[string]string{"product": "INVALID"})
}

func (qt *Quoter) loadBoat(ctx context.Context, q *dbq.Queries, id uuid.UUID, allowUnpublished bool) (dbq.Boat, error) {
	b, err := q.GetBoat(ctx, id)
	if err != nil {
		return b, ErrProductNotFound
	}
	if b.Status == "ARCHIVED" || (!allowUnpublished && b.Status != "PUBLISHED") {
		return b, ErrProductNotFound
	}
	return b, nil
}

func (qt *Quoter) charterWindow(b dbq.Boat, start time.Time, durationMinutes int32, wholeDays int) (time.Time, error) {
	if minuteOfDay(start) < b.OperatingStartMinute {
		return time.Time{}, ErrOutsideHours
	}
	var end time.Time
	if wholeDays > 0 {
		lastDay := start.AddDate(0, 0, wholeDays-1)
		end = atMinute(lastDay, b.OperatingEndMinute)
		if !end.After(start) {
			return time.Time{}, ErrOutsideHours
		}
		return end, nil
	}
	end = start.Add(time.Duration(durationMinutes) * time.Minute)
	sameDay := end.Year() == start.Year() && end.YearDay() == start.YearDay() || (minuteOfDay(end) == 0 && end.Sub(start) <= 24*time.Hour)
	if !b.OvernightAllowed {
		endMinute := minuteOfDay(end)
		if endMinute == 0 && !end.Equal(start) {
			endMinute = 1440
		}
		if !sameDay || endMinute > b.OperatingEndMinute {
			return time.Time{}, ErrOutsideHours
		}
	}
	return end, nil
}

func (qt *Quoter) resolveCharter(ctx context.Context, q *dbq.Queries, in QuoteInput, cfg settings.Booking, allowUnpublished bool) (*resolved, error) {
	p := in.Product
	b, err := qt.loadBoat(ctx, q, *p.BoatID, allowUnpublished)
	if err != nil {
		return nil, err
	}
	br, err := q.GetBoatRoute(ctx, dbq.GetBoatRouteParams{BoatID: b.ID, RouteID: *p.RouteID})
	if err != nil {
		return nil, httpx.Validation(map[string]string{"product.route_id": "ROUTE_NOT_SERVED"})
	}
	route, port, err := qt.routePort(ctx, q, *p.RouteID)
	if err != nil {
		return nil, err
	}
	if route.Status != "PUBLISHED" && !allowUnpublished {
		return nil, ErrProductNotFound
	}
	start, err := parseLocal(p.Date, p.StartTime, port.Timezone)
	if err != nil {
		return nil, httpx.Validation(map[string]string{"product.date": "INVALID_DATE"})
	}
	if start.Minute()%15 != 0 {
		return nil, httpx.Validation(map[string]string{"product.start_time": "INVALID_INCREMENT"})
	}
	if int32(in.Pax) > b.MaxPassengers {
		return nil, httpx.Validation(map[string]string{"pax": "EXCEEDS_CAPACITY"})
	}
	rate, err := q.GetBoatRate(ctx, dbq.GetBoatRateParams{BoatID: b.ID, RateUnit: p.RateUnit})
	if err != nil {
		return nil, httpx.Validation(map[string]string{"product.rate_unit": "UNAVAILABLE"})
	}
	minDuration := route.DurationMinutes
	if br.MinDurationMinutes != nil {
		minDuration = *br.MinDurationMinutes
	}
	r := &resolved{Mode: ModeCharter, Boat: b, RouteID: route.ID, Timezone: port.Timezone, StartsAt: start, MinPax: 1, MaxPax: b.MaxPassengers, CancelPolicyID: b.CancellationPolicyID}
	unitPrice := rate.Price
	var qty int64 = 1
	switch p.RateUnit {
	case catalog.RateHourly:
		if p.Units < int(rate.MinUnits) || p.Units > int(rate.MaxUnits) {
			return nil, httpx.Validation(map[string]string{"product.units": "OUT_OF_RANGE"})
		}
		if int32(p.Units*60) < minDuration {
			return nil, httpx.Validation(map[string]string{"product.units": "BELOW_ROUTE_DURATION"})
		}
		r.EndsAt, err = qt.charterWindow(b, start, int32(p.Units*60), 0)
		qty = int64(p.Units)
		r.PriceLabel = "HOURLY"
	case catalog.RateDaily:
		if p.Units < int(rate.MinUnits) || p.Units > int(rate.MaxUnits) || (p.Units > 1 && !b.OvernightAllowed) {
			return nil, httpx.Validation(map[string]string{"product.units": "OUT_OF_RANGE"})
		}
		r.EndsAt, err = qt.charterWindow(b, start, 0, p.Units)
		qty = int64(p.Units)
		r.PriceLabel = "DAILY"
	case catalog.RateFixed:
		r.EndsAt, err = qt.charterWindow(b, start, minDuration, 0)
		r.PriceLabel = "FIXED"
	default:
		return nil, httpx.Validation(map[string]string{"product.rate_unit": "INVALID"})
	}
	if err != nil {
		return nil, err
	}
	if err := qt.checkLead(cfg, start, 0); err != nil {
		return nil, err
	}
	rule := pricing.RuleBase
	if p.RateUnit == catalog.RateFixed && br.FixedPrice != nil {
		// A route-specific fixed price is already a negotiated price; date rules for the
		// generic FIXED rate do not apply to it.
		unitPrice = *br.FixedPrice
	} else {
		ovs, err := q.ListOverridesForRate(ctx, &rate.ID)
		if err != nil {
			return nil, err
		}
		unitPrice, rule = pricing.ResolveUnitPrice(rate.Price, overridesFromRows(ovs, rateOverride), localDate(start))
	}
	r.UnitPrice, r.Quantity, r.BaseAmount, r.Rule = unitPrice, qty, unitPrice*qty, rule
	buffer := time.Duration(b.TurnaroundBufferMinutes) * time.Minute
	r.ReserveFrom, r.ReserveTo = r.StartsAt.Add(-buffer), r.EndsAt.Add(buffer)
	r.PaymentPolicy, err = q.GetPaymentPolicy(ctx, b.PaymentPolicyID)
	return r, err
}

func (qt *Quoter) loadPackage(ctx context.Context, q *dbq.Queries, id uuid.UUID, allowUnpublished bool) (dbq.Package, error) {
	pk, err := q.GetPackage(ctx, id)
	if err != nil {
		return pk, ErrProductNotFound
	}
	if (pk.Status != "PUBLISHED" && !allowUnpublished) || pk.Status == "ARCHIVED" {
		return pk, ErrProductNotFound
	}
	return pk, nil
}

func (qt *Quoter) resolveCharterPackage(ctx context.Context, q *dbq.Queries, in QuoteInput, cfg settings.Booking, allowUnpublished bool) (*resolved, error) {
	p := in.Product
	pk, err := qt.loadPackage(ctx, q, *p.PackageID, allowUnpublished)
	if err != nil || pk.Mode != ModeCharter || p.PackageOfferingID == nil {
		return nil, ErrProductNotFound
	}
	off, err := q.GetPackageOffering(ctx, *p.PackageOfferingID)
	if err != nil || off.PackageID != pk.ID {
		return nil, ErrProductNotFound
	}
	b, err := qt.loadBoat(ctx, q, off.BoatID, allowUnpublished)
	if err != nil {
		return nil, err
	}
	route, port, err := qt.routePort(ctx, q, *pk.RouteID)
	if err != nil {
		return nil, err
	}
	start, err := parseLocal(p.Date, p.StartTime, port.Timezone)
	if err != nil {
		return nil, httpx.Validation(map[string]string{"product.date": "INVALID_DATE"})
	}
	d := localDate(start)
	if d.Before(localDate(pk.ValidFrom)) || d.After(localDate(pk.ValidUntil)) {
		return nil, httpx.Unprocessable("PACKAGE_NOT_VALID_ON_DATE", "package is not offered on that date")
	}
	if in.Pax < int(pk.MinPax) || in.Pax > int(pk.MaxPax) || int32(in.Pax) > b.MaxPassengers {
		return nil, httpx.Validation(map[string]string{"pax": "OUT_OF_RANGE"})
	}
	end, err := qt.charterWindow(b, start, *pk.DurationMinutes, 0)
	if err != nil {
		return nil, err
	}
	if err := qt.checkLead(cfg, start, pk.BookingCutoffHours); err != nil {
		return nil, err
	}
	ovs, err := q.ListOverridesForOffering(ctx, &off.ID)
	if err != nil {
		return nil, err
	}
	price, rule := pricing.ResolveUnitPrice(off.Price, overridesFromRows(ovs, offeringOverride), d)
	pid := pk.ID
	r := &resolved{Mode: ModeCharter, Boat: b, RouteID: route.ID, PackageID: &pid, StartsAt: start, EndsAt: end, Timezone: port.Timezone,
		UnitPrice: price, Quantity: 1, BaseAmount: price, Rule: rule, PriceLabel: "PACKAGE", MinPax: pk.MinPax, MaxPax: pk.MaxPax, CancelPolicyID: pk.CancellationPolicyID}
	buffer := time.Duration(b.TurnaroundBufferMinutes) * time.Minute
	r.ReserveFrom, r.ReserveTo = start.Add(-buffer), end.Add(buffer)
	r.PaymentPolicy, err = q.GetPaymentPolicy(ctx, pk.PaymentPolicyID)
	return r, err
}

func (qt *Quoter) resolveDeparture(ctx context.Context, q *dbq.Queries, in QuoteInput, cfg settings.Booking, allowUnpublished bool) (*resolved, error) {
	p := in.Product
	slot, err := q.GetDepartureSlot(ctx, *p.DepartureSlotID)
	if err != nil {
		return nil, ErrProductNotFound
	}
	dep, err := q.GetDeparture(ctx, slot.DepartureID)
	if err != nil || dep.Status != "SCHEDULED" {
		return nil, ErrProductNotFound
	}
	if !qt.now().Before(dep.BookingClosesAt) && !allowUnpublished {
		return nil, ErrBookingClosed
	}
	b, err := qt.loadBoat(ctx, q, dep.BoatID, allowUnpublished)
	if err != nil {
		return nil, err
	}
	_, port, err := qt.routePort(ctx, q, dep.RouteID)
	if err != nil {
		return nil, err
	}
	if in.Pax > int(slot.MaxPax) || int32(in.Pax) > b.MaxPassengers {
		return nil, httpx.Validation(map[string]string{"pax": "OUT_OF_RANGE"})
	}
	if slot.SlotType == SlotSeatPool && slot.SeatCapacity != nil && in.Pax > int(*slot.SeatCapacity) {
		return nil, httpx.Validation(map[string]string{"pax": "OUT_OF_RANGE"})
	}
	depID, slotCopy := dep.ID, slot
	r := &resolved{Mode: ModeDeparture, Boat: b, RouteID: dep.RouteID, DepartureID: &depID, Slot: &slotCopy, StartsAt: dep.DepartsAt, EndsAt: dep.ReturnsAt,
		Timezone: port.Timezone, MinPax: 1, MaxPax: slot.MaxPax, CancelPolicyID: b.CancellationPolicyID, Rule: pricing.RuleBase}
	unit := slot.Price
	payPolicyID := b.PaymentPolicyID
	var cutoff int32
	if p.PackageID != nil {
		pk, err := qt.loadPackage(ctx, q, *p.PackageID, allowUnpublished)
		if err != nil || pk.Mode != ModeDeparture || pk.DepartureID == nil || *pk.DepartureID != dep.ID || p.PackageOfferingID == nil {
			return nil, ErrProductNotFound
		}
		off, err := q.GetPackageOffering(ctx, *p.PackageOfferingID)
		if err != nil || off.PackageID != pk.ID || off.DepartureSlotID == nil || *off.DepartureSlotID != slot.ID {
			return nil, ErrProductNotFound
		}
		if in.Pax < int(pk.MinPax) || in.Pax > int(pk.MaxPax) {
			return nil, httpx.Validation(map[string]string{"pax": "OUT_OF_RANGE"})
		}
		if localDate(dep.DepartsAt).After(localDate(pk.ValidUntil)) {
			return nil, httpx.Unprocessable("PACKAGE_EXPIRED", "package is no longer offered")
		}
		pid := pk.ID
		r.PackageID = &pid
		unit = off.Price
		payPolicyID = pk.PaymentPolicyID
		r.CancelPolicyID = pk.CancellationPolicyID
		cutoff = pk.BookingCutoffHours
		r.PriceLabel = "PACKAGE"
	}
	if err := qt.checkLead(cfg, dep.DepartsAt, cutoff); err != nil && !allowUnpublished {
		return nil, err
	}
	if slot.SlotType == SlotSeatPool {
		r.UnitPrice, r.Quantity = unit, int64(in.Pax)
		if r.PriceLabel == "" {
			r.PriceLabel = "SEAT"
		}
	} else {
		r.UnitPrice, r.Quantity = unit, 1
		if r.PriceLabel == "" {
			r.PriceLabel = "PRIVATE_AREA"
		}
	}
	r.BaseAmount = r.UnitPrice * r.Quantity
	r.PaymentPolicy, err = q.GetPaymentPolicy(ctx, payPolicyID)
	return r, err
}

func promoApplies(p dbq.Promotion, r *resolved, now time.Time) bool {
	if p.Status != "ACTIVE" || now.Before(p.StartsAt) || !now.Before(p.EndsAt) {
		return false
	}
	if p.Quota != nil && p.UsedCount >= *p.Quota {
		return false
	}
	if p.BoatID != nil && *p.BoatID != r.Boat.ID {
		return false
	}
	if p.PackageID != nil && (r.PackageID == nil || *p.PackageID != *r.PackageID) {
		return false
	}
	if p.BookingMode != nil && *p.BookingMode != r.Mode {
		return false
	}
	return true
}

func toPromo(p dbq.Promotion) pricing.Promo {
	code := ""
	if p.Code != nil {
		code = *p.Code
	}
	return pricing.Promo{ID: p.ID.String(), Name: p.Name, Code: code, Type: pricing.DiscountType(p.DiscountType), Value: p.DiscountValue, MinSubtotal: p.MinSubtotal}
}

// Build computes the full quote. It only reads; booking creation calls it inside its own
// transaction so the price that is stored is the price that was checked.
func (qt *Quoter) Build(ctx context.Context, q *dbq.Queries, in QuoteInput, allowUnpublished bool) (*Quote, error) {
	cfg, err := settings.Load(ctx, q, "booking", settings.DefaultBooking())
	if err != nil {
		return nil, err
	}
	loc := i18n.Normalize(in.Locale)
	r, err := qt.resolve(ctx, q, in, cfg, allowUnpublished)
	if err != nil {
		return nil, err
	}
	qu := &Quote{Mode: r.Mode, BoatID: r.Boat.ID, RouteID: r.RouteID, DepartureID: r.DepartureID, PackageID: r.PackageID,
		StartsAt: r.StartsAt.UTC(), EndsAt: r.EndsAt.UTC(), Timezone: r.Timezone, Pax: in.Pax, Currency: "IDR", resolved: r}
	if r.Slot != nil {
		id := r.Slot.ID
		qu.SlotID = &id
	}
	qu.Lines = []PriceLine{{Kind: "BASE", Label: r.PriceLabel, UnitPrice: r.UnitPrice, Quantity: r.Quantity, Amount: r.BaseAmount, Rule: string(r.Rule)}}

	now := qt.now()
	var chosen *dbq.Promotion
	var discount int64
	if code := strings.TrimSpace(in.PromoCode); code != "" {
		p, err := q.GetPromotionByCode(ctx, code)
		if err != nil {
			if db.IsNoRows(err) {
				return nil, ErrPromoInvalid
			}
			return nil, err
		}
		if !promoApplies(p, r, now) {
			return nil, ErrPromoInvalid
		}
		discount = toPromo(p).Discount(r.BaseAmount)
		if discount == 0 {
			return nil, ErrPromoInvalid
		}
		chosen = &p
	} else {
		autos, err := q.ListAutomaticPromotions(ctx)
		if err != nil {
			return nil, err
		}
		for i := range autos {
			if !promoApplies(autos[i], r, now) {
				continue
			}
			if d := toPromo(autos[i]).Discount(r.BaseAmount); d > discount {
				discount, chosen = d, &autos[i]
			}
		}
	}
	if chosen != nil {
		code := ""
		if chosen.Code != nil {
			code = *chosen.Code
		}
		qu.Discount = &DiscountInfo{PromotionID: chosen.ID, Name: chosen.Name, Code: code, Amount: discount}
	}
	qu.Subtotal = r.BaseAmount - discount

	taxRows, err := q.ListActiveTaxLines(ctx)
	if err != nil {
		return nil, err
	}
	rules := make([]pricing.TaxRule, 0, len(taxRows))
	for _, t := range taxRows {
		var names map[string]string
		_ = json.Unmarshal(t.Names, &names)
		name := catalog.Pick(names, loc)
		if name == "" {
			name = t.Code
		}
		rules = append(rules, pricing.TaxRule{Code: t.Code, Name: name, BasisPoints: int64(t.BasisPoints), IncludesPreviousLines: t.IncludesPreviousLines})
	}
	qu.Taxes, qu.TaxTotal = pricing.ApplyTaxes(qu.Subtotal, rules)
	qu.GrandTotal = qu.Subtotal + qu.TaxTotal

	b := r.Boat
	qu.Commission = CommissionSnapshot{Ownership: b.Ownership, PartnerID: b.PartnerID, Type: b.CommissionType, Value: b.CommissionValue}
	if b.Ownership == "PARTNER" && b.CommissionType != nil {
		qu.Commission.Amount = pricing.CommissionFor(qu.Subtotal, *b.CommissionType, b.CommissionValue)
	}

	if err := qt.quotePayment(ctx, q, qu, in); err != nil {
		return nil, err
	}
	cur, err := settings.Load(ctx, q, "currency", settings.Currency{})
	if err != nil {
		return nil, err
	}
	if cur.USDRateIDR > 0 {
		qu.USDEstimate = (qu.GrandTotal + cur.USDRateIDR/2) / cur.USDRateIDR
	}
	return qu, nil
}

func (qt *Quoter) quotePayment(ctx context.Context, q *dbq.Queries, qu *Quote, in QuoteInput) error {
	r := qu.resolved
	pq := PaymentQuote{Scheme: "FULL"}
	if r.PaymentPolicy.Type == "DEPOSIT" && r.PaymentPolicy.DepositType != nil {
		due := r.StartsAt.AddDate(0, 0, -int(r.PaymentPolicy.BalanceDueDays))
		dep := pricing.DepositAmount(qu.GrandTotal, pricing.DepositRule{Type: *r.PaymentPolicy.DepositType, Value: r.PaymentPolicy.DepositValue})
		if dep > 0 && due.After(qt.now().Add(time.Hour)) {
			pq.DepositAvailable, pq.DepositAmount = true, dep
			dueUTC := due.UTC()
			pq.BalanceDueAt = &dueUTC
		}
	}
	switch in.PaymentScheme {
	case "", "FULL":
		pq.Scheme = "FULL"
		pq.PrincipalDueNow = qu.GrandTotal
		pq.BalanceDueAt = nil
	case "DEPOSIT":
		if !pq.DepositAvailable {
			return ErrDepositNotAllowed
		}
		pq.Scheme = "DEPOSIT"
		pq.PrincipalDueNow = pq.DepositAmount
	default:
		return httpx.Validation(map[string]string{"payment_scheme": "INVALID"})
	}
	pq.HoldMinutes = 15
	if in.PaymentMethod != "" {
		fee, err := q.GetPaymentMethodFee(ctx, in.PaymentMethod)
		if err != nil || !fee.Enabled {
			return ErrMethodDisabled
		}
		pq.Method = fee.Method
		pq.Fee = pricing.FeeRule{Type: fee.FeeType, Value: fee.FeeValue}.For(pq.PrincipalDueNow)
		pq.HoldMinutes = fee.HoldMinutes
	}
	pq.TotalDueNow = pq.PrincipalDueNow + pq.Fee
	qu.Payment = pq
	return nil
}
