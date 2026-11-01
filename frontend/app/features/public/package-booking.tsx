import { useId, useMemo, useState } from "react";

import { Alert, Button, ButtonLink, Card, Field, Input, Money, Select } from "~/components/ui";
import { formatDateTime, zoneLabel } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { BoatDetail, Departure, PackageDetail } from "~/lib/types";

import { checkoutUrl, range, startTimeOptions, todayInZone } from "./booking-options";
import { BookSlotForm, slotPaxLimit } from "./departures";
import { QuoteView, useQuote, type QuoteRequest } from "./quote";

export function CharterPackageBooking({ pkg, boats }: { pkg: PackageDetail; boats: Record<string, BoatDetail> }) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  const offerings = pkg.offerings.filter((o) => o.boat_slug && boats[o.boat_slug]);
  const [offeringId, setOfferingId] = useState(offerings[0]?.id ?? "");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const offering = offerings.find((o) => o.id === offeringId);
  const boat = offering?.boat_slug ? boats[offering.boat_slug] : undefined;
  const tz = boat?.home_port.timezone || "Asia/Makassar";
  const maxPax = Math.min(pkg.max_pax, boat?.max_passengers ?? pkg.max_pax);
  const [pax, setPax] = useState(pkg.min_pax);
  const effectivePax = Math.min(Math.max(pax, pkg.min_pax), maxPax);
  const times = useMemo(
    () =>
      boat
        ? startTimeOptions({
            operatingStartMinute: boat.operating_start_minute,
            operatingEndMinute: boat.operating_end_minute,
            durationMinutes: pkg.duration_minutes ?? 0,
            overnightAllowed: boat.overnight_allowed,
          })
        : [],
    [boat, pkg.duration_minutes],
  );
  const effectiveStart = times.includes(startTime) ? startTime : "";
  const today = todayInZone(tz);
  const minDate = pkg.valid_from > today ? pkg.valid_from : today;
  const ready = offering && boat && pkg.route_id && date && effectiveStart;
  const request: QuoteRequest | null = ready
    ? {
        product: { mode: "PRIVATE_CHARTER", package_id: pkg.id, package_offering_id: offering.id, boat_id: offering.boat_id, route_id: pkg.route_id ?? undefined, date, start_time: effectiveStart },
        pax: effectivePax,
        locale,
      }
    : null;
  const quote = useQuote(request);

  if (offerings.length === 0 || !pkg.route_id) {
    return <p className="text-sm text-muted">{t("public.packages.offerings_empty")}</p>;
  }
  return (
    <Card>
      <section aria-labelledby={headingId} className="space-y-4">
        <h2 id={headingId} className="text-lg font-semibold">
          {t("public.packages.book_title")}
        </h2>
        <fieldset>
          <legend className="text-sm font-medium">{t("public.packages.offerings")}</legend>
          <ul className="mt-1 space-y-2">
            {offerings.map((o) => (
              <li key={o.id}>
                <label className="flex items-start gap-2 text-sm">
                  <input type="radio" name="offering" value={o.id} checked={o.id === offeringId} onChange={() => setOfferingId(o.id)} className="mt-1" />
                  <span>
                    <span className="font-medium">{o.boat_name}</span>
                    <span className="block">
                      <Money amount={o.price} withUsd /> <span className="text-muted">{t("public.packages.per_trip")}</span>
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
        <Field label={t("public.widget.date")} hint={t("public.widget.date_hint", { zone: zoneLabel(tz) })}>
          {(p) => <Input {...p} type="date" min={minDate} max={pkg.valid_until} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label={t("public.widget.start_time")} error={times.length === 0 ? t("public.widget.no_times") : undefined}>
          {(p) => (
            <Select {...p} value={effectiveStart} onChange={(e) => setStartTime(e.target.value)} disabled={times.length === 0}>
              <option value="">{t("public.widget.choose_time")}</option>
              {times.map((tm) => (
                <option key={tm} value={tm}>
                  {tm} {zoneLabel(tz)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t("public.widget.pax")} hint={t("public.packages.pax_range", { min: pkg.min_pax, max: maxPax })}>
          {(p) => (
            <Select {...p} value={effectivePax} onChange={(e) => setPax(Number(e.target.value))}>
              {range(pkg.min_pax, maxPax).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <QuoteView state={quote} idleText={t("public.widget.complete_form")} />
        {quote.status === "success" && offering && boat && pkg.route_id ? (
          <ButtonLink
            full
            size="lg"
            to={checkoutUrl(locale, {
              mode: "PRIVATE_CHARTER",
              boatSlug: boat.slug,
              pax: effectivePax,
              boatId: offering.boat_id,
              routeId: pkg.route_id,
              date,
              startTime: effectiveStart,
              packageId: pkg.id,
              packageOfferingId: offering.id,
            })}
          >
            {t("public.widget.continue")}
          </ButtonLink>
        ) : (
          <Button full size="lg" disabled pending={quote.status === "loading"}>
            {t("public.widget.continue")}
          </Button>
        )}
      </section>
    </Card>
  );
}

export function DeparturePackageBooking({ pkg, departure }: { pkg: PackageDetail; departure: Departure | null }) {
  const t = useT();
  const locale = useLocale();
  const headingId = useId();
  if (!departure) return <Alert tone="warning">{t("public.packages.departure_closed")}</Alert>;
  const slots = new Map(departure.slots.map((s) => [s.id, s]));
  const offerings = pkg.offerings.filter((o) => o.departure_slot_id && slots.has(o.departure_slot_id));
  return (
    <Card>
      <section aria-labelledby={headingId} className="space-y-3">
        <h2 id={headingId} className="text-lg font-semibold">
          {t("public.packages.book_title")}
        </h2>
        <p className="text-sm">
          {t("public.packages.departure_when", { time: formatDateTime(departure.departs_at, departure.timezone, locale) })}
          <span className="block text-muted">
            {departure.route_name} · {departure.boat_name}
          </span>
        </p>
        {offerings.length === 0 ? (
          <p className="text-sm text-muted">{t("public.packages.offerings_empty")}</p>
        ) : (
          <ul>
            {offerings.map((o) => {
              const slot = slots.get(o.departure_slot_id as string)!;
              const seat = slot.slot_type === "SEAT_POOL";
              const label = seat ? t("public.departures.slot_SEAT_POOL") : t("public.departures.slot_PRIVATE_AREA");
              const areas = slot.area_names.filter(Boolean).join(", ");
              const maxPax = slotPaxLimit(slot, pkg.max_pax);
              return (
                <li key={o.id} className="space-y-2 border-t border-border py-3">
                  <p className="text-sm font-medium">
                    {label}
                    {areas && <span className="font-normal text-muted"> · {areas}</span>}
                  </p>
                  <p className="text-sm">
                    <Money amount={o.price} withUsd /> <span className="text-muted">{t(seat ? "public.departures.per_person" : "public.departures.per_area")}</span>
                  </p>
                  {slot.available && maxPax >= pkg.min_pax ? (
                    <BookSlotForm
                      target={{ mode: "DEPARTURE", boatSlug: o.boat_slug ?? departure.boat_slug, departureSlotId: slot.id, packageId: pkg.id, packageOfferingId: o.id }}
                      minPax={pkg.min_pax}
                      maxPax={maxPax}
                      label={`${t("public.departures.book")}: ${label} ${areas}`.trim()}
                    />
                  ) : (
                    <p className="text-sm text-danger">{t("public.departures.sold_out")}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Card>
  );
}
