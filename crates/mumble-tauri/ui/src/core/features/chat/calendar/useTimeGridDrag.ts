import { useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from "react";
import type { AnchorRect } from "./calendarStore";
import type { CalendarEvent, EventOccurrence } from "./types";
import {
  applyDrag,
  DRAG_THRESHOLD_PX,
  dragPreview,
  type DragMode,
  type DragOrigin,
  type DragPreview,
} from "./timeGrid";

/** The attribute a drawn event block carries, so a click on anything inside it
 *  anchors the detail card to the block rather than to the child. */
export const CAL_EVENT_ATTR = "data-cal-event";

interface Options {
  readonly dayCount: number;
  readonly pxPerMinute: number;
  /** The element holding the day columns, measured for a sideways move. */
  readonly columnsRef: RefObject<HTMLElement | null>;
  readonly events: readonly CalendarEvent[];
  /** A drag ended somewhere new. */
  readonly onChange: (event: CalendarEvent, next: { start: number; end: number }) => void;
  /** A press that never travelled - a click. */
  readonly onOpen: (eventId: string, occStart: number, rect: AnchorRect) => void;
}

/**
 * Dragging and resizing meetings on a time grid.
 *
 * The block keeps pointer capture for the whole gesture, so a pack wires the
 * three handlers onto the block (and its resize edges) and draws `preview`.
 */
export function useTimeGridDrag({ dayCount, pxPerMinute, columnsRef, events, onChange, onOpen }: Options) {
  const dragRef = useRef<(DragOrigin & { moved: boolean }) | null>(null);
  const previewRef = useRef<DragPreview | null>(null);
  const [preview, setPreviewState] = useState<DragPreview | null>(null);
  const setPreview = (next: DragPreview | null) => {
    previewRef.current = next;
    setPreviewState(next);
  };

  const beginDrag = (e: ReactPointerEvent, occ: EventOccurrence, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      key: occ.key,
      eventId: occ.event.id,
      mode,
      startX: e.clientX,
      startY: e.clientY,
      origStart: occ.start,
      origEnd: occ.end,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    d.moved = true;
    const columnWidth = columnsRef.current ? columnsRef.current.clientWidth / dayCount : 0;
    setPreview(dragPreview(d, dx, dy, { pxPerMinute, columnWidth }));
  };

  const onPointerUp = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    // A drag if we saw movement OR the pointer simply ended away from where it
    // started (a missed pointermove or a capture hiccup). Only a stationary
    // press opens the detail card - never the end of a drag.
    const endedFar =
      Math.abs(e.clientX - d.startX) > DRAG_THRESHOLD_PX || Math.abs(e.clientY - d.startY) > DRAG_THRESHOLD_PX;
    const current = previewRef.current;
    setPreview(null);
    if (d.moved || endedFar) {
      if (current && (current.start !== d.origStart || current.end !== d.origEnd)) {
        const event = events.find((x) => x.id === d.eventId);
        if (event) onChange(event, applyDrag(event, d, current));
      }
      return;
    }
    const block = (e.target as HTMLElement).closest(`[${CAL_EVENT_ATTR}]`) as HTMLElement | null;
    const r = (block ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    onOpen(d.eventId, d.origStart, { top: r.top, left: r.left, bottom: r.bottom, right: r.right });
  };

  const onPointerCancel = () => {
    dragRef.current = null;
    setPreview(null);
  };

  return { preview, beginDrag, onPointerMove, onPointerUp, onPointerCancel };
}
