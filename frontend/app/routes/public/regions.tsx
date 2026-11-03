import type { Route } from "./+types/regions";
import { Container, EmptyState } from "~/components/ui";
import { CardGrid, PageHero, PublicErrorBoundary, RegionCardItem } from "~/features/public/components";
import { crumbsLd, load, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { RegionCard } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: requestLocale(request), regions: await load<RegionCard[]>("/regions", request) };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const origin = root?.origin ?? "";
  const title = translate(locale, "public.regions.title");
  return buildMeta({
    origin,
    locale,
    title,
    description: translate(locale, "public.regions.description"),
    path: "/destinations",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: title, path: "/destinations" }])],
  });
}

export default function Regions({ loaderData }: Route.ComponentProps) {
  const t = useT();
  return (
    <>
      <PageHero title={t("public.regions.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.regions.title") }]} />
      <Container className="pb-8 pt-6">
        {loaderData.regions.length === 0 ? (
          <EmptyState title={t("public.regions.empty_title")} />
        ) : (
          <CardGrid>
            {loaderData.regions.map((r, i) => (
              <RegionCardItem key={r.id} region={r} priority={i < 3} />
            ))}
          </CardGrid>
        )}
      </Container>
    </>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
