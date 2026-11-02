import { NavLink, Outlet, data, useLocation, useNavigation } from "react-router";

import type { Route } from "./+types/layout";
import { Container, cn } from "~/components/ui";
import { privateHeaders, requireUser } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { localePath, splitLocale } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import { PageHero } from "~/features/public/components";

export async function loader({ request }: Route.LoaderArgs) {
  const me = await requireUser(request);
  return data({ me }, { headers: privateHeaders });
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "account.title");
}

export default function AccountLayout({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const location = useLocation();
  const navigation = useNavigation();
  const onProfile = splitLocale(location.pathname).path.startsWith("/account/profile");
  const tabs = [
    { to: localePath(locale, "/account"), label: t("account.tabs.bookings"), active: !onProfile },
    { to: localePath(locale, "/account/profile"), label: t("account.tabs.profile"), active: onProfile },
  ];
  return (
    <>
      <PageHero title={t("account.title")} intro={t("account.signed_in_as", { email: loaderData.me.email })} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("account.title"), path: "/account" }, { name: onProfile ? t("account.tabs.profile") : t("account.tabs.bookings") }]} />
      <Container className="pb-8 pt-6">
        <nav aria-label={t("account.tabs.label")} className="flex gap-1 border-b border-border">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end
              aria-current={tab.active ? "page" : undefined}
              className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", tab.active ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg")}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6" aria-busy={navigation.state === "loading" || undefined}>
          <Outlet />
        </div>
      </Container>
    </>
  );
}
