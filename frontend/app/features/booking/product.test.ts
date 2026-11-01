import { describe, expect, it } from "vitest";

import { parseCheckoutParams } from "./product";

const BOAT = "11111111-1111-4111-8111-111111111111";
const ROUTE = "22222222-2222-4222-8222-222222222222";
const SLOT = "33333333-3333-4333-8333-333333333333";
const PKG = "44444444-4444-4444-8444-444444444444";
const OFFER = "55555555-5555-4555-8555-555555555555";

const parse = (q: Record<string, string>) => parseCheckoutParams(new URLSearchParams(q));

describe("parseCheckoutParams", () => {
  it("builds a private charter product", () => {
    expect(parse({ mode: "PRIVATE_CHARTER", boat_slug: "ocean", pax: "4", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:00", rate_unit: "HOURLY", units: "3" })).toEqual({
      product: { mode: "PRIVATE_CHARTER", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:00", rate_unit: "HOURLY", units: 3 },
      pax: 4,
      boatSlug: "ocean",
    });
  });

  it("allows a fixed-rate charter without units", () => {
    expect(parse({ mode: "PRIVATE_CHARTER", pax: "2", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:15", rate_unit: "FIXED" })?.product).toEqual({
      mode: "PRIVATE_CHARTER",
      boat_id: BOAT,
      route_id: ROUTE,
      date: "2026-12-12",
      start_time: "09:15",
      rate_unit: "FIXED",
    });
  });

  it("rejects hourly charters without units", () => {
    expect(parse({ mode: "PRIVATE_CHARTER", pax: "2", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:00", rate_unit: "HOURLY" })).toBeNull();
  });

  it("builds a departure product with an optional package", () => {
    expect(parse({ mode: "DEPARTURE", pax: "1", departure_slot_id: SLOT })?.product).toEqual({ mode: "DEPARTURE", departure_slot_id: SLOT });
    expect(parse({ mode: "DEPARTURE", pax: "1", departure_slot_id: SLOT, package_id: PKG, package_offering_id: OFFER })?.product).toEqual({
      mode: "DEPARTURE",
      departure_slot_id: SLOT,
      package_id: PKG,
      package_offering_id: OFFER,
    });
  });

  it("builds a charter package product without a rate unit", () => {
    expect(parse({ mode: "PRIVATE_CHARTER", pax: "6", package_id: PKG, package_offering_id: OFFER, boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "08:00" })?.product).toEqual({
      mode: "PRIVATE_CHARTER",
      boat_id: BOAT,
      route_id: ROUTE,
      date: "2026-12-12",
      start_time: "08:00",
      package_id: PKG,
      package_offering_id: OFFER,
    });
  });

  it.each<Record<string, string>>([
    { mode: "PRIVATE_CHARTER", pax: "0", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:00", rate_unit: "FIXED" },
    { mode: "OTHER", pax: "2", departure_slot_id: SLOT },
    { mode: "DEPARTURE", pax: "2", departure_slot_id: "not-a-uuid" },
    { mode: "DEPARTURE", pax: "2", departure_slot_id: SLOT, package_id: PKG },
    { mode: "PRIVATE_CHARTER", pax: "2", boat_id: BOAT, route_id: ROUTE, date: "12/12/2026", start_time: "09:00", rate_unit: "FIXED" },
    { mode: "PRIVATE_CHARTER", pax: "2", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "25:00", rate_unit: "FIXED" },
    { mode: "PRIVATE_CHARTER", pax: "2.5", boat_id: BOAT, route_id: ROUTE, date: "2026-12-12", start_time: "09:00", rate_unit: "FIXED" },
  ])("rejects malformed input %#", (q) => {
    expect(parse(q)).toBeNull();
  });
});
