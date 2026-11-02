import { describe, expect, it } from "vitest";

import { adminReturnPath } from "./login";

describe("adminReturnPath", () => {
  it("keeps paths inside the panel", () => {
    expect(adminReturnPath("/admin/bookings?status=PAID")).toBe("/admin/bookings?status=PAID");
  });

  it.each([null, "", "/", "/account", "https://evil.example/admin/", "//evil.example/admin/", "/administrator"])("falls back to the panel for %s", (raw) => {
    expect(adminReturnPath(raw)).toBe("/admin");
  });
});
