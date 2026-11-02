import { describe, expect, it } from "vitest";

import type { BoatCard, HomeSection, RegionCard, Review } from "~/lib/types";

import { fallbackSections } from "./fallback";
import { accentSplit, splitHomeSections } from "./sections";

const section = (id: string, type: HomeSection["type"], data?: unknown): HomeSection => ({
  id,
  type,
  content: { title: id, subtitle: "", body: "", cta_label: "", cta_url: "", items: null },
  image: null,
  data,
});

const region = { id: "r1", name: "Bali", slug: "bali", locale: "en", description: "", thumbnail: null } as RegionCard;
const boat = { id: "b1", name: "Ocean Majesty", slug: "ocean-majesty", max_passengers: 8, thumbnail: null } as BoatCard;

describe("splitHomeSections", () => {
  it("gathers HERO sections into slides and keeps the admin order of the rest", () => {
    const { slides, rest } = splitHomeSections([section("a", "HIGHLIGHTS"), section("h1", "HERO"), section("b", "CTA"), section("h2", "HERO")]);
    expect(slides.map((s) => s.id)).toEqual(["h1", "h2"]);
    expect(rest.map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("exposes regions from the REGIONS section for the search bar", () => {
    expect(splitHomeSections([section("r", "REGIONS", [region])]).regions).toEqual([region]);
    expect(splitHomeSections([section("x", "CTA")]).regions).toEqual([]);
  });
});

describe("accentSplit", () => {
  it("separates the last word of a heading", () => {
    expect(accentSplit("Discover the Beauty of Indonesia")).toEqual(["Discover the Beauty of ", "Indonesia"]);
  });

  it("keeps one-word and empty headings intact", () => {
    expect(accentSplit("Indonesia")).toEqual(["", "Indonesia"]);
    expect(accentSplit("")).toEqual(["", ""]);
  });
});

describe("fallbackSections", () => {
  const empty = { boats: [], regions: [] };

  it("serves the requested language", () => {
    expect(fallbackSections("en", empty)[0].content.title).toBe("Discover the\nBeauty of Indonesia");
    expect(fallbackSections("id", empty)[0].content.title).toBe("Temukan Keindahan Indonesia");
  });

  it("keeps the same sections in every language", () => {
    const shape = (l: "en" | "id") => fallbackSections(l, empty).map((s) => [s.id, s.type, s.content.items?.length ?? 0]);
    expect(shape("id")).toEqual(shape("en"));
  });

  it("prefers real boats and regions over static ones", () => {
    const sections = fallbackSections("en", { boats: [boat], regions: [region] });
    expect(sections.find((s) => s.type === "FEATURED_BOATS")?.data).toEqual([boat]);
    expect(sections.find((s) => s.type === "REGIONS")?.data).toEqual([region]);
  });

  it("keeps static boats and regions while the catalog is empty", () => {
    const sections = fallbackSections("en", empty);
    expect((sections.find((s) => s.type === "FEATURED_BOATS")?.data as BoatCard[]).map((b) => b.name)).toEqual(["Luxury Yacht", "Catamaran", "Phinisi"]);
    expect((sections.find((s) => s.type === "REGIONS")?.data as RegionCard[]).length).toBeGreaterThan(0);
  });

  it("never shows reviews unless samples are passed in", () => {
    expect(fallbackSections("en", empty).find((s) => s.type === "REVIEWS")?.data).toEqual([]);
    const sample = [{ id: "s1", body: "sample" }] as Review[];
    expect(fallbackSections("en", empty, sample).find((s) => s.type === "REVIEWS")?.data).toEqual(sample);
  });
});
