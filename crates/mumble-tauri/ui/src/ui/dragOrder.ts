/**
 * The measuring and list arithmetic behind the client's drag-carried lists.
 *
 * Every one of them - Nebula's server rail and connect-screen identities,
 * Standard's users being carried between channels - runs its own pointer
 * gesture rather than the browser's HTML5 drag, which never starts reliably on
 * a control inside the webview. What they share is this: where the rows were
 * when the gesture began, which row the carried one would land in front of,
 * the order that follows, and how far each row has to move for the list to
 * show that answer before it is committed.
 */

/** Where one row sat when the drag began. */
export interface DragSlot {
  key: string;
  top: number;
  bottom: number;
}

/** The rows as they stand, top to bottom, before anything moves. */
export function measureSlots(rows: ReadonlyMap<string, HTMLElement>): DragSlot[] {
  return [...rows.entries()]
    .map(([key, element]) => {
      const box = element.getBoundingClientRect();
      return { key, top: box.top, bottom: box.bottom };
    })
    .sort((left, right) => left.top - right.top);
}

/**
 * The row the carried one would land in front of, or null for the end.
 *
 * Measured against where the rows were when the drag started rather than
 * where they are now, so the indicator cannot chase itself: drawing it must
 * never change the answer to where it should be drawn.
 */
export function dropTarget(drag: { key: string; y: number; slots: readonly DragSlot[] }): string | null {
  for (const slot of drag.slots) {
    if (slot.key === drag.key) continue;
    if (drag.y < (slot.top + slot.bottom) / 2) return slot.key;
  }
  return null;
}

/**
 * The order to persist after a row is dropped.
 *
 * A move is expressed as "this key now sits where that one was" rather than as
 * a pair of indices: the list the user dragged in is the rendered one, and an
 * index into it stops meaning anything the moment the list behind it changes.
 * A null target drops the row at the end.
 */
export function reorderKeys(keys: readonly string[], movedKey: string, beforeKey: string | null): string[] {
  // Dropping a row on itself is a no-op, not a move to the end.
  if (movedKey === beforeKey || !keys.includes(movedKey)) return [...keys];

  const rest = keys.filter((key) => key !== movedKey);
  const at = beforeKey === null ? -1 : rest.indexOf(beforeKey);
  rest.splice(at === -1 ? rest.length : at, 0, movedKey);
  return rest;
}

/**
 * How far each row must move for the carried one to land where it is aimed.
 *
 * A transform rather than a real reordering: the pointer is judged against
 * where the rows sat when the gesture began (see `dropTarget`), so the list
 * that shows the move cannot be the list being measured. The rows between the
 * carried one's slot and the one it is aimed at step over by a slot each, and
 * the carried one drops into the place they leave - the list reads as the
 * order it would be dropped into while every box stays exactly where it was.
 *
 * Rows that do not move are left out of the map; a key the list does not hold
 * leaves it empty, since there is then no move to preview.
 */
export function makeRoom(
  slots: readonly DragSlot[],
  movedKey: string,
  beforeKey: string | null,
): Map<string, number> {
  const offsets = new Map<string, number>();
  const from = slots.findIndex((slot) => slot.key === movedKey);
  const to = beforeKey === null ? slots.length : slots.findIndex((slot) => slot.key === beforeKey);
  if (from === -1 || to === -1) return offsets;

  // Dropping further down: everything in between comes up one slot.
  for (let i = from + 1; i < to; i += 1) offsets.set(slots[i].key, slots[i - 1].top - slots[i].top);
  // Dropping further up: everything in between goes down one slot.
  for (let i = to; i < from; i += 1) offsets.set(slots[i].key, slots[i + 1].top - slots[i].top);

  // And the carried row takes the slot that run vacated. Dropping it back
  // where it came from moves nothing, and asks for no offset at all.
  const landing = to > from ? slots[to - 1] : to < from ? slots[to] : null;
  if (landing && landing.top !== slots[from].top) offsets.set(movedKey, landing.top - slots[from].top);
  return offsets;
}

/**
 * How far each row must move for a row arriving from elsewhere to fit in.
 *
 * The same trick as `makeRoom`, for a list the carried row is not in yet: the
 * rows from `at` on step down by one slot and leave a hole the newcomer will
 * fill. Whoever draws it has to give the list that much more height too, or
 * the rows that stepped down hang out of the bottom of it.
 *
 * The step is the list's own rhythm - the distance from one row's top to the
 * next - which stays right for rows of any height as long as they all share
 * one. A list of one row has no rhythm to read and falls back to that row's
 * height; an empty one, to the caller's measure of what is being carried.
 */
export function makeRoomFor(
  slots: readonly DragSlot[],
  at: number,
  carriedHeight: number,
): { offsets: Map<string, number>; step: number } {
  const step =
    slots.length > 1
      ? slots[1].top - slots[0].top
      : slots.length === 1
        ? slots[0].bottom - slots[0].top
        : carriedHeight;
  const offsets = new Map<string, number>();
  for (let i = Math.max(0, at); i < slots.length; i += 1) offsets.set(slots[i].key, step);
  return { offsets, step };
}
