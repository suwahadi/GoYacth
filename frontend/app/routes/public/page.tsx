import type { Route } from "./+types/page";
import { Container, ResponsiveImage } from "~/components/ui";
import { Breadcrumbs, PublicErrorBoundary } from "~/features/public/components";
import { Blocks } from "~/features/public/content";
import { alternatePaths, crumbsLd, firstImageUrl, loadBySlug, requestLocale, rootFromMatches } from "~/features/public/loaders";
import { SITE_NAME, localePath } from "~/lib/config";
import { formatPlainDate } from "~/lib/format";
import { translate, useLocale, useT } from "~/lib/i18n";
import { absolute, buildMeta } from "~/lib/seo";
import type { Img, PageBlock } from "~/lib/types";

interface PublicPage {
  id: string;
  title: string;
  slug: string;
  blocks: PageBlock[];
  seo_title: string;
  seo_description: string;
  featured_image: Img | null;
  published_at: string | null;
  updated_at: string;
  alternates: Record<string, string>;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const locale = requestLocale(request);
  const page = await loadBySlug<PublicPage>(request, "/pages", "", params.slug);
  return { locale, page, alternatePaths: alternatePaths("", page.alternates) };
}

function firstParagraph(blocks: PageBlock[]): string {
  return blocks.find((b) => b.type === "paragraph")?.text?.slice(0, 160) ?? "";
}

export function meta({ loaderData, matches }: Route.MetaArgs) {
  const root = rootFromMatches(matches);
  if (!loaderData) return [];
  const { locale, page } = loaderData;
  const origin = root?.origin ?? "";
  const path = `/${page.slug}`;
  const image = firstImageUrl(page.featured_image);
  const article = {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: page.title,
    inLanguage: locale,
    mainEntityOfPage: absolute(origin, localePath(locale, path)),
    dateModified: page.updated_at,
    ...(page.published_at ? { datePublished: page.published_at } : {}),
    ...(image ? { image: absolute(origin, image) } : {}),
    publisher: { "@type": "Organization", name: SITE_NAME, url: origin },
  };
  return buildMeta({
    origin,
    locale,
    title: page.seo_title || page.title,
    description: page.seo_description || firstParagraph(page.blocks),
    path,
    alternates: loaderData.alternatePaths,
    image,
    type: "article",
    jsonLd: [crumbsLd(origin, locale, [{ name: translate(locale, "public.breadcrumb.home"), path: "/" }, { name: page.title, path }]), article],
  });
}

export default function ContentPage({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const { page } = loaderData;
  return (
    <Container className="max-w-3xl pb-8">
      <Breadcrumbs items={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: page.title }]} />
      <article>
        <header className="pb-4">
          <h1 className="font-display text-[clamp(2rem,1.5rem+1.5vw,3rem)] font-normal leading-tight">{page.title}</h1>
          <p className="mt-1 text-sm text-muted">
            {t("public.page.updated", { date: formatPlainDate(page.updated_at.slice(0, 10), locale) })}
          </p>
        </header>
        {page.featured_image && <ResponsiveImage image={page.featured_image} sizes="(min-width: 768px) 720px, 100vw" priority className="mb-4 h-auto w-full rounded-lg" />}
        <Blocks blocks={page.blocks} />
      </article>
    </Container>
  );
}

export { PublicErrorBoundary as ErrorBoundary };
