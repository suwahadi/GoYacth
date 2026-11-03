import { useEffect, useRef, useState } from "react";

import { Button, Dialog, EmptyState, ResponsiveImage, SkeletonList } from "~/components/ui";
import { ApiError, api, apiData, type Page } from "~/lib/api";
import { LOCALES, type Locale } from "~/lib/config";
import { adminT } from "~/lib/i18n";
import type { Img } from "~/lib/types";

import type { MediaDetail } from "./types";
import { FormError, StatusPill, TextField, localeLabel, useErrorText, useSubmission } from "./ui";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const POLL_MS = 1500;
const POLL_LIMIT = 120;

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const h = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(h);
      reject(new DOMException("aborted", "AbortError"));
    });
  });
}

// pollMedia waits for the background conversion job; the upload response only says PROCESSING.
export async function pollMedia(id: string, signal: AbortSignal): Promise<MediaDetail> {
  for (let i = 0; i < POLL_LIMIT; i++) {
    const d = await apiData<MediaDetail>(`/admin/media/${id}`, { signal });
    if (d.image.status !== "PROCESSING") return d;
    await sleep(POLL_MS, signal);
  }
  throw new ApiError(0, "MEDIA_NOT_READY", "processing timed out");
}

// Private uploads (payment proofs) are READY but expose no public sources and cannot be
// attached to public content.
function isSelectable(img: Img) {
  return img.status === "PROCESSING" || (img.status === "READY" && img.sources.length > 0);
}

export function MediaThumb({ image, className }: { image: Img; className?: string }) {
  return (
    <figure className={className}>
      {image.sources.length > 0 ? (
        <ResponsiveImage image={image} sizes="160px" className="aspect-[4/3] w-full rounded" />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded bg-surface-2 text-xs text-muted">
          <StatusPill status={image.status} />
        </div>
      )}
      <figcaption className="mt-1 truncate text-xs text-muted">{image.alt || adminT("catalog.media.no_alt")}</figcaption>
    </figure>
  );
}

// MediaUploadForm is a plain group, not a <form>, because pickers render inside entity forms.
export function MediaUploadForm({ slug, onReady }: { slug?: string; onReady: (img: Img) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(slug ?? "");
  const [alts, setAlts] = useState<Record<Locale, string>>(() => Object.fromEntries(LOCALES.map((l) => [l, ""])) as Record<Locale, string>);
  const [status, setStatus] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const s = useSubmission();
  const submit = () =>
    s.run(async (signal) => {
      setFailure(null);
      if (!file) {
        s.invalid({ file: "REQUIRED" });
        return;
      }
      if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(422, "MEDIA_FILE_TOO_LARGE", "file too large");
      const body = new FormData();
      body.set("file", file);
      body.set("slug", name);
      for (const l of LOCALES) body.set(`alt_${l}`, alts[l]);
      const uploaded = await apiData<Img>("/admin/media", { method: "POST", body, signal });
      setStatus(uploaded.status);
      const done = await pollMedia(uploaded.id, signal);
      setStatus(done.image.status);
      if (done.image.status === "READY") {
        onReady(done.image);
        setFile(null);
        if (fileRef.current) fileRef.current.value = "";
        setAlts(Object.fromEntries(LOCALES.map((l) => [l, ""])) as Record<Locale, string>);
      } else {
        setFailure(done.failure_reason || adminT("catalog.media.failed"));
      }
    });
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label htmlFor="media-file" className="block text-sm font-medium">
          {adminT("catalog.media.file")}
        </label>
        <input
          id="media-file"
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="block w-full text-sm"
          aria-invalid={s.field("file") ? true : undefined}
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <p className="text-xs text-muted">{s.field("file") ?? adminT("catalog.media.file_hint")}</p>
      </div>
      <TextField label={adminT("catalog.media.slug")} hint={adminT("catalog.media.slug_hint")} value={name} onChange={setName} error={s.field("slug")} />
      {LOCALES.map((l) => (
        <TextField
          key={l}
          required
          label={adminT("catalog.media.alt", { locale: localeLabel(l) })}
          value={alts[l]}
          maxLength={250}
          onChange={(v) => setAlts((a) => ({ ...a, [l]: v }))}
          error={s.field(`alt_${l}`)}
        />
      ))}
      <FormError error={s.error} />
      {status && (
        <p className="text-sm" role="status">
          {adminT("catalog.media.status")}: <StatusPill status={status} />
        </p>
      )}
      {failure && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}
      <Button pending={s.pending} onClick={() => void submit()}>
        {adminT("catalog.media.upload")}
      </Button>
    </div>
  );
}

export function useMediaPage(open: boolean, page: number) {
  const [state, setState] = useState<{ loading: boolean; rows: Img[]; meta: Page | null; error: unknown }>({ loading: true, rows: [], meta: null, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController();
    setState((s) => ({ ...s, loading: true, error: null }));
    api<Img[]>("/admin/media", { query: { page, per_page: 24 }, signal: c.signal })
      .then((r) => setState({ loading: false, rows: r.data, meta: r.meta ?? null, error: null }))
      .catch((e) => {
        if ((e as Error).name !== "AbortError") setState({ loading: false, rows: [], meta: null, error: e });
      });
    return () => c.abort();
  }, [open, page, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

function MediaLibraryDialog({ open, onClose, onPick, slug }: { open: boolean; onClose: () => void; onPick: (img: Img) => void; slug?: string }) {
  const [page, setPage] = useState(1);
  const [uploading, setUploading] = useState(false);
  const lib = useMediaPage(open, page);
  const text = useErrorText();
  const totalPages = lib.meta ? Math.max(1, Math.ceil(lib.meta.total / lib.meta.per_page)) : 1;
  return (
    <Dialog open={open} onClose={onClose} title={adminT("catalog.media.choose")} size="lg">
      <div className="space-y-4">
        <Button variant="secondary" size="sm" onClick={() => setUploading((u) => !u)}>
          {uploading ? adminT("catalog.media.hide_upload") : adminT("catalog.media.upload_new")}
        </Button>
        {uploading && (
          <MediaUploadForm
            slug={slug}
            onReady={(img) => {
              onPick(img);
              lib.reload();
            }}
          />
        )}
        {lib.loading ? (
          <SkeletonList rows={3} />
        ) : lib.error ? (
          <div className="space-y-2">
            <p role="alert" className="text-sm text-danger">
              {text(lib.error)}
            </p>
            <Button variant="secondary" size="sm" onClick={lib.reload}>
              {adminT("catalog.common.retry")}
            </Button>
          </div>
        ) : lib.rows.length === 0 ? (
          <EmptyState title={adminT("catalog.media.empty")} />
        ) : (
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {lib.rows.map((img) => (
              <li key={img.id}>
                <button type="button" disabled={!isSelectable(img)} className="w-full text-left disabled:opacity-50" onClick={() => onPick(img)}>
                  <MediaThumb image={img} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {totalPages > 1 && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {adminT("catalog.common.previous")}
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {adminT("catalog.common.next")}
            </Button>
          </div>
        )}
      </div>
    </Dialog>
  );
}

// MediaPicker selects one image (thumbnail, featured image) or an ordered gallery from the
// library, with upload in place. The form submits only the IDs.
export function MediaPicker({ label, value, onChange, multiple, slug, error }: { label: string; value: Img[]; onChange: (v: Img[]) => void; multiple?: boolean; slug?: string; error?: string }) {
  const [open, setOpen] = useState(false);
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= value.length) return;
    const next = value.slice();
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{label}</legend>
      {value.length === 0 ? (
        <p className="text-sm text-muted">{adminT("catalog.media.none_selected")}</p>
      ) : (
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {value.map((img, i) => (
            <li key={img.id} className="space-y-1">
              <MediaThumb image={img} />
              <div className="flex flex-wrap gap-1">
                {multiple && (
                  <>
                    <Button size="sm" variant="secondary" disabled={i === 0} onClick={() => move(i, -1)} aria-label={adminT("catalog.common.move_up")}>
                      ↑
                    </Button>
                    <Button size="sm" variant="secondary" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label={adminT("catalog.common.move_down")}>
                      ↓
                    </Button>
                  </>
                )}
                <Button size="sm" variant="secondary" onClick={() => onChange(value.filter((x) => x.id !== img.id))}>
                  {adminT("catalog.common.remove")}
                </Button>
              </div>
            </li>
          ))}
        </ol>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        {multiple ? adminT("catalog.media.add_images") : value.length ? adminT("catalog.media.replace") : adminT("catalog.media.choose")}
      </Button>
      <MediaLibraryDialog
        open={open}
        slug={slug}
        onClose={() => setOpen(false)}
        onPick={(img) => {
          if (multiple) {
            if (!value.some((x) => x.id === img.id)) onChange([...value, img]);
          } else {
            onChange([img]);
            setOpen(false);
          }
        }}
      />
    </fieldset>
  );
}

export function mediaIds(imgs: Img[]): string[] {
  return imgs.map((i) => i.id);
}

export function firstId(imgs: Img[]): string | null {
  return imgs[0]?.id ?? null;
}
