import type { NodeViewProps } from "@tiptap/react";

export interface DropIndicator {
  readonly left: number;
  readonly top: number;
  readonly width: number;
}

export type SideZone = "left" | "right";

export interface SideZoneRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface DropDragState {
  readonly ghost: {
    readonly left: number;
    readonly top: number;
    readonly width: number;
    readonly height: number;
    readonly src: string;
    readonly rotation: number;
  };
  readonly indicator: DropIndicator | null;
  readonly sideZone: SideZone | null;
  readonly sideZoneRect: SideZoneRect | null;
}

const SIDE_ZONE_FRACTION = 0.28;

interface PageContent {
  readonly contentLeft: number;
  readonly contentRight: number;
  readonly top: number;
  readonly height: number;
}

function resolvePageContent(editor: NodeViewProps["editor"]): PageContent | null {
  const pageEl = editor.view.dom.closest<HTMLElement>("[data-livedoc-page]");
  if (!pageEl) return null;
  const pageRect = pageEl.getBoundingClientRect();
  const pageStyle = window.getComputedStyle(pageEl);
  const padLeft = parseFloat(pageStyle.paddingLeft) || 0;
  const padRight = parseFloat(pageStyle.paddingRight) || 0;
  // Clamp the visible zone to the scroll container so the fixed-position
  // side-zone indicator does not bleed into the toolbar or beyond the viewport.
  const scrollRect = pageEl.parentElement?.getBoundingClientRect();
  const clampTop = scrollRect ? Math.max(pageRect.top, scrollRect.top) : pageRect.top;
  const clampBottom = scrollRect
    ? Math.min(pageRect.bottom, scrollRect.bottom)
    : pageRect.bottom;
  return {
    contentLeft: pageRect.left + padLeft,
    contentRight: pageRect.right - padRight,
    top: clampTop,
    height: Math.max(0, clampBottom - clampTop),
  };
}

export function computeSideZone(
  editor: NodeViewProps["editor"],
  clientX: number,
): { zone: SideZone | null; rect: SideZoneRect | null } {
  const page = resolvePageContent(editor);
  if (!page) return { zone: null, rect: null };
  const { contentLeft, contentRight, top, height } = page;
  const zoneWidth = (contentRight - contentLeft) * SIDE_ZONE_FRACTION;
  if (clientX < contentLeft + zoneWidth) {
    return { zone: "left", rect: { left: contentLeft, top, width: zoneWidth, height } };
  }
  if (clientX > contentRight - zoneWidth) {
    return { zone: "right", rect: { left: contentRight - zoneWidth, top, width: zoneWidth, height } };
  }
  return { zone: null, rect: null };
}

export function computeDropIndicator(
  editor: NodeViewProps["editor"],
  getPos: NodeViewProps["getPos"],
  clientX: number,
  clientY: number,
): DropIndicator | null {
  const view = editor.view;
  const target = view.posAtCoords({ left: clientX, top: clientY });
  if (!target) return null;
  if (typeof getPos !== "function") return null;
  const myPos = getPos();
  if (typeof myPos !== "number") return null;
  const myNode = view.state.doc.nodeAt(myPos);
  if (!myNode) return null;
  const $target = view.state.doc.resolve(target.pos);
  const insertAt = $target.depth === 0 ? target.pos : $target.before(1);
  if (insertAt >= myPos && insertAt <= myPos + myNode.nodeSize) return null;
  let coords: { left: number; top: number };
  try {
    coords = view.coordsAtPos(insertAt);
  } catch {
    return null;
  }
  const page = resolvePageContent(editor);
  if (!page) return null;
  return { left: page.contentLeft, top: coords.top, width: page.contentRight - page.contentLeft };
}
