import { describe, expect, it } from "vitest";

import { safeReturnPath } from "./sign-in";

describe("safeReturnPath", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeReturnPath("/id/checkout?boat=ocean&date=2026-12-01")).toBe("/id/checkout?boat=ocean&date=2026-12-01");
  });

  it("refuses links that leave the site, including ones a browser would rewrite", () => {
    for (const raw of ["https://evil.example", "//evil.example/x", "/\\evil.example", "/\t/evil.example", "/\n/evil.example", "/x/..//evil.example", "/.//evil.example", "javascript:alert(1)", ""]) {
      expect(safeReturnPath(raw, "/account")).toBe("/account");
    }
    expect(safeReturnPath(null)).toBe("/");
  });
});
