import { data, redirect } from "react-router";

import { ApiError, api, apiData, httpStatusFor, type Page, type RequestOptions } from "~/lib/api";
import { LOCALES, localePath, splitLocale, type Locale } from "~/lib/config";
import { breadcrumbLd } from "~/lib/seo";
import type { RootData } from "~/root";

export function requestLocale(request: Request): Locale {
  return splitLocale(new URL(request.url).pathname).locale;
}

function toRouteError(err: unknown): never {
  if (err instanceof Response) throw err;
  const status = httpStatusFor(err);
  throw data({ code: err instanceof ApiError ? err.code : "UNKNOWN" }, { status });
}

export async function load<T>(path: string, request: Request, query?: RequestOptions["query"]): Promise<T> {
  try {
    return await apiData<T>(path, { request, query: { locale: requestLocale(request), ...query } });
  } catch (err) {
    toRouteError(err);
  }
}

export async function loadPage<T>(path: string, request: Request, query?: RequestOptions["query"]): Promise<{ items: T; page: Page | undefined }> {
  try {
    const res = await api<T>(path, { request, query: { locale: requestLocale(request), ...query } });
    return { items: res.data, page: res.meta };
  } catch (err) {
    toRouteError(err);
  }
}

// loadOptional is for secondary page sections: the page still renders when they fail, and the
// section shows its own error state.
export async function loadOptional<T>(path: string, request: Request, query?: RequestOptions["query"]): Promise<T | null> {
  try {
    return await apiData<T>(path, { request, query: { locale: requestLocale(request), ...query } });
  } catch {
    return null;
  }
}

// loadBySlug fetches a slug resource. The API answers a renamed slug with `redirect_slug`, which
// becomes a 301 to the current URL; 404 and 410 become route responses with that status.
export async function loadBySlug<T>(request: Request, apiBase: string, siteBase: string, slug: string): Promise<T> {
  const url = new URL(request.url);
  const locale = requestLocale(request);
  const body = await load<T | { redirect_slug: string }>(`${apiBase}/${encodeURIComponent(slug)}`, request);
  if (body && typeof body === "object" && "redirect_slug" in body && typeof body.redirect_slug === "string") {
    throw redirect(localePath(locale, `${siteBase}/${body.redirect_slug}`) + url.search, 301);
  }
  return body as T;
}

export function alternatePaths(siteBase: string, alternates: Record<string, string> | undefined): Partial<Record<Locale, string>> {
  const out: Partial<Record<Locale, string>> = {};
  for (const l of LOCALES) {
    const slug = alternates?.[l];
    if (slug) out[l] = `${siteBase}/${slug}`;
  }
  return out;
}

export function rootFromMatches(matches: readonly unknown[]): RootData | undefined {
  const m = matches.find((x) => (x as { id?: string } | undefined)?.id === "root") as { loaderData?: unknown } | undefined;
  return m?.loaderData as RootData | undefined;
}

// Availability (departure slots, busy ranges) must never be cached by shared caches.
export const NO_STORE = { "Cache-Control": "no-store" };

export function noStoreHeaders({ loaderHeaders, parentHeaders }: { loaderHeaders: Headers; parentHeaders: Headers }) {
  return loaderHeaders.has("Cache-Control") ? loaderHeaders : parentHeaders;
}

export function firstImageUrl(img: { sources: { url: string; width: number }[] } | null | undefined): string | undefined {
  if (!img || img.sources.length === 0) return undefined;
  return (img.sources.find((s) => s.width >= 1200) ?? img.sources[img.sources.length - 1]).url;
}

export function crumbsLd(origin: string, locale: Locale, items: { name: string; path: string }[]): object {
  return breadcrumbLd(
    origin,
    items.map((it) => ({ name: it.name, path: localePath(locale, it.path) })),
  );
}
