import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/region-edit";
import { Button, useToast } from "~/components/ui";
import { FieldReader, intText } from "~/features/admin-catalog/convert";
import { settle } from "~/features/admin-catalog/data";
import { emptyTranslation } from "~/features/admin-catalog/mappers";
import { MediaPicker } from "~/features/admin-catalog/media";
import { allBlank, compactLocales, localesWithIssues, localized, nameOf } from "~/features/admin-catalog/translations";
import type { AdminRegion, ContentStatus } from "~/features/admin-catalog/types";
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
  useSubmission,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, type Locale } from "~/lib/config";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

export function meta() {
  return adminMeta("catalog.regions.edit_title");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (params.id === "new") return { region: null };
  return { region: await settle(apiData<AdminRegion>(`/admin/regions/${params.id}`, { request })) };
}

export default function RegionEdit({ loaderData }: Route.ComponentProps) {
  const { region } = loaderData;
  if (region && !region.ok) return <LoadFailed code={region.code} />;
  const data = region?.data ?? null;
  return <RegionForm key={data?.id ?? "new"} region={data} />;
}

function RegionForm({ region }: { region: AdminRegion | null }) {
  const [trs, setTrs] = useState(() => localized(emptyTranslation, region?.translations));
  const [status, setStatus] = useState<ContentStatus>(region?.status ?? "DRAFT");
  const [sort, setSort] = useState(intText(region?.sort_order ?? 0));
  const [thumb, setThumb] = useState<Img[]>(region?.thumbnail ? [region.thumbnail] : []);
  const [gallery, setGallery] = useState<Img[]>(region?.gallery ?? []);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const s = useSubmission();
  const toast = useToast();
  const navigate = useNavigate();
  const rv = useRevalidator();
  const tr = trs[locale];
  const tp = `translations.${locale}`;
  const setTr = (patch: Partial<typeof tr>) => setTrs({ ...trs, [locale]: { ...tr, ...patch } });
  const save = async () => {
    const r = new FieldReader();
    const dto = {
      sort_order: r.int("sort_order", sort),
      status,
      translations: compactLocales(trs, allBlank),
      thumbnail_id: thumb[0]?.id ?? null,
      gallery_ids: gallery.map((g) => g.id),
    };
    if (!r.ok) return s.invalid(r.errors);
    await s.run(async (signal) => {
      const res = await apiData<{ id: string }>(region ? `/admin/regions/${region.id}` : "/admin/regions", { method: region ? "PUT" : "POST", body: dto, signal });
      toast(adminT("catalog.common.saved"));
      if (!region) navigate(`/admin/regions/${res.id}`, { replace: true });
      else rv.revalidate();
    });
  };
  return (
    <div className="space-y-4">
      <PageHeader
        title={region ? nameOf(region.translations) : adminT("catalog.regions.new")}
        back={{ to: "/admin/locations?tab=regions", label: adminT("catalog.locations.back") }}
        actions={
          region && (
            <DeleteAction
              title={adminT("catalog.common.delete_title", { item: adminT("catalog.regions.noun") })}
              body={adminT("catalog.common.delete_body")}
              onDelete={async (signal) => {
                await api(`/admin/regions/${region.id}`, { method: "DELETE", signal });
                navigate("/admin/locations?tab=regions", { replace: true });
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
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField label={adminT("catalog.fields.status")} value={status} onChange={(v) => setStatus(v as ContentStatus)} options={enumOptions("status", ["DRAFT", "PUBLISHED", "ARCHIVED"])} error={s.field("status")} />
            <NumberField label={adminT("catalog.fields.sort_order")} value={sort} onChange={setSort} error={s.field("sort_order")} />
          </div>
        </Section>
        <Section title={adminT("catalog.common.translations")}>
          <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(trs, ["name"], s.codes)} />
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
        <Section title={adminT("catalog.common.media")}>
          <MediaPicker label={adminT("catalog.common.thumbnail")} value={thumb} onChange={setThumb} slug={trs.en.slug || trs.en.name} error={s.field("thumbnail_id")} />
          <MediaPicker multiple label={adminT("catalog.common.gallery")} value={gallery} onChange={setGallery} slug={trs.en.slug || trs.en.name} error={s.field("gallery_ids")} />
        </Section>
        <FormError error={s.error} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.common.save")}
        </Button>
      </form>
    </div>
  );
}
