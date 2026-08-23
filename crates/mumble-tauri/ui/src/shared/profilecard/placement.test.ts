import { describe, expect, it } from "vitest";
import { placeBesideAnchor, pointAnchor } from "./placement";

const CARD = { width: 300, height: 400 };
const SCREEN = { width: 1400, height: 900 };
/** A 32px member row at the right-hand edge, where the roster lives. */
const ROSTER_ROW = { left: 1100, top: 300, right: 1360, bottom: 332 };

describe("placeBesideAnchor", () => {
  it("puts the card beside the row, never over it", () => {
    const placed = placeBesideAnchor({ left: 40, top: 300, right: 300, bottom: 332 }, CARD, SCREEN);
    expect(placed.side).toBe("right");
    expect(placed.left).toBe(312);
    expect(placed.left).toBeGreaterThanOrEqual(300);
  });

  it("centres the card on the row rather than hanging it from the pointer", () => {
    const placed = placeBesideAnchor({ left: 40, top: 300, right: 300, bottom: 332 }, CARD, SCREEN);
    // The row's middle is 316; a 400-tall card centred on it starts at 116.
    expect(placed.top).toBe(116);
  });

  it("flips to the side that has room", () => {
    const placed = placeBesideAnchor(ROSTER_ROW, CARD, SCREEN);
    expect(placed.side).toBe("left");
    expect(placed.left).toBe(1100 - 12 - 300);
  });

  it("honours a stated side while it fits, and abandons it when it does not", () => {
    expect(placeBesideAnchor(ROSTER_ROW, CARD, SCREEN, { prefer: "left" }).side).toBe("left");
    // Nothing to the left of a row at the window's edge, so "left" cannot hold.
    const atEdge = { left: 0, top: 300, right: 260, bottom: 332 };
    expect(placeBesideAnchor(atEdge, CARD, SCREEN, { prefer: "left" }).side).toBe("right");
  });

  it("keeps a tall card on screen instead of letting it run off the bottom", () => {
    const low = { left: 40, top: 860, right: 300, bottom: 892 };
    const placed = placeBesideAnchor(low, CARD, SCREEN);
    expect(placed.top).toBe(SCREEN.height - CARD.height - 8);
    expect(placed.top + CARD.height).toBeLessThanOrEqual(SCREEN.height);
  });

  it("clamps rather than overflowing when neither side can take the card", () => {
    const narrow = { width: 320, height: 900 };
    const placed = placeBesideAnchor({ left: 10, top: 400, right: 310, bottom: 432 }, CARD, narrow);
    expect(placed.left).toBeGreaterThanOrEqual(8);
    expect(placed.left + CARD.width).toBeLessThanOrEqual(narrow.width);
  });

  it("falls back to the pointer for an event with no row behind it", () => {
    expect(pointAnchor(500, 250)).toEqual({ left: 500, top: 250, right: 500, bottom: 250 });
  });
});
