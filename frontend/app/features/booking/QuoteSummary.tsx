import { Alert, Card, Money } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { Quote } from "~/lib/types";

import { PriceBreakdown } from "./PriceBreakdown";

export function QuoteSummary({ quote, boatName, loading, error }: { quote: Quote; boatName?: string; loading: boolean; error?: string | null }) {
  const t = useT();
  const locale = useLocale();
  const p = quote.payment;
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("booking.summary.title")}</h2>
      <dl className="mt-3 space-y-1 text-sm">
        {boatName && (
          <div>
            <dt className="text-muted">{t("booking.summary.boat")}</dt>
            <dd>{boatName}</dd>
          </div>
        )}
        <div>
          <dt className="text-muted">{t("booking.summary.departs")}</dt>
          <dd>{formatDateTime(quote.starts_at, quote.timezone, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.summary.returns")}</dt>
          <dd>{formatDateTime(quote.ends_at, quote.timezone, locale)}</dd>
        </div>
        <div>
          <dt className="text-muted">{t("booking.summary.guests")}</dt>
          <dd>{t("common.units.pax", { count: quote.pax })}</dd>
        </div>
      </dl>
      <div className="mt-4" aria-live="polite" aria-busy={loading || undefined}>
        <PriceBreakdown lines={quote.lines} discount={quote.discount} subtotal={quote.subtotal} taxes={quote.taxes} grandTotal={quote.grand_total} />
        <dl className="mt-4 space-y-2 border-t border-border pt-3 text-sm">
          {p.scheme === "DEPOSIT" && (
            <div className="flex justify-between gap-3">
              <dt>{t("booking.summary.deposit")}</dt>
              <dd>
                <Money amount={p.principal_due_now} />
              </dd>
            </div>
          )}
          {p.method && (
            <div className="flex justify-between gap-3">
              <dt>{t("booking.summary.method_fee")}</dt>
              <dd>
                <Money amount={p.fee} />
              </dd>
            </div>
          )}
          <div className="flex justify-between gap-3 font-semibold">
            <dt>{t("booking.summary.due_now")}</dt>
            <dd className="text-right">
              <Money amount={p.total_due_now} withUsd />
            </dd>
          </div>
          {p.scheme === "DEPOSIT" && p.balance_due_at && (
            <div>
              <dt className="text-muted">{t("booking.summary.balance_due_at")}</dt>
              <dd>{formatDateTime(p.balance_due_at, quote.timezone, locale)}</dd>
            </div>
          )}
        </dl>
        {!p.method && <p className="mt-2 text-xs text-muted">{t("booking.summary.fee_after_method")}</p>}
        <p className="mt-2 text-xs text-muted">{t("booking.summary.hold", { minutes: p.hold_minutes })}</p>
        {loading && <p className="mt-2 text-xs text-muted">{t("booking.summary.updating")}</p>}
      </div>
      {error && (
        <Alert tone="danger" className="mt-3">
          {error}
        </Alert>
      )}
    </Card>
  );
}
