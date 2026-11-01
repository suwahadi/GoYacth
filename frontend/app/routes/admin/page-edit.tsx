import { useState } from "react";
import { useNavigate, useRevalidator } from "react-router";

import type { Route } from "./+types/page-edit";
import { Button, Select, useToast } from "~/components/ui";
import { BLOCK_TYPES, blockToDTO, blocksFromApi, blocksReducer, type BlockAction, type BlockType, type EditorBlock } from "~/features/admin-catalog/block-editor";
import { settle } from "~/features/admin-catalog/data";
import { MediaPicker } from "~/features/admin-catalog/media";
import { localesWithIssues, nameOf, type Localized } from "~/features/admin-catalog/translations";
import type { AdminPage, ContentStatus } from "~/features/admin-catalog/types";
import {
  DeleteAction,
  FormError,
  LoadFailed,
  PageHeader,
  Section,
  SelectField,
  TextField,
  TextareaField,
  TranslationTabs,
  adminMeta,
  enumLabel,
  enumOptions,
  localeLabel,
  useSubmission,
} from "~/features/admin-catalog/ui";
import { api, apiData } from "~/lib/api";
import { DEFAULT_LOCALE, LOCALES, type Locale } from "~/lib/config";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

export function meta() {
  return adminMeta("catalog.content.edit_page");
}

export async function loader({ request, params }: Route.LoaderArgs) {
  if (params.id === "new") return { page: null };
  return { page: await settle(apiData<AdminPage>(`/admin/pages/${params.id}`, { request })) };
}

export default function PageEdit({ loaderData }: Route.ComponentProps) {
  const { page } = loaderData;
  if (page && !page.ok) return <LoadFailed code={page.code} />;
  const data = page?.data ?? null;
  return <PageEditor key={data?.id ?? "new"} page={data} />;
}

interface PageText {
  title: string;
  slug: string;
  seo_title: string;
  seo_description: string;
  blocks: EditorBlock[];
}

function initial(page: AdminPage | null): Localized<PageText> {
  const out = {} as Localized<PageText>;
  for (const l of LOCALES) {
    const t = page?.translations?.[l];
    out[l] = { title: t?.title ?? "", slug: t?.slug ?? "", seo_title: t?.seo_title ?? "", seo_description: t?.seo_description ?? "", blocks: blocksFromApi(t?.blocks, l) };
  }
  return out;
}

function isEmpty(t: PageText) {
  return !t.title.trim() && !t.slug.trim() && !t.seo_title.trim() && !t.seo_description.trim() && t.blocks.length === 0;
}

function PageEditor({ page }: { page: AdminPage | null }) {
  const [trs, setTrs] = useState<Localized<PageText>>(() => initial(page));
  const [status, setStatus] = useState<ContentStatus>(page?.status ?? "DRAFT");
  const [featured, setFeatured] = useState<Img[]>(page?.featured_image ? [page.featured_image] : []);
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [newType, setNewType] = useState<BlockType>("paragraph");
  const s = useSubmission();
  const toast = useToast();
  const navigate = useNavigate();
  const rv = useRevalidator();
  const tr = trs[locale];
  const tp = `translations.${locale}`;
  const setTr = (patch: Partial<PageText>) => setTrs((m) => ({ ...m, [locale]: { ...m[locale], ...patch } }));
  const dispatch = (action: BlockAction) => setTrs((m) => ({ ...m, [locale]: { ...m[locale], blocks: blocksReducer(m[locale].blocks, action) } }));

  const save = async () => {
    const translations: Record<string, unknown> = {};
    for (const l of LOCALES) {
      const t = trs[l];
      if (l !== DEFAULT_LOCALE && isEmpty(t)) continue;
      translations[l] = { title: t.title.trim(), slug: t.slug.trim(), seo_title: t.seo_title.trim(), seo_description: t.seo_description.trim(), blocks: t.blocks.map(blockToDTO) };
    }
    const dto = { status, translations, featured_image_id: featured[0]?.id ?? null };
    await s.run(async (signal) => {
      const res = await apiData<{ id: string }>(page ? `/admin/pages/${page.id}` : "/admin/pages", { method: page ? "PUT" : "POST", body: dto, signal });
      toast(adminT("catalog.common.saved"));
      if (!page) navigate(`/admin/content/pages/${res.id}`, { replace: true });
      else rv.revalidate();
    });
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title={page ? nameOf(page.translations, "title") : adminT("catalog.content.new_page")}
        back={{ to: "/admin/content?tab=pages", label: adminT("catalog.content.back") }}
        actions={
          page && (
            <DeleteAction
              title={adminT("catalog.common.delete_title", { item: adminT("catalog.content.page") })}
              body={adminT("catalog.common.delete_body")}
              onDelete={async (signal) => {
                await api(`/admin/pages/${page.id}`, { method: "DELETE", signal });
                navigate("/admin/content?tab=pages", { replace: true });
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
          <SelectField className="max-w-xs" label={adminT("catalog.fields.status")} value={status} onChange={(v) => setStatus(v as ContentStatus)} options={enumOptions("status", ["DRAFT", "PUBLISHED", "ARCHIVED"])} error={s.field("status")} />
          <MediaPicker label={adminT("catalog.content.featured_image")} value={featured} onChange={setFeatured} slug={trs.en.slug || trs.en.title} error={s.field("featured_image_id")} />
        </Section>
        <Section title={adminT("catalog.common.translations")}>
          <TranslationTabs active={locale} onChange={setLocale} issues={localesWithIssues(trs, ["title"], s.codes)} />
          {s.field(tp) && <p className="text-sm text-danger">{s.field(tp)}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label={adminT("catalog.content.page_title")} required={locale === DEFAULT_LOCALE} maxLength={160} value={tr.title} onChange={(v) => setTr({ title: v })} error={s.field(`${tp}.title`)} />
            <TextField label={adminT("catalog.fields.slug")} hint={adminT("catalog.common.slug_hint")} value={tr.slug} onChange={(v) => setTr({ slug: v })} error={s.field(`${tp}.slug`)} />
            <TextField label={adminT("catalog.fields.seo_title")} maxLength={70} value={tr.seo_title} onChange={(v) => setTr({ seo_title: v })} error={s.field(`${tp}.seo_title`)} />
            <TextField label={adminT("catalog.fields.seo_description")} maxLength={170} value={tr.seo_description} onChange={(v) => setTr({ seo_description: v })} error={s.field(`${tp}.seo_description`)} />
          </div>
        </Section>
        <Section title={adminT("catalog.content.blocks_for", { locale: localeLabel(locale) })}>
          {s.field(`${tp}.blocks`) && <p className="text-sm text-danger">{s.field(`${tp}.blocks`)}</p>}
          {tr.blocks.length === 0 ? (
            <p className="text-sm text-muted">{adminT("catalog.content.no_blocks")}</p>
          ) : (
            <ol className="space-y-3">
              {tr.blocks.map((b, i) => (
                <li key={b.key} className="space-y-2 rounded border border-border p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium">{enumLabel("block", b.type)}</span>
                    <div className="flex gap-1">
                      <Button size="sm" variant="ghost" disabled={i === 0} onClick={() => dispatch({ type: "move", key: b.key, delta: -1 })} aria-label={adminT("catalog.common.move_up")}>
                        ↑
                      </Button>
                      <Button size="sm" variant="ghost" disabled={i === tr.blocks.length - 1} onClick={() => dispatch({ type: "move", key: b.key, delta: 1 })} aria-label={adminT("catalog.common.move_down")}>
                        ↓
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => dispatch({ type: "remove", key: b.key })}>
                        {adminT("catalog.common.remove")}
                      </Button>
                    </div>
                  </div>
                  <BlockFields block={b} error={s.field(`${tp}.blocks.${i}`)} onChange={(patch) => dispatch({ type: "update", key: b.key, patch })} />
                </li>
              ))}
            </ol>
          )}
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-sm">
              <span className="block font-medium">{adminT("catalog.content.block_type")}</span>
              <Select value={newType} onChange={(e) => setNewType(e.target.value as BlockType)}>
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {enumLabel("block", t)}
                  </option>
                ))}
              </Select>
            </label>
            <Button variant="secondary" disabled={tr.blocks.length >= 200} onClick={() => dispatch({ type: "add", blockType: newType, key: crypto.randomUUID() })}>
              {adminT("catalog.content.add_block")}
            </Button>
          </div>
        </Section>
        <FormError error={s.error} />
        <Button type="submit" pending={s.pending}>
          {adminT("catalog.common.save")}
        </Button>
      </form>
    </div>
  );
}

function BlockFields({ block, error, onChange }: { block: EditorBlock; error?: string; onChange: (patch: Partial<EditorBlock>) => void }) {
  const err = error ? (
    <p role="alert" className="text-xs text-danger">
      {error}
    </p>
  ) : null;
  switch (block.type) {
    case "heading":
      return (
        <div className="grid gap-3 sm:grid-cols-4">
          <SelectField label={adminT("catalog.content.heading_level")} value={String(block.level)} onChange={(v) => onChange({ level: Number(v) })} options={[2, 3, 4].map((n) => ({ value: String(n), label: `H${n}` }))} />
          <TextField className="sm:col-span-3" label={adminT("catalog.content.text")} maxLength={200} value={block.text} onChange={(v) => onChange({ text: v })} error={error} />
        </div>
      );
    case "paragraph":
    case "quote":
      return <TextareaField label={adminT("catalog.content.text")} rows={block.type === "quote" ? 3 : 5} value={block.text} onChange={(v) => onChange({ text: v })} error={error} />;
    case "list":
      return (
        <div className="space-y-2">
          {block.items.map((it, i) => (
            <div key={i} className="flex items-end gap-2">
              <TextField
                className="flex-1"
                label={adminT("catalog.content.list_item", { n: i + 1 })}
                value={it}
                onChange={(v) => onChange({ items: block.items.map((x, j) => (j === i ? v : x)) })}
              />
              <Button size="sm" variant="ghost" onClick={() => onChange({ items: block.items.filter((_, j) => j !== i) })}>
                {adminT("catalog.common.remove")}
              </Button>
            </div>
          ))}
          <Button size="sm" variant="secondary" disabled={block.items.length >= 50} onClick={() => onChange({ items: [...block.items, ""] })}>
            {adminT("catalog.content.add_list_item")}
          </Button>
          {err}
        </div>
      );
    case "image":
      return (
        <MediaPicker
          label={adminT("catalog.content.image")}
          value={block.image ? [block.image] : block.media_id ? [{ id: block.media_id, status: "READY", alt: block.media_id, width: 0, height: 0, sources: [] }] : []}
          onChange={(v) => onChange({ media_id: v[0]?.id ?? null, image: v[0] ?? null })}
          error={error}
        />
      );
    case "cta":
      return (
        <div className="grid gap-3 sm:grid-cols-2">
          <TextField label={adminT("catalog.content.cta_label")} maxLength={80} value={block.label} onChange={(v) => onChange({ label: v })} error={error} />
          <TextField label={adminT("catalog.content.cta_url")} value={block.url} onChange={(v) => onChange({ url: v })} hint={adminT("catalog.content.url_hint")} />
        </div>
      );
  }
}
