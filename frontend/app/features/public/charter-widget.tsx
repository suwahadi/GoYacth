import { useEffect, useId, useMemo, useState } from "react";

import { Button, ButtonLink, Card, Field, Input, Select } from "~/components/ui";
import { formatDuration, formatTime, zoneLabel } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { BoatDetail, Rate } from "~/lib/types";
import { useRootData } from "~/root";
import { apiData } from "~/lib/api";

import { addDays, checkoutUrl, range, startTimeOptions, todayInZone, tripMinutes, unitOptions, zonedMidnightUTC } from "./booking-options";
import { QuoteView, useQuote, type QuoteRequest } from "./quote";

interface BusyRange {
  starts_at: string;
  ends_at: string;
  kind: string;
}

type BusyState = { status: "idle" } | { status: "loading" } | { status: "success"; ranges: BusyRange[] } | { status: "error" };

// useBusyRanges shows existing reservations for the chosen day. It is informational only: the
// booking transaction is the authority on availability.
function useBusyRanges(boatId: string, date: string, days: number, tz: string): BusyState {
  const [state, setState] = useState<BusyState>({ status: "idle" });
  useEffect(() => {
    if (!date) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    const from = zonedMidnightUTC(date, tz).toISOString();
    const to = zonedMidnightUTC(addDays(date, Math.max(1, days)), tz).toISOString();
    apiData<BusyRange[]>("/availability", { query: { boat_id: boatId, from, to }, signal: ctrl.signal })
      .then((ranges) => setState({ status: "success", ranges }))
      .catch((err: unknown) => {
        if ((err as Error).name !== "AbortError") setState({ status: "error" });
      });
    return () => ctrl.abort();
  }, [boatId, date, days, tz]);
  return state;
}

function BusyList({ state, tz }: { state: BusyState; tz: string }) {
  const t = useT();
  const locale = useLocale();
  if (state.status === "idle" || state.status === "loading") return null;
  if (state.status === "error") return <p className="text-xs text-muted">{t("public.widget.busy_error")}</p>;
  if (state.ranges.length === 0) return <p className="text-xs text-muted">{t("public.widget.busy_none")}</p>;
  return (
    <div className="text-xs">
      <p className="font-medium">{t("public.widget.busy_title")}</p>
      <ul className="list-disc pl-5">
        {state.ranges.map((r) => (
          <li key={r.starts_at + r.ends_at}>
            {formatTime(r.starts_at, tz, locale)} – {formatTime(r.ends_at, tz, locale)}
          </li>
        ))}
      </ul>
      <p className="text-muted">{t("public.widget.busy_hint")}</p>
    </div>
  );
}

export function CharterWidget({ boat }: { boat: BoatDetail }) {
  const t = useT();
  const locale = useLocale();
  const root = useRootData();
  const headingId = useId();
  const tz = boat.home_port.timezone || "Asia/Makassar";
  const [routeId, setRouteId] = useState(boat.routes[0]?.id ?? "");
  const [rateUnit, setRateUnit] = useState<Rate["rate_unit"]>(boat.rates[0]?.rate_unit ?? "HOURLY");
  const [date, setDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [units, setUnits] = useState(0);
  const [pax, setPax] = useState(Math.min(2, boat.max_passengers));

  const route = boat.routes.find((r) => r.id === routeId);
  const rate = boat.rates.find((r) => r.rate_unit === rateUnit);
  const routeMin = route ? (route.min_duration_minutes ?? route.duration_minutes) : 0;
  const units_ = useMemo(
    () =>
      rate
        ? unitOptions({ rate, routeMinDurationMinutes: routeMin, operatingStartMinute: boat.operating_start_minute, operatingEndMinute: boat.operating_end_minute, overnightAllowed: boat.overnight_allowed })
        : [],
    [rate, routeMin, boat.operating_start_minute, boat.operating_end_minute, boat.overnight_allowed],
  );
  const effectiveUnits = units_.includes(units) ? units : (units_[0] ?? 0);
  const times = useMemo(
    () =>
      startTimeOptions({
        operatingStartMinute: boat.operating_start_minute,
        operatingEndMinute: boat.operating_end_minute,
        durationMinutes: tripMinutes(rateUnit, effectiveUnits, routeMin),
        overnightAllowed: boat.overnight_allowed,
      }),
    [boat.operating_start_minute, boat.operating_end_minute, boat.overnight_allowed, rateUnit, effectiveUnits, routeMin],
  );
  const effectiveStart = times.includes(startTime) ? startTime : "";
  const busy = useBusyRanges(boat.id, date, rateUnit === "DAILY" ? effectiveUnits : 1, tz);

  const today = todayInZone(tz);
  const maxDate = root.settings.booking?.max_advance_days ? addDays(today, root.settings.booking.max_advance_days) : undefined;
  const ready = route && rate && date && effectiveStart && effectiveUnits > 0 && pax > 0;
  const request: QuoteRequest | null = ready
    ? { product: { mode: "PRIVATE_CHARTER", boat_id: boat.id, route_id: routeId, date, start_time: effectiveStart, rate_unit: rateUnit, units: effectiveUnits }, pax, locale }
    : null;
  const quote = useQuote(request);

  if (boat.routes.length === 0 || boat.rates.length === 0) {
    return (
      <Card>
        <p className="text-sm">{t("public.widget.unavailable")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <section aria-labelledby={headingId} className="space-y-4">
        <div>
          <h2 id={headingId} className="text-lg font-semibold">
            {t("public.widget.title")}
          </h2>
          <p className="text-sm text-muted">{t("public.widget.subtitle")}</p>
        </div>
        <Field label={t("public.widget.route")}>
          {(p) => (
            <Select {...p} value={routeId} onChange={(e) => setRouteId(e.target.value)}>
              {boat.routes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({formatDuration(r.min_duration_minutes ?? r.duration_minutes, locale)})
                </option>
              ))}
            </Select>
          )}
        </Field>
        {boat.rates.length > 1 && (
          <Field label={t("public.widget.rate")}>
            {(p) => (
              <Select {...p} value={rateUnit} onChange={(e) => setRateUnit(e.target.value as Rate["rate_unit"])}>
                {boat.rates.map((r) => (
                  <option key={r.rate_unit} value={r.rate_unit}>
                    {t(`public.rate_units.${r.rate_unit}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {rateUnit === "FIXED" ? (
          <p className="text-sm">{t("public.widget.fixed_duration", { duration: formatDuration(routeMin, locale) })}</p>
        ) : (
          <Field label={t(rateUnit === "DAILY" ? "public.widget.days" : "public.widget.hours")}>
            {(p) => (
              <Select {...p} value={effectiveUnits || ""} onChange={(e) => setUnits(Number(e.target.value))}>
                {units_.map((u) => (
                  <option key={u} value={u}>
                    {rateUnit === "DAILY" ? t("public.widget.day_count", { count: u }) : formatDuration(u * 60, locale)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label={t("public.widget.date")} hint={t("public.widget.date_hint", { zone: zoneLabel(tz) })}>
          {(p) => <Input {...p} type="date" min={today} max={maxDate} value={date} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <BusyList state={busy} tz={tz} />
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
        <Field label={t("public.widget.pax")} hint={t("public.widget.pax_hint", { count: boat.max_passengers })}>
          {(p) => (
            <Select {...p} value={pax} onChange={(e) => setPax(Number(e.target.value))}>
              {range(1, boat.max_passengers).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <QuoteView state={quote} idleText={t("public.widget.complete_form")} />
        {quote.status === "success" && request ? (
          <ButtonLink
            full
            size="lg"
            to={checkoutUrl(locale, { mode: "PRIVATE_CHARTER", boatSlug: boat.slug, pax, boatId: boat.id, routeId, date, startTime: effectiveStart, rateUnit, units: effectiveUnits })}
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
