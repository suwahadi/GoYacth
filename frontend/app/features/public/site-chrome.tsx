import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useMatches } from "react-router";

import { ArrowRightIcon, Button, ButtonLink, ChevronDownIcon, Drawer, Dropdown, DropdownItem, GlobeIcon, MenuIcon, SunIcon, UserIcon, YachtMark, cn } from "~/components/ui";
import { loadAnalytics } from "~/lib/analytics";
import { readCookie } from "~/lib/api";
import { LOCALES, localePath, splitLocale, type Locale } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { ThemePref } from "~/lib/types";
import { useRootData } from "~/root";

function useLink() {
  const locale = useLocale();
  return (path: string) => localePath(locale, path);
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

const menuTrigger = "flex h-11 cursor-pointer items-center gap-1.5 rounded-full border border-border bg-surface px-3 text-sm font-medium hover:bg-surface-2";

function LanguageMenu() {
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const alternates = useAlternatePaths();
  const { path } = splitLocale(location.pathname);
  return (
    <Dropdown
      triggerClassName={menuTrigger}
      label={
        <>
          <GlobeIcon className="size-5 text-primary" />
          <span className="sr-only">{t("common.language.label")}: </span>
          <span className="uppercase">{locale}</span>
          <ChevronDownIcon className="size-3.5" />
        </>
      }
    >
      {LOCALES.map((l) => (
        <DropdownItem key={l} href={localePath(l, alternates?.[l] ?? path) + location.search}>
          {t(`common.language.${l}`)}
        </DropdownItem>
      ))}
    </Dropdown>
  );
}

function ThemeMenu() {
  const t = useT();
  const select = (theme: ThemePref) => {
    document.cookie = `gy_theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
    document.documentElement.dataset.theme = theme;
  };
  return (
    <Dropdown
      triggerClassName={menuTrigger}
      label={
        <>
          <SunIcon className="size-5 text-primary" />
          <span className="sr-only">{t("common.theme.label")}</span>
        </>
      }
    >
      <DropdownItem onClick={() => select("light")}>{t("common.theme.light")}</DropdownItem>
      <DropdownItem onClick={() => select("dark")}>{t("common.theme.dark")}</DropdownItem>
      <DropdownItem onClick={() => select("system")}>{t("common.theme.system")}</DropdownItem>
    </Dropdown>
  );
}

function LogoutItem() {
  const t = useT();
  const link = useLink();
  return (
    <DropdownItem
      onClick={async () => {
        await fetch("/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": readCookie("gy_csrf") ?? "" }, credentials: "same-origin" });
        window.location.href = link("/");
      }}
    >
      {t("common.auth.sign_out")}
    </DropdownItem>
  );
}

function UserMenu() {
  const t = useT();
  const link = useLink();
  const { user } = useRootData();
  const location = useLocation();
  if (!user) {
    return (
      <a href={`/api/v1/auth/google?return_to=${encodeURIComponent(location.pathname + location.search)}`} className={menuTrigger}>
        <UserIcon className="size-5 text-primary" />
        {t("common.auth.sign_in")}
      </a>
    );
  }
  return (
    <Dropdown
      triggerClassName={menuTrigger}
      label={
        <>
          <UserIcon className="size-5 text-primary" />
          <span className="max-w-28 truncate">{user.full_name || user.email}</span>
        </>
      }
    >
      <DropdownItem href={link("/account")}>{t("common.nav.account")}</DropdownItem>
      <DropdownItem href={link("/account/profile")}>{user.email}</DropdownItem>
      {user.role === "ADMIN" && <DropdownItem href="/admin">{t("common.nav.admin")}</DropdownItem>}
      <LogoutItem />
    </Dropdown>
  );
}

function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 font-display text-[clamp(1.5rem,1rem+0.8vw,2rem)] leading-none tracking-[-0.02em]", className)}>
      <YachtMark className="h-[1.1em] w-[2em]" />
      GoYacht
    </span>
  );
}

const navItems = [
  { to: "/boats", key: "common.nav.boats" },
  { to: "/destinations", key: "common.nav.regions" },
  { to: "/packages", key: "common.nav.packages" },
  { to: "/departures", key: "common.nav.departures" },
  { to: "/faq", key: "common.nav.faq" },
] as const;

export function SiteHeader() {
  const t = useT();
  const link = useLink();
  const location = useLocation();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [location.pathname]);
  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        {t("common.a11y.skip_to_content")}
      </a>
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex h-[3.75rem] items-center gap-4 px-5 lg:px-[3.9vw] xl:h-[4.25rem]">
          <Link to={link("/")} className="flex h-11 shrink-0 items-center text-primary">
            <Logo />
          </Link>
          <nav className="mx-auto hidden items-center gap-5 lg:flex xl:gap-8" aria-label={t("common.nav.main")}>
            {navItems.map((n) => (
              <NavLink key={n.to} to={link(n.to)} className={({ isActive }) => cn("py-2 font-display text-[clamp(1.0625rem,0.9rem+0.25vw,1.25rem)] underline-offset-8 hover:underline", isActive && "underline decoration-accent decoration-2")}>
                {t(n.key)}
              </NavLink>
            ))}
          </nav>
          <div className="hidden shrink-0 items-center gap-2 lg:flex">
            <LanguageMenu />
            <ThemeMenu />
            <UserMenu />
            <div className="hidden 2xl:block">
              <ButtonLink to={link("/boats")} variant="accent" pill className="h-11">
                {t("common.nav.book")}
                <ArrowRightIcon className="size-4" />
              </ButtonLink>
            </div>
          </div>
          <button type="button" className="ml-auto flex h-11 cursor-pointer items-center gap-2 rounded-full border border-border px-4 text-sm font-medium lg:hidden" onClick={() => setMenu(true)} aria-label={t("common.a11y.open_menu")}>
            <MenuIcon className="size-5" />
            {t("common.nav.menu")}
          </button>
        </div>
      </header>
      <Drawer open={menu} onClose={() => setMenu(false)} title={t("common.nav.menu")}>
        <nav className="flex flex-col gap-1" aria-label={t("common.nav.main")}>
          {navItems.map((n) => (
            <NavLink key={n.to} to={link(n.to)} className="rounded px-3 py-2.5 hover:bg-surface-2">
              {t(n.key)}
            </NavLink>
          ))}
          <NavLink to={link("/track")} className="rounded px-3 py-2.5 hover:bg-surface-2">
            {t("common.nav.track")}
          </NavLink>
        </nav>
        <div className="mt-6 flex flex-wrap items-center gap-3 border-t border-border pt-4">
          <LanguageMenu />
          <ThemeMenu />
          <UserMenu />
        </div>
      </Drawer>
    </>
  );
}

const footerLink = "inline-block min-w-11 py-3 hover:underline lg:py-1";

export function SiteFooter({ flush }: { flush?: boolean }) {
  const t = useT();
  const link = useLink();
  const { settings } = useRootData();
  const site = settings.site;
  const hasContact = site?.email || site?.phone || site?.whatsapp;
  return (
    <footer className={cn("on-ink bg-ink text-ink-fg", !flush && "mt-16")}>
      <div className="px-5 pt-10 lg:px-[3.9vw]">
        <div className="grid gap-8 sm:grid-cols-2 lg:flex lg:gap-[clamp(2.5rem,1rem+4vw,6rem)]">
          <div className="sm:col-span-2 lg:mr-auto">
            <Logo className="text-[clamp(1.75rem,1rem+1.2vw,2.5rem)]" />
            <p className="mt-3 text-sm">{t("common.brand.tagline")}</p>
          </div>
          <div>
            <p className="font-semibold">{t("common.footer.quick_links")}</p>
            <ul className="mt-2 text-sm">
              {navItems
                .filter((n) => n.to !== "/departures")
                .map((n) => (
                  <li key={n.to}>
                    <Link className={footerLink} to={link(n.to)}>
                      {t(n.key)}
                    </Link>
                  </li>
                ))}
            </ul>
          </div>
          <div>
            <p className="font-semibold">{t("common.footer.company")}</p>
            <ul className="mt-2 text-sm">
              <li>
                <Link className={footerLink} to={link("/p/about")}>
                  {t("common.footer.about")}
                </Link>
              </li>
              <li>
                <Link className={footerLink} to={`${link("/")}#reviews`}>
                  {t("common.footer.reviews")}
                </Link>
              </li>
              <li>
                <Link className={footerLink} to={link("/p/contact")}>
                  {t("common.footer.contact_us")}
                </Link>
              </li>
              <li>
                <Link className={footerLink} to={link("/p/how-to-book")}>
                  {t("common.footer.how_to_book")}
                </Link>
              </li>
            </ul>
          </div>
          <div>
            <p className="font-semibold">{t("common.footer.help")}</p>
            <ul className="mt-2 text-sm">
              <li>
                <Link className={footerLink} to={link("/departures")}>
                  {t("common.nav.departures")}
                </Link>
              </li>
              <li>
                <Link className={footerLink} to={link("/track")}>
                  {t("common.nav.track")}
                </Link>
              </li>
              <li>
                <Link className={footerLink} to={link("/p/cancellation-policy")}>
                  {t("common.footer.cancellation")}
                </Link>
              </li>
            </ul>
          </div>
          {hasContact && (
            <div>
              <p className="font-semibold">{t("common.footer.contact")}</p>
              <ul className="mt-2 text-sm">
                {site?.email && (
                  <li>
                    <a className={footerLink} href={`mailto:${site.email}`}>
                      {site.email}
                    </a>
                  </li>
                )}
                {site?.phone && (
                  <li>
                    <a className={footerLink} href={`tel:${site.phone}`}>
                      {site.phone}
                    </a>
                  </li>
                )}
                {site?.whatsapp && (
                  <li>
                    <a className={footerLink} href={`https://wa.me/${site.whatsapp.replace(/[^0-9]/g, "")}`} rel="noopener">
                      WhatsApp
                    </a>
                  </li>
                )}
              </ul>
            </div>
          )}
          <div className="lg:w-[22rem] lg:border-l lg:border-ink-line lg:pl-[clamp(1.5rem,0.5rem+2vw,3rem)]">
            <p className="font-semibold">{t("common.footer.subscribe_title")}</p>
            {/* shortcut: no newsletter endpoint exists yet, so the field stays disabled and labelled until the PRD adds one. */}
            <div className="mt-3 flex h-12 items-stretch overflow-hidden rounded-xl border border-ink-line text-sm">
              <input disabled aria-label={t("common.footer.subscribe_placeholder")} placeholder={t("common.footer.subscribe_placeholder")} className="min-w-0 flex-1 cursor-not-allowed bg-transparent px-4 text-ink-fg placeholder:text-ink-muted" />
              <span className="grid w-14 place-items-center bg-accent/60 text-accent-fg" aria-hidden="true">
                <ArrowRightIcon className="size-5" />
              </span>
            </div>
            <p className="mt-2 text-sm text-ink-muted">{t("common.footer.coming_soon")}</p>
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-2 border-t border-ink-line py-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>{t("common.footer.rights", { year: new Date().getFullYear() })}</p>
          <p className="flex items-center gap-3">
            <Link className={footerLink} to={link("/p/privacy")}>
              {t("common.footer.privacy")}
            </Link>
            <span aria-hidden="true">|</span>
            <Link className={footerLink} to={link("/p/terms")}>
              {t("common.footer.terms")}
            </Link>
          </p>
        </div>
      </div>
    </footer>
  );
}

export function CookieConsent() {
  const t = useT();
  const analytics = useRootData().settings.analytics;
  const ga4 = analytics?.ga4_id;
  const gtm = analytics?.gtm_id;
  const [choice, setChoice] = useState<string | undefined>("pending");
  useEffect(() => setChoice(readCookie("gy_consent")), []);
  useEffect(() => {
    if (choice === "accepted") loadAnalytics({ ga4, gtm });
  }, [choice, ga4, gtm]);
  if ((!ga4 && !gtm) || choice !== undefined) return null;
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
