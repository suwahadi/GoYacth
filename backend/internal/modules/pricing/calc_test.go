package pricing

import (
	"testing"
	"time"
)

func TestPercentOfRoundsHalfUp(t *testing.T) {
	cases := []struct {
		amount, bp, want int64
	}{
		{100000, 1000, 10000},
		{12345, 1100, 1358},
		{5, 1000, 1},
		{4, 1000, 0},
		{0, 1000, 0},
	}
	for _, c := range cases {
		if got := PercentOf(c.amount, c.bp); got != c.want {
			t.Errorf("PercentOf(%d,%d)=%d want %d", c.amount, c.bp, got, c.want)
		}
	}
}

func TestResolveUnitPricePriority(t *testing.T) {
	sat := time.Date(2026, 12, 12, 0, 0, 0, 0, time.UTC)
	ovs := []Override{
		{Rule: RuleWeekend, Price: 200},
		{Rule: RuleSeason, SeasonKind: "HIGH", SeasonStart: sat.AddDate(0, 0, -5), SeasonEnd: sat.AddDate(0, 0, 5), Price: 300},
		{Rule: RuleSeason, SeasonKind: "PEAK", SeasonStart: sat, SeasonEnd: sat, Price: 400},
		{Rule: RuleDate, OnDate: sat.AddDate(0, 0, 1), Price: 999},
	}
	if p, r := ResolveUnitPrice(100, ovs, sat); p != 400 || r != RuleSeason {
		t.Fatalf("expected peak season 400, got %d %s", p, r)
	}
	if p, r := ResolveUnitPrice(100, ovs, sat.AddDate(0, 0, 1)); p != 999 || r != RuleDate {
		t.Fatalf("expected date override, got %d %s", p, r)
	}
	if p, r := ResolveUnitPrice(100, ovs[:1], sat); p != 200 || r != RuleWeekend {
		t.Fatalf("expected weekend, got %d %s", p, r)
	}
	mon := time.Date(2026, 12, 14, 0, 0, 0, 0, time.UTC)
	if p, r := ResolveUnitPrice(100, ovs[:1], mon); p != 100 || r != RuleBase {
		t.Fatalf("expected base on weekday, got %d %s", p, r)
	}
}

func TestApplyTaxesServiceThenTax(t *testing.T) {
	lines, total := ApplyTaxes(1_000_000, []TaxRule{
		{Code: "SERVICE", BasisPoints: 500},
		{Code: "PB1", BasisPoints: 1000, IncludesPreviousLines: true},
	})
	if lines[0].Amount != 50_000 || lines[1].Base != 1_050_000 || lines[1].Amount != 105_000 || total != 155_000 {
		t.Fatalf("unexpected lines %+v total %d", lines, total)
	}
}

func TestPromoDiscount(t *testing.T) {
	if d := (Promo{Type: DiscountPercentage, Value: 1500}).Discount(200_000); d != 30_000 {
		t.Fatal(d)
	}
	if d := (Promo{Type: DiscountFixed, Value: 500_000}).Discount(200_000); d != 200_000 {
		t.Fatal("fixed discount must be capped", d)
	}
	if d := (Promo{Type: DiscountPrice, Value: 150_000}).Discount(200_000); d != 50_000 {
		t.Fatal(d)
	}
	if d := (Promo{Type: DiscountFixed, Value: 1000, MinSubtotal: 300_000}).Discount(200_000); d != 0 {
		t.Fatal("min subtotal not enforced", d)
	}
}

func TestDepositAndRefund(t *testing.T) {
	if d := DepositAmount(1_000_000, DepositRule{Type: "PERCENTAGE", Value: 3000}); d != 300_000 {
		t.Fatal(d)
	}
	if d := DepositAmount(1_000_000, DepositRule{Type: "FIXED", Value: 2_000_000}); d != 0 {
		t.Fatal("deposit >= total must disable deposit", d)
	}
	tiers := []Tier{{0, 0}, {3, 5000}, {8, 10000}}
	if a, _ := RefundAmount(1_000_000, tiers, 10); a != 1_000_000 {
		t.Fatal(a)
	}
	if a, _ := RefundAmount(1_000_000, tiers, 5); a != 500_000 {
		t.Fatal(a)
	}
	if a, _ := RefundAmount(1_000_000, tiers, 1); a != 0 {
		t.Fatal(a)
	}
}
