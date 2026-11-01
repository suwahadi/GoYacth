import { useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/payments";
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, FilterBar, Pagination, Select, StatusBadge, Tabs, useToast } from "~/components/ui";
import { load, loadList, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AdminPaymentRow, PaymentEvent } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Pending, TextFilter, apiHref, idr, opsCode, when } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { adminT, useTCode } from "~/lib/i18n";

const STATUSES = ["PENDING", "SUCCEEDED", "FAILED", "EXPIRED", "CANCELLED"];
const METHODS = ["CREDIT_CARD", "QRIS", "BCA_VA", "BNI_VA", "BRI_VA", "MANDIRI_VA", "PERMATA_VA", "BANK_TRANSFER", "CASH"];
const EVENTS_PER_PAGE = 50;
type Tab = "transactions" | "exceptions" | "events";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const tab = (["exceptions", "events"].includes(q("tab") ?? "") ? q("tab") : "transactions") as Tab;
  if (tab === "events") {
    const page = Number(q("page") ?? 1) || 1;
    return { tab, page, events: await load(apiData<PaymentEvent[]>("/admin/payment-events", { request, query: { order_id: q("order_id"), page, per_page: EVENTS_PER_PAGE } })), payments: null };
  }
  const payments = await loadList<AdminPaymentRow>("/admin/payments", {
    request,
    query: tab === "exceptions" ? { exceptions: "true", page: q("page") } : { status: q("status"), method: q("method"), page: q("page") },
  });
  return { tab, page: 1, payments, events: null };
}

export function meta() {
  return [{ title: `${adminT("ops.payments.title")} | GoYacht Admin` }];
}

function PaymentsTable({ rows, exceptionActions }: { rows: AdminPaymentRow[]; exceptionActions?: boolean }) {
  const [target, setTarget] = useState<AdminPaymentRow | null>(null);
  const action = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  const createRefund = async () => {
    if (!target) return;
    const r = await action.run(() => api(`/admin/payments/${target.id}/refund-exception`, { method: "POST" }));
    if (r.ok) {
      setTarget(null);
      toast(adminT("ops.payments.refund_created"));
      revalidator.revalidate();
    }
  };
  return (
    <>
      <DataTable
        rows={rows}
        rowKey={(p) => p.id}
        columns={[
          {
            key: "booking",
            header: adminT("ops.bookings.number"),
            primary: true,
            cell: (p) => (
              <Link to={`/admin/bookings/${p.booking_id}`} className="font-medium text-primary hover:underline">
                {p.booking_number}
              </Link>
            ),
          },
          { key: "order", header: adminT("ops.payments.order"), cell: (p) => <span className="break-all">{p.order_id}</span> },
          { key: "method", header: adminT("ops.payments.method"), cell: (p) => `${opsCode("method", p.method)} · ${opsCode("payment_kind", p.kind)}` },
          { key: "amount", header: adminT("ops.payments.amount"), cell: (p) => idr(p.gross_amount) },
          {
            key: "status",
            header: adminT("ops.bookings.status"),
            cell: (p) => (
              <span className="flex flex-wrap gap-1">
                <StatusBadge status={p.status} />
                {p.is_exception && <Badge tone="danger">{adminT("ops.bookings.exception")}</Badge>}
                {p.provider_status && <span className="text-xs text-muted">{p.provider_status}</span>}
              </span>
            ),
          },
          { key: "time", header: adminT("ops.payments.paid_at"), cell: (p) => when(p.paid_at ?? p.created_at, ADMIN_TZ) },
          {
            key: "extra",
            header: adminT("ops.common.details"),
            cell: (p) => (
              <span className="flex flex-wrap items-center gap-2">
                {p.notes && <span className="text-xs">{p.notes}</span>}
                {p.proof_media_id && (
                  <a href={apiHref(`/admin/files/${p.proof_media_id}`)} target="_blank" rel="noopener" className="text-xs text-primary hover:underline">
                    {adminT("ops.proof.view")}
                  </a>
                )}
                {exceptionActions && (
                  <Button size="sm" variant="secondary" onClick={() => setTarget(p)}>
                    {adminT("ops.payments.create_refund")}
                  </Button>
                )}
              </span>
            ),
          },
        ]}
      />
      <ConfirmDialog
        open={!!target}
        title={adminT("ops.payments.create_refund")}
        body={
          <div className="space-y-2">
            <p>{target && adminT("ops.payments.create_refund_body", { amount: idr(target.gross_amount), number: target.booking_number })}</p>
            <OpsError error={action.error} />
          </div>
        }
        confirmLabel={adminT("ops.payments.create_refund")}
        pending={action.pending}
        onConfirm={createRefund}
        onClose={() => setTarget(null)}
      />
    </>
  );
}

export default function PaymentsPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const tc = useTCode();
  const { tab } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.payments.title")} />
      <Tabs
        tabs={[
          { id: "transactions", label: adminT("ops.payments.tab_transactions") },
          { id: "exceptions", label: adminT("ops.payments.tab_exceptions") },
          { id: "events", label: adminT("ops.payments.tab_events") },
        ]}
        active={tab}
        onChange={(id) => f.set({ tab: id === "transactions" ? null : id, status: null, method: null, order_id: null })}
      />
      {tab === "transactions" && (
        <FilterBar activeCount={f.activeCount(["status", "method"])} onClear={() => f.clear(["status", "method"])}>
          <Field label={adminT("ops.bookings.status")}>
            {(p) => (
              <Select {...p} value={f.get("status")} onChange={(e) => f.set({ status: e.target.value })}>
                <option value="">{adminT("ops.common.any")}</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {tc("common.status", s)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={adminT("ops.payments.method")}>
            {(p) => (
              <Select {...p} value={f.get("method")} onChange={(e) => f.set({ method: e.target.value })}>
                <option value="">{adminT("ops.common.any")}</option>
                {METHODS.map((m) => (
                  <option key={m} value={m}>
                    {opsCode("method", m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </FilterBar>
      )}
      {tab === "exceptions" && <p className="text-sm text-muted">{adminT("ops.payments.exceptions_intro")}</p>}
      {tab === "events" && (
        <FilterBar activeCount={f.activeCount(["order_id"])} onClear={() => f.clear(["order_id"])}>
          <TextFilter label={adminT("ops.payments.order")} value={f.get("order_id")} onCommit={(v) => f.set({ order_id: v })} />
        </FilterBar>
      )}
      <Pending>
        {loaderData.payments &&
          (loaderData.payments.error ? (
            <LoadFailure error={loaderData.payments.error} />
          ) : loaderData.payments.data.rows.length === 0 ? (
            <EmptyState title={adminT(tab === "exceptions" ? "ops.payments.no_exceptions" : "ops.payments.empty")} />
          ) : (
            <>
              <PaymentsTable rows={loaderData.payments.data.rows} exceptionActions={tab === "exceptions"} />
              {loaderData.payments.data.page && <Pagination page={loaderData.payments.data.page} />}
            </>
          ))}
        {loaderData.events &&
          (loaderData.events.error ? (
            <LoadFailure error={loaderData.events.error} />
          ) : loaderData.events.data.length === 0 ? (
            <EmptyState title={adminT("ops.payments.no_events")} />
          ) : (
            <>
              <DataTable
                rows={loaderData.events.data}
                rowKey={(e) => e.id}
                columns={[
                  { key: "order", header: adminT("ops.payments.order"), cell: (e) => <span className="break-all">{e.order_id}</span>, primary: true },
                  { key: "source", header: adminT("ops.payments.source"), cell: (e) => e.source },
                  { key: "status", header: adminT("ops.payments.provider_status"), cell: (e) => [e.transaction_status, e.fraud_status, e.status_code].filter(Boolean).join(" · ") },
                  { key: "amount", header: adminT("ops.payments.amount"), cell: (e) => e.gross_amount },
                  { key: "verdict", header: adminT("ops.payments.verdict"), cell: (e) => `${opsCode("verdict", e.verdict)}${e.verdict_reason ? ` · ${e.verdict_reason}` : ""}` },
                  { key: "time", header: adminT("ops.payments.received"), cell: (e) => when(e.created_at, ADMIN_TZ) },
                ]}
              />
              <nav aria-label={adminT("ops.common.pages")} className="flex justify-between text-sm">
                {loaderData.page > 1 ? (
                  <button type="button" className="text-primary hover:underline" onClick={() => f.set({ page: String(loaderData.page - 1) })}>
                    {adminT("ops.common.newer")}
                  </button>
                ) : (
                  <span />
                )}
                {loaderData.events.data.length === EVENTS_PER_PAGE && (
                  <button type="button" className="text-primary hover:underline" onClick={() => f.set({ page: String(loaderData.page + 1) })}>
                    {adminT("ops.common.older")}
                  </button>
                )}
              </nav>
            </>
          ))}
      </Pending>
    </div>
  );
}
