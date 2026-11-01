import { useState } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/customer";
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState, Pagination, StatusBadge, useToast } from "~/components/ui";
import { load, loadList, useAction } from "~/features/admin-ops/hooks";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AdminBookingRow, AdminUser } from "~/features/admin-ops/types";
import { Details, LoadFailure, OpsError, PageHeader, Section, UserStatusBadge, idr, opsCode, when } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { countryName } from "~/lib/format";
import { adminT, type AdminKey } from "~/lib/i18n";

export async function loader({ request, params }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const [user, bookings] = await Promise.all([
    load(apiData<AdminUser>(`/admin/users/${params.id}`, { request })),
    loadList<AdminBookingRow>("/admin/bookings", { request, query: { user_id: params.id, page: url.searchParams.get("page") || undefined } }),
  ]);
  return { user, bookings };
}

export function meta({ loaderData }: Route.MetaArgs) {
  const u = loaderData?.user?.data;
  return [{ title: `${u ? u.full_name || u.email : adminT("ops.customer.title")} | GoYacht Admin` }];
}

type Pending = { kind: "disable" | "enable" | "demote" | "anonymize"; title: AdminKey; body: AdminKey; confirm: AdminKey } | null;

const ACTIONS = {
  disable: { kind: "disable", title: "ops.customer.disable", body: "ops.customer.disable_body", confirm: "ops.customer.disable" },
  enable: { kind: "enable", title: "ops.customer.enable", body: "ops.customer.enable_body", confirm: "ops.customer.enable" },
  demote: { kind: "demote", title: "ops.customer.demote", body: "ops.customer.demote_body", confirm: "ops.customer.demote" },
  anonymize: { kind: "anonymize", title: "ops.customer.anonymize", body: "ops.customer.anonymize_body", confirm: "ops.customer.anonymize" },
} as const;

export default function CustomerPage({ loaderData }: Route.ComponentProps) {
  const [pending, setPending] = useState<Pending>(null);
  const action = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  const back = { to: "/admin/customers", label: adminT("ops.customers.back") };
  if (loaderData.user.error) {
    return (
      <div className="space-y-4">
        <PageHeader title={adminT("ops.customer.title")} back={back} />
        <LoadFailure error={loaderData.user.error} />
      </div>
    );
  }
  const u = loaderData.user.data;
  const run = async () => {
    if (!pending) return;
    const id = u.id;
    const call = {
      disable: () => api(`/admin/users/${id}/status`, { method: "POST", body: { status: "DISABLED" } }),
      enable: () => api(`/admin/users/${id}/status`, { method: "POST", body: { status: "ACTIVE" } }),
      demote: () => api(`/admin/users/${id}/demote`, { method: "POST" }),
      anonymize: () => api(`/admin/users/${id}/anonymize`, { method: "POST" }),
    }[pending.kind];
    const r = await action.run(call);
    if (r.ok) {
      toast(adminT("ops.customer.updated"));
      setPending(null);
      revalidator.revalidate();
    }
  };
  const open = (p: Pending) => {
    action.reset();
    setPending(p);
  };
  const anonymized = u.status === "ANONYMIZED";
  return (
    <div className="space-y-6">
      <PageHeader
        title={u.full_name || u.email}
        back={back}
        actions={
          !anonymized && (
            <>
              {u.status === "ACTIVE" ? (
                <Button size="sm" variant="secondary" onClick={() => open(ACTIONS.disable)}>
                  {adminT("ops.customer.disable")}
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => open(ACTIONS.enable)}>
                  {adminT("ops.customer.enable")}
                </Button>
              )}
              {u.role === "ADMIN" && (
                <Button size="sm" variant="secondary" onClick={() => open(ACTIONS.demote)}>
                  {adminT("ops.customer.demote")}
                </Button>
              )}
              {u.role !== "ADMIN" && (
                <Button size="sm" variant="danger" onClick={() => open(ACTIONS.anonymize)}>
                  {adminT("ops.customer.anonymize")}
                </Button>
              )}
            </>
          )
        }
      >
        <div className="flex flex-wrap gap-2">
          <UserStatusBadge status={u.status} />
          <span className="text-sm text-muted">{opsCode("role", u.role)}</span>
        </div>
      </PageHeader>
      {anonymized && <Alert tone="info">{adminT("ops.customer.anonymized_note")}</Alert>}
      <Card>
        <Details
          items={[
            { label: adminT("ops.people.email"), value: u.email },
            { label: adminT("ops.people.phone"), value: u.phone },
            { label: adminT("ops.people.nationality"), value: u.nationality ? countryName(u.nationality, "en") : "" },
            { label: adminT("ops.booking.locale"), value: u.locale },
            { label: adminT("ops.customers.last_login"), value: when(u.last_login_at, ADMIN_TZ) },
            { label: adminT("ops.common.created"), value: when(u.created_at, ADMIN_TZ) },
            {
              label: adminT("ops.customer.audit"),
              value: (
                <Link to={`/admin/audit?entity_type=user&entity_id=${u.id}`} className="text-primary hover:underline">
                  {adminT("ops.customer.audit_link")}
                </Link>
              ),
            },
          ]}
        />
      </Card>
      <Section title={adminT("ops.customer.bookings")}>
        {loaderData.bookings.error ? (
          <LoadFailure error={loaderData.bookings.error} />
        ) : loaderData.bookings.data.rows.length === 0 ? (
          <EmptyState title={adminT("ops.customer.no_bookings")} />
        ) : (
          <>
            <DataTable
              rows={loaderData.bookings.data.rows}
              rowKey={(b) => b.id}
              onRowHref={(b) => `/admin/bookings/${b.id}`}
              columns={[
                { key: "number", header: adminT("ops.bookings.number"), cell: (b) => b.booking_number, primary: true },
                { key: "starts", header: adminT("ops.bookings.starts"), cell: (b) => when(b.starts_at, b.timezone) },
                { key: "boat", header: adminT("ops.bookings.boat"), cell: (b) => b.boat_name },
                { key: "status", header: adminT("ops.bookings.status"), cell: (b) => <StatusBadge status={b.status} /> },
                { key: "payment", header: adminT("ops.bookings.payment_status"), cell: (b) => <StatusBadge status={b.payment_status} /> },
                { key: "total", header: adminT("ops.bookings.total"), cell: (b) => idr(b.grand_total) },
              ]}
            />
            {loaderData.bookings.data.page && <Pagination page={loaderData.bookings.data.page} />}
          </>
        )}
      </Section>
      <ConfirmDialog
        open={!!pending}
        tone={pending?.kind === "enable" ? "primary" : "danger"}
        title={pending ? adminT(pending.title) : ""}
        body={
          <div className="space-y-2">
            <p>{pending ? adminT(pending.body, { email: u.email }) : ""}</p>
            <OpsError error={action.error} />
          </div>
        }
        confirmLabel={pending ? adminT(pending.confirm) : ""}
        pending={action.pending}
        onConfirm={run}
        onClose={() => setPending(null)}
      />
    </div>
  );
}
