import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/departure";
import { Alert, Button, Card, ConfirmDialog, DataTable, EmptyState, Field, Input, StatusBadge, Textarea, useFieldErrors, useToast } from "~/components/ui";
import { load, loadList, useAction } from "~/features/admin-ops/hooks";
import { hoursBetween } from "~/features/admin-ops/time";
import type { AdminBookingRow } from "~/features/admin-ops/types";
import { Details, DocLink, LoadFailure, OpsError, PageHeader, Section, apiHref, digitsOnly, idr, opsCode, when } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

export async function loader({ request, params }: Route.LoaderArgs) {
  const [departure, bookings] = await Promise.all([
    load(apiData<Departure>(`/admin/departures/${params.id}`, { request })),
    loadList<AdminBookingRow>("/admin/bookings", { request, query: { departure_id: params.id, per_page: 100 } }),
  ]);
  return { departure, bookings };
}

export function meta() {
  return [{ title: `${adminT("ops.departure.title")} | GoYacht Admin` }];
}

function EditForm({ d }: { d: Departure }) {
  const closeHours = String(hoursBetween(d.booking_closes_at, d.departs_at));
  const initial = () => ({ close: closeHours, slots: d.slots.map((s) => ({ id: s.id, price: String(s.price), max_pax: String(s.max_pax) })) });
  const [form, setForm] = useState(initial);
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const revalidator = useRevalidator();
  const toast = useToast();
  useEffect(() => setForm(initial()), [d]);
  const save = async () => {
    const body = { close_hours_before: Number(form.close) || 0, slots: form.slots.map((s) => ({ id: s.id, price: Number(s.price) || 0, max_pax: Number(s.max_pax) || 0 })) };
    const r = await action.run(() => api(`/admin/departures/${d.id}`, { method: "PATCH", body }));
    if (r.ok) {
      toast(adminT("ops.departure.saved"));
      revalidator.revalidate();
    }
  };
  const editable = d.status === "SCHEDULED";
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <p className="text-sm text-muted">{adminT("ops.departure.edit_note")}</p>
      <Field label={adminT("ops.departures.close_hours")} error={fields.close_hours_before} hint={adminT("ops.departures.close_hours_hint")} className="max-w-xs">
        {(p) => <Input {...p} inputMode="numeric" disabled={!editable} value={form.close} onChange={(e) => setForm({ ...form, close: digitsOnly(e.target.value) })} />}
      </Field>
      <ul className="space-y-3">
        {d.slots.map((s, i) => (
          <li key={s.id} className="rounded-md border border-border p-3">
            <p className="text-sm font-medium">
              {opsCode("slot_type", s.slot_type)} · {s.area_names.join(", ")}
            </p>
            <p className="text-xs text-muted">
              {adminT("ops.departure.slot_stats", { booked: s.booked_pax, remaining: s.remaining, seats: s.seat_capacity ?? "—", min: s.min_pax })}
            </p>
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              <Field label={adminT("ops.departures.price")} hint={idr(Number(form.slots[i]?.price || 0))}>
                {(p) => (
                  <Input {...p} inputMode="numeric" disabled={!editable} value={form.slots[i]?.price ?? ""} onChange={(e) => setForm({ ...form, slots: form.slots.map((x, j) => (j === i ? { ...x, price: digitsOnly(e.target.value) } : x)) })} />
                )}
              </Field>
              <Field label={adminT("ops.departures.max_pax")}>
                {(p) => (
                  <Input {...p} inputMode="numeric" disabled={!editable} value={form.slots[i]?.max_pax ?? ""} onChange={(e) => setForm({ ...form, slots: form.slots.map((x, j) => (j === i ? { ...x, max_pax: digitsOnly(e.target.value) } : x)) })} />
                )}
              </Field>
            </div>
          </li>
        ))}
      </ul>
      {fields.slots && <p className="text-sm text-danger">{fields.slots}</p>}
      <OpsError error={action.error} />
      {editable && (
        <Button type="submit" pending={action.pending}>
          {adminT("ops.common.save")}
        </Button>
      )}
    </form>
  );
}

export default function DeparturePage({ loaderData }: Route.ComponentProps) {
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [reasonShort, setReasonShort] = useState(false);
  const cancel = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  const back = { to: "/admin/departures", label: adminT("ops.departures.back") };
  if (loaderData.departure.error) {
    return (
      <div className="space-y-4">
        <PageHeader title={adminT("ops.departure.title")} back={back} />
        <LoadFailure error={loaderData.departure.error} />
      </div>
    );
  }
  const d = loaderData.departure.data;
  const doCancel = async () => {
    const r = await cancel.run(() => api(`/admin/departures/${d.id}/cancel`, { method: "POST", body: { reason } }));
    if (r.ok) {
      setCancelling(false);
      toast(adminT("ops.departure.cancelled"));
      revalidator.revalidate();
    }
  };
  const manifest = (q: Record<string, string>) => apiHref(`/admin/manifests/departure/${d.id}`, q);
  return (
    <div className="space-y-6">
      <PageHeader
        title={`${d.boat_name} · ${when(d.departs_at, d.timezone)}`}
        back={back}
        actions={
          d.status === "SCHEDULED" && (
            <Button size="sm" variant="danger" onClick={() => setCancelling(true)}>
              {adminT("ops.departure.cancel")}
            </Button>
          )
        }
      >
        <StatusBadge status={d.status} />
      </PageHeader>
      {d.status === "CANCELLED" && <Alert tone="danger">{adminT("ops.departure.cancelled_reason", { reason: d.cancel_reason ?? "" })}</Alert>}
      <Card>
        <Details
          items={[
            { label: adminT("ops.booking.route"), value: `${d.route_name} · ${d.port_name}` },
            { label: adminT("ops.departures.departs"), value: when(d.departs_at, d.timezone) },
            { label: adminT("ops.departures.returns"), value: when(d.returns_at, d.timezone) },
            { label: adminT("ops.departures.closes"), value: when(d.booking_closes_at, d.timezone) },
            { label: adminT("ops.departures.booked"), value: adminT("ops.departures.booked_of", { booked: d.booked_pax, capacity: d.capacity }) },
          ]}
        />
      </Card>
      <Card>
        <Section title={adminT("ops.departures.slots")}>
          <EditForm d={d} />
        </Section>
      </Card>
      <Section title={adminT("ops.departure.bookings")}>
        {loaderData.bookings.error ? (
          <LoadFailure error={loaderData.bookings.error} />
        ) : loaderData.bookings.data.rows.length === 0 ? (
          <EmptyState title={adminT("ops.departure.no_bookings")} />
        ) : (
          <DataTable
            rows={loaderData.bookings.data.rows}
            rowKey={(b) => b.id}
            onRowHref={(b) => `/admin/bookings/${b.id}`}
            columns={[
              { key: "number", header: adminT("ops.bookings.number"), cell: (b) => b.booking_number, primary: true },
              { key: "lead", header: adminT("ops.bookings.lead"), cell: (b) => b.lead_name },
              { key: "slot", header: adminT("ops.departures.slot_type"), cell: (b) => opsCode("slot_type", b.slot_type) },
              { key: "pax", header: adminT("ops.bookings.pax"), cell: (b) => b.pax },
              { key: "status", header: adminT("ops.bookings.status"), cell: (b) => <StatusBadge status={b.status} /> },
              { key: "payment", header: adminT("ops.bookings.payment_status"), cell: (b) => <StatusBadge status={b.payment_status} /> },
            ]}
          />
        )}
      </Section>
      <Section title={adminT("ops.manifest.title")}>
        <ul className="flex flex-wrap gap-x-4 gap-y-2">
          <li>
            <DocLink href={manifest({ format: "pdf" })}>{adminT("ops.manifest.pdf")}</DocLink>
          </li>
          <li>
            <DocLink href={manifest({ format: "csv" })}>{adminT("ops.manifest.csv")}</DocLink>
          </li>
          <li>
            <DocLink href={manifest({ format: "pdf", reveal: "true" })}>{adminT("ops.manifest.pdf_reveal")}</DocLink>
          </li>
          <li>
            <DocLink href={manifest({ format: "csv", reveal: "true" })}>{adminT("ops.manifest.csv_reveal")}</DocLink>
          </li>
        </ul>
        <p className="text-xs text-muted">{adminT("ops.manifest.reveal_note")}</p>
      </Section>
      <ConfirmDialog
        open={cancelling}
        tone="danger"
        title={adminT("ops.departure.cancel")}
        confirmLabel={adminT("ops.departure.cancel_confirm")}
        pending={cancel.pending}
        onClose={() => setCancelling(false)}
        onConfirm={() => {
          const short = reason.trim().length < 3;
          setReasonShort(short);
          if (!short) void doCancel();
        }}
        body={
          <div className="space-y-3">
            <Alert tone="warning">{adminT("ops.departure.cancel_warning", { n: loaderData.bookings.data?.rows.length ?? 0 })}</Alert>
            <Field label={adminT("ops.common.reason")} required hint={adminT("ops.common.reason_hint")} error={reasonShort ? adminT("ops.common.reason_hint") : undefined}>
              {(p) => <Textarea {...p} minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
            </Field>
            <OpsError error={cancel.error} />
          </div>
        }
      />
    </div>
  );
}
