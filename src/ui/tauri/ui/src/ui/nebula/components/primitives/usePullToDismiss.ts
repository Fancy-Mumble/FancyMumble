/**
 * Pull a bottom sheet down to put it away.
 *
 * From anywhere on the sheet, and from inside its scroller once the scroller
 * is at its top - past that, the pull is a scroll. A pull released past
 * `DISMISS_PX`, or flicked, closes it; anything less springs back.
 *
 * The sheet is taken as an element rather than a ref: a sheet drawn through a
 * portal mounts a render after its owner, when a ref read in an effect would
 * still be empty.
 */
import { useEffect, useRef } from "react";

/** How long the sheet takes to spring back after a short pull. */
export const SHEET_ENTER_MS = 220;
export const SHEET_EASE = "cubic-bezier(.2,.8,.2,1)";
/** A pull released past this, or flicked, puts the sheet away. */
const DISMISS_PX = 90;
const DISMISS_PX_PER_MS = 0.45;

export function usePullToDismiss(
  sheet: HTMLElement | null,
  scroller: () => HTMLElement | null,
  onClose: () => void,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const scrollerRef = useRef(scroller);
  scrollerRef.current = scroller;

  useEffect(() => {
    if (!sheet) return;
    let drag: {
      y: number;
      x: number;
      live: boolean;
      off: boolean;
      v: number;
      lastY: number;
      lastT: number;
    } | null = null;
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      drag = {
        y: touch.clientY,
        x: touch.clientX,
        live: false,
        off: false,
        v: 0,
        lastY: touch.clientY,
        lastT: event.timeStamp,
      };
    };
    const move = (event: TouchEvent) => {
      if (!drag || drag.off) return;
      const touch = event.touches[0];
      const dy = touch.clientY - drag.y;
      if (!drag.live) {
        if (Math.abs(dy) < 8 && Math.abs(touch.clientX - drag.x) < 8) return;
        const list = scrollerRef.current();
        const inList = list?.contains(event.target as Node) ?? false;
        const atTop = !list || list.scrollTop <= 0;
        if (dy <= 0 || Math.abs(touch.clientX - drag.x) > dy || (inList && !atTop)) {
          drag.off = true;
          return;
        }
        drag.live = true;
        drag.y = touch.clientY;
      }
      if (event.cancelable) event.preventDefault();
      const pulled = Math.max(0, touch.clientY - drag.y);
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (touch.clientY - drag.lastY) / dt;
      drag.lastY = touch.clientY;
      drag.lastT = event.timeStamp;
      sheet.style.transition = "none";
      sheet.style.transform = `translate3d(0,${pulled}px,0)`;
    };
    const end = (event: TouchEvent) => {
      const current = drag;
      drag = null;
      if (!current?.live) return;
      const pulled = (event.changedTouches[0]?.clientY ?? current.y) - current.y;
      if (pulled > DISMISS_PX || current.v > DISMISS_PX_PER_MS) {
        closeRef.current();
        return;
      }
      sheet.style.transition = `transform ${SHEET_ENTER_MS}ms ${SHEET_EASE}`;
      sheet.style.transform = "translate3d(0,0,0)";
    };
    sheet.addEventListener("touchstart", start, { passive: true });
    sheet.addEventListener("touchmove", move, { passive: false });
    sheet.addEventListener("touchend", end);
    sheet.addEventListener("touchcancel", end);
    return () => {
      sheet.removeEventListener("touchstart", start);
      sheet.removeEventListener("touchmove", move);
      sheet.removeEventListener("touchend", end);
      sheet.removeEventListener("touchcancel", end);
    };
  }, [sheet]);
}
