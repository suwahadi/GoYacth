export function loader({ request }: { request: Request }) {
  const origin = process.env.PUBLIC_APP_URL ?? new URL(request.url).origin;
  const body = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /account",
    "Disallow: /checkout",
    "Disallow: /orders",
    "Disallow: /track",
    "Disallow: /verify",
    "Disallow: /login",
    "Disallow: /api/",
    "Disallow: /id/account",
    "Disallow: /id/checkout",
    "Disallow: /id/orders",
    "Disallow: /id/track",
    "Disallow: /id/verify",
    "Disallow: /id/login",
    `Sitemap: ${origin}/sitemap.xml`,
    "",
  ].join("\n");
  return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=3600" } });
}
