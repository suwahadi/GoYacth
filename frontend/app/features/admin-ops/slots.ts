export type SlotType = "SEAT_POOL" | "PRIVATE_AREA";

export interface SlotDraft {
  key: string;
  slot_type: SlotType;
  area_ids: string[];
  price: string;
  seat_capacity: string;
  min_pax: string;
  max_pax: string;
}

export interface SlotPayload {
  slot_type: SlotType;
  area_ids: string[];
  price: number;
  seat_capacity: number | null;
  min_pax: number;
  max_pax: number;
}

export type SlotIssue = "AREA_REQUIRED" | "EXACTLY_ONE_AREA" | "AREA_REUSED" | "PRICE_REQUIRED" | "SEATS_REQUIRED" | "PAX_RANGE";

export function emptySlot(key: string, type: SlotType = "SEAT_POOL"): SlotDraft {
  return { key, slot_type: type, area_ids: [], price: "", seat_capacity: "", min_pax: "1", max_pax: "" };
}

function wholeNumber(s: string): number | null {
  return /^\d+$/.test(s.trim()) ? Number(s.trim()) : null;
}

// slotIssues gives early feedback while the admin builds slots. It only checks the form's
// shape; capacities against areas and the boat are validated by the API.
export function slotIssues(slots: SlotDraft[]): Record<string, SlotIssue[]> {
  const seen = new Map<string, number>();
  for (const s of slots) for (const a of s.area_ids) seen.set(a, (seen.get(a) ?? 0) + 1);
  const out: Record<string, SlotIssue[]> = {};
  for (const s of slots) {
    const issues: SlotIssue[] = [];
    if (s.area_ids.length === 0) issues.push("AREA_REQUIRED");
    if (s.slot_type === "PRIVATE_AREA" && s.area_ids.length > 1) issues.push("EXACTLY_ONE_AREA");
    if (s.area_ids.some((a) => (seen.get(a) ?? 0) > 1)) issues.push("AREA_REUSED");
    if (wholeNumber(s.price) === null) issues.push("PRICE_REQUIRED");
    if (s.slot_type === "SEAT_POOL" && !(wholeNumber(s.seat_capacity) ?? 0)) issues.push("SEATS_REQUIRED");
    const min = wholeNumber(s.min_pax);
    const max = wholeNumber(s.max_pax);
    if (!min || !max || max < min) issues.push("PAX_RANGE");
    if (issues.length) out[s.key] = issues;
  }
  return out;
}

export function toSlotPayload(s: SlotDraft): SlotPayload {
  return {
    slot_type: s.slot_type,
    area_ids: s.slot_type === "PRIVATE_AREA" ? s.area_ids.slice(0, 1) : s.area_ids,
    price: wholeNumber(s.price) ?? 0,
    seat_capacity: s.slot_type === "SEAT_POOL" ? (wholeNumber(s.seat_capacity) ?? 0) : null,
    min_pax: wholeNumber(s.min_pax) ?? 0,
    max_pax: wholeNumber(s.max_pax) ?? 0,
  };
}

export function toggleArea(s: SlotDraft, areaId: string): SlotDraft {
  if (s.slot_type === "PRIVATE_AREA") return { ...s, area_ids: s.area_ids[0] === areaId ? [] : [areaId] };
  return { ...s, area_ids: s.area_ids.includes(areaId) ? s.area_ids.filter((a) => a !== areaId) : [...s.area_ids, areaId] };
}
