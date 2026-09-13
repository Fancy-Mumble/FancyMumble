/**
 * The time grid's geometry and gestures, as arithmetic.
 *
 * Every pack draws a day/week grid that meetings can be dragged around on.
 * What a drag *means* - how far it moved, what it snaps to, which lane an
 * overlapping meeting takes - is the same answer whichever pack asks, so it
 * lives here and each grid only draws the result.
 */

import type { EventOccurrence } from "./types";
import { addDays, MS_PER_DAY, MS_PER_MINUTE, startOfDay } from "./calendarDates";

/** Drags land on quarter hours. */
export const SNAP_MINUTES = 15;
/** Pointer travel below this is a click, not a drag. */
export const DRAG_THRESHOLD_PX = 4;

export type DragMode = "move" | "resize-start" | "resize-end";

/** Where a drag started, in pointer and in time. */
export interface DragOrigin {
  readonly key: string;
  readonly eventId: string;
  readonly mode: DragMode;
  readonly startX: number;
  readonly startY: number;
  readonly origStart: number;
  readonly origEnd: number;
}

/** What the grid draws while a drag is under way. */
export interface DragPreview {
  readonly key: string;
  readonly eventId: string;
  readonly mode: DragMode;
  readonly start: number;
  readonly end: number;
  /** Visual translate (px) for a move, so the block stays mounted in its own
   *  column - keeping pointer capture - while it follows the cursor. */
  readonly dx: number;
  readonly dy: number;
}

export interface GridGeometry {
  readonly pxPerMinute: number;
  /** Width of one day column; 0 when unmeasured, which pins a move to its day. */
  readonly columnWidth: number;
}

export function snapMinutes(minutes: number, step = SNAP_MINUTES): number {
  return Math.round(minutes / step) * step;
}

/**
 * Side-by-side lanes for overlapping events: each occurrence takes the first
 * lane whose previous event has ended, and reports its overlap cluster's lane
 * count so widths divide evenly.
 */
export function layoutDay(occs: readonly EventOccurrence[]): Map<string, { lane: number; lanes: number }> {
  const result = new Map<string, { lane: number; lanes: number }>();
  const sorted = [...occs].sort((a, b) => a.start - b.start || a.end - b.end);
  let cluster: EventOccurrence[] = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;
  const flush = () => {
    const laneEnds: number[] = [];
    const assigned: Array<{ key: string; lane: number }> = [];
    for (const o of cluster) {
      let lane = laneEnds.findIndex((end) => end <= o.start);
      if (lane === -1) {
        lane = laneEnds.length;
        laneEnds.push(o.end);
      } else {
        laneEnds[lane] = o.end;
      }
      assigned.push({ key: o.key, lane });
    }
    const lanes = Math.max(1, laneEnds.length);
    for (const a of assigned) result.set(a.key, { lane: a.lane, lanes });
    cluster = [];
    clusterEnd = Number.NEGATIVE_INFINITY;
  };
  for (const o of sorted) {
    if (cluster.length && o.start >= clusterEnd) flush();
    cluster.push(o);
    clusterEnd = Math.max(clusterEnd, o.end);
  }
  if (cluster.length) flush();
  return result;
}

/** The preview for a pointer that has travelled `dx`, `dy` since `origin`. */
export function dragPreview(origin: DragOrigin, dx: number, dy: number, geometry: GridGeometry): DragPreview {
  const deltaMin = snapMinutes(Math.round(dy / geometry.pxPerMinute));
  const shift = deltaMin * MS_PER_MINUTE;
  const minimum = SNAP_MINUTES * MS_PER_MINUTE;
  const base = { key: origin.key, eventId: origin.eventId, mode: origin.mode };
  if (origin.mode === "move") {
    const deltaDays = geometry.columnWidth ? Math.round(dx / geometry.columnWidth) : 0;
    return {
      ...base,
      start: addDays(origin.origStart, deltaDays) + shift,
      end: addDays(origin.origEnd, deltaDays) + shift,
      dx: deltaDays * geometry.columnWidth,
      dy: deltaMin * geometry.pxPerMinute,
    };
  }
  if (origin.mode === "resize-start") {
    return {
      ...base,
      start: Math.min(origin.origStart + shift, origin.origEnd - minimum),
      end: origin.origEnd,
      dx: 0,
      dy: 0,
    };
  }
  return {
    ...base,
    start: origin.origStart,
    end: Math.max(origin.origEnd + shift, origin.origStart + minimum),
    dx: 0,
    dy: 0,
  };
}

/**
 * The series times a dragged occurrence implies.
 *
 * A drag moves one drawn occurrence, but what is stored is the series, so the
 * same offsets are applied to the event's own start and end.
 */
export function applyDrag(
  event: { readonly start: number; readonly end: number },
  origin: Pick<DragOrigin, "origStart" | "origEnd">,
  preview: Pick<DragPreview, "start" | "end">,
): { start: number; end: number } {
  return {
    start: event.start + (preview.start - origin.origStart),
    end: event.end + (preview.end - origin.origEnd),
  };
}

/** Moving an occurrence onto another day, as the month grid does; null when
 *  it was dropped on the day it already had. */
export function shiftToDay(
  event: { readonly start: number; readonly end: number },
  occStart: number,
  targetDay: number,
): { start: number; end: number } | null {
  const deltaDays = Math.round((targetDay - startOfDay(occStart)) / MS_PER_DAY);
  if (deltaDays === 0) return null;
  return { start: addDays(event.start, deltaDays), end: addDays(event.end, deltaDays) };
}
