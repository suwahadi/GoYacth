import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "~/lib/i18n";

import { Stars } from "./components";

function filledWidth(rating: number) {
  const { container, unmount } = render(
    <I18nProvider locale="en">
      <Stars rating={rating} />
    </I18nProvider>,
  );
  const width = container.querySelector("svg svg")?.getAttribute("width");
  unmount();
  return width;
}

describe("Stars", () => {
  it("fills the gold layer in proportion to the rating", () => {
    expect(filledWidth(5)).toBe("120");
    expect(filledWidth(4.5)).toBe("108");
    expect(filledWidth(0)).toBe("0");
  });

  it("never draws outside the five stars", () => {
    expect(filledWidth(7)).toBe("120");
    expect(filledWidth(-1)).toBe("0");
  });

  it("names the rating for screen readers", () => {
    render(
      <I18nProvider locale="en">
        <Stars rating={4.26} />
      </I18nProvider>,
    );
    expect(screen.getByRole("img", { name: "4.3 out of 5" })).toBeTruthy();
  });
});
