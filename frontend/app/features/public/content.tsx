import { Link } from "react-router";

import { ButtonLink, Card, Container, ResponsiveImage, buttonClass } from "~/components/ui";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { BoatCard, Faq, HomeSection, PackageCard, PageBlock, RegionCard, Review } from "~/lib/types";

import { BoatCardItem, CardGrid, FaqList, PackageCardItem, RegionCardItem, ReviewList, Section, localizeHref } from "./components";

function CtaLink({ label, url, primary = true }: { label: string; url: string; primary?: boolean }) {
  const locale = useLocale();
  const href = localizeHref(locale, url);
  const cls = buttonClass(primary ? "primary" : "secondary", "lg");
  if (href.startsWith("/")) {
    return (
      <Link to={href} className={cls}>
        {label}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} rel="noopener">
      {label}
    </a>
  );
}

// Blocks renders structured CMS content. Admin text is rendered as text only; HTML is never
// injected.
export function Blocks({ blocks }: { blocks: PageBlock[] }) {
  return (
    <div className="prose-content">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "heading": {
            const level = Math.min(4, Math.max(2, b.level ?? 2));
            const Tag = `h${level}` as "h2" | "h3" | "h4";
            return <Tag key={i}>{b.text}</Tag>;
          }
          case "paragraph":
            return (
              <p key={i} className="whitespace-pre-line">
                {b.text}
              </p>
            );
          case "list":
            return (
              <ul key={i}>
                {(b.items ?? []).map((it, j) => (
                  <li key={j}>{it}</li>
                ))}
              </ul>
            );
          case "quote":
            return (
              <blockquote key={i} className="whitespace-pre-line">
                {b.text}
              </blockquote>
            );
          case "image":
            return b.image ? (
              <figure key={i} className="my-4">
                <ResponsiveImage image={b.image} sizes="(min-width: 768px) 720px, 100vw" className="h-auto w-full rounded-lg" />
                {b.text && <figcaption className="mt-1 text-sm text-muted">{b.text}</figcaption>}
              </figure>
            ) : null;
          case "cta":
            return b.label && b.url ? (
              <p key={i} className="my-4">
                <CtaLink label={b.label} url={b.url} />
              </p>
            ) : null;
          default:
            return null;
        }
      })}
    </div>
  );
}

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function Hero({ section, asH1 }: { section: HomeSection; asH1: boolean }) {
  const c = section.content;
  const Heading = asH1 ? "h1" : "h2";
  return (
    <section className="py-8">
      {section.image && <ResponsiveImage image={section.image} sizes="100vw" priority className="aspect-[16/7] h-auto w-full rounded-lg" />}
      <Heading className="mt-4 text-3xl font-bold">{c.title}</Heading>
      {c.subtitle && <p className="mt-2 text-lg text-muted">{c.subtitle}</p>}
      {c.body && <p className="mt-2 whitespace-pre-line">{c.body}</p>}
      {c.cta_label && c.cta_url && (
        <p className="mt-4">
          <CtaLink label={c.cta_label} url={c.cta_url} />
        </p>
      )}
    </section>
  );
}

function TextBlock({ section, tone }: { section: HomeSection; tone: "cta" | "promo" }) {
  const c = section.content;
  return (
    <section className="mt-8">
      <Card className={tone === "promo" ? "bg-info-bg" : undefined}>
        {section.image && <ResponsiveImage image={section.image} sizes="(min-width: 1152px) 1120px, 100vw" className="mb-3 aspect-[16/5] h-auto w-full rounded" />}
        <h2 className="text-xl font-semibold">{c.title}</h2>
        {c.subtitle && <p className="text-muted">{c.subtitle}</p>}
        {c.body && <p className="mt-2 whitespace-pre-line">{c.body}</p>}
        {c.cta_label && c.cta_url && (
          <p className="mt-3">
            <CtaLink label={c.cta_label} url={c.cta_url} />
          </p>
        )}
      </Card>
    </section>
  );
}

function ListSection({ section, fallbackTitle, children, viewAll }: { section: HomeSection; fallbackTitle: string; children: React.ReactNode; viewAll?: string }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Section
      title={section.content.title || fallbackTitle}
      id={`s-${section.id}`}
      action={
        viewAll ? (
          <Link to={localePath(locale, viewAll)} className="text-sm text-primary hover:underline">
            {t("common.actions.view_all")}
          </Link>
        ) : undefined
      }
    >
      {section.content.subtitle && <p className="mb-3 text-muted">{section.content.subtitle}</p>}
      {children}
    </Section>
  );
}

export function HomeSectionView({ section, asH1 }: { section: HomeSection; asH1: boolean }) {
  const t = useT();
  switch (section.type) {
    case "HERO":
      return <Hero section={section} asH1={asH1} />;
    case "FEATURED_BOATS": {
      const boats = asArray<BoatCard>(section.data);
      if (boats.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.home.featured_boats")} viewAll="/boats">
          <CardGrid>
            {boats.map((b) => (
              <BoatCardItem key={b.id} boat={b} />
            ))}
          </CardGrid>
        </ListSection>
      );
    }
    case "REGIONS": {
      const regions = asArray<RegionCard>(section.data);
      if (regions.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.regions.title")} viewAll="/destinations">
          <CardGrid>
            {regions.map((r) => (
              <RegionCardItem key={r.id} region={r} />
            ))}
          </CardGrid>
        </ListSection>
      );
    }
    case "FEATURED_PACKAGES": {
      const pkgs = asArray<PackageCard>(section.data);
      if (pkgs.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.packages.title")} viewAll="/packages">
          <CardGrid>
            {pkgs.map((p) => (
              <PackageCardItem key={p.id} pkg={p} />
            ))}
          </CardGrid>
        </ListSection>
      );
    }
    case "HIGHLIGHTS":
      return (
        <ListSection section={section} fallbackTitle="">
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {(section.content.items ?? []).map((it, i) => (
              <li key={i}>
                <Card className="h-full">
                  <h3 className="font-semibold">{it.title}</h3>
                  <p className="mt-1 text-sm text-muted">{it.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </ListSection>
      );
    case "REVIEWS": {
      const reviews = asArray<Review>(section.data);
      if (reviews.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.boat.reviews")}>
          <ReviewList reviews={reviews} />
        </ListSection>
      );
    }
    case "FAQ": {
      const faqs = asArray<Faq>(section.data);
      if (faqs.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.faq.title")} viewAll="/faq">
          <FaqList faqs={faqs} />
        </ListSection>
      );
    }
    case "CTA":
      return <TextBlock section={section} tone="cta" />;
    case "PROMO_BANNER":
      return <TextBlock section={section} tone="promo" />;
    default:
      return null;
  }
}

export function HomeFallback({ boats }: { boats: BoatCard[] }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Container>
      <section className="py-8">
        <h1 className="text-3xl font-bold">{t("public.home.fallback_title")}</h1>
        <p className="mt-2 text-lg text-muted">{t("public.home.fallback_subtitle")}</p>
        <div className="mt-4 flex flex-wrap gap-3">
          <ButtonLink to={localePath(locale, "/boats")} size="lg">
            {t("public.home.browse_boats")}
          </ButtonLink>
          <ButtonLink to={localePath(locale, "/departures")} size="lg" variant="secondary">
            {t("public.home.see_departures")}
          </ButtonLink>
        </div>
      </section>
      {boats.length > 0 && (
        <Section title={t("public.home.featured_boats")} id="featured-boats">
          <CardGrid>
            {boats.map((b) => (
              <BoatCardItem key={b.id} boat={b} />
            ))}
          </CardGrid>
        </Section>
      )}
    </Container>
  );
}
