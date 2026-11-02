import { useEffect, useReducer, useState } from "react";
import { data } from "react-router";

import type { Route } from "./+types/status";
import { Alert, Button, ButtonLink, ButtonPair, Card, Container, ErrorState, Money, StatusBadge, useApiErrorText } from "~/components/ui";
import { privateHeaders } from "~/features/account/session";
import { privateMeta } from "~/features/booking/meta";
import { responseStatus, serializeError } from "~/features/booking/routeErrors";
import { POLL_INTERVAL_MS, initialPollState, outcomeOf, pollReducer, type Outcome } from "~/features/booking/status";
import type { OrderStatus } from "~/features/booking/types";
import { apiData } from "~/lib/api";
import { localePath, splitLocale } from "~/lib/config";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT, useTCode, type TKey } from "~/lib/i18n";
import type { Payment } from "~/lib/types";
import { PageHero } from "~/features/public/components";

export async function loader({ request, params }: Route.LoaderArgs) {
  const { locale } = splitLocale(new URL(request.url).pathname);
  try {
    const status = await apiData<OrderStatus>(`/orders/${encodeURIComponent(params.id)}/status`, { request, query: { locale } });
    return data({ status, error: null }, { headers: privateHeaders });
  } catch (e) {
    const error = serializeError(e);
    return data({ status: null, error }, { status: responseStatus(error), headers: privateHeaders });
  }
}

export function headers() {
  return privateHeaders;
}

export function meta({ location }: Route.MetaArgs) {
  return privateMeta(location, "booking.status.title");
}

const outcomeText: Record<Outcome, { title: TKey; body: TKey; tone: "success" | "warning" | "danger" | "info" }> = {
  success: { title: "booking.status.success_title", body: "booking.status.success_body", tone: "success" },
  pending: { title: "booking.status.pending_title", body: "booking.status.pending_body", tone: "info" },
  failed: { title: "booking.status.failed_title", body: "booking.status.failed_body", tone: "danger" },
  expired: { title: "booking.status.expired_title", body: "booking.status.expired_body", tone: "warning" },
  cancelled: { title: "booking.status.cancelled_title", body: "booking.status.cancelled_body", tone: "warning" },
};

export default function PaymentStatusPage({ loaderData, params }: Route.ComponentProps) {
  const t = useT();
  const errorText = useApiErrorText();
  const locale = useLocale();
  const [state, dispatch] = useReducer(pollReducer, loaderData, (d) => {
    const init = initialPollState(d.status, Date.now());
    return d.error?.status === 404 ? { ...init, phase: "done" as const } : init;
  });

  useEffect(() => {
    if (state.phase !== "polling") return;
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
      apiData<OrderStatus>(`/orders/${encodeURIComponent(params.id)}/status`, { query: { locale }, signal: ctrl.signal })
        .then((s) => dispatch({ type: "result", data: s, now: Date.now() }))
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) dispatch({ type: "error", error: e, now: Date.now() });
        });
    }, POLL_INTERVAL_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [state.phase, state.data, state.error, params.id, locale]);

  const s = state.data;
  if (!s) {
    return (
      <>
        <PageHero title={t("booking.status.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.status.title") }]} width="max-w-2xl" />
        <Container className="max-w-2xl pb-8 pt-6">
          <div className="mt-4">
            {state.phase === "polling" && !state.error ? (
              <p role="status">{t("booking.status.checking")}</p>
            ) : (
              <ErrorState message={loaderData.error?.code === "BOOKING_NOT_FOUND" ? t("booking.status.not_found") : errorText(state.error)} onRetry={() => dispatch({ type: "restart", now: Date.now() })} />
            )}
          </div>
        </Container>
      </>
    );
  }

  const outcome = outcomeOf(s);
  const text = outcomeText[outcome];
  const accountHref = localePath(locale, `/account/bookings/${s.id}`);
  return (
    <>
      <PageHero title={t("booking.status.title")} crumbs={[{ name: t("public.breadcrumb.home"), path: "/" }, { name: t("booking.status.title") }]} width="max-w-2xl" />
      <Container className="max-w-2xl pb-8 pt-6">
        <Alert tone={text.tone} title={t(text.title)} className="mt-4">
          {t(text.body)}
        </Alert>

        <Card className="mt-4">
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted">{t("booking.status.booking_number")}</dt>
              <dd className="font-medium">{s.booking_number}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("booking.track.date")}</dt>
              <dd>{formatDateTime(s.starts_at, s.timezone, locale)}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("booking.track.status")}</dt>
              <dd>
                <StatusBadge status={s.status} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("booking.track.payment_status")}</dt>
              <dd>
                <StatusBadge status={s.payment_status} />
              </dd>
            </div>
            <div>
              <dt className="text-muted">{t("booking.track.boat")}</dt>
              <dd>{s.boat_name}</dd>
            </div>
            <div>
              <dt className="text-muted">{t("booking.track.route")}</dt>
              <dd>{s.route_name}</dd>
            </div>
          </dl>
        </Card>

        {outcome === "pending" && s.payment && <PendingInstructions payment={s.payment} timezone={s.timezone} />}
        {outcome === "pending" && s.hold_expires_at && <p className="mt-3 text-sm">{t("booking.status.hold_until", { time: formatDateTime(s.hold_expires_at, s.timezone, locale) })}</p>}

        {state.phase === "polling" && (
          <p role="status" className="mt-4 text-sm text-muted">
            {t("booking.status.auto_refresh")}
          </p>
        )}
        {state.phase === "timed_out" && (
          <Alert tone="info" title={t("booking.status.timeout_title")} className="mt-4">
            <p>{t("booking.status.timeout_body")}</p>
            <Button className="mt-3" variant="secondary" onClick={() => dispatch({ type: "restart", now: Date.now() })}>
              {t("booking.status.check_again")}
            </Button>
          </Alert>
        )}
        {state.error !== null && state.phase === "polling" && <p className="mt-2 text-xs text-muted">{t("booking.status.retrying")}</p>}

        <ButtonPair className="mt-6">
          <ButtonLink to={accountHref} variant="primary">
            {t("booking.status.view_booking")}
          </ButtonLink>
          <ButtonLink to={localePath(locale, "/")} variant="secondary">
            {t("common.states.go_home")}
          </ButtonLink>
        </ButtonPair>
      </Container>
    </>
  );
}

function PendingInstructions({ payment, timezone }: { payment: Payment; timezone: string }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const vas = payment.va_numbers ?? [];
  return (
    <Card className="mt-4">
      <h2 className="text-lg font-semibold">{t("booking.status.instructions_title")}</h2>
      <dl className="mt-3 space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt>{t("booking.status.method")}</dt>
          <dd>{tc("common.methods", payment.method)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt>{t("booking.status.amount")}</dt>
          <dd className="font-semibold">
            <Money amount={payment.gross_amount} />
          </dd>
        </div>
        {payment.expires_at && (
          <div className="flex justify-between gap-3">
            <dt>{t("booking.status.pay_before")}</dt>
            <dd>{formatDateTime(payment.expires_at, timezone, locale)}</dd>
          </div>
        )}
      </dl>
      {vas.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {vas.map((va) => (
            <li key={`${va.bank}-${va.number}`} className="rounded-md border border-border p-3 text-sm">
              <p className="text-muted">{t("booking.status.va_bank", { bank: va.bank.toUpperCase() })}</p>
              {va.biller_code && <p>{t("booking.status.biller_code", { code: va.biller_code })}</p>}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <span className="break-all font-mono text-lg font-semibold">{va.number}</span>
                <CopyButton value={va.number} />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-muted">{t("booking.status.instructions_generic")}</p>
      )}
    </Card>
  );
}

function CopyButton({ value }: { value: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => setCopied(true));
      }}
    >
      {copied ? t("common.actions.copied") : t("common.actions.copy")}
    </Button>
  );
}
