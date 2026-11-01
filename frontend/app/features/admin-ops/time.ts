// The admin date filters and the calendar grid need a single reference zone; the overview
// counters on the server also use WITA, so the dashboard defaults to it.
export const ADMIN_TZ = "Asia/Makassar";

export const ADMIN_ZONES = ["Asia/Jakarta", "Asia/Makassar", "Asia/Jayapura"] as const;

const DAY_MS = 86_400_000;

function zoneParts(ms: number, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour"), mi: get("minute"), s: get("second") };
}

function offsetMs(ms: number, tz: string): number {
  const p = zoneParts(ms, tz);
  return Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function isValidYmd(ymd: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && !Number.isNaN(Date.parse(`${ymd}T00:00:00Z`));
}

// zonedToUtc turns a wall-clock date and time in a port's zone into a UTC instant.
export function zonedToUtc(ymd: string, hhmm: string, tz: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = (hhmm || "00:00").split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  const second = guess - offsetMs(first, tz);
  return new Date(second);
}

export function zonedToUtcISO(ymd: string, hhmm: string, tz: string): string {
  return zonedToUtc(ymd, hhmm, tz).toISOString().replace(".000Z", "Z");
}

export function utcToZoned(iso: string | number, tz: string): { date: string; time: string } {
  const p = zoneParts(typeof iso === "number" ? iso : Date.parse(iso), tz);
  return { date: `${p.y}-${pad(p.m)}-${pad(p.d)}`, time: `${pad(p.h)}:${pad(p.mi)}` };
}

export function todayIn(tz: string, now: number = Date.now()): string {
  return utcToZoned(now, tz).date;
}

export function addDays(ymd: string, days: number): string {
  const t = Date.parse(`${ymd}T00:00:00Z`) + days * DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);
}

export function dayList(from: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => addDays(from, i));
}

// dayRangeUtc converts an inclusive local date range into the half-open UTC range the API takes.
export function dayRangeUtc(from: string | null, to: string | null, tz: string): { from?: string; to?: string } {
  return {
    from: from && isValidYmd(from) ? zonedToUtcISO(from, "00:00", tz) : undefined,
    to: to && isValidYmd(to) ? zonedToUtcISO(addDays(to, 1), "00:00", tz) : undefined,
  };
}

export function hoursBetween(earlierIso: string, laterIso: string): number {
  return Math.round((Date.parse(laterIso) - Date.parse(earlierIso)) / 3_600_000);
}
