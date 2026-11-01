import { useMemo, useState, type ReactNode } from "react";

import { ApiError } from "~/lib/api";
import { formatIDR, formatNumber, usdEstimate } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import { useRootData } from "~/root";

import { Button } from "./button";
import { cn } from "./cn";
import { Alert } from "./feedback";
import { Drawer } from "./overlay";

// Money shows IDR, optionally with the admin-configured USD estimate (PRD 6.4).
export function Money({ amount, withUsd, className }: { amount: number; withUsd?: boolean; className?: string }) {
  const locale = useLocale();
  const t = useT();
  const rate = useRootData()?.settings?.currency?.usd_rate_idr ?? 0;
  const usd = withUsd ? usdEstimate(amount, rate) : null;
  return (
    <span className={className}>
      <span>{formatIDR(amount, locale)}</span>
      {usd !== null && <span className="block text-xs font-normal text-muted">{t("common.money.approx_usd", { amount: formatNumber(usd, locale) })}</span>}
    </span>
  );
}

export function useApiErrorText() {
  const tc = useTCode();
  const t = useT();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const msg = tc("validation.errors", err.code);
      return msg === err.code ? t("validation.errors.UNKNOWN") : msg;
    }
    return t("validation.errors.UNKNOWN");
  };
}

// useFieldErrors maps API field error codes (e.g. "lead.phone": "INVALID_PHONE") to messages.
export function useFieldErrors(err: unknown): Record<string, string> {
  const tc = useTCode();
  return useMemo(() => {
    if (!(err instanceof ApiError)) return {};
    const out: Record<string, string> = {};
    for (const [field, code] of Object.entries(err.fields)) {
      const msg = tc("validation.fields", code);
      out[field] = msg === code ? tc("validation.fields", "INVALID") : msg;
    }
    return out;
  }, [err, tc]);
}

export function ApiErrorMessage({ error, className }: { error: unknown; className?: string }) {
  const text = useApiErrorText();
  if (!error) return null;
  return (
    <Alert tone="danger" className={className}>
      {text(error)}
    </Alert>
  );
}

// FilterBar shows filters inline on desktop and in a drawer on phones, with a visible count of
// active filters.
export function FilterBar({ children, activeCount, onClear }: { children: ReactNode; activeCount: number; onClear?: () => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="hidden flex-wrap items-end gap-3 md:flex">
        {children}
        {activeCount > 0 && onClear && (
          <Button variant="ghost" size="sm" onClick={onClear}>
            {t("common.actions.clear_filters")}
          </Button>
        )}
      </div>
      <div className="md:hidden">
        <Button variant="secondary" onClick={() => setOpen(true)} full>
          {t("common.actions.filters")}
          {activeCount > 0 && <span className={cn("rounded-full bg-primary px-2 text-xs text-primary-fg")}>{activeCount}</span>}
        </Button>
        <Drawer
          open={open}
          onClose={() => setOpen(false)}
          title={t("common.actions.filters")}
          footer={
            <div className="grid grid-cols-2 gap-3">
              <Button variant="secondary" onClick={() => onClear?.()} disabled={!onClear || activeCount === 0}>
                {t("common.actions.clear_filters")}
              </Button>
              <Button onClick={() => setOpen(false)}>{t("common.actions.apply")}</Button>
            </div>
          }
        >
          <div className="space-y-4">{children}</div>
        </Drawer>
      </div>
    </>
  );
}
