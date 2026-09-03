/**
 * The app's monogram, on its own.
 *
 * Just the letter: no tile, no background, no colour and no size of its own.
 * It paints in `currentColor` and scales to whatever box it is given, so a
 * caller decides all four by ordinary CSS - which is what makes it droppable
 * into a title bar, a menu, an about screen or a watermark without any of them
 * needing a variant.
 *
 * The outline lives in [`@core/brandGlyph`], generated from the font by
 * `tools/extract-glyph.py`; nothing here knows which font it came from.
 */
import type { SVGProps } from "react";
import { BRAND_GLYPH_HEIGHT, BRAND_GLYPH_PATH, BRAND_GLYPH_WIDTH } from "@core/brandGlyph";

export interface BrandGlyphProps extends SVGProps<SVGSVGElement> {
  /**
   * Emboldening, as a fraction of the glyph's longest side.
   *
   * The face the monogram comes from has one weight, so a heavier mark has to
   * be drawn rather than asked for: the outline is stroked as well as filled.
   * Mostly this is for small sizes, where the script's hairlines otherwise
   * thin out to nothing.
   *
   * Measured against the longest side because that is the one that meets the
   * box - the glyph scales to fit, so the long side sets how many pixels a
   * glyph unit is worth. Measuring against the height instead would make the
   * same number mean a different weight for a wide letter than a tall one.
   */
  readonly embolden?: number;
}

/** The monogram. Sized and coloured by the caller. */
export function BrandGlyph({ embolden = 0, ...rest }: BrandGlyphProps) {
  const stroke =
    Math.max(0, embolden) * Math.max(BRAND_GLYPH_WIDTH, BRAND_GLYPH_HEIGHT);
  // A stroke straddles the outline, so half of it falls outside the ink box.
  // The box grows by that much rather than the glyph shrinking inside it,
  // which would make an emboldened mark quietly smaller than a plain one.
  const pad = stroke / 2;
  return (
    <svg
      viewBox={`${-pad} ${-pad} ${BRAND_GLYPH_WIDTH + stroke} ${BRAND_GLYPH_HEIGHT + stroke}`}
      focusable="false"
      aria-hidden
      {...rest}
    >
      <path
        d={BRAND_GLYPH_PATH}
        fill="currentColor"
        {...(stroke > 0
          ? {
              stroke: "currentColor",
              strokeWidth: stroke,
              // The script's junctions are acute, and a mitre there grows a
              // spike that reads as a rendering fault once the mark is small.
              strokeLinejoin: "round",
            }
          : {})}
      />
    </svg>
  );
}

export default BrandGlyph;
