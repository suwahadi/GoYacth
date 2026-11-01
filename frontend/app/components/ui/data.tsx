import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import type { Page } from "~/lib/api";
import { useT, useTCode } from "~/lib/i18n";
import type { Img } from "~/lib/types";

import { cn } from "./cn";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
  // primary columns are shown as the card title in the mobile list.
  primary?: boolean;
}

// DataTable renders a table on wide screens and a stacked card list on phones, so data screens
// never scroll horizontally.
export function DataTable<T>({ rows, columns, rowKey, onRowHref }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; onRowHref?: (r: T) => string }) {
  return (
    <>
      <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
        <table className="w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => (
                <th key={c.key} scope="col" className={cn("px-3 py-2 font-medium", c.className)}>
                  {c.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={rowKey(r)} className="border-t border-border hover:bg-surface-2">
                {columns.map((c, i) => (
                  <td key={c.key} className={cn("px-3 py-2 align-top", c.className)}>
                    {onRowHref && i === 0 ? (
                      <Link to={onRowHref(r)} className="font-medium text-primary hover:underline">
                        {c.cell(r)}
                      </Link>
                    ) : (
                      c.cell(r)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => {
          const primary = columns.find((c) => c.primary) ?? columns[0];
          const body = (
            <div className="rounded-lg border border-border bg-surface p-3">
              <div className="font-medium">{primary.cell(r)}</div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                {columns
                  .filter((c) => c !== primary)
                  .map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="text-muted">{c.header}</dt>
                      <dd className="truncate">{c.cell(r)}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          );
          return <li key={rowKey(r)}>{onRowHref ? <Link to={onRowHref(r)}>{body}</Link> : body}</li>;
        })}
      </ul>
    </>
  );
}

export function Pagination({ page }: { page: Page }) {
  const t = useT();
  const [params] = useSearchParams();
  const totalPages = Math.max(1, Math.ceil(page.total / page.per_page));
  if (totalPages <= 1) return null;
  const href = (p: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(p));
    return `?${next.toString()}`;
  };
  return (
    <nav aria-label="Pagination" className="mt-4 flex items-center justify-between gap-3 text-sm">
      <span className="text-muted">{t("common.pagination.page_of", { page: page.page, total: totalPages })}</span>
      <div className="grid grid-cols-2 gap-2">
        {page.page > 1 ? (
          <Link className="rounded-md border border-border bg-surface px-3 py-1.5 text-center hover:bg-surface-2" to={href(page.page - 1)} rel="prev">
            {t("common.actions.previous")}
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-center opacity-50">{t("common.actions.previous")}</span>
        )}
        {page.page < totalPages ? (
          <Link className="rounded-md border border-border bg-surface px-3 py-1.5 text-center hover:bg-surface-2" to={href(page.page + 1)} rel="next">
            {t("common.actions.next")}
          </Link>
        ) : (
          <span className="rounded-md border border-border px-3 py-1.5 text-center opacity-50">{t("common.actions.next")}</span>
        )}
      </div>
    </nav>
  );
}

type Tone = "neutral" | "success" | "warning" | "danger" | "info";

const badgeTones: Record<Tone, string> = {
  neutral: "bg-surface-2 text-fg",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  danger: "bg-danger-bg text-danger",
  info: "bg-info-bg text-primary",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", badgeTones[tone])}>{children}</span>;
}

const statusTones: Record<string, Tone> = {
  CONFIRMED: "success",
  COMPLETED: "neutral",
  IN_PROGRESS: "info",
  PENDING_PAYMENT: "warning",
  CANCELLED: "danger",
  EXPIRED: "neutral",
  PAID: "success",
  DEPOSIT_PAID: "info",
  UNPAID: "warning",
  REFUNDED: "neutral",
  PARTIALLY_REFUNDED: "neutral",
  SUCCEEDED: "success",
  PENDING: "warning",
  FAILED: "danger",
  REQUESTED: "warning",
  APPROVED: "info",
  PROCESSING: "info",
  REJECTED: "danger",
  PUBLISHED: "success",
  DRAFT: "neutral",
  ARCHIVED: "neutral",
  ACTIVE: "success",
  INACTIVE: "neutral",
  DISABLED: "danger",
  SCHEDULED: "success",
  READY: "success",
};

// StatusBadge translates a status code from the API and colours it consistently.
export function StatusBadge({ status }: { status: string }) {
  const tc = useTCode();
  return <Badge tone={statusTones[status] ?? "neutral"}>{tc("common.status", status)}</Badge>;
}

// ResponsiveImage renders server-generated WebP variants with explicit dimensions to avoid
// layout shift.
export function ResponsiveImage({ image, sizes, className, priority }: { image: Img | null | undefined; sizes: string; className?: string; priority?: boolean }) {
  if (!image || image.sources.length === 0) {
    return <div className={cn("bg-surface-2", className)} aria-hidden="true" />;
  }
  const largest = image.sources[image.sources.length - 1];
  const fallback = image.sources.find((s) => s.width >= 800) ?? largest;
  return (
    <img
      src={fallback.url}
      srcSet={image.sources.map((s) => `${s.url} ${s.width}w`).join(", ")}
      sizes={sizes}
      width={largest.width}
      height={largest.height}
      alt={image.alt}
      loading={priority ? "eager" : "lazy"}
      fetchPriority={priority ? "high" : undefined}
      decoding="async"
      className={cn("object-cover", className)}
    />
  );
}

export function Tabs({ tabs, active, onChange }: { tabs: { id: string; label: string }[]; active: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border">
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={active === t.id}
          onClick={() => onChange(t.id)}
          className={cn("whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium", active === t.id ? "border-primary text-primary" : "border-transparent text-muted hover:text-fg")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("rounded-lg border border-border bg-surface p-4", className)}>{children}</div>;
}

export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-6xl px-4", className)}>{children}</div>;
}
