import { useState, type ReactNode } from "react";
import { Link, useLocation, useNavigation, useRevalidator } from "react-router";

import { Badge, ErrorState, Field, Input, SkeletonList, useApiErrorText } from "~/components/ui";
import { ApiError } from "~/lib/api";
import { formatDateTime, formatIDR, formatPlainDate } from "~/lib/format";
import { adminT, type AdminKey } from "~/lib/i18n";

import { toApiError, type LoadError } from "./hooks";

// opsCode translates an API code (status, kind, method) under ops.<group>, falling back to the
// raw code so an unknown value is still visible.
export function opsCode(group: string, code: string | null | undefined): string {
  if (!code) return "";
  const key = `ops.${group}.${code}`;
  const text = adminT(key as AdminKey);
  return text === key ? code : text;
}

export function useOpsErrorText() {
  const generic = useApiErrorText();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const key = `ops.errors.${err.code}`;
      const text = adminT(key as AdminKey);
      if (text !== key) return text;
    }
    return generic(err);
  };
}

export function OpsError({ error, className }: { error: unknown; className?: string }) {
  const text = useOpsErrorText();
  if (!error) return null;
  return (
    <p role="alert" className={className ?? "rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger"}>
      {text(error)}
    </p>
  );
}

export function LoadFailure({ error }: { error: LoadError }) {
  const text = useOpsErrorText();
  const revalidator = useRevalidator();
  return <ErrorState message={text(toApiError(error))} onRetry={() => revalidator.revalidate()} />;
}

// Pending shows a skeleton while the current route reloads its data after a filter change.
export function Pending({ children, rows = 4 }: { children: ReactNode; rows?: number }) {
  const navigation = useNavigation();
  const location = useLocation();
  const reloading = navigation.state === "loading" && navigation.location?.pathname === location.pathname;
  return reloading ? <SkeletonList rows={rows} /> : <>{children}</>;
}

export function PageHeader({ title, back, actions, children }: { title: string; back?: { to: string; label: string }; actions?: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-4 space-y-1">
      {back && (
        <Link to={back.to} className="text-sm text-primary hover:underline">
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{title}</h1>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </header>
  );
}

export function Section({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function Details({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-muted">{i.label}</dt>
          <dd className="break-words">{i.value === "" || i.value === null || i.value === undefined ? "—" : i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function idr(amount: number): string {
  return formatIDR(amount, "en");
}

export function when(iso: string | null | undefined, tz: string): string {
  return iso ? formatDateTime(iso, tz, "en") : "—";
}

export function plainDate(ymd: string | null | undefined): string {
  return ymd ? formatPlainDate(ymd.slice(0, 10), "en") : "—";
}

// TextFilter commits on Enter or blur so typing does not reload the list on every key.
export function TextFilter({ label, value, onCommit, placeholder }: { label: string; value: string; onCommit: (v: string) => void; placeholder?: string }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  return (
    <Field label={label}>
      {(p) => (
        <Input
          {...p}
          type="search"
          value={draft}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft !== value && onCommit(draft.trim())}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onCommit(draft.trim());
            }
          }}
        />
      )}
    </Field>
  );
}

export function apiHref(path: string, query?: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) if (v) p.set(k, v);
  const s = p.toString();
  return `/api/v1${path}${s ? `?${s}` : ""}`;
}

export function DocLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener" className="text-sm text-primary underline-offset-2 hover:underline">
      {children}
    </a>
  );
}

export function digitsOnly(v: string): string {
  return v.replace(/[^0-9]/g, "");
}

export function UserStatusBadge({ status }: { status: string }) {
  return <Badge tone={status === "ACTIVE" ? "success" : status === "DISABLED" ? "danger" : "neutral"}>{opsCode("user_status", status)}</Badge>;
}
