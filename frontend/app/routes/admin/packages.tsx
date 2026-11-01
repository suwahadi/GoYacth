import type { Route } from "./+types/packages";
import { ButtonLink, DataTable, EmptyState, type Column } from "~/components/ui";
import { settle } from "~/features/admin-catalog/data";
import { nameOf } from "~/features/admin-catalog/translations";
import type { AdminPackageSummary } from "~/features/admin-catalog/types";
import { LoadFailed, PageHeader, StatusPill, adminMeta, enumLabel } from "~/features/admin-catalog/ui";
import { apiData } from "~/lib/api";
import { formatPlainDate } from "~/lib/format";
import { adminT } from "~/lib/i18n";

export function meta() {
  return adminMeta("catalog.packages.title");
}

export async function loader({ request }: Route.LoaderArgs) {
  return { result: await settle(apiData<AdminPackageSummary[]>("/admin/packages", { request })) };
}

export default function Packages({ loaderData }: Route.ComponentProps) {
  const { result } = loaderData;
  const columns: Column<AdminPackageSummary>[] = [
    { key: "name", header: adminT("catalog.fields.name"), primary: true, cell: (p) => nameOf(p.translations) || p.id },
    { key: "mode", header: adminT("catalog.packages.mode"), cell: (p) => enumLabel("mode", p.mode) },
    { key: "valid", header: adminT("catalog.packages.validity"), cell: (p) => `${formatPlainDate(p.valid_from, "en")} – ${formatPlainDate(p.valid_until, "en")}` },
    { key: "status", header: adminT("catalog.fields.status"), cell: (p) => <StatusPill status={p.status} /> },
  ];
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("catalog.packages.title")} actions={<ButtonLink to="/admin/packages/new">{adminT("catalog.packages.new")}</ButtonLink>} />
      {!result.ok ? (
        <LoadFailed code={result.code} />
      ) : result.data.length === 0 ? (
        <EmptyState title={adminT("catalog.packages.empty")} action={<ButtonLink to="/admin/packages/new">{adminT("catalog.packages.new")}</ButtonLink>} />
      ) : (
        <DataTable rows={result.data} columns={columns} rowKey={(p) => p.id} onRowHref={(p) => `/admin/packages/${p.id}`} />
      )}
    </div>
  );
}
