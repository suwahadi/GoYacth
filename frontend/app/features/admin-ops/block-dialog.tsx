import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { Button, ButtonPair, Dialog, Field, Input, Select, Textarea, useFieldErrors, useToast } from "~/components/ui";
import { api } from "~/lib/api";
import { zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";

import { areaName, portZone, type BoatOption } from "./catalog";
import { useAction, useApiQuery } from "./hooks";
import { zonedToUtcISO } from "./time";
import type { AdminBoat, AdminPort } from "./types";
import { OpsError, opsCode } from "./ui";

export function BlockDialog({ open, onClose, boats, ports, defaultBoatId, defaultDate }: { open: boolean; onClose: () => void; boats: BoatOption[]; ports: AdminPort[]; defaultBoatId?: string; defaultDate: string }) {
  const [boatId, setBoatId] = useState("");
  const [areaId, setAreaId] = useState("");
  const [kind, setKind] = useState("MAINTENANCE");
  const [range, setRange] = useState({ startDate: "", startTime: "08:00", endDate: "", endTime: "17:00" });
  const [reason, setReason] = useState("");
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const revalidator = useRevalidator();
  const toast = useToast();
  const boat = useApiQuery<AdminBoat>(open && boatId ? `/admin/boats/${boatId}` : null);
  useEffect(() => {
    if (!open) return;
    setBoatId(defaultBoatId ?? "");
    setAreaId("");
    setKind("MAINTENANCE");
    setRange({ startDate: defaultDate, startTime: "08:00", endDate: defaultDate, endTime: "17:00" });
    setReason("");
    action.reset();
  }, [open]);
  useEffect(() => setAreaId(""), [boatId]);
  const tz = portZone(ports, boat.data?.home_port_id);
  const complete = !!boatId && !!tz && !!range.startDate && !!range.startTime && !!range.endDate && !!range.endTime;
  const submit = async () => {
    if (!complete || !tz) return;
    const body = {
      area_id: areaId || null,
      kind,
      starts_at: zonedToUtcISO(range.startDate, range.startTime, tz),
      ends_at: zonedToUtcISO(range.endDate, range.endTime, tz),
      reason,
    };
    const r = await action.run(() => api(`/admin/boats/${boatId}/blocks`, { method: "POST", body }));
    if (r.ok) {
      toast(adminT("ops.calendar.block_created"));
      onClose();
      revalidator.revalidate();
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={adminT("ops.calendar.new_block")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={action.pending}>
            {adminT("ops.common.cancel")}
          </Button>
          <Button type="submit" form="block-form" pending={action.pending} disabled={!complete}>
            {adminT("ops.calendar.create_block")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="block-form"
        className="grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={adminT("ops.bookings.boat")} required className="sm:col-span-2">
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
        <Field label={adminT("ops.calendar.scope")} error={fields.area_id} hint={adminT("ops.calendar.scope_hint")}>
          {(p) => (
            <Select {...p} value={areaId} onChange={(e) => setAreaId(e.target.value)} disabled={!boat.data}>
              <option value="">{adminT("ops.calendar.whole_boat")}</option>
              {(boat.data?.areas ?? []).map((a) => (
                <option key={a.id} value={a.id}>
                  {areaName(a)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.calendar.block_kind")}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="MAINTENANCE">{opsCode("block_kind", "MAINTENANCE")}</option>
              <option value="MANUAL">{opsCode("block_kind", "MANUAL")}</option>
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.calendar.start_date")} required hint={tz ? adminT("ops.common.port_time", { zone: zoneLabel(tz) }) : undefined}>
          {(p) => <Input {...p} type="date" value={range.startDate} onChange={(e) => setRange({ ...range, startDate: e.target.value, endDate: range.endDate < e.target.value ? e.target.value : range.endDate })} />}
        </Field>
        <Field label={adminT("ops.calendar.start_time")} required>
          {(p) => <Input {...p} type="time" value={range.startTime} onChange={(e) => setRange({ ...range, startTime: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.calendar.end_date")} required error={fields.ends_at}>
          {(p) => <Input {...p} type="date" value={range.endDate} onChange={(e) => setRange({ ...range, endDate: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.calendar.end_time")} required>
          {(p) => <Input {...p} type="time" value={range.endTime} onChange={(e) => setRange({ ...range, endTime: e.target.value })} />}
        </Field>
        <Field label={adminT("ops.common.reason")} className="sm:col-span-2">
          {(p) => <Textarea {...p} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <OpsError error={boat.error ?? action.error} className="rounded-md border border-danger/40 bg-danger-bg px-3 py-2 text-sm text-danger sm:col-span-2" />
      </form>
    </Dialog>
  );
}
