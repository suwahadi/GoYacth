import { Outlet, useLocation } from "react-router";

import { ToastProvider } from "~/components/ui";
import { CookieConsent, SiteFooter, SiteHeader } from "~/features/public/site-chrome";
import { splitLocale } from "~/lib/config";

export default function PublicLayout() {
  const { pathname } = useLocation();
  return (
    <ToastProvider>
      <SiteHeader />
      <main id="main" className="min-h-[60vh]">
        <Outlet />
      </main>
      <SiteFooter flush={splitLocale(pathname).path === "/"} />
      <CookieConsent />
    </ToastProvider>
  );
}
