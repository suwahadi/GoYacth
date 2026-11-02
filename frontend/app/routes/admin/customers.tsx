import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/customers";
import { Button, DataTable, Dialog, EmptyState, Field, FilterBar, Input, Pagination, Select, useFieldErrors, useToast } from "~/components/ui";
import { loadList, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AdminUser } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Pending, TextFilter, UserStatusBadge, opsCode, when } from "~/features/admin-ops/ui";
import { api } from "~/lib/api";
import { adminT } from "~/lib/i18n";

const FILTERS = ["role", "status", "search"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const users = await loadList<AdminUser>("/admin/users", { request, query: { role: q("role"), status: q("status"), search: q("search"), page: q("page") } });
  return { users };
}

export function meta() {
  return [{ title: `${adminT("ops.customers.title")} | GoYacht Admin` }];
}

function NewAdminDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const blank = { email: "", full_name: "", password: "" };
  const [form, setForm] = useState(blank);
  const add = useAction();
  const fields = useFieldErrors(add.error);
  const revalidator = useRevalidator();
  const toast = useToast();
  const submit = async () => {
    const r = await add.run(() => api("/admin/admins", { method: "POST", body: form }));
    if (r.ok) {
      setForm(blank);
      onClose();
      toast(adminT("ops.admins.added"));
      revalidator.revalidate();
    }
  };
  return (
    <Dialog open={open} onClose={onClose} title={adminT("ops.admins.new")}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={adminT("ops.people.email")} error={fields.email} required>
          {(p) => <Input {...p} type="email" required autoComplete="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.people.full_name")}>
          {(p) => <Input {...p} autoComplete="off" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.admins.password")} hint={adminT("ops.account.hint")} error={fields.password} required>
          {(p) => <Input {...p} type="password" required autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <OpsError error={add.error} />
        <Button type="submit" pending={add.pending}>
          {adminT("ops.admins.create")}
        </Button>
      </form>
    </Dialog>
  );
}

export default function CustomersPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.customers.title")} actions={<Button onClick={() => setAdding(true)}>{adminT("ops.admins.new")}</Button>} />
      <NewAdminDialog open={adding} onClose={() => setAdding(false)} />
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
    </div>
  );
}
