/**
 * Where a card goes when it is opened from a row.
 *
 * A card that drops from the pointer covers the very row it describes and then
 * grows downwards off the bottom of a list, which is worst exactly where rosters
 * are longest. So a card is placed *beside* its subject: centred on the row,
 * on whichever side has room, flipping rather than overflowing and clamping
 * rather than leaving the viewport.
 */

/** The thing the card is about, in viewport coordinates. */
export interface AnchorRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface CardPlacement {
  left: number;
  top: number;
  /** Which side of the anchor the card ended up on. */
  side: "left" | "right";
}

export interface PlacementOptions {
  /** Space between the anchor and the card. */
  gap?: number;
  /** Space the card keeps from the viewport edges. */
  margin?: number;
  /** The side to take when both fit. Defaults to the roomier one. */
  prefer?: "left" | "right";
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(Math.max(value, low), Math.max(low, high));
}

export function placeBesideAnchor(
  anchor: AnchorRect,
  size: { width: number; height: number },
  viewport: Viewport,
  options: PlacementOptions = {},
): CardPlacement {
  const gap = options.gap ?? 12;
  const margin = options.margin ?? 8;

  const roomLeft = anchor.left - margin;
  const roomRight = viewport.width - anchor.right - margin;
  const needed = size.width + gap;

  // A stated preference holds as long as that side can actually take the card;
  // otherwise the roomier side wins, and if neither fits the card is clamped
  // against the edge it overhangs least.
  let side: "left" | "right";
  if (options.prefer === "left") side = roomLeft >= needed || roomLeft >= roomRight ? "left" : "right";
  else if (options.prefer === "right")
    side = roomRight >= needed || roomRight >= roomLeft ? "right" : "left";
  else side = roomRight >= needed || roomRight >= roomLeft ? "right" : "left";

  const rawLeft = side === "right" ? anchor.right + gap : anchor.left - gap - size.width;
  const left = clamp(rawLeft, margin, viewport.width - size.width - margin);

  // Centred on the row rather than hung from its top: a tall card next to a
  // 32px row reads as belonging to it, and a short one does not drift upward.
  const centre = anchor.top + (anchor.bottom - anchor.top) / 2;
  const top = clamp(centre - size.height / 2, margin, viewport.height - size.height - margin);

  return { left, top, side };
}

/** The anchor for a pointer that has no row behind it. */
export function pointAnchor(x: number, y: number): AnchorRect {
  return { left: x, top: y, right: x, bottom: y };
}
