import { useEffect, useState } from "react";
import { NavLink, Outlet, redirect, useLocation } from "react-router";

import type { Route } from "./+types/layout";
import { ChevronDownIcon, Drawer, Dropdown, DropdownItem, MenuIcon, ToastProvider, buttonClass, cn } from "~/components/ui";
import { ApiError, apiData, readCookie } from "~/lib/api";
import { adminT, type AdminKey } from "~/lib/i18n";
import type { Me } from "~/lib/types";

// Every admin page requires an ADMIN session. The API enforces this too; the check here only
// avoids rendering the shell for someone who cannot use it.
export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  try {
    const me = await apiData<Me>("/auth/me", { request });
    if (me.role !== "ADMIN") throw new Response("Forbidden", { status: 403 });
    return { me };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      throw redirect(`/admin/login?return_to=${encodeURIComponent(url.pathname + url.search)}`);
    }
    throw e;
  }
}

export function headers() {
  return { "Cache-Control": "private, no-store" };
}

export function meta() {
  return [{ title: "Admin | GoYacht" }, { name: "robots", content: "noindex, nofollow" }];
}

export const adminNav: { to: string; key: AdminKey; end?: boolean }[] = [
  { to: "/admin", key: "nav.overview", end: true },
  { to: "/admin/calendar", key: "nav.calendar" },
  { to: "/admin/bookings", key: "nav.bookings" },
  { to: "/admin/departures", key: "nav.departures" },
  { to: "/admin/boats", key: "nav.boats" },
  { to: "/admin/fleet", key: "nav.fleet" },
  { to: "/admin/locations", key: "nav.locations" },
  { to: "/admin/packages", key: "nav.packages" },
  { to: "/admin/pricing", key: "nav.pricing" },
  { to: "/admin/policies", key: "nav.policies" },
  { to: "/admin/payments", key: "nav.payments" },
  { to: "/admin/refunds", key: "nav.refunds" },
  { to: "/admin/partners", key: "nav.partners" },
  { to: "/admin/customers", key: "nav.customers" },
  { to: "/admin/content", key: "nav.content" },
  { to: "/admin/reviews", key: "nav.reviews" },
  { to: "/admin/media", key: "nav.media" },
  { to: "/admin/reports", key: "nav.reports" },
  { to: "/admin/settings", key: "nav.settings" },
  { to: "/admin/audit", key: "nav.audit" },
  { to: "/admin/account", key: "nav.account" },
];

function Nav() {
  return (
    <nav aria-label="Admin" className="flex flex-col gap-0.5 text-sm">
      {adminNav.map((n) => (
        <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => cn("rounded px-3 py-3 lg:py-1.5", isActive ? "bg-primary text-primary-fg" : "hover:bg-surface-2")}>
          {adminT(n.key)}
        </NavLink>
      ))}
    </nav>
  );
}

// The avatar holds the account actions. Sign out sits below a rule, away from the links, so it is
// not tapped by mistake.
function AccountMenu({ me }: { me: Me }) {
  const initial = (me.full_name || me.email).trim().charAt(0).toUpperCase();
  return (
    <Dropdown
      triggerClassName="flex h-11 cursor-pointer items-center gap-1 rounded-full border border-control bg-surface pl-1 pr-2 hover:bg-surface-2"
      label={
        <>
          <span className="grid size-9 place-items-center rounded-full bg-primary text-sm font-semibold text-primary-fg" aria-hidden="true">
            {initial}
          </span>
          <span className="sr-only">{adminT("nav.account_menu")}</span>
          <ChevronDownIcon className="size-4" />
        </>
      }
    >
      <div className="border-b border-border px-3 py-2 text-sm">
        {me.full_name && <p className="font-medium">{me.full_name}</p>}
        <p className="text-muted">{me.email}</p>
      </div>
      <DropdownItem href="/admin/account">{adminT("nav.account")}</DropdownItem>
      <DropdownItem href="/">{adminT("nav.view_site")}</DropdownItem>
      <div role="separator" className="my-1 border-t border-border" />
      <DropdownItem
        onClick={async () => {
          await fetch("/api/v1/auth/logout", { method: "POST", headers: { "X-CSRF-Token": readCookie("gy_csrf") ?? "" }, credentials: "same-origin" });
          window.location.href = "/";
        }}
      >
        {adminT("nav.sign_out")}
      </DropdownItem>
    </Dropdown>
  );
}

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setOpen(false), [location.pathname]);
  return (
    <ToastProvider>
      <div data-theme="light" className="min-h-screen bg-bg text-fg">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-surface px-4">
          <button type="button" className={cn(buttonClass("secondary", "sm"), "lg:hidden")} onClick={() => setOpen(true)}>
            <MenuIcon className="size-5" />
            {adminT("nav.menu")}
          </button>
          <a href="/admin" className="truncate font-bold text-primary">
            GoYacht {adminT("nav.admin")}
          </a>
          <div className="ml-auto">
            <AccountMenu me={loaderData.me} />
          </div>
        </header>
        <div className="flex">
          <aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r border-border bg-surface p-3 lg:block">
            <Nav />
          </aside>
          <Drawer open={open} onClose={() => setOpen(false)} title={adminT("nav.menu")}>
            <Nav />
          </Drawer>
          <main className="min-w-0 flex-1 p-4 lg:p-6">
            <Outlet />
          </main>
        </div>
      </div>
    </ToastProvider>
  );
}
