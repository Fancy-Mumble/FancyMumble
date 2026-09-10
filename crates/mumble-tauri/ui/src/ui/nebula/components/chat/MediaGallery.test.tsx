/**
 * One picture, at its own shape - until its own shape stops being one.
 */

import { render, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { withNebulaTheme } from "../../testTheme";
import { MediaGallery } from "./MediaGallery";

/** Proportions jsdom will not invent on its own, then the load event. */
function loadPicture(image: HTMLImageElement, width: number, height: number): void {
  Object.defineProperty(image, "naturalWidth", { value: width, configurable: true });
  Object.defineProperty(image, "naturalHeight", { value: height, configurable: true });
  fireEvent.load(image);
}

const picture = [{ src: "https://files.example/dusk.png", alt: "dusk" }];

describe("a single picture in a message", () => {
  it("keeps its own shape while that is a shape worth keeping", () => {
    const { container } = render(withNebulaTheme(<MediaGallery images={picture} />));
    const image = container.querySelector("img")!;
    loadPicture(image, 1200, 800);
    const style = getComputedStyle(image);
    expect(style.maxHeight).toBe("320px");
    expect(style.objectFit).not.toBe("cover");
  });

  it("frames a picture far longer than it is wide, whole, on a blurred copy", () => {
    const { container } = render(withNebulaTheme(<MediaGallery images={picture} />));
    const image = container.querySelector("img")!;
    // 154x829: the height cap alone would draw this 59 pixels across.
    loadPicture(image, 154, 829);

    const frame = getComputedStyle(container.querySelector("button")!);
    expect(frame.width).toBe("300px");
    expect(frame.height).toBe("400px");

    // Two pictures now: the blurred backdrop fills the frame, and the picture
    // itself sits inside it whole rather than cropped to fit.
    const drawn = container.querySelectorAll("img");
    expect(drawn).toHaveLength(2);
    expect(getComputedStyle(drawn[0]!).objectFit).toBe("cover");
    expect(getComputedStyle(drawn[0]!).filter).toContain("blur");
    expect(getComputedStyle(drawn[1]!).objectFit).toBe("contain");
  });
});

describe("a block of pictures", () => {
  const pair = [
    { src: "https://files.example/ferry.png", alt: "ferry" },
    { src: "https://files.example/skyline.png", alt: "skyline" },
  ];

  it("gives every tile the same shape, whatever shape its picture is", () => {
    const { container } = render(withNebulaTheme(<MediaGallery images={pair} />));
    const tiles = [...container.querySelectorAll("button")];
    expect(tiles).toHaveLength(2);

    // The cell decides the shape. A tile that took its picture's instead left
    // the block ragged - two of four filled, the other two short and adrift.
    const shapes = tiles.map((tile) => getComputedStyle(tile).aspectRatio);
    expect(shapes[0]).toBeTruthy();
    expect(shapes[1]).toBe(shapes[0]);

    // Both axes pinned, so a tile always fills the row it landed in. On the
    // shape alone a cell shorter than its row top-anchors inside it, and what
    // shows under the picture is the thread's own background.
    for (const tile of tiles) {
      const box = getComputedStyle(tile);
      expect(box.width).toBe("100%");
      expect(box.height).toBe("100%");
    }

    // Two pictures to a tile: the blurred copy fills the cell, and the picture
    // itself sits whole in the middle of it rather than cropped to the cell.
    const drawn = container.querySelectorAll("img");
    expect(drawn).toHaveLength(4);
    expect(getComputedStyle(drawn[0]!).objectFit).toBe("cover");
    expect(getComputedStyle(drawn[0]!).filter).toContain("blur");
    expect(getComputedStyle(drawn[1]!).objectFit).toBe("contain");

    // The backdrop is the same picture, so only one of the two is named.
    expect(screen.getAllByAltText("ferry")).toHaveLength(1);
  });

  it("draws every tile on a checkerboard, so a picture with holes reads as one", () => {
    const { container } = render(withNebulaTheme(<MediaGallery images={pair} />));
    // A PNG with an alpha channel drawn straight onto the thread looks like a
    // tile that failed to fill. Behind everything and unconditional: an opaque
    // photograph covers it, and no one has to work out which pictures have an
    // alpha channel - which is not a question CSS can ask.
    for (const tile of container.querySelectorAll("button")) {
      expect(getComputedStyle(tile).backgroundImage).toContain("repeating-conic-gradient");
    }
  });

  it("enlarges the picture whose tile was clicked", () => {
    const onOpen = vi.fn();
    render(withNebulaTheme(<MediaGallery images={pair} onOpen={onOpen} />));
    fireEvent.click(screen.getByAltText("skyline"));
    expect(onOpen).toHaveBeenCalledWith("https://files.example/skyline.png");
  });
});

describe("a picture pasted into the body", () => {
  // 1 KiB of payload: 1024 base64 characters carry 768 bytes.
  const pasted = [{ src: `data:image/png;base64,${"A".repeat(1024)}`, alt: "" }];

  it("says what it weighs, the one fact it has", () => {
    render(withNebulaTheme(<MediaGallery images={pasted} />));
    expect(screen.getByText("768 B")).toBeTruthy();
  });

  it("says nothing about a picture the body only points at", () => {
    render(withNebulaTheme(<MediaGallery images={picture} />));
    // A URL is a fetch away, and a chip that waited on the network would
    // appear halfway through reading the message.
    expect(screen.queryByText(/B$|KiB|MiB/)).toBeNull();
  });
});
