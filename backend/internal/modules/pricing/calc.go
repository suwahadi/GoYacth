// Package pricing computes booking prices. Every amount is an int64 number of whole rupiah and
// every percentage is in basis points (10000 = 100%), so no floating point is ever involved.
package pricing

import (
	"time"
)

// PercentOf returns amount * bp / 10000 rounded half up to the nearest rupiah.
func PercentOf(amount int64, bp int64) int64 {
	if amount <= 0 || bp <= 0 {
		return 0
	}
	return (amount*bp + 5000) / 10000
}

type RuleType string

const (
	RuleBase    RuleType = "BASE"
	RuleDate    RuleType = "DATE"
	RuleSeason  RuleType = "SEASON"
	RuleWeekend RuleType = "WEEKEND"
	RuleWeekday RuleType = "WEEKDAY"
)

type Override struct {
	Rule        RuleType
	OnDate      time.Time
	SeasonKind  string
	SeasonStart time.Time
	SeasonEnd   time.Time
	Price       int64
}

var seasonRank = map[string]int{"PEAK": 3, "HIGH": 2, "LOW": 1}

func sameDay(a, b time.Time) bool {
	return a.Year() == b.Year() && a.Month() == b.Month() && a.Day() == b.Day()
}

// IsWeekend uses Saturday and Sunday in the departure port's local calendar.
func IsWeekend(localDate time.Time) bool {
	wd := localDate.Weekday()
	return wd == time.Saturday || wd == time.Sunday
}

// ResolveUnitPrice applies PRD 6.1 step 2: a specific date beats a season, which beats the
// weekend/weekday rule, which beats the base price. Exactly one rule wins; nothing stacks.
// When several seasons cover the date, the highest tier (PEAK > HIGH > LOW) wins.
func ResolveUnitPrice(base int64, overrides []Override, localDate time.Time) (int64, RuleType) {
	var (
		season     *Override
		weekendOrW *Override
	)
	for i := range overrides {
		o := &overrides[i]
		switch o.Rule {
		case RuleDate:
			if sameDay(o.OnDate, localDate) {
				return o.Price, RuleDate
			}
		case RuleSeason:
			d := civil(localDate)
			if !d.Before(civil(o.SeasonStart)) && !d.After(civil(o.SeasonEnd)) {
				if season == nil || seasonRank[o.SeasonKind] > seasonRank[season.SeasonKind] {
					season = o
				}
			}
		case RuleWeekend:
			if IsWeekend(localDate) && weekendOrW == nil {
				weekendOrW = o
			}
		case RuleWeekday:
			if !IsWeekend(localDate) && weekendOrW == nil {
				weekendOrW = o
			}
		}
	}
	if season != nil {
		return season.Price, RuleSeason
	}
	if weekendOrW != nil {
		return weekendOrW.Price, weekendOrW.Rule
	}
	return base, RuleBase
}

func civil(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, time.UTC)
}

type DiscountType string

const (
	DiscountPercentage DiscountType = "PERCENTAGE"
	DiscountFixed      DiscountType = "FIXED"
	DiscountPrice      DiscountType = "PRICE"
)

type Promo struct {
	ID          string
	Name        string
	Code        string
	Type        DiscountType
	Value       int64
	MinSubtotal int64
}

// Discount returns how much the promotion takes off amount. A PRICE promotion sets the final
// pre-tax price, so its discount is the difference. Discounts never exceed the amount.
func (p Promo) Discount(amount int64) int64 {
	if amount < p.MinSubtotal {
		return 0
	}
	var d int64
	switch p.Type {
	case DiscountPercentage:
		d = PercentOf(amount, p.Value)
	case DiscountFixed:
		d = p.Value
	case DiscountPrice:
		d = amount - p.Value
	}
	if d < 0 {
		return 0
	}
	if d > amount {
		return amount
	}
	return d
}

type TaxRule struct {
	Code                  string
	Name                  string
	BasisPoints           int64
	IncludesPreviousLines bool
}

type TaxLine struct {
	Code        string `json:"code"`
	Name        string `json:"name"`
	BasisPoints int64  `json:"basis_points"`
	Base        int64  `json:"base"`
	Amount      int64  `json:"amount"`
}

// ApplyTaxes computes each line in order. A line with IncludesPreviousLines is levied on the
// subtotal plus all earlier lines (PRD: service first, then tax on subtotal + service).
func ApplyTaxes(subtotal int64, rules []TaxRule) ([]TaxLine, int64) {
	lines := make([]TaxLine, 0, len(rules))
	var running int64
	for _, r := range rules {
		base := subtotal
		if r.IncludesPreviousLines {
			base = subtotal + running
		}
		amt := PercentOf(base, r.BasisPoints)
		lines = append(lines, TaxLine{Code: r.Code, Name: r.Name, BasisPoints: r.BasisPoints, Base: base, Amount: amt})
		running += amt
	}
	return lines, running
}

type FeeRule struct {
	Type  string
	Value int64
}

func (f FeeRule) For(principal int64) int64 {
	if f.Type == "PERCENTAGE" {
		return PercentOf(principal, f.Value)
	}
	return f.Value
}

type DepositRule struct {
	Type  string
	Value int64
}

// DepositAmount is computed from the grand total. A deposit that would cover the whole amount
// is not a deposit, so 0 is returned and the caller only offers full payment.
func DepositAmount(grandTotal int64, r DepositRule) int64 {
	var d int64
	if r.Type == "PERCENTAGE" {
		d = PercentOf(grandTotal, r.Value)
	} else {
		d = r.Value
	}
	if d <= 0 || d >= grandTotal {
		return 0
	}
	return d
}

// RefundAmount applies a cancellation tier list (sorted any way) to the amount paid excluding
// payment method fees. The tier with the largest MinDaysBefore not exceeding daysBefore wins.
func RefundAmount(paidPrincipal int64, tiers []Tier, daysBefore int) (int64, int32) {
	best := int32(-1)
	var bp int32
	for _, t := range tiers {
		if int(t.MinDaysBefore) <= daysBefore && t.MinDaysBefore > best {
			best = t.MinDaysBefore
			bp = t.RefundBasisPoints
		}
	}
	if best < 0 {
		return 0, 0
	}
	return PercentOf(paidPrincipal, int64(bp)), bp
}

type Tier struct {
	MinDaysBefore     int32 `json:"min_days_before"`
	RefundBasisPoints int32 `json:"refund_basis_points"`
}

// CommissionFor applies the partner commission to the pre-tax subtotal (PRD 10.4).
func CommissionFor(subtotal int64, commissionType string, value int64) int64 {
	switch commissionType {
	case "PERCENTAGE":
		return PercentOf(subtotal, value)
	case "FIXED":
		if value > subtotal {
			return subtotal
		}
		return value
	}
	return subtotal
}
