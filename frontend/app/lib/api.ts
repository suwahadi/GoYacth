// Thin HTTP client for the Go API. It carries no business logic: SSR loaders and components use
// it to fetch data and submit choices; prices, availability and permissions come from the API.

export class ApiError extends Error {
  status: number;
  code: string;
  fields: Record<string, string>;
  constructor(status: number, code: string, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.code = code;
    this.fields = fields ?? {};
  }
}

export interface Page {
  page: number;
  per_page: number;
  total: number;
}

export interface Envelope<T, M = Page> {
  data: T;
  meta?: M;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface RequestOptions {
  method?: Method;
  body?: unknown;
  // request is the incoming SSR request; its cookies are forwarded so the API sees the session.
  request?: Request;
  idempotencyKey?: string;
  signal?: AbortSignal;
  query?: Record<string, string | number | boolean | undefined | null>;
}

const isServer = typeof window === "undefined";

function baseURL(): string {
  if (isServer) {
    return (process.env.API_INTERNAL_URL ?? "http://localhost:8080").replace(/\/$/, "");
  }
  return "";
}

export function readCookie(name: string, cookieHeader?: string | null): string | undefined {
  const source = cookieHeader ?? (isServer ? "" : document.cookie);
  for (const part of source.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function buildQuery(q?: RequestOptions["query"]): string {
  if (!q) return "";
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : "";
}

export async function apiRaw(path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers = new Headers({ Accept: "application/json" });
  const method = opts.method ?? "GET";
  if (opts.body !== undefined && !(opts.body instanceof FormData)) headers.set("Content-Type", "application/json");
  if (opts.idempotencyKey) headers.set("Idempotency-Key", opts.idempotencyKey);
  if (isServer && opts.request) {
    const cookie = opts.request.headers.get("Cookie");
    if (cookie) headers.set("Cookie", cookie);
    const reqID = opts.request.headers.get("X-Request-ID");
    if (reqID) headers.set("X-Request-ID", reqID);
  }
  if (!isServer && method !== "GET") {
    const csrf = readCookie("gy_csrf");
    if (csrf) headers.set("X-CSRF-Token", csrf);
  }
  const body = opts.body === undefined ? undefined : opts.body instanceof FormData ? opts.body : JSON.stringify(opts.body);
  try {
    return await fetch(`${baseURL()}/api/v1${path}${buildQuery(opts.query)}`, {
      method,
      headers,
      body,
      signal: opts.signal,
      credentials: "same-origin",
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw err;
    throw new ApiError(0, "NETWORK", "network error");
  }
}

export async function api<T, M = Page>(path: string, opts: RequestOptions = {}): Promise<Envelope<T, M>> {
  const res = await apiRaw(path, opts);
  if (res.status === 204) return { data: undefined as T };
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new ApiError(res.status, res.status >= 500 ? "INTERNAL_ERROR" : "UNKNOWN", "invalid response");
  }
  if (!res.ok) {
    const e = (json as { error?: { code?: string; message?: string; fields?: Record<string, string> } }).error ?? {};
    throw new ApiError(res.status, e.code ?? "UNKNOWN", e.message ?? "request failed", e.fields);
  }
  return json as Envelope<T, M>;
}

export async function apiData<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  return (await api<T>(path, opts)).data;
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}

// notFoundToResponse turns an API 404/410 into the matching route response so SSR returns the
// correct status code for SEO.
export function httpStatusFor(err: unknown): number {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 410 || err.status === 401 || err.status === 403) return err.status;
    if (err.status === 0) return 503;
  }
  return 500;
}
