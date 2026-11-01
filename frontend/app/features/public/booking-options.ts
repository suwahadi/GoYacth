import { localePath, type Locale } from "~/lib/config";
import type { Rate } from "~/lib/types";

export const START_STEP_MINUTES = 15;
const DAY_MINUTES = 1440;

export interface StartTimeInput {
  operatingStartMinute: number;
  operatingEndMinute: number;
  // durationMinutes is the trip length; 0 means it is not known yet or not bounded by closing time.
  durationMinutes: number;
  overnightAllowed: boolean;
}

// startTimeOptions lists the HH:MM start times a customer may pick. It only narrows the picker;
// the API validates the final choice against the boat's operating hours.
export function startTimeOptions(i: StartTimeInput): string[] {
  const first = Math.ceil(i.operatingStartMinute / START_STEP_MINUTES) * START_STEP_MINUTES;
  const latest = i.overnightAllowed ? i.operatingEndMinute - START_STEP_MINUTES : i.operatingEndMinute - Math.max(i.durationMinutes, START_STEP_MINUTES);
  const out: string[] = [];
  for (let m = first; m <= latest && m < DAY_MINUTES; m += START_STEP_MINUTES) {
    out.push(clock(m));
  }
  return out;
}

function clock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export interface UnitInput {
  rate: Rate;
  routeMinDurationMinutes: number;
  operatingStartMinute: number;
  operatingEndMinute: number;
  overnightAllowed: boolean;
}

// unitOptions lists the hour or day counts the rate allows. FIXED trips have exactly one unit.
export function unitOptions(i: UnitInput): number[] {
  const { rate } = i;
  if (rate.rate_unit === "FIXED") return [1];
  let min = Math.max(1, rate.min_units);
  let max = Math.max(min, rate.max_units);
  if (rate.rate_unit === "HOURLY") {
    min = Math.max(min, Math.ceil(i.routeMinDurationMinutes / 60));
    if (!i.overnightAllowed) max = Math.min(max, Math.floor((i.operatingEndMinute - i.operatingStartMinute) / 60));
  } else if (!i.overnightAllowed) {
    max = Math.min(max, 1);
  }
  const out: number[] = [];
  for (let u = min; u <= max; u++) out.push(u);
  return out;
}

// tripMinutes is the length used to bound start times; DAILY trips run until closing time.
export function tripMinutes(rateUnit: Rate["rate_unit"], units: number, routeMinDurationMinutes: number): number {
  if (rateUnit === "HOURLY") return units * 60;
  if (rateUnit === "FIXED") return routeMinDurationMinutes;
  return 0;
}

export function range(from: number, to: number): number[] {
  const out: number[] = [];
  for (let n = Math.max(1, from); n <= to; n++) out.push(n);
  return out;
}

function zonedParts(date: Date, tz: string) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

// todayInZone returns the calendar date (YYYY-MM-DD) currently showing in the port's time zone.
export function todayInZone(tz: string, now: Date = new Date()): string {
  const p = zonedParts(now, tz);
  return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
}

export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

// zonedMidnightUTC converts local midnight of a port date to a UTC instant.
export function zonedMidnightUTC(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  const p = zonedParts(new Date(guess), tz);
  const shown = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  return new Date(guess - (shown - guess));
}

interface CheckoutBase {
  boatSlug: string;
  pax: number;
}

export type CheckoutTarget =
  | (CheckoutBase & { mode: "PRIVATE_CHARTER"; boatId: string; routeId: string; date: string; startTime: string; rateUnit: Rate["rate_unit"]; units: number })
  | (CheckoutBase & { mode: "PRIVATE_CHARTER"; boatId: string; routeId: string; date: string; startTime: string; packageId: string; packageOfferingId: string })
  | (CheckoutBase & { mode: "DEPARTURE"; departureSlotId: string; packageId?: string; packageOfferingId?: string });

// checkoutParams is the handoff contract with /checkout. Prices never travel in the URL.
export function checkoutParams(t: CheckoutTarget): [string, string][] {
  const out: [string, string][] = [
    ["mode", t.mode],
    ["boat_slug", t.boatSlug],
    ["pax", String(t.pax)],
  ];
  if (t.mode === "DEPARTURE") {
    out.push(["departure_slot_id", t.departureSlotId]);
  } else {
    out.push(["boat_id", t.boatId], ["route_id", t.routeId], ["date", t.date], ["start_time", t.startTime]);
    if ("rateUnit" in t) out.push(["rate_unit", t.rateUnit], ["units", String(t.units)]);
  }
  if ("packageId" in t && t.packageId && t.packageOfferingId) {
    out.push(["package_id", t.packageId], ["package_offering_id", t.packageOfferingId]);
  }
  return out;
}

export function checkoutUrl(locale: Locale, t: CheckoutTarget): string {
  return `${localePath(locale, "/checkout")}?${new URLSearchParams(checkoutParams(t)).toString()}`;
}
