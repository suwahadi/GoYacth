import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/pricing";
import { Alert, Button, Checkbox, DataTable, EmptyState, SkeletonList, Tabs, useToast, type Column } from "~/components/ui";
import { FieldReader, basisPointsToPercent, intText } from "~/features/admin-catalog/convert";
import { boatOptions, labelOf, loadRefs, named, settle, useFetch, type Opt } from "~/features/admin-catalog/data";
import { promotionDTO, promotionForm, taxLineDTO, taxLineForm, type PromotionForm, type TaxLineForm } from "~/features/admin-catalog/mappers";
import { localesWithIssues } from "~/features/admin-catalog/translations";
import { PAYMENT_METHODS, type AdminBoat, type AdminPackage, type AdminSettings, type MethodFee, type OverrideRule, type PriceOverride, type Promotion, type RecordStatus, type Season, type TaxLine } from "~/features/admin-catalog/types";
import {
  DeleteAction,
  FormDialog,
  FormError,
  LoadFailed,
  MoneyField,
  NumberField,
  PageHeader,
  PercentField,
  Section,
  SelectField,
  StatusPill,
  TextField,
  TranslationTabs,
  adminMeta,
  enumLabel,
  enumOptions,
  useErrorText,
  useSubmission,
  useTabParam,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";
import { formatBasisPoints, formatDateTime, formatIDR, formatPlainDate } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const TABS = ["seasons", "overrides", "promotions", "taxes", "fees", "currency"] as const;

export function meta() {
  return adminMeta("catalog.pricing.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  const [data, refs] = await Promise.all([
    settle(
      Promise.all([
        apiData<Season[]>("/admin/seasons", { request }),
        apiData<Promotion[]>("/admin/promotions", { request }),
        apiData<TaxLine[]>("/admin/tax-lines", { request }),
        apiData<MethodFee[]>("/admin/payment-method-fees", { request }),
        apiData<AdminSettings>("/admin/settings", { request }),
      ]).then(([seasons, promotions, taxLines, fees, settings]) => ({ seasons, promotions, taxLines, fees, settings })),
    ),
    settle(loadRefs(request, ["boats", "packages"])),
  ]);
  return { data, refs };
}

export default function Pricing({ loaderData }: Route.ComponentProps) {
  const [tab, setTab] = useTabParam(TABS);
  const { data, refs } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.pricing.title")} />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: adminT(`catalog.pricing.tab_${t}`) }))} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {!data.ok ? (
        <LoadFailed code={data.code} />
      ) : !refs.ok ? (
        <LoadFailed code={refs.code} />
      ) : tab === "seasons" ? (
        <Seasons rows={data.data.seasons} />
      ) : tab === "overrides" ? (
        <Overrides seasons={data.data.seasons} boats={refs.data.boats} packages={named(refs.data.packages)} />
      ) : tab === "promotions" ? (
        <Promotions rows={data.data.promotions} boats={boatOptions(refs.data.boats)} packages={named(refs.data.packages)} />
      ) : tab === "taxes" ? (
        <TaxLines rows={data.data.taxLines} />
      ) : tab === "fees" ? (
        <Fees rows={data.data.fees} />
      ) : (
        <Currency rate={data.data.settings.currency?.usd_rate_idr ?? 0} />
      )}
    </div>
  );
}

function useSaved(onSaved: () => void) {
  const toast = useToast();
  return () => {
    toast(adminT("catalog.common.saved"));
    onSaved();
  };
}

function Seasons({ rows }: { rows: Season[] }) {
  const [editing, setEditing] = useState<Season | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<Season>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (x) => x.name },
    { key: "kind", header: adminT("catalog.pricing.season_kind"), cell: (x) => enumLabel("season_kind", x.kind) },
    { key: "range", header: adminT("catalog.pricing.period"), cell: (x) => `${formatPlainDate(x.starts_on, "en")} – ${formatPlainDate(x.ends_on, "en")}` },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (x) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(x)}>
            {adminT("catalog.common.edit")}
          </Button>
          <DeleteAction
            size="sm"
            title={adminT("catalog.common.delete_title", { item: adminT("catalog.pricing.season") })}
            body={adminT("catalog.pricing.season_delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/seasons/${x.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.pricing.season") })}</Button>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(x) => x.id} />}
      {editing && <SeasonDialog season={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), rv.revalidate())} />}
    </div>
  );
}

function SeasonDialog({ season, onClose, onSaved }: { season: Season | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: season?.name ?? "", kind: season?.kind ?? "HIGH", starts_on: season?.starts_on ?? "", ends_on: season?.ends_on ?? "" });
  const s = useSubmission();
  const done = useSaved(onSaved);
  const save = async () => {
    const ok = await s.run(async (signal) => {
      await api(season ? `/admin/seasons/${season.id}` : "/admin/seasons", { method: season ? "PUT" : "POST", body: { ...form, name: form.name.trim() }, signal });
    });
    if (ok) done();
  };
  return (
    <FormDialog id="season-form" size="md" title={season ? season.name : adminT("catalog.common.add_item", { item: adminT("catalog.pricing.season") })} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <TextField label={adminT("catalog.fields.name")} required value={form.name} onChange={(v) => setForm({ ...form, name: v })} error={s.field("name")} />
      <SelectField label={adminT("catalog.pricing.season_kind")} value={form.kind} onChange={(v) => setForm({ ...form, kind: v as Season["kind"] })} options={enumOptions("season_kind", ["LOW", "HIGH", "PEAK"])} error={s.field("kind")} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField type="date" label={adminT("catalog.pricing.starts_on")} required value={form.starts_on} onChange={(v) => setForm({ ...form, starts_on: v })} error={s.field("starts_on")} />
        <TextField type="date" label={adminT("catalog.pricing.ends_on")} required value={form.ends_on} onChange={(v) => setForm({ ...form, ends_on: v })} error={s.field("ends_on")} />
      </div>
      <FormError error={s.error} />
    </FormDialog>
  );
}

type Target = { kind: "boat_rate_id" | "package_offering_id"; id: string } | null;

function Overrides({ seasons, boats, packages }: { seasons: Season[]; boats: AdminBoat[]; packages: Opt[] }) {
  const [kind, setKind] = useState<"package" | "boat">("package");
  const [boatId, setBoatId] = useState("");
  const [packageId, setPackageId] = useState("");
  const [targetId, setTargetId] = useState("");
  const boatOpts = boatOptions(boats);
  const boat = useFetch<AdminBoat>(kind === "boat" && boatId ? `/admin/boats/${boatId}` : null);
  const pkg = useFetch<AdminPackage>(kind === "package" && packageId ? `/admin/packages/${packageId}` : null);
  const text = useErrorText();
  const rates = (boat.data?.rates ?? []).filter((r) => r.id);
  const target: Target = targetId ? { kind: kind === "boat" ? "boat_rate_id" : "package_offering_id", id: targetId } : null;
  const offeringOpts = (pkg.data?.offerings ?? []).map((o) => ({ value: o.id, label: `${labelOf(boatOpts, o.boat_id)} · ${formatIDR(o.price, "en")}` }));
  const rateOpts = rates.map((r) => ({ value: r.id as string, label: `${enumLabel("rate_unit", r.rate_unit)} · ${formatIDR(r.price, "en")}` }));
  const sub = kind === "boat" ? boat : pkg;
  return (
    <div className="space-y-4">
      <Section title={adminT("catalog.pricing.override_target")}>
        <p className="text-xs text-muted">{adminT("catalog.pricing.override_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <SelectField
            label={adminT("catalog.pricing.target_kind")}
            value={kind}
            onChange={(v) => {
              setKind(v as "package" | "boat");
              setTargetId("");
            }}
            options={[
              { value: "package", label: adminT("catalog.pricing.target_package") },
              { value: "boat", label: adminT("catalog.pricing.target_boat") },
            ]}
          />
          {kind === "boat" ? (
            <SelectField label={adminT("catalog.fields.boat")} value={boatId} onChange={(v) => (setBoatId(v), setTargetId(""))} options={boatOpts} placeholder="" />
          ) : (
            <SelectField label={adminT("catalog.pricing.package")} value={packageId} onChange={(v) => (setPackageId(v), setTargetId(""))} options={packages} placeholder="" />
          )}
          {sub.loading ? (
            <SkeletonList rows={1} />
          ) : sub.error ? (
            <p role="alert" className="text-sm text-danger">
              {text(sub.error)}
            </p>
          ) : kind === "boat" ? (
            boat.data && (rateOpts.length ? <SelectField label={adminT("catalog.pricing.rate")} value={targetId} onChange={setTargetId} options={rateOpts} placeholder="" /> : null)
          ) : (
            pkg.data && <SelectField label={adminT("catalog.pricing.offering")} value={targetId} onChange={setTargetId} options={offeringOpts} placeholder="" />
          )}
        </div>
        {kind === "boat" && boat.data && rateOpts.length === 0 && (
          <Alert tone="warning">{boat.data.rates.length ? adminT("catalog.pricing.rate_ids_missing") : adminT("catalog.pricing.no_rates")}</Alert>
        )}
      </Section>
      {target && <OverrideList key={target.id} target={target} seasons={seasons} />}
    </div>
  );
}

function OverrideList({ target, seasons }: { target: NonNullable<Target>; seasons: Season[] }) {
  const list = useFetch<PriceOverride[]>("/admin/price-overrides", { [target.kind]: target.id });
  const text = useErrorText();
  const [form, setForm] = useState({ rule_type: "DATE" as OverrideRule, on_date: "", season_id: "", price: "" });
  const s = useSubmission();
  const toast = useToast();
  const seasonOpts = seasons.map((x) => ({ value: x.id, label: `${x.name} (${enumLabel("season_kind", x.kind)})` }));
  const add = async () => {
    const r = new FieldReader();
    const dto = {
      boat_rate_id: target.kind === "boat_rate_id" ? target.id : null,
      package_offering_id: target.kind === "package_offering_id" ? target.id : null,
      rule_type: form.rule_type,
      on_date: form.rule_type === "DATE" ? r.required("on_date", form.on_date) : null,
      season_id: form.rule_type === "SEASON" ? r.required("season_id", form.season_id) : null,
      price: r.int("price", form.price),
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api("/admin/price-overrides", { method: "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      setForm({ ...form, on_date: "", price: "" });
      list.reload();
    }
  };
  const columns: Column<PriceOverride>[] = [
    { key: "rule", header: adminT("catalog.pricing.rule"), primary: true, cell: (o) => enumLabel("rule_type", o.rule_type) },
    {
      key: "when",
      header: adminT("catalog.pricing.applies_on"),
      cell: (o) => (o.on_date ? formatPlainDate(o.on_date, "en") : o.season_id ? labelOf(seasonOpts, o.season_id) : "—"),
    },
    { key: "price", header: adminT("catalog.fields.price"), cell: (o) => formatIDR(o.price, "en") },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (o) => (
        <DeleteAction
          size="sm"
          title={adminT("catalog.common.delete_title", { item: adminT("catalog.pricing.override") })}
          body={adminT("catalog.common.delete_body")}
          onDelete={async (signal) => {
            await api(`/admin/price-overrides/${o.id}`, { method: "DELETE", signal });
            list.reload();
          }}
        />
      ),
    },
  ];
  return (
    <Section title={adminT("catalog.pricing.overrides")}>
      <p className="text-xs text-muted">{adminT("catalog.pricing.precedence")}</p>
      {list.loading ? (
        <SkeletonList rows={2} />
      ) : list.error ? (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-danger">
            {text(list.error)}
          </p>
          <Button size="sm" variant="secondary" onClick={list.reload}>
            {adminT("catalog.common.retry")}
          </Button>
        </div>
      ) : !list.data?.length ? (
        <EmptyState title={adminT("catalog.pricing.no_overrides")} />
      ) : (
        <DataTable rows={list.data} columns={columns} rowKey={(o) => o.id} />
      )}
      <form
        noValidate
        className="grid items-end gap-3 border-t border-border pt-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <SelectField label={adminT("catalog.pricing.rule")} value={form.rule_type} onChange={(v) => setForm({ ...form, rule_type: v as OverrideRule })} options={enumOptions("rule_type", ["DATE", "SEASON", "WEEKEND", "WEEKDAY"])} error={s.field("rule_type")} />
        {form.rule_type === "DATE" && <TextField type="date" label={adminT("catalog.pricing.on_date")} required value={form.on_date} onChange={(v) => setForm({ ...form, on_date: v })} error={s.field("on_date")} />}
        {form.rule_type === "SEASON" && <SelectField label={adminT("catalog.pricing.season")} required value={form.season_id} onChange={(v) => setForm({ ...form, season_id: v })} options={seasonOpts} placeholder="" error={s.field("season_id")} />}
        <MoneyField label={adminT("catalog.fields.price")} required value={form.price} onChange={(v) => setForm({ ...form, price: v })} error={s.field("price")} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.pricing.add_override")}
        </Button>
        <div className="sm:col-span-4">
          <FormError error={s.error} />
        </div>
      </form>
    </Section>
  );
}

function discountText(p: Promotion) {
  if (p.discount_type === "PERCENTAGE") return formatBasisPoints(p.discount_value, "en");
  return `${enumLabel("discount_type", p.discount_type)} ${formatIDR(p.discount_value, "en")}`;
}

function Promotions({ rows, boats, packages }: { rows: Promotion[]; boats: Opt[]; packages: Opt[] }) {
  const [editing, setEditing] = useState<Promotion | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<Promotion>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => p.name },
    { key: "code", header: adminT("catalog.pricing.promo_code"), cell: (p) => p.code ?? adminT("catalog.pricing.automatic") },
    { key: "discount", header: adminT("catalog.pricing.discount"), cell: discountText },
    { key: "period", header: adminT("catalog.pricing.period"), cell: (p) => `${formatDateTime(p.starts_at, "UTC", "en")} – ${formatDateTime(p.ends_at, "UTC", "en")}` },
    { key: "quota", header: adminT("catalog.pricing.quota"), cell: (p) => (p.quota === null ? `${p.used_count} / ∞` : `${p.used_count} / ${p.quota}`) },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (p) => (
        <Button size="sm" variant="secondary" onClick={() => setEditing(p)}>
          {adminT("catalog.common.edit")}
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.pricing.promotion") })}</Button>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} />}
      {editing && <PromotionDialog promo={editing === "new" ? null : editing} boats={boats} packages={packages} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), rv.revalidate())} />}
    </div>
  );
}

function PromotionDialog({ promo, boats, packages, onClose, onSaved }: { promo: Promotion | null; boats: Opt[]; packages: Opt[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PromotionForm>(() => promotionForm(promo));
  const s = useSubmission();
  const done = useSaved(onSaved);
  const set = (patch: Partial<PromotionForm>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    const { dto, errors } = promotionDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    const ok = await s.run(async (signal) => {
      await api(promo ? `/admin/promotions/${promo.id}` : "/admin/promotions", { method: promo ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) done();
  };
  return (
    <FormDialog id="promotion-form" title={promo ? promo.name : adminT("catalog.common.add_item", { item: adminT("catalog.pricing.promotion") })} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.fields.name")} required value={form.name} onChange={(v) => set({ name: v })} error={s.field("name")} />
        <TextField label={adminT("catalog.pricing.promo_code")} value={form.code} onChange={(v) => set({ code: v.toUpperCase() })} error={s.field("code")} hint={adminT("catalog.pricing.promo_code_hint")} />
        <Checkbox label={adminT("catalog.pricing.is_automatic")} checked={form.is_automatic} onChange={(e) => set({ is_automatic: e.target.checked })} />
        <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as RecordStatus })} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
        <SelectField label={adminT("catalog.pricing.discount_type")} value={form.discount_type} onChange={(v) => set({ discount_type: v as PromotionForm["discount_type"] })} options={enumOptions("discount_type", ["PERCENTAGE", "FIXED", "PRICE"])} error={s.field("discount_type")} />
        {form.discount_type === "PERCENTAGE" ? (
          <PercentField label={adminT("catalog.pricing.discount_value")} required value={form.discount_value} onChange={(v) => set({ discount_value: v })} error={s.field("discount_value")} />
        ) : (
          <MoneyField label={adminT("catalog.pricing.discount_value")} required value={form.discount_value} onChange={(v) => set({ discount_value: v })} error={s.field("discount_value")} hint={enumLabel("discount_type_hint", form.discount_type)} />
        )}
        <SelectField label={adminT("catalog.fields.boat")} value={form.boat_id} onChange={(v) => set({ boat_id: v })} options={boats} placeholder={adminT("catalog.common.any")} error={s.field("boat_id")} />
        <SelectField label={adminT("catalog.pricing.package")} value={form.package_id} onChange={(v) => set({ package_id: v })} options={packages} placeholder={adminT("catalog.common.any")} error={s.field("package_id")} />
        <SelectField label={adminT("catalog.packages.mode")} value={form.booking_mode} onChange={(v) => set({ booking_mode: v as PromotionForm["booking_mode"] })} options={enumOptions("mode", ["PRIVATE_CHARTER", "DEPARTURE"])} placeholder={adminT("catalog.common.any")} error={s.field("booking_mode")} />
        <MoneyField label={adminT("catalog.pricing.min_subtotal")} value={form.min_subtotal} onChange={(v) => set({ min_subtotal: v })} error={s.field("min_subtotal")} />
        <TextField type="datetime-local" label={adminT("catalog.pricing.starts_at")} required value={form.starts_at} onChange={(v) => set({ starts_at: v })} error={s.field("starts_at")} hint={adminT("catalog.common.local_time_hint")} />
        <TextField type="datetime-local" label={adminT("catalog.pricing.ends_at")} required value={form.ends_at} onChange={(v) => set({ ends_at: v })} error={s.field("ends_at")} />
        <NumberField label={adminT("catalog.pricing.quota")} value={form.quota} onChange={(v) => set({ quota: v })} error={s.field("quota")} hint={adminT("catalog.pricing.quota_hint")} />
      </div>
      <FormError error={s.error} />
    </FormDialog>
  );
}

function TaxLines({ rows }: { rows: TaxLine[] }) {
  const [editing, setEditing] = useState<TaxLine | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<TaxLine>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (t) => t.names?.[DEFAULT_LOCALE] || t.code },
    { key: "code", header: adminT("catalog.fields.code"), cell: (t) => t.code },
    { key: "rate", header: adminT("catalog.pricing.rate_percent"), cell: (t) => formatBasisPoints(t.basis_points, "en") },
    { key: "base", header: adminT("catalog.pricing.base"), cell: (t) => (t.includes_previous_lines ? adminT("catalog.pricing.base_with_previous") : adminT("catalog.pricing.base_subtotal")) },
    { key: "sort", header: adminT("catalog.fields.sort_order"), cell: (t) => t.sort_order },
    { key: "status", header: adminT("catalog.fields.status"), cell: (t) => <StatusPill status={t.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (t) => (
        <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
          {adminT("catalog.common.edit")}
        </Button>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.pricing.tax_line") })}</Button>
      <p className="text-xs text-muted">{adminT("catalog.pricing.tax_hint")}</p>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(t) => t.id} />}
      {editing && <TaxLineDialog line={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), rv.revalidate())} />}
    </div>
  );
}

function TaxLineDialog({ line, onClose, onSaved }: { line: TaxLine | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<TaxLineForm>(() => taxLineForm(line));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const done = useSaved(onSaved);
  const set = (patch: Partial<TaxLineForm>) => setForm((f) => ({ ...f, ...patch }));
  const save = async () => {
    const { dto, errors } = taxLineDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    const ok = await s.run(async (signal) => {
      await api(line ? `/admin/tax-lines/${line.id}` : "/admin/tax-lines", { method: line ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) done();
  };
  const issues = localesWithIssues(
    Object.fromEntries(LOCALES.map((l) => [l, { name: form.names[l] }])) as Record<Locale, { name: string }>,
    ["name"],
    s.codes,
    "names",
  );
  return (
    <FormDialog id="tax-form" size="md" title={line ? line.code : adminT("catalog.common.add_item", { item: adminT("catalog.pricing.tax_line") })} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <TranslationTabs active={locale} onChange={setLocale} issues={issues} />
      <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={form.names[locale]} onChange={(v) => set({ names: { ...form.names, [locale]: v } })} error={s.field(`names.${locale}`)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.fields.code")} required value={form.code} onChange={(v) => set({ code: v.toUpperCase() })} error={s.field("code")} />
        <PercentField label={adminT("catalog.pricing.rate_percent")} required value={form.percent} onChange={(v) => set({ percent: v })} error={s.field("basis_points")} />
        <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => set({ sort_order: v })} error={s.field("sort_order")} hint={adminT("catalog.pricing.sort_hint")} />
        <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as RecordStatus })} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
      </div>
      <Checkbox label={adminT("catalog.pricing.includes_previous")} checked={form.includes_previous_lines} onChange={(e) => set({ includes_previous_lines: e.target.checked })} />
      <FormError error={s.error} />
    </FormDialog>
  );
}

function Fees({ rows }: { rows: MethodFee[] }) {
  const [editing, setEditing] = useState<MethodFee | null>(null);
  const rv = useRevalidator();
  const all = PAYMENT_METHODS.map((m) => rows.find((r) => r.method === m) ?? null);
  return (
    <div className="space-y-3">
      <p className="text-xs text-muted">{adminT("catalog.pricing.fees_hint")}</p>
      <DataTable
        rows={PAYMENT_METHODS.map((m, i) => ({ method: m, fee: all[i] }))}
        rowKey={(r) => r.method}
        columns={[
          { key: "method", header: adminT("catalog.pricing.method"), primary: true, cell: (r) => enumLabel("method", r.method) },
          {
            key: "fee",
            header: adminT("catalog.pricing.fee"),
            cell: (r) => (r.fee ? (r.fee.fee_type === "PERCENTAGE" ? formatBasisPoints(r.fee.fee_value, "en") : formatIDR(r.fee.fee_value, "en")) : adminT("catalog.pricing.not_configured")),
          },
          { key: "hold", header: adminT("catalog.pricing.hold_minutes"), cell: (r) => (r.fee ? r.fee.hold_minutes : "—") },
          { key: "enabled", header: adminT("catalog.pricing.enabled"), cell: (r) => (r.fee?.enabled ? adminT("catalog.common.yes") : adminT("catalog.common.no")) },
          {
            key: "actions",
            header: adminT("catalog.common.actions"),
            cell: (r) => (
              <Button size="sm" variant="secondary" onClick={() => setEditing(r.fee ?? { method: r.method, fee_type: "FIXED", fee_value: 0, hold_minutes: 15, enabled: false, sort_order: 0 })}>
                {adminT("catalog.common.edit")}
              </Button>
            ),
          },
        ]}
      />
      {editing && <FeeDialog fee={editing} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), rv.revalidate())} />}
    </div>
  );
}

function FeeDialog({ fee, onClose, onSaved }: { fee: MethodFee; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    fee_type: fee.fee_type,
    fee_value: fee.fee_type === "PERCENTAGE" ? basisPointsToPercent(fee.fee_value) : String(fee.fee_value),
    hold_minutes: intText(fee.hold_minutes),
    enabled: fee.enabled,
    sort_order: intText(fee.sort_order),
  });
  const s = useSubmission();
  const done = useSaved(onSaved);
  const save = async () => {
    const r = new FieldReader();
    const dto = {
      method: fee.method,
      fee_type: form.fee_type,
      fee_value: form.fee_type === "PERCENTAGE" ? r.percent("fee_value", form.fee_value) : r.int("fee_value", form.fee_value),
      hold_minutes: r.int("hold_minutes", form.hold_minutes),
      enabled: form.enabled,
      sort_order: r.int("sort_order", form.sort_order),
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api(`/admin/payment-method-fees/${fee.method}`, { method: "PUT", body: dto, signal });
    });
    if (ok) done();
  };
  return (
    <FormDialog id="fee-form" size="md" title={enumLabel("method", fee.method)} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label={adminT("catalog.pricing.fee_type")} value={form.fee_type} onChange={(v) => setForm({ ...form, fee_type: v as MethodFee["fee_type"] })} options={enumOptions("amount_type", ["FIXED", "PERCENTAGE"])} error={s.field("fee_type")} />
        {form.fee_type === "PERCENTAGE" ? (
          <PercentField label={adminT("catalog.pricing.fee")} value={form.fee_value} onChange={(v) => setForm({ ...form, fee_value: v })} error={s.field("fee_value")} />
        ) : (
          <MoneyField label={adminT("catalog.pricing.fee")} value={form.fee_value} onChange={(v) => setForm({ ...form, fee_value: v })} error={s.field("fee_value")} />
        )}
        <NumberField label={adminT("catalog.pricing.hold_minutes")} value={form.hold_minutes} onChange={(v) => setForm({ ...form, hold_minutes: v })} error={s.field("hold_minutes")} hint={adminT("catalog.pricing.hold_hint")} />
        <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: v })} error={s.field("sort_order")} />
      </div>
      <Checkbox label={adminT("catalog.pricing.enabled")} checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
      {(fee.method === "CREDIT_CARD" || fee.method === "QRIS") && <Alert tone="warning">{adminT("catalog.pricing.surcharge_warning")}</Alert>}
      <FormError error={s.error} />
    </FormDialog>
  );
}

function Currency({ rate }: { rate: number }) {
  const [value, setValue] = useState(rate ? String(rate) : "");
  const s = useSubmission();
  const toast = useToast();
  const rv = useRevalidator();
  const save = async () => {
    const r = new FieldReader();
    const dto = { usd_rate_idr: r.int("usd_rate_idr", value) };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api("/admin/settings/currency", { method: "PUT", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      rv.revalidate();
    }
  };
  return (
    <Section title={adminT("catalog.pricing.currency")}>
      <form
        noValidate
        className="max-w-sm space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <MoneyField label={adminT("catalog.pricing.usd_rate")} required value={value} onChange={setValue} error={s.field("usd_rate_idr")} />
        <p className="text-xs text-muted">{adminT("catalog.pricing.usd_hint")}</p>
        <FormError error={s.error} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.common.save")}
        </Button>
      </form>
    </Section>
  );
}
