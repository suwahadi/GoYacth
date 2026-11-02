import type { HomeSection, RegionCard } from "~/lib/types";

// The reference keeps content at about 85% of the viewport, so the gutters scale with it.
export const homeWidth = "mx-auto w-full max-w-[120rem] px-5 lg:px-[7.3vw]";

export function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

// Every HERO section is one carousel slide, wherever the admin placed it. The search bar always
// sits under the hero and reads its destinations from the REGIONS section.
export function splitHomeSections(sections: HomeSection[]) {
  return {
    slides: sections.filter((s) => s.type === "HERO"),
    rest: sections.filter((s) => s.type !== "HERO"),
    regions: asArray<RegionCard>(sections.find((s) => s.type === "REGIONS")?.data),
  };
}

export function accentSplit(title: string): [lead: string, accent: string] {
  const space = title.lastIndexOf(" ");
  return [title.slice(0, space + 1), title.slice(space + 1)];
}
