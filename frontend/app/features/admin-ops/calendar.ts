import type { AdminBookingRow, CalendarBoat, CalendarEvent } from "./types";

export interface PlacedEvent {
  event: CalendarEvent;
  leftPct: number;
  widthPct: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

export interface BoatRow {
  boat: CalendarBoat;
  lanes: PlacedEvent[][];
  events: CalendarEvent[];
}

export type EventTone = "charter" | "departure" | "block" | "held";

export function eventTone(e: CalendarEvent): EventTone {
  if (e.status === "HELD") return "held";
  if (e.kind === "DEPARTURE") return "departure";
  if (e.kind === "BLOCK") return "block";
  return "charter";
}

// layoutCalendar positions each event as a percentage of the visible range and stacks
// overlapping events of the same boat into separate lanes so none hide each other.
export function layoutCalendar(boats: CalendarBoat[], events: CalendarEvent[], rangeStartMs: number, rangeEndMs: number): BoatRow[] {
  const span = rangeEndMs - rangeStartMs;
  return boats.map((boat) => {
    const own = events
      .filter((e) => e.boat_id === boat.id)
      .filter((e) => Date.parse(e.ends_at) > rangeStartMs && Date.parse(e.starts_at) < rangeEndMs)
      .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || Date.parse(a.ends_at) - Date.parse(b.ends_at));
    const lanes: PlacedEvent[][] = [];
    const laneEnds: number[] = [];
    for (const event of own) {
      const s = Date.parse(event.starts_at);
      const e = Date.parse(event.ends_at);
      const start = Math.max(s, rangeStartMs);
      const end = Math.min(e, rangeEndMs);
      const placed: PlacedEvent = {
        event,
        leftPct: ((start - rangeStartMs) / span) * 100,
        widthPct: Math.max(((end - start) / span) * 100, 0.5),
        clippedStart: s < rangeStartMs,
        clippedEnd: e > rangeEndMs,
      };
      let lane = laneEnds.findIndex((laneEnd) => laneEnd <= s);
      if (lane === -1) {
        lane = lanes.length;
        lanes.push([]);
        laneEnds.push(0);
      }
      lanes[lane].push(placed);
      laneEnds[lane] = e;
    }
    return { boat, lanes, events: own };
  });
}

// matchCharterBooking finds the booking behind a charter reservation. The calendar API only
// exposes the internal booking ID, while admin URLs use the public ID, so the booking is
// recognised by boat and by a reservation range that wraps it with an equal buffer on each side.
export function matchCharterBooking(event: CalendarEvent, bookings: AdminBookingRow[]): AdminBookingRow | undefined {
  const es = Date.parse(event.starts_at);
  const ee = Date.parse(event.ends_at);
  let best: AdminBookingRow | undefined;
  let bestSkew = Infinity;
  for (const b of bookings) {
    if (b.boat_id !== event.boat_id || b.mode !== "PRIVATE_CHARTER") continue;
    const bs = Date.parse(b.starts_at);
    const be = Date.parse(b.ends_at);
    if (bs < es || be > ee) continue;
    const skew = Math.abs(bs - es - (ee - be));
    if (skew < bestSkew) {
      best = b;
      bestSkew = skew;
    }
  }
  return bestSkew <= 60_000 ? best : undefined;
}
