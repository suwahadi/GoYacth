import { data } from "react-router";

import type { Route } from "./+types/route";
import { AnchorIcon, ClockIcon, Container, MapPinIcon } from "~/components/ui";
import { BoatCardItem, PageHero, CardGrid, Gallery, Meta, PublicErrorBoundary, Section, SectionError } from "~/features/public/components";
import { DepartureList } from "~/features/public/departures";
import { NO_STORE, alternatePaths, crumbsLd, firstImageUrl, loadBySlug, loadOptional, noStoreHeaders, requestLocale, rootFromMatches } from "~/features/public/loaders";
import type { Locale } from "~/lib/config";
import { formatDuration, zoneLabel } from "~/lib/format";
import { translate, useLocale, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatCard, Departure, Img, PortInfo, RegionCard, RouteCard } from "~/lib/types";

interface RouteStop {
  id: string;
  sort_order: number;
  name?: string;
  activity?: string;
}

interface RouteDetail extends RouteCard {
  seo_title: string;
  seo_description: string;
  departure_port: PortInfo;
  return_port: PortInfo;
  stops: RouteStop[];
  gallery: Img[];
  alternates: Record<string, string>;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const route = await loadBySlug<RouteDetail>(request, "/routes", "/routes", params.slug);
  const [regions, boats, departures] = await Promise.all([
    loadOptional<RegionCard[]>("/regions", request),
    loadOptional<BoatCard[]>("/boats", request, { route_id: route.id, per_page: 6 }),
    loadOptional<Departure[]>("/departures", request, { route_id: route.id }),
  ]);
  const region = regions?.find((r) => r.id === route.region_id) ?? null;
  return data(
    { locale, route, region, boats, departures: departures?.slice(0, 6) ?? null, alternatePaths: alternatePaths("/routes", route.alternates) },
    { headers: NO_STORE },
  );
}

export const headers = noStoreHeaders;

function crumbs(locale: Locale, route: RouteDetail, region: RegionCard | null) {
  return [
    { name: translate(locale, "public.breadcrumb.home"), path: "/" },
    { name: translate(locale, "public.regions.title"), path: "/destinations" },
    ...(region ? [{ name: region.name, path: `/destinations/${region.slug}` }] : []),
    { name: route.name, path: `/routes/${route.slug}` },
  ];
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  if (!loaderData) return [];
  const { locale, route, region } = loaderData;
  const origin = root?.origin ?? "";
  return buildMeta({
    origin,
    locale,
    title: route.seo_title || route.name,
    description: route.seo_description || route.description.slice(0, 160),
    path: `/routes/${route.slug}`,
    alternates: loaderData.alternatePaths,
    image: firstImageUrl(route.gallery[0] ?? route.thumbnail),
    jsonLd: [crumbsLd(origin, locale, crumbs(locale, route, region))],
  });
}

function Port({ label, port }: { label: string; port: PortInfo }) {
  return (
    <div className="flex items-start gap-3">
      <AnchorIcon className="mt-0.5 size-6 shrink-0 text-accent-icon" />
      <div>
        <dt className="text-muted">{label}</dt>
        <dd>
          {port.name} ({zoneLabel(port.timezone)})
          {port.address && <span className="block text-muted">{port.address}</span>}
        </dd>
      </div>
    </div>
  );
}

export default function RoutePage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { route, region, boats, departures } = loaderData;
  const items = crumbs(locale, route, region);
  return (
    <>
      <PageHero title={route.name} image={route.thumbnail ?? route.gallery[0]} crumbs={items}>
        <ul className="pt-2 text-ink-fg/85 [&_svg]:text-accent">
          <Meta icon={ClockIcon}>{t("public.route.duration", { duration: formatDuration(route.duration_minutes, locale) })}</Meta>
        </ul>
      </PageHero>
      <Container className="pb-8 pt-6">
        <Gallery images={route.gallery} fallback={route.thumbnail} />
        {route.description && <p className="mt-4 whitespace-pre-line">{route.description}</p>}
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          {route.departure_port.name && <Port label={t("public.route.departure_port")} port={route.departure_port} />}
          {route.return_port.name && <Port label={t("public.route.return_port")} port={route.return_port} />}
        </dl>
        <Section title={t("public.route.stops")} id="stops">
          {route.stops.length === 0 ? (
            <p className="text-sm text-muted">{t("public.route.stops_empty")}</p>
          ) : (
            <ol className="space-y-3">
              {route.stops.map((s) => (
                <li key={s.id} className="flex items-start gap-3">
                  <MapPinIcon className="mt-0.5 size-5 shrink-0 text-accent-icon" />
                  <span>
                    <span className="font-medium">{s.name}</span>
                    {s.activity && <span className="block text-sm text-muted">{s.activity}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
        <Section title={t("public.route.boats")} id="boats">
          {boats === null ? (
            <SectionError />
          ) : boats.length === 0 ? (
            <p className="text-sm text-muted">{t("public.route.boats_empty")}</p>
          ) : (
            <CardGrid>
              {boats.map((b) => (
                <BoatCardItem key={b.id} boat={b} />
              ))}
            </CardGrid>
          )}
        </Section>
        {departures === null ? (
          <Section title={t("public.route.departures")} id="departures">
            <SectionError />
          </Section>
        ) : (
          departures.length > 0 && (
            <Section title={t("public.route.departures")} id="departures">
              <DepartureList departures={departures} />
            </Section>
          )
        )}
      </Container>
    </>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
