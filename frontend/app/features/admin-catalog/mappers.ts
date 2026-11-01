// Form state ⇄ API DTO mapping. Forms keep numbers as text so admins can type freely; mapping
// parses them exactly (integers, basis points) and reports problems under API field paths.
import { DEFAULT_LOCALE } from "~/lib/config";
import { minutesToClock } from "~/lib/format";
import type { Img } from "~/lib/types";

import { FieldReader, basisPointsToPercent, intText, isoToLocalInput, linesToList, localInputToIso, type FieldCodes } from "./convert";
import { allBlank, compactLocales, localized, localizedText, type Localized } from "./translations";
import type {
  AdminArea,
  AdminBoat,
  AdminPackage,
  AdminRoute,
  CancellationPolicy,
  CatalogTranslation,
  ContentStatus,
  PaymentPolicy,
  Promotion,
  RateUnit,
  RecordStatus,
  TaxLine,
} from "./types";

export interface Mapped<T> {
  dto: T;
  errors: FieldCodes;
}

export const emptyTranslation = (): CatalogTranslation => ({ name: "", slug: "", summary: "", description: "", seo_title: "", seo_description: "" });

const translationBlank = (t: object) => allBlank(t);

function amountText(type: "PERCENTAGE" | "FIXED" | "PRICE" | null | undefined, value: number): string {
  return type === "PERCENTAGE" ? basisPointsToPercent(value) : String(value);
}

function readAmount(r: FieldReader, path: string, type: string | null, input: string): number {
  return type === "PERCENTAGE" ? r.percent(path, input) : r.int(path, input);
}

export interface RateRow {
  rate_unit: RateUnit;
  price: string;
  min_units: string;
  max_units: string;
}

export interface RouteRow {
  route_id: string;
  fixed_price: string;
  min_duration_minutes: string;
}

export interface BoatForm {
  code: string;
  category_id: string;
  class_id: string;
  ownership: "OWNED" | "PARTNER";
  partner_id: string;
  commission_type: "PERCENTAGE" | "FIXED";
  commission_value: string;
  home_port_id: string;
  max_passengers: string;
  length_cm: string;
  beam_cm: string;
  year_built: string;
  cabins: string;
  bathrooms: string;
  speed_knots: string;
  crew_count: string;
  turnaround_buffer_minutes: string;
  operating_start: string;
  operating_end: string;
  overnight_allowed: boolean;
  payment_policy_id: string;
  cancellation_policy_id: string;
  sort_order: string;
  status: ContentStatus;
  translations: Localized<CatalogTranslation>;
  rates: RateRow[];
  routes: RouteRow[];
  region_ids: string[];
  facility_ids: string[];
  thumbnail: Img[];
  gallery: Img[];
}

export function boatForm(b?: AdminBoat | null): BoatForm {
  return {
    code: b?.code ?? "",
    category_id: b?.category_id ?? "",
    class_id: b?.class_id ?? "",
    ownership: b?.ownership ?? "OWNED",
    partner_id: b?.partner_id ?? "",
    commission_type: b?.commission_type ?? "PERCENTAGE",
    commission_value: b?.commission_type ? amountText(b.commission_type, b.commission_value) : "",
    home_port_id: b?.home_port_id ?? "",
    max_passengers: intText(b?.max_passengers),
    length_cm: intText(b?.length_cm),
    beam_cm: intText(b?.beam_cm),
    year_built: intText(b?.year_built),
    cabins: intText(b?.cabins ?? 0),
    bathrooms: intText(b?.bathrooms ?? 0),
    speed_knots: intText(b?.speed_knots),
    crew_count: intText(b?.crew_count ?? 0),
    turnaround_buffer_minutes: intText(b?.turnaround_buffer_minutes ?? 0),
    operating_start: minutesToClock(b?.operating_start_minute ?? 0),
    operating_end: minutesToClock(b?.operating_end_minute ?? 1440),
    overnight_allowed: b?.overnight_allowed ?? false,
    payment_policy_id: b?.payment_policy_id ?? "",
    cancellation_policy_id: b?.cancellation_policy_id ?? "",
    sort_order: intText(b?.sort_order ?? 0),
    status: b?.status ?? "DRAFT",
    translations: localized(emptyTranslation, b?.translations),
    rates: (b?.rates ?? []).map((r) => ({ rate_unit: r.rate_unit, price: String(r.price), min_units: String(r.min_units), max_units: String(r.max_units) })),
    routes: (b?.routes ?? []).map((r) => ({ route_id: r.route_id, fixed_price: intText(r.fixed_price), min_duration_minutes: intText(r.min_duration_minutes) })),
    region_ids: b?.region_ids ?? [],
    facility_ids: b?.facility_ids ?? [],
    thumbnail: b?.thumbnail ? [b.thumbnail] : [],
    gallery: b?.gallery ?? [],
  };
}

export function boatDTO(f: BoatForm) {
  const r = new FieldReader();
  const partner = f.ownership === "PARTNER";
  const dto = {
    code: f.code.trim().toUpperCase(),
    category_id: r.required("category_id", f.category_id),
    class_id: r.required("class_id", f.class_id),
    ownership: f.ownership,
    partner_id: partner ? r.required("partner_id", f.partner_id) : null,
    commission_type: partner ? f.commission_type : null,
    commission_value: partner ? readAmount(r, "commission_value", f.commission_type, f.commission_value) : 0,
    home_port_id: r.required("home_port_id", f.home_port_id),
    max_passengers: r.int("max_passengers", f.max_passengers),
    length_cm: r.optInt("length_cm", f.length_cm),
    beam_cm: r.optInt("beam_cm", f.beam_cm),
    year_built: r.optInt("year_built", f.year_built),
    cabins: r.int("cabins", f.cabins),
    bathrooms: r.int("bathrooms", f.bathrooms),
    speed_knots: r.optInt("speed_knots", f.speed_knots),
    crew_count: r.int("crew_count", f.crew_count),
    turnaround_buffer_minutes: r.int("turnaround_buffer_minutes", f.turnaround_buffer_minutes),
    operating_start_minute: r.clock("operating_start_minute", f.operating_start),
    operating_end_minute: r.clock("operating_end_minute", f.operating_end),
    overnight_allowed: f.overnight_allowed,
    payment_policy_id: r.required("payment_policy_id", f.payment_policy_id),
    cancellation_policy_id: r.required("cancellation_policy_id", f.cancellation_policy_id),
    sort_order: r.int("sort_order", f.sort_order),
    status: f.status,
    translations: compactLocales(f.translations, translationBlank),
    rates: f.rates.map((x, i) => ({
      rate_unit: x.rate_unit,
      price: r.int(`rates.${i}.price`, x.price),
      min_units: r.int(`rates.${i}.min_units`, x.min_units),
      max_units: r.int(`rates.${i}.max_units`, x.max_units),
    })),
    routes: f.routes.map((x, i) => ({
      route_id: r.required(`routes.${i}.route_id`, x.route_id),
      fixed_price: r.optInt(`routes.${i}.fixed_price`, x.fixed_price),
      min_duration_minutes: r.optInt(`routes.${i}.min_duration_minutes`, x.min_duration_minutes),
    })),
    region_ids: f.region_ids,
    facility_ids: f.facility_ids,
    thumbnail_id: f.thumbnail[0]?.id ?? null,
    gallery_ids: f.gallery.map((g) => g.id),
  };
  return { dto, errors: r.errors };
}

export interface AreaForm {
  deck_label: string;
  min_pax: string;
  max_pax: string;
  base_price: string;
  sort_order: string;
  status: "ACTIVE" | "INACTIVE";
  translations: Localized<{ name: string; description: string }>;
  facility_ids: string[];
  gallery: Img[];
}

export function areaForm(a?: AdminArea | null): AreaForm {
  return {
    deck_label: a?.deck_label ?? "",
    min_pax: intText(a?.min_pax ?? 1),
    max_pax: intText(a?.max_pax),
    base_price: intText(a?.base_price ?? 0),
    sort_order: intText(a?.sort_order ?? 0),
    status: a?.status ?? "ACTIVE",
    translations: localized(() => ({ name: "", description: "" }), a?.translations),
    facility_ids: a?.facility_ids ?? [],
    gallery: a?.gallery ?? [],
  };
}

export function areaDTO(f: AreaForm) {
  const r = new FieldReader();
  const dto = {
    deck_label: f.deck_label.trim(),
    min_pax: r.int("min_pax", f.min_pax),
    max_pax: r.int("max_pax", f.max_pax),
    base_price: r.int("base_price", f.base_price),
    sort_order: r.int("sort_order", f.sort_order),
    status: f.status,
    translations: compactLocales(f.translations, translationBlank),
    facility_ids: f.facility_ids,
    gallery_ids: f.gallery.map((g) => g.id),
  };
  return { dto, errors: r.errors };
}

export interface StopRow {
  key: string;
  latitude: string;
  longitude: string;
  translations: Localized<{ name: string; activity: string }>;
}

export interface RouteForm {
  region_id: string;
  departure_port_id: string;
  return_port_id: string;
  duration_minutes: string;
  status: ContentStatus;
  translations: Localized<CatalogTranslation>;
  stops: StopRow[];
  thumbnail: Img[];
  gallery: Img[];
}

export function routeForm(x?: AdminRoute | null): RouteForm {
  return {
    region_id: x?.region_id ?? "",
    departure_port_id: x?.departure_port_id ?? "",
    return_port_id: x?.return_port_id ?? "",
    duration_minutes: intText(x?.duration_minutes),
    status: x?.status ?? "DRAFT",
    translations: localized(emptyTranslation, x?.translations),
    stops: (x?.stops ?? []).map((s) => ({
      key: s.id,
      latitude: s.latitude === null ? "" : String(s.latitude),
      longitude: s.longitude === null ? "" : String(s.longitude),
      translations: localized(() => ({ name: "", activity: "" }), s.translations),
    })),
    thumbnail: x?.thumbnail ? [x.thumbnail] : [],
    gallery: x?.gallery ?? [],
  };
}

export function routeDTO(f: RouteForm) {
  const r = new FieldReader();
  const dto = {
    region_id: r.required("region_id", f.region_id),
    departure_port_id: r.required("departure_port_id", f.departure_port_id),
    return_port_id: r.required("return_port_id", f.return_port_id),
    duration_minutes: r.int("duration_minutes", f.duration_minutes),
    status: f.status,
    translations: compactLocales(f.translations, translationBlank),
    stops: f.stops.map((s, i) => ({
      latitude: r.coord(`stops.${i}.latitude`, s.latitude, 90),
      longitude: r.coord(`stops.${i}.longitude`, s.longitude, 180),
      translations: compactLocales(s.translations, translationBlank),
    })),
    thumbnail_id: f.thumbnail[0]?.id ?? null,
    gallery_ids: f.gallery.map((g) => g.id),
  };
  return { dto, errors: r.errors };
}

export interface PackageTranslationForm extends CatalogTranslation {
  inclusions: string;
  exclusions: string;
}

export interface OfferingRow {
  key: string;
  id: string | null;
  boat_id: string;
  departure_slot_id: string;
  price: string;
}

export interface PackageForm {
  mode: "PRIVATE_CHARTER" | "DEPARTURE";
  route_id: string;
  duration_minutes: string;
  departure_id: string;
  min_pax: string;
  max_pax: string;
  valid_from: string;
  valid_until: string;
  booking_cutoff_hours: string;
  payment_policy_id: string;
  cancellation_policy_id: string;
  sort_order: string;
  status: ContentStatus;
  translations: Localized<PackageTranslationForm>;
  offerings: OfferingRow[];
  thumbnail: Img[];
  gallery: Img[];
}

const emptyPackageTranslation = (): PackageTranslationForm => ({ ...emptyTranslation(), inclusions: "", exclusions: "" });

export function packageForm(p?: AdminPackage | null): PackageForm {
  const trs = localized(emptyPackageTranslation, undefined);
  const raw = (p?.translations ?? {}) as Record<string, Partial<CatalogTranslation & { inclusions: string[]; exclusions: string[] }>>;
  for (const loc of Object.keys(trs) as (keyof typeof trs)[]) {
    const t = raw[loc];
    if (!t) continue;
    trs[loc] = {
      ...localized(emptyTranslation, { [loc]: t })[loc],
      inclusions: (t.inclusions ?? []).join("\n"),
      exclusions: (t.exclusions ?? []).join("\n"),
    };
  }
  return {
    mode: p?.mode ?? "PRIVATE_CHARTER",
    route_id: p?.route_id ?? "",
    duration_minutes: intText(p?.duration_minutes),
    departure_id: p?.departure_id ?? "",
    min_pax: intText(p?.min_pax ?? 1),
    max_pax: intText(p?.max_pax),
    valid_from: p?.valid_from ?? "",
    valid_until: p?.valid_until ?? "",
    booking_cutoff_hours: intText(p?.booking_cutoff_hours ?? 24),
    payment_policy_id: p?.payment_policy_id ?? "",
    cancellation_policy_id: p?.cancellation_policy_id ?? "",
    sort_order: intText(p?.sort_order ?? 0),
    status: p?.status ?? "DRAFT",
    translations: trs,
    offerings: (p?.offerings ?? []).map((o) => ({ key: o.id, id: o.id, boat_id: o.boat_id, departure_slot_id: o.departure_slot_id ?? "", price: String(o.price) })),
    thumbnail: p?.thumbnail ? [p.thumbnail] : [],
    gallery: p?.gallery ?? [],
  };
}

export function packageDTO(f: PackageForm) {
  const r = new FieldReader();
  const charter = f.mode === "PRIVATE_CHARTER";
  const translations = compactLocales(f.translations, translationBlank);
  const dto = {
    mode: f.mode,
    route_id: charter ? r.required("route_id", f.route_id) : null,
    duration_minutes: charter ? r.int("duration_minutes", f.duration_minutes) : null,
    departure_id: charter ? null : r.required("departure_id", f.departure_id),
    min_pax: r.int("min_pax", f.min_pax),
    max_pax: r.int("max_pax", f.max_pax),
    valid_from: r.required("valid_from", f.valid_from),
    valid_until: r.required("valid_until", f.valid_until),
    booking_cutoff_hours: r.int("booking_cutoff_hours", f.booking_cutoff_hours),
    payment_policy_id: r.required("payment_policy_id", f.payment_policy_id),
    cancellation_policy_id: r.required("cancellation_policy_id", f.cancellation_policy_id),
    sort_order: r.int("sort_order", f.sort_order),
    status: f.status,
    translations: Object.fromEntries(
      Object.entries(translations).map(([loc, t]) => [loc, { ...t, inclusions: linesToList(t.inclusions), exclusions: linesToList(t.exclusions) }]),
    ),
    offerings: f.offerings.map((o, i) => ({
      id: o.id,
      boat_id: r.required(`offerings.${i}.boat_id`, o.boat_id),
      departure_slot_id: charter ? null : r.required(`offerings.${i}.departure_slot_id`, o.departure_slot_id),
      price: r.int(`offerings.${i}.price`, o.price),
    })),
    thumbnail_id: f.thumbnail[0]?.id ?? null,
    gallery_ids: f.gallery.map((g) => g.id),
  };
  return { dto, errors: r.errors };
}

export interface PaymentPolicyForm {
  name: string;
  type: "FULL" | "DEPOSIT";
  deposit_type: "PERCENTAGE" | "FIXED";
  deposit_value: string;
  balance_due_days: string;
  status: RecordStatus;
}

export function paymentPolicyForm(p?: PaymentPolicy | null): PaymentPolicyForm {
  return {
    name: p?.name ?? "",
    type: p?.type ?? "FULL",
    deposit_type: p?.deposit_type ?? "PERCENTAGE",
    deposit_value: p?.deposit_type ? amountText(p.deposit_type, p.deposit_value) : "",
    balance_due_days: intText(p?.balance_due_days ?? 0),
    status: p?.status ?? "ACTIVE",
  };
}

export function paymentPolicyDTO(f: PaymentPolicyForm) {
  const r = new FieldReader();
  const deposit = f.type === "DEPOSIT";
  const dto = {
    name: f.name.trim(),
    type: f.type,
    deposit_type: deposit ? f.deposit_type : null,
    deposit_value: deposit ? readAmount(r, "deposit_value", f.deposit_type, f.deposit_value) : 0,
    balance_due_days: deposit ? r.int("balance_due_days", f.balance_due_days) : 0,
    status: f.status,
  };
  return { dto, errors: r.errors };
}

export interface TierRow {
  key: string;
  min_days_before: string;
  refund_percent: string;
}

export interface CancellationPolicyForm {
  name: string;
  status: RecordStatus;
  tiers: TierRow[];
  descriptions: Localized<string>;
}

export function cancellationPolicyForm(p?: CancellationPolicy | null): CancellationPolicyForm {
  const tiers = p?.tiers?.length ? p.tiers : [{ min_days_before: 0, refund_basis_points: 0 }];
  return {
    name: p?.name ?? "",
    status: p?.status ?? "ACTIVE",
    tiers: tiers.map((t, i) => ({ key: `t${i}`, min_days_before: String(t.min_days_before), refund_percent: basisPointsToPercent(t.refund_basis_points) })),
    descriptions: localizedText(p?.descriptions),
  };
}

export function cancellationPolicyDTO(f: CancellationPolicyForm) {
  const r = new FieldReader();
  const tiers = f.tiers.map((t, i) => ({
    min_days_before: r.int(`tiers.${i}.min_days_before`, t.min_days_before),
    refund_basis_points: r.percent(`tiers.${i}.refund_percent`, t.refund_percent),
  }));
  const days = tiers.map((t) => t.min_days_before);
  if (!f.tiers.some((t) => t.min_days_before.trim() === "0")) r.errors.tiers = "MISSING_ZERO_DAY_TIER";
  else if (new Set(days).size !== days.length) r.errors.tiers = "DUPLICATE";
  const descriptions: Record<string, string> = {};
  for (const [loc, d] of Object.entries(f.descriptions)) if (d.trim() || loc === DEFAULT_LOCALE) descriptions[loc] = d.trim();
  return { dto: { name: f.name.trim(), status: f.status, tiers: tiers.sort((a, b) => b.min_days_before - a.min_days_before), descriptions }, errors: r.errors };
}

export interface PromotionForm {
  name: string;
  code: string;
  is_automatic: boolean;
  discount_type: "PERCENTAGE" | "FIXED" | "PRICE";
  discount_value: string;
  boat_id: string;
  package_id: string;
  booking_mode: "" | "PRIVATE_CHARTER" | "DEPARTURE";
  min_subtotal: string;
  starts_at: string;
  ends_at: string;
  quota: string;
  status: RecordStatus;
}

export function promotionForm(p?: Promotion | null): PromotionForm {
  return {
    name: p?.name ?? "",
    code: p?.code ?? "",
    is_automatic: p?.is_automatic ?? false,
    discount_type: p?.discount_type ?? "PERCENTAGE",
    discount_value: p ? amountText(p.discount_type, p.discount_value) : "",
    boat_id: p?.boat_id ?? "",
    package_id: p?.package_id ?? "",
    booking_mode: p?.booking_mode ?? "",
    min_subtotal: intText(p?.min_subtotal ?? 0),
    starts_at: isoToLocalInput(p?.starts_at),
    ends_at: isoToLocalInput(p?.ends_at),
    quota: intText(p?.quota),
    status: p?.status ?? "ACTIVE",
  };
}

export function promotionDTO(f: PromotionForm) {
  const r = new FieldReader();
  const startsAt = localInputToIso(f.starts_at);
  const endsAt = localInputToIso(f.ends_at);
  if (!startsAt) r.errors.starts_at = "INVALID_DATE";
  if (!endsAt) r.errors.ends_at = "INVALID_DATE";
  const dto = {
    name: f.name.trim(),
    code: f.code.trim() ? f.code.trim().toUpperCase() : null,
    is_automatic: f.is_automatic,
    discount_type: f.discount_type,
    discount_value: readAmount(r, "discount_value", f.discount_type, f.discount_value),
    boat_id: f.boat_id || null,
    package_id: f.package_id || null,
    booking_mode: f.booking_mode || null,
    min_subtotal: r.int("min_subtotal", f.min_subtotal),
    starts_at: startsAt ?? "",
    ends_at: endsAt ?? "",
    quota: r.optInt("quota", f.quota),
    status: f.status,
  };
  return { dto, errors: r.errors };
}

export interface TaxLineForm {
  code: string;
  percent: string;
  includes_previous_lines: boolean;
  sort_order: string;
  status: RecordStatus;
  names: Localized<string>;
}

export function taxLineForm(t?: TaxLine | null): TaxLineForm {
  return {
    code: t?.code ?? "",
    percent: t ? basisPointsToPercent(t.basis_points) : "",
    includes_previous_lines: t?.includes_previous_lines ?? false,
    sort_order: intText(t?.sort_order ?? 0),
    status: t?.status ?? "ACTIVE",
    names: localizedText(t?.names),
  };
}

export function taxLineDTO(f: TaxLineForm) {
  const r = new FieldReader();
  const names: Record<string, string> = {};
  for (const [loc, n] of Object.entries(f.names)) if (n.trim() || loc === DEFAULT_LOCALE) names[loc] = n.trim();
  const dto = {
    code: f.code.trim().toUpperCase(),
    basis_points: r.percent("basis_points", f.percent),
    includes_previous_lines: f.includes_previous_lines,
    sort_order: r.int("sort_order", f.sort_order),
    status: f.status,
    names,
  };
  return { dto, errors: r.errors };
}
