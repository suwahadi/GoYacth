import type { OrderStatus } from "./types";

export type Outcome = "success" | "pending" | "failed" | "expired" | "cancelled";

export const POLL_INTERVAL_MS = 3000;
export const POLL_LIMIT_MS = 10 * 60 * 1000;

// outcomeOf reads the server's verdict. The latest payment attempt is authoritative for the
// owner (a balance payment can be pending on an already confirmed booking); without it the
// booking status decides.
export function outcomeOf(s: OrderStatus): Outcome {
  if (s.status === "EXPIRED") return "expired";
  if (s.status === "CANCELLED") return "cancelled";
  if (s.payment) {
    switch (s.payment.status) {
      case "SUCCEEDED":
        return "success";
      case "FAILED":
      case "CANCELLED":
        return "failed";
      case "EXPIRED":
        return "expired";
      default:
        return "pending";
    }
  }
  if (s.status === "PENDING_PAYMENT") return "pending";
  return "success";
}

export function isFinal(o: Outcome): boolean {
  return o !== "pending";
}

export interface PollState {
  phase: "polling" | "done" | "timed_out";
  startedAt: number;
  data: OrderStatus | null;
  error: unknown;
}

export type PollEvent =
  | { type: "result"; data: OrderStatus; now: number }
  | { type: "error"; error: unknown; now: number }
  | { type: "restart"; now: number };

export function initialPollState(data: OrderStatus | null, now: number): PollState {
  const done = data !== null && isFinal(outcomeOf(data));
  return { phase: done ? "done" : "polling", startedAt: now, data, error: null };
}

export function pollReducer(state: PollState, ev: PollEvent): PollState {
  switch (ev.type) {
    case "restart":
      return { ...state, phase: "polling", startedAt: ev.now, error: null };
    case "result": {
      if (isFinal(outcomeOf(ev.data))) return { ...state, phase: "done", data: ev.data, error: null };
      const phase = ev.now - state.startedAt >= POLL_LIMIT_MS ? "timed_out" : state.phase;
      return { ...state, phase, data: ev.data, error: null };
    }
    case "error": {
      const phase = ev.now - state.startedAt >= POLL_LIMIT_MS ? "timed_out" : state.phase;
      return { ...state, phase, error: ev.error };
    }
  }
}
