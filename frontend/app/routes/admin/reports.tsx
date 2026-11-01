import type { Route } from "./+types/reports";
import { Alert, DataTable, EmptyState, Field, FilterBar, Input, Select } from "~/components/ui";
import { load, useFilterParams } from "~/features/admin-ops/hooks";
import { ADMIN_TZ, addDays, isValidYmd, todayIn } from "~/features/admin-ops/time";
import { DocLink, LoadFailure, PageHeader, Pending, Section, apiHref, idr, opsCode, when } from "~/features/admin-ops/ui";
import { apiData } from "~/lib/api";
import { adminT } from "~/lib/i18n";

const KINDS = ["bookings", "revenue", "boats", "routes", "packages", "cancellations"] as const;
const MONEY = new Set(["grand_total", "amount_paid", "fees_paid", "amount_refunded", "gross_received", "refunded", "net", "principal_received", "forfeited", "refund_total", "refunded_completed"]);
const TIMES = new Set(["created_at", "starts_at", "cancelled_at"]);
const CODES: Record<string, string> = { status: "booking_status", payment_status: "booking_status", mode: "mode", method: "method", cancel_type: "cancel_type" };

type Row = Record<string, string | number | null>;

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const today = todayIn(ADMIN_TZ);
  const kind = KINDS.find((k) => k === url.searchParams.get("kind")) ?? "bookings";
  const from = url.searchParams.get("from") || addDays(today, -30);
  const to = url.searchParams.get("to") || today;
  const valid = isValidYmd(from) && isValidYmd(to);
  const rows = valid ? await load(apiData<Row[]>(`/admin/reports/${kind}`, { request, query: { from, to, format: "json" } })) : null;
  return { kind, from, to, rows };
}

export function meta() {
  return [{ title: `${adminT("ops.reports.title")} | GoYacht Admin` }];
}

function cell(key: string, v: Row[string]): string {
  if (v === null || v === "") return "—";
  if (MONEY.has(key) && typeof v === "number") return idr(v);
  if (TIMES.has(key) && typeof v === "string") return when(v, ADMIN_TZ);
  if (CODES[key] && typeof v === "string") return opsCode(CODES[key], v);
  return String(v);
}

export default function ReportsPage({ loaderData }: Route.ComponentProps) {
  const f = useFilterParams();
  const { kind, from, to, rows } = loaderData;
  const columns = rows?.data?.[0] ? Object.keys(rows.data[0]) : [];
  const download = (format: "csv" | "xlsx") => apiHref(`/admin/reports/${kind}`, { from, to, format });
  return (
    <div className="space-y-4">
      <PageHeader title={adminT("ops.reports.title")}>
        <p className="text-sm text-muted">{adminT("ops.reports.intro")}</p>
      </PageHeader>
      <FilterBar activeCount={f.activeCount(["from", "to"])} onClear={() => f.clear(["from", "to"])}>
        <Field label={adminT("ops.reports.kind")}>
          {(p) => (
            <Select {...p} value={kind} onChange={(e) => f.set({ kind: e.target.value })}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {opsCode("report", k)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={adminT("ops.bookings.from")}>{(p) => <Input {...p} type="date" value={from} onChange={(e) => f.set({ from: e.target.value })} />}</Field>
        <Field label={adminT("ops.bookings.to")}>{(p) => <Input {...p} type="date" value={to} onChange={(e) => f.set({ to: e.target.value })} />}</Field>
      </FilterBar>
      <Section
        title={opsCode("report", kind)}
        actions={
          <>
            <DocLink href={download("csv")}>{adminT("ops.reports.csv")}</DocLink>
            <DocLink href={download("xlsx")}>{adminT("ops.reports.xlsx")}</DocLink>
          </>
        }
      >
        <p className="text-xs text-muted">{adminT(kind === "revenue" ? "ops.reports.revenue_note" : "ops.reports.range_note")}</p>
        <Pending>
          {!rows ? (
            <Alert tone="warning">{adminT("ops.reports.invalid_range")}</Alert>
          ) : rows.error ? (
            <LoadFailure error={rows.error} />
          ) : rows.data.length === 0 ? (
            <EmptyState title={adminT("ops.reports.empty")} />
          ) : (
            <DataTable
              rows={rows.data.map((r, i) => ({ ...r, __i: i }))}
              rowKey={(r) => String(r.__i)}
              columns={columns.map((c, i) => ({ key: c, header: opsCode("report_column", c), cell: (r: Row) => cell(c, r[c]), primary: i === 0 }))}
            />
          )}
        </Pending>
      </Section>
    </div>
  );
}
