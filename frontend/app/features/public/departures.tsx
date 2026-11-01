import { useId } from "react";
import { Link } from "react-router";

import { Badge, Button, Card, Money, Select } from "~/components/ui";
import { localePath } from "~/lib/config";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { Departure, DepartureSlot } from "~/lib/types";

import { checkoutParams, range, type CheckoutTarget } from "./booking-options";

export function slotPaxLimit(slot: DepartureSlot, extraMax?: number): number {
  return Math.min(slot.max_pax, slot.remaining, extraMax ?? Number.POSITIVE_INFINITY);
}

// BookSlotForm is a plain GET form so booking a slot works before hydration; it submits the
// checkout handoff parameters with the chosen number of guests.
export function BookSlotForm({ target, minPax, maxPax, label }: { target: Omit<Extract<CheckoutTarget, { mode: "DEPARTURE" }>, "pax">; minPax: number; maxPax: number; label?: string }) {
  const t = useT();
  const locale = useLocale();
  const id = useId();
  const hidden = checkoutParams({ ...target, pax: minPax }).filter(([k]) => k !== "pax");
  const options = range(minPax, maxPax);
  if (options.length === 0) return null;
  return (
    <form method="get" action={localePath(locale, "/checkout")} className="flex items-end gap-2">
      {hidden.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="w-24">
        <label htmlFor={id} className="block text-xs font-medium">
          {t("public.departures.pax")}
        </label>
        <Select id={id} name="pax" defaultValue={String(options[0])}>
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>
      <Button type="submit" aria-label={label}>
        {t("public.departures.book")}
      </Button>
    </form>
  );
}

function SlotRow({ departure, slot }: { departure: Departure; slot: DepartureSlot }) {
  const t = useT();
  const seat = slot.slot_type === "SEAT_POOL";
  const name = seat ? t("public.departures.slot_SEAT_POOL") : t("public.departures.slot_PRIVATE_AREA");
  const areas = slot.area_names.filter(Boolean).join(", ");
  return (
    <li className="flex flex-col gap-2 border-t border-border py-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <p className="font-medium">
          {name}
          {areas && <span className="font-normal text-muted"> · {areas}</span>}
        </p>
        <p className="text-sm">
          <Money amount={slot.price} withUsd /> <span className="text-muted">{t(seat ? "public.departures.per_person" : "public.departures.per_area")}</span>
        </p>
        <p className="text-sm">
          {!slot.available ? (
            <Badge tone="danger">{t("public.departures.sold_out")}</Badge>
          ) : seat ? (
            t("public.departures.seats_left", { count: slot.remaining })
          ) : (
            t("public.departures.area_capacity", { count: slotPaxLimit(slot) })
          )}
        </p>
      </div>
      {slot.available && (
        <BookSlotForm
          target={{ mode: "DEPARTURE", boatSlug: departure.boat_slug, departureSlotId: slot.id }}
          minPax={1}
          maxPax={slotPaxLimit(slot)}
          label={`${t("public.departures.book")}: ${name} ${areas}`.trim()}
        />
      )}
    </li>
  );
}

export function DepartureCard({ departure, showBoat = true }: { departure: Departure; showBoat?: boolean }) {
  const t = useT();
  const locale = useLocale();
  const tz = departure.timezone;
  return (
    <Card>
      <article>
        <h3 className="font-semibold">
          <time dateTime={departure.departs_at}>{formatDateTime(departure.departs_at, tz, locale)}</time>
        </h3>
        <p className="text-sm">
          {departure.route_name}
          {showBoat && (
            <>
              {" · "}
              <Link to={localePath(locale, `/boats/${departure.boat_slug}`)} className="text-primary hover:underline">
                {departure.boat_name}
              </Link>
            </>
          )}
        </p>
        <p className="text-sm text-muted">
          {departure.port_name && t("public.departures.port", { port: departure.port_name })}
          {departure.port_name && " · "}
          {t("public.departures.returns", { time: formatDateTime(departure.returns_at, tz, locale) })}
        </p>
        <p className="text-xs text-muted">{t("public.departures.closes", { time: formatDateTime(departure.booking_closes_at, tz, locale) })}</p>
        <h4 className="sr-only">{t("public.departures.slots")}</h4>
        <ul className="mt-2">
          {departure.slots.map((s) => (
            <SlotRow key={s.id} departure={departure} slot={s} />
          ))}
        </ul>
      </article>
    </Card>
  );
}

export function DepartureList({ departures, showBoat }: { departures: Departure[]; showBoat?: boolean }) {
  return (
    <ul className="space-y-4">
      {departures.map((d) => (
        <li key={d.id}>
          <DepartureCard departure={d} showBoat={showBoat} />
        </li>
      ))}
    </ul>
  );
}
