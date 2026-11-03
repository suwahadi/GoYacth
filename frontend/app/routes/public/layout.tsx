import { Outlet, useLocation } from "react-router";

import { ToastProvider } from "~/components/ui";
import { CookieConsent, SiteFooter, SiteHeader } from "~/features/public/site-chrome";
import { splitLocale } from "~/lib/config";

// These pages end in a tinted band of their own, so the footer needs no gap or rule above it.
const FLUSH_FOOTER = new Set(["/", "/login", "/track", "/verify-email", "/reset-password"]);

export default function PublicLayout() {
  const { pathname } = useLocation();
  return (
    <ToastProvider>
      <SiteHeader />
      <main id="main" className="min-h-[60vh]">
        <Outlet />
      </main>
      <SiteFooter flush={FLUSH_FOOTER.has(splitLocale(pathname).path)} />
      <CookieConsent />
    </ToastProvider>
  );
}
