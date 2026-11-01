export type IdType = "KTP" | "SIM" | "PASSPORT" | "KITAS";

// PRD 8.2: KTP and SIM are for Indonesians, KITAS/KITAP for foreigners, passports for everyone.
// The server enforces the same rule; this only keeps the form from offering invalid choices.
export function idTypeOptions(nationality: string): IdType[] {
  return nationality === "ID" ? ["KTP", "SIM", "PASSPORT"] : ["PASSPORT", "KITAS"];
}

export function coerceIdType(nationality: string, current: string): IdType {
  const options = idTypeOptions(nationality);
  return options.find((o) => o === current) ?? options[0];
}
