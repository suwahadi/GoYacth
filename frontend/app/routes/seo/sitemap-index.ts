import { LOCALES } from "~/lib/config";

export function loader({ request }: { request: Request }) {
  const origin = process.env.PUBLIC_APP_URL ?? new URL(request.url).origin;
  const items = LOCALES.map((l) => `  <sitemap><loc>${origin}/sitemap-${l}.xml</loc></sitemap>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${items}\n</sitemapindex>\n`;
  return new Response(xml, { headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
