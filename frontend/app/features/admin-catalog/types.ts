// Admin catalog response shapes (backend/internal/modules/{catalog,packages,pricing,cms,reviews,
// media,settings}). Translation maps are keyed by locale.
import type { Img } from "~/lib/types";

export type TranslationMap<T> = Record<string, T>;

export type ContentStatus = "DRAFT" | "PUBLISHED" | "ARCHIVED";
export type RecordStatus = "ACTIVE" | "ARCHIVED";

export interface CatalogTranslation {
  name: string;
  slug: string;
  summary: string;
  description: string;
  seo_title: string;
  seo_description: string;
}

export interface NamedItem {
  id: string;
  sort_order: number;
  status?: string;
  icon?: string;
  translations: TranslationMap<{ name: string; slug?: string }>;
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
  notes: string;
  status: RecordStatus;
  created_at: string;
}

export type RateUnit = "HOURLY" | "DAILY" | "FIXED";

export interface BoatRate {
  id?: string;
  rate_unit: RateUnit;
  price: number;
  min_units: number;
  max_units: number;
}

export interface BoatRoute {
  route_id: string;
  fixed_price: number | null;
  min_duration_minutes: number | null;
}

export interface AdminArea {
  id: string;
  deck_label: string;
  is_system: boolean;
  min_pax: number;
  max_pax: number;
  base_price: number;
  sort_order: number;
  status: "ACTIVE" | "INACTIVE";
  translations: TranslationMap<{ name: string; description: string }>;
  facility_ids: string[];
  gallery: Img[];
}

export interface AdminBoat {
  id: string;
  code: string;
  category_id: string;
  class_id: string;
  ownership: "OWNED" | "PARTNER";
  partner_id: string | null;
  commission_type: "PERCENTAGE" | "FIXED" | null;
  commission_value: number;
  home_port_id: string;
  max_passengers: number;
  length_cm: number | null;
  beam_cm: number | null;
  year_built: number | null;
  cabins: number;
  bathrooms: number;
  speed_knots: number | null;
  crew_count: number;
  turnaround_buffer_minutes: number;
  operating_start_minute: number;
  operating_end_minute: number;
  overnight_allowed: boolean;
  payment_policy_id: string;
  cancellation_policy_id: string;
  sort_order: number;
  status: ContentStatus;
  translations: TranslationMap<CatalogTranslation>;
  rates: BoatRate[];
  region_ids: string[];
  routes: BoatRoute[];
  facility_ids: string[];
  areas: AdminArea[];
  thumbnail: Img | null;
  gallery: Img[];
  updated_at: string;
}

export interface AdminRegion {
  id: string;
  sort_order: number;
  status: ContentStatus;
  translations: TranslationMap<CatalogTranslation>;
  thumbnail: Img | null;
  gallery: Img[];
  updated_at: string;
}

export interface AdminPort {
  id: string;
  region_id: string;
  address: string;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  status: RecordStatus;
  translations: TranslationMap<{ name: string }>;
}

export interface AdminStop {
  id: string;
  sort_order: number;
  latitude: number | null;
  longitude: number | null;
  translations: TranslationMap<{ name: string; activity: string }>;
}

export interface AdminRoute {
  id: string;
  region_id: string;
  departure_port_id: string;
  return_port_id: string;
  duration_minutes: number;
  status: ContentStatus;
  translations: TranslationMap<CatalogTranslation>;
  stops: AdminStop[];
  thumbnail: Img | null;
  gallery: Img[];
}

export interface PaymentPolicy {
  id: string;
  name: string;
  type: "FULL" | "DEPOSIT";
  deposit_type: "PERCENTAGE" | "FIXED" | null;
  deposit_value: number;
  balance_due_days: number;
  status: RecordStatus;
}

export interface CancellationPolicy {
  id: string;
  name: string;
  status: RecordStatus;
  tiers: { min_days_before: number; refund_basis_points: number }[];
  descriptions: TranslationMap<string>;
}

export interface PackageTranslation extends CatalogTranslation {
  inclusions: string[];
  exclusions: string[];
}

export interface AdminPackageSummary {
  id: string;
  mode: "PRIVATE_CHARTER" | "DEPARTURE";
  status: ContentStatus;
  valid_from: string;
  valid_until: string;
  sort_order: number;
  translations: TranslationMap<PackageTranslation>;
}

export interface AdminOffering {
  id: string;
  boat_id: string;
  departure_slot_id: string | null;
  price: number;
}

export interface AdminPackage extends AdminPackageSummary {
  route_id: string | null;
  duration_minutes: number | null;
  departure_id: string | null;
  min_pax: number;
  max_pax: number;
  booking_cutoff_hours: number;
  payment_policy_id: string;
  cancellation_policy_id: string;
  offerings: AdminOffering[];
  thumbnail: Img | null;
  gallery: Img[];
}

export interface Season {
  id: string;
  name: string;
  kind: "LOW" | "HIGH" | "PEAK";
  starts_on: string;
  ends_on: string;
}

export type OverrideRule = "DATE" | "SEASON" | "WEEKEND" | "WEEKDAY";

export interface PriceOverride {
  id: string;
  boat_rate_id: string | null;
  package_offering_id: string | null;
  rule_type: OverrideRule;
  on_date: string | null;
  season_id: string | null;
  price: number;
}

export interface Promotion {
  id: string;
  name: string;
  code: string | null;
  is_automatic: boolean;
  discount_type: "PERCENTAGE" | "FIXED" | "PRICE";
  discount_value: number;
  boat_id: string | null;
  package_id: string | null;
  booking_mode: "PRIVATE_CHARTER" | "DEPARTURE" | null;
  min_subtotal: number;
  starts_at: string;
  ends_at: string;
  quota: number | null;
  used_count: number;
  status: RecordStatus;
}

export interface TaxLine {
  id: string;
  code: string;
  basis_points: number;
  includes_previous_lines: boolean;
  sort_order: number;
  status: RecordStatus;
  names: TranslationMap<string>;
}

export const PAYMENT_METHODS = ["CREDIT_CARD", "QRIS", "BCA_VA", "BNI_VA", "BRI_VA", "MANDIRI_VA", "PERMATA_VA"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface MethodFee {
  method: string;
  fee_type: "FIXED" | "PERCENTAGE";
  fee_value: number;
  hold_minutes: number;
  enabled: boolean;
  sort_order: number;
}

export interface AdminPage {
  id: string;
  status: ContentStatus;
  published_at: string | null;
  translations: TranslationMap<{ title: string; slug: string; blocks: unknown; seo_title: string; seo_description: string }>;
  featured_image: Img | null;
  updated_at: string;
}

export const SECTION_TYPES = ["HERO", "FEATURED_BOATS", "REGIONS", "FEATURED_PACKAGES", "HIGHLIGHTS", "REVIEWS", "FAQ", "CTA", "PROMO_BANNER"] as const;
export type SectionType = (typeof SECTION_TYPES)[number];

export interface SectionItem {
  title: string;
  text: string;
  icon?: string;
}

export interface SectionContent {
  title: string;
  subtitle: string;
  body: string;
  cta_label: string;
  cta_url: string;
  items: SectionItem[] | null;
}

export interface SectionConfig {
  media_id?: string;
  boat_ids?: string[];
  region_ids?: string[];
  package_ids?: string[];
  limit?: number;
  category?: string;
  starts_at?: string;
  ends_at?: string;
}

export interface AdminSection {
  id: string;
  type: SectionType;
  sort_order: number;
  is_active: boolean;
  config: SectionConfig;
  translations: TranslationMap<SectionContent>;
  image: Img | null;
}

export interface AdminFaq {
  id: string;
  category: string;
  boat_id: string | null;
  package_id: string | null;
  sort_order: number;
  status: ContentStatus;
  translations: TranslationMap<{ question: string; answer: string }>;
}

export type ReviewStatus = "PENDING" | "PUBLISHED" | "REJECTED";

export interface AdminReview {
  id: string;
  booking_id: string;
  boat_id: string;
  rating_overall: number;
  rating_boat: number;
  rating_service: number;
  rating_crew: number;
  title: string;
  body: string;
  locale: string;
  status: ReviewStatus;
  is_featured: boolean;
  created_at: string;
  author_name: string;
  booking_number: string;
}

export interface MediaDetail {
  image: Img;
  failure_reason: string | null;
}

export interface AdminSettings {
  site?: { name: string; email: string; phone: string; whatsapp: string; address: string };
  seo?: { default_title: string; default_description: string; og_image_media_id: string | null };
  analytics?: { ga4_id: string; gtm_id: string };
  booking?: { min_lead_hours: number; max_advance_days: number; admin_hold_minutes: number; balance_reminder_days: number[]; identity_retention_days: number };
  currency?: { usd_rate_idr: number };
  legal?: { terms_version: string; privacy_version: string; cancellation_version: string };
}
