import { describe, expect, it } from "vitest";

import { FieldReader, basisPointsToPercent, clockToMinutes, linesToList, parseWhole, percentToBasisPoints } from "./convert";

describe("percent and basis points", () => {
  it("parses percent text into exact basis points", () => {
    expect(percentToBasisPoints("12.5")).toBe(1250);
    expect(percentToBasisPoints("12,5")).toBe(1250);
    expect(percentToBasisPoints("0.01")).toBe(1);
    expect(percentToBasisPoints("100")).toBe(10000);
    expect(percentToBasisPoints("33.33")).toBe(3333);
    expect(percentToBasisPoints(" 7 ")).toBe(700);
    expect(percentToBasisPoints("0.29")).toBe(29);
    expect(percentToBasisPoints("1.10")).toBe(110);
  });

  it("rejects values that are not whole basis points", () => {
    expect(percentToBasisPoints("12.345")).toBeNull();
    expect(percentToBasisPoints("-5")).toBeNull();
    expect(percentToBasisPoints("abc")).toBeNull();
    expect(percentToBasisPoints("")).toBeNull();
    expect(percentToBasisPoints("1e2")).toBeNull();
  });

  it("formats basis points back to percent text", () => {
    expect(basisPointsToPercent(1250)).toBe("12.5");
    expect(basisPointsToPercent(10000)).toBe("100");
    expect(basisPointsToPercent(1)).toBe("0.01");
    expect(basisPointsToPercent(1105)).toBe("11.05");
    expect(basisPointsToPercent(0)).toBe("0");
  });

  it("round-trips every basis point value", () => {
    for (let bp = 0; bp <= 10000; bp++) expect(percentToBasisPoints(basisPointsToPercent(bp))).toBe(bp);
  });
});

describe("clock", () => {
  it("converts HH:MM to minutes from midnight", () => {
    expect(clockToMinutes("00:00")).toBe(0);
    expect(clockToMinutes("07:30")).toBe(450);
    expect(clockToMinutes("7:05")).toBe(425);
    expect(clockToMinutes("23:59")).toBe(1439);
    expect(clockToMinutes("24:00")).toBe(1440);
  });

  it("rejects invalid clock values", () => {
    expect(clockToMinutes("24:01")).toBeNull();
    expect(clockToMinutes("12:60")).toBeNull();
    expect(clockToMinutes("1230")).toBeNull();
    expect(clockToMinutes("")).toBeNull();
  });
});

describe("whole numbers", () => {
  it("accepts plain digits and grouped thousands", () => {
    expect(parseWhole("1500000")).toBe(1500000);
    expect(parseWhole("1.500.000")).toBe(1500000);
    expect(parseWhole("1,500,000")).toBe(1500000);
    expect(parseWhole("0")).toBe(0);
  });

  it("rejects decimals and malformed grouping", () => {
    expect(parseWhole("1500.50")).toBeNull();
    expect(parseWhole("15.00.000")).toBeNull();
    expect(parseWhole("-1")).toBeNull();
    expect(parseWhole("99999999999999999999")).toBeNull();
  });
});

describe("FieldReader", () => {
  it("records errors under API paths", () => {
    const r = new FieldReader();
    expect(r.int("max_passengers", "")).toBe(0);
    expect(r.optInt("length_cm", "")).toBeNull();
    expect(r.optInt("beam_cm", "x")).toBeNull();
    expect(r.percent("commission_value", "120")).toBe(12000);
    expect(r.coord("stops.0.latitude", "-8.5", 90)).toBe(-8.5);
    expect(r.coord("stops.0.longitude", "200", 180)).toBeNull();
    expect(r.errors).toEqual({ max_passengers: "REQUIRED", beam_cm: "INVALID", commission_value: "OUT_OF_RANGE", "stops.0.longitude": "OUT_OF_RANGE" });
    expect(r.ok).toBe(false);
  });
});

it("splits lines into trimmed list items", () => {
  expect(linesToList(" Lunch \n\nSnorkel gear\n")).toEqual(["Lunch", "Snorkel gear"]);
});
