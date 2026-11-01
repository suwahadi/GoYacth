import { describe, expect, it } from "vitest";

import { nextIdempotencyKey } from "./idempotency";

describe("nextIdempotencyKey", () => {
  let n = 0;
  const gen = () => `key-${++n}`;

  it("reuses the key for unchanged content and renews it on change", () => {
    const first = nextIdempotencyKey(null, "a", gen);
    expect(nextIdempotencyKey(first, "a", gen).key).toBe(first.key);
    const changed = nextIdempotencyKey(first, "b", gen);
    expect(changed.key).not.toBe(first.key);
    expect(changed.fingerprint).toBe("b");
  });
});
