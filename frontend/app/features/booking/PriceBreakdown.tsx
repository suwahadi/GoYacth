import { Money } from "~/components/ui";
import { formatBasisPoints, formatNumber } from "~/lib/format";
import { useLocale, useT } from "~/lib/i18n";
import type { Discount, PriceLine, TaxLine } from "~/lib/types";

export function PriceBreakdown({ lines, discount, subtotal, taxes, grandTotal }: { lines: PriceLine[]; discount?: Discount | null; subtotal: number; taxes: TaxLine[]; grandTotal: number }) {
  const t = useT();
  const locale = useLocale();
  return (
    <dl className="space-y-2 text-sm">
      {lines.map((l, i) => (
        <div key={`${l.kind}-${i}`} className="flex justify-between gap-3">
          <dt className="min-w-0">
            {l.label}
            {l.quantity > 1 && (
              <span className="block text-xs text-muted">
                {formatNumber(l.quantity, locale)} × <Money amount={l.unit_price} />
              </span>
            )}
          </dt>
          <dd className="shrink-0">
            <Money amount={l.amount} />
          </dd>
        </div>
      ))}
      {discount && discount.amount > 0 && (
        <div className="flex justify-between gap-3">
          <dt className="min-w-0">{discount.code ? t("booking.price.discount_code", { name: discount.name, code: discount.code }) : discount.name}</dt>
          <dd className="shrink-0 text-success">
            −<Money amount={discount.amount} />
          </dd>
        </div>
      )}
      <div className="flex justify-between gap-3 border-t border-border pt-2">
        <dt>{t("booking.price.subtotal")}</dt>
        <dd>
          <Money amount={subtotal} />
        </dd>
      </div>
      {taxes.map((tx) => (
        <div key={tx.code} className="flex justify-between gap-3">
          <dt className="min-w-0">
            {tx.name} ({formatBasisPoints(tx.basis_points, locale)})
          </dt>
          <dd className="shrink-0">
            <Money amount={tx.amount} />
          </dd>
        </div>
      ))}
      <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
        <dt>{t("booking.price.grand_total")}</dt>
        <dd className="text-right">
          <Money amount={grandTotal} withUsd />
        </dd>
      </div>
    </dl>
  );
}
