import { describe, expect, it } from "vitest";

import { addDays, checkoutUrl, startTimeOptions, todayInZone, tripMinutes, unitOptions, zonedMidnightUTC } from "./booking-options";

describe("startTimeOptions", () => {
  it("steps every 15 minutes and leaves room for the trip before closing", () => {
    const opts = startTimeOptions({ operatingStartMinute: 7 * 60, operatingEndMinute: 10 * 60, durationMinutes: 120, overnightAllowed: false });
    expect(opts).toEqual(["07:00", "07:15", "07:30", "07:45", "08:00"]);
  });

  it("rounds an odd opening minute up to the next step", () => {
    const opts = startTimeOptions({ operatingStartMinute: 7 * 60 + 5, operatingEndMinute: 8 * 60, durationMinutes: 0, overnightAllowed: false });
    expect(opts).toEqual(["07:15", "07:30", "07:45"]);
  });

  it("ignores trip length for overnight boats", () => {
    const opts = startTimeOptions({ operatingStartMinute: 22 * 60, operatingEndMinute: 24 * 60, durationMinutes: 600, overnightAllowed: true });
    expect(opts).toEqual(["22:00", "22:15", "22:30", "22:45", "23:00", "23:15", "23:30", "23:45"]);
  });

  it("returns nothing when the trip cannot fit", () => {
    expect(startTimeOptions({ operatingStartMinute: 9 * 60, operatingEndMinute: 10 * 60, durationMinutes: 180, overnightAllowed: false })).toEqual([]);
  });
});

describe("unitOptions", () => {
  const base = { routeMinDurationMinutes: 0, operatingStartMinute: 8 * 60, operatingEndMinute: 18 * 60, overnightAllowed: false };

  it("respects rate limits, route minimum and operating window for hourly rates", () => {
    const rate = { rate_unit: "HOURLY" as const, price: 1, min_units: 2, max_units: 12 };
    expect(unitOptions({ ...base, rate, routeMinDurationMinutes: 150 })).toEqual([3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("allows multi-day only for overnight boats", () => {
    const rate = { rate_unit: "DAILY" as const, price: 1, min_units: 1, max_units: 3 };
    expect(unitOptions({ ...base, rate })).toEqual([1]);
    expect(unitOptions({ ...base, rate, overnightAllowed: true })).toEqual([1, 2, 3]);
  });

  it("has a single unit for fixed trips", () => {
    expect(unitOptions({ ...base, rate: { rate_unit: "FIXED", price: 1, min_units: 1, max_units: 1 } })).toEqual([1]);
  });
});

describe("tripMinutes", () => {
  it("derives the length from the rate unit", () => {
    expect(tripMinutes("HOURLY", 3, 90)).toBe(180);
    expect(tripMinutes("FIXED", 1, 90)).toBe(90);
    expect(tripMinutes("DAILY", 2, 90)).toBe(0);
  });
});

describe("dates in the port time zone", () => {
  it("returns the local calendar date", () => {
    const instant = new Date("2026-12-31T17:30:00Z");
    expect(todayInZone("Asia/Makassar", instant)).toBe("2027-01-01");
    expect(todayInZone("UTC", instant)).toBe("2026-12-31");
  });

  it("converts local midnight to UTC", () => {
    expect(zonedMidnightUTC("2026-12-12", "Asia/Makassar").toISOString()).toBe("2026-12-11T16:00:00.000Z");
    expect(zonedMidnightUTC("2026-12-12", "Asia/Jayapura").toISOString()).toBe("2026-12-11T15:00:00.000Z");
  });

  it("adds days across month ends", () => {
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("checkoutUrl", () => {
  it("builds a private charter handoff", () => {
    const url = checkoutUrl("en", {
      mode: "PRIVATE_CHARTER",
      boatSlug: "ocean-majesty",
      pax: 4,
      boatId: "b1",
      routeId: "r1",
      date: "2026-12-12",
      startTime: "09:00",
      rateUnit: "HOURLY",
      units: 3,
    });
    expect(url).toBe("/checkout?mode=PRIVATE_CHARTER&boat_slug=ocean-majesty&pax=4&boat_id=b1&route_id=r1&date=2026-12-12&start_time=09%3A00&rate_unit=HOURLY&units=3");
  });

  it("builds a departure package handoff under the locale prefix", () => {
    const url = checkoutUrl("id", { mode: "DEPARTURE", boatSlug: "kapal", pax: 2, departureSlotId: "s1", packageId: "p1", packageOfferingId: "o1" });
    const u = new URL(url, "https://x.test");
    expect(u.pathname).toBe("/id/checkout");
    expect(Object.fromEntries(u.searchParams)).toEqual({ mode: "DEPARTURE", boat_slug: "kapal", pax: "2", departure_slot_id: "s1", package_id: "p1", package_offering_id: "o1" });
  });

  it("builds a charter package handoff without rate fields or prices", () => {
    const url = checkoutUrl("en", { mode: "PRIVATE_CHARTER", boatSlug: "b", pax: 2, boatId: "b1", routeId: "r1", date: "2026-12-12", startTime: "10:00", packageId: "p1", packageOfferingId: "o1" });
    const p = new URL(url, "https://x.test").searchParams;
    expect(p.has("rate_unit")).toBe(false);
    expect(p.has("price")).toBe(false);
    expect(p.get("package_offering_id")).toBe("o1");
  });
});
