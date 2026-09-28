/**
 * Keep what the reader is looking at still while rows above it change size.
 *
 * A row's height is not settled when it mounts. An attachment's picture
 * arrives after a fetch and a decode, a clip's poster learns its shape from
 * its metadata, a link preview lands, a body comes back from cold storage at
 * a different height from the placeholder that held its place. Each of those,
 * in a row above the viewport, pushes the text the reader is on down the
 * screen by exactly that much - and scrolling up through a river of shared
 * pictures is a run of such rows, each landing as it comes into the render
 * window. The scroller does nothing about it: WebKit has no scroll anchoring,
 * so this is it.
 *
 * Rows are watched for size. A change in one that sits above the viewport's
 * top edge is paid back into `scrollTop` inside the same frame, before
 * anything is painted, so the reader never sees it. At the bottom the answer
 * is the other one: the reader is following the conversation, and growth
 * anywhere means scrolling to the end again.
 *
 * Nothing here knows what a row is beyond the selector it is found by, so
 * either pack can use it; the mounting and unmounting of rows is watched for
 * so a row that arrives after the observer was built is watched as well.
 */

import { useEffect, useRef, type RefObject } from "react";

export interface UseScrollAnchorOptions {
  /** The scrolling element. */
  readonly containerRef: RefObject<HTMLElement | null>;
  /** The element the rows are mounted inside; watched for arrivals. */
  readonly innerRef: RefObject<HTMLElement | null>;
  /** How a row is found under `innerRef`. */
  readonly rowSelector: string;
  /**
   * Whether the reader is at the bottom, following the conversation.
   *
   * Read at the moment a row changes rather than captured: the list already
   * tracks this from its scroll events and there is no sense in a second
   * opinion.
   */
  readonly isPinned: () => boolean;
}

/** One row's size change, placed against the viewport. */
export interface RowResize {
  /** The row's bottom edge after the change, in viewport coordinates. */
  readonly bottom: number;
  /** How much taller (or, negative, shorter) it became. */
  readonly delta: number;
}

/**
 * How far the view has to move to stay on the same content, given the rows
 * that changed size in one layout pass.
 *
 * A row counts when the whole of it sat above the viewport's top edge before
 * it changed: the bottom it had before growing is its bottom now, less the
 * growth. A row that straddles the edge is left alone, because which part of
 * it grew is not known and guessing moves the text the reader is reading.
 */
export function paybackAbove(rows: readonly RowResize[], viewportTop: number): number {
  let total = 0;
  for (const row of rows) {
    const bottomBefore = row.bottom - Math.max(row.delta, 0);
    if (bottomBefore <= viewportTop + 0.5) total += row.delta;
  }
  return total;
}

export function useScrollAnchor({ containerRef, innerRef, rowSelector, isPinned }: UseScrollAnchorOptions): void {
  // Through a ref: a fresh closure on every render must not rebuild the
  // observers, which would forget every height they had measured.
  const pinnedRef = useRef(isPinned);
  pinnedRef.current = isPinned;

  useEffect(() => {
    const container = containerRef.current;
    const inner = innerRef.current;
    if (!container || !inner) return;
    // A DOM with no observer (a test runner's) lays nothing out either, so
    // there is nothing to anchor against.
    if (typeof ResizeObserver === "undefined") return;

    /** The height each watched row was last seen at. */
    const heights = new WeakMap<Element, number>();

    const observer = new ResizeObserver((entries) => {
      const resized: RowResize[] = [];
      for (const entry of entries) {
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        const before = heights.get(entry.target);
        heights.set(entry.target, height);
        // First sight of a row is its size, not a change in it. A row that
        // mounts above the viewport is the list's business: it knows what it
        // prepended and corrects for the lot in one go.
        if (before === undefined) continue;
        const delta = height - before;
        if (Math.abs(delta) < 0.5) continue;
        resized.push({ bottom: entry.target.getBoundingClientRect().bottom, delta });
      }
      if (resized.length === 0) return;

      if (pinnedRef.current()) {
        container.scrollTop = container.scrollHeight;
        return;
      }
      const payback = paybackAbove(resized, container.getBoundingClientRect().top);
      if (payback !== 0) container.scrollTop += payback;
    });

    const observeAll = () => {
      for (const row of inner.querySelectorAll<HTMLElement>(rowSelector)) observer.observe(row);
    };
    observeAll();
    const mutations = new MutationObserver(observeAll);
    mutations.observe(inner, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      mutations.disconnect();
    };
  }, [containerRef, innerRef, rowSelector]);
}
