import { useEffect, useState } from "react";

import { ApiError, api, apiData } from "~/lib/api";

import { nameOf } from "./translations";
import type { AdminBoat, AdminPackageSummary, AdminPort, AdminRegion, AdminRoute, CancellationPolicy, NamedItem, Partner, PaymentPolicy } from "./types";

export type Loaded<T> = { ok: true; data: T } | { ok: false; code: string; status: number };

// settle turns a loader request into a value the page can render as an error state with a retry,
// instead of replacing the whole admin shell with the route error boundary.
export async function settle<T>(p: Promise<T>): Promise<Loaded<T>> {
  try {
    return { ok: true, data: await p };
  } catch (e) {
    if (e instanceof ApiError) return { ok: false, code: e.code, status: e.status };
    if (e instanceof Response) throw e;
    return { ok: false, code: "UNKNOWN", status: 500 };
  }
}

export interface Refs {
  categories: NamedItem[];
  classes: NamedItem[];
  facilities: NamedItem[];
  partners: Partner[];
  ports: AdminPort[];
  regions: AdminRegion[];
  routes: AdminRoute[];
  paymentPolicies: PaymentPolicy[];
  cancellationPolicies: CancellationPolicy[];
  boats: AdminBoat[];
  packages: AdminPackageSummary[];
}

const refPaths: Record<keyof Refs, { path: string; query?: Record<string, number> }> = {
  categories: { path: "/admin/categories" },
  classes: { path: "/admin/classes" },
  facilities: { path: "/admin/facilities" },
  partners: { path: "/admin/partners" },
  ports: { path: "/admin/ports" },
  regions: { path: "/admin/regions" },
  routes: { path: "/admin/routes" },
  paymentPolicies: { path: "/admin/payment-policies" },
  cancellationPolicies: { path: "/admin/cancellation-policies" },
  boats: { path: "/admin/boats", query: { per_page: 100 } },
  packages: { path: "/admin/packages" },
};

export async function loadRefs<K extends keyof Refs>(request: Request, keys: K[]): Promise<Pick<Refs, K>> {
  const values = await Promise.all(keys.map((k) => apiData<unknown>(refPaths[k].path, { request, query: refPaths[k].query })));
  const out = {} as Pick<Refs, K>;
  keys.forEach((k, i) => {
    out[k] = values[i] as Refs[K];
  });
  return out;
}

export async function loadPage<T>(path: string, request: Request, query?: Record<string, string | number | undefined>) {
  const res = await api<T[]>(path, { request, query });
  return { rows: res.data, page: res.meta ?? null };
}

export interface Opt {
  value: string;
  label: string;
}

export function named(list: { id: string; translations: unknown }[], key = "name"): Opt[] {
  return list.map((x) => ({ value: x.id, label: nameOf(x.translations, key) || x.id }));
}

export function boatOptions(list: AdminBoat[]): Opt[] {
  return list.map((b) => ({ value: b.id, label: `${b.code} · ${nameOf(b.translations)}` }));
}

export function labelOf(opts: Opt[], id: string | null | undefined): string {
  if (!id) return "";
  return opts.find((o) => o.value === id)?.label ?? id;
}

export interface Fetched<T> {
  loading: boolean;
  data: T | null;
  error: unknown;
  reload: () => void;
}

// useFetch loads data on the client for parts of a page that depend on a selection; a newer
// selection aborts the previous request.
export function useFetch<T>(path: string | null, query?: Record<string, string | number | undefined>): Fetched<T> {
  const [state, setState] = useState<{ loading: boolean; data: T | null; error: unknown }>({ loading: !!path, data: null, error: null });
  const [nonce, setNonce] = useState(0);
  const key = path ? `${path}?${JSON.stringify(query ?? {})}` : null;
  useEffect(() => {
    if (!path) {
      setState({ loading: false, data: null, error: null });
      return;
    }
    const c = new AbortController();
    setState({ loading: true, data: null, error: null });
    apiData<T>(path, { query, signal: c.signal })
      .then((data) => setState({ loading: false, data, error: null }))
      .catch((error) => {
        if ((error as Error).name !== "AbortError") setState({ loading: false, data: null, error });
      });
    return () => c.abort();
  }, [key, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}
