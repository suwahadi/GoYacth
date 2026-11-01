import { useState } from "react";
import { Link, useRevalidator } from "react-router";

import { Alert, Button, ButtonPair, DataTable, Dialog, EmptyState, Field, Textarea, useToast } from "~/components/ui";
import { api, apiData } from "~/lib/api";
import { formatDateTime } from "~/lib/format";
import { adminT } from "~/lib/i18n";

import { load, useAction } from "./hooks";
import { ADMIN_TZ } from "./time";
import type { BookingRequest } from "./types";
import { OpsError, opsCode } from "./ui";

export interface PendingRequestRow extends BookingRequest {
  booking_number: string;
  booking_public_id: string;
}

export function loadRequests(request: Request) {
  return load(apiData<PendingRequestRow[]>("/admin/requests", { request }));
}

export function ResolveRequestDialog({ req, onClose }: { req: BookingRequest | null; onClose: () => void }) {
  const [resolution, setResolution] = useState("");
  const action = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  const submit = async (approve: boolean) => {
    if (!req) return;
    const r = await action.run(() => api(`/admin/requests/${req.id}/resolve`, { method: "POST", body: { approve, resolution } }));
    if (r.ok) {
      toast(adminT(approve ? "ops.requests.approved" : "ops.requests.rejected"));
      setResolution("");
      onClose();
      revalidator.revalidate();
    }
  };
  return (
    <Dialog
      open={!!req}
      onClose={onClose}
      title={adminT("ops.requests.resolve_title")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={() => submit(false)} pending={action.pending}>
            {adminT("ops.requests.reject")}
          </Button>
          <Button onClick={() => submit(true)} pending={action.pending}>
            {adminT("ops.requests.approve")}
          </Button>
        </ButtonPair>
      }
    >
      {req && (
        <div className="space-y-3 text-sm">
          <p>
            <strong>{opsCode("request_type", req.type)}</strong>
          </p>
          {req.message && <blockquote className="border-l-2 border-border pl-3">{req.message}</blockquote>}
          <Alert tone="warning">{adminT(req.type === "CANCEL" ? "ops.requests.cancel_effect" : "ops.requests.reschedule_effect")}</Alert>
          <Field label={adminT("ops.requests.resolution")}>
            {(p) => <Textarea {...p} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} />}
          </Field>
          <OpsError error={action.error} />
        </div>
      )}
    </Dialog>
  );
}

export function RequestsList({ rows }: { rows: PendingRequestRow[] }) {
  const [open, setOpen] = useState<PendingRequestRow | null>(null);
  if (rows.length === 0) return <EmptyState title={adminT("ops.requests.empty")} />;
  return (
    <>
      <DataTable
        rows={rows}
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
          { key: "type", header: adminT("ops.requests.type"), cell: (r) => opsCode("request_type", r.type) },
          { key: "message", header: adminT("ops.requests.message"), cell: (r) => r.message || "—" },
          { key: "created", header: adminT("ops.common.created"), cell: (r) => formatDateTime(r.created_at, ADMIN_TZ, "en") },
          {
            key: "act",
            header: adminT("ops.common.actions"),
            cell: (r) => (
              <Button size="sm" variant="secondary" onClick={() => setOpen(r)}>
                {adminT("ops.requests.resolve")}
              </Button>
            ),
          },
        ]}
      />
      <ResolveRequestDialog req={open} onClose={() => setOpen(null)} />
    </>
  );
}
