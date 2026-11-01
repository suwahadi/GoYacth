import { useState } from "react";

import type { Route } from "./+types/audit";
import { Button, EmptyState, FilterBar, Pagination, cn } from "~/components/ui";
import { diffJson } from "~/features/admin-ops/diff";
import { loadList, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ } from "~/features/admin-ops/time";
import type { AuditEntry } from "~/features/admin-ops/types";
import { LoadFailure, PageHeader, Pending, TextFilter, when } from "~/features/admin-ops/ui";
import { adminT } from "~/lib/i18n";

const FILTERS = ["entity_type", "entity_id", "actor_id"];

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const q = (k: string) => url.searchParams.get(k) || undefined;
  return loadList<AuditEntry>("/admin/audit-logs", { request, query: { entity_type: q("entity_type"), entity_id: q("entity_id"), actor_id: q("actor_id"), page: q("page") } });
}

export function meta() {
  return [{ title: `${adminT("ops.audit.title")} | GoYacht Admin` }];
}

const kindClass = {
  added: "text-success",
  removed: "text-danger line-through",
  changed: "text-warning",
  same: "text-muted",
} as const;

function Diff({ entry }: { entry: AuditEntry }) {
  const rows = diffJson(entry.before, entry.after);
  if (rows.length === 0) return <p className="text-sm text-muted">{adminT("ops.audit.no_data")}</p>;
  return (
    <table className="w-full table-fixed text-xs">
      <thead className="text-left text-muted">
        <tr>
          <th scope="col" className="w-1/3 py-1 font-medium">
            {adminT("ops.audit.field")}
          </th>
          <th scope="col" className="py-1 font-medium">
            {adminT("ops.audit.before")}
          </th>
          <th scope="col" className="py-1 font-medium">
            {adminT("ops.audit.after")}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path} className="border-t border-border align-top">
            <th scope="row" className="break-all py-1 pr-2 text-left font-mono font-normal">
              {r.path}
            </th>
            <td className={cn("break-all py-1 pr-2 font-mono", r.kind === "removed" || r.kind === "changed" ? kindClass[r.kind] : undefined)}>{r.before ?? "—"}</td>
            <td className={cn("break-all py-1 font-mono", r.kind === "added" || r.kind === "changed" ? kindClass[r.kind] : kindClass.same)}>{r.after ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function AuditPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.audit.title")}>
        <p className="text-sm text-muted">{adminT("ops.audit.intro")}</p>
      </PageHeader>
      <FilterBar activeCount={f.activeCount(FILTERS)} onClear={() => f.clear(FILTERS)}>
        <TextFilter label={adminT("ops.audit.entity_type")} placeholder={adminT("ops.audit.entity_type_hint")} value={f.get("entity_type")} onCommit={(v) => f.set({ entity_type: v })} />
        <TextFilter label={adminT("ops.audit.entity_id")} value={f.get("entity_id")} onCommit={(v) => f.set({ entity_id: v })} />
        <TextFilter label={adminT("ops.audit.actor_id")} value={f.get("actor_id")} onCommit={(v) => f.set({ actor_id: v })} />
      </FilterBar>
      {loaderData.error ? (
        <LoadFailure error={loaderData.error} />
      ) : (
        <Pending>
          {loaderData.data.rows.length === 0 ? (
            <EmptyState title={adminT("ops.audit.empty")} />
          ) : (
            <>
              <ul className="space-y-2">
                {loaderData.data.rows.map((e) => (
                  <li key={e.id} className="rounded-lg border border-border bg-surface p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">{e.action}</p>
                        <p className="break-all text-muted">
                          {e.entity_type} · {e.entity_id}
                        </p>
                        <p className="text-xs text-muted">
                          {when(e.created_at, ADMIN_TZ)} · {e.actor_email ?? adminT("ops.audit.system")}
                          {e.ip_address && ` · ${e.ip_address}`}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)}>
                        {adminT(open === e.id ? "ops.audit.hide" : "ops.audit.show")}
                      </Button>
                    </div>
                    {open === e.id && (
                      <div className="mt-2 space-y-2">
                        <Diff entry={e} />
                        <p className="text-xs text-muted">{adminT("ops.audit.request_id", { id: e.request_id || "—" })}</p>
                        <button type="button" className="text-xs text-primary hover:underline" onClick={() => f.set({ entity_type: e.entity_type, entity_id: e.entity_id })}>
                          {adminT("ops.audit.filter_entity")}
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
              {loaderData.data.page && <Pagination page={loaderData.data.page} />}
            </>
          )}
        </Pending>
      )}
    </div>
  );
}
