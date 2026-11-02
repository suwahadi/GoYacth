import { useSearchParams } from "react-router";

import type { Route } from "./+types/boats";
import { Container, EmptyState, Field, FilterBar, Pagination, Select } from "~/components/ui";
import { BoatCardItem, Breadcrumbs, CardGrid, PageHeader, PublicErrorBoundary } from "~/features/public/components";
import { crumbsLd, load, loadPage, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatCard, Named, RegionCard } from "~/lib/types";

const FILTERS = ["region_id", "category_id", "class_id", "pax"] as const;
const PAX_PRESETS = [2, 4, 6, 8, 10, 15, 20, 30, 50];

export async function loader({ request }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const params = new URL(request.url).searchParams;
  const query: Record<string, string> = { per_page: "12" };
  for (const k of [...FILTERS, "page"]) {
    const v = params.get(k);
    if (v) query[k] = v;
  }
  const [boats, regions, categories, classes] = await Promise.all([
    loadPage<BoatCard[]>("/boats", request, query),
    load<RegionCard[]>("/regions", request),
    load<Named[]>("/categories", request),
    load<Named[]>("/classes", request),
  ]);
  return { locale, boats: boats.items, page: boats.page, regions, categories, classes };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const origin = root?.origin ?? "";
  const title = translate(locale, "public.boats.title");
  return buildMeta({
    origin,
    locale,
    title,
    description: translate(locale, "public.boats.description"),
    path: "/boats",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: title, path: "/boats" }])],
  });
}

export default function Boats({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const { boats, page, regions, categories, classes } = loaderData;
  const [params, setParams] = useSearchParams();
  // Carries the homepage search date into the charter form on the boat page.
  const date = params.get("date");
  const dateSearch = date ? `?date=${encodeURIComponent(date)}` : "";
  const active = FILTERS.filter((k) => params.get(k)).length;
  const setFilter = (key: (typeof FILTERS)[number], value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next, { preventScrollReset: true });
  };
  const categoryName = new Map(categories.map((c) => [c.id, c.name]));
  const className = new Map(classes.map((c) => [c.id, c.name]));
  const select = (key: (typeof FILTERS)[number], label: string, options: { value: string; label: string }[]) => (
    <Field label={label} className="md:w-48">
      {(p) => (
        <Select {...p} value={params.get(key) ?? ""} onChange={(e) => setFilter(key, e.target.value)}>
          <option value="">{t("public.boats.any")}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  return (
    <Container className="pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.boats.title") }]} />
      <PageHeader title={t("public.boats.title")} intro={t("public.boats.intro")} />
      <FilterBar activeCount={active} onClear={() => setParams(new URLSearchParams(), { preventScrollReset: true })}>
        {select("region_id", t("public.boats.filter_region"), regions.map((r) => ({ value: r.id, label: r.name })))}
        {select("category_id", t("public.boats.filter_category"), categories.map((c) => ({ value: c.id, label: c.name })))}
        {select("class_id", t("public.boats.filter_class"), classes.map((c) => ({ value: c.id, label: c.name })))}
        {select("pax", t("public.boats.filter_pax"), PAX_PRESETS.map((n) => ({ value: String(n), label: t("public.boats.pax_at_least", { count: n }) })))}
      </FilterBar>
      <div className="mt-6">
        {boats.length === 0 ? (
          <EmptyState title={t("public.boats.empty_title")} body={t("public.boats.empty_body")} />
        ) : (
          <CardGrid>
            {boats.map((b, i) => (
              <BoatCardItem key={b.id} boat={b} priority={i < 3} search={dateSearch} names={{ category: categoryName.get(b.category_id), class: className.get(b.class_id) }} />
            ))}
          </CardGrid>
        )}
        {page && <Pagination page={page} />}
      </div>
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
