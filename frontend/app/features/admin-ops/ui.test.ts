import { describe, expect, it } from "vitest";

import { docFormat } from "./ui";

describe("docFormat", () => {
  it("reads the format parameter before the extension", () => {
    expect(docFormat("/api/v1/admin/manifests/booking/1?format=csv&reveal=true")).toBe("csv");
    expect(docFormat("/api/v1/admin/reports/sales?from=2026-01-01&format=xlsx")).toBe("xlsx");
    expect(docFormat("/api/v1/admin/bookings/1/invoice.pdf")).toBe("pdf");
    expect(docFormat("/api/v1/admin/manifests/departure/1?format=pdf")).toBe("pdf");
  });
});
