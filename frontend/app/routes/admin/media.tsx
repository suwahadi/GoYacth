import { useEffect, useState } from "react";
import { useNavigation, useRevalidator } from "react-router";

import type { Route } from "./+types/media";
import { Button, EmptyState, Pagination, SkeletonList, useToast } from "~/components/ui";
import { loadPage, settle } from "~/features/admin-catalog/data";
import { MediaThumb, MediaUploadForm, pollMedia } from "~/features/admin-catalog/media";
import { localizedText } from "~/features/admin-catalog/translations";
import { FormDialog, FormError, LoadFailed, PageHeader, Section, StatusPill, TextField, adminMeta, localeLabel, useSubmission } from "~/features/admin-catalog/ui";
import { api } from "~/lib/api";
import { LOCALES } from "~/lib/config";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

export function meta() {
  return adminMeta("catalog.media.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  const page = new URL(request.url).searchParams.get("page") ?? undefined;
  return { result: await settle(loadPage<Img>("/admin/media", request, { page, per_page: 40 })) };
}

export default function Media({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;
  const nav = useNavigation();
  const rv = useRevalidator();
  const [editing, setEditing] = useState<Img | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.media.title")} />
      <Section title={adminT("catalog.media.upload_new")}>
        <MediaUploadForm onReady={() => rv.revalidate()} />
      </Section>
      {nav.state === "loading" && nav.location?.pathname === "/admin/media" ? (
        <SkeletonList />
      ) : !result.ok ? (
        <LoadFailed code={result.code} />
      ) : result.data.rows.length === 0 ? (
        <EmptyState title={adminT("catalog.media.empty")} />
      ) : (
        <>
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {result.data.rows.map((img) => (
              <MediaTile key={img.id} image={img} onEdit={setEditing} />
            ))}
          </ul>
          {result.data.page && <Pagination page={result.data.page} />}
        </>
      )}
      {editing && (
        <AltDialog
          image={editing}
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

// MediaTile polls items still being converted so the library reflects READY or FAILED without a
// manual reload.
function MediaTile({ image, onEdit }: { image: Img; onEdit: (img: Img) => void }) {
  const [current, setCurrent] = useState(image);
  const [failure, setFailure] = useState<string | null>(null);
  useEffect(() => setCurrent(image), [image]);
  useEffect(() => {
    if (image.status !== "PROCESSING") return;
    const c = new AbortController();
    pollMedia(image.id, c.signal)
      .then((d) => {
        setCurrent({ ...d.image, alt_texts: d.image.alt_texts ?? image.alt_texts });
        setFailure(d.failure_reason);
      })
      .catch(() => undefined);
    return () => c.abort();
  }, [image]);
  return (
    <li className="space-y-1">
      <MediaThumb image={current} />
      <div className="flex flex-wrap items-center justify-between gap-1">
        <StatusPill status={current.status} />
        <Button size="sm" variant="secondary" onClick={() => onEdit(current)}>
          {adminT("catalog.media.edit_alt")}
        </Button>
      </div>
      {current.status === "FAILED" && failure && <p className="text-xs text-danger">{failure}</p>}
      {current.width > 0 && <p className="text-xs text-muted">{adminT("catalog.media.dimensions", { w: current.width, h: current.height })}</p>}
    </li>
  );
}

function AltDialog({ image, onClose, onSaved }: { image: Img; onClose: () => void; onSaved: () => void }) {
  const [alts, setAlts] = useState(() => localizedText(image.alt_texts));
  const s = useSubmission();
  const toast = useToast();
  const save = async () => {
    const ok = await s.run(async (signal) => {
      await api(`/admin/media/${image.id}`, { method: "PATCH", body: { alt_texts: alts }, signal });
    });
    if (ok) {
      toast(adminT("catalog.common.saved"));
      onSaved();
    }
  };
  return (
    <FormDialog id="alt-form" size="md" title={adminT("catalog.media.edit_alt")} pending={s.pending} onClose={onClose} onSubmit={() => void save()}>
      <MediaThumb image={image} className="max-w-48" />
      {LOCALES.map((l) => (
        <TextField
          key={l}
          required
          maxLength={250}
          label={adminT("catalog.media.alt", { locale: localeLabel(l) })}
          value={alts[l]}
          onChange={(v) => setAlts({ ...alts, [l]: v })}
          error={s.field(`alt_texts.${l}`) ?? s.field(`alt_${l}`)}
        />
      ))}
      <FormError error={s.error} />
    </FormDialog>
  );
}
