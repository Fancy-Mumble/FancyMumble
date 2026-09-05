/**
 * The measuring and list arithmetic behind Nebula's drag-to-reorder lists.
 *
 * Both lists that can be rearranged - the server rail and the connect screen's
 * identities - run their own pointer gesture rather than the browser's HTML5
 * drag, which never starts reliably on a control inside the webview. What they
 * share is this: where the rows were when the gesture began, which row the
 * carried one would land in front of, and the new order that follows.
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
