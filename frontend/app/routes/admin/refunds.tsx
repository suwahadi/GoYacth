import { useEffect, useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/refunds";
import { Alert, Button, ButtonPair, DataTable, Dialog, EmptyState, Field, FilterBar, Pagination, Select, StatusBadge, Textarea, useToast } from "~/components/ui";
import { loadList, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ProofUpload } from "~/features/admin-ops/proof-upload";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AdminRefundRow, Refund } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Pending, apiHref, idr, opsCode, when } from "~/features/admin-ops/ui";
import { api } from "~/lib/api";
import { adminT, useTCode } from "~/lib/i18n";

const STATUSES: Refund["status"][] = ["REQUESTED", "APPROVED", "PROCESSING", "COMPLETED", "REJECTED"];
type Target = Exclude<Refund["status"], "REQUESTED">;

// The API owns the refund state machine and rejects anything else; this table only decides
// which buttons are worth offering. Provider refunds finish through the Midtrans job.
function offeredTransitions(r: Refund): Target[] {
  switch (r.status) {
    case "REQUESTED":
      return ["APPROVED", "REJECTED"];
    case "APPROVED":
      return r.channel === "MANUAL" ? ["PROCESSING", "COMPLETED", "REJECTED"] : ["REJECTED"];
    case "PROCESSING":
      return r.channel === "MANUAL" ? ["COMPLETED"] : [];
    default:
      return [];
  }
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  return loadList<AdminRefundRow>("/admin/refunds", { request, query: { status: url.searchParams.get("status") || undefined, page: url.searchParams.get("page") || undefined } });
}

export function meta() {
  return [{ title: `${adminT("ops.refunds.title")} | GoYacht Admin` }];
}

function TransitionDialog({ target, onClose }: { target: { refund: AdminRefundRow; to: Target } | null; onClose: () => void }) {
  const [notes, setNotes] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const action = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  useEffect(() => {
    setNotes("");
    setProof(null);
    action.reset();
  }, [target]);
  const needsProof = target?.to === "COMPLETED" && !target.refund.proof_media_id;
  const submit = async () => {
    if (!target) return;
    const r = await action.run(() => api(`/admin/refunds/${target.refund.id}/transition`, { method: "POST", body: { status: target.to, proof_media_id: proof, notes } }));
    if (r.ok) {
      toast(adminT("ops.refunds.updated"));
      onClose();
      revalidator.revalidate();
    }
  };
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      title={target ? opsCode("refund_action", target.to) : ""}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            {adminT("ops.common.cancel")}
          </Button>
          <Button variant={target?.to === "REJECTED" ? "danger" : "primary"} onClick={submit} pending={action.pending} disabled={needsProof && !proof}>
            {target ? opsCode("refund_action", target.to) : ""}
          </Button>
        </ButtonPair>
      }
    >
      {target && (
        <div className="space-y-3 text-sm">
          <p>{adminT("ops.refunds.transition_body", { amount: idr(target.refund.amount), number: target.refund.booking_number })}</p>
          {target.to === "COMPLETED" && <Alert tone="info">{adminT("ops.refunds.complete_note")}</Alert>}
          {target.to === "COMPLETED" && <ProofUpload slug={`refund-${target.refund.booking_number}`} required={needsProof} onChange={setProof} />}
          <Field label={adminT("ops.common.notes")}>{(p) => <Textarea {...p} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
          <OpsError error={action.error} />
        </div>
      )}
    </Dialog>
  );
}

export default function RefundsPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const tc = useTCode();
  const [target, setTarget] = useState<{ refund: AdminRefundRow; to: Target } | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.refunds.title")} />
      <FilterBar activeCount={f.activeCount(["status"])} onClear={() => f.clear(["status"])}>
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
      </FilterBar>
      {loaderData.error ? (
        <LoadFailure error={loaderData.error} />
      ) : (
        <Pending>
          {loaderData.data.rows.length === 0 ? (
            <EmptyState title={adminT("ops.refunds.empty")} />
          ) : (
            <>
              <DataTable
                rows={loaderData.data.rows}
                rowKey={(r) => r.id}
                columns={[
                  {
                    key: "booking",
                    header: adminT("ops.bookings.number"),
                    primary: true,
                    cell: (r) => (
                      <Link to={`/admin/bookings/${r.booking_public_id}`} className="font-medium text-primary hover:underline">
                        {r.booking_number}
                      </Link>
                    ),
                  },
                  {
                    key: "amount",
                    header: adminT("ops.payments.amount"),
                    cell: (r) => (
                      <span>
                        {idr(r.amount)}
                        {r.includes_fee_amount > 0 && <span className="block text-xs text-muted">{adminT("ops.refunds.includes_fee", { fee: idr(r.includes_fee_amount) })}</span>}
                      </span>
                    ),
                  },
                  { key: "reason", header: adminT("ops.refunds.reason"), cell: (r) => opsCode("refund_reason", r.reason_type) },
                  { key: "channel", header: adminT("ops.refunds.channel"), cell: (r) => opsCode("channel", r.channel) },
                  {
                    key: "bank",
                    header: adminT("ops.refunds.bank"),
                    cell: (r) =>
                      r.channel !== "MANUAL" || (!r.bank_account_number && (r.status === "COMPLETED" || r.status === "REJECTED")) ? (
                        "—"
                      ) : r.bank_account_number ? (
                        <span className="block">
                          {r.bank_name}
                          <span className="block text-xs">
                            {r.bank_account_number} · {r.bank_account_name}
                          </span>
                        </span>
                      ) : (
                        <span className="text-xs text-warning">{adminT("ops.refunds.bank_missing")}</span>
                      ),
                  },
                  {
                    key: "status",
                    header: adminT("ops.bookings.status"),
                    cell: (r) => (
                      <span className="block">
                        <StatusBadge status={r.status} />
                        <span className="block text-xs text-muted">{when(r.completed_at ?? r.created_at, ADMIN_TZ)}</span>
                        {r.proof_media_id && (
                          <a href={apiHref(`/admin/files/${r.proof_media_id}`)} target="_blank" rel="noopener" className="block text-xs text-primary hover:underline">
                            {adminT("ops.proof.view")}
                          </a>
                        )}
                      </span>
                    ),
                  },
                  {
                    key: "actions",
                    header: adminT("ops.common.actions"),
                    cell: (r) => (
                      <span className="flex flex-wrap gap-1">
                        {offeredTransitions(r).map((to) => (
                          <Button key={to} size="sm" variant={to === "REJECTED" ? "ghost" : "secondary"} onClick={() => setTarget({ refund: r, to })}>
                            {opsCode("refund_action", to)}
                          </Button>
                        ))}
                      </span>
                    ),
                  },
                ]}
              />
              {loaderData.data.page && <Pagination page={loaderData.data.page} />}
            </>
          )}
        </Pending>
      )}
      <TransitionDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
