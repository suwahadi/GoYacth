// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";

import { loadAnalytics } from "./analytics";

const dataLayer = () => (window as unknown as { dataLayer: unknown[] }).dataLayer;

beforeEach(() => {
  document.head.replaceChildren();
  delete (window as unknown as { dataLayer?: unknown[] }).dataLayer;
});

describe("loadAnalytics", () => {
  it("loads the GTM container and signals its start", () => {
    loadAnalytics({ gtm: "GTM-AB12" });
    expect(document.querySelector<HTMLScriptElement>("script#gtm")?.src).toBe("https://www.googletagmanager.com/gtm.js?id=GTM-AB12");
    expect(document.getElementById("ga4")).toBeNull();
    expect(dataLayer()).toEqual([expect.objectContaining({ event: "gtm.js" })]);
  });

  it("loads GA4 only when that is what is configured", () => {
    loadAnalytics({ ga4: "G-XYZ" });
    expect(document.querySelector<HTMLScriptElement>("script#ga4")?.src).toBe("https://www.googletagmanager.com/gtag/js?id=G-XYZ");
    expect(document.getElementById("gtm")).toBeNull();
  });

  it("does not load or signal twice when consent is re-applied", () => {
    loadAnalytics({ gtm: "GTM-AB12" });
    loadAnalytics({ gtm: "GTM-AB12" });
    expect(document.querySelectorAll("script#gtm")).toHaveLength(1);
    expect(dataLayer()).toHaveLength(1);
  });

  it("loads nothing without configured ids", () => {
    loadAnalytics({});
    expect(document.head.querySelectorAll("script")).toHaveLength(0);
  });
});
