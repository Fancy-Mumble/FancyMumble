import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { BRAND_GLYPH_HEIGHT, BRAND_GLYPH_PATH, BRAND_GLYPH_WIDTH } from "@core/brandGlyph";
import { BrandGlyph } from "./BrandGlyph";

/**
 * The monogram is a drop-in: a caller decides its colour, size, position and
 * what sits behind it. These say so, because the moment one of them stops
 * being true the mark needs a variant for every place it appears.
 */
describe("BrandGlyph", () => {
  const glyph = (element: HTMLElement) => element.querySelector("svg");

  it("draws the shared outline", () => {
    const { container } = render(<BrandGlyph />);
    expect(glyph(container)?.querySelector("path")?.getAttribute("d")).toBe(BRAND_GLYPH_PATH);
  });

  it("takes its colour from whatever it is dropped into", () => {
    // `currentColor` rather than a fill of its own: a mark in a menu, a title
    // bar and a watermark are three colours and must not be three components.
    const { container } = render(<BrandGlyph />);
    expect(glyph(container)?.querySelector("path")?.getAttribute("fill")).toBe("currentColor");
  });

  it("paints nothing behind itself", () => {
    // The tile is the caller's. A glyph that carried its own background could
    // not be put on one.
    const { container } = render(<BrandGlyph />);
    const svg = glyph(container);
    expect(svg?.querySelectorAll("rect")).toHaveLength(0);
    expect(svg?.getAttribute("style") ?? "").not.toContain("background");
  });

  it("fits the box it is given rather than one of its own", () => {
    const { container } = render(<BrandGlyph />);
    const svg = glyph(container);
    expect(svg?.getAttribute("viewBox")).toBe(`0 0 ${BRAND_GLYPH_WIDTH} ${BRAND_GLYPH_HEIGHT}`);
    // No width or height attribute, so CSS decides and the caller is not
    // fighting an intrinsic size.
    expect(svg?.hasAttribute("width")).toBe(false);
    expect(svg?.hasAttribute("height")).toBe(false);
  });

  it("is silent to a screen reader", () => {
    // It is a decoration beside the app's name, never the name itself.
    const { container } = render(<BrandGlyph />);
    expect(glyph(container)?.getAttribute("aria-hidden")).toBe("true");
  });

  it("emboldens by stroking, since the face has one weight", () => {
    const { container } = render(<BrandGlyph embolden={0.1} />);
    const path = glyph(container)?.querySelector("path");
    expect(path?.getAttribute("stroke")).toBe("currentColor");
    // Against the longest side, which is the one that meets the box: the
    // monogram is wider than it is tall, and measuring against its height
    // drew it visibly lighter than the canvas icon at the same setting.
    expect(Number(path?.getAttribute("stroke-width"))).toBeCloseTo(
      Math.max(BRAND_GLYPH_WIDTH, BRAND_GLYPH_HEIGHT) * 0.1,
    );
  });

  it("grows the box by the stroke rather than shrinking the letter into it", () => {
    // Half a stroke falls outside the ink box. Were the box left alone the
    // mark would be clipped; were the glyph scaled down instead, an emboldened
    // mark would read smaller than a plain one beside it.
    const { container } = render(<BrandGlyph embolden={0.1} />);
    const stroke = Math.max(BRAND_GLYPH_WIDTH, BRAND_GLYPH_HEIGHT) * 0.1;
    expect(glyph(container)?.getAttribute("viewBox")).toBe(
      `${-stroke / 2} ${-stroke / 2} ${BRAND_GLYPH_WIDTH + stroke} ${BRAND_GLYPH_HEIGHT + stroke}`,
    );
  });

  it("has no stroke at all when it is not asked for", () => {
    const { container } = render(<BrandGlyph />);
    expect(glyph(container)?.querySelector("path")?.hasAttribute("stroke")).toBe(false);
  });

  it("lets a caller through to the element", () => {
    const { container } = render(<BrandGlyph className="mark" data-testid="glyph" />);
    expect(glyph(container)?.getAttribute("class")).toBe("mark");
    expect(glyph(container)?.getAttribute("data-testid")).toBe("glyph");
  });
});
