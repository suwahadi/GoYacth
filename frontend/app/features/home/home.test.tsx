// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "~/lib/i18n";
import type { HomeSection, RegionCard, Review } from "~/lib/types";

import { HeroCarousel } from "./hero";
import { ReviewsSection } from "./reviews";
import { SearchBar } from "./search-bar";

afterEach(cleanup);

const wrap = (node: ReactNode) =>
  render(
    <MemoryRouter>
      <I18nProvider locale="en">{node}</I18nProvider>
    </MemoryRouter>,
  );

const slide = (id: string, title: string): HomeSection => ({
  id,
  type: "HERO",
  content: { title, subtitle: "", body: "", cta_label: "", cta_url: "", items: null },
  image: null,
});

const visibleHeading = () => screen.getByRole("heading").textContent;

describe("HeroCarousel", () => {
  it("renders the first slide as the page h1 and moves with the arrows", () => {
    wrap(<HeroCarousel slides={[slide("a", "First slide"), slide("b", "Second slide")]} />);
    const h1 = screen.getByRole("heading", { level: 1 });
    expect(h1.textContent).toBe("First slide");

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(visibleHeading()).toBe("Second slide");

    fireEvent.click(screen.getByRole("button", { name: "Next slide" }));
    expect(visibleHeading()).toBe("First slide");

    fireEvent.click(screen.getByRole("button", { name: "Previous slide" }));
    expect(visibleHeading()).toBe("Second slide");
  });

  it("jumps with the dots and marks the current one", () => {
    wrap(<HeroCarousel slides={[slide("a", "First slide"), slide("b", "Second slide"), slide("c", "Third slide")]} />);
    fireEvent.click(screen.getByRole("button", { name: "Go to slide 3" }));
    expect(visibleHeading()).toBe("Third slide");
    expect(screen.getByRole("button", { name: "Go to slide 3" }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: "Go to slide 1" }).getAttribute("aria-current")).toBeNull();
  });

  it("hides the controls for a single slide", () => {
    wrap(<HeroCarousel slides={[slide("a", "Only slide")]} />);
    expect(screen.queryByRole("button", { name: "Next slide" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Go to slide 1" })).toBeNull();
  });
});

describe("SearchBar", () => {
  const regions = [{ id: "r1", name: "Bali", slug: "bali" }] as RegionCard[];
  const form = () => screen.getByRole("search") as HTMLFormElement;

  it("searches boats with region, date and guests for a private charter", () => {
    wrap(<SearchBar regions={regions} />);
    expect(form().getAttribute("action")).toBe("/boats");
    expect(Array.from(new FormData(form()).keys())).toEqual(["date", "region_id", "pax"]);
  });

  it("searches departures by date only, since departures have no region or guest filter", () => {
    wrap(<SearchBar regions={regions} />);
    fireEvent.change(screen.getByLabelText("Booking Mode"), { target: { value: "departure" } });
    expect(form().getAttribute("action")).toBe("/departures");
    expect(Array.from(new FormData(form()).keys())).toEqual(["date"]);
  });
});

describe("ReviewsSection", () => {
  const review = (id: string, body: string) => ({ id, body, author_name: "Sample guest", author_country: "", rating_overall: 5 }) as Review;
  const section: HomeSection = { id: "r", type: "REVIEWS", content: { title: "What our guests say", subtitle: "", body: "", cta_label: "", cta_url: "", items: null }, image: null };

  it("renders nothing without reviews, so an empty catalog shows no invented proof", () => {
    const { container } = wrap(<ReviewsSection section={{ ...section, data: [] }} />);
    expect(container.textContent).toBe("");
  });

  // Both carousels are in the markup; CSS shows the phone one below lg and the desktop one above.
  it("pages one review at a time on phones and three at a time on desktops", () => {
    wrap(<ReviewsSection section={{ ...section, data: ["1", "2", "3", "4"].map((n) => review(n, `Review ${n}`)) }} />);
    expect(screen.getAllByText("Review 1")).toHaveLength(2);
    expect(screen.getAllByText("Review 3")).toHaveLength(1);
    expect(screen.queryByText("Review 4")).toBeNull();

    const [phoneNext, desktopNext] = screen.getAllByRole("button", { name: "Next review" });
    fireEvent.click(desktopNext);
    expect(screen.getByText("Review 4")).toBeTruthy();
    expect(screen.getAllByText("Review 1")).toHaveLength(1);
    fireEvent.click(phoneNext);
    expect(screen.queryByText("Review 1")).toBeNull();
    expect(screen.getAllByText("Review 2")).toHaveLength(1);
  });
});
