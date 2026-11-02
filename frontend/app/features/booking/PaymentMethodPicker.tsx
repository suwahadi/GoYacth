import { CardIcon, cn } from "~/components/ui";
import { formatBasisPoints, formatIDR } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { PaymentMethodOption } from "~/lib/types";

// Logos come from zonalogo.com and sit on a white tile in both themes, as brand guidelines expect.
// Card payments have no single brand, so they use a line icon instead.
const LOGOS: Record<string, string> = {
  QRIS: "/payments/qris.svg",
  BCA_VA: "/payments/bca.svg",
  BNI_VA: "/payments/bni.svg",
  BRI_VA: "/payments/bri.svg",
  MANDIRI_VA: "/payments/mandiri.svg",
  PERMATA_VA: "/payments/permata.svg",
};

export function PaymentMethodPicker({ methods, value, onChange, error, disabled }: { methods: PaymentMethodOption[]; value: string; onChange: (m: string) => void; error?: string; disabled?: boolean }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const fee = (m: PaymentMethodOption) => (m.fee_type === "PERCENTAGE" ? formatBasisPoints(m.fee_value, locale) : formatIDR(m.fee_value, locale));
  const sorted = methods.slice().sort((a, b) => a.sort_order - b.sort_order);
  return (
    <fieldset disabled={disabled} aria-invalid={error ? true : undefined} className="@container">
      <legend className="text-sm font-medium">{t("booking.payment.method")}</legend>
      {sorted.length === 0 ? (
        <p className="mt-2 text-sm text-muted">{t("booking.payment.no_methods")}</p>
      ) : (
        <ul className="mt-2 grid grid-cols-2 gap-2 @lg:grid-cols-4">
          {sorted.map((m) => {
            const logo = LOGOS[m.method];
            const selected = value === m.method;
            return (
              <li key={m.method}>
                <label
                  className={cn(
                    "flex h-full cursor-pointer flex-col items-center gap-2 rounded-md border p-2 text-center text-xs transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary",
                    selected ? "border-primary bg-surface-2 ring-1 ring-primary" : "border-border hover:border-muted",
                  )}
                >
                  <input type="radio" name="payment_method" value={m.method} checked={selected} onChange={() => onChange(m.method)} className="sr-only" />
                  <span className="grid h-12 w-full place-items-center rounded bg-white px-2" aria-hidden="true">
                    {logo ? <img src={logo} alt="" className="max-h-7 max-w-full object-contain" /> : <CardIcon className="size-7 text-[#04203c]" />}
                  </span>
                  <span className="font-medium leading-tight">{tc("common.methods", m.method)}</span>
                  {m.fee_value > 0 && <span className="text-muted">{t("booking.payment.fee", { fee: fee(m) })}</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p className="mt-1 text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
