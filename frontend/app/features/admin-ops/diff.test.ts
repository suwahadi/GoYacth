import { describe, expect, it } from "vitest";

import { diffJson } from "./diff";

describe("diffJson", () => {
  it("reports changed, added, removed and unchanged leaves", () => {
    const rows = diffJson({ status: "ACTIVE", lead: "A", guests: ["x"] }, { status: "DISABLED", lead: "A", guests: ["x", "y"], note: null });
    expect(rows).toEqual([
      { path: "guests[0]", kind: "same", before: '"x"', after: '"x"' },
      { path: "guests[1]", kind: "added", before: undefined, after: '"y"' },
      { path: "lead", kind: "same", before: '"A"', after: '"A"' },
      { path: "note", kind: "added", before: undefined, after: "null" },
      { path: "status", kind: "changed", before: '"ACTIVE"', after: '"DISABLED"' },
    ]);
  });

  it("handles a missing side", () => {
    expect(diffJson(null, { a: { b: 1 } })).toEqual([{ path: "a.b", kind: "added", before: undefined, after: "1" }]);
    expect(diffJson({ a: 1 }, null)).toEqual([{ path: "a", kind: "removed", before: "1", after: undefined }]);
  });
});
