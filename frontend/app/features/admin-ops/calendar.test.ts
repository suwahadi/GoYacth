import { describe, expect, it } from "vitest";

import { eventTone, layoutCalendar, matchCharterBooking } from "./calendar";
import type { AdminBookingRow, CalendarEvent } from "./types";

const boats = [
  { id: "b1", code: "B1", name: "One" },
  { id: "b2", code: "B2", name: "Two" },
];
const start = Date.parse("2026-12-01T00:00:00Z");
const end = Date.parse("2026-12-03T00:00:00Z");

function ev(p: Partial<CalendarEvent>): CalendarEvent {
  return { boat_id: "b1", kind: "CHARTER", status: "ACTIVE", starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-01T12:00:00Z", partial: false, ...p };
}

describe("layoutCalendar", () => {
  it("places events proportionally within the range", () => {
    const rows = layoutCalendar(boats, [ev({ starts_at: "2026-12-01T12:00:00Z", ends_at: "2026-12-02T00:00:00Z" })], start, end);
    expect(rows).toHaveLength(2);
    const placed = rows[0].lanes[0][0];
    expect(placed.leftPct).toBe(25);
    expect(placed.widthPct).toBe(25);
    expect(rows[1].lanes).toHaveLength(0);
  });

  it("clips events that extend past the visible range", () => {
    const rows = layoutCalendar(boats, [ev({ starts_at: "2026-11-30T00:00:00Z", ends_at: "2026-12-01T12:00:00Z" })], start, end);
    const placed = rows[0].lanes[0][0];
    expect(placed.leftPct).toBe(0);
    expect(placed.clippedStart).toBe(true);
    expect(placed.clippedEnd).toBe(false);
  });

  it("stacks overlapping events into lanes and reuses free lanes", () => {
    const rows = layoutCalendar(
      boats,
      [
        ev({ block_id: "x", starts_at: "2026-12-01T00:00:00Z", ends_at: "2026-12-01T10:00:00Z" }),
        ev({ block_id: "y", starts_at: "2026-12-01T05:00:00Z", ends_at: "2026-12-01T15:00:00Z" }),
        ev({ block_id: "z", starts_at: "2026-12-01T10:00:00Z", ends_at: "2026-12-01T12:00:00Z" }),
      ],
      start,
      end,
    );
    expect(rows[0].lanes.map((l) => l.map((p) => p.event.block_id))).toEqual([["x", "z"], ["y"]]);
  });

  it("drops events outside the range", () => {
    const rows = layoutCalendar(boats, [ev({ starts_at: "2026-12-05T00:00:00Z", ends_at: "2026-12-06T00:00:00Z" })], start, end);
    expect(rows[0].events).toHaveLength(0);
  });
});

describe("eventTone", () => {
  it("marks unpaid holds separately from active reservations", () => {
    expect(eventTone(ev({ status: "HELD" }))).toBe("held");
    expect(eventTone(ev({ kind: "DEPARTURE" }))).toBe("departure");
    expect(eventTone(ev({ kind: "BLOCK" }))).toBe("block");
    expect(eventTone(ev({}))).toBe("charter");
  });
});

describe("matchCharterBooking", () => {
  const booking = (id: string, s: string, e: string, boat = "b1") => ({ id, boat_id: boat, mode: "PRIVATE_CHARTER", starts_at: s, ends_at: e }) as AdminBookingRow;

  it("finds the booking wrapped by the buffered reservation", () => {
    const event = ev({ starts_at: "2026-12-01T01:00:00Z", ends_at: "2026-12-01T09:00:00Z" });
    const list = [booking("other", "2026-12-01T01:00:00Z", "2026-12-01T05:00:00Z"), booking("hit", "2026-12-01T02:00:00Z", "2026-12-01T08:00:00Z"), booking("boat2", "2026-12-01T02:00:00Z", "2026-12-01T08:00:00Z", "b2")];
    expect(matchCharterBooking(event, list)?.id).toBe("hit");
  });

  it("returns nothing when no booking fits", () => {
    const event = ev({ starts_at: "2026-12-01T01:00:00Z", ends_at: "2026-12-01T09:00:00Z" });
    expect(matchCharterBooking(event, [booking("late", "2026-12-01T05:00:00Z", "2026-12-01T10:00:00Z")])).toBeUndefined();
  });
});
