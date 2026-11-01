import { describe, expect, it } from "vitest";

import { addDays, dayList, dayRangeUtc, daysBetween, hoursBetween, utcToZoned, zonedToUtcISO } from "./time";

describe("zone conversion", () => {
  it("converts port wall-clock time to UTC", () => {
    expect(zonedToUtcISO("2026-12-12", "17:00", "Asia/Makassar")).toBe("2026-12-12T09:00:00Z");
    expect(zonedToUtcISO("2026-12-12", "07:30", "Asia/Jakarta")).toBe("2026-12-12T00:30:00Z");
    expect(zonedToUtcISO("2026-01-01", "02:00", "Asia/Jayapura")).toBe("2025-12-31T17:00:00Z");
  });

  it("round-trips through utcToZoned", () => {
    expect(utcToZoned("2026-12-12T09:00:00Z", "Asia/Makassar")).toEqual({ date: "2026-12-12", time: "17:00" });
    expect(utcToZoned("2025-12-31T17:00:00Z", "Asia/Jayapura")).toEqual({ date: "2026-01-01", time: "02:00" });
  });
});

describe("date arithmetic", () => {
  it("adds days across month and year ends", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-12-25", "2027-01-08")).toBe(14);
    expect(dayList("2026-12-30", 3)).toEqual(["2026-12-30", "2026-12-31", "2027-01-01"]);
  });

  it("turns an inclusive local range into a half-open UTC range", () => {
    expect(dayRangeUtc("2026-11-01", "2026-11-30", "Asia/Makassar")).toEqual({ from: "2026-10-31T16:00:00Z", to: "2026-11-30T16:00:00Z" });
    expect(dayRangeUtc(null, "bad", "Asia/Makassar")).toEqual({ from: undefined, to: undefined });
  });

  it("measures whole hours", () => {
    expect(hoursBetween("2026-12-12T03:00:00Z", "2026-12-12T09:00:00Z")).toBe(6);
  });
});
