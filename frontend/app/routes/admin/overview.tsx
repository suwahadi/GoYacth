import { Link } from "react-router";

import type { Route } from "./+types/overview";
import { AlertIcon, BanknoteIcon, CalendarIcon, CalendarWeekIcon, Card, DataTable, EmptyState, HourglassIcon, InboxIcon, RefundIcon, StarIcon } from "~/components/ui";
import { load } from "~/features/admin-ops/hooks";
import type { Overview } from "~/features/admin-ops/types";
import { LoadFailure, PageHeader, Section, idr, opsCode, when } from "~/features/admin-ops/ui";
import { apiData } from "~/lib/api";
import { adminT, type AdminKey } from "~/lib/i18n";

export async function loader({ request }: Route.LoaderArgs) {
  return load(apiData<Overview>("/admin/overview", { request }));
}

export function meta() {
  return [{ title: `${adminT("ops.overview.title")} | GoYacht Admin` }];
}

type Ornament = typeof CalendarIcon;

const tiles: { key: keyof Overview["counts"]; label: AdminKey; to: string; icon: Ornament }[] = [
  { key: "bookings_today", label: "ops.overview.bookings_today", to: "/admin/bookings", icon: CalendarIcon },
  { key: "bookings_week", label: "ops.overview.bookings_week", to: "/admin/bookings", icon: CalendarWeekIcon },
  { key: "pending_payments", label: "ops.overview.pending_payments", to: "/admin/payments?status=PENDING", icon: HourglassIcon },
  { key: "exceptions", label: "ops.overview.exceptions", to: "/admin/payments?tab=exceptions", icon: AlertIcon },
  { key: "pending_requests", label: "ops.overview.pending_requests", to: "/admin/bookings?tab=requests", icon: InboxIcon },
  { key: "open_refunds", label: "ops.overview.open_refunds", to: "/admin/refunds", icon: RefundIcon },
  { key: "pending_reviews", label: "ops.overview.pending_reviews", to: "/admin/reviews", icon: StarIcon },
];

// A faint outline of what the number counts, tucked into the bottom-right corner and cut off by it.
// It only decorates: the label says the same thing in words.
function CornerOrnament({ icon: Icon, className }: { icon: Ornament; className: string }) {
  return <Icon strokeWidth={1} aria-hidden="true" className={`pointer-events-none absolute -z-10 text-primary opacity-[0.09] ${className}`} />;
}

export default function OverviewPage({ loaderData }: Route.ComponentProps) {
  if (loaderData.error) return <LoadFailure error={loaderData.error} />;
  const { counts, upcoming } = loaderData.data;
  return (
    <div className="space-y-6">
      <PageHeader title={adminT("ops.overview.title")} />
      <Card className="relative isolate overflow-hidden">
        <CornerOrnament icon={BanknoteIcon} className="-bottom-8 -right-2 size-32" />
        <p className="text-sm text-muted">{adminT("ops.overview.revenue_month")}</p>
        <p className="text-2xl font-semibold">{idr(counts.revenue_month - counts.refunds_month)}</p>
        <p className="text-xs text-muted">
          {adminT("ops.overview.revenue_breakdown", { received: idr(counts.revenue_month), refunded: idr(counts.refunds_month) })}
        </p>
      </Card>
      <ul className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((tile) => (
          <li key={tile.key}>
            <Link to={tile.to} className="relative isolate block overflow-hidden rounded-lg border border-border bg-surface p-3 hover:bg-surface-2">
              <CornerOrnament icon={tile.icon} className="-bottom-4 -right-3 size-20" />
              <span className="block text-xs text-muted">{adminT(tile.label)}</span>
              <span className="block text-xl font-semibold">{counts[tile.key]}</span>
            </Link>
          </li>
        ))}
      </ul>
      <Section title={adminT("ops.overview.upcoming")}>
        {upcoming.length === 0 ? (
          <EmptyState title={adminT("ops.overview.upcoming_empty")} />
        ) : (
          <DataTable
            rows={upcoming}
            rowKey={(r) => r.id}
            onRowHref={(r) => `/admin/bookings/${r.id}`}
            columns={[
              { key: "number", header: adminT("ops.bookings.number"), cell: (r) => r.booking_number, primary: true },
              { key: "starts", header: adminT("ops.bookings.starts"), cell: (r) => when(r.starts_at, r.timezone) },
              { key: "boat", header: adminT("ops.bookings.boat"), cell: (r) => r.boat_name },
              { key: "mode", header: adminT("ops.bookings.mode"), cell: (r) => opsCode("mode", r.mode) },
              { key: "pax", header: adminT("ops.bookings.pax"), cell: (r) => r.pax },
            ]}
          />
        )}
      </Section>
    </div>
  );
}
