import { create } from "zustand";

/** Which region a drag/drop is routed to. */
export type DragRegion = "chat" | "livedoc" | null;

/** Live-doc display state used to route file drops. */
export type LiveDocDropMode = "none" | "half" | "max";

interface Rect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface DropRoutingInput {
  readonly mode: LiveDocDropMode;
  /** Pointer position in CSS pixels (viewport coordinates). */
  readonly point: { readonly x: number; readonly y: number };
  /** Live-doc droppable rect in CSS pixels, or null when unavailable. */
  readonly liveDocRect: Rect | null;
}

function pointInRect(point: { x: number; y: number }, rect: Rect): boolean {
  return (
    point.x >= rect.left &&
    point.x <= rect.right &&
    point.y >= rect.top &&
    point.y <= rect.bottom
  );
}

/**
 * Decide whether a drag at `point` should target the chat or the live
 * doc, given the current live-doc display mode.
 *
 * - `none`: live doc closed -> everything goes to chat.
 * - `max`: live doc maximised (chat hidden) -> everything goes to the doc.
 * - `half`: both visible -> geometry decides which region is under the pointer.
 */
export function resolveDropTarget({ mode, point, liveDocRect }: DropRoutingInput): DragRegion {
  if (mode === "none") return "chat";
  if (mode === "max") return "livedoc";
  if (liveDocRect && pointInRect(point, liveDocRect)) return "livedoc";
  return "chat";
}

interface LiveDocDropState {
  /** Bounding rect of the live-doc drop region, or null when no doc is open. */
  getRect: (() => DOMRect | null) | null;
  /** Insert dropped image files into the live document. */
  insertImages: ((files: File[]) => void) | null;
  /** Whether a drag is currently hovering the live-doc region (drives its overlay). */
  dragOver: boolean;
  registerTarget: (
    getRect: () => DOMRect | null,
    insertImages: (files: File[]) => void,
  ) => void;
  unregisterTarget: () => void;
  setDragOver: (value: boolean) => void;
}

/**
 * Shared registry letting the live-doc panel expose its drop region and
 * image-insert handler to the chat-level drag-drop hook, which is global
 * to the Tauri webview and cannot rely on per-element DOM drop events.
 */
export const useLiveDocDropStore = create<LiveDocDropState>((set) => ({
  getRect: null,
  insertImages: null,
  dragOver: false,
  registerTarget: (getRect, insertImages) => set({ getRect, insertImages }),
  unregisterTarget: () => set({ getRect: null, insertImages: null, dragOver: false }),
  setDragOver: (value) => set({ dragOver: value }),
}));
