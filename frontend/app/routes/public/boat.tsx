import { data, Link } from "react-router";

import type { Route } from "./+types/boat";
import { AnchorIcon, BathIcon, BeamIcon, BedIcon, CalendarIcon, Card, ClockIcon, Container, CrownIcon, FacilityIcon, GaugeIcon, HelmIcon, MapPinIcon, Money, MoonIcon, RouteIcon, RulerIcon, SailboatIcon, SunIcon, TagIcon, UsersIcon } from "~/components/ui";
import { CharterWidget } from "~/features/public/charter-widget";
import { Breadcrumbs, FaqList, Gallery, Meta, PolicyView, PublicErrorBoundary, RatingLine, ReviewList, ReviewSummary, Section, SectionError, tapLink, unitKey, type ReviewStats } from "~/features/public/components";
import { DepartureList } from "~/features/public/departures";
import { NO_STORE, alternatePaths, crumbsLd, firstImageUrl, loadBySlug, loadOptional, noStoreHeaders, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { api } from "~/lib/api";
import { localePath } from "~/lib/config";
import { formatDuration, formatNumber, minutesToClock, zoneLabel } from "~/lib/format";
import { translate, useLocale, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { BoatDetail, Departure, Faq, PublicArea, Review } from "~/lib/types";

export async function loader({ request, params }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const boat = await loadBySlug<BoatDetail>(request, "/boats", "/boats", params.slug);
  const [reviewPage, faqs, departures] = await Promise.all([
    api<Review[], { stats: ReviewStats | null }>("/reviews", { request, query: { locale, boat_id: boat.id, per_page: 6 } }).catch(() => null),
    loadOptional<Faq[]>("/faqs", request, { boat_id: boat.id }),
    loadOptional<Departure[]>("/departures", request, { boat_id: boat.id }),
  ]);
  return data(
    { locale, boat, reviews: reviewPage?.data ?? null, reviewStats: reviewPage?.meta?.stats ?? null, faqs, departures: departures?.slice(0, 6) ?? null, alternatePaths: alternatePaths("/boats", boat.alternates) },
    { headers: NO_STORE },
  );
}

export const headers = noStoreHeaders;

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  if (!loaderData) return [];
  const { locale, boat } = loaderData;
  const origin = root?.origin ?? "";
  return buildMeta({
    origin,
    locale,
    title: boat.seo_title || boat.name,
    description: boat.seo_description || boat.summary,
    path: `/boats/${boat.slug}`,
    alternates: loaderData.alternatePaths,
    image: firstImageUrl(boat.gallery[0] ?? boat.thumbnail),
    jsonLd: [
      crumbsLd(origin, locale, [
        { name: translate(locale, "public.breadcrumb.home"), path: "/" },
        { name: translate(locale, "public.boats.title"), path: "/boats" },
        { name: boat.name, path: `/boats/${boat.slug}` },
      ]),
    ],
  });
}

function Specs({ boat }: { boat: BoatDetail }) {
  const t = useT();
  const locale = useLocale();
  const zone = zoneLabel(boat.home_port.timezone);
  const meters = (cm: number) => t("public.boats.length", { meters: formatNumber(cm / 100, locale) });
  const rows: [typeof AnchorIcon, string, string][] = [
    [SailboatIcon, t("public.boat.spec_category"), boat.category],
    [CrownIcon, t("public.boat.spec_class"), boat.class],
    [UsersIcon, t("public.boat.spec_capacity"), t("common.units.pax_max", { count: boat.max_passengers })],
    [RulerIcon, t("public.boat.spec_length"), boat.length_cm ? meters(boat.length_cm) : ""],
    [BeamIcon, t("public.boat.spec_beam"), boat.beam_cm ? meters(boat.beam_cm) : ""],
    [CalendarIcon, t("public.boat.spec_year"), boat.year_built ? String(boat.year_built) : ""],
    [BedIcon, t("public.boat.spec_cabins"), boat.cabins ? formatNumber(boat.cabins, locale) : ""],
    [BathIcon, t("public.boat.spec_bathrooms"), boat.bathrooms ? formatNumber(boat.bathrooms, locale) : ""],
    [GaugeIcon, t("public.boat.spec_speed"), boat.speed_knots ? t("public.boat.spec_speed_value", { knots: boat.speed_knots }) : ""],
    [HelmIcon, t("public.boat.spec_crew"), boat.crew_count ? formatNumber(boat.crew_count, locale) : ""],
    [AnchorIcon, t("public.boat.spec_home_port"), boat.home_port.name ? `${boat.home_port.name} (${zone})` : ""],
    [ClockIcon, t("public.boat.spec_hours"), t("public.boat.spec_hours_value", { from: minutesToClock(boat.operating_start_minute), to: minutesToClock(boat.operating_end_minute), zone })],
    [MoonIcon, t("public.boat.spec_overnight"), t(boat.overnight_allowed ? "common.actions.yes" : "common.actions.no")],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-3">
      {rows
        .filter(([, , v]) => v)
        .map(([Icon, k, v]) => (
          <div key={k} className="flex items-start gap-3">
            <Icon className="mt-0.5 size-6 shrink-0 text-accent-icon" />
            <div className="min-w-0">
              <dt className="text-sm text-muted">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          </div>
        ))}
    </dl>
  );
}

function RateIcon({ unit }: { unit: string }) {
  const Icon = unit === "HOURLY" ? ClockIcon : unit === "DAILY" ? SunIcon : TagIcon;
  return <Icon className="size-6 shrink-0 text-accent-icon" />;
}

function Areas({ areas }: { areas: PublicArea[] }) {
  const t = useT();
  const decks = new Map<string, PublicArea[]>();
  for (const a of areas) {
    const key = a.deck_label || "";
    decks.set(key, [...(decks.get(key) ?? []), a]);
  }
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{t("public.boat.areas_hint")}</p>
      {[...decks.entries()].map(([deck, list]) => (
        <div key={deck}>
          <h3 className="font-semibold">{deck || t("public.boat.deck_other")}</h3>
          <ul className="mt-2 grid gap-3 sm:grid-cols-2">
            {list.map((a) => (
              <li key={a.id}>
                <Card className="h-full text-sm">
                  <p className="font-medium">{a.name}</p>
                  {a.description && <p className="mt-1 text-muted">{a.description}</p>}
                  <ul className="mt-2">
                    <Meta icon={UsersIcon}>{t("public.boat.area_pax", { min: a.min_pax, max: a.max_pax })}</Meta>
                  </ul>
                  {a.facilities.length > 0 && <p className="mt-1 text-muted">{a.facilities.map((f) => f.name).join(", ")}</p>}
                </Card>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export default function Boat({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { boat, reviews, reviewStats, faqs, departures } = loaderData;
  const kind = [boat.category, boat.class].filter(Boolean).join(", ");
  return (
    <Container className="pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.boats.title"), path: "/boats" }, { name: boat.name }]} />
      <header className="pb-4">
        <h1 className="font-display text-[clamp(2rem,1.5rem+1.5vw,3rem)] font-normal leading-tight">{boat.name}</h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm">
          {kind && <span className="text-accent-text">{kind}</span>}
          {boat.review_count > 0 && (
            <a href="#reviews" className={tapLink}>
              <RatingLine rating={boat.rating} count={boat.review_count} />
            </a>
          )}
        </p>
        {boat.summary && <p className="mt-2 text-muted">{boat.summary}</p>}
      </header>
      <Gallery images={boat.gallery} fallback={boat.thumbnail} />
      <div className="mt-6 grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          {boat.description && (
            <Section title={t("public.boat.overview")} id="overview">
              <p className="whitespace-pre-line">{boat.description}</p>
            </Section>
          )}
          <Section title={t("public.boat.specs")} id="specs">
            <Specs boat={boat} />
          </Section>
          {boat.rates.length > 0 && (
            <Section title={t("public.boat.rates")} id="rates">
              <ul className="space-y-2">
                {boat.rates.map((r) => (
                  <li key={r.rate_unit} className="flex items-center gap-3">
                    <RateIcon unit={r.rate_unit} />
                    <span>
                      <Money amount={r.price} className="font-semibold" /> <span className="text-muted">{t(unitKey(r.rate_unit))}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {boat.facilities.length > 0 && (
            <Section title={t("public.boat.facilities")} id="facilities">
              <ul className="grid grid-cols-2 gap-x-6 gap-y-3 xl:grid-cols-3">
                {boat.facilities.map((f) => (
                  <li key={f.id} className="flex items-center gap-3">
                    <FacilityIcon name={f.icon} className="size-6 shrink-0 text-accent-icon" />
                    {f.name}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {boat.areas.length > 0 && (
            <Section title={t("public.boat.areas")} id="areas">
              <Areas areas={boat.areas} />
            </Section>
          )}
          {boat.routes.length > 0 && (
            <Section title={t("public.boat.routes")} id="routes">
              <ul className="space-y-3">
                {boat.routes.map((r) => (
                  <li key={r.id} className="flex items-start gap-3">
                    <RouteIcon className="mt-0.5 size-6 shrink-0 text-accent-icon" />
                    <span>
                      <Link to={localePath(locale, `/routes/${r.slug}`)} className={`${tapLink} font-medium text-primary`}>
                        {r.name}
                      </Link>
                      <span className="block text-sm text-muted">{formatDuration(r.min_duration_minutes ?? r.duration_minutes, locale)}</span>
                      {r.fixed_price !== null && (
                        <span className="block text-sm">
                          {t("public.boat.route_fixed_price")}: <Money amount={r.fixed_price} />
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {boat.regions.length > 0 && (
            <Section title={t("public.boat.regions")} id="regions">
              <ul className="flex flex-wrap gap-x-6 gap-y-2">
                {boat.regions.map((r) => (
                  <Meta key={r.id} icon={MapPinIcon}>
                    <Link to={localePath(locale, `/destinations/${r.slug}`)} className={`${tapLink} text-primary`}>
                      {r.name}
                    </Link>
                  </Meta>
                ))}
              </ul>
            </Section>
          )}
          <Section title={t("public.policy.title")} id="policy">
            <PolicyView policy={boat.policy} />
          </Section>
          <Section title={t("public.boat.departures")} id="departures">
            {departures === null ? (
              <SectionError />
            ) : departures.length === 0 ? (
              <p className="text-sm text-muted">{t("public.boat.departures_empty")}</p>
            ) : (
              <DepartureList departures={departures} showBoat={false} />
            )}
          </Section>
          <Section title={t("public.boat.reviews")} id="reviews">
            {reviewStats && reviewStats.total > 0 && <ReviewSummary stats={reviewStats} />}
            {reviews === null ? <SectionError /> : <ReviewList reviews={reviews} />}
          </Section>
          {faqs === null ? (
            <Section title={t("public.boat.faqs")} id="faqs">
              <SectionError />
            </Section>
          ) : (
            faqs.length > 0 && (
              <Section title={t("public.boat.faqs")} id="faqs">
                <FaqList faqs={faqs} />
              </Section>
            )
          )}
        </div>
        <aside className="order-first lg:sticky lg:top-20 lg:order-none lg:self-start" id="book">
          <CharterWidget boat={boat} />
        </aside>
      </div>
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
