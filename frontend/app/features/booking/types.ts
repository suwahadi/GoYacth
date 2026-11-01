import type { Payment, ProductInput, Tracking } from "~/lib/types";

export interface OrderStatus extends Tracking {
  hold_expires_at: string | null;
  payment: Payment | null;
}

export interface VerifyResult {
  valid: boolean;
  status: string;
  booking_number: string;
  starts_at: string;
  timezone: string;
  boat_name: string;
  pax: number;
  lead_name: string;
}

export interface PaymentsConfig {
  client_key: string;
  snap_js_url: string;
}

export interface QuoteRequest {
  product: ProductInput;
  pax: number;
  promo_code?: string;
  payment_method?: string;
  payment_scheme?: "FULL" | "DEPOSIT";
  locale: string;
}

export interface SerializedError {
  status: number;
  code: string;
  fields: Record<string, string>;
}
