/**
 * The copy of a shared picture a legacy Mumble client is shown, fitted the
 * way the engine fits it (`engine_api/legacy_picture.rs`), so both clients
 * send the same picture for the same budget.
 *
 * Size is kept before quality is given up, but only down to a quality worth
 * looking at: a full-size photograph at JPEG quality 0.1 is a smear, a
 * slightly smaller one at 0.5 is a photograph. So at each size, from the
 * box down in steps of 0.85: a PNG where one may well be the smaller (the
 * picture lets the page through, or has few colours) and fits; else JPEG at
 * 0.92 if that fits, else the best quality between 0.5 and 0.92 that fits.
 * Only when 0.5 does not fit is the picture made smaller. At 320 pixels on
 * its longer side the floor drops to 0.25, and below that nothing is sent.
 */

/** The rule's numbers, the engine's own. */
export const LEGACY_FIT = {
  qualityFloor: 50,
  qualityTop: 92,
  qualityLast: 25,
  step: 0.85,
  smallestSide: 320,
} as const;

/** What the search needs of a picture: how long its copy is, made a given way. */
export interface CopyMaker {
  /** The longer side of the picture as fitted into its box, in pixels. */
  readonly longSide: number;
  /** Whether a PNG is worth trying at every size, not only the first. */
  readonly pngEverywhere: boolean;
  /**
   * The copy at `scale` of the boxed picture: a PNG with `quality` null, a
   * JPEG at `quality` percent otherwise. Its `data:` address.
   */
  make(scale: number, quality: number | null): Promise<string>;
}

/** The best copy no longer than `budget` characters, or null. */
export async function searchLegacyCopy(maker: CopyMaker, budget: number): Promise<string | null> {
  const fits = (copy: string) => copy.length <= budget;
  let scale = 1;
  for (let first = true; ; first = false) {
    const side = Math.max(1, Math.round(maker.longSide * scale));
    const last = side <= LEGACY_FIT.smallestSide || scale < 0.01;
    if (first || maker.pngEverywhere) {
      const png = await maker.make(scale, null);
      if (fits(png)) return png;
    }
    const floor = last ? LEGACY_FIT.qualityLast : LEGACY_FIT.qualityFloor;
    const jpeg = await bestJpeg(maker, scale, floor, fits);
    if (jpeg) return jpeg;
    if (last) return null;
    scale *= LEGACY_FIT.step;
  }
}

/** The best JPEG at `scale` no worse than `floor` that fits, or null. */
async function bestJpeg(
  maker: CopyMaker,
  scale: number,
  floor: number,
  fits: (copy: string) => boolean,
): Promise<string | null> {
  const top = await maker.make(scale, LEGACY_FIT.qualityTop);
  if (fits(top)) return top;
  let best = await maker.make(scale, floor);
  if (!fits(best)) return null;
  let [low, high] = [floor, LEGACY_FIT.qualityTop as number];
  while (high - low > 2) {
    const middle = low + Math.floor((high - low) / 2);
    const copy = await maker.make(scale, middle);
    if (fits(copy)) {
      best = copy;
      low = middle;
    } else {
      high = middle;
    }
  }
  return best;
}
