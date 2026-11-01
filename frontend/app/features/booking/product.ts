import type { ProductInput } from "~/lib/types";

export interface CheckoutSelection {
  product: ProductInput;
  pax: number;
  boatSlug: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const RATE_UNITS = ["HOURLY", "DAILY", "FIXED"] as const;

function uuid(p: URLSearchParams, key: string): string | undefined {
  const v = p.get(key)?.trim();
  return v && UUID.test(v) ? v : undefined;
}

function positiveInt(v: string | null): number | undefined {
  if (!v || !/^\d+$/.test(v)) return undefined;
  const n = Number(v);
  return n >= 1 ? n : undefined;
}

// parseCheckoutParams turns the query string sent by the public pages into the API's product
// input. It only checks shape; the server decides whether the product can actually be booked.
export function parseCheckoutParams(p: URLSearchParams): CheckoutSelection | null {
  const mode = p.get("mode");
  const pax = positiveInt(p.get("pax"));
  if (!pax) return null;
  const boatSlug = p.get("boat_slug")?.trim() ?? "";
  const packageId = uuid(p, "package_id");
  const offeringId = uuid(p, "package_offering_id");
  if ((packageId && !offeringId) || (!packageId && p.get("package_offering_id"))) return null;
  const pkg = packageId ? { package_id: packageId, package_offering_id: offeringId } : {};

  if (mode === "DEPARTURE") {
    const slot = uuid(p, "departure_slot_id");
    if (!slot) return null;
    return { product: { mode, departure_slot_id: slot, ...pkg }, pax, boatSlug };
  }
  if (mode !== "PRIVATE_CHARTER") return null;

  const date = p.get("date") ?? "";
  const startTime = p.get("start_time") ?? "";
  if (!DATE.test(date) || !TIME.test(startTime)) return null;
  const boatId = uuid(p, "boat_id");
  const routeId = uuid(p, "route_id");
  if (packageId) {
    return { product: { mode, boat_id: boatId, route_id: routeId, date, start_time: startTime, ...pkg }, pax, boatSlug };
  }
  const rateUnit = RATE_UNITS.find((u) => u === p.get("rate_unit"));
  if (!boatId || !routeId || !rateUnit) return null;
  const units = positiveInt(p.get("units"));
  if (rateUnit !== "FIXED" && !units) return null;
  return {
    product: { mode, boat_id: boatId, route_id: routeId, date, start_time: startTime, rate_unit: rateUnit, ...(units ? { units } : {}) },
    pax,
    boatSlug,
  };
}
