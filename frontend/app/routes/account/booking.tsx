import type { ReactNode } from "react";
import { data, useRevalidator } from "react-router";

import type { Route } from "./+types/booking";
import { Alert, ButtonLink, Card, ErrorState, Money, StatusBadge, useApiErrorText } from "~/components/ui";
import { BookingActions } from "~/features/account/BookingActions";
import { PaymentsSection } from "~/features/account/PaymentsSection";
import { RefundsSection } from "~/features/account/RefundsSection";
import { ReviewSection } from "~/features/account/ReviewSection";
import { isUnauthenticated, loginRedirect, privateHeaders } from "~/features/account/session";
import type { CustomerRefund, OwnReview } from "~/features/account/types";
import { privateMeta } from "~/features/booking/meta";
import { PriceBreakdown } from "~/features/booking/PriceBreakdown";
import { deserializeError, responseStatus, serializeError } from "~/features/booking/routeErrors";
import { ApiError, apiData } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { countryName, formatBasisPoints, formatDateTime } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { Booking, Payment, PaymentMethodOption } from "~/lib/types";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { locale } = splitLocale(new URL(request.url).pathname);
  const id = encodeURIComponent(params.id);
  try {
    const [booking, payments, refunds, review, methods] = await Promise.all([
      apiData<Booking>(`/account/bookings/${id}`, { request, query: { locale } }),
      apiData<Payment[]>(`/bookings/${id}/payments`, { request }),
      apiData<CustomerRefund[]>(`/bookings/${id}/refunds`, { request }),
      apiData<OwnReview>(`/bookings/${id}/review`, { request }).catch((e: unknown) => {
        if (e instanceof ApiError && e.status === 404) return null;
        throw e;
      }),
      apiData<PaymentMethodOption[]>("/payment-methods").catch(() => null),
    ]);
    return data({ booking, payments, refunds, review, methods, error: null }, { headers: privateHeaders });
  } catch (e) {
    if (isUnauthenticated(e)) throw loginRedirect(request);
    const error = serializeError(e);
    return data({ booking: null, payments: [], refunds: [], review: null, methods: null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "account.booking.title");
}

export default function AccountBooking({ loaderData }: Route.ComponentProps) {
  const t = useT();
  const locale = useLocale();
  const errorText = useApiErrorText();
  const revalidator = useRevalidator();
  const { booking, error } = loaderData;
  if (!booking) {
    return (
      <div className="space-y-4">
        <ErrorState message={errorText(deserializeError(error))} onRetry={error?.status === 404 ? undefined : () => revalidator.revalidate()} />
        <ButtonLink to={localePath(locale, "/account")} variant="secondary">
          {t("account.booking.back")}
        </ButtonLink>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <ButtonLink to={localePath(locale, "/account")} variant="ghost" size="sm">
        {t("account.booking.back")}
      </ButtonLink>
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-bold">{t("account.booking.heading", { number: booking.booking_number })}</h2>
        <StatusBadge status={booking.status} />
        <StatusBadge status={booking.payment_status} />
      </header>
      {booking.status === "PENDING_PAYMENT" && booking.hold_expires_at && (
        <Alert tone="warning">{t("account.booking.hold_until", { time: formatDateTime(booking.hold_expires_at, booking.timezone, locale) })}</Alert>
      )}
      {booking.status === "CANCELLED" && booking.cancel_reason && <Alert tone="info">{t("account.booking.cancel_reason", { reason: booking.cancel_reason })}</Alert>}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Schedule booking={booking} />
          <People booking={booking} />
          <Prices booking={booking} />
          <PaymentsSection payments={loaderData.payments} timezone={booking.timezone} />
          <RefundsSection refunds={loaderData.refunds} timezone={booking.timezone} />
          <ReviewSection bookingId={booking.id} review={loaderData.review} canReview={booking.actions.can_review} />
        </div>
        <aside className="space-y-4">
          <BookingActions booking={booking} methods={loaderData.methods} />
          <Tiers booking={booking} />
        </aside>
      </div>
    </div>
  );
}

function Schedule({ booking }: { booking: Booking }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  return (
    <Card>
      <h3 className="text-lg font-semibold">{t("account.booking.schedule")}</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Item label={t("account.booking.mode")}>{tc("account.booking.modes", booking.mode)}</Item>
        <Item label={t("booking.track.boat")}>{booking.boat_name}</Item>
        <Item label={t("booking.track.route")}>{booking.route_name}</Item>
        <Item label={t("account.booking.port")}>{booking.port_name}</Item>
        <Item label={t("booking.summary.departs")}>{formatDateTime(booking.starts_at, booking.timezone, locale)}</Item>
        <Item label={t("booking.summary.returns")}>{formatDateTime(booking.ends_at, booking.timezone, locale)}</Item>
        <Item label={t("booking.summary.guests")}>{t("common.units.pax", { count: booking.pax })}</Item>
        {booking.slot_type && <Item label={t("account.booking.slot")}>{tc("account.booking.slot_types", booking.slot_type)}</Item>}
      </dl>
    </Card>
  );
}

function People({ booking }: { booking: Booking }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const lead = booking.lead;
  if (!lead) return null;
  return (
    <Card>
      <h3 className="text-lg font-semibold">{t("booking.lead.title")}</h3>
      <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
        <Item label={t("booking.lead.full_name")}>{lead.full_name}</Item>
        <Item label={t("booking.lead.email")}>{lead.email}</Item>
        <Item label={t("booking.lead.phone")}>{lead.phone}</Item>
        <Item label={t("booking.lead.nationality")}>{countryName(lead.nationality, locale)}</Item>
        {lead.id_type && (
          <Item label={t("booking.lead.id_type")}>
            {tc("booking.id_types", lead.id_type)} · {t("account.booking.id_masked", { last4: lead.id_last4 })}
          </Item>
        )}
        {booking.special_request && <Item label={t("booking.lead.special_request")}>{booking.special_request}</Item>}
      </dl>
      {booking.guests && booking.guests.length > 0 && (
        <>
          <h4 className="mt-4 font-medium">{t("booking.guests.title")}</h4>
          <ol className="mt-2 list-inside list-decimal space-y-1 text-sm">
            {booking.guests.map((g, i) => (
              <li key={i}>
                {g.full_name}
                {g.phone && <span className="text-muted"> · {g.phone}</span>}
              </li>
            ))}
          </ol>
        </>
      )}
      <p className="mt-3 text-xs text-muted">{t("account.booking.guests_locked")}</p>
    </Card>
  );
}

function Prices({ booking }: { booking: Booking }) {
  const t = useT();
  const locale = useLocale();
  return (
    <Card>
      <h3 className="text-lg font-semibold">{t("account.booking.price")}</h3>
      <div className="mt-3">
        <PriceBreakdown lines={booking.lines ?? []} discount={booking.discount} subtotal={booking.subtotal} taxes={booking.taxes ?? []} grandTotal={booking.grand_total} />
      </div>
      <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
        <Row label={t("account.booking.paid")}>
          <Money amount={booking.amount_paid} />
        </Row>
        {booking.fees_paid > 0 && (
          <Row label={t("account.booking.fees_paid")}>
            <Money amount={booking.fees_paid} />
          </Row>
        )}
        {booking.amount_refunded > 0 && (
          <Row label={t("account.booking.refunded")}>
            <Money amount={booking.amount_refunded} />
          </Row>
        )}
        <Row label={t("account.booking.balance_due")}>
          <Money amount={booking.balance_due} className="font-semibold" />
        </Row>
        {booking.balance_due > 0 && booking.balance_due_at && (
          <Row label={t("account.booking.balance_due_at")}>{formatDateTime(booking.balance_due_at, booking.timezone, locale)}</Row>
        )}
      </dl>
    </Card>
  );
}

function Tiers({ booking }: { booking: Booking }) {
  const t = useT();
  const locale = useLocale();
  const tiers = (booking.cancellation_tiers ?? []).slice().sort((a, b) => b.min_days_before - a.min_days_before);
  if (tiers.length === 0) return null;
  return (
    <Card>
      <h3 className="font-semibold">{t("account.booking.policy")}</h3>
      <ul className="mt-2 space-y-1 text-sm">
        {tiers.map((tier) => (
          <li key={tier.min_days_before}>{t("account.booking.tier", { days: tier.min_days_before, refund: formatBasisPoints(tier.refund_basis_points, locale) })}</li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted">{t("account.booking.policy_note")}</p>
    </Card>
  );
}

function Item({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted">{label}</dt>
      <dd className="break-words">{children}</dd>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt>{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
