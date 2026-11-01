import { describe, expect, it } from "vitest";

import { emptySlot, slotIssues, toSlotPayload, toggleArea, type SlotDraft } from "./slots";

function slot(p: Partial<SlotDraft>): SlotDraft {
  return { ...emptySlot("k"), price: "100000", seat_capacity: "10", max_pax: "10", area_ids: ["a1"], ...p };
}

describe("slotIssues", () => {
  it("accepts a complete seat pool", () => {
    expect(slotIssues([slot({})])).toEqual({});
  });

  it("requires exactly one area for a private area slot", () => {
    expect(slotIssues([slot({ slot_type: "PRIVATE_AREA", area_ids: ["a1", "a2"] })]).k).toContain("EXACTLY_ONE_AREA");
    expect(slotIssues([slot({ area_ids: [] })]).k).toContain("AREA_REQUIRED");
  });

  it("flags an area used by two slots", () => {
    const issues = slotIssues([slot({ key: "s1" }), slot({ key: "s2", slot_type: "PRIVATE_AREA" })]);
    expect(issues.s1).toContain("AREA_REUSED");
    expect(issues.s2).toContain("AREA_REUSED");
  });

  it("checks numbers and pax range", () => {
    const issues = slotIssues([slot({ price: "1.5", seat_capacity: "0", min_pax: "5", max_pax: "2" })]).k;
    expect(issues).toEqual(expect.arrayContaining(["PRICE_REQUIRED", "SEATS_REQUIRED", "PAX_RANGE"]));
  });

  it("does not require seat capacity for private areas", () => {
    expect(slotIssues([slot({ slot_type: "PRIVATE_AREA", seat_capacity: "" })])).toEqual({});
  });
});

describe("toSlotPayload", () => {
  it("drops seat capacity for private areas", () => {
    expect(toSlotPayload(slot({ slot_type: "PRIVATE_AREA" }))).toEqual({ slot_type: "PRIVATE_AREA", area_ids: ["a1"], price: 100000, seat_capacity: null, min_pax: 1, max_pax: 10 });
    expect(toSlotPayload(slot({})).seat_capacity).toBe(10);
  });
});

describe("toggleArea", () => {
  it("adds and removes areas of a seat pool", () => {
    const s = toggleArea(slot({ area_ids: ["a1"] }), "a2");
    expect(s.area_ids).toEqual(["a1", "a2"]);
    expect(toggleArea(s, "a1").area_ids).toEqual(["a2"]);
  });

  it("keeps a single area for private slots", () => {
    expect(toggleArea(slot({ slot_type: "PRIVATE_AREA", area_ids: ["a1"] }), "a2").area_ids).toEqual(["a2"]);
  });
});
