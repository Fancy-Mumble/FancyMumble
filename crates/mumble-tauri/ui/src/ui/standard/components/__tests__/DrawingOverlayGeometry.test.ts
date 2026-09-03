/**
 * The content rect: where the shared source actually is, in the coordinates
 * the canvas over it uses.
 *
 * Everything about annotation depends on this and nothing else checks it. Get
 * it wrong and the strokes still travel, still arrive, still paint - just in
 * the wrong place, which is the failure mode a screenshot catches and a test
 * suite usually does not.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
  emit: vi.fn(async () => undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { computeContentRect, mediaContentRect, type MediaBox } from "../chat/drawing/DrawingOverlay";

const box = (left: number, top: number, width: number, height: number): MediaBox => ({
  left,
  top,
  width,
  height,
});

/** A 2:1 source in a 4:3 box, so every fit mode lands somewhere different. */
const SOURCE_W = 800;
const SOURCE_H = 400;
const VIEWPORT = box(0, 0, 400, 300);

describe("computeContentRect", () => {
  it("letterboxes a wide source into a taller canvas", () => {
    expect(computeContentRect(SOURCE_W, SOURCE_H, 400, 300)).toEqual({ x: 0, y: 50, w: 400, h: 200 });
  });

  it("falls back to the whole canvas when the source size is unknown", () => {
    expect(computeContentRect(0, 0, 400, 300)).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});

describe("mediaContentRect", () => {
  it("agrees with computeContentRect when the media fills the canvas and is contained", () => {
    expect(mediaContentRect(VIEWPORT, VIEWPORT, SOURCE_W, SOURCE_H, "contain")).toEqual(
      computeContentRect(SOURCE_W, SOURCE_H, 400, 300),
    );
  });

  it("lets a cover-fitted source run off both edges of the canvas", () => {
    // Scaled to fill the height, a 2:1 source is 600 wide in a 400-wide well:
    // 100px of it is cropped away on each side, and a stroke aimed at what IS
    // visible has to land in the middle of a rect that starts at -100.
    expect(mediaContentRect(VIEWPORT, VIEWPORT, SOURCE_W, SOURCE_H, "cover")).toEqual({
      x: -100,
      y: 0,
      w: 600,
      h: 300,
    });
  });

  it("follows a 1:1 picture as its scroller moves it", () => {
    // `none` is the source at its own pixels, so the box IS the content -
    // wherever the scroll container has pushed it relative to the canvas.
    expect(
      mediaContentRect(box(-250, -50, SOURCE_W, SOURCE_H), VIEWPORT, SOURCE_W, SOURCE_H, "none"),
    ).toEqual({ x: -250, y: -50, w: SOURCE_W, h: SOURCE_H });
  });

  it("measures the media box against the canvas, not against the page", () => {
    // Both offset by the same amount: the picture has not moved relative to
    // the canvas, so neither has the content rect.
    expect(
      mediaContentRect(box(120, 80, 400, 300), box(120, 80, 400, 300), SOURCE_W, SOURCE_H, "contain"),
    ).toEqual({ x: 0, y: 50, w: 400, h: 200 });
  });

  it("falls back to the whole canvas before the first frame sizes the source", () => {
    expect(mediaContentRect(VIEWPORT, VIEWPORT, 0, 0, "contain")).toEqual({ x: 0, y: 0, w: 400, h: 300 });
  });
});
