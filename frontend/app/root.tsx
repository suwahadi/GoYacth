import { data, isRouteErrorResponse, Links, Meta, Outlet, Scripts, ScrollRestoration, useRouteLoaderData } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { ApiError, apiData, readCookie } from "./lib/api";
import { splitLocale, type Locale } from "./lib/config";
import { I18nProvider, translate } from "./lib/i18n";
import { useNonce } from "./lib/nonce";
import type { Me, PublicSettings, ThemePref } from "./lib/types";

export interface RootData {
  locale: Locale;
  theme: ThemePref;
  user: Me | null;
  settings: PublicSettings;
  origin: string;
  isAdminPath: boolean;
}

const THEMES: ThemePref[] = ["light", "dark", "system"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { locale } = splitLocale(url.pathname);
  const cookieHeader = request.headers.get("Cookie");
  const rawTheme = readCookie("gy_theme", cookieHeader) as ThemePref | undefined;
  const theme: ThemePref = rawTheme && THEMES.includes(rawTheme) ? rawTheme : "light";
  const [user, settings] = await Promise.all([
    readCookie("gy_session", cookieHeader)
      ? apiData<Me>("/auth/me", { request }).catch((e) => {
          if (e instanceof ApiError && e.status === 401) return null;
          throw e;
        })
      : Promise.resolve(null),
    apiData<PublicSettings>("/settings/public", { request }).catch(() => ({}) as PublicSettings),
  ]);
  const origin = process.env.PUBLIC_APP_URL ?? url.origin;
  const body: RootData = { locale, theme, user, settings, origin, isAdminPath: url.pathname === "/admin" || url.pathname.startsWith("/admin/") };
  return data(body, { headers: { "Cache-Control": user ? "private, no-store" : "public, max-age=60" } });
}

export function headers({ loaderHeaders, actionHeaders }: Route.HeadersArgs) {
  return actionHeaders.has("Cache-Control") ? actionHeaders : loaderHeaders;
}

export function useRootData(): RootData {
  return useRouteLoaderData("root") as RootData;
}

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const locale = root?.locale ?? "en";
  const theme = root?.isAdminPath ? "light" : (root?.theme ?? "light");
  const nonce = useNonce();
  return (
    <html lang={locale} data-theme={theme}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b5d7a" />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen antialiased">
        <I18nProvider locale={locale}>{children}</I18nProvider>
        <ScrollRestoration nonce={nonce} />
        <Scripts nonce={nonce} />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const root = useRouteLoaderData("root") as RootData | undefined;
  const locale = root?.locale ?? "en";
  let title = translate(locale, "common.states.error_title");
  let body = translate(locale, "validation.errors.UNKNOWN");
  if (isRouteErrorResponse(error)) {
    if (error.status === 404) {
      title = translate(locale, "common.states.not_found_title");
      body = translate(locale, "common.states.not_found_body");
    } else if (error.status === 410) {
      title = translate(locale, "common.states.gone_title");
      body = translate(locale, "common.states.gone_body");
    }
  }
  return (
    <main className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-2xl font-bold">{title}</h1>
      <p className="mt-3 text-muted">{body}</p>
      <a href={locale === "en" ? "/" : `/${locale}`} className="mt-6 inline-block rounded-md bg-primary px-4 py-2 font-medium text-primary-fg hover:bg-primary-hover">
        {translate(locale, "common.states.go_home")}
      </a>
    </main>
  );
}
