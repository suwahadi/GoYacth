import type { ReactNode } from "react";
import { Link, isRouteErrorResponse, useRouteError } from "react-router";

import { Badge, ButtonLink, Card, Container, Money, ResponsiveImage } from "~/components/ui";
import { localePath, splitLocale, DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { countryName, formatBasisPoints, formatDuration, formatIDR, formatNumber, formatPlainDate } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
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

export function Breadcrumbs({ items }: { items: { name: string; path?: string }[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <nav aria-label={t("public.breadcrumb.label")} className="py-3 text-sm text-muted">
      <ol className="flex flex-wrap gap-1">
        {items.map((it, i) => (
          <li key={i} className="flex min-w-0 gap-1">
            {i > 0 && <span aria-hidden="true">/</span>}
            {it.path ? (
              <Link to={localePath(locale, it.path)} className="hover:underline">
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

export function PageHeader({ title, intro }: { title: string; intro?: string }) {
  return (
    <header className="py-4">
      <h1 className="text-2xl font-bold">{title}</h1>
      {intro && <p className="mt-1 text-muted">{intro}</p>}
    </header>
  );
}

export function Section({ title, children, id, action }: { title: string; children: ReactNode; id?: string; action?: ReactNode }) {
  return (
    <section aria-labelledby={title ? id : undefined} className="mt-8">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        {title && (
          <h2 id={id} className="text-xl font-semibold">
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
  return <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{children}</ul>;
}

export function unitKey(unit: BoatCard["from_unit"]) {
  if (unit === "HOURLY") return "common.money.per_hour" as const;
  if (unit === "DAILY") return "common.money.per_day" as const;
  return "common.money.per_trip" as const;
}

export function Stars({ rating }: { rating: number }) {
  const t = useT();
  const locale = useLocale();
  const rounded = Math.round(rating);
  const label = t("public.reviews.rating", { rating: formatNumber(Math.round(rating * 10) / 10, locale) });
  return (
    <span role="img" aria-label={label} title={label}>
      <span aria-hidden="true">{"★".repeat(rounded) + "☆".repeat(Math.max(0, 5 - rounded))}</span>
    </span>
  );
}

function ImageCard({ href, image, title, children }: { href: string; image: Img | null; title: string; children?: ReactNode }) {
  return (
    <li>
      <Card className="h-full overflow-hidden p-0">
        <Link to={href} className="block">
          <ResponsiveImage image={image} sizes="(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw" className="aspect-[3/2] h-auto w-full" />
        </Link>
        <div className="space-y-1 p-4">
          <h3 className="font-semibold">
            <Link to={href} className="hover:underline">
              {title}
            </Link>
          </h3>
          {children}
        </div>
      </Card>
    </li>
  );
}

export function BoatCardItem({ boat, names }: { boat: BoatCard; names?: { category?: string; class?: string } }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/boats/${boat.slug}`)} image={boat.thumbnail} title={boat.name}>
      {(names?.category || names?.class) && (
        <p className="flex flex-wrap gap-1">
          {names.category && <Badge>{names.category}</Badge>}
          {names.class && <Badge tone="info">{names.class}</Badge>}
        </p>
      )}
      {boat.summary && <p className="text-sm text-muted">{boat.summary}</p>}
      <p className="text-sm">
        {t("common.units.pax_max", { count: boat.max_passengers })}
        {boat.length_cm ? ` · ${t("public.boats.length", { meters: formatNumber(boat.length_cm / 100, locale) })}` : ""}
        {boat.cabins > 0 ? ` · ${t("public.boats.cabins", { count: boat.cabins })}` : ""}
      </p>
      <p className="text-sm">
        {boat.review_count > 0 ? (
          <>
            <Stars rating={boat.rating} /> {t("public.boats.reviews", { rating: formatNumber(Math.round(boat.rating * 10) / 10, locale), count: boat.review_count })}
          </>
        ) : (
          <span className="text-muted">{t("public.boats.no_reviews")}</span>
        )}
      </p>
      <FromPrice amount={boat.from_price} unitLabel={boat.from_unit ? t(unitKey(boat.from_unit)) : undefined} />
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

export function PackageCardItem({ pkg }: { pkg: PackageCard }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/packages/${pkg.slug}`)} image={pkg.thumbnail} title={pkg.name}>
      <p>
        <Badge tone="info">{t(pkg.mode === "DEPARTURE" ? "public.packages.mode_DEPARTURE" : "public.packages.mode_PRIVATE_CHARTER")}</Badge>
      </p>
      {pkg.summary && <p className="text-sm text-muted">{pkg.summary}</p>}
      <p className="text-sm">
        {t("public.packages.pax_range", { min: pkg.min_pax, max: pkg.max_pax })}
        {pkg.duration_minutes ? ` · ${formatDuration(pkg.duration_minutes, locale)}` : ""}
      </p>
      <p className="text-sm text-muted">{t("public.packages.valid", { from: formatPlainDate(pkg.valid_from, locale), until: formatPlainDate(pkg.valid_until, locale) })}</p>
      <FromPrice amount={pkg.from_price} unitLabel={pkg.mode === "PRIVATE_CHARTER" ? t("public.packages.per_trip") : undefined} />
    </ImageCard>
  );
}

export function RegionCardItem({ region }: { region: RegionCard }) {
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/destinations/${region.slug}`)} image={region.thumbnail} title={region.name}>
      {region.description && <p className="line-clamp-3 text-sm text-muted">{region.description}</p>}
    </ImageCard>
  );
}

export function RouteCardItem({ route }: { route: RouteCard }) {
  const t = useT();
  const locale = useLocale();
  return (
    <ImageCard href={localePath(locale, `/routes/${route.slug}`)} image={route.thumbnail} title={route.name}>
      <p className="text-sm">{t("public.route.duration", { duration: formatDuration(route.duration_minutes, locale) })}</p>
      {route.description && <p className="line-clamp-3 text-sm text-muted">{route.description}</p>}
    </ImageCard>
  );
}

export function Gallery({ images, fallback }: { images: Img[]; fallback?: Img | null }) {
  const t = useT();
  const list = images.length > 0 ? images : fallback ? [fallback] : [];
  if (list.length === 0) return null;
  const [first, ...rest] = list;
  return (
    <section aria-label={t("public.boat.gallery")} className="space-y-2">
      <ResponsiveImage image={first} sizes="(min-width: 1152px) 1120px, 100vw" priority className="aspect-[16/9] h-auto w-full rounded-lg" />
      {rest.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {rest.slice(0, 8).map((img) => (
            <li key={img.id}>
              <ResponsiveImage image={img} sizes="(min-width: 640px) 25vw, 33vw" className="aspect-[4/3] h-auto w-full rounded" />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReviewList({ reviews }: { reviews: Review[] }) {
  const t = useT();
  const locale = useLocale();
  if (reviews.length === 0) return <p className="text-muted">{t("public.reviews.empty")}</p>;
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {reviews.map((r) => (
        <li key={r.id}>
          <Card className="h-full">
            <article lang={r.locale}>
              <p>
                <Stars rating={r.rating_overall} />
              </p>
              <h3 className="mt-1 font-semibold">{r.title}</h3>
              <p className="mt-1 whitespace-pre-line text-sm">{r.body}</p>
              <p className="mt-2 text-xs text-muted">
                {r.author_country ? t("public.reviews.from", { name: r.author_name, country: countryName(r.author_country, locale) }) : r.author_name} ·{" "}
                <time dateTime={r.created_at}>{formatPlainDate(r.created_at.slice(0, 10), locale)}</time>
                {r.verified_booking && <> · {t("public.reviews.verified")}</>}
              </p>
              {r.photos.length > 0 && (
                <ul className="mt-2 flex gap-2">
                  {r.photos.slice(0, 3).map((p) => (
                    <li key={p.id} className="w-20">
                      <ResponsiveImage image={p} sizes="80px" className="aspect-square h-auto w-full rounded" />
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </Card>
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
          <summary className="cursor-pointer font-medium">{f.question}</summary>
          <p className="mt-2 whitespace-pre-line text-sm">{f.answer}</p>
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
    <Container className="py-16 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
      <ButtonLink to={localePath(locale, "/")} className="mt-6">
        {t("common.states.go_home")}
      </ButtonLink>
    </Container>
  );
}
