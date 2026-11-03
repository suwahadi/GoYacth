import { Link } from "react-router";

import { ArrowRightIcon, Card, PHONE_IMAGE, ResponsiveImage, buttonClass, cn } from "~/components/ui";
import { localePath } from "~/lib/config";
import { useLocale, useT } from "~/lib/i18n";
import type { Faq, HomeSection, PackageCard, PageBlock } from "~/lib/types";

import { CardGrid, FaqList, PackageCardItem, Section, localizeHref } from "./components";

export function CtaLink({ label, url, variant = "primary", pill, arrow, full, className }: { label: string; url: string; variant?: "primary" | "secondary" | "accent"; pill?: boolean; arrow?: boolean; full?: boolean; className?: string }) {
  const locale = useLocale();
  const href = localizeHref(locale, url);
  const cls = cn(buttonClass(variant, "lg", full, pill), className);
  const body = (
    <>
      {label}
      {arrow && <ArrowRightIcon className="size-4" />}
    </>
  );
  if (href.startsWith("/")) {
    return (
      <Link to={href} className={cls}>
        {body}
      </Link>
    );
  }
  return (
    <a href={href} className={cls} rel="noopener">
      {body}
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
                <ResponsiveImage image={b.image} sizes={`(min-width: 768px) 720px, (min-width: 640px) 100vw, ${PHONE_IMAGE}`} className="h-auto w-full rounded-lg" />
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

// HomeSectionView renders the CMS section types that have no dedicated block in features/home.
export function HomeSectionView({ section }: { section: HomeSection }) {
  const t = useT();
  switch (section.type) {
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
    case "FAQ": {
      const faqs = asArray<Faq>(section.data);
      if (faqs.length === 0) return null;
      return (
        <ListSection section={section} fallbackTitle={t("public.faq.title")} viewAll="/faq">
          <FaqList faqs={faqs} />
        </ListSection>
      );
    }
    case "PROMO_BANNER": {
      const c = section.content;
      return (
        <section className="mt-8">
          <Card className="bg-info-bg">
            {section.image && <ResponsiveImage image={section.image} sizes={`(min-width: 1152px) 1120px, (min-width: 640px) 100vw, ${PHONE_IMAGE}`} className="mb-3 aspect-[16/5] h-auto w-full rounded" />}
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
    default:
      return null;
  }
}
