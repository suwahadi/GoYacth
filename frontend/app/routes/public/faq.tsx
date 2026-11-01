import type { Route } from "./+types/faq";
import { Container, EmptyState } from "~/components/ui";
import { Breadcrumbs, FaqList, PageHeader, PublicErrorBoundary, Section, useFaqCategory } from "~/features/public/components";
import { crumbsLd, load, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { translate, useT } from "~/lib/i18n";
import { buildMeta } from "~/lib/seo";
import type { Faq } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  return { locale: requestLocale(request), faqs: await load<Faq[]>("/faqs", request) };
}

function faqPageLd(faqs: Faq[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })),
  };
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  const locale = loaderData?.locale ?? "en";
  const origin = root?.origin ?? "";
  const title = translate(locale, "public.faq.title");
  const faqs = loaderData?.faqs ?? [];
  return buildMeta({
    origin,
    locale,
    title,
    description: translate(locale, "public.faq.description"),
    path: "/faq",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: title, path: "/faq" }]), ...(faqs.length > 0 ? [faqPageLd(faqs)] : [])],
  });
}

function groupByCategory(faqs: Faq[]): [string, Faq[]][] {
  const groups = new Map<string, Faq[]>();
  for (const f of faqs) groups.set(f.category, [...(groups.get(f.category) ?? []), f]);
  return [...groups.entries()];
}

export default function FaqPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const category = useFaqCategory();
  const groups = groupByCategory(loaderData.faqs);
  return (
    <Container className="max-w-3xl pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("public.faq.title") }]} />
      <PageHeader title={t("public.faq.title")} />
      {groups.length === 0 ? (
        <EmptyState title={t("public.faq.empty_title")} />
      ) : (
        groups.map(([cat, list]) => (
          <Section key={cat} title={category(cat)} id={`faq-${cat.toLowerCase()}`}>
            <FaqList faqs={list} />
          </Section>
        ))
      )}
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
