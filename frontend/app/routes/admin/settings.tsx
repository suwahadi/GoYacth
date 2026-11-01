import { useState, type ReactNode } from "react";
import { useRevalidator } from "react-router";

import type { Route } from "./+types/settings";
import { Button, useToast } from "~/components/ui";
import { FieldReader, intText } from "~/features/admin-catalog/convert";
import { settle } from "~/features/admin-catalog/data";
import { MediaPicker } from "~/features/admin-catalog/media";
import type { AdminSettings, MediaDetail } from "~/features/admin-catalog/types";
import { FormError, LoadFailed, NumberField, PageHeader, Section, TextField, TextareaField, adminMeta, useSubmission, type Submission } from "~/features/admin-catalog/ui";
import { ApiError, api, apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

export function meta() {
  return adminMeta("catalog.settings.title");
}

async function loadSettings(request: Request) {
  const settings = await apiData<AdminSettings>("/admin/settings", { request });
  const ogId = settings.seo?.og_image_media_id;
  let ogImage: Img | null = null;
  if (ogId) {
    try {
      ogImage = (await apiData<MediaDetail>(`/admin/media/${ogId}`, { request })).image;
    } catch (e) {
      if (!(e instanceof ApiError && e.status === 404)) throw e;
    }
  }
  return { settings, ogImage };
}

export async function loader({ request }: Route.LoaderArgs) {
  return { result: await settle(loadSettings(request)) };
}

export default function Settings({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;
  if (!result.ok) return <LoadFailed code={result.code} />;
  const { settings, ogImage } = result.data;
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.settings.title")} />
      <SiteForm value={settings.site} />
      <SeoForm value={settings.seo} image={ogImage} />
      <AnalyticsForm value={settings.analytics} />
      <BookingForm value={settings.booking} />
      <LegalForm value={settings.legal} />
    </div>
  );
}

// useSettingSave sends one settings group; the API replaces the whole group and rejects unknown
// keys, so each form always sends its complete shape.
function useSettingSave(key: string) {
  const s = useSubmission();
  const toast = useToast();
  const rv = useRevalidator();
  const save = async (body: unknown, local?: FieldReader) => {
    if (local && !local.ok) return s.invalid(local.errors);
    const ok = await s.run(async (signal) => {
      await api(`/admin/settings/${key}`, { method: "PUT", body, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      rv.revalidate();
    }
  };
  return { s, save };
}

function SettingsCard({ title, s, onSubmit, children }: { title: string; s: Submission; onSubmit: () => void; children: ReactNode }) {
  return (
    <Section title={title}>
      <form
        noValidate
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
      >
        {children}
        <FormError error={s.error} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.common.save")}
        </Button>
      </form>
    </Section>
  );
}

function SiteForm({ value }: { value: AdminSettings["site"] }) {
  const [f, setF] = useState({ name: value?.name ?? "", email: value?.email ?? "", phone: value?.phone ?? "", whatsapp: value?.whatsapp ?? "", address: value?.address ?? "" });
  const { s, save } = useSettingSave("site");
  return (
    <SettingsCard title={adminT("catalog.settings.site")} s={s} onSubmit={() => void save({ ...f, name: f.name.trim() })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.settings.site_name")} required value={f.name} onChange={(v) => setF({ ...f, name: v })} error={s.field("name")} />
        <TextField type="email" label={adminT("catalog.settings.email")} value={f.email} onChange={(v) => setF({ ...f, email: v })} error={s.field("email")} />
        <TextField type="tel" label={adminT("catalog.settings.phone")} value={f.phone} onChange={(v) => setF({ ...f, phone: v })} error={s.field("phone")} />
        <TextField type="tel" label={adminT("catalog.settings.whatsapp")} value={f.whatsapp} onChange={(v) => setF({ ...f, whatsapp: v })} error={s.field("whatsapp")} hint={adminT("catalog.settings.whatsapp_hint")} />
      </div>
      <TextareaField label={adminT("catalog.settings.address")} value={f.address} onChange={(v) => setF({ ...f, address: v })} error={s.field("address")} />
    </SettingsCard>
  );
}

function SeoForm({ value, image }: { value: AdminSettings["seo"]; image: Img | null }) {
  const [title, setTitle] = useState(value?.default_title ?? "");
  const [description, setDescription] = useState(value?.default_description ?? "");
  const [og, setOg] = useState<Img[]>(image ? [image] : []);
  const { s, save } = useSettingSave("seo");
  return (
    <SettingsCard
      title={adminT("catalog.settings.seo")}
      s={s}
      onSubmit={() => void save({ default_title: title.trim(), default_description: description.trim(), og_image_media_id: og[0]?.id ?? null })}
    >
      <TextField label={adminT("catalog.settings.default_title")} maxLength={70} value={title} onChange={setTitle} error={s.field("default_title")} />
      <TextareaField label={adminT("catalog.settings.default_description")} maxLength={170} value={description} onChange={setDescription} error={s.field("default_description")} />
      <MediaPicker label={adminT("catalog.settings.og_image")} value={og} onChange={setOg} slug="og-image" error={s.field("og_image_media_id")} />
    </SettingsCard>
  );
}

function AnalyticsForm({ value }: { value: AdminSettings["analytics"] }) {
  const [ga4, setGa4] = useState(value?.ga4_id ?? "");
  const [gtm, setGtm] = useState(value?.gtm_id ?? "");
  const { s, save } = useSettingSave("analytics");
  return (
    <SettingsCard title={adminT("catalog.settings.analytics")} s={s} onSubmit={() => void save({ ga4_id: ga4.trim(), gtm_id: gtm.trim() })}>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField label={adminT("catalog.settings.ga4_id")} placeholder="G-XXXXXXX" value={ga4} onChange={setGa4} error={s.field("ga4_id")} />
        <TextField label={adminT("catalog.settings.gtm_id")} placeholder="GTM-XXXXXX" value={gtm} onChange={setGtm} error={s.field("gtm_id")} />
      </div>
      <p className="text-xs text-muted">{adminT("catalog.settings.analytics_hint")}</p>
    </SettingsCard>
  );
}

function BookingForm({ value }: { value: AdminSettings["booking"] }) {
  const [f, setF] = useState({
    min_lead_hours: intText(value?.min_lead_hours),
    max_advance_days: intText(value?.max_advance_days),
    admin_hold_minutes: intText(value?.admin_hold_minutes),
    balance_reminder_days: (value?.balance_reminder_days ?? []).join(", "),
    identity_retention_days: intText(value?.identity_retention_days),
  });
  const { s, save } = useSettingSave("booking");
  const submit = () => {
    const r = new FieldReader();
    const reminders = f.balance_reminder_days
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => r.int("balance_reminder_days", x));
    const body = {
      min_lead_hours: r.int("min_lead_hours", f.min_lead_hours),
      max_advance_days: r.int("max_advance_days", f.max_advance_days),
      admin_hold_minutes: r.int("admin_hold_minutes", f.admin_hold_minutes),
      balance_reminder_days: reminders,
      identity_retention_days: r.int("identity_retention_days", f.identity_retention_days),
    };
    void save(body, r);
  };
  return (
    <SettingsCard title={adminT("catalog.settings.booking")} s={s} onSubmit={submit}>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <NumberField label={adminT("catalog.settings.min_lead_hours")} value={f.min_lead_hours} onChange={(v) => setF({ ...f, min_lead_hours: v })} error={s.field("min_lead_hours")} />
        <NumberField label={adminT("catalog.settings.max_advance_days")} value={f.max_advance_days} onChange={(v) => setF({ ...f, max_advance_days: v })} error={s.field("max_advance_days")} />
        <NumberField label={adminT("catalog.settings.admin_hold_minutes")} value={f.admin_hold_minutes} onChange={(v) => setF({ ...f, admin_hold_minutes: v })} error={s.field("admin_hold_minutes")} hint={adminT("catalog.settings.admin_hold_hint")} />
        <TextField label={adminT("catalog.settings.balance_reminder_days")} value={f.balance_reminder_days} onChange={(v) => setF({ ...f, balance_reminder_days: v })} error={s.field("balance_reminder_days")} hint={adminT("catalog.settings.balance_reminder_hint")} />
        <NumberField label={adminT("catalog.settings.identity_retention_days")} value={f.identity_retention_days} onChange={(v) => setF({ ...f, identity_retention_days: v })} error={s.field("identity_retention_days")} />
      </div>
    </SettingsCard>
  );
}

function LegalForm({ value }: { value: AdminSettings["legal"] }) {
  const [f, setF] = useState({ terms_version: value?.terms_version ?? "", privacy_version: value?.privacy_version ?? "", cancellation_version: value?.cancellation_version ?? "" });
  const { s, save } = useSettingSave("legal");
  return (
    <SettingsCard title={adminT("catalog.settings.legal")} s={s} onSubmit={() => void save({ terms_version: f.terms_version.trim(), privacy_version: f.privacy_version.trim(), cancellation_version: f.cancellation_version.trim() })}>
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField label={adminT("catalog.settings.terms_version")} value={f.terms_version} onChange={(v) => setF({ ...f, terms_version: v })} error={s.field("terms_version")} />
        <TextField label={adminT("catalog.settings.privacy_version")} value={f.privacy_version} onChange={(v) => setF({ ...f, privacy_version: v })} error={s.field("privacy_version")} />
        <TextField label={adminT("catalog.settings.cancellation_version")} value={f.cancellation_version} onChange={(v) => setF({ ...f, cancellation_version: v })} error={s.field("cancellation_version")} />
      </div>
      <p className="text-xs text-muted">{adminT("catalog.settings.legal_hint")}</p>
    </SettingsCard>
  );
}
