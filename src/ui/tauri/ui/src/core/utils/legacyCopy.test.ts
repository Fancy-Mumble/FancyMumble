import { describe, expect, it } from "vitest";
import { LEGACY_FIT, searchLegacyCopy, type CopyMaker } from "./legacyCopy";

/**
 * A made-up picture whose copy weighs `pixels x quality x weight`: enough to
 * tell what the search chose without a canvas.
 */
function maker(longSide: number, weight: number, options: { png?: number; pngEverywhere?: boolean } = {}) {
  const made: string[] = [];
  const picture: CopyMaker = {
    longSide,
    pngEverywhere: options.pngEverywhere ?? false,
    async make(scale, quality) {
      const side = longSide * scale;
      const length =
        quality === null ? (options.png ?? Number.POSITIVE_INFINITY) * scale * scale : side * side * quality * weight;
      made.push(quality === null ? `png@${scale.toFixed(3)}` : `jpeg${quality}@${scale.toFixed(3)}`);
      return "x".repeat(Math.min(Math.round(length), 10_000_000));
    },
  };
  return { picture, made };
}

describe("a legacy copy", () => {
  it("keeps full size while a quality worth looking at fits", async () => {
    // At full size quality 50 weighs 50_000, 92 weighs 92_000.
    const { picture, made } = maker(100, 0.1);
    const copy = await searchLegacyCopy(picture, 60_000);
    expect(copy!.length).toBeLessThanOrEqual(60_000);
    expect(copy!.length).toBeGreaterThanOrEqual(56_000);
    expect(made.every((step) => step.endsWith("@1.000"))).toBe(true);
  });

  it("is made smaller rather than worse than the floor", async () => {
    const { picture, made } = maker(1600, 0.002);
    // Full size at quality 50 would need 256,000: over, but not by far.
    const copy = await searchLegacyCopy(picture, 131_000);
    expect(copy).not.toBeNull();
    expect(copy!.length).toBeLessThanOrEqual(131_000);
    const chosen = made.filter((step) => step.startsWith("jpeg")).at(-1)!;
    const quality = Number(/jpeg(\d+)/.exec(chosen)![1]);
    expect(quality).toBeGreaterThanOrEqual(LEGACY_FIT.qualityFloor);
    expect(made.some((step) => step === `jpeg${LEGACY_FIT.qualityFloor}@1.000`)).toBe(true);
    expect(made.some((step) => /jpeg\d+@0\.\d+/.test(step))).toBe(true);
  });

  it("goes as a PNG where one fits, and tries it at every size only where worth it", async () => {
    const card = maker(1200, 0.1, { png: 40_000 });
    expect(await searchLegacyCopy(card.picture, 131_000)).toHaveLength(40_000);
    expect(card.made).toEqual(["png@1.000"]);
    const clear = maker(1200, 1, { png: 400_000, pngEverywhere: true });
    await searchLegacyCopy(clear.picture, 131_000);
    expect(clear.made.filter((step) => step.startsWith("png")).length).toBeGreaterThan(1);
  });

  it("gives up below a picture worth showing", async () => {
    const { picture } = maker(4000, 100);
    expect(await searchLegacyCopy(picture, 1_000)).toBeNull();
  });
});
