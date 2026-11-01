import { data } from "react-router";

import type { Route } from "./+types/package";
import { Badge, Container } from "~/components/ui";
import { Breadcrumbs, FaqList, Gallery, PolicyView, PublicErrorBoundary, Section } from "~/features/public/components";
import { NO_STORE, alternatePaths, crumbsLd, firstImageUrl, loadBySlug, loadOptional, noStoreHeaders, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { CharterPackageBooking, DeparturePackageBooking } from "~/features/public/package-booking";
import { formatDuration, formatPlainDate } from "~/lib/format";
import { translate, useLocale, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatDetail, Departure, Faq, PackageDetail, RouteCard } from "~/lib/types";

const MAX_OFFERING_BOATS = 6;

export async function loader({ request, params }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const pkg = await loadBySlug<PackageDetail>(request, "/packages", "/packages", params.slug);
  const faqsP = loadOptional<Faq[]>("/faqs", request, { package_id: pkg.id });
  let boats: Record<string, BoatDetail> = {};
  let departure: Departure | null = null;
  let route: RouteCard | null = null;
  if (pkg.mode === "PRIVATE_CHARTER") {
    const slugs = [...new Set(pkg.offerings.map((o) => o.boat_slug).filter((s): s is string => !!s))].slice(0, MAX_OFFERING_BOATS);
    const [details, routes] = await Promise.all([
      Promise.all(slugs.map((s) => loadOptional<BoatDetail>(`/boats/${encodeURIComponent(s)}`, request))),
      loadOptional<RouteCard[]>("/routes", request),
    ]);
    boats = Object.fromEntries(details.filter((b): b is BoatDetail => !!b && "id" in b).map((b) => [b.slug, b]));
    route = routes?.find((r) => r.id === pkg.route_id) ?? null;
  } else if (pkg.departure_id && pkg.offerings[0]) {
    // The public departures endpoint has no id filter, so the package's departure is found
    // among the open departures of its boat.
    const list = await loadOptional<Departure[]>("/departures", request, { boat_id: pkg.offerings[0].boat_id });
    departure = list?.find((d) => d.id === pkg.departure_id) ?? null;
  }
  const faqs = await faqsP;
  return data({ locale, pkg, boats, departure, route, faqs, alternatePaths: alternatePaths("/packages", pkg.alternates) }, { headers: NO_STORE });
}

export const headers = noStoreHeaders;

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  if (!loaderData) return [];
  const { locale, pkg } = loaderData;
  const origin = root?.origin ?? "";
  return buildMeta({
    origin,
    locale,
    title: pkg.seo_title || pkg.name,
    description: pkg.seo_description || pkg.summary,
    path: `/packages/${pkg.slug}`,
    alternates: loaderData.alternatePaths,
    image: firstImageUrl(pkg.gallery[0] ?? pkg.thumbnail),
    jsonLd: [
      crumbsLd(origin, locale, [
        { name: translate(locale, "public.breadcrumb.home"), path: "/" },
        { name: translate(locale, "public.packages.title"), path: "/packages" },
        { name: pkg.name, path: `/packages/${pkg.slug}` },
      ]),
    ],
  });
}

function TextList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1 pl-5 text-sm">
      {items.map((it, i) => (
        <li key={i}>{it}</li>
      ))}
    </ul>
  );
}

export default function PackagePage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { pkg, boats, departure, route, faqs } = loaderData;
  return (
    <Container className="pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.packages.title"), path: "/packages" }, { name: pkg.name }]} />
      <header className="pb-4">
        <h1 className="text-2xl font-bold">{pkg.name}</h1>
        <p className="mt-1">
          <Badge tone="info">{t(pkg.mode === "DEPARTURE" ? "public.packages.mode_DEPARTURE" : "public.packages.mode_PRIVATE_CHARTER")}</Badge>
        </p>
        {pkg.summary && <p className="mt-2 text-muted">{pkg.summary}</p>}
      </header>
      <Gallery images={pkg.gallery} fallback={pkg.thumbnail} />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <Section title={t("public.packages.details")} id="details">
            <ul className="space-y-1 text-sm">
              <li>{t("public.packages.valid", { from: formatPlainDate(pkg.valid_from, locale), until: formatPlainDate(pkg.valid_until, locale) })}</li>
              <li>{t("public.packages.pax_range", { min: pkg.min_pax, max: pkg.max_pax })}</li>
              {pkg.duration_minutes ? <li>{t("public.packages.duration", { duration: formatDuration(pkg.duration_minutes, locale) })}</li> : null}
              {route && <li>{t("public.packages.route", { name: route.name })}</li>}
              {pkg.booking_cutoff_hours > 0 && <li>{t("public.packages.cutoff", { hours: pkg.booking_cutoff_hours })}</li>}
            </ul>
            {pkg.description && <p className="mt-3 whitespace-pre-line">{pkg.description}</p>}
          </Section>
          {pkg.inclusions.length > 0 && (
            <Section title={t("public.packages.inclusions")} id="inclusions">
              <TextList items={pkg.inclusions} />
            </Section>
          )}
          {pkg.exclusions.length > 0 && (
            <Section title={t("public.packages.exclusions")} id="exclusions">
              <TextList items={pkg.exclusions} />
            </Section>
          )}
          <Section title={t("public.policy.title")} id="policy">
            <PolicyView policy={pkg.policy} />
          </Section>
          {faqs && faqs.length > 0 && (
            <Section title={t("public.packages.faqs")} id="faqs">
              <FaqList faqs={faqs} />
            </Section>
          )}
        </div>
        <aside className="order-first lg:sticky lg:top-20 lg:order-none lg:self-start" id="book">
          {pkg.mode === "PRIVATE_CHARTER" ? <CharterPackageBooking pkg={pkg} boats={boats} /> : <DeparturePackageBooking pkg={pkg} departure={departure} />}
        </aside>
      </div>
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
