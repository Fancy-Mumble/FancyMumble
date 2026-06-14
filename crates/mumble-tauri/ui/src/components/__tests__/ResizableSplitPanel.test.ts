import { describe, it, expect } from "vitest";
import { clampSplitHeight } from "../chat/ResizableSplitPanel";

describe("clampSplitHeight", () => {
  it("clamps below the minimum up to the minimum", () => {
    expect(clampSplitHeight(50, 150, 800)).toBe(150);
  });

  it("clamps above the maximum down to the maximum", () => {
    expect(clampSplitHeight(900, 150, 800)).toBe(800);
  });

  it("passes a value within range through unchanged", () => {
    expect(clampSplitHeight(400, 150, 800)).toBe(400);
  });

  it("floors the max at the min when max < min (tiny viewport)", () => {
    expect(clampSplitHeight(400, 200, 100)).toBe(200);
    expect(clampSplitHeight(50, 200, 100)).toBe(200);
  });
});
