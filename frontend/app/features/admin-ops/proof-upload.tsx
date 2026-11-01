import { useEffect, useId, useRef, useState } from "react";

import { api } from "~/lib/api";
import { adminT } from "~/lib/i18n";

import type { MediaStatus } from "./types";
import { OpsError, apiHref } from "./ui";

type Phase = "idle" | "uploading" | "processing" | "ready" | "failed";

const POLL_MS = 1500;
const MAX_POLLS = 40;

// ProofUpload stores a transfer proof in the private bucket and reports its media ID only once
// processing has finished, because the API rejects proofs that are not READY.
export function ProofUpload({ slug, required, onChange }: { slug: string; required?: boolean; onChange: (mediaId: string | null) => void }) {
  const id = useId();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<unknown>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const ctrl = useRef<AbortController | null>(null);
  useEffect(() => () => ctrl.current?.abort(), []);

  const upload = async (file: File) => {
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    onChange(null);
    setMediaId(null);
    setError(null);
    setPhase("uploading");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("slug", slug);
      form.set("private", "true");
      const created = await api<{ id: string; status: string }>("/admin/media", { method: "POST", body: form, signal: c.signal });
      setPhase("processing");
      let status = created.data.status;
      for (let i = 0; status !== "READY" && status !== "FAILED" && i < MAX_POLLS; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        if (c.signal.aborted) return;
        status = (await api<MediaStatus>(`/admin/media/${created.data.id}`, { signal: c.signal })).data.image.status;
      }
      if (status !== "READY") {
        setPhase("failed");
        return;
      }
      setMediaId(created.data.id);
      setPhase("ready");
      onChange(created.data.id);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setError(e);
      setPhase("failed");
    }
  };

  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium">
        {adminT("ops.proof.label")}
        {required && <span className="text-danger"> *</span>}
      </label>
      <input
        id={id}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="block w-full text-sm"
        disabled={phase === "uploading" || phase === "processing"}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
        }}
      />
      <p className="text-xs text-muted" aria-live="polite">
        {phase === "idle" && adminT("ops.proof.hint")}
        {phase === "uploading" && adminT("ops.proof.uploading")}
        {phase === "processing" && adminT("ops.proof.processing")}
        {phase === "ready" && mediaId && (
          <a href={apiHref(`/admin/files/${mediaId}`)} target="_blank" rel="noopener" className="text-primary hover:underline">
            {adminT("ops.proof.ready")}
          </a>
        )}
        {phase === "failed" && !error && <span className="text-danger">{adminT("ops.proof.failed")}</span>}
      </p>
      <OpsError error={error} />
    </div>
  );
}
