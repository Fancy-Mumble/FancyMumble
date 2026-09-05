import { snap, type Block } from "./design";

/**
 * Alignment snapping, the way a design tool does it.
 *
 * A 4px grid gets a block *near* where it should be. What an operator actually
 * wants is for it to line up with the thing above it, or to sit on the sheet's
 * centre line - and the difference between "nearly aligned" and "aligned" is
 * the difference between a design that looks made and one that looks nearly
 * made. A grid cannot do that: two blocks of different widths both snapped to
 * the grid are still not centred on each other.
 *
 * So the candidates are the lines that already exist in the drawing:
 *
 * * the sheet's own edges and **both** its centre lines, horizontal and
 *   vertical - the two an operator reaches for before there is anything else
 *   on the page to align to;
 * * every other block's left, centre and right;
 * * every other block's top, middle and bottom.
 *
 * And the probes are the same three lines on the block being dragged. Any pair
 * within `TOLERANCE` snaps, the nearest wins, and the line that caused it is
 * returned so the editor can draw it. Nothing snaps silently: a block that
 * moved somewhere the operator did not drag it, with nothing on screen to say
 * why, is worse than no snapping at all.
 *
 * Where nothing is in range, the grid takes over - so a block in open space
 * still lands on a round number.
 */

/** How close, in sheet units, a line has to be to catch. */
export const TOLERANCE = 6;

/** A line the editor draws while it is holding a block. */
export interface Guide {
  /** `x` is a vertical line at that coordinate; `y` is a horizontal one. */
  readonly axis: "x" | "y";
  readonly at: number;
  /** The extent to draw it over, so it visibly joins what it aligned. */
  readonly from: number;
  readonly to: number;
  /**
   * Whether this is one of the sheet's own lines rather than another block's.
   *
   * Drawn differently: a page guide runs the whole way across and reads as
   * part of the sheet, where a line between two blocks is about those two.
   */
  readonly sheet: boolean;
}

export interface Snapped {
  readonly x: number;
  readonly y: number;
  readonly guides: readonly Guide[];
}

/**
 * What the editor measured each block to be, by id.
 *
 * Most blocks have no height of their own - it is their content's - and this
 * module cannot measure text. It used to treat those as zero tall, which was
 * not a harmless simplification: a guide between two of them ran from the top
 * of one to the top of the other and stopped there, passing *through* both
 * blocks and ending in empty space, and their middles and bottoms were not
 * offered as lines to snap to at all.
 *
 * So the measuring is done where it can be - the editor renders these and reads
 * the heights back off the DOM - and passed in. An unmeasured block still falls
 * back to its own height and then to zero, which is what a block that has not
 * been drawn yet has to be.
 */
export type Heights = ReadonlyMap<string, number>;

const heightOf = (block: Block, heights?: Heights): number =>
  heights?.get(block.id) ?? block.h ?? 0;

/** The three vertical lines a block presents. */
const verticals = (block: Block): number[] => [block.x, block.x + block.w / 2, block.x + block.w];

/** The three horizontal ones. */
const horizontals = (block: Block, heights?: Heights): number[] => {
  const h = heightOf(block, heights);
  return h === 0 ? [block.y] : [block.y, block.y + h / 2, block.y + h];
};

/** The nearest candidate to any probe, and how far the block has to move. */
function nearest(
  probes: readonly number[],
  candidates: readonly number[],
): { shift: number; at: number } | null {
  let best: { shift: number; at: number } | null = null;
  for (const probe of probes) {
    for (const candidate of candidates) {
      const shift = candidate - probe;
      if (Math.abs(shift) > TOLERANCE) continue;
      if (!best || Math.abs(shift) < Math.abs(best.shift)) best = { shift, at: candidate };
    }
  }
  return best;
}

/**
 * Where a dragged block should actually land.
 *
 * `x` and `y` are where the pointer says it is; what comes back is where it
 * belongs, with the lines that decided it.
 */
export function snapTo(
  moving: Block,
  x: number,
  y: number,
  others: readonly Block[],
  sheetW: number,
  grid: boolean,
  sheetH = 0,
  heights?: Heights,
): Snapped {
  const at: Block = { ...moving, x, y };
  const guides: Guide[] = [];

  // The sheet's own lines are candidates on both axes. Its height is passed in
  // rather than stored, because a sheet is as tall as what is on it - so the
  // horizontal centre line moves as the design grows, which is what somebody
  // centring against it means.
  const sheetX = [0, sheetW / 2, sheetW];
  const sheetY = sheetH > 0 ? [0, sheetH / 2, sheetH] : [];
  const xCandidates = [...sheetX, ...others.flatMap(verticals)];
  const yCandidates = [...sheetY, ...others.flatMap((block) => horizontals(block, heights))];

  const alongX = nearest(verticals(at), xCandidates);
  const alongY = nearest(horizontals(at, heights), yCandidates);

  const landedX = alongX ? Math.round(x + alongX.shift) : snap(x, grid);
  const landedY = alongY ? Math.round(y + alongY.shift) : snap(y, grid);

  if (alongX) {
    // A line of the sheet's own runs the whole way down it: it is a property of
    // the page, not of two blocks that happen to agree. A line found on another
    // block is drawn over just what it touches, so it reads as "these two are
    // aligned" rather than as a stray rule.
    const onSheet = sheetX.includes(alongX.at);
    const touching = others.filter((block) => verticals(block).includes(alongX.at));
    guides.push({
      axis: "x",
      at: alongX.at,
      sheet: onSheet,
      from: onSheet ? 0 : Math.min(landedY, ...touching.map((block) => block.y)),
      to: onSheet
        ? Math.max(sheetH, landedY + heightOf(at, heights))
        : Math.max(
            landedY + heightOf(at, heights),
            ...touching.map((block) => block.y + heightOf(block, heights)),
          ),
    });
  }
  if (alongY) {
    const onSheet = sheetY.includes(alongY.at);
    const touching = others.filter((block) => horizontals(block, heights).includes(alongY.at));
    guides.push({
      axis: "y",
      at: alongY.at,
      sheet: onSheet,
      from: onSheet ? 0 : Math.min(landedX, ...touching.map((block) => block.x)),
      to: onSheet ? sheetW : Math.max(landedX + at.w, ...touching.map((block) => block.x + block.w)),
    });
  }

  return { x: Math.max(0, landedX), y: Math.max(0, landedY), guides };
}

/**
 * The same, for a width being dragged.
 *
 * Only the right edge moves, so only the right edge is a probe - and the left
 * edge is fixed, which is why the result is a width rather than a position.
 */
export function snapWidth(
  moving: Block,
  width: number,
  others: readonly Block[],
  sheetW: number,
  grid: boolean,
  heights?: Heights,
): { w: number; guides: readonly Guide[] } {
  const right = moving.x + width;
  const candidates = [sheetW / 2, sheetW, ...others.flatMap(verticals)];
  const found = nearest([right], candidates);
  if (!found) return { w: Math.max(48, snap(width, grid)), guides: [] };

  const at = found.at;
  const onSheet = at === sheetW / 2 || at === sheetW;
  const touching = others.filter((block) => verticals(block).includes(at));
  return {
    w: Math.max(48, Math.round(width + found.shift)),
    guides: [
      {
        axis: "x",
        at,
        sheet: onSheet,
        from: onSheet ? 0 : Math.min(moving.y, ...touching.map((block) => block.y)),
        to: Math.max(
          moving.y + heightOf(moving, heights),
          ...touching.map((block) => block.y + heightOf(block, heights)),
        ),
      },
    ],
  };
}

