import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/boat";
import { Button, ButtonPair, Checkbox, DataTable, Dialog, EmptyState, useToast, type Column } from "~/components/ui";
import { loadRefs, named, settle, type Opt, type Refs } from "~/features/admin-catalog/data";
import { MediaPicker } from "~/features/admin-catalog/media";
import { areaDTO, areaForm, boatDTO, boatForm, type AreaForm, type BoatForm, type RateRow, type RouteRow } from "~/features/admin-catalog/mappers";
import { localesWithIssues, nameOf } from "~/features/admin-catalog/translations";
import type { AdminArea, AdminBoat, RateUnit } from "~/features/admin-catalog/types";
import {
  CheckboxGroup,
  DeleteAction,
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
  TextareaField,
  TranslationTabs,
  adminMeta,
  enumLabel,
  enumOptions,
  useSubmission,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { formatIDR } from "~/lib/format";
import { adminT } from "~/lib/i18n";

const RATE_UNITS: RateUnit[] = ["HOURLY", "DAILY", "FIXED"];
const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;
const REF_KEYS = ["categories", "classes", "partners", "ports", "regions", "routes", "facilities", "paymentPolicies", "cancellationPolicies"] as const;

export function meta() {
  return adminMeta("catalog.boats.edit_title");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const isNew = params.id === "new";
  const [boat, refs] = await Promise.all([
    isNew ? Promise.resolve(null) : settle(apiData<AdminBoat>(`/admin/boats/${params.id}`, { request })),
    settle(loadRefs(request, [...REF_KEYS])),
  ]);
  return { isNew, boat, refs };
}

type BoatRefs = Pick<Refs, (typeof REF_KEYS)[number]>;

export default function BoatPage({ loaderData }: Route.ComponentProps) {
  const { isNew, boat, refs } = loaderData;
  if (boat && !boat.ok) return <LoadFailed code={boat.code} />;
  if (!refs.ok) return <LoadFailed code={refs.code} />;
  const data = boat?.data ?? null;
  return (
    <div className="space-y-4">
      <PageHeader
        title={isNew ? adminT("catalog.boats.new") : nameOf(data?.translations) || data?.code || ""}
        back={{ to: "/admin/boats", label: adminT("catalog.boats.back") }}
        actions={data ? <BoatDelete id={data.id} /> : undefined}
      />
      <BoatEditor key={data?.id ?? "new"} boat={data} refs={refs.data} />
      {data && <AreasEditor boat={data} facilities={named(refs.data.facilities)} />}
    </div>
  );
}

function BoatDelete({ id }: { id: string }) {
  const navigate = useNavigate();
  return (
    <DeleteAction
      title={adminT("catalog.boats.delete_title")}
      body={adminT("catalog.boats.delete_body")}
      onDelete={async (signal) => {
        await api(`/admin/boats/${id}`, { method: "DELETE", signal });
        navigate("/admin/boats", { replace: true });
      }}
    />
  );
}

function policyOptions(list: { id: string; name: string; status: string }[]): Opt[] {
  return list.map((p) => ({ value: p.id, label: p.status === "ARCHIVED" ? `${p.name} (${enumLabel("status", "ARCHIVED")})` : p.name }));
}

function BoatEditor({ boat, refs }: { boat: AdminBoat | null; refs: BoatRefs }) {
  const [form, setForm] = useState<BoatForm>(() => boatForm(boat));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const navigate = useNavigate();
  const rv = useRevalidator();
  const set = (patch: Partial<BoatForm>) => setForm((f) => ({ ...f, ...patch }));
  const tr = form.translations[locale];
  const setTr = (patch: Partial<typeof tr>) => set({ translations: { ...form.translations, [locale]: { ...tr, ...patch } } });
  const setRate = (i: number, patch: Partial<RateRow>) => set({ rates: form.rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const setRoute = (i: number, patch: Partial<RouteRow>) => set({ routes: form.routes.map((r, j) => (j === i ? { ...r, ...patch } : r)) });
  const f = (path: string) => s.field(path);
  const tp = `translations.${locale}`;
  const unusedUnit = RATE_UNITS.find((u) => !form.rates.some((r) => r.rate_unit === u));
  const routeOpts = named(refs.routes);

  const save = async () => {
    const { dto, errors } = boatDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    await s.run(async (signal) => {
      const saved = await apiData<AdminBoat>(boat ? `/admin/boats/${boat.id}` : "/admin/boats", { method: boat ? "PUT" : "POST", body: dto, signal });
      toast(adminT("catalog.common.saved"));
      if (!boat) navigate(`/admin/boats/${saved.id}`, { replace: true });
      else {
        setForm(boatForm(saved));
        rv.revalidate();
      }
    });
  };

  return (
    <form
      noValidate
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <Section title={adminT("catalog.boats.section_basics")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <TextField label={adminT("catalog.fields.code")} required value={form.code} onChange={(v) => set({ code: v.toUpperCase() })} error={f("code")} hint={adminT("catalog.boats.code_hint")} maxLength={20} />
          <SelectField label={adminT("catalog.boats.category")} required value={form.category_id} onChange={(v) => set({ category_id: v })} options={named(refs.categories)} placeholder="" error={f("category_id")} />
          <SelectField label={adminT("catalog.boats.class")} required value={form.class_id} onChange={(v) => set({ class_id: v })} options={named(refs.classes)} placeholder="" error={f("class_id")} />
          <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as BoatForm["status"] })} options={enumOptions("status", STATUSES)} error={f("status")} />
          <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => set({ sort_order: v })} error={f("sort_order")} />
        </div>
      </Section>

      <Section title={adminT("catalog.boats.section_ownership")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label={adminT("catalog.boats.ownership")} value={form.ownership} onChange={(v) => set({ ownership: v as BoatForm["ownership"] })} options={enumOptions("ownership", ["OWNED", "PARTNER"])} error={f("ownership")} />
          {form.ownership === "PARTNER" && (
            <>
              <SelectField label={adminT("catalog.boats.partner")} required value={form.partner_id} onChange={(v) => set({ partner_id: v })} options={refs.partners.map((p) => ({ value: p.id, label: p.name }))} placeholder="" error={f("partner_id")} />
              <SelectField label={adminT("catalog.boats.commission_type")} value={form.commission_type} onChange={(v) => set({ commission_type: v as BoatForm["commission_type"] })} options={enumOptions("amount_type", ["PERCENTAGE", "FIXED"])} error={f("commission_type")} />
              {form.commission_type === "PERCENTAGE" ? (
                <PercentField label={adminT("catalog.boats.commission_percent")} required value={form.commission_value} onChange={(v) => set({ commission_value: v })} error={f("commission_value")} />
              ) : (
                <MoneyField label={adminT("catalog.boats.commission_fixed")} required value={form.commission_value} onChange={(v) => set({ commission_value: v })} error={f("commission_value")} />
              )}
            </>
          )}
        </div>
      </Section>

      <Section title={adminT("catalog.boats.section_specs")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label={adminT("catalog.boats.home_port")} required value={form.home_port_id} onChange={(v) => set({ home_port_id: v })} options={named(refs.ports)} placeholder="" error={f("home_port_id")} />
          <NumberField label={adminT("catalog.boats.max_passengers")} required value={form.max_passengers} onChange={(v) => set({ max_passengers: v })} error={f("max_passengers")} hint={adminT("catalog.boats.max_passengers_hint")} />
          <NumberField label={adminT("catalog.boats.length_cm")} value={form.length_cm} onChange={(v) => set({ length_cm: v })} error={f("length_cm")} />
          <NumberField label={adminT("catalog.boats.beam_cm")} value={form.beam_cm} onChange={(v) => set({ beam_cm: v })} error={f("beam_cm")} />
          <NumberField label={adminT("catalog.boats.year_built")} value={form.year_built} onChange={(v) => set({ year_built: v })} error={f("year_built")} />
          <NumberField label={adminT("catalog.boats.cabins")} value={form.cabins} onChange={(v) => set({ cabins: v })} error={f("cabins")} />
          <NumberField label={adminT("catalog.boats.bathrooms")} value={form.bathrooms} onChange={(v) => set({ bathrooms: v })} error={f("bathrooms")} />
          <NumberField label={adminT("catalog.boats.speed_knots")} value={form.speed_knots} onChange={(v) => set({ speed_knots: v })} error={f("speed_knots")} />
          <NumberField label={adminT("catalog.boats.crew_count")} value={form.crew_count} onChange={(v) => set({ crew_count: v })} error={f("crew_count")} />
        </div>
      </Section>

      <Section title={adminT("catalog.boats.section_operations")}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <NumberField label={adminT("catalog.boats.turnaround")} value={form.turnaround_buffer_minutes} onChange={(v) => set({ turnaround_buffer_minutes: v })} error={f("turnaround_buffer_minutes")} hint={adminT("catalog.boats.turnaround_hint")} />
          <TextField label={adminT("catalog.boats.operating_start")} placeholder="07:00" value={form.operating_start} onChange={(v) => set({ operating_start: v })} error={f("operating_start_minute")} hint={adminT("catalog.common.clock_hint")} />
          <TextField label={adminT("catalog.boats.operating_end")} placeholder="19:00" value={form.operating_end} onChange={(v) => set({ operating_end: v })} error={f("operating_end_minute")} hint={adminT("catalog.common.clock_hint")} />
          <Checkbox className="self-center" label={adminT("catalog.boats.overnight")} checked={form.overnight_allowed} onChange={(e) => set({ overnight_allowed: e.target.checked })} />
          <SelectField label={adminT("catalog.fields.payment_policy")} required value={form.payment_policy_id} onChange={(v) => set({ payment_policy_id: v })} options={policyOptions(refs.paymentPolicies)} placeholder="" error={f("payment_policy_id")} />
          <SelectField label={adminT("catalog.fields.cancellation_policy")} required value={form.cancellation_policy_id} onChange={(v) => set({ cancellation_policy_id: v })} options={policyOptions(refs.cancellationPolicies)} placeholder="" error={f("cancellation_policy_id")} />
        </div>
      </Section>

      <Section title={adminT("catalog.common.translations")}>
        <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(form.translations, ["name"], s.codes)} />
        <p className="text-xs text-muted">{adminT("catalog.common.translations_hint")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={tr.name} onChange={(v) => setTr({ name: v })} error={f(`${tp}.name`) ?? s.field(tp)} maxLength={160} />
          <TextField label={adminT("catalog.fields.slug")} value={tr.slug} onChange={(v) => setTr({ slug: v })} error={f(`${tp}.slug`)} hint={adminT("catalog.common.slug_hint")} />
        </div>
        <TextareaField label={adminT("catalog.fields.summary")} value={tr.summary} onChange={(v) => setTr({ summary: v })} error={f(`${tp}.summary`)} maxLength={500} />
        <TextareaField label={adminT("catalog.fields.description")} rows={6} value={tr.description} onChange={(v) => setTr({ description: v })} error={f(`${tp}.description`)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={adminT("catalog.fields.seo_title")} value={tr.seo_title} onChange={(v) => setTr({ seo_title: v })} error={f(`${tp}.seo_title`)} maxLength={70} />
          <TextField label={adminT("catalog.fields.seo_description")} value={tr.seo_description} onChange={(v) => setTr({ seo_description: v })} error={f(`${tp}.seo_description`)} maxLength={170} />
        </div>
      </Section>

      <Section
        title={adminT("catalog.boats.section_rates")}
        actions={
          unusedUnit && (
            <Button size="sm" variant="secondary" onClick={() => set({ rates: [...form.rates, { rate_unit: unusedUnit, price: "", min_units: "1", max_units: "1" }] })}>
              {adminT("catalog.boats.add_rate")}
            </Button>
          )
        }
      >
        {s.field("rates") && <p className="text-sm text-danger">{s.field("rates")}</p>}
        {form.rates.length === 0 ? (
          <p className="text-sm text-muted">{adminT("catalog.boats.no_rates")}</p>
        ) : (
          <ul className="space-y-3">
            {form.rates.map((r, i) => (
              <li key={i} className="grid items-end gap-3 border-b border-border pb-3 sm:grid-cols-5">
                <SelectField label={adminT("catalog.boats.rate_unit")} value={r.rate_unit} onChange={(v) => setRate(i, { rate_unit: v as RateUnit })} options={enumOptions("rate_unit", RATE_UNITS)} error={f(`rates.${i}.rate_unit`)} />
                <MoneyField label={adminT("catalog.fields.price")} required value={r.price} onChange={(v) => setRate(i, { price: v })} error={f(`rates.${i}.price`)} />
                <NumberField label={adminT("catalog.boats.min_units")} value={r.min_units} onChange={(v) => setRate(i, { min_units: v })} error={f(`rates.${i}.min_units`)} hint={enumLabel("rate_unit_hint", r.rate_unit)} />
                <NumberField label={adminT("catalog.boats.max_units")} value={r.max_units} onChange={(v) => setRate(i, { max_units: v })} error={f(`rates.${i}.max_units`)} />
                <Button variant="secondary" onClick={() => set({ rates: form.rates.filter((_, j) => j !== i) })}>
                  {adminT("catalog.common.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section
        title={adminT("catalog.boats.section_routes")}
        actions={
          <Button size="sm" variant="secondary" onClick={() => set({ routes: [...form.routes, { route_id: "", fixed_price: "", min_duration_minutes: "" }] })}>
            {adminT("catalog.boats.add_route")}
          </Button>
        }
      >
        {s.field("routes") && <p className="text-sm text-danger">{s.field("routes")}</p>}
        {form.routes.length === 0 ? (
          <p className="text-sm text-muted">{adminT("catalog.boats.no_routes")}</p>
        ) : (
          <ul className="space-y-3">
            {form.routes.map((r, i) => (
              <li key={i} className="grid items-end gap-3 border-b border-border pb-3 sm:grid-cols-4">
                <SelectField label={adminT("catalog.fields.route")} required value={r.route_id} onChange={(v) => setRoute(i, { route_id: v })} options={routeOpts} placeholder="" error={f(`routes.${i}.route_id`)} />
                <MoneyField label={adminT("catalog.boats.fixed_price")} value={r.fixed_price} onChange={(v) => setRoute(i, { fixed_price: v })} error={f(`routes.${i}.fixed_price`)} hint={adminT("catalog.common.optional")} />
                <NumberField label={adminT("catalog.boats.min_duration")} value={r.min_duration_minutes} onChange={(v) => setRoute(i, { min_duration_minutes: v })} error={f(`routes.${i}.min_duration_minutes`)} hint={adminT("catalog.common.minutes_optional")} />
                <Button variant="secondary" onClick={() => set({ routes: form.routes.filter((_, j) => j !== i) })}>
                  {adminT("catalog.common.remove")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={adminT("catalog.boats.section_regions_facilities")}>
        <CheckboxGroup legend={adminT("catalog.boats.regions")} options={named(refs.regions)} value={form.region_ids} onChange={(v) => set({ region_ids: v })} error={f("region_ids")} />
        <CheckboxGroup legend={adminT("catalog.boats.facilities")} options={named(refs.facilities)} value={form.facility_ids} onChange={(v) => set({ facility_ids: v })} error={f("facility_ids")} />
      </Section>

      <Section title={adminT("catalog.common.media")}>
        <MediaPicker label={adminT("catalog.common.thumbnail")} value={form.thumbnail} onChange={(v) => set({ thumbnail: v })} slug={form.translations.en.slug || form.translations.en.name} error={f("thumbnail_id")} />
        <MediaPicker multiple label={adminT("catalog.common.gallery")} value={form.gallery} onChange={(v) => set({ gallery: v })} slug={form.translations.en.slug || form.translations.en.name} error={f("gallery_ids")} />
      </Section>

      <FormError error={s.error} />
      <Button type="submit" pending={s.pending}>
        {boat ? adminT("catalog.common.save") : adminT("catalog.boats.create")}
      </Button>
    </form>
  );
}

function AreasEditor({ boat, facilities }: { boat: AdminBoat; facilities: Opt[] }) {
  const [editing, setEditing] = useState<AdminArea | "new" | null>(null);
  const rv = useRevalidator();
  const areas = boat.areas.filter((a) => !a.is_system);
  const columns: Column<AdminArea>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (a) => nameOf(a.translations) },
    { key: "deck", header: adminT("catalog.areas.deck_label"), cell: (a) => a.deck_label || "—" },
    { key: "pax", header: adminT("catalog.areas.pax"), cell: (a) => `${a.min_pax}–${a.max_pax}` },
    { key: "price", header: adminT("catalog.areas.base_price"), cell: (a) => formatIDR(a.base_price, "en") },
    { key: "status", header: adminT("catalog.fields.status"), cell: (a) => <StatusPill status={a.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (a) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
            {adminT("catalog.common.edit")}
          </Button>
          <DeleteAction
            size="sm"
            title={adminT("catalog.areas.delete_title")}
            body={adminT("catalog.areas.delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/boats/${boat.id}/areas/${a.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <Section
      title={adminT("catalog.areas.title")}
      actions={
        <Button size="sm" variant="secondary" onClick={() => setEditing("new")}>
          {adminT("catalog.areas.new")}
        </Button>
      }
    >
      <p className="text-xs text-muted">{adminT("catalog.areas.hint")}</p>
      {areas.length === 0 ? <EmptyState title={adminT("catalog.areas.empty")} /> : <DataTable rows={areas} columns={columns} rowKey={(a) => a.id} />}
      {editing && (
        <AreaDialog
          boat={boat}
          area={editing === "new" ? null : editing}
          facilities={facilities}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            rv.revalidate();
          }}
        />
      )}
    </Section>
  );
}

function AreaDialog({ boat, area, facilities, onClose, onSaved }: { boat: AdminBoat; area: AdminArea | null; facilities: Opt[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<AreaForm>(() => areaForm(area));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const set = (patch: Partial<AreaForm>) => setForm((x) => ({ ...x, ...patch }));
  const tr = form.translations[locale];
  const tp = `translations.${locale}`;
  const save = async () => {
    const { dto, errors } = areaDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    const ok = await s.run(async (signal) => {
      await api(area ? `/admin/boats/${boat.id}/areas/${area.id}` : `/admin/boats/${boat.id}/areas`, { method: area ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title={area ? adminT("catalog.areas.edit") : adminT("catalog.areas.new")}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            {adminT("catalog.common.cancel")}
          </Button>
          <Button type="submit" form="area-form" pending={s.pending}>
            {adminT("catalog.common.save")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="area-form"
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={adminT("catalog.areas.deck_label")} value={form.deck_label} maxLength={40} onChange={(v) => set({ deck_label: v })} error={s.field("deck_label")} />
          <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as AreaForm["status"] })} options={enumOptions("status", ["ACTIVE", "INACTIVE"])} error={s.field("status")} />
          <NumberField label={adminT("catalog.areas.min_pax")} required value={form.min_pax} onChange={(v) => set({ min_pax: v })} error={s.field("min_pax")} hint={adminT("catalog.areas.min_pax_hint")} />
          <NumberField label={adminT("catalog.areas.max_pax")} required value={form.max_pax} onChange={(v) => set({ max_pax: v })} error={s.field("max_pax")} hint={adminT("catalog.areas.max_pax_hint", { max: boat.max_passengers })} />
          <MoneyField label={adminT("catalog.areas.base_price")} required value={form.base_price} onChange={(v) => set({ base_price: v })} error={s.field("base_price")} />
          <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => set({ sort_order: v })} error={s.field("sort_order")} />
        </div>
        <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(form.translations, ["name"], s.codes)} />
        <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={tr.name} onChange={(v) => set({ translations: { ...form.translations, [locale]: { ...tr, name: v } } })} error={s.field(`${tp}.name`)} />
        <TextareaField label={adminT("catalog.fields.description")} value={tr.description} onChange={(v) => set({ translations: { ...form.translations, [locale]: { ...tr, description: v } } })} error={s.field(`${tp}.description`)} />
        <CheckboxGroup legend={adminT("catalog.boats.facilities")} options={facilities} value={form.facility_ids} onChange={(v) => set({ facility_ids: v })} />
        <MediaPicker multiple label={adminT("catalog.common.gallery")} value={form.gallery} onChange={(v) => set({ gallery: v })} slug={form.translations.en.name} error={s.field("gallery_ids")} />
        <FormError error={s.error} />
      </form>
    </Dialog>
  );
}

