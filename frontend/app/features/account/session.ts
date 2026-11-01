import { redirect } from "react-router";

import { ApiError, apiData } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import type { Me } from "~/lib/types";

export function loginRedirect(request: Request): Response {
  const url = new URL(request.url);
  const { locale } = splitLocale(url.pathname);
  return redirect(`${localePath(locale, "/login")}?return_to=${encodeURIComponent(url.pathname + url.search)}`);
}

export function isUnauthenticated(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

export async function requireUser(request: Request): Promise<Me> {
  try {
    return await apiData<Me>("/auth/me", { request });
  } catch (err) {
    if (isUnauthenticated(err)) throw loginRedirect(request);
    throw err;
  }
}

export const privateHeaders = { "Cache-Control": "private, no-store" };
