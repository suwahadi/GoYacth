import { Card, EmptyState, Money, StatusBadge } from "~/components/ui";
import { formatDateTime } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { Payment } from "~/lib/types";

export function PaymentsSection({ payments, timezone }: { payments: Payment[]; timezone: string }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  return (
    <Card>
      <h2 className="text-lg font-semibold">{t("account.payments.title")}</h2>
      {payments.length === 0 ? (
        <div className="mt-3">
          <EmptyState title={t("account.payments.empty")} />
        </div>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {payments.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start justify-between gap-2 py-3 text-sm">
              <div className="min-w-0">
                <p className="font-medium">
                  {tc("account.payments.kinds", p.kind)} · {tc("common.methods", p.method)}
                </p>
                <p className="text-xs text-muted">{formatDateTime(p.paid_at ?? p.created_at, timezone, locale)}</p>
                {p.fee_amount > 0 && (
                  <p className="text-xs text-muted">
                    {t("account.payments.fee")} <Money amount={p.fee_amount} />
                  </p>
                )}
              </div>
              <div className="text-right">
                <Money amount={p.gross_amount} className="font-medium" />
                <div className="mt-1">
                  <StatusBadge status={p.status} />
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
