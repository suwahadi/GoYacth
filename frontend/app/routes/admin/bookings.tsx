import type { Route } from "./+types/bookings";
import { Badge, ButtonLink, Checkbox, DataTable, EmptyState, Field, FilterBar, Input, Pagination, Select, StatusBadge, Tabs } from "~/components/ui";
import { loadBoatOptions } from "~/features/admin-ops/catalog";
import { load, loadList, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ, dayRangeUtc } from "~/features/admin-ops/time";
import type { AdminBookingRow } from "~/features/admin-ops/types";
import { LoadFailure, PageHeader, Pending, TextFilter, idr, opsCode, when } from "~/features/admin-ops/ui";
import { RequestsList, loadRequests } from "~/features/admin-ops/requests";
import { zoneLabel } from "~/lib/format";
import { adminT, useTCode } from "~/lib/i18n";

const BOOKING_STATUSES = ["PENDING_PAYMENT", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "EXPIRED"];
const PAYMENT_STATUSES = ["UNPAID", "DEPOSIT_PAID", "PAID", "PARTIALLY_REFUNDED", "REFUNDED"];
const FILTERS = ["status", "payment_status", "boat_id", "search", "from", "to", "exceptions"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  const boats = await load(loadBoatOptions(request));
  if (q("tab") === "requests") {
    return { tab: "requests" as const, boats, requests: await loadRequests(request), list: null };
  }
  const range = dayRangeUtc(q("from") ?? null, q("to") ?? null, ADMIN_TZ);
  const list = await loadList<AdminBookingRow>("/admin/bookings", {
    request,
    query: {
      page: q("page"),
      status: q("status"),
      payment_status: q("payment_status"),
      boat_id: q("boat_id"),
      search: q("search"),
      exceptions: q("exceptions") === "true" ? "true" : undefined,
      from: range.from,
      to: range.to,
    },
  });
  return { tab: "bookings" as const, boats, list, requests: null };
}

export function meta() {
  return [{ title: `${adminT("ops.bookings.title")} | GoYacht Admin` }];
}

export default function BookingsPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const tc = useTCode();
  const boats = loaderData.boats.data ?? [];
  return (
    <div className="space-y-4">
      <PageHeader
        title={adminT("ops.bookings.title")}
        actions={
          <ButtonLink to="/admin/bookings/new" size="sm">
            {adminT("ops.bookings.new")}
          </ButtonLink>
        }
      />
      <Tabs
        tabs={[
          { id: "bookings", label: adminT("ops.bookings.tab_all") },
          { id: "requests", label: adminT("ops.bookings.tab_requests") },
        ]}
        active={loaderData.tab}
        onChange={(id) => f.set({ tab: id === "bookings" ? null : id })}
      />
      {loaderData.tab === "requests" ? (
        loaderData.requests?.error ? (
          <LoadFailure error={loaderData.requests.error} />
        ) : (
          <Pending>
            <RequestsList rows={loaderData.requests?.data ?? []} />
          </Pending>
        )
      ) : (
        <>
          <FilterBar activeCount={f.activeCount(FILTERS)} onClear={() => f.clear(FILTERS)}>
            <TextFilter label={adminT("ops.bookings.search")} placeholder={adminT("ops.bookings.search_hint")} value={f.get("search")} onCommit={(v) => f.set({ search: v })} />
            <Field label={adminT("ops.bookings.status")}>
              {(p) => (
                <Select {...p} value={f.get("status")} onChange={(e) => f.set({ status: e.target.value })}>
                  <option value="">{adminT("ops.common.any")}</option>
                  {BOOKING_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tc("common.status", s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={adminT("ops.bookings.payment_status")}>
              {(p) => (
                <Select {...p} value={f.get("payment_status")} onChange={(e) => f.set({ payment_status: e.target.value })}>
                  <option value="">{adminT("ops.common.any")}</option>
                  {PAYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {tc("common.status", s)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={adminT("ops.bookings.boat")}>
              {(p) => (
                <Select {...p} value={f.get("boat_id")} onChange={(e) => f.set({ boat_id: e.target.value })}>
                  <option value="">{adminT("ops.common.any")}</option>
                  {boats.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={adminT("ops.bookings.from")} hint={adminT("ops.common.zone_hint", { zone: zoneLabel(ADMIN_TZ) })}>
              {(p) => <Input {...p} type="date" value={f.get("from")} onChange={(e) => f.set({ from: e.target.value })} />}
            </Field>
            <Field label={adminT("ops.bookings.to")}>{(p) => <Input {...p} type="date" value={f.get("to")} onChange={(e) => f.set({ to: e.target.value })} />}</Field>
            <Checkbox label={adminT("ops.bookings.exceptions_only")} checked={f.get("exceptions") === "true"} onChange={(e) => f.set({ exceptions: e.target.checked ? "true" : null })} />
          </FilterBar>
          {loaderData.list?.error ? (
            <LoadFailure error={loaderData.list.error} />
          ) : (
            <Pending>
              {(loaderData.list?.data?.rows.length ?? 0) === 0 ? (
                <EmptyState title={adminT("ops.bookings.empty")} />
              ) : (
                <>
                  <DataTable
                    rows={loaderData.list!.data!.rows}
                    rowKey={(r) => r.id}
                    onRowHref={(r) => `/admin/bookings/${r.id}`}
                    columns={[
                      { key: "number", header: adminT("ops.bookings.number"), cell: (r) => r.booking_number, primary: true },
                      { key: "lead", header: adminT("ops.bookings.lead"), cell: (r) => <span className="block">{r.lead_name}<span className="block text-xs text-muted">{r.lead_email}</span></span> },
                      { key: "starts", header: adminT("ops.bookings.starts"), cell: (r) => when(r.starts_at, r.timezone) },
                      { key: "boat", header: adminT("ops.bookings.boat"), cell: (r) => `${r.boat_name} · ${opsCode("mode", r.mode)}` },
                      { key: "status", header: adminT("ops.bookings.status"), cell: (r) => <StatusBadge status={r.status} /> },
                      {
                        key: "payment",
                        header: adminT("ops.bookings.payment_status"),
                        cell: (r) => (
                          <span className="flex flex-wrap gap-1">
                            <StatusBadge status={r.payment_status} />
                            {r.exception_reason && <Badge tone="danger">{adminT("ops.bookings.exception")}</Badge>}
                          </span>
                        ),
                      },
                      { key: "total", header: adminT("ops.bookings.total"), cell: (r) => idr(r.grand_total), className: "text-right" },
                    ]}
                  />
                  {loaderData.list?.data?.page && <Pagination page={loaderData.list.data.page} />}
                </>
              )}
            </Pending>
          )}
        </>
      )}
    </div>
  );
}
