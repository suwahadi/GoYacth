import { apiData } from "~/lib/api";
import { isLocale, localePath } from "~/lib/config";

interface Entry {
  kind: "boat" | "region" | "route" | "package" | "page";
  locale: string;
  slug: string;
  updated_at: string;
}

const prefixes: Record<Entry["kind"], string> = { boat: "/boats/", region: "/destinations/", route: "/routes/", package: "/packages/", page: "/" };
const staticPaths = ["/", "/boats", "/departures", "/packages", "/destinations", "/faq"];

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

// One sitemap per locale (PRD 14.3), generated from published content.
export async function loader({ request }: { request: Request }) {
  // One route per locale, because React Router has no params inside a path segment.
  const locale = new URL(request.url).pathname.replace(/^\/sitemap-|\.xml$/g, "");
  if (!isLocale(locale)) throw new Response("Not found", { status: 404 });
  const origin = process.env.PUBLIC_APP_URL ?? new URL(request.url).origin;
  const entries = await apiData<Entry[]>("/sitemap");
  const urls = [
    ...staticPaths.map((p) => `  <url><loc>${esc(origin + localePath(locale, p))}</loc></url>`),
    ...entries
      .filter((e) => e.locale === locale)
      .map((e) => `  <url><loc>${esc(origin + localePath(locale, prefixes[e.kind] + e.slug))}</loc><lastmod>${e.updated_at.slice(0, 10)}</lastmod></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
