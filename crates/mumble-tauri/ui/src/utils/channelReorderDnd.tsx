/**
 * Drag-and-drop helpers for reordering channels within the same parent.
 *
 * Uses pointer events + a portal-mounted floating clone, matching the
 * pattern established in userMoveDnd.tsx.  HTML5 drag-and-drop is
 * avoided because it is unreliable inside Tauri's webview.
 *
 * Channels can only be reordered among their siblings (same parent_id).
 * The floating clone follows the cursor on the Y axis while X is locked
 * to the source card's left edge (sidebar layout is vertical).
 *
 * Drop targets register via `useChannelReorderTarget`.  On pointerup the
 * cursor is hit-tested against every registered sibling; the top or
 * bottom half of the target rect determines whether to insert before or
 * after.  The caller receives a `ChannelDropEvent` and is responsible
 * for computing updated positions and invoking `update_channel`.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { GripVerticalIcon } from "../icons";

const DRAG_THRESHOLD_PX = 8;

// -- Global drag state -------------------------------------------

interface ActiveDrag {
  channelId: number;
  parentId: number | null;
}

let activeDrag: ActiveDrag | null = null;

// -- Drop-target registry ----------------------------------------

interface DropTargetReg {
  el: HTMLElement;
  channelId: number;
  parentId: number | null;
  setDropPos: (pos: "before" | "after" | null) => void;
}

const dropTargets = new Set<DropTargetReg>();

function registerDropTarget(reg: DropTargetReg): () => void {
  dropTargets.add(reg);
  return () => dropTargets.delete(reg);
}

function clearAllDropPos(): void {
  for (const t of dropTargets) t.setDropPos(null);
}

function findDropTarget(
  clientX: number,
  clientY: number,
): { target: DropTargetReg; pos: "before" | "after" } | null {
  if (!activeDrag) return null;
  const { channelId: dragId, parentId: dragParent } = activeDrag;
  for (const t of dropTargets) {
    if (t.channelId === dragId) continue;
    if (t.parentId !== dragParent) continue;
    const rect = t.el.getBoundingClientRect();
    if (
      clientX >= rect.left &&
      clientX <= rect.right &&
      clientY >= rect.top &&
      clientY <= rect.bottom
    ) {
      const pos = clientY < rect.top + rect.height / 2 ? "before" : "after";
      return { target: t, pos };
    }
  }
  return null;
}

// -- useChannelReorderTarget hook --------------------------------

/**
 * Register a channel card as a drop zone for sibling reorder drags.
 * Returns `ref` (attach to the outermost wrapper element) and `dropPos`
 * (`"before"` / `"after"` / `null`) to render the insertion indicator.
 */
export function useChannelReorderTarget(
  channelId: number,
  parentId: number | null,
) {
  const [dropPos, setDropPos] = useState<"before" | "after" | null>(null);
  const unregRef = useRef<(() => void) | null>(null);

  const ref = useCallback(
    (el: HTMLElement | null) => {
      unregRef.current?.();
      unregRef.current = null;
      if (el) {
        unregRef.current = registerDropTarget({
          el,
          channelId,
          parentId,
          setDropPos,
        });
      }
    },
    [channelId, parentId],
  );

  useEffect(
    () => () => {
      unregRef.current?.();
      unregRef.current = null;
    },
    [],
  );

  return { ref, dropPos };
}

// -- useChannelDrag hook -----------------------------------------

/** Payload emitted when a channel is dropped onto a sibling. */
export interface ChannelDropEvent {
  draggedId: number;
  targetId: number;
  insertBefore: boolean;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  width: number;
  height: number;
  initialLeft: number;
  started: boolean;
  rafId: number | null;
  pendingX: number;
  pendingY: number;
}

interface FloatingState {
  width: number;
  height: number;
  initialLeft: number;
  initialTop: number;
  label: string;
}

/** Result returned by `useChannelDrag`. */
export interface ChannelDragResult {
  /** Spread on the drag-handle element. */
  handleProps: {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerMove: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerUp: (e: React.PointerEvent<HTMLElement>) => void;
    onPointerCancel: (e: React.PointerEvent<HTMLElement>) => void;
    onClickCapture: (e: React.MouseEvent) => void;
  };
  /** Apply to the card so it hides while the floating clone is visible. */
  cardStyle: React.CSSProperties;
  /** Portal-rendered floating clone; render this unconditionally. */
  overlay: React.ReactNode;
  /** True while dragging (after threshold). */
  isDragging: boolean;
}

/**
 * Make a channel card reorderable via a drag handle.
 *
 * @param channelId  ID of the channel being dragged.
 * @param parentId   Parent channel ID (normalised: `null` for root-level).
 * @param name       Channel name shown in the floating clone.
 * @param disabled   When `true` the hook is inert (no drag started).
 * @param onDrop        Called with the drop event when the drag succeeds.
 * @param containerRef  When provided, the floating clone uses this element's
 *                      bounding rect instead of the handle's (gives full-row
 *                      width to the ghost card).
 */
export function useChannelDrag(
  channelId: number,
  parentId: number | null,
  name: string,
  disabled: boolean,
  onDrop: (event: ChannelDropEvent) => void,
  containerRef?: { readonly current: HTMLElement | null },
): ChannelDragResult {
  const stateRef = useRef<DragState | null>(null);
  const floatingElRef = useRef<HTMLDivElement | null>(null);
  const justDraggedRef = useRef(false);
  const [floating, setFloating] = useState<FloatingState | null>(null);

  const flush = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    st.rafId = null;
    const el = floatingElRef.current;
    if (el) {
      const y = st.pendingY - st.grabOffsetY;
      el.style.transform = `translate(${st.initialLeft}px, ${y}px)`;
    }
    clearAllDropPos();
    const hit = findDropTarget(st.pendingX, st.pendingY);
    if (hit) hit.target.setDropPos(hit.pos);
  }, []);

  const cleanup = useCallback(() => {
    const st = stateRef.current;
    if (st?.rafId != null) cancelAnimationFrame(st.rafId);
    stateRef.current = null;
    activeDrag = null;
    clearAllDropPos();
    setFloating(null);
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled || e.button !== 0) return;
      const targetEl = e.target as HTMLElement;
      // Skip when the pointer lands on an input, a generic no-drag widget,
      // or a member-list row that has its own user-drag handler.  The channel
      // reorder must not capture the pointer away from those targets.
      if (targetEl.closest("input, [data-no-drag='true'], [data-no-channel-drag='true']")) return;
      // Use the full container (channel row) rect for clone dimensions so
      // the ghost card is full-width, not just the 18px handle width.
      const rect = (containerRef?.current ?? e.currentTarget).getBoundingClientRect();
      stateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        grabOffsetX: e.clientX - rect.left,
        grabOffsetY: e.clientY - rect.top,
        width: rect.width,
        height: rect.height,
        initialLeft: rect.left,
        started: false,
        rafId: null,
        pendingX: e.clientX,
        pendingY: e.clientY,
      };
    },
    [disabled, containerRef],
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) return;
      st.pendingX = e.clientX;
      st.pendingY = e.clientY;
      if (!st.started) {
        const dx = e.clientX - st.startX;
        const dy = e.clientY - st.startY;
        if (Math.abs(dx) < DRAG_THRESHOLD_PX && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
        st.started = true;
        activeDrag = { channelId, parentId };
        try {
          e.currentTarget.setPointerCapture(st.pointerId);
        } catch {
          // Some webviews reject capture; ignore.
        }
        setFloating({
          width: st.width,
          height: st.height,
          initialLeft: st.initialLeft,
          initialTop: e.clientY - st.grabOffsetY,
          label: name,
        });
      }
      if (st.rafId == null) {
        st.rafId = requestAnimationFrame(flush);
      }
    },
    [flush, name, channelId, parentId],
  );

  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (!st || st.pointerId !== e.pointerId) {
        cleanup();
        return;
      }
      const wasDragging = st.started;
      try {
        if (e.currentTarget.hasPointerCapture(st.pointerId)) {
          e.currentTarget.releasePointerCapture(st.pointerId);
        }
      } catch {
        // Pointer capture may already be released.
      }
      if (wasDragging) {
        const hit = findDropTarget(e.clientX, e.clientY);
        if (hit) {
          onDrop({
            draggedId: channelId,
            targetId: hit.target.channelId,
            insertBefore: hit.pos === "before",
          });
        }
        justDraggedRef.current = true;
      }
      cleanup();
    },
    [cleanup, onDrop, channelId],
  );

  const onPointerCancel = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      const st = stateRef.current;
      if (st) {
        try {
          if (e.currentTarget.hasPointerCapture(st.pointerId)) {
            e.currentTarget.releasePointerCapture(st.pointerId);
          }
        } catch {
          // Already released.
        }
      }
      cleanup();
    },
    [cleanup],
  );

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      e.preventDefault();
      e.stopPropagation();
    }
  }, []);

  const overlay =
    floating != null
      ? createPortal(
          <FloatingChannelClone
            elRef={floatingElRef}
            width={floating.width}
            height={floating.height}
            initialLeft={floating.initialLeft}
            initialTop={floating.initialTop}
            label={floating.label}
          />,
          document.body,
        )
      : null;

  return {
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onClickCapture,
    },
    cardStyle: floating ? { opacity: 0.35 } : {},
    overlay,
    isDragging: floating != null,
  };
}

// -- Floating clone (portal child) --------------------------------

interface FloatingChannelCloneProps {
  elRef: React.MutableRefObject<HTMLDivElement | null>;
  width: number;
  height: number;
  initialLeft: number;
  initialTop: number;
  label: string;
}

function FloatingChannelClone({
  elRef,
  width,
  height,
  initialLeft,
  initialTop,
  label,
}: FloatingChannelCloneProps) {
  return (
    <div
      ref={elRef}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        width,
        height,
        transform: `translate(${initialLeft}px, ${initialTop}px)`,
        pointerEvents: "none",
        zIndex: 9999,
        opacity: 0.5,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 10px",
        borderRadius: 8,
        background: "rgba(30, 33, 40, 0.90)",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        boxShadow:
          "0 8px 24px rgba(0, 0, 0, 0.45), 0 1px 0 rgba(255, 255, 255, 0.06) inset",
        backdropFilter: "blur(10px) saturate(160%)",
        WebkitBackdropFilter: "blur(10px) saturate(160%)",
        color: "#f5f6f8",
        font: "inherit",
      }}
    >
      <GripVerticalIcon
        width={14}
        height={14}
        style={{ flexShrink: 0, opacity: 0.6 }}
      />
      <span
        style={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontSize: 14,
          fontWeight: 500,
        }}
      >
        {label}
      </span>
    </div>
  );
}
