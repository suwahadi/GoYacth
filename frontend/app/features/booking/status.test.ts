import { describe, expect, it } from "vitest";

import type { Payment } from "~/lib/types";

import { POLL_LIMIT_MS, initialPollState, outcomeOf, pollReducer } from "./status";
import type { OrderStatus } from "./types";

const base: OrderStatus = {
  id: "b1",
  booking_number: "H6KF08QST20N",
  status: "PENDING_PAYMENT",
  payment_status: "UNPAID",
  starts_at: "2026-12-12T01:00:00Z",
  timezone: "Asia/Makassar",
  boat_name: "Ocean",
  route_name: "Komodo",
  hold_expires_at: null,
  payment: null,
};

function payment(status: Payment["status"]): Payment {
  return {
    id: "p1",
    kind: "BALANCE",
    provider: "MIDTRANS",
    method: "BCA_VA",
    order_id: "o1",
    principal_amount: 100,
    fee_amount: 0,
    gross_amount: 100,
    status,
    va_numbers: [],
    expires_at: null,
    paid_at: null,
    is_exception: false,
    created_at: "2026-11-01T00:00:00Z",
  };
}

describe("outcomeOf", () => {
  it("uses booking status when no payment is visible", () => {
    expect(outcomeOf(base)).toBe("pending");
    expect(outcomeOf({ ...base, status: "CONFIRMED", payment_status: "DEPOSIT_PAID" })).toBe("success");
    expect(outcomeOf({ ...base, status: "EXPIRED" })).toBe("expired");
    expect(outcomeOf({ ...base, status: "CANCELLED" })).toBe("cancelled");
  });

  it("prefers the latest payment, so a pending balance on a confirmed booking stays pending", () => {
    expect(outcomeOf({ ...base, status: "CONFIRMED", payment_status: "DEPOSIT_PAID", payment: payment("PENDING") })).toBe("pending");
    expect(outcomeOf({ ...base, payment: payment("SUCCEEDED") })).toBe("success");
    expect(outcomeOf({ ...base, payment: payment("FAILED") })).toBe("failed");
    expect(outcomeOf({ ...base, payment: payment("EXPIRED") })).toBe("expired");
  });

  it("never reports success for an expired booking", () => {
    expect(outcomeOf({ ...base, status: "EXPIRED", payment: payment("SUCCEEDED") })).toBe("expired");
  });
});

describe("pollReducer", () => {
  it("starts done when the first result is final", () => {
    expect(initialPollState({ ...base, status: "CONFIRMED" }, 0).phase).toBe("done");
    expect(initialPollState(base, 0).phase).toBe("polling");
  });

  it("stops polling once a final state arrives", () => {
    const s = pollReducer(initialPollState(base, 0), { type: "result", data: { ...base, payment: payment("SUCCEEDED") }, now: 3000 });
    expect(s.phase).toBe("done");
  });

  it("times out after the polling limit and restarts on demand", () => {
    let s = pollReducer(initialPollState(base, 0), { type: "result", data: base, now: 3000 });
    expect(s.phase).toBe("polling");
    s = pollReducer(s, { type: "result", data: base, now: POLL_LIMIT_MS });
    expect(s.phase).toBe("timed_out");
    s = pollReducer(s, { type: "restart", now: POLL_LIMIT_MS + 1 });
    expect(s.phase).toBe("polling");
    expect(s.startedAt).toBe(POLL_LIMIT_MS + 1);
  });

  it("keeps the last data on errors and still times out", () => {
    let s = initialPollState(base, 0);
    s = pollReducer(s, { type: "error", error: new Error("x"), now: 1000 });
    expect(s.phase).toBe("polling");
    expect(s.data).toBe(base);
    s = pollReducer(s, { type: "error", error: new Error("x"), now: POLL_LIMIT_MS + 5 });
    expect(s.phase).toBe("timed_out");
  });
});
