/**
 * The window icon, drawn to match the theme.
 *
 * The icon Windows shows in the taskbar, in Alt-Tab and in the title bar is a
 * PNG shipped with the build: a rounded cyan tile with a letter on it. It is
 * the one piece of the app's own chrome that never moved with the user's
 * theme, so a squared, acid-yellow skin still sat behind a rounded cyan tile -
 * and on a taskbar the icon is most of what the app looks like.
 *
 * So it is drawn rather than shipped: a tile in the skin's accent and corner,
 * with the monogram on it. The title bar puts the same mark in the chrome from
 * the same outline, so the two cannot drift apart.
 *
 * Pack-neutral on purpose: Nebula is the pack with a title-bar mark today, but
 * nothing here knows that. A pack supplies what a mark is made of - a colour,
 * a corner and an outline - and gets an icon.
 */
import { invoke } from "@tauri-apps/api/core";

/**
 * How big an icon to draw.
 *
 * Windows asks for 16 and 32 in the taskbar and up to 256 in a large-icon
 * view, and scales whatever it is given. 128 is the compromise: crisp
 * everywhere the icon is actually looked at, and an eighth of the bytes of a
 * 256 - which matters because the pixels cross the IPC boundary as JSON, so
 * the buffer is paid for in serialisation rather than in memory.
 */
const ICON_SIZE = 128;

/** How much of the tile a chamfered skin cuts off each cut corner. */
const CHAMFER_RATIO = 0.18;

/** An outline to stamp on the tile, in its own y-down coordinate space. */
export interface MarkGlyph {
  /** SVG path data. */
  readonly path: string;
  /** The box the path is drawn in; nothing falls outside it. */
  readonly width: number;
  readonly height: number;
}

/** What a mark is made of. */
export interface WindowMark {
  /** The tile colour. */
  readonly accent: string;
  /** The glyph colour, which is whatever reads on the accent. */
  readonly onAccent: string;
  /** The outline to stamp on it. */
  readonly glyph: MarkGlyph;
  /**
   * How much of the tile the glyph fills, as a fraction of its width.
   *
   * The outline is scaled to this rather than drawn at a fixed size, so a
   * different letter or a different face needs no number re-tuned: whatever
   * its proportions, it fills the same share of the tile.
   */
  readonly fill?: number;
  /**
   * Emboldening, as a fraction of the tile: the outline is stroked as well as
   * filled.
   *
   * For a face that ships one weight, which is most display and script faces.
   * Also what keeps a fine-stroked letter legible at the 32px the taskbar
   * actually draws, where its hairlines otherwise disappear.
   */
  readonly strokeRatio?: number;
  /** The tile's corner radius in CSS pixels, at the title bar's 22px size. */
  readonly radiusPx: number;
  /**
   * Whether this skin cuts its corners instead of rounding them.
   *
   * The skins that do set every radius to zero, so a rounded tile would not
   * have been wrong so much as absent - this is what gives those skins the
   * same diagonal the window and the message bubbles wear.
   */
  readonly chamfered: boolean;
}

/** Trace the tile's outline: chamfered, rounded, or a plain square. */
function tile(ctx: CanvasRenderingContext2D, size: number, mark: WindowMark): void {
  ctx.beginPath();
  if (mark.chamfered) {
    // The same two corners the bubble and the selection cut: top-right and
    // bottom-left, so the icon reads as part of the set rather than as a
    // second idea about the same skin.
    const cut = size * CHAMFER_RATIO;
    ctx.moveTo(0, 0);
    ctx.lineTo(size - cut, 0);
    ctx.lineTo(size, cut);
    ctx.lineTo(size, size);
    ctx.lineTo(cut, size);
    ctx.lineTo(0, size - cut);
    ctx.closePath();
    return;
  }
  // Scaled from the title bar's 22px tile so the corner keeps its proportion
  // rather than becoming a hairline at icon size.
  const radius = Math.min((mark.radiusPx / 22) * size, size / 2);
  if (radius <= 0) {
    ctx.rect(0, 0, size, size);
    return;
  }
  // `roundRect` is in every engine the desktop build runs on, but it is recent
  // enough to be worth not assuming - a square tile is a poor icon, a thrown
  // TypeError is no icon at all.
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(0, 0, size, size, radius);
  } else {
    ctx.rect(0, 0, size, size);
  }
}

/**
 * Stamp the outline in the middle of the tile, scaled to fill it.
 *
 * Geometry rather than text, which is the whole reason the outline is checked
 * in: `fillText` needs a loaded face, draws in a substitute when there is not
 * one, and reports success either way. A path is in the bundle, so the mark
 * cannot arrive late and cannot come out as a different letter.
 */
function stamp(ctx: CanvasRenderingContext2D, size: number, mark: WindowMark): void {
  if (typeof Path2D !== "function") return;
  const { glyph } = mark;
  const target = size * (mark.fill ?? 0.72);
  // The larger dimension is what has to fit, so a wide glyph is not clipped
  // and a tall one does not overrun the chamfer.
  const scale = Math.min(target / glyph.width, target / glyph.height);

  ctx.save();
  ctx.translate((size - glyph.width * scale) / 2, (size - glyph.height * scale) / 2);
  ctx.scale(scale, scale);

  const outline = new Path2D(glyph.path);
  const stroke = mark.strokeRatio ?? 0;
  if (stroke > 0) {
    // `lineWidth` is in the transformed space, so it is divided back out to
    // land on the tile at the fraction that was asked for.
    ctx.lineWidth = (size * stroke) / scale;
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.stroke(outline);
  }
  ctx.fill(outline);
  ctx.restore();
}

/**
 * Draw the mark onto a canvas of its own.
 *
 * `null` when there is nothing to draw on - a test environment, or a webview
 * that refused the context.
 */
function renderMark(mark: WindowMark, size: number): HTMLCanvasElement | null {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = mark.accent;
  tile(ctx, size, mark);
  ctx.fill();

  ctx.fillStyle = mark.onAccent;
  stamp(ctx, size, mark);
  return canvas;
}

/**
 * Draw the mark and return it as RGBA8.
 *
 * `null` when there is no canvas to draw on. The icon is decoration, so every
 * caller treats that as "leave the shipped one alone" rather than as an error.
 */
export function drawWindowIcon(mark: WindowMark, size = ICON_SIZE): Uint8ClampedArray | null {
  const canvas = renderMark(mark, size);
  return canvas?.getContext("2d")?.getImageData(0, 0, size, size).data ?? null;
}

/**
 * Draw the mark and make it this window's icon.
 *
 * Never rejects. The icon is the last thing that should be allowed to take a
 * window down, and there is nothing a caller could usefully do about a
 * platform that draws its icon from an app bundle (macOS) or has no window
 * icon at all (mobile) - both of which reach here and answer `Ok`.
 */
export async function applyWindowIcon(mark: WindowMark, size = ICON_SIZE): Promise<void> {
  const rgba = drawWindowIcon(mark, size);
  if (!rgba) return;
  try {
    await invoke("set_window_icon", {
      rgba: Array.from(rgba),
      width: size,
      height: size,
    });
  } catch (error) {
    // Debug rather than error: this runs in the browser preview and in tests,
    // where there is no command to call and nothing has gone wrong.
    console.debug("window icon not applied", error);
  }
}
