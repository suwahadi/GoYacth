import { formatBasisPoints, formatIDR } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { PaymentMethodOption } from "~/lib/types";

export function PaymentMethodPicker({ methods, value, onChange, error, disabled }: { methods: PaymentMethodOption[]; value: string; onChange: (m: string) => void; error?: string; disabled?: boolean }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const feeText = (m: PaymentMethodOption) => {
    if (m.fee_value <= 0) return t("booking.payment.no_fee");
    return t("booking.payment.fee", { fee: m.fee_type === "PERCENTAGE" ? formatBasisPoints(m.fee_value, locale) : formatIDR(m.fee_value, locale) });
  };
  const sorted = methods.slice().sort((a, b) => a.sort_order - b.sort_order);
  return (
    <fieldset disabled={disabled} aria-invalid={error ? true : undefined}>
      <legend className="text-sm font-medium">{t("booking.payment.method")}</legend>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("booking.payment.no_methods")}</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {sorted.map((m) => (
            <li key={m.method}>
              <label className="flex items-start gap-2 rounded-md border border-border p-3 text-sm">
                <input type="radio" name="payment_method" value={m.method} checked={value === m.method} onChange={() => onChange(m.method)} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block font-medium">{tc("common.methods", m.method)}</span>
                  <span className="block text-xs text-muted">
                    {feeText(m)} · {t("booking.payment.hold", { minutes: m.hold_minutes })}
                  </span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
