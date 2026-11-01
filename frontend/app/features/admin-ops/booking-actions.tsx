import { useEffect, useState } from "react";
import { useRevalidator } from "react-router";

import { Alert, Button, ButtonPair, ConfirmDialog, Dialog, EmptyState, Field, Input, PhoneInput, Select, SkeletonList, Textarea, useFieldErrors, useToast } from "~/components/ui";
import { api, newIdempotencyKey } from "~/lib/api";
import { formatDateTime, zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

import { useAction, useApiQuery } from "./hooks";
import { ProofUpload } from "./proof-upload";
import { todayIn, utcToZoned } from "./time";
import type { AdminBookingDetail } from "./types";
import { OpsError, digitsOnly, idr, opsCode, useOpsErrorText } from "./ui";

function DialogFooter({ onCancel, submitLabel, pending, disabled, form, tone = "primary" }: { onCancel: () => void; submitLabel: string; pending: boolean; disabled?: boolean; form: string; tone?: "primary" | "danger" }) {
  return (
    <ButtonPair>
      <Button variant="secondary" onClick={onCancel} disabled={pending}>
        {adminT("ops.common.cancel")}
      </Button>
      <Button type="submit" form={form} variant={tone} pending={pending} disabled={disabled}>
        {submitLabel}
      </Button>
    </ButtonPair>
  );
}

function useDone(onClose: () => void) {
  const revalidator = useRevalidator();
  const toast = useToast();
  return (message: string) => {
    toast(message);
    onClose();
    revalidator.revalidate();
  };
}

export function ManualPaymentDialog({ booking, open, onClose }: { booking: AdminBookingDetail; open: boolean; onClose: () => void }) {
  const [key, setKey] = useState("");
  const [method, setMethod] = useState("BANK_TRANSFER");
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState("");
  const [proof, setProof] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const done = useDone(onClose);
  useEffect(() => {
    if (!open) return;
    // One key per opened dialog: a retried submit replays the same payment instead of adding one.
    setKey(newIdempotencyKey());
    setAmount(String(booking.balance_due));
    setPaidOn(todayIn(booking.timezone));
    setProof(null);
    setNotes("");
    action.reset();
  }, [open]);
  const value = Number(amount || 0);
  const tooMuch = value > booking.balance_due;
  const submit = async () => {
    const r = await action.run(() =>
      api(`/admin/bookings/${booking.id}/payments`, { method: "POST", idempotencyKey: key, body: { method, amount: value, paid_on: paidOn, proof_media_id: proof, notes } }),
    );
    if (r.ok) done(adminT("ops.payment_dialog.done"));
  };
  return (
    <Dialog open={open} onClose={onClose} title={adminT("ops.payment_dialog.title")} footer={<DialogFooter form="manual-payment" onCancel={onClose} submitLabel={adminT("ops.payment_dialog.submit")} pending={action.pending} disabled={!value || tooMuch || !paidOn} />}>
      <form
        id="manual-payment"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm">{adminT("ops.payment_dialog.balance", { amount: idr(booking.balance_due) })}</p>
        <Field label={adminT("ops.payment_dialog.method")} error={fields.method}>
          {(p) => (
            <Select {...p} value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="BANK_TRANSFER">{opsCode("method", "BANK_TRANSFER")}</option>
              <option value="CASH">{opsCode("method", "CASH")}</option>
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.payment_dialog.amount")} required error={fields.amount ?? (tooMuch ? adminT("ops.payment_dialog.too_much") : undefined)} hint={value ? idr(value) : undefined}>
          {(p) => <Input {...p} inputMode="numeric" value={amount} onChange={(e) => setAmount(digitsOnly(e.target.value))} />}
        </Field>
        <Field label={adminT("ops.payment_dialog.paid_on")} required error={fields.paid_on}>
          {(p) => <Input {...p} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
        </Field>
        <ProofUpload slug={`payment-${booking.booking_number}`} onChange={setProof} />
        <Field label={adminT("ops.common.notes")} error={fields.notes}>
          {(p) => <Textarea {...p} maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <OpsError error={action.error} />
      </form>
    </Dialog>
  );
}

export function GuestsDialog({ booking, open, onClose }: { booking: AdminBookingDetail; open: boolean; onClose: () => void }) {
  const [lead, setLead] = useState({ full_name: "", phone: "" });
  const [guests, setGuests] = useState<{ full_name: string; phone: string }[]>([]);
  const [version, setVersion] = useState(0);
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const done = useDone(onClose);
  useEffect(() => {
    if (!open) return;
    setLead({ full_name: booking.lead?.full_name ?? "", phone: booking.lead?.phone ?? "" });
    const existing = booking.guests ?? [];
    setGuests(Array.from({ length: Math.max(booking.pax - 1, 0) }, (_, i) => existing[i] ?? { full_name: "", phone: "" }));
    // PhoneInput reads its calling code once on mount, so remount the fields with the loaded numbers.
    setVersion((v) => v + 1);
    action.reset();
  }, [open]);
  const submit = async () => {
    const r = await action.run(() => api(`/admin/bookings/${booking.id}/guests`, { method: "PUT", body: { lead_full_name: lead.full_name, lead_phone: lead.phone, guests } }));
    if (r.ok) done(adminT("ops.guests_dialog.done"));
  };
  return (
    <Dialog open={open} onClose={onClose} size="lg" title={adminT("ops.guests_dialog.title")} footer={<DialogFooter form="guests" onCancel={onClose} submitLabel={adminT("ops.common.save")} pending={action.pending} />}>
      <form
        id="guests"
        key={version}
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted">{adminT("ops.guests_dialog.fixed_pax", { pax: booking.pax })}</p>
        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-2 text-sm font-semibold">{adminT("ops.booking.lead")}</legend>
          <Field label={adminT("ops.people.full_name")} required error={fields.lead_full_name}>
            {(p) => <Input {...p} value={lead.full_name} maxLength={120} onChange={(e) => setLead({ ...lead, full_name: e.target.value })} />}
          </Field>
          <Field label={adminT("ops.people.phone")} required error={fields.lead_phone}>
            {(p) => <PhoneInput id={p.id} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} value={lead.phone} onChange={(v) => setLead({ ...lead, phone: v })} />}
          </Field>
        </fieldset>
        {guests.map((g, i) => (
          <fieldset key={i} className="grid gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold">{adminT("ops.people.guest_n", { n: i + 1 })}</legend>
            <Field label={adminT("ops.people.full_name")} required error={fields[`guests.${i}.full_name`]}>
              {(p) => <Input {...p} value={g.full_name} maxLength={120} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, full_name: e.target.value } : x)))} />}
            </Field>
            <Field label={adminT("ops.people.phone_optional")} error={fields[`guests.${i}.phone`]}>
              {(p) => <PhoneInput id={p.id} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} value={g.phone} onChange={(v) => setGuests(guests.map((x, j) => (j === i ? { ...x, phone: v } : x)))} />}
            </Field>
          </fieldset>
        ))}
        {fields.guests && <p className="text-sm text-danger">{fields.guests}</p>}
        <OpsError error={action.error} />
      </form>
    </Dialog>
  );
}

export function RevealIdentity({ booking }: { booking: AdminBookingDetail }) {
  const [confirm, setConfirm] = useState(false);
  const [revealed, setRevealed] = useState<{ id_type: string; id_number: string } | null>(null);
  const action = useAction();
  const errorText = useOpsErrorText();
  if (!booking.lead?.id_type) return <span>—</span>;
  const reveal = async () => {
    const r = await action.run(() => api<{ id_type: string; id_number: string }>(`/admin/bookings/${booking.id}/identity/reveal`, { method: "POST" }));
    setConfirm(false);
    if (r.ok) setRevealed(r.value.data);
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <span>
        {opsCode("id_type", booking.lead.id_type)} {revealed ? <code>{revealed.id_number}</code> : `•••• ${booking.lead.id_last4}`}
      </span>
      {revealed ? (
        <Button size="sm" variant="ghost" onClick={() => setRevealed(null)}>
          {adminT("ops.identity.hide")}
        </Button>
      ) : (
        <Button size="sm" variant="secondary" onClick={() => setConfirm(true)}>
          {adminT("ops.identity.reveal")}
        </Button>
      )}
      {!!action.error && <span className="text-xs text-danger">{errorText(action.error)}</span>}
      <ConfirmDialog
        open={confirm}
        title={adminT("ops.identity.confirm_title")}
        body={adminT("ops.identity.confirm_body")}
        confirmLabel={adminT("ops.identity.reveal")}
        pending={action.pending}
        onConfirm={reveal}
        onClose={() => setConfirm(false)}
      />
    </span>
  );
}

export function CancelBookingDialog({ booking, open, onClose }: { booking: AdminBookingDetail; open: boolean; onClose: () => void }) {
  const [type, setType] = useState<"OPERATOR" | "CUSTOMER">("OPERATOR");
  const [reason, setReason] = useState("");
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const done = useDone(onClose);
  useEffect(() => {
    if (open) {
      setReason("");
      action.reset();
    }
  }, [open]);
  const submit = async () => {
    const r = await action.run(() => api(`/admin/bookings/${booking.id}/cancel`, { method: "POST", body: { cancel_type: type, reason } }));
    if (r.ok) done(adminT("ops.cancel_dialog.done"));
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={adminT("ops.cancel_dialog.title", { number: booking.booking_number })}
      footer={<DialogFooter form="cancel-booking" tone="danger" onCancel={onClose} submitLabel={adminT("ops.cancel_dialog.submit")} pending={action.pending} disabled={reason.trim().length < 3} />}
    >
      <form
        id="cancel-booking"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={adminT("ops.cancel_dialog.type")} error={fields.cancel_type}>
          {(p) => (
            <Select {...p} value={type} onChange={(e) => setType(e.target.value as "OPERATOR" | "CUSTOMER")}>
              <option value="OPERATOR">{opsCode("cancel_type", "OPERATOR")}</option>
              <option value="CUSTOMER">{opsCode("cancel_type", "CUSTOMER")}</option>
            </Select>
          )}
        </Field>
        <Alert tone="warning">{adminT(type === "OPERATOR" ? "ops.cancel_dialog.operator_effect" : "ops.cancel_dialog.customer_effect")}</Alert>
        <Field label={adminT("ops.common.reason")} required error={fields.reason} hint={adminT("ops.common.reason_hint")}>
          {(p) => <Textarea {...p} minLength={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <OpsError error={action.error} />
      </form>
    </Dialog>
  );
}

export function RescheduleDialog({ booking, open, onClose }: { booking: AdminBookingDetail; open: boolean; onClose: () => void }) {
  const isDeparture = booking.mode === "DEPARTURE";
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slotId, setSlotId] = useState("");
  const [note, setNote] = useState("");
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const done = useDone(onClose);
  const nowIso = useState(() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))[0];
  const departures = useApiQuery<Departure[]>(open && isDeparture ? "/admin/departures" : null, { boat_id: booking.boat_id, from: nowIso, per_page: 200 });
  useEffect(() => {
    if (!open) return;
    const local = utcToZoned(booking.starts_at, booking.timezone);
    setDate(local.date);
    setTime(local.time);
    setSlotId("");
    setNote("");
    action.reset();
  }, [open]);
  const options = (departures.data ?? [])
    .filter((d) => d.status === "SCHEDULED")
    .flatMap((d) => d.slots.filter((s) => !booking.slot_type || s.slot_type === booking.slot_type).map((s) => ({ d, s })));
  const submit = async () => {
    const body = isDeparture ? { departure_slot_id: slotId, note } : { date, start_time: time, note };
    const r = await action.run(() => api(`/admin/bookings/${booking.id}/reschedule`, { method: "POST", body }));
    if (r.ok) done(adminT("ops.reschedule_dialog.done"));
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={adminT("ops.reschedule_dialog.title")}
      footer={<DialogFooter form="reschedule" onCancel={onClose} submitLabel={adminT("ops.reschedule_dialog.submit")} pending={action.pending} disabled={isDeparture ? !slotId : !date || !time} />}
    >
      <form
        id="reschedule"
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-muted">{adminT("ops.reschedule_dialog.note_price")}</p>
        {isDeparture ? (
          departures.loading ? (
            <SkeletonList rows={3} />
          ) : departures.error ? (
            <OpsError error={departures.error} />
          ) : options.length === 0 ? (
            <EmptyState title={adminT("ops.reschedule_dialog.no_slots")} />
          ) : (
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-medium">{adminT("ops.reschedule_dialog.slot")}</legend>
              {options.map(({ d, s }) => (
                <label key={s.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                  <input type="radio" name="slot" value={s.id} checked={slotId === s.id} onChange={() => setSlotId(s.id)} className="mt-1" />
                  <span>
                    <span className="block font-medium">{formatDateTime(d.departs_at, d.timezone, "en")}</span>
                    <span className="block text-muted">
                      {d.route_name} · {opsCode("slot_type", s.slot_type)} · {s.area_names.join(", ")} · {adminT("ops.departures.remaining", { n: s.remaining })}
                    </span>
                  </span>
                </label>
              ))}
              {fields.departure_slot_id && <p className="text-sm text-danger">{fields.departure_slot_id}</p>}
            </fieldset>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={adminT("ops.reschedule_dialog.date")} required error={fields.date} hint={adminT("ops.common.port_time", { zone: zoneLabel(booking.timezone) })}>
              {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
            </Field>
            <Field label={adminT("ops.reschedule_dialog.time")} required error={fields.start_time}>
              {(p) => <Input {...p} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />}
            </Field>
          </div>
        )}
        <Field label={adminT("ops.common.notes")}>{(p) => <Textarea {...p} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
        <OpsError error={action.error} />
      </form>
    </Dialog>
  );
}
