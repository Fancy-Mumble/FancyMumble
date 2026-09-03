/**
 * The app's monogram, as Nebula wears it.
 *
 * The letterform itself is pack-neutral geometry in [`@core/brandGlyph`]; what
 * is here is what Nebula does with it - the tile's colour, its corner, and how
 * much of it the letter takes. Shared by the tile in the title bar and by the
 * window icon the taskbar shows, so that the two cannot drift apart.
 */
import { BRAND_GLYPH_HEIGHT, BRAND_GLYPH_PATH, BRAND_GLYPH_WIDTH } from "@core/brandGlyph";
import type { WindowMark } from "@core/windowIcon";

/**
 * How much of the tile the glyph fills.
 *
 * Chosen against the 32px the taskbar actually draws rather than against the
 * artboard: below about .7 the script reads as a smudge at that size, and
 * above it the flourish starts to touch the tile's cut corner.
 */
export const MARK_FILL = 0.72;

/**
 * Emboldening, as a fraction of the tile.
 *
 * The face the monogram was taken from has one weight, so a bold has to be
 * drawn rather than asked for: the outline is stroked as well as filled. This
 * much thickens the hairlines enough to survive being scaled down to a
 * taskbar; much more and the counter inside the letter closes up and it turns
 * into a blot.
 */
export const MARK_STROKE = 0.02;

/** The title bar's tile, in CSS pixels. */
export const MARK_TILE_PX = 22;

/**
 * The mark a theme wears: the monogram in the skin's colour and corner.
 *
 * Takes the four values it varies by rather than the theme, so that a caller
 * can key an effect on exactly those - the theme object is rebuilt whenever a
 * server's livery arrives, and redrawing the icon is an IPC round trip with
 * the pixels in it.
 */
export function brandMark(
  accent: string,
  onAccent: string,
  radiusMd: string,
  chamfered: boolean,
): WindowMark {
  const parsed = Number.parseFloat(radiusMd);
  return {
    accent,
    onAccent,
    glyph: {
      path: BRAND_GLYPH_PATH,
      width: BRAND_GLYPH_WIDTH,
      height: BRAND_GLYPH_HEIGHT,
    },
    fill: MARK_FILL,
    strokeRatio: MARK_STROKE,
    // The skin quotes its radii at the size of the title bar's tile, which is
    // the size `WindowMark` wants them in.
    radiusPx: Number.isFinite(parsed) ? parsed : 0,
    chamfered,
  };
}
