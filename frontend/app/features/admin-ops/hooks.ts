import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";

import { ApiError, api, type Page, type RequestOptions } from "~/lib/api";

export interface LoadError {
  status: number;
  code: string;
}

export type Loaded<T> = { data: T; error: null } | { data: null; error: LoadError };

// load converts API failures into plain data so a route can render its own error state
// instead of replacing the whole admin shell with the error boundary.
export async function load<T>(p: Promise<T>): Promise<Loaded<T>> {
  try {
    return { data: await p, error: null };
  } catch (e) {
    if (e instanceof ApiError) return { data: null, error: { status: e.status, code: e.code } };
    throw e;
  }
}

export function toApiError(e: LoadError): ApiError {
  return new ApiError(e.status, e.code, "");
}

export interface Listing<T> {
  rows: T[];
  page: Page | undefined;
}

export async function loadList<T>(path: string, opts: RequestOptions): Promise<Loaded<Listing<T>>> {
  return load(api<T[]>(path, opts).then((r) => ({ rows: r.data ?? [], page: r.meta })));
}

type Query = RequestOptions["query"];

// useApiQuery fetches on the client for data that depends on dialog choices (a boat's areas,
// customer search). A newer request aborts the previous one.
export function useApiQuery<T>(path: string | null, query?: Query) {
  const [state, setState] = useState<{ data: T | null; error: unknown; loading: boolean }>({ data: null, error: null, loading: !!path });
  const [tick, setTick] = useState(0);
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  useEffect(() => {
    if (!path) {
      setState({ data: null, error: null, loading: false });
      return;
    }
    const ctrl = new AbortController();
    setState((s) => ({ data: s.data, error: null, loading: true }));
    api<T>(path, { query, signal: ctrl.signal })
      .then((r) => setState({ data: r.data, error: null, loading: false }))
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") setState({ data: null, error: e, loading: false });
      });
    return () => ctrl.abort();
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

export function useAction() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const run = useCallback(async <T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    setPending(true);
    setError(null);
    try {
      const value = await fn();
      return { ok: true, value };
    } catch (e) {
      if (mounted.current) setError(e);
      return { ok: false };
    } finally {
      if (mounted.current) setPending(false);
    }
  }, []);
  const reset = useCallback(() => setError(null), []);
  return { pending, error, run, reset };
}

// useFilterParams keeps list filters in the URL so they survive reloads and can be shared;
// changing a filter returns to the first page.
export function useFilterParams() {
  const [params, setParams] = useSearchParams();
  const set = useCallback(
    (updates: Record<string, string | null | undefined>) => {
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          for (const [k, v] of Object.entries(updates)) {
            if (v === null || v === undefined || v === "") next.delete(k);
            else next.set(k, v);
          }
          if (!("page" in updates)) next.delete("page");
          return next;
        },
        { replace: true, preventScrollReset: true },
      );
    },
    [setParams],
  );
  const clear = useCallback(
    (keys: string[]) => set(Object.fromEntries(keys.map((k) => [k, null]))),
    [set],
  );
  const get = (k: string) => params.get(k) ?? "";
  const activeCount = (keys: string[]) => keys.filter((k) => params.get(k)).length;
  return { params, get, set, clear, activeCount };
}

export function pageQuery(url: URL, keys: string[]): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = { page: url.searchParams.get("page") ?? undefined };
  for (const k of keys) out[k] = url.searchParams.get(k) || undefined;
  return out;
}
