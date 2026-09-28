import { useEffect, useRef } from "react";

/**
 * Let a scrollable thing inside a node keep the wheel.
 *
 * The canvas spends the wheel on zoom - KiCad's binding, and the right one for
 * a graph - which is fine until a node body holds a document taller than the
 * box it is in. Rolling the wheel over a page of welcome text then zooms the
 * canvas out instead of scrolling the text, and the only way to read the rest
 * of it is to drag the scrollbar.
 *
 * So a wheel that lands on something that can actually scroll is stopped here,
 * before it reaches the viewport's listener, and the browser scrolls as it
 * normally would. A wheel over a node that cannot scroll - or one already at
 * the end of its travel - is left alone and zooms, which is what makes the
 * gesture still feel like the canvas's.
 *
 * Native and non-passive rather than React's `onWheel`, because the listener it
 * has to get in front of is a native one on an ancestor: React's own handlers
 * run at the root, which is *after* the viewport has already zoomed.
 */
export function useScrollGuard<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const host = ref.current;
    if (!host) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey) return; // the canvas's pan bindings
      const scroller = scrollerUnder(event.target, host, event.deltaY);
      if (scroller) event.stopPropagation();
    };

    host.addEventListener("wheel", onWheel, { passive: false });
    return () => host.removeEventListener("wheel", onWheel);
  }, []);

  return ref;
}

/**
 * The nearest thing from `target` up to `host` that can scroll by `delta`.
 *
 * "Can scroll" includes being at the end of its travel, which is the case that
 * decides whether the gesture belongs to the text or to the canvas: a document
 * scrolled to its last line hands the wheel back, so one more notch zooms out
 * rather than doing nothing at all.
 */
function scrollerUnder(target: EventTarget | null, host: HTMLElement, delta: number): HTMLElement | null {
  let node = target instanceof HTMLElement ? target : null;
  while (node) {
    const overflow = getComputedStyle(node).overflowY;
    if (
      (overflow === "auto" || overflow === "scroll") &&
      node.scrollHeight > node.clientHeight &&
      (delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1)
    ) {
      return node;
    }
    if (node === host) return null;
    node = node.parentElement;
  }
  return null;
}
