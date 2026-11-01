import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";

const SCRIPT_URL = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

interface TurnstileApi {
  render: (el: HTMLElement, opts: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

type TurnstileWindow = Window & { turnstile?: TurnstileApi };

let loading: Promise<TurnstileApi | null> | null = null;

function loadTurnstile(): Promise<TurnstileApi | null> {
  const w = window as TurnstileWindow;
  if (w.turnstile) return Promise.resolve(w.turnstile);
  if (loading) return loading;
  loading = new Promise((resolve) => {
    const s = document.createElement("script");
    s.src = SCRIPT_URL;
    s.async = true;
    s.onload = () => resolve(w.turnstile ?? null);
    s.onerror = () => {
      loading = null;
      resolve(null);
    };
    document.head.appendChild(s);
  });
  return loading;
}

export interface TurnstileHandle {
  reset: () => void;
}

// Turnstile tokens are single use, so the parent resets the widget after every submit.
export const Turnstile = forwardRef<TurnstileHandle, { siteKey: string; onToken: (token: string) => void }>(function Turnstile({ siteKey, onToken }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const callback = useRef(onToken);
  callback.current = onToken;
  useImperativeHandle(ref, () => ({
    reset: () => {
      const api = (window as TurnstileWindow).turnstile;
      if (api && widget.current) api.reset(widget.current);
      callback.current("");
    },
  }));
  useEffect(() => {
    let cancelled = false;
    loadTurnstile().then((api) => {
      if (cancelled || !api || !el.current) return;
      widget.current = api.render(el.current, {
        sitekey: siteKey,
        callback: (token) => callback.current(token),
        "expired-callback": () => callback.current(""),
        "error-callback": () => callback.current(""),
      });
    });
    return () => {
      cancelled = true;
      const api = (window as TurnstileWindow).turnstile;
      if (api && widget.current) api.remove(widget.current);
      widget.current = null;
    };
  }, [siteKey]);
  return <div ref={el} />;
});
