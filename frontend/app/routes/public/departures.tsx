import { data, useSearchParams } from "react-router";

import type { Route } from "./+types/departures";
import { Container, EmptyState, Field, FilterBar, Select } from "~/components/ui";
import { Breadcrumbs, PageHeader, PublicErrorBoundary } from "~/features/public/components";
import { DepartureList } from "~/features/public/departures";
import { NO_STORE, crumbsLd, load, noStoreHeaders, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatCard, Departure, RouteCard } from "~/lib/types";

const FILTERS = ["route_id", "boat_id"] as const;

export async function loader({ request }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const params = new URL(request.url).searchParams;
  const query: Record<string, string> = {};
  for (const k of FILTERS) {
    const v = params.get(k);
    if (v) query[k] = v;
  }
  const [departures, routes, boats] = await Promise.all([
    load<Departure[]>("/departures", request, query),
    load<RouteCard[]>("/routes", request),
    load<BoatCard[]>("/boats", request, { per_page: 48 }),
  ]);
  return data({ locale, departures, routes, boats }, { headers: NO_STORE });
}

export const headers = noStoreHeaders;

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const origin = root?.origin ?? "";
  const title = translate(locale, "public.departures.title");
  return buildMeta({
    origin,
    locale,
    title,
    description: translate(locale, "public.departures.description"),
    path: "/departures",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: title, path: "/departures" }])],
  });
}

export default function Departures({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { departures, routes, boats } = loaderData;
  const [params, setParams] = useSearchParams();
  const active = FILTERS.filter((k) => params.get(k)).length;
  const setFilter = (key: (typeof FILTERS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  };
  return (
    <Container className="pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.departures.title") }]} />
      <PageHeader title={t("public.departures.title")} intro={t("public.departures.intro")} />
      <FilterBar activeCount={active} onClear={() => setParams(new URLSearchParams(), { preventScrollReset: true })}>
        <Field label={t("public.departures.filter_route")} className="md:w-56">
          {(p) => (
            <Select {...p} value={params.get("route_id") ?? ""} onChange={(e) => setFilter("route_id", e.target.value)}>
              <option value="">{t("public.departures.any")}</option>
              {routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("public.departures.filter_boat")} className="md:w-56">
          {(p) => (
            <Select {...p} value={params.get("boat_id") ?? ""} onChange={(e) => setFilter("boat_id", e.target.value)}>
              <option value="">{t("public.departures.any")}</option>
              {boats.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <div className="mt-6">
        {departures.length === 0 ? <EmptyState title={t("public.departures.empty_title")} body={t("public.departures.empty_body")} /> : <DepartureList departures={departures} />}
      </div>
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
