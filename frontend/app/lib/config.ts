// Adding a language: copy app/locales/en to app/locales/<code>, translate it, register the
// code here and in app/lib/i18n.ts. No database migration is needed.
export const LOCALES = ["en", "id"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export function isLocale(v: string | undefined | null): v is Locale {
  return !!v && (LOCALES as readonly string[]).includes(v);
}

// localePath builds a public URL for a locale: English lives at the root, others under /<code>.
export function localePath(locale: Locale, path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (locale === DEFAULT_LOCALE) return clean;
  return clean === "/" ? `/${locale}` : `/${locale}${clean}`;
}

// splitLocale returns the locale encoded in a pathname and the path without it. Client-side
// navigations load data from "<path>.data" ("/id" becomes "/id.data", "/" becomes "/_root.data"),
// so that suffix is removed first or the locale segment would not be recognized.
export function splitLocale(rawPathname: string): { locale: Locale; path: string } {
  const pathname = rawPathname.replace(/(\/_root)?\.data$/, "") || "/";
  const seg = pathname.split("/")[1];
  if (isLocale(seg) && seg !== DEFAULT_LOCALE) {
    const rest = pathname.slice(seg.length + 1);
    return { locale: seg, path: rest === "" ? "/" : rest };
  }
  return { locale: DEFAULT_LOCALE, path: pathname };
}

export const SITE_NAME = "GoYacht";
