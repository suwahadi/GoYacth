import type { ReactNode, SVGProps } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";

import { BedIcon, ButtonLink, CalendarIcon, ChevronRightIcon, ClockIcon, Container, Money, PHONE_IMAGE, ResponsiveImage, RulerIcon, SealCheckIcon, UsersIcon, cn } from "~/components/ui";
import { localePath, splitLocale, DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { countryName, formatBasisPoints, formatDuration, formatIDR, formatNumber, formatPlainDate } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";

export { Gallery } from "./gallery";
import type { BoatCard, CancellationTier, Faq, Img, PackageCard, PolicySummary, RegionCard, Review, RouteCard } from "~/lib/types";

// localizeHref keeps admin-entered links on the visitor's language: locale-free site paths get
// the locale prefix, external https links are left alone.
export function localizeHref(locale: Locale, url: string): string {
  if (!url.startsWith("/") || url.startsWith("//")) return url;
  const { locale: urlLocale } = splitLocale(url);
  if (urlLocale !== DEFAULT_LOCALE || locale === DEFAULT_LOCALE) return url;
  return localePath(locale, url);
}

export function SmartLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const locale = useLocale();
  const to = localizeHref(locale, href);
  if (to.startsWith("/")) {
    return (
      <Link to={to} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={to} className={className} rel="noopener">
      {children}
    </a>
  );
}

// Padding offset by a negative margin makes a text link 44px tall without moving the layout.
export const tapLink = "-my-3 inline-block py-3 hover:underline";

export function Breadcrumbs({ items, tone = "page" }: { items: { name: string; path?: string }[]; tone?: "page" | "photo" }) {
  const t = useT();
  const locale = useLocale();
  return (
    <nav aria-label={t("public.breadcrumb.label")} className={cn("py-3 text-sm", tone === "photo" ? "text-ink-fg/85" : "text-muted")}>
      <ol className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex min-w-0 gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.path ? (
              <Link to={localePath(locale, it.path)} className={tapLink}>
                {it.name}
              </Link>
            ) : (
              <span aria-current="page" className="truncate">
                {it.name}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export type Crumb = { name: string; path?: string };

const SEA = "/home/region-islands";

// PageHero is the slim band at the top of every page except home: breadcrumbs and the title on
// a photo under a navy overlay. Detail pages pass their own cover; the rest show the sea.
export function PageHero({ title, crumbs, intro, image, children, width }: { title: string; crumbs: Crumb[]; intro?: string; image?: Img | null; children?: ReactNode; width?: string }) {
  return (
    <header className="relative isolate overflow-hidden bg-ink text-ink-fg">
      {image && image.sources.length > 0 ? (
        <ResponsiveImage image={{ ...image, alt: "" }} sizes="100vw" priority className="absolute inset-0 -z-20 size-full" />
      ) : (
        <img src={`${SEA}-1600.webp`} srcSet={`${SEA}-800.webp 800w, ${SEA}-1600.webp 1600w`} sizes="100vw" alt="" className="absolute inset-0 -z-20 size-full object-cover" />
      )}
      <div className="absolute inset-0 -z-10 bg-gradient-to-r from-ink/90 via-ink/70 to-ink/40" aria-hidden="true" />
      <Container className={cn("pb-6 pt-1 sm:pb-8", width)}>
        <Breadcrumbs items={crumbs.map((c, i) => (i === crumbs.length - 1 ? { name: c.name } : c))} tone="photo" />
        <h1 className="font-display text-[clamp(1.75rem,1.4rem+1.3vw,2.75rem)] font-normal leading-tight">{title}</h1>
        {intro && <p className="mt-1 max-w-2xl text-ink-fg/85">{intro}</p>}
        {children}
      </Container>
    </header>
  );
}

export function Section({ title, children, id, action }: { title: string; children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <section aria-labelledby={title ? id : undefined} className="mt-10">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        {title && (
          <h2 id={id} className="font-display text-2xl font-normal leading-tight">
            {title}
          </h2>
        )}
        {action}
      </div>
      {children}
    </section>
  );
}

export function CardGrid({ children }: { children: ReactNode }) {
  return <ul className="grid gap-x-6 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}

export function unitKey(unit: BoatCard["from_unit"]) {
  if (unit === "HOURLY") return "common.money.per_hour" as const;
  if (unit === "DAILY") return "common.money.per_day" as const;
  return "common.money.per_trip" as const;
}

const STAR = "M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5-5.9-3.1-5.9 3.1 1.2-6.5-4.8-4.6 6.6-.9z";
const starRow = [0, 24, 48, 72, 96].map((x) => <path key={x} transform={`translate(${x})`} d={STAR} />);

// The gold row sits in a nested svg that clips it, so 4.5 shows a half star without inline styles.
export function Stars({ rating, className }: { rating: number; className?: string }) {
  const t = useT();
  const locale = useLocale();
  const label = t("public.reviews.rating", { rating: formatNumber(Math.round(rating * 10) / 10, locale) });
  return (
    <span role="img" aria-label={label} title={label} className={cn("inline-flex align-[-0.15em]", className)}>
      <svg viewBox="0 0 120 24" className="h-[1.1em] w-[5.5em]" aria-hidden="true">
        <g className="fill-border">{starRow}</g>
        <svg width={Math.min(5, Math.max(0, rating)) * 24} height="24">
          <g className="fill-accent-icon">{starRow}</g>
        </svg>
      </svg>
    </span>
  );
}

type Icon = (p: SVGProps<SVGSVGElement>) => ReactNode;

export function Meta({ icon: Icon, children }: { icon: Icon; children: ReactNode }) {
  return (
    <li className="inline-flex items-center gap-1.5">
      <Icon className="size-4 shrink-0 text-accent-icon" />
      {children}
    </li>
  );
}

export function RatingLine({ rating, count }: { rating: number; count: number }) {
  const t = useT();
  const locale = useLocale();
  return (
    <span className="inline-flex items-center gap-2 text-sm">
      <Stars rating={rating} />
      {t("public.boats.reviews", { rating: formatNumber(Math.round(rating * 10) / 10, locale), count })}
    </span>
  );
}

function ImageCard({ href, image, title, priority, children }: { href: string; image: Img | null; title: string; priority?: boolean; children?: ReactNode }) {
  return (
    <li className="group flex h-full flex-col">
      <Link to={href} className="block overflow-hidden rounded-xl">
        <ResponsiveImage image={image} sizes={`(min-width: 1024px) 33vw, (min-width: 640px) 50vw, ${PHONE_IMAGE}`} priority={priority} className="aspect-[3/2] h-auto w-full transition-transform duration-500 motion-safe:group-hover:scale-105" />
      </Link>
      <div className="flex flex-1 flex-col gap-2 pt-4">
        <h3 className="font-display text-xl leading-tight">
          <Link to={href} className={tapLink}>
            {title}
          </Link>
        </h3>
        {children}
      </div>
    </li>
  );
}

export function BoatCardItem({ boat, names, search = "", priority }: { boat: BoatCard; names?: { category?: string; class?: string }; search?: string; priority?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const kind = [names?.category, names?.class].filter(Boolean).join(", ");
  return (
    <ImageCard href={localePath(locale, `/boats/${boat.slug}`) + search} image={boat.thumbnail} title={boat.name} priority={priority}>
      {kind && <p className="text-sm text-accent-text">{kind}</p>}
      {boat.summary && <p className="line-clamp-2 text-sm text-muted">{boat.summary}</p>}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Meta icon={UsersIcon}>{t("common.units.pax_max", { count: boat.max_passengers })}</Meta>
        {!!boat.length_cm && <Meta icon={RulerIcon}>{t("public.boats.length", { meters: formatNumber(boat.length_cm / 100, locale) })}</Meta>}
        {boat.cabins > 0 && <Meta icon={BedIcon}>{t(boat.cabins === 1 ? "public.boats.cabin" : "public.boats.cabins", { count: boat.cabins })}</Meta>}
      </ul>
      <p>{boat.review_count > 0 ? <RatingLine rating={boat.rating} count={boat.review_count} /> : <span className="text-sm text-muted">{t("public.boats.no_reviews")}</span>}</p>
      <div className="mt-auto border-t border-border pt-3">
        <FromPrice amount={boat.from_price} unitLabel={boat.from_unit ? t(unitKey(boat.from_unit)) : undefined} />
      </div>
    </ImageCard>
  );
}

export function FromPrice({ amount, unitLabel }: { amount: number; unitLabel?: string }) {
  const t = useT();
  if (!amount) return <p className="text-sm text-muted">{t("public.boats.price_on_request")}</p>;
  return (
    <p className="pt-1">
      <span className="text-sm text-muted">{t("common.money.from")} </span>
      <Money amount={amount} withUsd className="font-semibold" />
      {unitLabel && <span className="text-sm text-muted"> {unitLabel}</span>}
    </p>
  );
}

export function PackageCardItem({ pkg, priority }: { pkg: PackageCard; priority?: boolean }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/packages/${pkg.slug}`)} image={pkg.thumbnail} title={pkg.name} priority={priority}>
      <p className="text-sm text-accent-text">{t(pkg.mode === "DEPARTURE" ? "public.packages.mode_DEPARTURE" : "public.packages.mode_PRIVATE_CHARTER")}</p>
      {pkg.summary && <p className="line-clamp-2 text-sm text-muted">{pkg.summary}</p>}
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
        <Meta icon={UsersIcon}>{t("public.packages.pax_range", { min: pkg.min_pax, max: pkg.max_pax })}</Meta>
        {pkg.duration_minutes ? <Meta icon={ClockIcon}>{formatDuration(pkg.duration_minutes, locale)}</Meta> : null}
        <Meta icon={CalendarIcon}>{t("public.packages.valid", { from: formatPlainDate(pkg.valid_from, locale), until: formatPlainDate(pkg.valid_until, locale) })}</Meta>
      </ul>
      <div className="mt-auto border-t border-border pt-3">
        <FromPrice amount={pkg.from_price} unitLabel={pkg.mode === "PRIVATE_CHARTER" ? t("public.packages.per_trip") : undefined} />
      </div>
    </ImageCard>
  );
}
export function RegionCardItem({ region, priority }: { region: RegionCard; priority?: boolean }) {
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/destinations/${region.slug}`)} image={region.thumbnail} title={region.name} priority={priority}>
      {region.description && <p className="line-clamp-3 text-sm text-muted">{region.description}</p>}
    </ImageCard>
  );
}
export function RouteCardItem({ route }: { route: RouteCard }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/routes/${route.slug}`)} image={route.thumbnail} title={route.name}>
      <ul className="text-sm">
        <Meta icon={ClockIcon}>{t("public.route.duration", { duration: formatDuration(route.duration_minutes, locale) })}</Meta>
      </ul>
      {route.description && <p className="line-clamp-3 text-sm text-muted">{route.description}</p>}
    </ImageCard>
  );
}
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

export interface ReviewStats {
  total: number;
  overall: number;
  boat: number;
  service: number;
  crew: number;
}

// ReviewSummary shows the averages. With onOpen, the "Rated by guests" line becomes the button
// that opens the full list.
export function ReviewSummary({ stats, onOpen }: { stats: ReviewStats; onOpen?: () => void }) {
  const t = useT();
  const locale = useLocale();
  const score = (v: number) => formatNumber(Math.round(v * 10) / 10, locale);
  const parts: [string, number][] = [
    [t("account.review.rating_boat"), stats.boat],
    [t("account.review.rating_service"), stats.service],
    [t("account.review.rating_crew"), stats.crew],
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-12 gap-y-4 border-y border-border py-5", !onOpen && "mb-8")}>
      <p className="flex items-center gap-4">
        <span className="font-display text-5xl leading-none">{score(stats.overall)}</span>
        <span>
          <Stars rating={stats.overall} className="text-lg" />
          {onOpen ? (
            <button type="button" onClick={onOpen} className="-my-1 flex cursor-pointer items-center gap-1 py-1 text-sm text-primary underline-offset-4 hover:underline">
              {t("public.reviews.rated_by", { count: stats.total })}
              <ChevronRightIcon className="size-4" />
            </button>
          ) : (
            <span className="block text-sm text-muted">{t("public.reviews.rated_by", { count: stats.total })}</span>
          )}
        </span>
      </p>
      <dl className="flex flex-wrap gap-x-10 gap-y-3 text-sm">
        {parts.map(([label, value]) => (
          <div key={label}>
            <dt className="text-muted">{label}</dt>
            <dd className="flex items-center gap-2">
              <Stars rating={value} />
              {score(value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ReviewList({ reviews, columns = 2 }: { reviews: Review[]; columns?: 1 | 2 }) {
  const t = useT();
  const locale = useLocale();
  if (reviews.length === 0) return <p className="text-muted">{t("public.reviews.empty")}</p>;
  return (
    <ul className={cn("grid gap-x-10 gap-y-8", columns === 2 ? "md:grid-cols-2" : "divide-y divide-border [&>li:not(:first-child)]:pt-8")}>
      {reviews.map((r) => (
        <li key={r.id}>
          <article lang={r.locale}>
            <p>
              <Stars rating={r.rating_overall} />
            </p>
            <h3 className="mt-2 font-display text-xl leading-snug">{r.title}</h3>
            <p className="mt-2 whitespace-pre-line leading-relaxed text-muted">{r.body}</p>
            {r.photos.length > 0 && (
              <ul className="mt-3 flex gap-2">
                {r.photos.slice(0, 3).map((p) => (
                  <li key={p.id} className="w-20">
                    <ResponsiveImage image={p} sizes="80px" className="aspect-square h-auto w-full rounded" />
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-4 flex items-center gap-3 text-sm">
              <span className="grid size-10 shrink-0 place-items-center rounded-full border border-accent font-display text-accent-text" aria-hidden="true">
                {initials(r.author_name)}
              </span>
              <span className="min-w-0">
                <span className="block font-medium">{r.author_country ? t("public.reviews.from", { name: r.author_name, country: countryName(r.author_country, locale) }) : r.author_name}</span>
                <time dateTime={r.created_at} className="block text-muted">
                  {formatPlainDate(r.created_at.slice(0, 10), locale)}
                </time>
              </span>
              {r.verified_booking && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 text-accent-text">
                  <SealCheckIcon className="size-4" />
                  {t("public.reviews.verified")}
                </span>
              )}
            </div>
          </article>
        </li>
      ))}
    </ul>
  );
}
export function FaqList({ faqs }: { faqs: Faq[] }) {
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface">
      {faqs.map((f) => (
        <details key={f.id} className="group px-4 py-3">
          <summary className="-mx-4 -my-3 cursor-pointer px-4 py-3 font-medium">{f.question}</summary>
          <p className="mt-3 whitespace-pre-line text-sm">{f.answer}</p>
        </details>
      ))}
    </div>
  );
}

export function useFaqCategory() {
  const tc = useTCode();
  return (code: string) => {
    const label = tc("public.faq.categories", code);
    if (label !== code) return label;
    const words = code.toLowerCase().replace(/_/g, " ");
    return words.charAt(0).toUpperCase() + words.slice(1);
  };
}

export function sortedTiers(tiers: CancellationTier[]): CancellationTier[] {
  return [...tiers].sort((a, b) => b.min_days_before - a.min_days_before);
}

export function PolicyView({ policy }: { policy: PolicySummary }) {
  const t = useT();
  const locale = useLocale();
  const deposit =
    policy.deposit_type === "PERCENTAGE" ? formatBasisPoints(policy.deposit_value, locale) : policy.deposit_type === "FIXED" ? formatIDR(policy.deposit_value, locale) : "";
  const tiers = sortedTiers(policy.cancellation_tiers ?? []);
  return (
    <div className="space-y-3 text-sm">
      <p>{policy.payment_type === "DEPOSIT" && deposit ? t("public.policy.payment_deposit", { amount: deposit, days: policy.balance_due_days }) : t("public.policy.payment_full")}</p>
      <div>
        <h3 className="font-semibold">
          {t("public.policy.cancellation")}
          {policy.cancellation_name ? `: ${policy.cancellation_name}` : ""}
        </h3>
        {tiers.length > 0 && (
          <ul className="mt-1 list-disc pl-5">
            {tiers.map((tier, i) => {
              const refund = formatBasisPoints(tier.refund_basis_points, locale);
              const prev = tiers[i - 1];
              const text =
                tiers.length === 1
                  ? t("public.policy.tier_any", { refund })
                  : tier.min_days_before === 0 && prev
                    ? t("public.policy.tier_same_day", { days: prev.min_days_before, refund })
                    : t("public.policy.tier", { days: tier.min_days_before, refund });
              return <li key={tier.min_days_before}>{text}</li>;
            })}
          </ul>
        )}
        {policy.cancellation_text && <p className="mt-2 whitespace-pre-line text-muted">{policy.cancellation_text}</p>}
        <p className="mt-2 text-muted">{t("public.policy.fees_note")}</p>
      </div>
    </div>
  );
}

export function SectionError() {
  const t = useT();
  return <p className="text-sm text-muted">{t("public.boat.section_error")}</p>;
}

// PublicErrorBoundary keeps the site header and footer on 404/410/5xx pages.
export function PublicErrorBoundary() {
  const error = useRouteError();
  const t = useT();
  const locale = useLocale();
  let title = t("common.states.error_title");
  let body = t("validation.errors.UNKNOWN");
  if (isRouteErrorResponse(error) && error.status === 404) {
    title = t("common.states.not_found_title");
    body = t("common.states.not_found_body");
  } else if (isRouteErrorResponse(error) && error.status === 410) {
    title = t("common.states.gone_title");
    body = t("common.states.gone_body");
  }
  return (
    <>
      <PageHero title={title} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: title }]} />
      <Container className="py-12 text-center">
        <p className="text-muted">{body}</p>
        <ButtonLink to={localePath(locale, "/")} className="mt-6">
          {t("common.states.go_home")}
        </ButtonLink>
      </Container>
    </>
  );
}
