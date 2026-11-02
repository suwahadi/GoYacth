import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

import type { Route } from "./+types/booking-new";
import { Alert, Button, Card, EmptyState, Field, Input, PhoneInput, SearchableSelect, Select, SkeletonList, Textarea, useCountryOptions, useFieldErrors, useToast } from "~/components/ui";
import { loadBoatOptions, loadPorts, loadRoutes, nameOf, portZone } from "~/features/admin-ops/catalog";
import { load, useAction, useApiQuery } from "~/features/admin-ops/hooks";
import type { AdminBoat, AdminUser } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Section, digitsOnly, idr, opsCode } from "~/features/admin-ops/ui";
import { idTypeOptions } from "~/features/booking/identity";
import { api, newIdempotencyKey } from "~/lib/api";
import { COUNTRY_CODES } from "~/lib/countries";
import { formatDateTime, zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  return load(Promise.all([loadBoatOptions(request), loadRoutes({ request }), loadPorts({ request })]).then(([boats, routes, ports]) => ({ boats, routes, ports })));
}

export function meta() {
  return [{ title: `${adminT("ops.new_booking.title")} | GoYacht Admin` }];
}

type Mode = "PRIVATE_CHARTER" | "DEPARTURE";
interface Person {
  full_name: string;
  phone: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setV(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return v;
}

function CustomerPicker({ value, onChange }: { value: AdminUser | null; onChange: (u: AdminUser | null) => void }) {
  const [q, setQ] = useState("");
  const term = useDebounced(q.trim(), 300);
  const results = useApiQuery<AdminUser[]>(term.length >= 2 ? "/admin/users/search" : null, { q: term });
  if (value) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          <strong>{value.full_name || value.email}</strong> · {value.email}
        </span>
        <Button size="sm" variant="secondary" onClick={() => onChange(null)}>
          {adminT("ops.new_booking.change_customer")}
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      <Field label={adminT("ops.new_booking.customer_search")} hint={adminT("ops.new_booking.customer_hint")}>
        {(p) => <Input {...p} type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />}
      </Field>
      {results.loading && <SkeletonList rows={2} />}
      <OpsError error={results.error} />
      {term.length >= 2 && !results.loading && !results.error && (results.data ?? []).length === 0 && <p className="text-sm text-muted">{adminT("ops.new_booking.no_customers")}</p>}
      <ul className="space-y-1">
        {(results.data ?? []).map((u) => (
          <li key={u.id}>
            <button type="button" className="w-full rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => onChange(u)}>
              <span className="block font-medium">{u.full_name || u.email}</span>
              <span className="block text-xs text-muted">{u.email}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function NewBookingPage({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const countryOptions = useCountryOptions(COUNTRY_CODES);
  const [customer, setCustomer] = useState<AdminUser | null>(null);
  const [mode, setMode] = useState<Mode>("PRIVATE_CHARTER");
  const [boatId, setBoatId] = useState("");
  const [routeId, setRouteId] = useState("");
  const [rateUnit, setRateUnit] = useState("");
  const [units, setUnits] = useState("1");
  const [date, setDate] = useState("");
  const [time, setTime] = useState("");
  const [slotId, setSlotId] = useState("");
  const [pax, setPax] = useState("1");
  const [scheme, setScheme] = useState("FULL");
  const [lead, setLead] = useState({ full_name: "", phone: "", nationality: "ID", id_type: "KTP", id_number: "", special_request: "" });
  const [guests, setGuests] = useState<Person[]>([]);
  const action = useAction();
  const fields = useFieldErrors(action.error);
  const keyRef = useRef<{ fingerprint: string; key: string } | null>(null);
  const nowIso = useState(() => new Date().toISOString().replace(/\.\d{3}Z$/, "Z"))[0];

  const boat = useApiQuery<AdminBoat>(boatId ? `/admin/boats/${boatId}` : null);
  const departures = useApiQuery<Departure[]>(boatId && mode === "DEPARTURE" ? "/admin/departures" : null, { boat_id: boatId, from: nowIso, per_page: 200 });

  const paxCount = Math.max(Number(pax) || 1, 1);
  useEffect(() => {
    setGuests((g) => Array.from({ length: paxCount - 1 }, (_, i) => g[i] ?? { full_name: "", phone: "" }));
  }, [paxCount]);
  useEffect(() => {
    setRouteId("");
    setRateUnit("");
    setSlotId("");
  }, [boatId, mode]);
  useEffect(() => {
    // Without a fixed price for this route the boat can only be booked by hour or day.
    const route = boat.data?.routes.find((r) => r.route_id === routeId);
    setRateUnit(route?.fixed_price === null ? (boat.data?.rates[0]?.rate_unit ?? "") : "");
  }, [routeId, boat.data]);

  if (loaderData.error) return <LoadFailure error={loaderData.error} />;
  const { boats, routes, ports } = loaderData.data;
  const boatRoutes = (boat.data?.routes ?? []).map((r) => ({ ...r, name: nameOf(routes.find((x) => x.id === r.route_id)?.translations) }));
  const tz = portZone(ports, boat.data?.home_port_id);
  const idTypes = idTypeOptions(lead.nationality);

  const product =
    mode === "PRIVATE_CHARTER"
      ? { mode, boat_id: boatId, route_id: routeId, date, start_time: time, rate_unit: rateUnit || undefined, units: Number(units) || 1 }
      : { mode, departure_slot_id: slotId };
  const body = { user_id: customer?.id, product, pax: paxCount, payment_scheme: scheme, locale: customer?.locale || "en", lead, guests, consents: {} };

  const submit = async () => {
    const fingerprint = JSON.stringify(body);
    // Retrying identical content reuses the key so a lost response cannot create a second booking.
    if (!keyRef.current || keyRef.current.fingerprint !== fingerprint) keyRef.current = { fingerprint, key: newIdempotencyKey() };
    const key = keyRef.current.key;
    const r = await action.run(() => api<{ id: string; booking_number: string }>("/admin/bookings", { method: "POST", body, idempotencyKey: key }));
    if (r.ok) {
      toast(adminT("ops.new_booking.created", { number: r.value.data.booking_number }));
      navigate(`/admin/bookings/${r.value.data.id}`);
    }
  };
  const ready = !!customer && (mode === "PRIVATE_CHARTER" ? !!boatId && !!routeId && !!date && !!time : !!slotId);

  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.new_booking.title")} back={{ to: "/admin/bookings", label: adminT("ops.bookings.back") }} />
      <Alert tone="info">{adminT("ops.new_booking.intro")}</Alert>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Card>
          <Section title={adminT("ops.new_booking.customer")}>
            <CustomerPicker value={customer} onChange={setCustomer} />
            {fields.user_id && <p className="text-sm text-danger">{fields.user_id}</p>}
          </Section>
        </Card>

        <Card>
          <Section title={adminT("ops.new_booking.product")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={adminT("ops.bookings.mode")}>
                {(p) => (
                  <Select {...p} value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                    <option value="PRIVATE_CHARTER">{opsCode("mode", "PRIVATE_CHARTER")}</option>
                    <option value="DEPARTURE">{opsCode("mode", "DEPARTURE")}</option>
                  </Select>
                )}
              </Field>
              <Field label={adminT("ops.bookings.boat")} required error={fields["product.boat_id"]}>
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
            </div>
            {boatId && boat.loading && <SkeletonList rows={2} />}
            <OpsError error={boat.error} />
            {boat.data && mode === "PRIVATE_CHARTER" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={adminT("ops.booking.route")} required error={fields["product.route_id"]}>
                  {(p) => (
                    <Select {...p} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
                      <option value="">{adminT("ops.common.choose")}</option>
                      {boatRoutes.map((r) => (
                        <option key={r.route_id} value={r.route_id}>
                          {r.name}
                          {r.fixed_price !== null ? ` · ${idr(r.fixed_price)}` : ""}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={adminT("ops.new_booking.rate")} error={fields["product.rate_unit"]} hint={adminT("ops.new_booking.rate_hint")}>
                  {(p) => (
                    <Select {...p} value={rateUnit} onChange={(e) => setRateUnit(e.target.value)}>
                      {(!routeId || boatRoutes.find((r) => r.route_id === routeId)?.fixed_price != null) && <option value="">{adminT("ops.new_booking.rate_route")}</option>}
                      {boat.data!.rates.map((r) => (
                        <option key={r.rate_unit} value={r.rate_unit}>
                          {opsCode("rate_unit", r.rate_unit)} · {idr(r.price)} ({r.min_units}–{r.max_units})
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label={adminT("ops.reschedule_dialog.date")} required error={fields["product.date"]} hint={tz ? adminT("ops.common.port_time", { zone: zoneLabel(tz) }) : undefined}>
                  {(p) => <Input {...p} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
                </Field>
                <Field label={adminT("ops.reschedule_dialog.time")} required error={fields["product.start_time"]}>
                  {(p) => <Input {...p} type="time" step={900} value={time} onChange={(e) => setTime(e.target.value)} />}
                </Field>
                {rateUnit && (
                  <Field label={adminT("ops.new_booking.units")} error={fields["product.units"]}>
                    {(p) => <Input {...p} inputMode="numeric" value={units} onChange={(e) => setUnits(digitsOnly(e.target.value))} />}
                  </Field>
                )}
              </div>
            )}
            {boatId && mode === "DEPARTURE" &&
              (departures.loading ? (
                <SkeletonList rows={2} />
              ) : departures.error ? (
                <OpsError error={departures.error} />
              ) : (departures.data ?? []).filter((d) => d.status === "SCHEDULED").length === 0 ? (
                <EmptyState title={adminT("ops.new_booking.no_departures")} />
              ) : (
                <fieldset className="space-y-2">
                  <legend className="mb-1 text-sm font-medium">{adminT("ops.reschedule_dialog.slot")}</legend>
                  {(departures.data ?? [])
                    .filter((d) => d.status === "SCHEDULED")
                    .flatMap((d) =>
                      d.slots.map((s) => (
                        <label key={s.id} className="flex items-start gap-2 rounded-md border border-border p-2 text-sm">
                          <input type="radio" name="slot" className="mt-1" checked={slotId === s.id} onChange={() => setSlotId(s.id)} disabled={!s.available} />
                          <span>
                            <span className="block font-medium">
                              {formatDateTime(d.departs_at, d.timezone, "en")} · {d.route_name}
                            </span>
                            <span className="block text-muted">
                              {opsCode("slot_type", s.slot_type)} · {s.area_names.join(", ")} · {idr(s.price)} · {adminT("ops.departures.remaining", { n: s.remaining })}
                            </span>
                          </span>
                        </label>
                      )),
                    )}
                  {fields["product.departure_slot_id"] && <p className="text-sm text-danger">{fields["product.departure_slot_id"]}</p>}
                </fieldset>
              ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={adminT("ops.bookings.pax")} required error={fields.pax}>
                {(p) => <Input {...p} type="number" min={1} max={500} value={pax} onChange={(e) => setPax(digitsOnly(e.target.value))} />}
              </Field>
              <Field label={adminT("ops.booking.scheme")} error={fields.payment_scheme} hint={adminT("ops.new_booking.scheme_hint")}>
                {(p) => (
                  <Select {...p} value={scheme} onChange={(e) => setScheme(e.target.value)}>
                    <option value="FULL">{opsCode("scheme", "FULL")}</option>
                    <option value="DEPOSIT">{opsCode("scheme", "DEPOSIT")}</option>
                  </Select>
                )}
              </Field>
            </div>
          </Section>
        </Card>

        <Card>
          <Section title={adminT("ops.booking.lead")}>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={adminT("ops.people.full_name")} required error={fields["lead.full_name"]}>
                {(p) => <Input {...p} maxLength={120} value={lead.full_name} onChange={(e) => setLead({ ...lead, full_name: e.target.value })} />}
              </Field>
              <Field label={adminT("ops.people.phone")} required error={fields["lead.phone"]}>
                {(p) => <PhoneInput id={p.id} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} value={lead.phone} onChange={(v) => setLead({ ...lead, phone: v })} />}
              </Field>
              <Field label={adminT("ops.people.nationality")} required error={fields["lead.nationality"]}>
                {(p) => (
                  <SearchableSelect
                    id={p.id}
                    invalid={p["aria-invalid"]}
                    describedBy={p["aria-describedby"]}
                    value={lead.nationality}
                    options={countryOptions}
                    onChange={(v) => {
                      const types = idTypeOptions(v);
                      setLead({ ...lead, nationality: v, id_type: types.includes(lead.id_type as never) ? lead.id_type : types[0] });
                    }}
                  />
                )}
              </Field>
              <Field label={adminT("ops.people.id_type")} required error={fields["lead.id_type"]}>
                {(p) => (
                  <Select {...p} value={lead.id_type} onChange={(e) => setLead({ ...lead, id_type: e.target.value })}>
                    {idTypes.map((x) => (
                      <option key={x} value={x}>
                        {opsCode("id_type", x)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label={adminT("ops.people.id_number")} required error={fields["lead.id_number"]} hint={adminT("ops.people.id_number_hint")}>
                {(p) => <Input {...p} autoComplete="off" value={lead.id_number} onChange={(e) => setLead({ ...lead, id_number: e.target.value })} />}
              </Field>
              <Field label={adminT("ops.booking.special_request")} error={fields["lead.special_request"]} className="sm:col-span-2">
                {(p) => <Textarea {...p} maxLength={1000} value={lead.special_request} onChange={(e) => setLead({ ...lead, special_request: e.target.value })} />}
              </Field>
            </div>
          </Section>
        </Card>

        {guests.length > 0 && (
          <Card>
            <Section title={adminT("ops.booking.guests")}>
              {guests.map((g, i) => (
                <fieldset key={i} className="grid gap-3 sm:grid-cols-2">
                  <legend className="mb-1 text-sm font-medium">{adminT("ops.people.guest_n", { n: i + 1 })}</legend>
                  <Field label={adminT("ops.people.full_name")} required error={fields[`guests.${i}.full_name`]}>
                    {(p) => <Input {...p} maxLength={120} value={g.full_name} onChange={(e) => setGuests(guests.map((x, j) => (j === i ? { ...x, full_name: e.target.value } : x)))} />}
                  </Field>
                  <Field label={adminT("ops.people.phone_optional")} error={fields[`guests.${i}.phone`]}>
                    {(p) => <PhoneInput id={p.id} invalid={p["aria-invalid"]} describedBy={p["aria-describedby"]} value={g.phone} onChange={(v) => setGuests(guests.map((x, j) => (j === i ? { ...x, phone: v } : x)))} />}
                  </Field>
                </fieldset>
              ))}
              {fields.guests && <p className="text-sm text-danger">{fields.guests}</p>}
            </Section>
          </Card>
        )}

        <OpsError error={action.error} />
        <Button type="submit" pending={action.pending} disabled={!ready} full>
          {adminT("ops.new_booking.submit")}
        </Button>
      </form>
    </div>
  );
}
