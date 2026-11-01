import { useNavigation, useSearchParams } from "react-router";

import type { Route } from "./+types/boats";
import { ButtonLink, DataTable, EmptyState, FilterBar, Pagination, Select, SkeletonList, type Column } from "~/components/ui";
import { loadPage, settle } from "~/features/admin-catalog/data";
import { nameOf } from "~/features/admin-catalog/translations";
import type { AdminBoat } from "~/features/admin-catalog/types";
import { LoadFailed, PageHeader, StatusPill, adminMeta, enumLabel } from "~/features/admin-catalog/ui";
import { adminT } from "~/lib/i18n";

const STATUSES = ["DRAFT", "PUBLISHED", "ARCHIVED"] as const;

export function meta() {
  return adminMeta("catalog.boats.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const status = url.searchParams.get("status") ?? undefined;
  const page = url.searchParams.get("page") ?? undefined;
  return { result: await settle(loadPage<AdminBoat>("/admin/boats", request, { status, page, per_page: 25 })) };
}

export default function Boats({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const status = params.get("status") ?? "";
  const columns: Column<AdminBoat>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (b) => nameOf(b.translations) || b.code },
    { key: "code", header: adminT("catalog.fields.code"), cell: (b) => b.code },
    { key: "status", header: adminT("catalog.fields.status"), cell: (b) => <StatusPill status={b.status} /> },
    { key: "ownership", header: adminT("catalog.boats.ownership"), cell: (b) => enumLabel("ownership", b.ownership) },
    { key: "capacity", header: adminT("catalog.boats.max_passengers"), cell: (b) => b.max_passengers },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.boats.title")} actions={<ButtonLink to="/admin/boats/new">{adminT("catalog.boats.new")}</ButtonLink>} />
      <FilterBar activeCount={status ? 1 : 0} onClear={() => setParams({})}>
        <label className="space-y-1 text-sm">
          <span className="block font-medium">{adminT("catalog.fields.status")}</span>
          <Select value={status} onChange={(e) => setParams(e.target.value ? { status: e.target.value } : {})}>
            <option value="">{adminT("catalog.common.all")}</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {enumLabel("status", s)}
              </option>
            ))}
          </Select>
        </label>
      </FilterBar>
      {nav.state === "loading" && nav.location?.pathname === "/admin/boats" ? (
        <SkeletonList />
      ) : !result.ok ? (
        <LoadFailed code={result.code} />
      ) : result.data.rows.length === 0 ? (
        <EmptyState title={adminT("catalog.boats.empty")} action={<ButtonLink to="/admin/boats/new">{adminT("catalog.boats.new")}</ButtonLink>} />
      ) : (
        <>
          <DataTable rows={result.data.rows} columns={columns} rowKey={(b) => b.id} onRowHref={(b) => `/admin/boats/${b.id}`} />
          {result.data.page && <Pagination page={result.data.page} />}
        </>
      )}
    </div>
  );
}
