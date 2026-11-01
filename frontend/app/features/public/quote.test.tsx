import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useQuote, type QuoteRequest } from "./quote";

const request = (pax: number): QuoteRequest => ({
  product: { mode: "PRIVATE_CHARTER", boat_id: "b", route_id: "r", date: "2026-12-12", start_time: "09:00", rate_unit: "HOURLY", units: 3 },
  pax,
  locale: "en",
});

describe("useQuote", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn((_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as QuoteRequest;
      return Promise.resolve(new Response(JSON.stringify({ data: { grand_total: body.pax * 100 } }), { status: 200 }));
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("stays idle without a complete request", () => {
    const { result } = renderHook(() => useQuote(null));
    expect(result.current.status).toBe("idle");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("debounces changes and only sends the latest selection", async () => {
    const { result, rerender } = renderHook(({ r }) => useQuote(r), { initialProps: { r: request(2) } });
    expect(result.current.status).toBe("loading");
    rerender({ r: request(3) });
    rerender({ r: request(4) });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body)).pax).toBe(4);
    expect(result.current.status).toBe("success");
  });

  it("aborts an in-flight request when the selection changes", async () => {
    const signals: AbortSignal[] = [];
    fetchMock.mockImplementation((_url: string, init: RequestInit) => {
      signals.push(init.signal as AbortSignal);
      return new Promise(() => {});
    });
    const { rerender } = renderHook(({ r }) => useQuote(r), { initialProps: { r: request(2) } });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    rerender({ r: request(5) });
    expect(signals[0].aborted).toBe(true);
  });

  it("reports API errors", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ error: { code: "BOOKING_LEAD_TIME", message: "x" } }), { status: 422 })),
    );
    const { result } = renderHook(() => useQuote(request(2)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(result.current.status).toBe("error");
  });
});
