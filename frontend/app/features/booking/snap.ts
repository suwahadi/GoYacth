import { apiData } from "~/lib/api";
import type { Payment } from "~/lib/types";

import type { PaymentsConfig } from "./types";

interface SnapCallbacks {
  onSuccess: () => void;
  onPending: () => void;
  onError: () => void;
  onClose: () => void;
}

type SnapWindow = Window & { snap?: { pay: (token: string, callbacks: SnapCallbacks) => void } };

const SNAP_LOAD_TIMEOUT_MS = 15000;
let snapLoading: Promise<boolean> | null = null;

// loadSnap injects Midtrans Snap once per page; a failed load is forgotten so a later attempt
// can retry.
export function loadSnap(): Promise<boolean> {
  const w = window as SnapWindow;
  if (w.snap) return Promise.resolve(true);
  if (snapLoading) return snapLoading;
  snapLoading = apiData<PaymentsConfig>("/payments/config")
    .then(
      (cfg) =>
        new Promise<boolean>((resolve) => {
          if (!cfg.snap_js_url || !cfg.client_key) return resolve(false);
          const script = document.createElement("script");
          script.src = cfg.snap_js_url;
          script.async = true;
          script.dataset.clientKey = cfg.client_key;
          const timer = setTimeout(() => resolve(false), SNAP_LOAD_TIMEOUT_MS);
          script.onload = () => {
            clearTimeout(timer);
            resolve(!!w.snap);
          };
          script.onerror = () => {
            clearTimeout(timer);
            resolve(false);
          };
          document.head.appendChild(script);
        }),
    )
    .catch(() => false)
    .then((ok) => {
      if (!ok) snapLoading = null;
      return ok;
    });
  return snapLoading;
}

export function createPayment(bookingId: string, method: string, idempotencyKey: string): Promise<Payment> {
  return apiData<Payment>(`/bookings/${bookingId}/payments`, { method: "POST", body: { method }, idempotencyKey });
}

// openPayment hands the customer to Midtrans. Every Snap callback only leads to the status page:
// a browser callback is never proof of payment, the server's webhook processing is.
export async function openPayment(payment: Payment, goToStatus: () => void): Promise<void> {
  const ready = payment.snap_token ? await loadSnap() : false;
  const snap = (window as SnapWindow).snap;
  if (ready && snap && payment.snap_token) {
    try {
      snap.pay(payment.snap_token, { onSuccess: goToStatus, onPending: goToStatus, onError: goToStatus, onClose: goToStatus });
      return;
    } catch {
      // Snap refuses a second popup while one is open; fall through to the hosted page.
    }
  }
  if (payment.snap_redirect_url) {
    window.location.href = payment.snap_redirect_url;
    return;
  }
  goToStatus();
}
