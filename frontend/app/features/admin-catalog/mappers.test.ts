import { describe, expect, it } from "vitest";

import { boatDTO, boatForm, cancellationPolicyDTO, cancellationPolicyForm, packageDTO, packageForm, paymentPolicyDTO, paymentPolicyForm, promotionDTO, promotionForm, taxLineDTO } from "./mappers";
import { localesWithIssues, nameOf } from "./translations";
import type { AdminBoat, AdminPackage } from "./types";

const boat: AdminBoat = {
  id: "b1",
  code: "OM-01",
  category_id: "c1",
  class_id: "k1",
  ownership: "PARTNER",
  partner_id: "p1",
  commission_type: "PERCENTAGE",
  commission_value: 1250,
  home_port_id: "port",
  max_passengers: 20,
  length_cm: 2400,
  beam_cm: null,
  year_built: null,
  cabins: 3,
  bathrooms: 2,
  speed_knots: null,
  crew_count: 4,
  turnaround_buffer_minutes: 60,
  operating_start_minute: 420,
  operating_end_minute: 1140,
  overnight_allowed: false,
  payment_policy_id: "pp",
  cancellation_policy_id: "cp",
  sort_order: 0,
  status: "DRAFT",
  translations: { en: { name: "Ocean Majesty", slug: "ocean-majesty", summary: "", description: "", seo_title: "", seo_description: "" } },
  rates: [{ rate_unit: "HOURLY", price: 2500000, min_units: 2, max_units: 8 }],
  region_ids: ["r1"],
  routes: [{ route_id: "rt1", fixed_price: null, min_duration_minutes: 180 }],
  facility_ids: [],
  areas: [],
  thumbnail: null,
  gallery: [],
  updated_at: "2026-11-01T00:00:00Z",
};

describe("boat mapping", () => {
  it("round-trips an API boat into the same DTO values", () => {
    const f = boatForm(boat);
    expect(f.commission_value).toBe("12.5");
    expect(f.operating_start).toBe("07:00");
    expect(f.operating_end).toBe("19:00");
    const { dto, errors } = boatDTO(f);
    expect(errors).toEqual({});
    expect(dto).toMatchObject({
      commission_value: 1250,
      operating_start_minute: 420,
      operating_end_minute: 1140,
      length_cm: 2400,
      beam_cm: null,
      rates: [{ rate_unit: "HOURLY", price: 2500000, min_units: 2, max_units: 8 }],
      routes: [{ route_id: "rt1", fixed_price: null, min_duration_minutes: 180 }],
      thumbnail_id: null,
    });
    expect(Object.keys(dto.translations)).toEqual(["en"]);
  });

  it("clears partner fields for owned boats and maps local errors to API paths", () => {
    const f = { ...boatForm(boat), ownership: "OWNED" as const, operating_end: "25:00", rates: [{ rate_unit: "DAILY" as const, price: "1.000,5", min_units: "1", max_units: "1" }] };
    const { dto, errors } = boatDTO(f);
    expect(dto.partner_id).toBeNull();
    expect(dto.commission_type).toBeNull();
    expect(dto.commission_value).toBe(0);
    expect(errors).toEqual({ operating_end_minute: "INVALID", "rates.0.price": "INVALID" });
  });

  it("stores a fixed commission as whole rupiah", () => {
    const { dto } = boatDTO({ ...boatForm(boat), commission_type: "FIXED", commission_value: "500.000" });
    expect(dto.commission_value).toBe(500000);
  });
});

describe("package mapping", () => {
  const pkg: AdminPackage = {
    id: "pk",
    mode: "DEPARTURE",
    status: "PUBLISHED",
    valid_from: "2026-12-01",
    valid_until: "2026-12-31",
    sort_order: 1,
    translations: { en: { name: "NYE", slug: "nye", summary: "", description: "", seo_title: "", seo_description: "", inclusions: ["Dinner", "Fireworks"], exclusions: [] } },
    route_id: null,
    duration_minutes: null,
    departure_id: "d1",
    min_pax: 1,
    max_pax: 10,
    booking_cutoff_hours: 24,
    payment_policy_id: "pp",
    cancellation_policy_id: "cp",
    offerings: [{ id: "o1", boat_id: "b1", departure_slot_id: "s1", price: 1500000 }],
    thumbnail: null,
    gallery: [],
  };

  it("maps inclusion lines and keeps offering ids", () => {
    const f = packageForm(pkg);
    expect(f.translations.en.inclusions).toBe("Dinner\nFireworks");
    const { dto, errors } = packageDTO({ ...f, translations: { ...f.translations, id: { ...f.translations.id, name: "Malam Tahun Baru", inclusions: "Makan malam\n" } } });
    expect(errors).toEqual({});
    expect(dto.route_id).toBeNull();
    expect(dto.offerings).toEqual([{ id: "o1", boat_id: "b1", departure_slot_id: "s1", price: 1500000 }]);
    expect(dto.translations.en.inclusions).toEqual(["Dinner", "Fireworks"]);
    expect(dto.translations.id.inclusions).toEqual(["Makan malam"]);
  });

  it("requires route and drops slots for private charter packages", () => {
    const f = { ...packageForm(pkg), mode: "PRIVATE_CHARTER" as const, duration_minutes: "240" };
    const { dto, errors } = packageDTO(f);
    expect(errors).toEqual({ route_id: "REQUIRED" });
    expect(dto.departure_id).toBeNull();
    expect(dto.offerings[0].departure_slot_id).toBeNull();
  });
});

describe("policy mapping", () => {
  it("converts deposit percent to basis points", () => {
    const { dto } = paymentPolicyDTO({ ...paymentPolicyForm(), name: "Deposit", type: "DEPOSIT", deposit_value: "30", balance_due_days: "7" });
    expect(dto).toEqual({ name: "Deposit", type: "DEPOSIT", deposit_type: "PERCENTAGE", deposit_value: 3000, balance_due_days: 7, status: "ACTIVE" });
  });

  it("requires a zero-day cancellation tier and sorts tiers", () => {
    const f = cancellationPolicyForm({ id: "c", name: "Flexible", status: "ACTIVE", tiers: [{ min_days_before: 30, refund_basis_points: 10000 }], descriptions: { en: "Text" } });
    expect(cancellationPolicyDTO(f).errors).toEqual({ tiers: "MISSING_ZERO_DAY_TIER" });
    const ok = cancellationPolicyDTO({ ...f, tiers: [{ key: "a", min_days_before: "0", refund_percent: "0" }, ...f.tiers] });
    expect(ok.errors).toEqual({});
    expect(ok.dto.tiers).toEqual([
      { min_days_before: 30, refund_basis_points: 10000 },
      { min_days_before: 0, refund_basis_points: 0 },
    ]);
    expect(ok.dto.descriptions).toEqual({ en: "Text" });
  });

  it("maps promotions and tax lines", () => {
    const p = promotionDTO({ ...promotionForm(), name: "Launch", code: " launch10 ", discount_value: "10", starts_at: "2026-11-01T00:00", ends_at: "2026-12-01T00:00" });
    expect(p.errors).toEqual({});
    expect(p.dto).toMatchObject({ code: "LAUNCH10", discount_value: 1000, boat_id: null, booking_mode: null, quota: null });
    const t = taxLineDTO({ code: "pb1", percent: "11", includes_previous_lines: true, sort_order: "2", status: "ACTIVE", names: { en: "VAT", id: "" } });
    expect(t.dto).toEqual({ code: "PB1", basis_points: 1100, includes_previous_lines: true, sort_order: 2, status: "ACTIVE", names: { en: "VAT" } });
  });
});

describe("translation helpers", () => {
  it("reads names and flags incomplete locales", () => {
    expect(nameOf({ id: { name: "Kapal" }, en: { name: "Boat" } })).toBe("Boat");
    expect(nameOf({ id: { name: "Kapal" } })).toBe("Kapal");
    const f = boatForm(boat);
    expect(localesWithIssues(f.translations, ["name"], {})).toEqual(["id"]);
    expect(localesWithIssues(f.translations, ["name"], { "translations.en.slug": "SLUG_TAKEN" })).toEqual(["en", "id"]);
  });
});
