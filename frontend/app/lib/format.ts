import type { Locale } from "./config";

const intlLocale: Record<Locale, string> = { en: "en-GB", id: "id-ID" };

export function formatIDR(amount: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(amount);
}

export function formatNumber(n: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale]).format(n);
}

// usdEstimate divides whole rupiah by the admin-set rate; it is display-only and never charged.
export function usdEstimate(amountIDR: number, rateIDR: number): number | null {
  if (!rateIDR || rateIDR <= 0) return null;
  return Math.round(amountIDR / rateIDR);
}

const zoneLabels: Record<string, string> = {
  "Asia/Jakarta": "WIB",
  "Asia/Pontianak": "WIB",
  "Asia/Makassar": "WITA",
  "Asia/Jayapura": "WIT",
};

export function zoneLabel(tz: string): string {
  return zoneLabels[tz] ?? tz;
}

// formatDateTime shows an instant in the departure port's time zone with its label, e.g.
// "Sat, 12 Dec 2026, 17:00 WITA".
export function formatDateTime(iso: string, tz: string, locale: Locale): string {
  const d = new Date(iso);
  const s = new Intl.DateTimeFormat(intlLocale[locale], {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
  return `${s} ${zoneLabel(tz)}`;
}

export function formatDate(iso: string, tz: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale[locale], { day: "numeric", month: "short", year: "numeric", timeZone: tz }).format(new Date(iso));
}

export function formatTime(iso: string, tz: string, locale: Locale): string {
  const s = new Intl.DateTimeFormat(intlLocale[locale], { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(new Date(iso));
  return `${s} ${zoneLabel(tz)}`;
}

export function formatPlainDate(ymd: string, locale: Locale): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Intl.DateTimeFormat(intlLocale[locale], { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(Date.UTC(y, m - 1, d));
}

export function countryName(code: string, locale: Locale): string {
  try {
    return new Intl.DisplayNames([intlLocale[locale]], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

export function formatDuration(minutes: number, locale: Locale): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const hf = new Intl.NumberFormat(intlLocale[locale], { style: "unit", unit: "hour", unitDisplay: "short" });
  const mf = new Intl.NumberFormat(intlLocale[locale], { style: "unit", unit: "minute", unitDisplay: "short" });
  if (h && m) return `${hf.format(h)} ${mf.format(m)}`;
  if (h) return hf.format(h);
  return mf.format(m);
}

export function formatBasisPoints(bp: number, locale: Locale): string {
  return new Intl.NumberFormat(intlLocale[locale], { style: "percent", maximumFractionDigits: 2 }).format(bp / 10000);
}

export function minutesToClock(m: number): string {
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}
