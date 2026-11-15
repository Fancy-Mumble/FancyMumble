import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { dropTarget, reorderKeys, type DragSlot } from "@ui/dragOrder";
import { siblingBlocks } from "../../channelArrange";
import type { OrderedChannel } from "../../selectors";

/** How far the pointer travels before a press becomes a drag. */
const DRAG_SLACK = 4;
/** How close to the list's edge the pointer has to be before it scrolls. */
const SCROLL_EDGE = 32;
/** The fastest the list scrolls under a held drag, in pixels a frame. */
const SCROLL_STEP = 10;

export interface ArrangeDrag {
  channelId: number;
  /** The carried row's box when it was picked up; the ghost moves from here. */
  ghost: { left: number; top: number; width: number; height: number };
  /** Where the insertion mark goes, or null while the drop would change nothing. */
  line: { top: number; left: number; width: number } | null;
}

interface Options {
  entries: readonly OrderedChannel[];
  enabled: boolean;
  /** Put `channelId` in front of `beforeId` among its siblings, or last for null. */
  onMove: (channelId: number, beforeId: number | null) => void;
  /** Escape outside a drag leaves the mode. */
  onDone: () => void;
}

/**
 * The drag that arranges channels, run from the list rather than from a row.
 *
 * A pointer gesture rather than HTML5 drag for the same reason as the server
 * rail and the user carry: the webview never starts one reliably. Unlike those
 * two, the preview is an insertion mark rather than rows stepping aside - a
 * channel moves with its whole subtree, the subtrees differ in height, and a
 * mark drawn over the list is the one picture that stays right for all of them.
 * Because nothing in the list moves, the rows are re-measured every frame, and
 * so the list can scroll under a held drag without the answer going stale.
 */
export function useChannelArrange({ entries, enabled, onMove, onDone }: Options) {
  const rows = useRef(new Map<number, HTMLElement>());
  const listRef = useRef<HTMLElement | null>(null);
  const ghostRef = useRef<HTMLElement | null>(null);
  const latest = useRef({ entries, onMove, onDone });
  useLayoutEffect(() => {
    latest.current = { entries, onMove, onDone };
  });

  const gesture = useRef<{
    channelId: number;
    startY: number;
    /** Where the pointer sat below the row's top edge, and that edge at pick-up. */
    grabOffset: number;
    pickupTop: number;
    y: number;
    moved: boolean;
    frame: number | null;
    /** The sibling to drop in front of; undefined while the drop is a no-op. */
    before: number | null | undefined;
  } | null>(null);
  const [drag, setDrag] = useState<ArrangeDrag | null>(null);

  const registerRow = useCallback((channelId: number, element: HTMLElement | null) => {
    if (element) rows.current.set(channelId, element);
    else rows.current.delete(channelId);
  }, []);

  const beginGesture = useCallback(
    (channelId: number) => (event: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
      if (!enabled || event.button !== 0) return;
      // The mousedown that follows a pointerdown must not restart a drag in flight.
      if (gesture.current?.moved) return;
      // Nothing else may start from this press: not a text selection, and not
      // the webview's own drag of a channel icon, which would cancel ours.
      event.preventDefault();
      const box = rows.current.get(channelId)?.getBoundingClientRect();
      gesture.current = {
        channelId,
        startY: event.clientY,
        grabOffset: box ? event.clientY - box.top : 0,
        pickupTop: box?.top ?? event.clientY,
        y: event.clientY,
        moved: false,
        frame: null,
        before: undefined,
      };
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) return;

    /**
     * Where the held channel would land from the pointer's last position, and
     * the mark that says so. Run every frame, and once more on release - a
     * drag let go before its first frame would otherwise drop nowhere.
     */
    const measure = (held: NonNullable<typeof gesture.current>) => {
      const ordered = latest.current.entries;
      const slots: DragSlot[] = [];
      for (const block of siblingBlocks(ordered, held.channelId)) {
        const first = rows.current.get(ordered[block.first].channel.id)?.getBoundingClientRect();
        const last = rows.current.get(ordered[block.last].channel.id)?.getBoundingClientRect();
        if (first && last) slots.push({ key: String(block.channelId), top: first.top, bottom: last.bottom });
      }
      const key = String(held.channelId);
      const target = dropTarget({ key, y: held.y, slots });
      const keys = slots.map((slot) => slot.key);
      const noop = reorderKeys(keys, key, target).every((candidate, index) => candidate === keys[index]);
      held.before = noop ? undefined : target === null ? null : Number(target);

      const mark = noop ? null : target === null ? slots[slots.length - 1] : slots.find((s) => s.key === target);
      const source = rows.current.get(held.channelId)?.getBoundingClientRect();
      return mark && source
        ? {
            // In the two-pixel gap between rows rather than across either.
            top: Math.round(target === null ? mark.bottom + 1 : mark.top - 1),
            left: Math.round(source.left),
            width: Math.round(source.width),
          }
        : null;
    };

    const frame = () => {
      const held = gesture.current;
      if (!held?.moved) return;
      held.frame = requestAnimationFrame(frame);

      const list = listRef.current;
      if (list) {
        const box = list.getBoundingClientRect();
        if (held.y < box.top + SCROLL_EDGE) list.scrollTop -= SCROLL_STEP;
        else if (held.y > box.bottom - SCROLL_EDGE) list.scrollTop += SCROLL_STEP;
      }
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translateY(${held.y - held.grabOffset - held.pickupTop}px)`;
      }

      const line = measure(held);
      setDrag((current) =>
        current &&
        current.line?.top === line?.top &&
        current.line?.left === line?.left &&
        current.line?.width === line?.width
          ? current
          : current && { ...current, line },
      );
    };

    const move = (event: PointerEvent) => {
      const held = gesture.current;
      if (!held) return;
      held.y = event.clientY;
      if (held.moved || Math.abs(event.clientY - held.startY) < DRAG_SLACK) return;
      const source = rows.current.get(held.channelId)?.getBoundingClientRect();
      if (!source) return;
      held.moved = true;
      setDrag({
        channelId: held.channelId,
        ghost: { left: source.left, top: held.pickupTop, width: source.width, height: source.height },
        line: null,
      });
      held.frame = requestAnimationFrame(frame);
    };

    const stop = (commit: boolean, y?: number) => {
      const held = gesture.current;
      gesture.current = null;
      if (!held?.moved) return;
      if (held.frame !== null) cancelAnimationFrame(held.frame);
      setDrag(null);
      if (!commit) return;
      if (y !== undefined) held.y = y;
      measure(held);
      if (held.before !== undefined) latest.current.onMove(held.channelId, held.before);
    };
    const end = (event: MouseEvent) => stop(true, event.clientY);
    const cancel = () => stop(false);

    const key = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // An open menu, dialog or field takes its own Escape.
      if ((event.target as Element | null)?.closest?.('[role="menu"], [role="dialog"], input, textarea')) return;
      // The first Escape drops what is being carried; the next leaves the mode.
      if (gesture.current?.moved) cancel();
      else latest.current.onDone();
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    // WebKitWebDriver's pointer actions press and release as mouse events only,
    // with no pointerdown or pointerup. A real pointer sends both kinds, and the
    // second of each pair finds the gesture already begun or already over.
    window.addEventListener("mouseup", end);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("mouseup", end);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key);
      cancel();
    };
  }, [enabled]);

  return { drag, registerRow, beginGesture, listRef, ghostRef };
}
