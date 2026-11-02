import type { Route } from "./+types/packages";
import { ButtonLink, Container, EmptyState } from "~/components/ui";
import { CardGrid, PackageCardItem, PageHero, PublicErrorBoundary } from "~/features/public/components";
import { crumbsLd, load, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { localePath } from "~/lib/config";
import { translate, useLocale, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { PackageCard } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: requestLocale(request), packages: await load<PackageCard[]>("/packages", request) };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const origin = root?.origin ?? "";
  const title = translate(locale, "public.packages.title");
  return buildMeta({
    origin,
    locale,
    title,
    description: translate(locale, "public.packages.description"),
    path: "/packages",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: title, path: "/packages" }])],
  });
}

export default function Packages({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  return (
    <>
      <PageHero title={t("public.packages.title")} intro={t("public.packages.intro")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.packages.title") }]} />
      <Container className="pb-8 pt-6">
        {loaderData.packages.length === 0 ? (
          <EmptyState
            title={t("public.packages.empty_title")}
            body={t("public.packages.empty_body")}
            action={<ButtonLink to={localePath(locale, "/boats")}>{t("public.home.browse_boats")}</ButtonLink>}
          />
        ) : (
          <CardGrid>
            {loaderData.packages.map((p, i) => (
              <PackageCardItem key={p.id} pkg={p} priority={i < 3} />
            ))}
          </CardGrid>
        )}
      </Container>
    </>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
