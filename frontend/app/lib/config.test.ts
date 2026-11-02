import { describe, expect, it } from "vitest";

import { splitLocale } from "./config";

describe("splitLocale", () => {
  it("reads the locale from page paths", () => {
    expect(splitLocale("/id/boats")).toEqual({ locale: "id", path: "/boats" });
    expect(splitLocale("/id")).toEqual({ locale: "id", path: "/" });
    expect(splitLocale("/boats")).toEqual({ locale: "en", path: "/boats" });
  });

  it("reads the locale from client data requests", () => {
    expect(splitLocale("/id.data")).toEqual({ locale: "id", path: "/" });
    expect(splitLocale("/id/boats.data")).toEqual({ locale: "id", path: "/boats" });
    expect(splitLocale("/_root.data")).toEqual({ locale: "en", path: "/" });
  });
});
