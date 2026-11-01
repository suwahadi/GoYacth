import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/locations";
import { Button, ButtonLink, ButtonPair, DataTable, Dialog, EmptyState, Tabs, useToast, type Column } from "~/components/ui";
import { FieldReader } from "~/features/admin-catalog/convert";
import { labelOf, loadRefs, named, settle } from "~/features/admin-catalog/data";
import { localesWithIssues, localizedText, nameOf } from "~/features/admin-catalog/translations";
import type { AdminPort, AdminRegion, AdminRoute } from "~/features/admin-catalog/types";
import {
  DeleteAction,
  FormError,
  LoadFailed,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  TranslationTabs,
  adminMeta,
  enumOptions,
  useSubmission,
  useTabParam,
} from "~/features/admin-catalog/ui";
import { api } from "~/lib/api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";
import { formatDuration, zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const TABS = ["regions", "ports", "routes"] as const;
type Tab = (typeof TABS)[number];
const INDONESIAN_ZONES = ["Asia/Jakarta", "Asia/Pontianak", "Asia/Makassar", "Asia/Jayapura"];
const OTHER_ZONE = "__other__";

export function meta() {
  return adminMeta("catalog.locations.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  return { refs: await settle(loadRefs(request, ["regions", "ports", "routes"])) };
}

export default function Locations({ loaderData }: Route.ComponentProps) {
  const [tab, setTab] = useTabParam(TABS);
  const { refs } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.locations.title")} />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: adminT(`catalog.locations.tab_${t}`) }))} active={tab} onChange={(t) => setTab(t as Tab)} />
      {!refs.ok ? (
        <LoadFailed code={refs.code} />
      ) : tab === "regions" ? (
        <Regions rows={refs.data.regions} />
      ) : tab === "ports" ? (
        <Ports rows={refs.data.ports} regions={refs.data.regions} />
      ) : (
        <Routes rows={refs.data.routes} regions={refs.data.regions} ports={refs.data.ports} />
      )}
    </div>
  );
}

function Regions({ rows }: { rows: AdminRegion[] }) {
  const columns: Column<AdminRegion>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (r) => nameOf(r.translations) },
    { key: "slug", header: adminT("catalog.fields.slug"), cell: (r) => nameOf(r.translations, "slug") },
    { key: "status", header: adminT("catalog.fields.status"), cell: (r) => <StatusPill status={r.status} /> },
    { key: "sort", header: adminT("catalog.fields.sort_order"), cell: (r) => r.sort_order },
  ];
  return (
    <div className="space-y-3">
      <ButtonLink to="/admin/regions/new">{adminT("catalog.regions.new")}</ButtonLink>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowHref={(r) => `/admin/regions/${r.id}`} />}
    </div>
  );
}

function Routes({ rows, regions, ports }: { rows: AdminRoute[]; regions: AdminRegion[]; ports: AdminPort[] }) {
  const regionOpts = named(regions);
  const portOpts = named(ports);
  const columns: Column<AdminRoute>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (r) => nameOf(r.translations) },
    { key: "region", header: adminT("catalog.fields.region"), cell: (r) => labelOf(regionOpts, r.region_id) },
    { key: "port", header: adminT("catalog.routes.departure_port"), cell: (r) => labelOf(portOpts, r.departure_port_id) },
    { key: "duration", header: adminT("catalog.routes.duration"), cell: (r) => formatDuration(r.duration_minutes, "en") },
    { key: "status", header: adminT("catalog.fields.status"), cell: (r) => <StatusPill status={r.status} /> },
  ];
  return (
    <div className="space-y-3">
      <ButtonLink to="/admin/routes/new">{adminT("catalog.routes.new")}</ButtonLink>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} onRowHref={(r) => `/admin/routes/${r.id}`} />}
    </div>
  );
}

function Ports({ rows, regions }: { rows: AdminPort[]; regions: AdminRegion[] }) {
  const [editing, setEditing] = useState<AdminPort | "new" | null>(null);
  const rv = useRevalidator();
  const regionOpts = named(regions);
  const columns: Column<AdminPort>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => nameOf(p.translations) },
    { key: "region", header: adminT("catalog.fields.region"), cell: (p) => labelOf(regionOpts, p.region_id) },
    { key: "tz", header: adminT("catalog.ports.timezone"), cell: (p) => `${p.timezone} (${zoneLabel(p.timezone)})` },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (p) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
            {adminT("catalog.common.edit")}
          </Button>
          <DeleteAction
            size="sm"
            title={adminT("catalog.common.delete_title", { item: adminT("catalog.ports.noun") })}
            body={adminT("catalog.common.delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/ports/${p.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")} disabled={regions.length === 0}>
        {adminT("catalog.common.add_item", { item: adminT("catalog.ports.noun") })}
      </Button>
      {regions.length === 0 && <p className="text-sm text-muted">{adminT("catalog.ports.needs_region")}</p>}
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} />}
      {editing && (
        <PortDialog
          port={editing === "new" ? null : editing}
          regionOpts={regionOpts}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rv.revalidate();
          }}
        />
      )}
    </div>
  );
}

function PortDialog({ port, regionOpts, onClose, onSaved }: { port: AdminPort | null; regionOpts: { value: string; label: string }[]; onClose: () => void; onSaved: () => void }) {
  const [names, setNames] = useState(() => {
    const raw: Record<string, string> = {};
    for (const l of LOCALES) raw[l] = port?.translations?.[l]?.name ?? "";
    return localizedText(raw);
  });
  const [regionId, setRegionId] = useState(port?.region_id ?? "");
  const [address, setAddress] = useState(port?.address ?? "");
  const [lat, setLat] = useState(port?.latitude === null || port?.latitude === undefined ? "" : String(port.latitude));
  const [lng, setLng] = useState(port?.longitude === null || port?.longitude === undefined ? "" : String(port.longitude));
  const initialZone = port?.timezone ?? "Asia/Makassar";
  const [zoneChoice, setZoneChoice] = useState(INDONESIAN_ZONES.includes(initialZone) ? initialZone : OTHER_ZONE);
  const [customZone, setCustomZone] = useState(INDONESIAN_ZONES.includes(initialZone) ? "" : initialZone);
  const [status, setStatus] = useState(port?.status ?? "ACTIVE");
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const save = async () => {
    const r = new FieldReader();
    const named: Record<string, string> = {};
    for (const l of LOCALES) if (names[l].trim()) named[l] = names[l].trim();
    const dto = {
      region_id: r.required("region_id", regionId),
      address: address.trim(),
      latitude: r.coord("latitude", lat, 90),
      longitude: r.coord("longitude", lng, 180),
      timezone: zoneChoice === OTHER_ZONE ? customZone.trim() : zoneChoice,
      status,
      names: named,
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api(port ? `/admin/ports/${port.id}` : "/admin/ports", { method: port ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  const noun = adminT("catalog.ports.noun");
  return (
    <Dialog
      open
      onClose={onClose}
      title={port ? adminT("catalog.common.edit_item", { item: noun }) : adminT("catalog.common.add_item", { item: noun })}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            {adminT("catalog.common.cancel")}
          </Button>
          <Button type="submit" form="port-form" pending={s.pending}>
            {adminT("catalog.common.save")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="port-form"
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TranslationTabs
          active={locale}
          onChange={setLocale}
          issues={localesWithIssues(
            Object.fromEntries(LOCALES.map((l) => [l, { name: names[l] }])) as Record<Locale, { name: string }>,
            ["name"],
            s.codes,
            "names",
          )}
        />
        <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={names[locale]} onChange={(v) => setNames({ ...names, [locale]: v })} error={s.field(`names.${locale}`)} />
        <SelectField label={adminT("catalog.fields.region")} required value={regionId} onChange={setRegionId} options={regionOpts} placeholder="" error={s.field("region_id")} />
        <TextField label={adminT("catalog.ports.address")} value={address} onChange={setAddress} error={s.field("address")} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={adminT("catalog.fields.latitude")} inputMode="decimal" value={lat} onChange={setLat} error={s.field("latitude")} hint={adminT("catalog.common.optional")} />
          <TextField label={adminT("catalog.fields.longitude")} inputMode="decimal" value={lng} onChange={setLng} error={s.field("longitude")} hint={adminT("catalog.common.optional")} />
          <SelectField
            label={adminT("catalog.ports.timezone")}
            value={zoneChoice}
            onChange={setZoneChoice}
            options={[...INDONESIAN_ZONES.map((z) => ({ value: z, label: `${z} (${zoneLabel(z)})` })), { value: OTHER_ZONE, label: adminT("catalog.ports.other_zone") }]}
            error={zoneChoice === OTHER_ZONE ? undefined : s.field("timezone")}
          />
          {zoneChoice === OTHER_ZONE && <TextField label={adminT("catalog.ports.custom_zone")} placeholder="Asia/Singapore" value={customZone} onChange={setCustomZone} error={s.field("timezone")} hint={adminT("catalog.ports.custom_zone_hint")} />}
          <SelectField label={adminT("catalog.fields.status")} value={status} onChange={(v) => setStatus(v as AdminPort["status"])} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
        </div>
        <FormError error={s.error} />
      </form>
    </Dialog>
  );
}
