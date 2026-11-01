import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";

export type Localized<T> = Record<Locale, T>;

// localized builds one editable value per supported locale, filled from the API's translation map
// (keyed by locale) where present.
export function localized<T extends object>(factory: () => T, raw?: unknown): Localized<T> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, Partial<T>>) : {};
  const out = {} as Localized<T>;
  for (const loc of LOCALES) {
    const base = factory();
    const given = src[loc];
    if (given && typeof given === "object") {
      for (const k of Object.keys(base) as (keyof T)[]) {
        const v = given[k];
        if (v !== undefined && v !== null) base[k] = v as T[keyof T];
      }
    }
    out[loc] = base;
  }
  return out;
}

export function localizedText(raw?: unknown): Localized<string> {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out = {} as Localized<string>;
  for (const loc of LOCALES) out[loc] = typeof src[loc] === "string" ? (src[loc] as string) : "";
  return out;
}

// compactLocales drops locales the admin left completely empty; the API validates every locale it
// receives, and public pages fall back to the default locale for missing ones.
export function compactLocales<T>(m: Localized<T>, isEmpty: (t: T) => boolean): Partial<Record<Locale, T>> {
  const out: Partial<Record<Locale, T>> = {};
  for (const loc of LOCALES) {
    if (loc === DEFAULT_LOCALE || !isEmpty(m[loc])) out[loc] = m[loc];
  }
  return out;
}

export function allBlank(obj: object): boolean {
  return Object.values(obj).every((v) => (Array.isArray(v) ? v.length === 0 : typeof v === "string" ? v.trim() === "" : v === null || v === undefined));
}

// nameOf reads a display label from a translation map, preferring the default locale.
export function nameOf(raw: unknown, key = "name"): string {
  if (!raw || typeof raw !== "object") return "";
  const m = raw as Record<string, Record<string, unknown> | string>;
  const pick = (v: unknown) => (typeof v === "string" ? v : v && typeof v === "object" ? String((v as Record<string, unknown>)[key] ?? "") : "");
  const first = pick(m[DEFAULT_LOCALE]);
  if (first) return first;
  for (const v of Object.values(m)) {
    const s = pick(v);
    if (s) return s;
  }
  return "";
}

// localesWithIssues lists locales that have a field error or lack a required value, for the
// indicator on translation tabs.
export function localesWithIssues<T>(m: Localized<T>, required: (keyof T)[], errors: Record<string, string>, prefix = "translations"): Locale[] {
  return LOCALES.filter((loc) => {
    if (Object.keys(errors).some((k) => k === `${prefix}.${loc}` || k.startsWith(`${prefix}.${loc}.`))) return true;
    return required.some((k) => {
      const v = m[loc][k];
      return typeof v === "string" ? v.trim() === "" : v === null || v === undefined;
    });
  });
}
