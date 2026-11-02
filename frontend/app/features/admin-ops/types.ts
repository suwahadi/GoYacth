import type { Booking, Departure, Payment } from "~/lib/types";

export type Translations<T = { name: string }> = Record<string, T>;

export interface OverviewCounts {
  bookings_today: number;
  bookings_week: number;
  revenue_month: number;
  refunds_month: number;
  pending_payments: number;
  exceptions: number;
  pending_requests: number;
  open_refunds: number;
  pending_reviews: number;
}

export interface UpcomingBooking {
  id: string;
  booking_number: string;
  mode: Booking["mode"];
  starts_at: string;
  timezone: string;
  pax: number;
  boat_name: string;
}

export interface Overview {
  counts: OverviewCounts;
  upcoming: UpcomingBooking[];
}

export type ReservationKind = "CHARTER" | "DEPARTURE" | "BLOCK";

export interface CalendarEvent {
  boat_id: string;
  kind: ReservationKind;
  status: string;
  starts_at: string;
  ends_at: string;
  booking_id?: string;
  departure_id?: string;
  block_id?: string;
  expires_at?: string;
  partial: boolean;
}

export interface CalendarBoat {
  id: string;
  code: string;
  name: string;
}

export interface CalendarData {
  boats: CalendarBoat[];
  events: CalendarEvent[];
}

export interface AdminArea {
  id: string;
  deck_label: string;
  is_system: boolean;
  min_pax: number;
  max_pax: number;
  status: string;
  translations: Translations<{ name: string; description?: string }>;
}

export interface AdminBoatRoute {
  route_id: string;
  fixed_price: number | null;
  min_duration_minutes: number | null;
}

export interface AdminRate {
  rate_unit: "HOURLY" | "DAILY" | "FIXED";
  price: number;
  min_units: number;
  max_units: number;
}

export interface AdminBoat {
  id: string;
  code: string;
  status: string;
  partner_id: string | null;
  home_port_id: string;
  max_passengers: number;
  operating_start_minute: number;
  operating_end_minute: number;
  translations: Translations;
  rates: AdminRate[];
  routes: AdminBoatRoute[];
  areas: AdminArea[];
}

export interface AdminRoute {
  id: string;
  departure_port_id: string;
  duration_minutes: number;
  status: string;
  translations: Translations;
}

export interface AdminPort {
  id: string;
  timezone: string;
  status: string;
  translations: Translations;
}

export interface Partner {
  id: string;
  name: string;
  contact_name: string;
  email: string;
  phone: string;
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  status: string;
}

export interface AdminBookingRow extends Booking {
  lead_name: string;
  lead_email: string;
  exception_reason: string | null;
}

export interface Refund {
  id: string;
  booking_id: string;
  payment_id: string | null;
  reason_type: string;
  amount: number;
  includes_fee_amount: number;
  channel: "PROVIDER" | "MANUAL";
  status: "REQUESTED" | "APPROVED" | "PROCESSING" | "COMPLETED" | "REJECTED";
  bank_name: string;
  bank_account_name: string;
  bank_account_number: string;
  proof_media_id: string | null;
  notes: string;
  completed_at: string | null;
  created_at: string;
}

export interface AdminRefundRow extends Refund {
  booking_number: string;
  booking_public_id: string;
}

export interface BookingRequest {
  id: string;
  booking_id: string;
  type: "CANCEL" | "RESCHEDULE";
  status: "PENDING" | "APPROVED" | "REJECTED";
  message: string;
  resolution: string;
  resolved_at: string | null;
  created_at: string;
}

export interface AdminBookingDetail extends Booking {
  user_id: string;
  exception_reason: string | null;
  created_by_admin: string | null;
  verify_token_revoked: boolean;
  payments: Payment[];
  refunds: Refund[];
  requests: BookingRequest[];
  forfeited_amount: number;
  departure_id: string | null;
  route_id: string;
}

export interface AdminPaymentRow extends Payment {
  booking_number: string;
  booking_id: string;
  provider_status: string;
  notes: string;
  proof_media_id: string | null;
}

export interface PaymentEvent {
  id: string;
  payment_id: string | null;
  order_id: string;
  source: string;
  transaction_status: string;
  fraud_status: string;
  status_code: string;
  gross_amount: string;
  verdict: string;
  verdict_reason: string;
  created_at: string;
}

export interface SettlementLine {
  booking_id: string;
  booking_number: string;
  status: string;
  ends_at: string;
  basis: number;
  commission: number;
  refunded: number;
  partner_amount: number;
  payout_id: string | null;
}

export interface Settlement {
  lines: SettlementLine[];
  unpaid_total: number;
  paid_total: number;
}

export interface Payout {
  id: string;
  partner_id: string;
  partner_name?: string;
  period_start: string;
  period_end: string;
  amount: number;
  paid_on: string;
  proof_media_id: string | null;
  notes: string;
  created_at: string;
}

export interface AdminUser {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  nationality: string;
  locale: string;
  role: "ADMIN" | "CUSTOMER";
  status: "ACTIVE" | "DISABLED" | "ANONYMIZED";
  last_login_at: string | null;
  created_at: string;
  booking_count?: number;
}

export interface AuditEntry {
  id: number;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string;
  before: unknown;
  after: unknown;
  request_id: string;
  ip_address: string;
  created_at: string;
}

export interface MediaStatus {
  image: { id: string; status: string };
  failure_reason?: string | null;
}

export type AdminDeparture = Departure;
