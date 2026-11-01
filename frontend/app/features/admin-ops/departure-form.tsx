import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import { Button, ButtonPair, Checkbox, Dialog, Field, Input, Select, SkeletonList, useFieldErrors, useToast } from "~/components/ui";
import { api } from "~/lib/api";
import { zoneLabel } from "~/lib/format";
import { adminT, type AdminKey } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

import { areaName, nameOf, routeZone, type BoatOption } from "./catalog";
import { useAction, useApiQuery } from "./hooks";
import { emptySlot, slotIssues, toSlotPayload, toggleArea, type SlotDraft, type SlotType } from "./slots";
import type { AdminBoat, AdminPort, AdminRoute } from "./types";
import { OpsError, digitsOnly, idr, opsCode } from "./ui";

export function CreateDepartureDialog({ open, onClose, boats, routes, ports }: { open: boolean; onClose: () => void; boats: BoatOption[]; routes: AdminRoute[]; ports: AdminPort[] }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [boatId, setBoatId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [form, setForm] = useState({ departs_date: "", departs_time: "", returns_date: "", returns_time: "", close_hours_before: "2" });
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [touched, setTouched] = useState(false);
  const seq = useRef(0);
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const boat = useApiQuery<AdminBoat>(open && boatId ? `/admin/boats/${boatId}` : null);
  const nextKey = () => `slot-${++seq.current}`;

  useEffect(() => {
    setRouteId("");
    setSlots([]);
  }, [boatId]);
  useEffect(() => {
    if (open) action.reset();
  }, [open]);

  const tz = routeZone(routes, ports, routeId);
  const areas = (boat.data?.areas ?? []).filter((a) => a.status !== "ARCHIVED");
  const issues = slotIssues(slots);
  const valid = !!boatId && !!routeId && !!form.departs_date && !!form.departs_time && !!form.returns_date && !!form.returns_time && slots.length > 0 && Object.keys(issues).length === 0;
  const setSlot = (key: string, fn: (s: SlotDraft) => SlotDraft) => setSlots((all) => all.map((s) => (s.key === key ? fn(s) : s)));

  const submit = async () => {
    setTouched(true);
    if (!valid) return;
    const body = { boat_id: boatId, route_id: routeId, ...form, close_hours_before: Number(form.close_hours_before) || 0, slots: slots.map(toSlotPayload) };
    const r = await action.run(() => api<Departure>("/admin/departures", { method: "POST", body }));
    if (r.ok) {
      toast(adminT("ops.departures.created"));
      onClose();
      navigate(`/admin/departures/${r.value.data.id}`);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={adminT("ops.departures.new")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            {adminT("ops.common.cancel")}
          </Button>
          <Button type="submit" form="create-departure" pending={action.pending}>
            {adminT("ops.departures.create")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="create-departure"
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={adminT("ops.bookings.boat")} required error={fields.boat_id}>
            {(p) => (
              <Select {...p} value={boatId} onChange={(e) => setBoatId(e.target.value)}>
                <option value="">{adminT("ops.common.choose")}</option>
                {boats.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={adminT("ops.booking.route")} required error={fields.route_id} hint={tz ? adminT("ops.common.port_time", { zone: zoneLabel(tz) }) : undefined}>
            {(p) => (
              <Select {...p} value={routeId} onChange={(e) => setRouteId(e.target.value)} disabled={!boat.data}>
                <option value="">{adminT("ops.common.choose")}</option>
                {(boat.data?.routes ?? []).map((r) => (
                  <option key={r.route_id} value={r.route_id}>
                    {nameOf(routes.find((x) => x.id === r.route_id)?.translations)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={adminT("ops.departures.departs_date")} required error={fields.departs_date}>
            {(p) => <Input {...p} type="date" value={form.departs_date} onChange={(e) => setForm({ ...form, departs_date: e.target.value, returns_date: form.returns_date || e.target.value })} />}
          </Field>
          <Field label={adminT("ops.departures.departs_time")} required error={fields.departs_time}>
            {(p) => <Input {...p} type="time" value={form.departs_time} onChange={(e) => setForm({ ...form, departs_time: e.target.value })} />}
          </Field>
          <Field label={adminT("ops.departures.returns_date")} required error={fields.returns_date}>
            {(p) => <Input {...p} type="date" value={form.returns_date} onChange={(e) => setForm({ ...form, returns_date: e.target.value })} />}
          </Field>
          <Field label={adminT("ops.departures.returns_time")} required error={fields.returns_time}>
            {(p) => <Input {...p} type="time" value={form.returns_time} onChange={(e) => setForm({ ...form, returns_time: e.target.value })} />}
          </Field>
          <Field label={adminT("ops.departures.close_hours")} error={fields.close_hours_before} hint={adminT("ops.departures.close_hours_hint")}>
            {(p) => <Input {...p} inputMode="numeric" value={form.close_hours_before} onChange={(e) => setForm({ ...form, close_hours_before: digitsOnly(e.target.value) })} />}
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-semibold">{adminT("ops.departures.slots")}</legend>
          {boatId && boat.loading && <SkeletonList rows={2} />}
          <OpsError error={boat.error} />
          {boat.data && <p className="text-xs text-muted">{adminT("ops.departures.boat_capacity", { n: boat.data.max_passengers })}</p>}
          {fields.slots && <p className="text-sm text-danger">{fields.slots}</p>}
          {slots.map((s, i) => (
            <div key={s.key} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-medium">{adminT("ops.departures.slot_n", { n: i + 1 })}</span>
                <Button size="sm" variant="ghost" onClick={() => setSlots(slots.filter((x) => x.key !== s.key))}>
                  {adminT("ops.common.remove")}
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={adminT("ops.departures.slot_type")} error={fields[`slots.${i}.slot_type`]}>
                  {(p) => (
                    <Select {...p} value={s.slot_type} onChange={(e) => setSlot(s.key, (x) => ({ ...x, slot_type: e.target.value as SlotType, area_ids: e.target.value === "PRIVATE_AREA" ? x.area_ids.slice(0, 1) : x.area_ids }))}>
                      <option value="SEAT_POOL">{opsCode("slot_type", "SEAT_POOL")}</option>
                      <option value="PRIVATE_AREA">{opsCode("slot_type", "PRIVATE_AREA")}</option>
                    </Select>
                  )}
                </Field>
                <Field label={adminT("ops.departures.price")} required error={fields[`slots.${i}.price`]} hint={s.price ? idr(Number(s.price)) : adminT(s.slot_type === "SEAT_POOL" ? "ops.departures.price_seat" : "ops.departures.price_area")}>
                  {(p) => <Input {...p} inputMode="numeric" value={s.price} onChange={(e) => setSlot(s.key, (x) => ({ ...x, price: digitsOnly(e.target.value) }))} />}
                </Field>
                {s.slot_type === "SEAT_POOL" && (
                  <Field label={adminT("ops.departures.seat_capacity")} required error={fields[`slots.${i}.seat_capacity`]}>
                    {(p) => <Input {...p} inputMode="numeric" value={s.seat_capacity} onChange={(e) => setSlot(s.key, (x) => ({ ...x, seat_capacity: digitsOnly(e.target.value) }))} />}
                  </Field>
                )}
                <Field label={adminT("ops.departures.min_pax")} required>
                  {(p) => <Input {...p} inputMode="numeric" value={s.min_pax} onChange={(e) => setSlot(s.key, (x) => ({ ...x, min_pax: digitsOnly(e.target.value) }))} />}
                </Field>
                <Field label={adminT("ops.departures.max_pax")} required error={fields[`slots.${i}.max_pax`]}>
                  {(p) => <Input {...p} inputMode="numeric" value={s.max_pax} onChange={(e) => setSlot(s.key, (x) => ({ ...x, max_pax: digitsOnly(e.target.value) }))} />}
                </Field>
              </div>
              <fieldset>
                <legend className="text-sm font-medium">{adminT(s.slot_type === "PRIVATE_AREA" ? "ops.departures.area_one" : "ops.departures.areas")}</legend>
                <div className="mt-1 grid gap-1 sm:grid-cols-2">
                  {areas.map((a) => (
                    <Checkbox key={a.id} label={`${areaName(a)} (${adminT("ops.departures.area_max", { n: a.max_pax })})`} checked={s.area_ids.includes(a.id)} onChange={() => setSlot(s.key, (x) => toggleArea(x, a.id))} />
                  ))}
                </div>
                {fields[`slots.${i}.area_ids`] && <p className="text-xs text-danger">{fields[`slots.${i}.area_ids`]}</p>}
              </fieldset>
              {touched && issues[s.key] && (
                <ul className="list-disc pl-5 text-xs text-danger">
                  {issues[s.key].map((code) => (
                    <li key={code}>{adminT(`ops.departures.issue.${code}` as AdminKey)}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          {boat.data && (
            <ButtonPair>
              <Button size="sm" variant="secondary" onClick={() => setSlots([...slots, emptySlot(nextKey(), "SEAT_POOL")])}>
                {adminT("ops.departures.add_seat_pool")}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setSlots([...slots, emptySlot(nextKey(), "PRIVATE_AREA")])}>
                {adminT("ops.departures.add_private")}
              </Button>
            </ButtonPair>
          )}
          {touched && slots.length === 0 && <p className="text-sm text-danger">{adminT("ops.departures.slots_required")}</p>}
        </fieldset>
        <OpsError error={action.error} />
      </form>
    </Dialog>
  );
}
