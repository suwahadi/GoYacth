import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation, useMatches } from "react-router";

import { Button, Drawer, Dropdown, DropdownItem, ToastProvider, cn } from "~/components/ui";
import { readCookie } from "~/lib/api";
import { LOCALES, localePath, splitLocale, type Locale } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { ThemePref } from "~/lib/types";
import { useRootData } from "~/root";

export function useLink() {
  const locale = useLocale();
  return (path: string) => localePath(locale, path);
}

function setTheme(theme: ThemePref) {
  document.cookie = `gy_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  document.documentElement.dataset.theme = theme;
}

function ThemeSwitch() {
  const t = useT();
  const root = useRootData();
  const [theme, setLocal] = useState<ThemePref>(root.theme);
  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="sr-only">{t("common.theme.label")}</span>
      <select
        className="h-9 rounded-md border border-border bg-surface px-2 text-sm"
        value={theme}
        onChange={(e) => {
          const v = e.target.value as ThemePref;
          setLocal(v);
          setTheme(v);
        }}
        aria-label={t("common.theme.label")}
      >
        <option value="light">{t("common.theme.light")}</option>
        <option value="dark">{t("common.theme.dark")}</option>
        <option value="system">{t("common.theme.system")}</option>
      </select>
    </label>
  );
}

// Pages whose slug differs per language return `alternatePaths` (locale -> locale-free path)
// from their loader; the language switch uses it to land on the translated URL.
export interface WithAlternates {
  alternatePaths?: Partial<Record<Locale, string>>;
}

function useAlternatePaths(): Partial<Record<Locale, string>> | undefined {
  const matches = useMatches();
  const last = matches[matches.length - 1];
  return (last?.loaderData as WithAlternates | undefined)?.alternatePaths;
}

// LanguageSwitch keeps the current page; pages whose slugs differ per language register their
// alternates through the "alternates" handle so the switch lands on the right URL.
function LanguageSwitch({ alternates }: { alternates?: Partial<Record<Locale, string>> }) {
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const { path } = splitLocale(location.pathname);
  return (
    <nav aria-label={t("common.language.label")} className="flex items-center gap-1 text-sm">
      {LOCALES.map((l) => (
        <a
          key={l}
          href={localePath(l, alternates?.[l] ?? path) + location.search}
          hrefLang={l}
          lang={l}
          aria-current={l === locale ? "true" : undefined}
          className={cn("rounded px-2 py-1 uppercase", l === locale ? "bg-surface-2 font-semibold" : "text-muted hover:text-fg")}
        >
          {l}
        </a>
      ))}
    </nav>
  );
}

function UserMenu() {
  const t = useT();
  const link = useLink();
  const { user } = useRootData();
  const location = useLocation();
  if (!user) {
    return (
      <a href={`/api/v1/auth/google?return_to=${encodeURIComponent(location.pathname + location.search)}`} className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-fg hover:bg-primary-hover">
        {t("common.auth.sign_in")}
      </a>
    );
  }
  return (
    <Dropdown label={<span className="max-w-32 truncate">{user.full_name || user.email}</span>}>
      <DropdownItem href={link("/account")}>{t("common.nav.account")}</DropdownItem>
      <DropdownItem href={link("/account/profile")}>{user.email}</DropdownItem>
      {user.role === "ADMIN" && <DropdownItem href="/admin">{t("common.nav.admin")}</DropdownItem>}
      <LogoutItem />
    </Dropdown>
  );
}

function LogoutItem() {
  const t = useT();
  const link = useLink();
  return (
    <button
      type="button"
      role="menuitem"
      className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": readCookie("gy_csrf") ?? "" }, credentials: "same-origin" });
        window.location.href = link("/");
      }}
    >
      {t("common.auth.sign_out")}
    </button>
  );
}

const navItems = [
  { to: "/boats", key: "common.nav.boats" },
  { to: "/departures", key: "common.nav.departures" },
  { to: "/packages", key: "common.nav.packages" },
  { to: "/destinations", key: "common.nav.regions" },
  { to: "/faq", key: "common.nav.faq" },
] as const;

function CookieConsent({ ga4 }: { ga4?: string }) {
  const t = useT();
  const [choice, setChoice] = useState<string | undefined>("pending");
  useEffect(() => setChoice(readCookie("gy_consent")), []);
  useEffect(() => {
    if (choice !== "accepted" || !ga4 || document.getElementById("ga4")) return;
    const s = document.createElement("script");
    s.id = "ga4";
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ga4)}`;
    document.head.appendChild(s);
    const w = window as unknown as { dataLayer: unknown[]; gtag: (...a: unknown[]) => void };
    w.dataLayer = w.dataLayer || [];
    w.gtag = (...a: unknown[]) => w.dataLayer.push(a);
    w.gtag("js", new Date());
    w.gtag("config", ga4, { anonymize_ip: true });
  }, [choice, ga4]);
  if (!ga4 || choice !== undefined) return null;
  const decide = (v: "accepted" | "declined") => {
    document.cookie = `gy_consent=${v}; Path=/; Max-Age=15552000; SameSite=Lax`;
    setChoice(v);
  };
  return (
    <div role="dialog" aria-label={t("common.cookies.title")} className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface p-4 shadow-lg">
      <div className="mx-auto flex max-w-6xl flex-col gap-3 sm:flex-row sm:items-center">
        <p className="flex-1 text-sm">{t("common.cookies.body")}</p>
        <div className="grid grid-cols-2 gap-2 sm:w-64">
          <Button variant="secondary" onClick={() => decide("declined")}>
            {t("common.cookies.decline")}
          </Button>
          <Button onClick={() => decide("accepted")}>{t("common.cookies.accept")}</Button>
        </div>
      </div>
    </div>
  );
}

export default function PublicLayout() {
  const t = useT();
  const link = useLink();
  const root = useRootData();
  const [menu, setMenu] = useState(false);
  const location = useLocation();
  useEffect(() => setMenu(false), [location.pathname]);
  const alternates = useAlternatePaths();
  return (
    <ToastProvider>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {t("common.a11y.skip_to_content")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
          <Link to={link("/")} className="text-lg font-bold text-primary">
            GoYacht
          </Link>
          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {navItems.map((n) => (
              <NavLink key={n.to} to={link(n.to)} className={({ isActive }) => cn("rounded px-3 py-1.5 text-sm", isActive ? "bg-surface-2 font-medium" : "text-muted hover:text-fg")}>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto hidden items-center gap-3 lg:flex">
            <LanguageSwitch alternates={alternates} />
            <ThemeSwitch />
            <UserMenu />
          </div>
          <button type="button" className="ml-auto rounded-md border border-border px-3 py-1.5 text-sm lg:hidden" onClick={() => setMenu(true)} aria-label={t("common.a11y.open_menu")}>
            {t("common.nav.menu")}
          </button>
        </div>
      </header>
      <Drawer open={menu} onClose={() => setMenu(false)} title={t("common.nav.menu")}>
        <nav className="flex flex-col gap-1" aria-label="Main">
          {navItems.map((n) => (
            <NavLink key={n.to} to={link(n.to)} className="rounded px-3 py-2 hover:bg-surface-2">
              {t(n.key)}
            </NavLink>
          ))}
          <NavLink to={link("/track")} className="rounded px-3 py-2 hover:bg-surface-2">
            {t("common.nav.track")}
          </NavLink>
        </nav>
        <div className="mt-6 space-y-4 border-t border-border pt-4">
          <LanguageSwitch alternates={alternates} />
          <ThemeSwitch />
          <UserMenu />
        </div>
      </Drawer>
      <main id="main" className="min-h-[60vh]">
        <Outlet />
      </main>
      <footer className="mt-16 border-t border-border bg-surface">
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-3">
          <div>
            <p className="font-bold text-primary">GoYacht</p>
            <p className="mt-2 text-muted">{t("common.brand.tagline")}</p>
          </div>
          <div>
            <p className="font-semibold">{t("common.footer.contact")}</p>
            {root.settings.site?.email && <p className="mt-2"><a className="hover:underline" href={`mailto:${root.settings.site.email}`}>{root.settings.site.email}</a></p>}
            {root.settings.site?.phone && <p><a className="hover:underline" href={`tel:${root.settings.site.phone}`}>{root.settings.site.phone}</a></p>}
            {root.settings.site?.whatsapp && <p><a className="hover:underline" href={`https://wa.me/${root.settings.site.whatsapp.replace(/[^0-9]/g, "")}`} rel="noopener">WhatsApp</a></p>}
          </div>
          <div>
            <p className="font-semibold">{t("common.footer.legal")}</p>
            <ul className="mt-2 space-y-1">
              <li><Link className="hover:underline" to={link("/p/terms")}>{t("common.footer.terms")}</Link></li>
              <li><Link className="hover:underline" to={link("/p/privacy")}>{t("common.footer.privacy")}</Link></li>
              <li><Link className="hover:underline" to={link("/p/cancellation-policy")}>{t("common.footer.cancellation")}</Link></li>
              <li><Link className="hover:underline" to={link("/track")}>{t("common.nav.track")}</Link></li>
            </ul>
          </div>
        </div>
        <p className="border-t border-border py-4 text-center text-xs text-muted">{t("common.footer.rights", { year: new Date().getFullYear() })}</p>
      </footer>
      <CookieConsent ga4={root.settings.analytics?.ga4_id} />
    </ToastProvider>
  );
}
