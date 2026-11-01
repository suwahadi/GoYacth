import { useState } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/fleet";
import { Button, ButtonPair, DataTable, Dialog, EmptyState, Tabs, useToast, type Column } from "~/components/ui";
import { FieldReader, intText } from "~/features/admin-catalog/convert";
import { loadRefs, settle } from "~/features/admin-catalog/data";
import { compactLocales, localesWithIssues, localized, nameOf, type Localized } from "~/features/admin-catalog/translations";
import type { NamedItem, Partner } from "~/features/admin-catalog/types";
import {
  DeleteAction,
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
  enumOptions,
  useSubmission,
  useTabParam,
} from "~/features/admin-catalog/ui";
import { api } from "~/lib/api";
import { DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { adminT, type AdminKey } from "~/lib/i18n";

const TABS = ["categories", "classes", "facilities", "partners"] as const;
type Tab = (typeof TABS)[number];

export function meta() {
  return adminMeta("catalog.fleet.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  return { refs: await settle(loadRefs(request, ["categories", "classes", "facilities", "partners"])) };
}

interface NamedConfig {
  path: string;
  withStatus: boolean;
  withSlug: boolean;
  withIcon: boolean;
  noun: AdminKey;
}

const configs: Record<Exclude<Tab, "partners">, NamedConfig> = {
  categories: { path: "/admin/categories", withStatus: true, withSlug: true, withIcon: false, noun: "catalog.fleet.category" },
  classes: { path: "/admin/classes", withStatus: true, withSlug: true, withIcon: false, noun: "catalog.fleet.class" },
  facilities: { path: "/admin/facilities", withStatus: false, withSlug: false, withIcon: true, noun: "catalog.fleet.facility" },
};

export default function Fleet({ loaderData }: Route.ComponentProps) {
  const [tab, setTab] = useTabParam(TABS);
  const { refs } = loaderData;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.fleet.title")} />
      <Tabs tabs={TABS.map((t) => ({ id: t, label: adminT(`catalog.fleet.tab_${t}`) }))} active={tab} onChange={(t) => setTab(t as Tab)} />
      {!refs.ok ? (
        <LoadFailed code={refs.code} />
      ) : tab === "partners" ? (
        <Partners rows={refs.data.partners} />
      ) : (
        <NamedItems key={tab} rows={refs.data[tab]} config={configs[tab]} />
      )}
    </div>
  );
}

function NamedItems({ rows, config }: { rows: NamedItem[]; config: NamedConfig }) {
  const [editing, setEditing] = useState<NamedItem | "new" | null>(null);
  const rv = useRevalidator();
  const noun = adminT(config.noun);
  const columns: Column<NamedItem>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (r) => nameOf(r.translations) },
    ...(config.withSlug ? [{ key: "slug", header: adminT("catalog.fields.slug"), cell: (r: NamedItem) => nameOf(r.translations, "slug") }] : []),
    ...(config.withIcon ? [{ key: "icon", header: adminT("catalog.fleet.icon"), cell: (r: NamedItem) => r.icon || "—" }] : []),
    { key: "sort", header: adminT("catalog.fields.sort_order"), cell: (r) => r.sort_order },
    ...(config.withStatus ? [{ key: "status", header: adminT("catalog.fields.status"), cell: (r: NamedItem) => <StatusPill status={r.status ?? ""} /> }] : []),
    {
      key: "actions",
      header: adminT("catalog.common.actions"),
      cell: (r) => (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" onClick={() => setEditing(r)}>
            {adminT("catalog.common.edit")}
          </Button>
          <DeleteAction
            size="sm"
            title={adminT("catalog.common.delete_title", { item: noun })}
            body={adminT("catalog.common.delete_body")}
            onDelete={async (signal) => {
              await api(`${config.path}/${r.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: noun })}</Button>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(r) => r.id} />}
      {editing && (
        <NamedItemDialog
          item={editing === "new" ? null : editing}
          config={config}
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

function NamedItemDialog({ item, config, onClose, onSaved }: { item: NamedItem | null; config: NamedConfig; onClose: () => void; onSaved: () => void }) {
  const [trs, setTrs] = useState<Localized<{ name: string; slug: string }>>(() => localized(() => ({ name: "", slug: "" }), item?.translations));
  const [sort, setSort] = useState(intText(item?.sort_order ?? 0));
  const [status, setStatus] = useState(item?.status ?? "ACTIVE");
  const [icon, setIcon] = useState(item?.icon ?? "");
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const tp = `translations.${locale}`;
  const save = async () => {
    const r = new FieldReader();
    const dto = {
      sort_order: r.int("sort_order", sort),
      status: config.withStatus ? status : "",
      icon: config.withIcon ? icon.trim() : "",
      translations: compactLocales(trs, (t) => !t.name.trim() && !t.slug.trim()),
    };
    if (!r.ok) return s.invalid(r.errors);
    const ok = await s.run(async (signal) => {
      await api(item ? `${config.path}/${item.id}` : config.path, { method: item ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  const noun = adminT(config.noun);
  return (
    <Dialog
      open
      onClose={onClose}
      title={item ? adminT("catalog.common.edit_item", { item: noun }) : adminT("catalog.common.add_item", { item: noun })}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            {adminT("catalog.common.cancel")}
          </Button>
          <Button type="submit" form="named-form" pending={s.pending}>
            {adminT("catalog.common.save")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="named-form"
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(trs, ["name"], s.codes)} />
        <TextField label={adminT("catalog.fields.name")} required={locale === DEFAULT_LOCALE} value={trs[locale].name} onChange={(v) => setTrs({ ...trs, [locale]: { ...trs[locale], name: v } })} error={s.field(`${tp}.name`) ?? s.field(tp)} />
        {config.withSlug && <TextField label={adminT("catalog.fields.slug")} hint={adminT("catalog.common.slug_hint")} value={trs[locale].slug} onChange={(v) => setTrs({ ...trs, [locale]: { ...trs[locale], slug: v } })} error={s.field(`${tp}.slug`) ?? s.field("slug")} />}
        {config.withIcon && <TextField label={adminT("catalog.fleet.icon")} hint={adminT("catalog.fleet.icon_hint")} value={icon} maxLength={60} onChange={setIcon} error={s.field("icon")} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <NumberField label={adminT("catalog.fields.sort_order")} value={sort} onChange={setSort} error={s.field("sort_order")} />
          {config.withStatus && <SelectField label={adminT("catalog.fields.status")} value={status} onChange={setStatus} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />}
        </div>
        <FormError error={s.error} />
      </form>
    </Dialog>
  );
}

const emptyPartner = { name: "", contact_name: "", email: "", phone: "", bank_name: "", bank_account_name: "", bank_account_number: "", notes: "", status: "ACTIVE" as Partner["status"] };
type PartnerForm = typeof emptyPartner;

function Partners({ rows }: { rows: Partner[] }) {
  const [editing, setEditing] = useState<Partner | "new" | null>(null);
  const rv = useRevalidator();
  const columns: Column<Partner>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => p.name },
    { key: "contact", header: adminT("catalog.partners.contact_name"), cell: (p) => p.contact_name || "—" },
    { key: "email", header: adminT("catalog.partners.email"), cell: (p) => p.email || "—" },
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
            title={adminT("catalog.common.delete_title", { item: adminT("catalog.fleet.partner") })}
            body={adminT("catalog.partners.delete_body")}
            onDelete={async (signal) => {
              await api(`/admin/partners/${p.id}`, { method: "DELETE", signal });
              rv.revalidate();
            }}
          />
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-3">
      <Button onClick={() => setEditing("new")}>{adminT("catalog.common.add_item", { item: adminT("catalog.fleet.partner") })}</Button>
      {rows.length === 0 ? <EmptyState title={adminT("catalog.common.empty")} /> : <DataTable rows={rows} columns={columns} rowKey={(p) => p.id} />}
      {editing && (
        <PartnerDialog
          partner={editing === "new" ? null : editing}
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

function PartnerDialog({ partner, onClose, onSaved }: { partner: Partner | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<PartnerForm>(() => (partner ? { ...emptyPartner, ...partner } : emptyPartner));
  const s = useSubmission();
  const toast = useToast();
  const field = (k: keyof PartnerForm, label: AdminKey, extra?: { type?: string; required?: boolean }) => (
    <TextField label={adminT(label)} type={extra?.type} required={extra?.required} value={String(form[k])} onChange={(v) => setForm({ ...form, [k]: v })} error={s.field(k)} />
  );
  const save = async () => {
    const dto = {
      name: form.name.trim(),
      contact_name: form.contact_name.trim(),
      email: form.email.trim(),
      phone: form.phone.trim(),
      bank_name: form.bank_name.trim(),
      bank_account_name: form.bank_account_name.trim(),
      bank_account_number: form.bank_account_number.trim(),
      notes: form.notes,
      status: form.status,
    };
    const ok = await s.run(async (signal) => {
      await api(partner ? `/admin/partners/${partner.id}` : "/admin/partners", { method: partner ? "PUT" : "POST", body: dto, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={partner ? adminT("catalog.common.edit_item", { item: adminT("catalog.fleet.partner") }) : adminT("catalog.common.add_item", { item: adminT("catalog.fleet.partner") })}
      footer={
        <ButtonPair>
          <Button variant="secondary" onClick={onClose} disabled={s.pending}>
            {adminT("catalog.common.cancel")}
          </Button>
          <Button type="submit" form="partner-form" pending={s.pending}>
            {adminT("catalog.common.save")}
          </Button>
        </ButtonPair>
      }
    >
      <form
        id="partner-form"
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {field("name", "catalog.fields.name", { required: true })}
        <div className="grid gap-3 sm:grid-cols-2">
          {field("contact_name", "catalog.partners.contact_name")}
          {field("email", "catalog.partners.email", { type: "email" })}
          {field("phone", "catalog.partners.phone", { type: "tel" })}
          <SelectField label={adminT("catalog.fields.status")} value={form.status} onChange={(v) => setForm({ ...form, status: v as Partner["status"] })} options={enumOptions("status", ["ACTIVE", "ARCHIVED"])} error={s.field("status")} />
          {field("bank_name", "catalog.partners.bank_name")}
          {field("bank_account_name", "catalog.partners.bank_account_name")}
          {field("bank_account_number", "catalog.partners.bank_account_number")}
        </div>
        <TextareaField label={adminT("catalog.partners.notes")} value={form.notes} onChange={(v) => setForm({ ...form, notes: v })} error={s.field("notes")} />
        <FormError error={s.error} />
      </form>
    </Dialog>
  );
}
