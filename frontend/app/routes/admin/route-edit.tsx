import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/route-edit";
import { Button, Tabs, useToast } from "~/components/ui";
import { labelOf, loadRefs, named, settle, type Refs } from "~/features/admin-catalog/data";
import { routeDTO, routeForm, type RouteForm, type StopRow } from "~/features/admin-catalog/mappers";
import { MediaPicker } from "~/features/admin-catalog/media";
import { localesWithIssues, localized, nameOf } from "~/features/admin-catalog/translations";
import type { AdminRoute, ContentStatus } from "~/features/admin-catalog/types";
import {
  DeleteAction,
  FormError,
  LoadFailed,
  NumberField,
  PageHeader,
  Section,
  SelectField,
  TextField,
  TextareaField,
  TranslationTabs,
  adminMeta,
  enumOptions,
  localeLabel,
  useSubmission,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";
import { formatDuration, zoneLabel } from "~/lib/format";
import { adminT } from "~/lib/i18n";

export function meta() {
  return adminMeta("catalog.routes.edit_title");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const [route, refs] = await Promise.all([
    params.id === "new" ? Promise.resolve(null) : settle(apiData<AdminRoute>(`/admin/routes/${params.id}`, { request })),
    settle(loadRefs(request, ["regions", "ports"])),
  ]);
  return { route, refs };
}

export default function RouteEdit({ loaderData }: Route.ComponentProps) {
  const { route, refs } = loaderData;
  if (route && !route.ok) return <LoadFailed code={route.code} />;
  if (!refs.ok) return <LoadFailed code={refs.code} />;
  const data = route?.data ?? null;
  return <RouteEditor key={data?.id ?? "new"} route={data} refs={refs.data} />;
}

function RouteEditor({ route, refs }: { route: AdminRoute | null; refs: Pick<Refs, "regions" | "ports"> }) {
  const [form, setForm] = useState<RouteForm>(() => routeForm(route));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [stopLocale, setStopLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const navigate = useNavigate();
  const rv = useRevalidator();
  const set = (patch: Partial<RouteForm>) => setForm((f) => ({ ...f, ...patch }));
  const tr = form.translations[locale];
  const tp = `translations.${locale}`;
  const setTr = (patch: Partial<typeof tr>) => set({ translations: { ...form.translations, [locale]: { ...tr, ...patch } } });
  const regionPorts = refs.ports.filter((p) => !form.region_id || p.region_id === form.region_id);
  const portTz = refs.ports.find((p) => p.id === form.departure_port_id)?.timezone;
  const setStop = (i: number, patch: Partial<StopRow>) => set({ stops: form.stops.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const moveStop = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= form.stops.length) return;
    const next = form.stops.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ stops: next });
  };
  const minutes = Number(form.duration_minutes);

  const save = async () => {
    const { dto, errors } = routeDTO(form);
    if (Object.keys(errors).length) return s.invalid(errors);
    await s.run(async (signal) => {
      const res = await apiData<{ id: string }>(route ? `/admin/routes/${route.id}` : "/admin/routes", { method: route ? "PUT" : "POST", body: dto, signal });
      toast(adminT("catalog.common.saved"));
      if (!route) navigate(`/admin/routes/${res.id}`, { replace: true });
      else rv.revalidate();
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={route ? nameOf(route.translations) : adminT("catalog.routes.new")}
        back={{ to: "/admin/locations?tab=routes", label: adminT("catalog.locations.back") }}
        actions={
          route && (
            <DeleteAction
              title={adminT("catalog.common.delete_title", { item: adminT("catalog.routes.noun") })}
              body={adminT("catalog.common.delete_body")}
              onDelete={async (signal) => {
                await api(`/admin/routes/${route.id}`, { method: "DELETE", signal });
                navigate("/admin/locations?tab=routes", { replace: true });
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
        <Section title={adminT("catalog.common.general")}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <SelectField label={adminT("catalog.fields.region")} required value={form.region_id} onChange={(v) => set({ region_id: v })} options={named(refs.regions)} placeholder="" error={s.field("region_id")} />
            <SelectField
              label={adminT("catalog.routes.departure_port")}
              required
              value={form.departure_port_id}
              onChange={(v) => set({ departure_port_id: v })}
              options={named(regionPorts)}
              placeholder=""
              error={s.field("departure_port_id")}
              hint={portTz ? adminT("catalog.routes.timezone_hint", { tz: `${portTz} (${zoneLabel(portTz)})` }) : undefined}
            />
            <SelectField label={adminT("catalog.routes.return_port")} required value={form.return_port_id} onChange={(v) => set({ return_port_id: v })} options={named(refs.ports)} placeholder="" error={s.field("return_port_id")} />
            <NumberField
              label={adminT("catalog.routes.duration_minutes")}
              required
              value={form.duration_minutes}
              onChange={(v) => set({ duration_minutes: v })}
              error={s.field("duration_minutes")}
              hint={Number.isInteger(minutes) && minutes > 0 ? formatDuration(minutes, "en") : undefined}
            />
            <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => set({ status: v as ContentStatus })} options={enumOptions("status", ["DRAFT", "PUBLISHED", "ARCHIVED"])} error={s.field("status")} />
          </div>
          {form.region_id && form.departure_port_id && !regionPorts.some((p) => p.id === form.departure_port_id) && (
            <p className="text-sm text-danger">{adminT("catalog.routes.port_region_mismatch", { port: labelOf(named(refs.ports), form.departure_port_id) })}</p>
          )}
        </Section>

        <Section title={adminT("catalog.common.translations")}>
          <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(form.translations, ["name"], s.codes)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={tr.name} onChange={(v) => setTr({ name: v })} error={s.field(`${tp}.name`) ?? s.field(tp)} />
            <TextField label={adminT("catalog.fields.slug")} hint={adminT("catalog.common.slug_hint")} value={tr.slug} onChange={(v) => setTr({ slug: v })} error={s.field(`${tp}.slug`)} />
          </div>
          <TextareaField label={adminT("catalog.fields.description")} rows={6} value={tr.description} onChange={(v) => setTr({ description: v })} error={s.field(`${tp}.description`)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={adminT("catalog.fields.seo_title")} maxLength={70} value={tr.seo_title} onChange={(v) => setTr({ seo_title: v })} error={s.field(`${tp}.seo_title`)} />
            <TextField label={adminT("catalog.fields.seo_description")} maxLength={170} value={tr.seo_description} onChange={(v) => setTr({ seo_description: v })} error={s.field(`${tp}.seo_description`)} />
          </div>
        </Section>

        <Section
          title={adminT("catalog.routes.stops")}
          actions={
            <Button
              size="sm"
              variant="secondary"
              onClick={() => set({ stops: [...form.stops, { key: crypto.randomUUID(), latitude: "", longitude: "", translations: localized(() => ({ name: "", activity: "" })) }] })}
            >
              {adminT("catalog.routes.add_stop")}
            </Button>
          }
        >
          {s.field("stops") && <p className="text-sm text-danger">{s.field("stops")}</p>}
          {form.stops.length === 0 ? (
            <p className="text-sm text-muted">{adminT("catalog.routes.no_stops")}</p>
          ) : (
            <>
              <Tabs
                active={stopLocale}
                onChange={(l) => setStopLocale(l as Locale)}
                tabs={LOCALES.map((l) => ({
                  id: l,
                  label: form.stops.some((st) => !st.translations[l].name.trim()) ? adminT("catalog.common.locale_incomplete", { locale: localeLabel(l) }) : localeLabel(l),
                }))}
              />
              <ol className="space-y-3">
                {form.stops.map((st, i) => {
                  const t = st.translations[stopLocale];
                  const setT = (patch: Partial<typeof t>) => setStop(i, { translations: { ...st.translations, [stopLocale]: { ...t, ...patch } } });
                  return (
                    <li key={st.key} className="space-y-2 border-b border-border pb-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium">{adminT("catalog.routes.stop_n", { n: i + 1 })}</span>
                        <div className="flex gap-1">
                          <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => moveStop(i, -1)} aria-label={adminT("catalog.common.move_up")}>
                            ↑
                          </Button>
                          <Button size="sm" variant="secondary" disabled={i === form.stops.length - 1} onClick={() => moveStop(i, 1)} aria-label={adminT("catalog.common.move_down")}>
                            ↓
                          </Button>
                          <Button size="sm" variant="secondary" onClick={() => set({ stops: form.stops.filter((_, j) => j !== i) })}>
                            {adminT("catalog.common.remove")}
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <TextField
                          label={adminT("catalog.routes.stop_name")}
                          required={stopLocale === DEFAULT_LOCALE}
                          value={t.name}
                          onChange={(v) => setT({ name: v })}
                          error={stopLocale === DEFAULT_LOCALE ? s.field(`stops.${i}.name`) : undefined}
                        />
                        <TextField label={adminT("catalog.routes.stop_activity")} value={t.activity} onChange={(v) => setT({ activity: v })} />
                        <TextField label={adminT("catalog.fields.latitude")} inputMode="decimal" value={st.latitude} onChange={(v) => setStop(i, { latitude: v })} error={s.field(`stops.${i}.latitude`)} hint={adminT("catalog.common.optional")} />
                        <TextField label={adminT("catalog.fields.longitude")} inputMode="decimal" value={st.longitude} onChange={(v) => setStop(i, { longitude: v })} error={s.field(`stops.${i}.longitude`)} hint={adminT("catalog.common.optional")} />
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
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
