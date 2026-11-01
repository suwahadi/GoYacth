import type { MetaDescriptor } from "react-router";

import { DEFAULT_LOCALE, LOCALES, SITE_NAME, localePath, type Locale } from "./config";

export interface SeoInput {
  origin: string;
  locale: Locale;
  title: string;
  description?: string;
  // path is the locale-free path of this page, e.g. "/boats/ocean-majesty".
  path: string;
  // alternates maps each locale to its locale-free path when slugs differ per language.
  alternates?: Partial<Record<Locale, string>>;
  image?: string;
  noindex?: boolean;
  type?: "website" | "article" | "product";
  jsonLd?: object[];
}

export function absolute(origin: string, path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return origin.replace(/\/$/, "") + path;
}

// buildMeta produces title, description, canonical, hreflang (with x-default), Open Graph,
// Twitter Card and optional JSON-LD for one page.
export function buildMeta(s: SeoInput): MetaDescriptor[] {
  const title = s.title.includes(SITE_NAME) ? s.title : `${s.title} | ${SITE_NAME}`;
  const canonical = absolute(s.origin, localePath(s.locale, s.path));
  const tags: MetaDescriptor[] = [
    { title },
    { tagName: "link", rel: "canonical", href: canonical },
    { property: "og:title", content: title },
    { property: "og:type", content: s.type === "article" ? "article" : "website" },
    { property: "og:url", content: canonical },
    { property: "og:site_name", content: SITE_NAME },
    { property: "og:locale", content: s.locale === "id" ? "id_ID" : "en_GB" },
    { name: "twitter:card", content: s.image ? "summary_large_image" : "summary" },
    { name: "twitter:title", content: title },
  ];
  if (s.description) {
    tags.push({ name: "description", content: s.description }, { property: "og:description", content: s.description }, { name: "twitter:description", content: s.description });
  }
  if (s.image) {
    tags.push({ property: "og:image", content: absolute(s.origin, s.image) }, { name: "twitter:image", content: absolute(s.origin, s.image) });
  }
  if (s.noindex) {
    tags.push({ name: "robots", content: "noindex, nofollow" });
  } else {
    for (const loc of LOCALES) {
      const p = s.alternates ? s.alternates[loc] : s.path;
      if (!p) continue;
      tags.push({ tagName: "link", rel: "alternate", hrefLang: loc, href: absolute(s.origin, localePath(loc, p)) });
    }
    const def = s.alternates ? s.alternates[DEFAULT_LOCALE] : s.path;
    if (def) tags.push({ tagName: "link", rel: "alternate", hrefLang: "x-default", href: absolute(s.origin, localePath(DEFAULT_LOCALE, def)) });
  }
  for (const ld of s.jsonLd ?? []) {
    tags.push({ "script:ld+json": ld });
  }
  return tags;
}

export function breadcrumbLd(origin: string, items: { name: string; path: string }[]): object {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absolute(origin, it.path) })),
  };
}

export function organizationLd(origin: string, contact?: { email?: string; phone?: string }): object {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    url: origin,
    ...(contact?.email ? { email: contact.email } : {}),
    ...(contact?.phone ? { telephone: contact.phone } : {}),
  };
}

export function noindexMeta(title: string): MetaDescriptor[] {
  return [{ title: `${title} | ${SITE_NAME}` }, { name: "robots", content: "noindex, nofollow" }];
}
