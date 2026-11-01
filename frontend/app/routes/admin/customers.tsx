import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/customers";
import { Badge, Button, ConfirmDialog, DataTable, EmptyState, Field, FilterBar, Input, Pagination, Select, Tabs, useFieldErrors, useToast } from "~/components/ui";
import { load, loadList, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AdminInvite, AdminUser } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Pending, Section, TextFilter, UserStatusBadge, opsCode, when } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";

const FILTERS = ["role", "status", "search"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  if (q("tab") === "invites") {
    return { tab: "invites" as const, invites: await load(apiData<AdminInvite[]>("/admin/admin-invites", { request })), users: null };
  }
  const users = await loadList<AdminUser>("/admin/users", { request, query: { role: q("role"), status: q("status"), search: q("search"), page: q("page") } });
  return { tab: "users" as const, users, invites: null };
}

export function meta() {
  return [{ title: `${adminT("ops.customers.title")} | GoYacht Admin` }];
}

function Invites({ rows }: { rows: AdminInvite[] }) {
  const [email, setEmail] = useState("");
  const [removing, setRemoving] = useState<AdminInvite | null>(null);
  const add = useAction();
  const remove = useAction();
  const fields = useFieldErrors(add.error);
  const revalidator = useRevalidator();
  const toast = useToast();
  const submit = async () => {
    const r = await add.run(() => api("/admin/admin-invites", { method: "POST", body: { email } }));
    if (r.ok) {
      setEmail("");
      toast(adminT("ops.invites.added"));
      revalidator.revalidate();
    }
  };
  const doRemove = async () => {
    if (!removing) return;
    const r = await remove.run(() => api(`/admin/admin-invites/${removing.id}`, { method: "DELETE" }));
    if (r.ok) {
      setRemoving(null);
      toast(adminT("ops.invites.removed"));
      revalidator.revalidate();
    }
  };
  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">{adminT("ops.invites.intro")}</p>
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={adminT("ops.people.email")} error={fields.email} className="min-w-64 flex-1">
          {(p) => <Input {...p} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}
        </Field>
        <Button type="submit" pending={add.pending} disabled={!email.trim()}>
          {adminT("ops.invites.add")}
        </Button>
      </form>
      <OpsError error={add.error} />
      <Section title={adminT("ops.invites.list")}>
        {rows.length === 0 ? (
          <EmptyState title={adminT("ops.invites.empty")} />
        ) : (
          <DataTable
            rows={rows}
            rowKey={(r) => r.id}
            columns={[
              { key: "email", header: adminT("ops.people.email"), cell: (r) => r.email, primary: true },
              { key: "status", header: adminT("ops.bookings.status"), cell: (r) => (r.accepted_at ? <Badge tone="success">{adminT("ops.invites.accepted")}</Badge> : <Badge tone="warning">{adminT("ops.invites.pending")}</Badge>) },
              { key: "created", header: adminT("ops.common.created"), cell: (r) => when(r.created_at, ADMIN_TZ) },
              {
                key: "act",
                header: adminT("ops.common.actions"),
                cell: (r) => (
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(r)}>
                    {adminT("ops.common.remove")}
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Section>
      <ConfirmDialog
        open={!!removing}
        tone="danger"
        title={adminT("ops.invites.remove_title")}
        body={
          <div className="space-y-2">
            <p>{adminT("ops.invites.remove_body", { email: removing?.email ?? "" })}</p>
            <OpsError error={remove.error} />
          </div>
        }
        confirmLabel={adminT("ops.common.remove")}
        pending={remove.pending}
        onConfirm={doRemove}
        onClose={() => setRemoving(null)}
      />
    </div>
  );
}

export default function CustomersPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.customers.title")} />
      <Tabs
        tabs={[
          { id: "users", label: adminT("ops.customers.tab_users") },
          { id: "invites", label: adminT("ops.customers.tab_invites") },
        ]}
        active={loaderData.tab}
        onChange={(id) => f.set({ tab: id === "users" ? null : id })}
      />
      {loaderData.tab === "invites" ? (
        loaderData.invites?.error ? (
          <LoadFailure error={loaderData.invites.error} />
        ) : (
          <Pending>
            <Invites rows={loaderData.invites?.data ?? []} />
          </Pending>
        )
      ) : (
        <>
          <FilterBar activeCount={f.activeCount(FILTERS)} onClear={() => f.clear(FILTERS)}>
            <TextFilter label={adminT("ops.customers.search")} value={f.get("search")} onCommit={(v) => f.set({ search: v })} />
            <Field label={adminT("ops.customers.role")}>
              {(p) => (
                <Select {...p} value={f.get("role")} onChange={(e) => f.set({ role: e.target.value })}>
                  <option value="">{adminT("ops.common.any")}</option>
                  <option value="CUSTOMER">{opsCode("role", "CUSTOMER")}</option>
                  <option value="ADMIN">{opsCode("role", "ADMIN")}</option>
                </Select>
              )}
            </Field>
            <Field label={adminT("ops.bookings.status")}>
              {(p) => (
                <Select {...p} value={f.get("status")} onChange={(e) => f.set({ status: e.target.value })}>
                  <option value="">{adminT("ops.common.any")}</option>
                  {["ACTIVE", "DISABLED", "ANONYMIZED"].map((s) => (
                    <option key={s} value={s}>
                      {opsCode("user_status", s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </FilterBar>
          {loaderData.users?.error ? (
            <LoadFailure error={loaderData.users.error} />
          ) : (
            <Pending>
              {(loaderData.users?.data?.rows.length ?? 0) === 0 ? (
                <EmptyState title={adminT("ops.customers.empty")} />
              ) : (
                <>
                  <DataTable
                    rows={loaderData.users!.data!.rows}
                    rowKey={(u) => u.id}
                    onRowHref={(u) => `/admin/customers/${u.id}`}
                    columns={[
                      { key: "name", header: adminT("ops.people.full_name"), cell: (u) => u.full_name || u.email, primary: true },
                      { key: "email", header: adminT("ops.people.email"), cell: (u) => u.email },
                      { key: "role", header: adminT("ops.customers.role"), cell: (u) => opsCode("role", u.role) },
                      { key: "status", header: adminT("ops.bookings.status"), cell: (u) => <UserStatusBadge status={u.status} /> },
                      { key: "bookings", header: adminT("ops.customers.bookings"), cell: (u) => u.booking_count ?? 0 },
                      { key: "login", header: adminT("ops.customers.last_login"), cell: (u) => when(u.last_login_at, ADMIN_TZ) },
                    ]}
                  />
                  {loaderData.users?.data?.page && <Pagination page={loaderData.users.data.page} />}
                </>
              )}
            </Pending>
          )}
        </>
      )}
    </div>
  );
}
