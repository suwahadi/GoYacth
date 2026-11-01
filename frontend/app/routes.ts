import { type RouteConfig, index, layout, prefix, route } from "@react-router/dev/routes";

import { DEFAULT_LOCALE, LOCALES } from "./lib/config";

// Public and customer routes exist once per locale: English at the root, other locales under
// /<code>. Each copy gets its own route id because the same module is mounted several times.
function localized(locale: string) {
  const id = (name: string) => `${locale}:${name}`;
  const children = [
    index("routes/public/home.tsx", { id: id("home") }),
    route("boats", "routes/public/boats.tsx", { id: id("boats") }),
    route("boats/:slug", "routes/public/boat.tsx", { id: id("boat") }),
    route("packages", "routes/public/packages.tsx", { id: id("packages") }),
    route("packages/:slug", "routes/public/package.tsx", { id: id("package") }),
    route("departures", "routes/public/departures.tsx", { id: id("departures") }),
    route("destinations", "routes/public/regions.tsx", { id: id("regions") }),
    route("destinations/:slug", "routes/public/region.tsx", { id: id("region") }),
    route("routes/:slug", "routes/public/route.tsx", { id: id("route") }),
    route("faq", "routes/public/faq.tsx", { id: id("faq") }),
    route("p/:slug", "routes/public/page.tsx", { id: id("page") }),
    route("login", "routes/public/login.tsx", { id: id("login") }),
    route("track", "routes/booking/track.tsx", { id: id("track") }),
    route("verify/:token", "routes/booking/verify.tsx", { id: id("verify") }),
    route("orders/:id", "routes/booking/order.tsx", { id: id("order") }),
    route("orders/:id/status", "routes/booking/status.tsx", { id: id("status") }),
    route("checkout", "routes/booking/checkout.tsx", { id: id("checkout") }),
    route("account", "routes/account/layout.tsx", { id: id("account") }, [
      index("routes/account/bookings.tsx", { id: id("account-bookings") }),
      route("bookings/:id", "routes/account/booking.tsx", { id: id("account-booking") }),
      route("profile", "routes/account/profile.tsx", { id: id("account-profile") }),
    ]),
    route("*", "routes/public/not-found.tsx", { id: id("not-found") }),
  ];
  const tree = layout("routes/public/layout.tsx", { id: id("layout") }, children);
  return locale === DEFAULT_LOCALE ? [tree] : prefix(locale, [tree]);
}

export default [
  route("robots.txt", "routes/seo/robots.ts"),
  route("sitemap.xml", "routes/seo/sitemap-index.ts"),
  route("sitemap-:locale.xml", "routes/seo/sitemap.ts"),
  route("admin", "routes/admin/layout.tsx", [
    index("routes/admin/overview.tsx"),
    route("calendar", "routes/admin/calendar.tsx"),
    route("bookings", "routes/admin/bookings.tsx"),
    route("bookings/new", "routes/admin/booking-new.tsx"),
    route("bookings/:id", "routes/admin/booking.tsx"),
    route("departures", "routes/admin/departures.tsx"),
    route("departures/:id", "routes/admin/departure.tsx"),
    route("boats", "routes/admin/boats.tsx"),
    route("boats/:id", "routes/admin/boat.tsx"),
    route("fleet", "routes/admin/fleet.tsx"),
    route("locations", "routes/admin/locations.tsx"),
    route("routes/:id", "routes/admin/route-edit.tsx"),
    route("regions/:id", "routes/admin/region-edit.tsx"),
    route("packages", "routes/admin/packages.tsx"),
    route("packages/:id", "routes/admin/package.tsx"),
    route("pricing", "routes/admin/pricing.tsx"),
    route("policies", "routes/admin/policies.tsx"),
    route("payments", "routes/admin/payments.tsx"),
    route("refunds", "routes/admin/refunds.tsx"),
    route("partners", "routes/admin/partners.tsx"),
    route("customers", "routes/admin/customers.tsx"),
    route("customers/:id", "routes/admin/customer.tsx"),
    route("content", "routes/admin/content.tsx"),
    route("content/pages/:id", "routes/admin/page-edit.tsx"),
    route("reviews", "routes/admin/reviews.tsx"),
    route("media", "routes/admin/media.tsx"),
    route("reports", "routes/admin/reports.tsx"),
    route("settings", "routes/admin/settings.tsx"),
    route("audit", "routes/admin/audit.tsx"),
  ]),
  ...LOCALES.flatMap((l) => localized(l)),
] satisfies RouteConfig;
