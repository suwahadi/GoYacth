import { useState, type CSSProperties } from "react";
import { Link, useRevalidator } from "react-router";

import type { Route } from "./+types/calendar";
import { Button, ButtonPair, ConfirmDialog, EmptyState, Field, FilterBar, Input, Select, cn, useToast } from "~/components/ui";
import { BlockDialog } from "~/features/admin-ops/block-dialog";
import { eventTone, layoutCalendar, matchCharterBooking, type EventTone } from "~/features/admin-ops/calendar";
import { loadBoatOptions, loadPorts } from "~/features/admin-ops/catalog";
import { load, useAction, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ, ADMIN_ZONES, addDays, dayList, isValidYmd, todayIn, zonedToUtc, zonedToUtcISO } from "~/features/admin-ops/time";
import type { AdminBookingRow, CalendarData, CalendarEvent } from "~/features/admin-ops/types";
import { LoadFailure, OpsError, PageHeader, Pending, opsCode } from "~/features/admin-ops/ui";
import { api, apiData } from "~/lib/api";
import { formatDateTime, formatPlainDate, zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const SPANS = [7, 14, 31];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const tz = ADMIN_ZONES.find((z) => z === url.searchParams.get("tz")) ?? ADMIN_TZ;
  const start = url.searchParams.get("start");
  const from = start && isValidYmd(start) ? start : todayIn(tz);
  const days = SPANS.find((s) => String(s) === url.searchParams.get("days")) ?? 14;
  const boatId = url.searchParams.get("boat_id") || undefined;
  const rangeFrom = zonedToUtcISO(from, "00:00", tz);
  const rangeTo = zonedToUtcISO(addDays(from, days), "00:00", tz);
  const [calendar, bookings, options] = await Promise.all([
    load(apiData<CalendarData>("/admin/calendar", { request, query: { from: rangeFrom, to: rangeTo, boat_id: boatId } })),
    load(apiData<AdminBookingRow[]>("/admin/bookings", { request, query: { boat_id: boatId, from: zonedToUtcISO(addDays(from, -3), "00:00", tz), to: rangeTo, per_page: 100 } })),
    load(Promise.all([loadBoatOptions(request), loadPorts({ request })])),
  ]);
  return { tz, from, days, calendar, bookings: bookings.data ?? [], options };
}

export function meta() {
  return [{ title: `${adminT("ops.calendar.title")} | GoYacht Admin` }];
}

const toneClass: Record<EventTone, string> = {
  charter: "bg-primary text-primary-fg border-primary",
  departure: "bg-info-bg text-fg border-primary",
  block: "bg-surface-2 text-fg border-border",
  held: "bg-warning-bg text-fg border-warning border-dashed",
};

function eventLabel(e: CalendarEvent): string {
  if (e.status === "HELD") return opsCode("reservation", "HELD");
  return opsCode("reservation", e.kind) + (e.partial ? ` · ${adminT("ops.calendar.partial")}` : "");
}

function eventTarget(e: CalendarEvent, bookings: AdminBookingRow[], from: string, days: number): { to?: string; block?: string } {
  if (e.kind === "DEPARTURE" && e.departure_id) return { to: `/admin/departures/${e.departure_id}` };
  if (e.kind === "BLOCK" && e.block_id) return { block: e.block_id };
  const match = matchCharterBooking(e, bookings);
  if (match) return { to: `/admin/bookings/${match.id}` };
  return { to: `/admin/bookings?boat_id=${e.boat_id}&from=${from}&to=${addDays(from, days - 1)}` };
}

function EventItem({ e, tz, target, onBlock, className, style }: { e: CalendarEvent; tz: string; target: { to?: string; block?: string }; onBlock: (id: string) => void; className?: string; style?: CSSProperties }) {
  const title = `${eventLabel(e)}: ${formatDateTime(e.starts_at, tz, "en")} – ${formatDateTime(e.ends_at, tz, "en")}${e.expires_at ? ` · ${adminT("ops.calendar.hold_expires", { time: formatDateTime(e.expires_at, tz, "en") })}` : ""}`;
  const cls = cn("truncate rounded border px-1 text-left text-xs leading-5", toneClass[eventTone(e)], className);
  if (target.block) {
    return (
      <button type="button" className={cls} style={style} title={title} aria-label={title} onClick={() => onBlock(target.block!)}>
        {eventLabel(e)}
      </button>
    );
  }
  return (
    <Link to={target.to ?? "#"} className={cls} style={style} title={title} aria-label={title}>
      {eventLabel(e)}
    </Link>
  );
}

export default function CalendarPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const { tz, from, days, calendar, bookings, options } = loaderData;
  const [blockOpen, setBlockOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const del = useAction();
  const revalidator = useRevalidator();
  const toast = useToast();
  const target = (e: CalendarEvent) => eventTarget(e, bookings, from, days);
  const [boats, ports] = options.data ?? [[], []];
  const dayKeys = dayList(from, days);
  const startMs = zonedToUtc(from, "00:00", tz).getTime();
  const endMs = zonedToUtc(addDays(from, days), "00:00", tz).getTime();
  const rows = calendar.data ? layoutCalendar(calendar.data.boats, calendar.data.events, startMs, endMs) : [];

  const removeBlock = async () => {
    if (!deleting) return;
    const r = await del.run(() => api(`/admin/blocks/${deleting}`, { method: "DELETE" }));
    if (r.ok) {
      setDeleting(null);
      toast(adminT("ops.calendar.block_deleted"));
      revalidator.revalidate();
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={adminT("ops.calendar.title")}
        actions={
          <Button size="sm" onClick={() => setBlockOpen(true)} disabled={!options.data}>
            {adminT("ops.calendar.new_block")}
          </Button>
        }
      />
      <FilterBar activeCount={f.activeCount(["boat_id"])} onClear={() => f.clear(["boat_id"])}>
        <Field label={adminT("ops.calendar.start")}>{(p) => <Input {...p} type="date" value={from} onChange={(e) => f.set({ start: e.target.value })} />}</Field>
        <Field label={adminT("ops.calendar.days")}>
          {(p) => (
            <Select {...p} value={String(days)} onChange={(e) => f.set({ days: e.target.value })}>
              {SPANS.map((s) => (
                <option key={s} value={s}>
                  {adminT("ops.calendar.n_days", { n: s })}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.bookings.boat")}>
          {(p) => (
            <Select {...p} value={f.get("boat_id")} onChange={(e) => f.set({ boat_id: e.target.value })}>
              <option value="">{adminT("ops.calendar.all_boats")}</option>
              {boats.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.calendar.zone")}>
          {(p) => (
            <Select {...p} value={tz} onChange={(e) => f.set({ tz: e.target.value })}>
              {ADMIN_ZONES.map((z) => (
                <option key={z} value={z}>
                  {zoneLabel(z)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </FilterBar>
      <ButtonPair className="max-w-sm">
        <Button size="sm" variant="secondary" onClick={() => f.set({ start: addDays(from, -days) })}>
          {adminT("ops.calendar.previous")}
        </Button>
        <Button size="sm" variant="secondary" onClick={() => f.set({ start: addDays(from, days) })}>
          {adminT("ops.calendar.next")}
        </Button>
      </ButtonPair>
      <ul className="flex flex-wrap gap-3 text-xs" aria-label={adminT("ops.calendar.legend")}>
        {(["charter", "departure", "block", "held"] as EventTone[]).map((t) => (
          <li key={t} className="flex items-center gap-1">
            <span className={cn("inline-block size-3 rounded border", toneClass[t])} aria-hidden="true" />
            {opsCode("tone", t)}
          </li>
        ))}
      </ul>
      {calendar.error ? (
        <LoadFailure error={calendar.error} />
      ) : (
        <Pending>
          {rows.length === 0 ? (
            <EmptyState title={adminT("ops.calendar.no_boats")} />
          ) : (
            <>
              <div className="hidden overflow-hidden rounded-lg border border-border bg-surface md:block">
                <div className="flex border-b border-border bg-surface-2 text-xs text-muted">
                  <div className="w-40 shrink-0 px-2 py-1">{adminT("ops.bookings.boat")}</div>
                  <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }}>
                    {dayKeys.map((d) => (
                      <div key={d} className="truncate border-l border-border px-1 py-1 text-center">
                        {formatPlainDate(d, "en").replace(/ \d{4}$/, "")}
                      </div>
                    ))}
                  </div>
                </div>
                {rows.map((row) => (
                  <div key={row.boat.id} className="flex border-b border-border last:border-b-0">
                    <div className="w-40 shrink-0 truncate px-2 py-1 text-sm" title={row.boat.name}>
                      {row.boat.name}
                      <span className="block text-xs text-muted">{row.boat.code}</span>
                    </div>
                    <div className="relative flex-1" style={{ minHeight: `${Math.max(row.lanes.length, 1) * 1.5 + 0.5}rem` }}>
                      <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${days}, minmax(0, 1fr))` }} aria-hidden="true">
                        {dayKeys.map((d) => (
                          <div key={d} className="border-l border-border" />
                        ))}
                      </div>
                      {row.lanes.map((lane, li) =>
                        lane.map((p) => (
                          <EventItem
                            key={`${p.event.booking_id ?? p.event.departure_id ?? p.event.block_id}-${p.event.starts_at}`}
                            e={p.event}
                            tz={tz}
                            target={target(p.event)}
                            onBlock={setDeleting}
                            className="absolute"
                            style={{ left: `${p.leftPct}%`, width: `${p.widthPct}%`, top: `${li * 1.5 + 0.25}rem` }}
                          />
                        )),
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <ul className="space-y-3 md:hidden">
                {rows.map((row) => (
                  <li key={row.boat.id} className="rounded-lg border border-border bg-surface p-3">
                    <p className="font-medium">
                      {row.boat.name} <span className="text-xs text-muted">{row.boat.code}</span>
                    </p>
                    {row.events.length === 0 ? (
                      <p className="text-sm text-muted">{adminT("ops.calendar.free")}</p>
                    ) : (
                      <ul className="mt-2 space-y-1">
                        {row.events.map((e) => (
                          <li key={`${e.booking_id ?? e.departure_id ?? e.block_id}-${e.starts_at}`} className="text-sm">
                            <EventItem e={e} tz={tz} target={target(e)} onBlock={setDeleting} className="inline-block max-w-full" />
                            <span className="block text-xs text-muted">
                              {formatDateTime(e.starts_at, tz, "en")} – {formatDateTime(e.ends_at, tz, "en")}
                            </span>
                            {e.expires_at && <span className="block text-xs text-warning">{adminT("ops.calendar.hold_expires", { time: formatDateTime(e.expires_at, tz, "en") })}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </Pending>
      )}
      {options.error && <LoadFailure error={options.error} />}
      <BlockDialog open={blockOpen} onClose={() => setBlockOpen(false)} boats={boats} ports={ports} defaultBoatId={f.get("boat_id") || undefined} defaultDate={from} />
      <ConfirmDialog
        open={!!deleting}
        tone="danger"
        title={adminT("ops.calendar.delete_block")}
        body={
          <div className="space-y-2">
            <p>{adminT("ops.calendar.delete_block_body")}</p>
            <OpsError error={del.error} />
          </div>
        }
        confirmLabel={adminT("ops.calendar.delete_block")}
        pending={del.pending}
        onConfirm={removeBlock}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
