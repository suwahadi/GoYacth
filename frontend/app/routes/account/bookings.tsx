import { data, useNavigation, useRevalidator } from "react-router";

import type { Route } from "./+types/bookings";
import { ButtonLink, DataTable, EmptyState, ErrorState, Money, Pagination, SkeletonList, StatusBadge, useApiErrorText, type Column } from "~/components/ui";
import { isUnauthenticated, loginRedirect, privateHeaders } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { deserializeError, responseStatus, serializeError } from "~/features/booking/routeErrors";
import { api, type Page } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { Booking } from "~/lib/types";

export async function loader({ request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const { locale } = splitLocale(url.pathname);
  const page = Number(url.searchParams.get("page")) || 1;
  try {
    const res = await api<Booking[]>("/account/bookings", { request, query: { page, locale } });
    return data({ rows: res.data, page: res.meta ?? null, error: null }, { headers: privateHeaders });
  } catch (e) {
    if (isUnauthenticated(e)) throw loginRedirect(request);
    const error = serializeError(e);
    return data({ rows: [] as Booking[], page: null as Page | null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "account.bookings.title");
}

export default function AccountBookings({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const { rows, page, error } = loaderData;

  const columns: Column<Booking>[] = [
    { key: "number", header: t("account.bookings.number"), cell: (b) => b.booking_number, primary: true },
    { key: "date", header: t("account.bookings.date"), cell: (b) => formatDateTime(b.starts_at, b.timezone, locale) },
    { key: "boat", header: t("account.bookings.boat"), cell: (b) => b.boat_name },
    { key: "status", header: t("account.bookings.status"), cell: (b) => <StatusBadge status={b.status} /> },
    { key: "payment", header: t("account.bookings.payment"), cell: (b) => <StatusBadge status={b.payment_status} /> },
    { key: "total", header: t("account.bookings.total"), cell: (b) => <Money amount={b.grand_total} />, className: "text-right" },
  ];

  return (
    <section aria-labelledby="bookings-heading">
      <h2 id="bookings-heading" className="text-lg font-semibold">
        {t("account.bookings.title")}
      </h2>
      <div className="mt-3">
        {navigation.state === "loading" && navigation.location?.pathname === localePath(locale, "/account") ? (
          <SkeletonList />
        ) : error ? (
          <ErrorState message={errorText(deserializeError(error))} onRetry={() => revalidator.revalidate()} />
        ) : rows.length === 0 ? (
          <EmptyState
            title={t("account.bookings.empty_title")}
            body={t("account.bookings.empty_body")}
            action={<ButtonLink to={localePath(locale, "/boats")}>{t("account.bookings.browse")}</ButtonLink>}
          />
        ) : (
          <>
            <DataTable rows={rows} columns={columns} rowKey={(b) => b.id} onRowHref={(b) => localePath(locale, `/account/bookings/${b.id}`)} />
            {page && <Pagination page={page} />}
          </>
        )}
      </div>
    </section>
  );
}
