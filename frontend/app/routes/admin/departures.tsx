import { useState } from "react";

import type { Route } from "./+types/departures";
import { Button, DataTable, EmptyState, Field, FilterBar, Input, Select, StatusBadge } from "~/components/ui";
import { loadBoatOptions, loadPorts, loadRoutes } from "~/features/admin-ops/catalog";
import { CreateDepartureDialog } from "~/features/admin-ops/departure-form";
import { load, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ, dayRangeUtc, todayIn } from "~/features/admin-ops/time";
import { LoadFailure, PageHeader, Pending, when } from "~/features/admin-ops/ui";
import { apiData } from "~/lib/api";
import { zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

const FILTERS = ["boat_id", "from", "to"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || null;
  const range = dayRangeUtc(q("from") ?? todayIn(ADMIN_TZ), q("to"), ADMIN_TZ);
  const [list, options] = await Promise.all([
    load(apiData<Departure[]>("/admin/departures", { request, query: { boat_id: q("boat_id"), from: range.from, to: range.to, per_page: 200 } })),
    load(Promise.all([loadBoatOptions(request), loadRoutes({ request }), loadPorts({ request })])),
  ]);
  return { list, options };
}

export function meta() {
  return [{ title: `${adminT("ops.departures.title")} | GoYacht Admin` }];
}

export default function DeparturesPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const [creating, setCreating] = useState(false);
  const [boats, routes, ports] = loaderData.options.data ?? [[], [], []];
  return (
    <div className="space-y-4">
      <PageHeader
        title={adminT("ops.departures.title")}
        actions={
          <Button size="sm" onClick={() => setCreating(true)} disabled={!loaderData.options.data}>
            {adminT("ops.departures.new")}
          </Button>
        }
      />
      <FilterBar activeCount={f.activeCount(FILTERS)} onClear={() => f.clear(FILTERS)}>
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
        <Field label={adminT("ops.bookings.from")} hint={adminT("ops.departures.from_default", { zone: zoneLabel(ADMIN_TZ) })}>
          {(p) => <Input {...p} type="date" value={f.get("from")} onChange={(e) => f.set({ from: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.bookings.to")}>{(p) => <Input {...p} type="date" value={f.get("to")} onChange={(e) => f.set({ to: e.target.value })} />}</Field>
      </FilterBar>
      {loaderData.list.error ? (
        <LoadFailure error={loaderData.list.error} />
      ) : (
        <Pending>
          {loaderData.list.data.length === 0 ? (
            <EmptyState title={adminT("ops.departures.empty")} />
          ) : (
            <DataTable
              rows={loaderData.list.data}
              rowKey={(d) => d.id}
              onRowHref={(d) => `/admin/departures/${d.id}`}
              columns={[
                { key: "departs", header: adminT("ops.departures.departs"), cell: (d) => when(d.departs_at, d.timezone), primary: true },
                { key: "boat", header: adminT("ops.bookings.boat"), cell: (d) => d.boat_name },
                { key: "route", header: adminT("ops.booking.route"), cell: (d) => `${d.route_name} · ${d.port_name}` },
                { key: "booked", header: adminT("ops.departures.booked"), cell: (d) => adminT("ops.departures.booked_of", { booked: d.booked_pax, capacity: d.capacity }) },
                { key: "closes", header: adminT("ops.departures.closes"), cell: (d) => when(d.booking_closes_at, d.timezone) },
                { key: "status", header: adminT("ops.bookings.status"), cell: (d) => <StatusBadge status={d.status} /> },
              ]}
            />
          )}
        </Pending>
      )}
      {loaderData.options.error && <LoadFailure error={loaderData.options.error} />}
      <CreateDepartureDialog open={creating} onClose={() => setCreating(false)} boats={boats} routes={routes} ports={ports} />
    </div>
  );
}
