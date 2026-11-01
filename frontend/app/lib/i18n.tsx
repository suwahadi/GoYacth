import { createContext, useCallback, useContext, type ReactNode } from "react";

import enAccount from "~/locales/en/account.json";
import enAdminShell from "~/locales/en/admin.json";
import enAdminCatalog from "~/locales/en/admin-catalog.json";
import enAdminOps from "~/locales/en/admin-ops.json";
import enBooking from "~/locales/en/booking.json";
import enCommon from "~/locales/en/common.json";
import enPublic from "~/locales/en/public.json";
import enValidation from "~/locales/en/validation.json";
import idAccount from "~/locales/id/account.json";
import idBooking from "~/locales/id/booking.json";
import idCommon from "~/locales/id/common.json";
import idPublic from "~/locales/id/public.json";
import idValidation from "~/locales/id/validation.json";

import { DEFAULT_LOCALE, type Locale } from "./config";

const en = {
  common: enCommon,
  validation: enValidation,
  public: enPublic,
  booking: enBooking,
  account: enAccount,
};

export type Messages = typeof en;

// Every non-default locale must satisfy the English shape, so a missing key fails type checking.
const id: Messages = {
  common: idCommon,
  validation: idValidation,
  public: idPublic,
  booking: idBooking,
  account: idAccount,
};

const resources: Record<Locale, Messages> = { en, id };

type Leaves<T, P extends string = ""> = {
  [K in keyof T & string]: T[K] extends string ? `${P}${K}` : T[K] extends object ? Leaves<T[K], `${P}${K}.`> : never;
}[keyof T & string];

export type TKey = Leaves<Messages>;

// Admin strings are split by area (shell, operations, catalog) so they can be edited
// independently; keys are prefixed with the file's area.
const enAdmin = { ...enAdminShell, ops: enAdminOps, catalog: enAdminCatalog };
export type AdminKey = Leaves<typeof enAdmin>;
export type Vars = Record<string, string | number>;

function lookup(tree: unknown, key: string): string | undefined {
  let cur: unknown = tree;
  for (const part of key.split(".")) {
    if (cur && typeof cur === "object" && part in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return typeof cur === "string" ? cur : undefined;
}

function interpolate(msg: string, vars?: Vars): string {
  if (!vars) return msg;
  return msg.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function translate(locale: Locale, key: TKey, vars?: Vars): string {
  const msg = lookup(resources[locale], key) ?? lookup(resources[DEFAULT_LOCALE], key) ?? key;
  return interpolate(msg, vars);
}

// translateDynamic resolves keys built at runtime (status codes, error codes) and falls back to
// the provided key when the code is unknown.
export function translateDynamic(locale: Locale, key: string, fallback: TKey, vars?: Vars): string {
  const msg = lookup(resources[locale], key) ?? lookup(resources[DEFAULT_LOCALE], key);
  return msg ? interpolate(msg, vars) : translate(locale, fallback, vars);
}

// translateCode returns the translation for a runtime key, or the raw code when none exists.
export function translateCode(locale: Locale, key: string, code: string): string {
  return lookup(resources[locale], key) ?? lookup(resources[DEFAULT_LOCALE], key) ?? code;
}

export function useTCode() {
  const locale = useLocale();
  return useCallback((prefix: string, code: string) => translateCode(locale, `${prefix}.${code}`, code), [locale]);
}

// The admin dashboard is English only, but its strings still live in a locale file.
export function adminT(key: AdminKey, vars?: Vars): string {
  return interpolate(lookup(enAdmin, key) ?? key, vars);
}

const I18nContext = createContext<Locale>(DEFAULT_LOCALE);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <I18nContext.Provider value={locale}>{children}</I18nContext.Provider>;
}

export function useLocale(): Locale {
  return useContext(I18nContext);
}

export function useT() {
  const locale = useLocale();
  return useCallback((key: TKey, vars?: Vars) => translate(locale, key, vars), [locale]);
}

export function useTDynamic() {
  const locale = useLocale();
  return useCallback((key: string, fallback: TKey, vars?: Vars) => translateDynamic(locale, key, fallback, vars), [locale]);
}
