import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/package";
import { Button, useToast } from "~/components/ui";
import { boatOptions, loadRefs, named, settle, type Refs } from "~/features/admin-catalog/data";
import { packageDTO, packageForm, type OfferingRow, type PackageForm } from "~/features/admin-catalog/mappers";
import { MediaPicker } from "~/features/admin-catalog/media";
import { localesWithIssues, nameOf } from "~/features/admin-catalog/translations";
import type { AdminPackage, ContentStatus } from "~/features/admin-catalog/types";
import {
  DeleteAction,
  FormError,
  LoadFailed,
  MoneyField,
  NumberField,
  PageHeader,
  Section,
  SelectField,
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
import { formatDateTime, formatDuration, formatIDR } from "~/lib/format";
import { adminT } from "~/lib/i18n";
import type { Departure } from "~/lib/types";

const REF_KEYS = ["routes", "boats", "paymentPolicies", "cancellationPolicies"] as const;

export function meta() {
  return adminMeta("catalog.packages.edit_title");
}

async function loadDepartures(request: Request, current: string | null): Promise<Departure[]> {
  const upcoming = await apiData<Departure[]>("/admin/departures", { request, query: { from: new Date().toISOString(), per_page: 200 } });
  if (current && !upcoming.some((d) => d.id === current)) {
    const d = await apiData<Departure>(`/admin/departures/${current}`, { request });
    return [d, ...upcoming];
  }
  return upcoming;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const pkg = params.id === "new" ? null : await settle(apiData<AdminPackage>(`/admin/packages/${params.id}`, { request }));
  const current = pkg && pkg.ok ? pkg.data.departure_id : null;
  const [refs, departures] = await Promise.all([settle(loadRefs(request, [...REF_KEYS])), settle(loadDepartures(request, current))]);
  return { pkg, refs, departures };
}

export default function PackagePage({ loaderData }: Route.ComponentProps) {
  const { pkg, refs, departures } = loaderData;
  if (pkg && !pkg.ok) return <LoadFailed code={pkg.code} />;
  if (!refs.ok) return <LoadFailed code={refs.code} />;
  if (!departures.ok) return <LoadFailed code={departures.code} />;
  const data = pkg?.data ?? null;
  return <PackageEditor key={data?.id ?? "new"} pkg={data} refs={refs.data} departures={departures.data} />;
}

function departureLabel(d: Departure) {
  return `${formatDateTime(d.departs_at, d.timezone, "en")} · ${d.boat_name} · ${d.route_name}`;
}

function PackageEditor({ pkg, refs, departures }: { pkg: AdminPackage | null; refs: Pick<Refs, (typeof REF_KEYS)[number]>; departures: Departure[] }) {
  const [form, setForm] = useState<PackageForm>(() => packageForm(pkg));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const navigate = useNavigate();
  const rv = useRevalidator();
  const set = (patch: Partial<PackageForm>) => setForm((f) => ({ ...f, ...patch }));
  const tr = form.translations[locale];
  const tp = `translations.${locale}`;
  const setTr = (patch: Partial<typeof tr>) => set({ translations: { ...form.translations, [locale]: { ...tr, ...patch } } });
  const setOffering = (i: number, patch: Partial<OfferingRow>) => set({ offerings: form.offerings.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const departure = departures.find((d) => d.id === form.departure_id) ?? null;
  const charter = form.mode === "PRIVATE_CHARTER";
  const boats = boatOptions(refs.boats);
  const duration = Number(form.duration_minutes);
  const slotOptions = (departure?.slots ?? []).map((sl) => ({
    value: sl.id,
    label: `${enumLabel("slot_type", sl.slot_type)} · ${sl.area_names.join(", ")} · ${formatIDR(sl.price, "en")}`,
  }));

  const chooseDeparture = (id: string) => {
    const d = departures.find((x) => x.id === id);
    set({ departure_id: id, offerings: form.offerings.map((o) => ({ ...o, boat_id: d?.boat_id ?? "", departure_slot_id: "" })) });
  };
  const addOffering = () =>
    set({ offerings: [...form.offerings, { key: crypto.randomUUID(), id: null, boat_id: charter ? "" : (departure?.boat_id ?? ""), departure_slot_id: "", price: "" }] });

  const save = async () => {
    const { dto, errors } = packageDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    await s.run(async (signal) => {
      const res = await apiData<{ id: string }>(pkg ? `/admin/packages/${pkg.id}` : "/admin/packages", { method: pkg ? "PUT" : "POST", body: dto, signal });
      toast(adminT("catalog.common.saved"));
      if (!pkg) navigate(`/admin/packages/${res.id}`, { replace: true });
      else rv.revalidate();
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={pkg ? nameOf(pkg.translations) : adminT("catalog.packages.new")}
        back={{ to: "/admin/packages", label: adminT("catalog.packages.back") }}
        actions={
          pkg && (
            <DeleteAction
              title={adminT("catalog.common.delete_title", { item: adminT("catalog.packages.noun") })}
              body={adminT("catalog.packages.delete_body")}
              onDelete={async (signal) => {
                await api(`/admin/packages/${pkg.id}`, { method: "DELETE", signal });
                navigate("/admin/packages", { replace: true });
              }}
            />
          )
        }
      />
      <form
        noValidate
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Section title={adminT("catalog.packages.section_product")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField
              label={adminT("catalog.packages.mode")}
              value={form.mode}
              onChange={(v) => set({ mode: v as PackageForm["mode"], offerings: form.offerings.map((o) => ({ ...o, departure_slot_id: "" })) })}
              options={enumOptions("mode", ["PRIVATE_CHARTER", "DEPARTURE"])}
              error={s.field("mode")}
            />
            {charter ? (
              <>
                <SelectField label={adminT("catalog.fields.route")} required value={form.route_id} onChange={(v) => set({ route_id: v })} options={named(refs.routes)} placeholder="" error={s.field("route_id")} />
                <NumberField
                  label={adminT("catalog.packages.duration_minutes")}
                  required
                  value={form.duration_minutes}
                  onChange={(v) => set({ duration_minutes: v })}
                  error={s.field("duration_minutes")}
                  hint={Number.isInteger(duration) && duration > 0 ? formatDuration(duration, "en") : undefined}
                />
              </>
            ) : (
              <SelectField
                className="lg:col-span-2"
                label={adminT("catalog.packages.departure")}
                required
                value={form.departure_id}
                onChange={chooseDeparture}
                options={departures.map((d) => ({ value: d.id, label: departureLabel(d) }))}
                placeholder=""
                error={s.field("departure_id")}
                hint={departures.length === 0 ? adminT("catalog.packages.no_departures") : undefined}
              />
            )}
          </div>
        </Section>

        <Section title={adminT("catalog.packages.section_rules")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <TextField type="date" label={adminT("catalog.packages.valid_from")} required value={form.valid_from} onChange={(v) => set({ valid_from: v })} error={s.field("valid_from")} />
            <TextField type="date" label={adminT("catalog.packages.valid_until")} required value={form.valid_until} onChange={(v) => set({ valid_until: v })} error={s.field("valid_until")} />
            <NumberField label={adminT("catalog.packages.cutoff_hours")} value={form.booking_cutoff_hours} onChange={(v) => set({ booking_cutoff_hours: v })} error={s.field("booking_cutoff_hours")} hint={adminT("catalog.packages.cutoff_hint")} />
            <NumberField label={adminT("catalog.packages.min_pax")} required value={form.min_pax} onChange={(v) => set({ min_pax: v })} error={s.field("min_pax")} />
            <NumberField label={adminT("catalog.packages.max_pax")} required value={form.max_pax} onChange={(v) => set({ max_pax: v })} error={s.field("max_pax")} />
            <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as ContentStatus })} options={enumOptions("status", ["DRAFT", "PUBLISHED", "ARCHIVED"])} error={s.field("status")} />
            <SelectField label={adminT("catalog.fields.payment_policy")} required value={form.payment_policy_id} onChange={(v) => set({ payment_policy_id: v })} options={refs.paymentPolicies.map((p) => ({ value: p.id, label: p.name }))} placeholder="" error={s.field("payment_policy_id")} />
            <SelectField label={adminT("catalog.fields.cancellation_policy")} required value={form.cancellation_policy_id} onChange={(v) => set({ cancellation_policy_id: v })} options={refs.cancellationPolicies.map((p) => ({ value: p.id, label: p.name }))} placeholder="" error={s.field("cancellation_policy_id")} />
            <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => set({ sort_order: v })} error={s.field("sort_order")} />
          </div>
        </Section>

        <Section
          title={adminT("catalog.packages.offerings")}
          actions={
            <Button size="sm" variant="secondary" onClick={addOffering} disabled={!charter && !departure}>
              {adminT("catalog.packages.add_offering")}
            </Button>
          }
        >
          <p className="text-xs text-muted">{charter ? adminT("catalog.packages.offerings_hint_charter") : adminT("catalog.packages.offerings_hint_departure")}</p>
          {s.field("offerings") && <p className="text-sm text-danger">{s.field("offerings")}</p>}
          {form.offerings.length === 0 ? (
            <p className="text-sm text-muted">{adminT("catalog.packages.no_offerings")}</p>
          ) : (
            <ul className="space-y-3">
              {form.offerings.map((o, i) => (
                <li key={o.key} className="grid items-end gap-3 border-b border-border pb-3 sm:grid-cols-4">
                  {charter ? (
                    <SelectField label={adminT("catalog.fields.boat")} required value={o.boat_id} onChange={(v) => setOffering(i, { boat_id: v })} options={boats} placeholder="" error={s.field(`offerings.${i}.boat_id`) ?? s.field(`offerings.${i}`)} />
                  ) : (
                    <SelectField
                      label={adminT("catalog.packages.slot")}
                      required
                      value={o.departure_slot_id}
                      onChange={(v) => setOffering(i, { departure_slot_id: v, boat_id: departure?.boat_id ?? o.boat_id })}
                      options={slotOptions}
                      placeholder=""
                      error={s.field(`offerings.${i}.departure_slot_id`) ?? s.field(`offerings.${i}`)}
                    />
                  )}
                  <MoneyField
                    label={adminT("catalog.packages.all_in_price")}
                    required
                    value={o.price}
                    onChange={(v) => setOffering(i, { price: v })}
                    error={s.field(`offerings.${i}.price`)}
                    hint={charter ? adminT("catalog.packages.price_per_trip") : adminT("catalog.packages.price_per_slot")}
                  />
                  <Button variant="ghost" onClick={() => set({ offerings: form.offerings.filter((_, j) => j !== i) })}>
                    {adminT("catalog.common.remove")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title={adminT("catalog.common.translations")}>
          <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(form.translations, ["name"], s.codes)} />
          {s.field(tp) && <p className="text-sm text-danger">{s.field(tp)}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={tr.name} onChange={(v) => setTr({ name: v })} error={s.field(`${tp}.name`)} />
            <TextField label={adminT("catalog.fields.slug")} hint={adminT("catalog.common.slug_hint")} value={tr.slug} onChange={(v) => setTr({ slug: v })} error={s.field(`${tp}.slug`)} />
          </div>
          <TextareaField label={adminT("catalog.fields.summary")} maxLength={500} value={tr.summary} onChange={(v) => setTr({ summary: v })} error={s.field(`${tp}.summary`)} />
          <TextareaField label={adminT("catalog.fields.description")} rows={6} value={tr.description} onChange={(v) => setTr({ description: v })} error={s.field(`${tp}.description`)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextareaField label={adminT("catalog.packages.inclusions")} hint={adminT("catalog.common.one_per_line")} value={tr.inclusions} onChange={(v) => setTr({ inclusions: v })} />
            <TextareaField label={adminT("catalog.packages.exclusions")} hint={adminT("catalog.common.one_per_line")} value={tr.exclusions} onChange={(v) => setTr({ exclusions: v })} />
            <TextField label={adminT("catalog.fields.seo_title")} maxLength={70} value={tr.seo_title} onChange={(v) => setTr({ seo_title: v })} error={s.field(`${tp}.seo_title`)} />
            <TextField label={adminT("catalog.fields.seo_description")} maxLength={170} value={tr.seo_description} onChange={(v) => setTr({ seo_description: v })} error={s.field(`${tp}.seo_description`)} />
          </div>
        </Section>

        <Section title={adminT("catalog.common.media")}>
          <MediaPicker label={adminT("catalog.common.thumbnail")} value={form.thumbnail} onChange={(v) => set({ thumbnail: v })} slug={form.translations.en.slug || form.translations.en.name} error={s.field("thumbnail_id")} />
          <MediaPicker multiple label={adminT("catalog.common.gallery")} value={form.gallery} onChange={(v) => set({ gallery: v })} slug={form.translations.en.slug || form.translations.en.name} error={s.field("gallery_ids")} />
        </Section>

        <FormError error={s.error} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.common.save")}
        </Button>
      </form>
    </div>
  );
}
