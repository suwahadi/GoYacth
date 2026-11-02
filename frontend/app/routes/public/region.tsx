import type { Route } from "./+types/region";
import { Container } from "~/components/ui";
import { BoatCardItem, PageHero, CardGrid, Gallery, PublicErrorBoundary, RouteCardItem, Section, SectionError } from "~/features/public/components";
import { alternatePaths, crumbsLd, firstImageUrl, loadBySlug, loadOptional, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatCard, Img, RegionCard, RouteCard } from "~/lib/types";

interface RegionDetail extends RegionCard {
  seo_title: string;
  seo_description: string;
  gallery: Img[];
  alternates: Record<string, string>;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const region = await loadBySlug<RegionDetail>(request, "/regions", "/destinations", params.slug);
  const [routes, boats] = await Promise.all([
    loadOptional<RouteCard[]>("/routes", request, { region_id: region.id }),
    loadOptional<BoatCard[]>("/boats", request, { region_id: region.id, per_page: 6 }),
  ]);
  return { locale, region, routes, boats, alternatePaths: alternatePaths("/destinations", region.alternates) };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  if (!loaderData) return [];
  const { locale, region } = loaderData;
  const origin = root?.origin ?? "";
  return buildMeta({
    origin,
    locale,
    title: region.seo_title || region.name,
    description: region.seo_description || region.description.slice(0, 160),
    path: `/destinations/${region.slug}`,
    alternates: loaderData.alternatePaths,
    image: firstImageUrl(region.gallery[0] ?? region.thumbnail),
    jsonLd: [
      crumbsLd(origin, locale, [
        { name: translate(locale, "public.breadcrumb.home"), path: "/" },
        { name: translate(locale, "public.regions.title"), path: "/destinations" },
        { name: region.name, path: `/destinations/${region.slug}` },
      ]),
    ],
  });
}

export default function Region({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { region, routes, boats } = loaderData;
  return (
    <>
      <PageHero title={region.name} image={region.thumbnail ?? region.gallery[0]} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.regions.title"), path: "/destinations" }, { name: region.name }]} />
      <Container className="pb-8 pt-6">
        <Gallery images={region.gallery} fallback={region.thumbnail} />
        {region.description && <p className="mt-4 whitespace-pre-line">{region.description}</p>}
        <Section title={t("public.regions.routes", { name: region.name })} id="routes">
          {routes === null ? (
            <SectionError />
          ) : routes.length === 0 ? (
            <p className="text-sm text-muted">{t("public.regions.routes_empty")}</p>
          ) : (
            <CardGrid>
              {routes.map((r) => (
                <RouteCardItem key={r.id} route={r} />
              ))}
            </CardGrid>
          )}
        </Section>
        <Section title={t("public.regions.boats", { name: region.name })} id="boats">
          {boats === null ? (
            <SectionError />
          ) : boats.length === 0 ? (
            <p className="text-sm text-muted">{t("public.regions.boats_empty")}</p>
          ) : (
            <CardGrid>
              {boats.map((b) => (
                <BoatCardItem key={b.id} boat={b} />
              ))}
            </CardGrid>
          )}
        </Section>
      </Container>
    </>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
