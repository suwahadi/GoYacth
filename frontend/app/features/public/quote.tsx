import { useEffect, useState } from "react";

import { Alert, Money, Spinner, useApiErrorText } from "~/components/ui";
import { ApiError, api } from "~/lib/api";
import { formatDateTime, formatIDR } from "~/lib/format";
import { useLocale, useT, useTCode } from "~/lib/i18n";
import type { ProductInput, Quote } from "~/lib/types";

export interface QuoteRequest {
  product: ProductInput;
  pax: number;
  locale: string;
}

export type QuoteState = { status: "idle" } | { status: "loading" } | { status: "success"; quote: Quote } | { status: "error"; error: unknown };

const DEBOUNCE_MS = 350;

// useQuote asks the API for a price whenever the selection changes. Requests are debounced and
// an obsolete request is aborted, so a slow response never overwrites a newer selection.
export function useQuote(request: QuoteRequest | null): QuoteState {
  const key = request ? JSON.stringify(request) : "";
  const [state, setState] = useState<QuoteState>({ status: "idle" });
  useEffect(() => {
    if (!key) {
      setState({ status: "idle" });
      return;
    }
    const ctrl = new AbortController();
    setState({ status: "loading" });
    const timer = setTimeout(() => {
      api<Quote>("/quotes", { method: "POST", body: JSON.parse(key), signal: ctrl.signal })
        .then((res) => setState({ status: "success", quote: res.data }))
        .catch((error: unknown) => {
          if ((error as Error).name === "AbortError") return;
          setState({ status: "error", error });
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);
  return state;
}

function useQuoteErrorText() {
  const errorText = useApiErrorText();
  const tc = useTCode();
  return (err: unknown): string => {
    if (err instanceof ApiError) {
      const fieldCode = Object.values(err.fields)[0];
      if (fieldCode) {
        const msg = tc("validation.fields", fieldCode);
        if (msg !== fieldCode) return msg;
      }
    }
    return errorText(err);
  };
}

export function QuoteView({ state, idleText }: { state: QuoteState; idleText: string }) {
  const t = useT();
  const tc = useTCode();
  const locale = useLocale();
  const errorText = useQuoteErrorText();
  if (state.status === "idle") return <p className="text-sm text-muted">{idleText}</p>;
  if (state.status === "loading") {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted">
        <Spinner className="size-4" />
        {t("public.quote.loading")}
      </p>
    );
  }
  if (state.status === "error") return <Alert tone="danger">{errorText(state.error)}</Alert>;
  const q = state.quote;
  return (
    <div aria-live="polite" className="space-y-2 text-sm">
      <p className="text-muted">
        {t("public.quote.trip_time", { start: formatDateTime(q.starts_at, q.timezone, locale), end: formatDateTime(q.ends_at, q.timezone, locale) })}
      </p>
      <dl className="space-y-1">
        {q.lines.map((l, i) => (
          <div key={i} className="flex justify-between gap-3">
            <dt>
              {tc("public.quote.lines", l.label)}
              {l.rule && l.rule !== "BASE" && <span className="block text-xs text-muted">{tc("public.quote.rules", l.rule)}</span>}
              {l.quantity > 1 && <span className="block text-xs text-muted">{t("public.quote.line_qty", { price: formatIDR(l.unit_price, locale), qty: l.quantity })}</span>}
            </dt>
            <dd>{formatIDR(l.amount, locale)}</dd>
          </div>
        ))}
        {q.discount && (
          <div className="flex justify-between gap-3">
            <dt>{t("public.quote.discount", { name: q.discount.name })}</dt>
            <dd>−{formatIDR(q.discount.amount, locale)}</dd>
          </div>
        )}
        {q.taxes.map((tax) => (
          <div key={tax.code} className="flex justify-between gap-3">
            <dt>{tax.name}</dt>
            <dd>{formatIDR(tax.amount, locale)}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold">
          <dt>{t("public.quote.total")}</dt>
          <dd className="text-right">
            <Money amount={q.grand_total} withUsd />
          </dd>
        </div>
      </dl>
      {q.payment.deposit_available && <p>{t("public.quote.deposit_option", { amount: formatIDR(q.payment.deposit_amount, locale) })}</p>}
      <p className="text-xs text-muted">{t("public.quote.final_note")}</p>
    </div>
  );
}
