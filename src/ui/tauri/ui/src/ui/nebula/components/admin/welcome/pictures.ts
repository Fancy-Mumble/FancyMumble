/**
 * Getting a picture into a design, which is mostly a question of arithmetic.
 *
 * A picture held as an *asset* travels beside the markup as bytes, so it is not
 * base64 and it is not held to the four kilobytes a string greeting is capped
 * at. It is still not free: the server refuses a payload over `MAX_PAYLOAD` and
 * a single picture over `MAX_ASSET`, and every byte is paid on each join that
 * misses the client's cache.
 *
 * So the job here is to land a chosen file inside those limits without anybody
 * having to think about it: crop it to the shape of the box it will be drawn
 * in, scale it to the size it will actually be seen at, and step the quality
 * down only as far as it has to go.
 */

/** The most one picture may weigh. `MAX_ASSET` in the server's greeting_binary. */
export const MAX_ASSET_BYTES = 196_608;

/** The most all of a design's pictures may weigh together. */
export const MAX_ASSETS_BYTES = 262_144;

/** Pictures one design may carry. */
export const MAX_ASSETS = 16;

/** Where a source image is cropped so it fills a box without distorting. */
export interface Crop {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/**
 * The part of a source image that fills `box` when scaled to it.
 *
 * A centred cover crop: the box is filled and the overflow comes off the long
 * side evenly. Stretching would be the one thing worse than cropping, because
 * a stretched face is a mistake nobody can unsee.
 */
export function coverCrop(
  natural: { readonly w: number; readonly h: number },
  box: { readonly w: number; readonly h: number },
): Crop {
  if (natural.w <= 0 || natural.h <= 0 || box.w <= 0 || box.h <= 0) {
    return { sx: 0, sy: 0, sw: Math.max(1, natural.w), sh: Math.max(1, natural.h) };
  }
  const want = box.w / box.h;
  const have = natural.w / natural.h;
  if (have > want) {
    const sw = Math.round(natural.h * want);
    return { sx: Math.round((natural.w - sw) / 2), sy: 0, sw, sh: natural.h };
  }
  const sh = Math.round(natural.w / want);
  return { sx: 0, sy: Math.round((natural.h - sh) / 2), sw: natural.w, sh };
}

/**
 * The sizes to try, largest first.
 *
 * Twice the drawn size at the top, because a greeting is read on displays that
 * are mostly not one device pixel per CSS pixel, and a picture encoded at the
 * CSS size is visibly soft on every one of them. Scale comes down before
 * quality does: dropping the quality of an oversized picture spends the budget
 * blurring detail nobody was going to see, while halving its dimensions spends
 * a quarter of the bytes and looks the same on the page.
 */
export function scaleSteps(box: { readonly w: number; readonly h: number }): { w: number; h: number }[] {
  const steps: { w: number; h: number }[] = [];
  for (const factor of [2, 1.5, 1, 0.8, 0.65, 0.5, 0.35]) {
    const w = Math.max(8, Math.round(box.w * factor));
    const h = Math.max(8, Math.round(box.h * factor));
    if (steps.some((step) => step.w === w && step.h === h)) continue;
    steps.push({ w, h });
  }
  return steps;
}

/** The qualities to try at each size, best first. */
export const QUALITY_STEPS = [0.9, 0.82, 0.72, 0.62, 0.5, 0.4] as const;

/**
 * The formats to try, in the order they are worth trying.
 *
 * WebP first: roughly a third smaller than JPEG at a matching quality, and it
 * is one of the types the server's allow-list names. The JPEG fallback is for
 * an engine that cannot write WebP, which would otherwise hand back a PNG of a
 * photograph and blow the budget on the first step.
 */
export const FORMATS = ["image/webp", "image/jpeg"] as const;

/** What a finished encode came out as. */
export interface Fitted {
  readonly src: string;
  readonly mime: string;
  /** What it weighs as bytes, which is what the server's caps count. */
  readonly bytes: number;
  readonly w: number;
  readonly h: number;
}

/** The bytes behind a `data:` URI, without decoding it. */
export function bytesOf(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const body = dataUrl.length - comma - 1;
  const padding = dataUrl.endsWith("==") ? 2 : dataUrl.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((body * 3) / 4) - padding);
}

type Encode = (crop: Crop, size: { w: number; h: number }, format: string, quality: number) => string;

/**
 * The best-looking encode that fits, or null when nothing does.
 *
 * Largest and best first, so what comes back is the best that fits rather than
 * the first that is small enough.
 */
export function searchFit(
  natural: { readonly w: number; readonly h: number },
  box: { readonly w: number; readonly h: number },
  budget: number,
  encode: Encode,
): Fitted | null {
  const crop = coverCrop(natural, box);
  for (const size of scaleSteps(box)) {
    for (const format of FORMATS) {
      for (const quality of QUALITY_STEPS) {
        const src = encode(crop, size, format, quality);
        if (src === "") continue;
        const bytes = bytesOf(src);
        if (bytes <= budget) return { src, mime: format, bytes, w: size.w, h: size.h };
      }
    }
  }
  return null;
}

/** What a design's pictures already weigh, so the next one knows its room. */
export function spentOn(assets: readonly { readonly bytes: number }[] | undefined): number {
  return (assets ?? []).reduce((sum, asset) => sum + asset.bytes, 0);
}

/** The room left for one more picture, given what is already there. */
export function roomFor(
  assets: readonly { readonly bytes: number }[] | undefined,
  replacing = 0,
): number {
  const left = MAX_ASSETS_BYTES - (spentOn(assets) - replacing);
  return Math.max(0, Math.min(MAX_ASSET_BYTES, left));
}
