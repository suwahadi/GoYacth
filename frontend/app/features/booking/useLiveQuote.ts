import { useEffect, useState } from "react";

import { apiData } from "~/lib/api";
import type { Quote } from "~/lib/types";

import type { QuoteRequest } from "./types";

const DEBOUNCE_MS = 300;

// useLiveQuote re-prices on the server whenever the request changes. Older requests are
// aborted so a slow response can never overwrite a newer one.
export function useLiveQuote(request: QuoteRequest, initial: Quote | null) {
  const [quote, setQuote] = useState<Quote | null>(initial);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const key = JSON.stringify(request);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const timer = setTimeout(() => {
      apiData<Quote>("/quotes", { method: "POST", body: JSON.parse(key) as QuoteRequest, signal: ctrl.signal })
        .then((q) => {
          if (ctrl.signal.aborted) return;
          setQuote(q);
          setError(null);
        })
        .catch((e: unknown) => {
          if (!ctrl.signal.aborted) setError(e);
        })
        .finally(() => {
          if (!ctrl.signal.aborted) setLoading(false);
        });
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [key]);
  return { quote, error, loading };
}
