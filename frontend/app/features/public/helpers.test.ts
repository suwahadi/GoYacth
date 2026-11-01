import { describe, expect, it } from "vitest";

import { localizeHref, sortedTiers } from "./components";
import { slotPaxLimit } from "./departures";
import { alternatePaths } from "./loaders";
import type { DepartureSlot } from "~/lib/types";

describe("localizeHref", () => {
  it("prefixes locale-free site paths for non-default locales", () => {
    expect(localizeHref("id", "/boats")).toBe("/id/boats");
    expect(localizeHref("en", "/boats")).toBe("/boats");
  });

  it("keeps paths that already carry a locale and external links", () => {
    expect(localizeHref("id", "/id/packages")).toBe("/id/packages");
    expect(localizeHref("id", "https://example.com/x")).toBe("https://example.com/x");
    expect(localizeHref("id", "//evil.test")).toBe("//evil.test");
  });
});

describe("sortedTiers", () => {
  it("orders cancellation tiers from earliest to latest notice", () => {
    const tiers = sortedTiers([
      { min_days_before: 0, refund_basis_points: 0 },
      { min_days_before: 14, refund_basis_points: 10000 },
      { min_days_before: 7, refund_basis_points: 5000 },
    ]);
    expect(tiers.map((t) => t.min_days_before)).toEqual([14, 7, 0]);
  });
});

describe("slotPaxLimit", () => {
  const slot: DepartureSlot = {
    id: "s",
    slot_type: "SEAT_POOL",
    area_ids: [],
    area_names: [],
    price: 100,
    seat_capacity: 20,
    min_pax: 1,
    max_pax: 10,
    booked_pax: 15,
    remaining: 5,
    available: true,
  };

  it("never offers more guests than remain or the slot allows", () => {
    expect(slotPaxLimit(slot)).toBe(5);
    expect(slotPaxLimit({ ...slot, remaining: 30 })).toBe(10);
    expect(slotPaxLimit({ ...slot, remaining: 30 }, 4)).toBe(4);
  });
});

describe("alternatePaths", () => {
  it("maps translated slugs to locale-free paths for supported locales only", () => {
    expect(alternatePaths("/boats", { en: "ocean-majesty", id: "kapal-ocean-majesty", fr: "x" })).toEqual({ en: "/boats/ocean-majesty", id: "/boats/kapal-ocean-majesty" });
  });
});
