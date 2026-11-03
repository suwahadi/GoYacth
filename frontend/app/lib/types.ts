// Response shapes of the Go API (see backend/internal/modules/*/dto.go and handlers). Money is
// whole rupiah; timestamps are ISO 8601 UTC strings.

export type ThemePref = "light" | "dark";

export interface Me {
  id: string;
  email: string;
  full_name: string;
  role: "ADMIN" | "CUSTOMER";
  locale: string;
}

export interface PublicSettings {
  site?: { name: string; email: string; phone: string; whatsapp: string; address: string };
  seo?: { default_title: string; default_description: string; og_image_media_id: string | null };
  analytics?: { ga4_id: string; gtm_id: string };
  currency?: { usd_rate_idr: number };
  legal?: { terms_version: string; privacy_version: string; cancellation_version: string };
  booking?: { min_lead_hours: number; max_advance_days: number };
}

export interface ImageSource {
  url: string;
  width: number;
  height: number;
}

export interface Img {
  id: string;
  status: string;
  alt: string;
  alt_texts?: Record<string, string>;
  width: number;
  height: number;
  sources: ImageSource[];
}

export interface BoatCard {
  id: string;
  code: string;
  name: string;
  slug: string;
  summary: string;
  category_id: string;
  class_id: string;
  max_passengers: number;
  length_cm: number | null;
  cabins: number;
  from_price: number;
  from_unit: "HOURLY" | "DAILY" | "FIXED" | "";
  rating: number;
  review_count: number;
  thumbnail: Img | null;
}

export interface Named {
  id: string;
  name: string;
  slug?: string;
  icon?: string;
}

export interface PortInfo {
  id: string;
  name: string;
  timezone: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
}

export interface RegionCard {
  id: string;
  name: string;
  slug: string;
  locale: string;
  description: string;
  thumbnail: Img | null;
}

export interface RouteCard {
  id: string;
  region_id: string;
  name: string;
  slug: string;
  description: string;
  duration_minutes: number;
  thumbnail: Img | null;
}

export interface Rate {
  rate_unit: "HOURLY" | "DAILY" | "FIXED";
  price: number;
  min_units: number;
  max_units: number;
}

export interface CancellationTier {
  min_days_before: number;
  refund_basis_points: number;
}

export interface PolicySummary {
  payment_type: "FULL" | "DEPOSIT";
  deposit_type: "PERCENTAGE" | "FIXED" | null;
  deposit_value: number;
  balance_due_days: number;
  cancellation_name: string;
  cancellation_text: string;
  cancellation_tiers: CancellationTier[];
}

export interface PublicArea {
  id: string;
  name: string;
  description: string;
  deck_label: string;
  min_pax: number;
  max_pax: number;
  base_price: number;
  facilities: Named[];
  gallery: Img[];
}

export interface BoatDetail extends BoatCard {
  description: string;
  seo_title: string;
  seo_description: string;
  category: string;
  class: string;
  beam_cm: number | null;
  year_built: number | null;
  bathrooms: number;
  speed_knots: number | null;
  crew_count: number;
  operating_start_minute: number;
  operating_end_minute: number;
  overnight_allowed: boolean;
  turnaround_buffer_minutes: number;
  home_port: PortInfo;
  rates: Rate[];
  routes: (RouteCard & { fixed_price: number | null; min_duration_minutes: number | null })[];
  regions: RegionCard[];
  facilities: Named[];
  areas: PublicArea[];
  gallery: Img[];
  policy: PolicySummary;
  alternates: Record<string, string>;
}

export interface PackageCard {
  id: string;
  mode: "PRIVATE_CHARTER" | "DEPARTURE";
  name: string;
  slug: string;
  summary: string;
  from_price: number;
  min_pax: number;
  max_pax: number;
  duration_minutes: number | null;
  valid_from: string;
  valid_until: string;
  thumbnail: Img | null;
}

export interface PackageOffering {
  id: string;
  boat_id: string;
  boat_name?: string;
  boat_slug?: string;
  departure_slot_id: string | null;
  price: number;
}

export interface PackageDetail extends PackageCard {
  description: string;
  inclusions: string[];
  exclusions: string[];
  seo_title: string;
  seo_description: string;
  route_id: string | null;
  departure_id: string | null;
  booking_cutoff_hours: number;
  offerings: PackageOffering[];
  gallery: Img[];
  policy: PolicySummary;
  alternates: Record<string, string>;
}

export interface DepartureSlot {
  id: string;
  slot_type: "PRIVATE_AREA" | "SEAT_POOL";
  area_ids: string[];
  area_names: string[];
  price: number;
  seat_capacity: number | null;
  min_pax: number;
  max_pax: number;
  booked_pax: number;
  remaining: number;
  available: boolean;
}

export interface Departure {
  id: string;
  boat_id: string;
  boat_name: string;
  boat_slug: string;
  route_id: string;
  route_name: string;
  port_name: string;
  timezone: string;
  departs_at: string;
  returns_at: string;
  booking_closes_at: string;
  status: "SCHEDULED" | "CANCELLED";
  cancel_reason?: string;
  booked_pax: number;
  capacity: number;
  slots: DepartureSlot[];
}

export interface PriceLine {
  kind: string;
  label: string;
  unit_price: number;
  quantity: number;
  amount: number;
  rule?: string;
}

export interface TaxLine {
  code: string;
  name: string;
  basis_points: number;
  base: number;
  amount: number;
}

export interface Discount {
  promotion_id: string;
  name: string;
  code?: string;
  amount: number;
}

export interface Quote {
  mode: string;
  boat_id: string;
  route_id: string;
  departure_id?: string;
  departure_slot_id?: string;
  package_id?: string;
  starts_at: string;
  ends_at: string;
  timezone: string;
  pax: number;
  lines: PriceLine[];
  discount: Discount | null;
  subtotal: number;
  taxes: TaxLine[];
  tax_total: number;
  grand_total: number;
  payment: {
    method: string;
    scheme: "FULL" | "DEPOSIT";
    deposit_available: boolean;
    deposit_amount: number;
    principal_due_now: number;
    fee: number;
    total_due_now: number;
    balance_due_at: string | null;
    hold_minutes: number;
  };
  usd_estimate: number;
  currency: "IDR";
}

export interface ProductInput {
  mode: "PRIVATE_CHARTER" | "DEPARTURE";
  boat_id?: string;
  route_id?: string;
  date?: string;
  start_time?: string;
  rate_unit?: "HOURLY" | "DAILY" | "FIXED";
  units?: number;
  departure_slot_id?: string;
  package_id?: string;
  package_offering_id?: string;
}

export type BookingStatus = "PENDING_PAYMENT" | "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "EXPIRED";
export type PaymentStatus = "UNPAID" | "DEPOSIT_PAID" | "PAID" | "PARTIALLY_REFUNDED" | "REFUNDED";

export interface Booking {
  id: string;
  booking_number: string;
  invoice_number: string | null;
  status: BookingStatus;
  payment_status: PaymentStatus;
  mode: "PRIVATE_CHARTER" | "DEPARTURE";
  boat_id: string;
  boat_name: string;
  route_name: string;
  port_name: string;
  slot_type?: string;
  package_id: string | null;
  starts_at: string;
  ends_at: string;
  timezone: string;
  pax: number;
  lead?: { full_name: string; email: string; phone: string; nationality: string; id_type: string; id_last4: string };
  guests?: { full_name: string; phone: string }[];
  special_request?: string;
  lines?: PriceLine[];
  discount?: Discount | null;
  taxes?: TaxLine[];
  subtotal: number;
  grand_total: number;
  amount_paid: number;
  fees_paid: number;
  amount_refunded: number;
  balance_due: number;
  payment_scheme: "FULL" | "DEPOSIT";
  deposit_amount: number;
  balance_due_at: string | null;
  hold_expires_at: string | null;
  cancel_type: string | null;
  cancel_reason?: string;
  cancelled_at: string | null;
  created_at: string;
  locale: string;
  cancellation_tiers?: CancellationTier[];
  actions: {
    can_pay: boolean;
    can_cancel_unpaid: boolean;
    can_request_cancel: boolean;
    can_request_reschedule: boolean;
    can_download_ticket: boolean;
    can_review: boolean;
  };
}

export interface Payment {
  id: string;
  kind: "FULL" | "DEPOSIT" | "BALANCE";
  provider: "MIDTRANS" | "MANUAL";
  method: string;
  order_id: string;
  principal_amount: number;
  fee_amount: number;
  gross_amount: number;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "EXPIRED" | "CANCELLED";
  snap_token?: string;
  snap_redirect_url?: string;
  va_numbers: { bank: string; number: string; biller_code?: string }[];
  expires_at: string | null;
  paid_at: string | null;
  is_exception: boolean;
  created_at: string;
}

export interface PaymentMethodOption {
  method: string;
  fee_type: "FIXED" | "PERCENTAGE";
  fee_value: number;
  hold_minutes: number;
  enabled: boolean;
  sort_order: number;
}

export interface Tracking {
  id: string;
  booking_number: string;
  status: BookingStatus;
  payment_status: PaymentStatus;
  starts_at: string;
  timezone: string;
  boat_name: string;
  route_name: string;
}

export interface Review {
  id: string;
  boat_id: string;
  author_name: string;
  author_country: string;
  rating_overall: number;
  rating_boat: number;
  rating_service: number;
  rating_crew: number;
  title: string;
  body: string;
  locale: string;
  verified_booking: boolean;
  created_at: string;
  photos: Img[];
}

export interface Faq {
  id: string;
  category: string;
  question: string;
  answer: string;
}

export interface PageBlock {
  type: "heading" | "paragraph" | "list" | "image" | "quote" | "cta";
  level?: number;
  text?: string;
  items?: string[];
  media_id?: string;
  label?: string;
  url?: string;
  image?: Img;
}

export interface HomeSection {
  id: string;
  type: "HERO" | "FEATURED_BOATS" | "REGIONS" | "FEATURED_PACKAGES" | "HIGHLIGHTS" | "REVIEWS" | "FAQ" | "CTA" | "PROMO_BANNER";
  content: { title: string; subtitle: string; body: string; cta_label: string; cta_url: string; items: { title: string; text: string; icon?: string }[] | null };
  image: Img | null;
  data?: unknown;
}
