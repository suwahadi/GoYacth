import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/content";
import { Button, ButtonLink, Checkbox, DataTable, EmptyState, Tabs, useToast, type Column } from "~/components/ui";
import { FieldReader, intText, isoToLocalInput, localInputToIso } from "~/features/admin-catalog/convert";
import { boatOptions, labelOf, loadRefs, named, settle, type Opt } from "~/features/admin-catalog/data";
import { MediaPicker } from "~/features/admin-catalog/media";
import { allBlank, compactLocales, localesWithIssues, localized, nameOf, type Localized } from "~/features/admin-catalog/translations";
import { SECTION_TYPES, type AdminFaq, type AdminPage, type AdminSection, type ContentStatus, type SectionItem, type SectionType } from "~/features/admin-catalog/types";
import {
  CheckboxGroup,
  DeleteAction,
  FormDialog,
  FormError,
  LoadFailed,
  NumberField,
  PageHeader,
  SelectField,
  StatusPill,
  TextField,
  TextareaField,
  TranslationTabs,
  adminMeta,
  enumLabel,
  enumOptions,
  useSubmission,
  useTabParam,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

const TABS = ["pages", "sections", "faqs"] as const;

export function meta() {
  return adminMeta("catalog.content.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  const [data, refs] = await Promise.all([
    settle(
      Promise.all([
        apiData<AdminPage[]>("/admin/pages", { request }),
        apiData<AdminSection[]>("/admin/sections", { request }),
        apiData<AdminFaq[]>("/admin/faqs", { request }),
      ]).then(([pages, sections, faqs]) => ({ pages, sections, faqs })),
    ),
    settle(loadRefs(request, ["boats", "packages", "regions"])),
  ]);
  return { data, refs };
}

export default function Content({ loaderData }: Route.ComponentProps) {
  const [tab, setTab] = useTabParam(TABS);
  const { data, refs } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.content.title")} />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: adminT(`catalog.content.tab_${t}`) }))} active={tab} onChange={(t) => setTab(t as (typeof TABS)[number])} />
      {!data.ok ? (
        <LoadFailed code={data.code} />
      ) : !refs.ok ? (
        <LoadFailed code={refs.code} />
      ) : tab === "pages" ? (
        <Pages rows={data.data.pages} />
      ) : tab === "sections" ? (
        <Sections rows={data.data.sections} boats={boatOptions(refs.data.boats)} packages={named(refs.data.packages)} regions={named(refs.data.regions)} />
      ) : (
        <Faqs rows={data.data.faqs} boats={boatOptions(refs.data.boats)} packages={named(refs.data.packages)} />
      )}
    </div>
  );
}

function Pages({ rows }: { rows: AdminPage[] }) {
  const columns: Column<AdminPage>[] = [
    { key: "title", header: adminT("catalog.content.page_title"), primary: true, cell: (p) => nameOf(p.translations, "title") || p.id },
    { key: "slug", header: adminT("catalog.fields.slug"), cell: (p) => `/${nameOf(p.translations, "slug")}` },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
  ];
  return (
    <div className="space-y-3">
      <ButtonLink to="/admin/content/pages/new">{adminT("catalog.content.new_page")}</ButtonLink>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} onRowHref={(p) => `/admin/content/pages/${p.id}`} />}
    </div>
  );
}

const SECTION_CONFIG: Record<SectionType, { media?: boolean; boats?: boolean; packages?: boolean; regions?: boolean; limit?: boolean; category?: boolean; items?: boolean }> = {
  HERO: { media: true },
  FEATURED_BOATS: { boats: true, limit: true },
  REGIONS: { regions: true, limit: true },
  FEATURED_PACKAGES: { packages: true, limit: true },
  HIGHLIGHTS: { items: true },
  REVIEWS: { limit: true },
  FAQ: { category: true, limit: true },
  CTA: { media: true },
  PROMO_BANNER: { media: true },
};

function Sections({ rows, boats, packages, regions }: { rows: AdminSection[]; boats: Opt[]; packages: Opt[]; regions: Opt[] }) {
  const [editing, setEditing] = useState<AdminSection | "new" | null>(null);
  const rv = useRevalidator();
  const sorted = rows.slice().sort((a, b) => a.sort_order - b.sort_order);
  const columns: Column<AdminSection>[] = [
    { key: "type", header: adminT("catalog.content.section_type"), primary: true, cell: (x) => enumLabel("section_type", x.type) },
    { key: "title", header: adminT("catalog.content.section_title"), cell: (x) => nameOf(x.translations, "title") || "—" },
    { key: "order", header: adminT("catalog.fields.sort_order"), cell: (x) => x.sort_order },
    { key: "active", header: adminT("catalog.content.active"), cell: (x) => <StatusPill status={x.is_active ? "ACTIVE" : "INACTIVE"} /> },
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
            title={adminT("catalog.common.delete_title", { item: adminT("catalog.content.section") })}
            body={adminT("catalog.common.delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/sections/${x.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.content.section") })}</Button>
      {sorted.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={sorted} columns={columns} rowKey={(x) => x.id} />}
      {editing && (
        <SectionDialog
          section={editing === "new" ? null : editing}
          boats={boats}
          packages={packages}
          regions={regions}
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

interface SectionText {
  title: string;
  subtitle: string;
  body: string;
  cta_label: string;
  cta_url: string;
  items: SectionItem[];
}

const emptySectionText = (): SectionText => ({ title: "", subtitle: "", body: "", cta_label: "", cta_url: "", items: [] });

function SectionDialog({ section, boats, packages, regions, onClose, onSaved }: { section: AdminSection | null; boats: Opt[]; packages: Opt[]; regions: Opt[]; onClose: () => void; onSaved: () => void }) {
  const cfg = section?.config ?? {};
  const [type, setType] = useState<SectionType>(section?.type ?? "HERO");
  const [sort, setSort] = useState(intText(section?.sort_order ?? 0));
  const [active, setActive] = useState(section?.is_active ?? true);
  const [image, setImage] = useState<Img[]>(section?.image ? [section.image] : []);
  const [boatIds, setBoatIds] = useState<string[]>(cfg.boat_ids ?? []);
  const [packageIds, setPackageIds] = useState<string[]>(cfg.package_ids ?? []);
  const [regionIds, setRegionIds] = useState<string[]>(cfg.region_ids ?? []);
  const [limit, setLimit] = useState(intText(cfg.limit));
  const [category, setCategory] = useState(cfg.category ?? "");
  const [startsAt, setStartsAt] = useState(isoToLocalInput(cfg.starts_at));
  const [endsAt, setEndsAt] = useState(isoToLocalInput(cfg.ends_at));
  const [trs, setTrs] = useState<Localized<SectionText>>(() => {
    const m = localized(emptySectionText, section?.translations);
    for (const l of Object.keys(m) as Locale[]) m[l].items = m[l].items ?? [];
    return m;
  });
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const shape = SECTION_CONFIG[type];
  const tr = trs[locale];
  const tp = `translations.${locale}`;
  const setTr = (patch: Partial<SectionText>) => setTrs({ ...trs, [locale]: { ...tr, ...patch } });
  const setItem = (i: number, patch: Partial<SectionItem>) => setTr({ items: tr.items.map((it, j) => (j === i ? { ...it, ...patch } : it)) });
  const save = async () => {
    const r = new FieldReader();
    const config = {
      media_id: shape.media ? image[0]?.id : undefined,
      boat_ids: shape.boats && boatIds.length ? boatIds : undefined,
      package_ids: shape.packages && packageIds.length ? packageIds : undefined,
      region_ids: shape.regions && regionIds.length ? regionIds : undefined,
      limit: shape.limit ? (r.optInt("config.limit", limit) ?? undefined) : undefined,
      category: shape.category && category.trim() ? category.trim().toUpperCase() : undefined,
      starts_at: localInputToIso(startsAt) ?? undefined,
      ends_at: localInputToIso(endsAt) ?? undefined,
    };
    const translations = compactLocales(trs, allBlank);
    const dto = {
      type,
      sort_order: r.int("sort_order", sort),
      is_active: active,
      config,
      translations: Object.fromEntries(
        Object.entries(translations).map(([l, t]) => [l, { ...t, items: shape.items ? t.items.filter((it) => it.title.trim() || it.text.trim()).map((it) => ({ title: it.title.trim(), text: it.text.trim(), icon: it.icon?.trim() || undefined })) : [] }]),
      ),
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api(section ? `/admin/sections/${section.id}` : "/admin/sections", { method: section ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <FormDialog id="section-form" title={section ? enumLabel("section_type", section.type) : adminT("catalog.common.add_item", { item: adminT("catalog.content.section") })} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <div className="grid gap-3 sm:grid-cols-3">
        <SelectField label={adminT("catalog.content.section_type")} value={type} onChange={(v) => setType(v as SectionType)} options={enumOptions("section_type", SECTION_TYPES)} error={s.field("type")} />
        <NumberField label={adminT("catalog.fields.sort_order")} value={sort} onChange={setSort} error={s.field("sort_order")} />
        <Checkbox className="self-center" label={adminT("catalog.content.active")} checked={active} onChange={(e) => setActive(e.target.checked)} />
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">{adminT("catalog.content.config")}</legend>
        {s.field("config") && <p className="text-sm text-danger">{s.field("config")}</p>}
        {shape.media && <MediaPicker label={adminT("catalog.content.image")} value={image} onChange={setImage} slug="home" />}
        {shape.boats && <CheckboxGroup legend={adminT("catalog.content.boats")} options={boats} value={boatIds} onChange={setBoatIds} />}
        {shape.packages && <CheckboxGroup legend={adminT("catalog.content.packages")} options={packages} value={packageIds} onChange={setPackageIds} />}
        {shape.regions && <CheckboxGroup legend={adminT("catalog.content.regions")} options={regions} value={regionIds} onChange={setRegionIds} />}
        <div className="grid gap-3 sm:grid-cols-2">
          {shape.limit && <NumberField label={adminT("catalog.content.limit")} value={limit} onChange={setLimit} error={s.field("config.limit")} hint={adminT("catalog.content.limit_hint")} />}
          {shape.category && <TextField label={adminT("catalog.content.faq_category")} value={category} onChange={setCategory} hint={adminT("catalog.common.optional")} />}
          <TextField type="datetime-local" label={adminT("catalog.content.show_from")} value={startsAt} onChange={setStartsAt} hint={adminT("catalog.common.local_time_hint")} />
          <TextField type="datetime-local" label={adminT("catalog.content.show_until")} value={endsAt} onChange={setEndsAt} hint={adminT("catalog.common.optional")} />
        </div>
      </fieldset>
      <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(trs, ["title"], s.codes)} />
      {s.field(tp) && <p className="text-sm text-danger">{s.field(tp)}</p>}
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.content.section_title")} maxLength={160} value={tr.title} onChange={(v) => setTr({ title: v })} />
        <TextField label={adminT("catalog.content.subtitle")} maxLength={300} value={tr.subtitle} onChange={(v) => setTr({ subtitle: v })} />
      </div>
      <TextareaField label={adminT("catalog.content.body")} maxLength={4000} value={tr.body} onChange={(v) => setTr({ body: v })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.content.cta_label")} maxLength={80} value={tr.cta_label} onChange={(v) => setTr({ cta_label: v })} error={s.field(`${tp}.cta_label`)} />
        <TextField label={adminT("catalog.content.cta_url")} value={tr.cta_url} onChange={(v) => setTr({ cta_url: v })} error={s.field(`${tp}.cta_url`)} hint={adminT("catalog.content.url_hint")} />
      </div>
      {shape.items && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">{adminT("catalog.content.items")}</legend>
          {tr.items.map((it, i) => (
            <div key={i} className="grid items-end gap-2 border-b border-border pb-2 sm:grid-cols-4">
              <TextField label={adminT("catalog.content.item_title")} value={it.title} onChange={(v) => setItem(i, { title: v })} />
              <TextField className="sm:col-span-2" label={adminT("catalog.content.item_text")} value={it.text} onChange={(v) => setItem(i, { text: v })} />
              <TextField label={adminT("catalog.fleet.icon")} value={it.icon ?? ""} onChange={(v) => setItem(i, { icon: v })} />
              <Button size="sm" variant="secondary" onClick={() => setTr({ items: tr.items.filter((_, j) => j !== i) })}>
                {adminT("catalog.common.remove")}
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" disabled={tr.items.length >= 12} onClick={() => setTr({ items: [...tr.items, { title: "", text: "", icon: "" }] })}>
            {adminT("catalog.content.add_item")}
          </Button>
        </fieldset>
      )}
      <FormError error={s.error} />
    </FormDialog>
  );
}

function Faqs({ rows, boats, packages }: { rows: AdminFaq[]; boats: Opt[]; packages: Opt[] }) {
  const [editing, setEditing] = useState<AdminFaq | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<AdminFaq>[] = [
    { key: "q", header: adminT("catalog.content.question"), primary: true, cell: (f) => nameOf(f.translations, "question") },
    { key: "category", header: adminT("catalog.content.faq_category"), cell: (f) => f.category },
    { key: "link", header: adminT("catalog.content.linked_to"), cell: (f) => (f.boat_id ? labelOf(boats, f.boat_id) : f.package_id ? labelOf(packages, f.package_id) : "—") },
    { key: "status", header: adminT("catalog.fields.status"), cell: (f) => <StatusPill status={f.status} /> },
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (f) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(f)}>
            {adminT("catalog.common.edit")}
          </Button>
          <DeleteAction
            size="sm"
            title={adminT("catalog.common.delete_title", { item: adminT("catalog.content.faq") })}
            body={adminT("catalog.common.delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/faqs/${f.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.content.faq") })}</Button>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(f) => f.id} />}
      {editing && (
        <FaqDialog
          faq={editing === "new" ? null : editing}
          boats={boats}
          packages={packages}
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

function FaqDialog({ faq, boats, packages, onClose, onSaved }: { faq: AdminFaq | null; boats: Opt[]; packages: Opt[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ category: faq?.category ?? "GENERAL", boat_id: faq?.boat_id ?? "", package_id: faq?.package_id ?? "", sort_order: intText(faq?.sort_order ?? 0), status: faq?.status ?? ("DRAFT" as ContentStatus) });
  const [trs, setTrs] = useState(() => localized(() => ({ question: "", answer: "" }), faq?.translations));
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const tr = trs[locale];
  const tp = `translations.${locale}`;
  const save = async () => {
    const r = new FieldReader();
    const dto = {
      category: form.category.trim().toUpperCase(),
      boat_id: form.boat_id || null,
      package_id: form.package_id || null,
      sort_order: r.int("sort_order", form.sort_order),
      status: form.status,
      translations: compactLocales(trs, allBlank),
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api(faq ? `/admin/faqs/${faq.id}` : "/admin/faqs", { method: faq ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <FormDialog id="faq-form" title={faq ? adminT("catalog.common.edit_item", { item: adminT("catalog.content.faq") }) : adminT("catalog.common.add_item", { item: adminT("catalog.content.faq") })} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.content.faq_category")} required value={form.category} onChange={(v) => setForm({ ...form, category: v.toUpperCase() })} error={s.field("category")} hint={adminT("catalog.content.faq_category_hint")} />
        <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => setForm({ ...form, status: v as ContentStatus })} options={enumOptions("status", ["DRAFT", "PUBLISHED", "ARCHIVED"])} error={s.field("status")} />
        <SelectField label={adminT("catalog.fields.boat")} value={form.boat_id} onChange={(v) => setForm({ ...form, boat_id: v })} options={boats} placeholder={adminT("catalog.common.none")} error={s.field("boat_id")} />
        <SelectField label={adminT("catalog.pricing.package")} value={form.package_id} onChange={(v) => setForm({ ...form, package_id: v })} options={packages} placeholder={adminT("catalog.common.none")} error={s.field("package_id")} />
        <NumberField label={adminT("catalog.fields.sort_order")} value={form.sort_order} onChange={(v) => setForm({ ...form, sort_order: v })} error={s.field("sort_order")} />
      </div>
      <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(trs, ["question", "answer"], s.codes)} />
      {s.field(tp) && <p className="text-sm text-danger">{s.field(tp)}</p>}
      <TextField label={adminT("catalog.content.question")} required={locale === DEFAULT_LOCALE} maxLength={300} value={tr.question} onChange={(v) => setTrs({ ...trs, [locale]: { ...tr, question: v } })} error={s.field(`${tp}.question`)} />
      <TextareaField label={adminT("catalog.content.answer")} required={locale === DEFAULT_LOCALE} rows={5} value={tr.answer} onChange={(v) => setTrs({ ...trs, [locale]: { ...tr, answer: v } })} error={s.field(`${tp}.answer`)} />
      <FormError error={s.error} />
    </FormDialog>
  );
}
