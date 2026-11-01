import { describe, expect, it } from "vitest";

import { coerceIdType, idTypeOptions } from "./identity";

describe("idTypeOptions", () => {
  it("offers KTP, SIM and passport to Indonesians", () => {
    expect(idTypeOptions("ID")).toEqual(["KTP", "SIM", "PASSPORT"]);
  });

  it("offers passport and KITAS/KITAP to foreigners", () => {
    expect(idTypeOptions("AU")).toEqual(["PASSPORT", "KITAS"]);
  });
});

describe("coerceIdType", () => {
  it("keeps a choice that is still allowed", () => {
    expect(coerceIdType("AU", "PASSPORT")).toBe("PASSPORT");
  });

  it("falls back to the first allowed type when nationality changes", () => {
    expect(coerceIdType("AU", "KTP")).toBe("PASSPORT");
    expect(coerceIdType("ID", "KITAS")).toBe("KTP");
  });
});
