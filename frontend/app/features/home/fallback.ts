import type { Locale } from "~/lib/config";
import type { BoatCard, HomeSection, RegionCard, Review } from "~/lib/types";

import en from "./data/home.en.json";
import id from "./data/home.id.json";

const sections: Record<Locale, unknown> = { en, id };

export interface CatalogData {
  boats: BoatCard[];
  regions: RegionCard[];
}

// shortcut: static copy stands in for the CMS and has the same shape as GET /home, so admin content
// replaces it with no code change. Delete data/ and this file once the homepage sections are live.
export function fallbackSections(locale: Locale, catalog: CatalogData, reviews: Review[] = []): HomeSection[] {
  return (sections[locale] as HomeSection[]).map((s) => {
    if (s.type === "FEATURED_BOATS" && catalog.boats.length > 0) return { ...s, data: catalog.boats };
    if (s.type === "REGIONS" && catalog.regions.length > 0) return { ...s, data: catalog.regions };
    if (s.type === "REVIEWS") return { ...s, data: reviews };
    return s;
  });
}

// The owner approved sample reviews for development only. The dynamic import keeps them out of the
// production bundle, so a customer can never read an invented review.
export async function homeFallback(locale: Locale, catalog: CatalogData): Promise<HomeSection[]> {
  const samples = import.meta.env.DEV ? (await import("./data/reviews.sample.json")).default[locale] : [];
  return fallbackSections(locale, catalog, samples as Review[]);
}
