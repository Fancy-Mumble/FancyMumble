/**
 * The two panes of the phone layout, stacked, and moved by a finger.
 *
 * The list and the thing it opened used to be one or the other: switching
 * unmounted the half you left, so every "back" rebuilt the channel tree and
 * every channel tap rebuilt the conversation, and there was nothing to drag.
 * Here both halves stay mounted and the front one slides over the other, the
 * way every chat app on a phone moves:
 *
 * - swipe right anywhere on an open page to go back to its list;
 * - swipe left on the list to bring the page you left back;
 * - swipe left on a conversation for the side panel (`onSwipeLeft`).
 *
 * Motion is written straight to the two layers' `style` from the touch
 * handlers, so a drag never re-renders anything; React only hears about it
 * when the pane actually changes.
 */
import { useLayoutEffect, useEffect, useRef, type ReactNode } from "react";
import { Box } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type { MobilePane } from "./MobileShell";

/** How long a pane takes to slide the whole way. */
export const PANE_SLIDE_MS = 220;
const EASE = "cubic-bezier(.2,.8,.2,1)";
/** Movement before a touch is a gesture at all, rather than a tap. */
const SLOP_PX = 10;
/** How much more sideways than upright a move has to be to count. */
const HORIZONTAL_BIAS = 1.2;
/** A drag released past this share of the width finishes the switch. */
const COMMIT_FRACTION = 0.33;
/** A flick this fast finishes it too, however short. */
const FLING_PX_PER_MS = 0.35;
/** How far the list behind drifts while the page covers it. */
const PARALLAX = 0.25;
/** A swipe-left on a page this long opens the side panel. */
const SIDE_SWIPE_PX = 60;

/**
 * Starts that belong to something else: a field (its own caret and
 * selection), anything opted out, and anything that scrolls sideways - a code
 * block, the share strip - which would otherwise lose every horizontal drag.
 */
function ownedElsewhere(target: EventTarget | null, stop: HTMLElement): boolean {
  if (!(target instanceof Element)) return true;
  if (target.closest("input, textarea, select, [contenteditable='true'], [data-no-swipe]")) return true;
  for (let node: Element | null = target; node && node !== stop; node = node.parentElement) {
    if (node.scrollWidth > node.clientWidth + 1) {
      const overflow = getComputedStyle(node).overflowX;
      if (overflow === "auto" || overflow === "scroll") return true;
    }
  }
  return false;
}

function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

interface MobilePaneStackProps {
  pane: MobilePane;
  nav?: ReactNode;
  content?: ReactNode;
  onPane: (pane: MobilePane) => void;
  /** Whether a swipe on the list may bring the page back. */
  forward?: boolean;
  /** A swipe left on the page, for the side panel a window keeps beside it. */
  onSwipeLeft?: () => void;
}

export function MobilePaneStack({
  pane,
  nav,
  content,
  onPane,
  forward = false,
  onSwipeLeft,
}: Readonly<MobilePaneStackProps>) {
  const base = useTheme().palette.nebula.bg0;
  const boxRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const both = nav !== undefined && content !== undefined;
  const target = both ? (pane === "content" ? 1 : 0) : null;
  // The current position: 1 is the page covering the list, 0 the list alone.
  const shown = useRef(target ?? 0);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Latest props for the touch handlers, which are bound once.
  const live = useRef({ target, onPane, forward, onSwipeLeft });
  live.current = { target, onPane, forward, onSwipeLeft };

  /** Put both layers at `p`, sliding there or jumping. */
  const place = (p: number, ms: number) => {
    const box = boxRef.current;
    const navEl = navRef.current;
    const page = pageRef.current;
    if (!box || !navEl || !page) return;
    shown.current = p;
    clearTimeout(settle.current);
    const width = box.clientWidth || 1;
    const transition = ms > 0 ? `transform ${ms}ms ${EASE}` : "none";
    for (const el of [navEl, page]) {
      el.style.transition = transition;
      el.style.visibility = "visible";
      el.removeAttribute("inert");
    }
    page.style.transform = `translate3d(${(1 - p) * width}px,0,0)`;
    // Opaque only while it moves: at rest it is the only thing showing, and
    // the chat backdrop behind it is part of the design.
    page.style.background = base;
    page.style.boxShadow = "-8px 0 24px rgba(0,0,0,.28)";
    navEl.style.transform = `translate3d(${-PARALLAX * p * width}px,0,0)`;
    navEl.style.opacity = String(1 - 0.35 * p);
    const rest = () => {
      if (p !== 0 && p !== 1) return;
      // The layer out of sight leaves the page's tab order and the screen
      // reader's reach, and stops costing a paint.
      const away = p === 1 ? navEl : page;
      away.style.visibility = "hidden";
      away.setAttribute("inert", "");
      page.style.background = "";
      page.style.boxShadow = "";
    };
    if (ms > 0) settle.current = setTimeout(rest, ms);
    else rest();
  };

  // A pane change - a tap, a back press, or a drag that committed - slides
  // from wherever the layers are to where the pane says. The first layout
  // (and a stack that just gained its second half) jumps instead: a list
  // opening on a page would otherwise watch the page fly in.
  const hadBoth = useRef(false);
  useLayoutEffect(() => {
    if (target === null) {
      hadBoth.current = false;
      return;
    }
    const animate = hadBoth.current && !reducedMotion();
    hadBoth.current = true;
    if (animate && shown.current === target) return;
    place(target, animate ? PANE_SLIDE_MS * Math.abs(shown.current - target) || PANE_SLIDE_MS : 0);
  }, [target]);

  useEffect(() => () => clearTimeout(settle.current), []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    type Drag = {
      x: number;
      y: number;
      from: number;
      mode: "pending" | "pane" | "side" | "off";
      lastX: number;
      lastT: number;
      v: number;
      dx: number;
    };
    let drag: Drag | null = null;

    const start = (event: TouchEvent) => {
      const { target: at } = live.current;
      if (event.touches.length !== 1 || ownedElsewhere(event.target, box)) {
        drag = null;
        return;
      }
      const touch = event.touches[0];
      drag = {
        x: touch.clientX,
        y: touch.clientY,
        from: at ?? 1,
        mode: "pending",
        lastX: touch.clientX,
        lastT: event.timeStamp,
        v: 0,
        dx: 0,
      };
    };

    const move = (event: TouchEvent) => {
      if (!drag || drag.mode === "off") return;
      const touch = event.touches[0];
      const dx = touch.clientX - drag.x;
      const dy = touch.clientY - drag.y;
      if (drag.mode === "pending") {
        if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
        const { target: at, forward: fwd, onSwipeLeft: side } = live.current;
        const sideways = Math.abs(dx) > Math.abs(dy) * HORIZONTAL_BIAS;
        if (!sideways) drag.mode = "off";
        else if (at === 1 && dx > 0) drag.mode = "pane";
        else if (at === 0 && dx < 0 && fwd) drag.mode = "pane";
        else if ((at === 1 || at === null) && dx < 0 && side) drag.mode = "side";
        else drag.mode = "off";
        if (drag.mode === "off") return;
        // Measured from here, so the layer does not jump by the slop.
        drag.x = touch.clientX;
      }
      if (event.cancelable) event.preventDefault();
      const moved = touch.clientX - drag.x;
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (touch.clientX - drag.lastX) / dt;
      drag.lastX = touch.clientX;
      drag.lastT = event.timeStamp;
      drag.dx = moved;
      if (drag.mode === "pane") {
        const width = box.clientWidth || 1;
        place(Math.min(1, Math.max(0, drag.from - moved / width)), 0);
      } else if (pageRef.current) {
        // A little give, so the panel's gesture is felt before it lands.
        pageRef.current.style.transition = "none";
        pageRef.current.style.transform = `translate3d(${Math.max(-40, moved * 0.2)}px,0,0)`;
      }
    };

    const end = () => {
      const current = drag;
      drag = null;
      if (!current || current.mode === "pending" || current.mode === "off") return;
      const { onPane: setPane, onSwipeLeft: side, target: at } = live.current;
      if (current.mode === "side") {
        if (pageRef.current) {
          pageRef.current.style.transition = `transform ${PANE_SLIDE_MS}ms ${EASE}`;
          pageRef.current.style.transform = at === null ? "" : "translate3d(0,0,0)";
        }
        if (current.dx < -SIDE_SWIPE_PX || current.v < -FLING_PX_PER_MS) side?.();
        return;
      }
      const p = shown.current;
      const next =
        current.from === 1
          ? 1 - p > COMMIT_FRACTION || current.v > FLING_PX_PER_MS
            ? 0
            : 1
          : p > COMMIT_FRACTION || current.v < -FLING_PX_PER_MS
            ? 1
            : 0;
      const ms = reducedMotion() ? 0 : Math.max(90, PANE_SLIDE_MS * Math.abs(p - next));
      place(next, ms);
      if (next !== current.from) setPane(next === 1 ? "content" : "nav");
    };

    box.addEventListener("touchstart", start, { passive: true });
    box.addEventListener("touchmove", move, { passive: false });
    box.addEventListener("touchend", end);
    box.addEventListener("touchcancel", end);
    return () => {
      box.removeEventListener("touchstart", start);
      box.removeEventListener("touchmove", move);
      box.removeEventListener("touchend", end);
      box.removeEventListener("touchcancel", end);
    };
  }, []);

  const layer = {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    willChange: "transform",
  } as const;

  return (
    <Box
      ref={boxRef}
      data-testid="nebula-mobile-panes"
      sx={{ flex: 1, minHeight: 0, position: "relative", zIndex: 1, overflow: "hidden" }}
    >
      {both ? (
        <>
          <Box ref={navRef} data-pane="nav" sx={layer}>
            {nav}
          </Box>
          <Box ref={pageRef} data-pane="content" sx={layer}>
            {content}
          </Box>
        </>
      ) : (
        // One half only: nothing to slide, but the page still gets the
        // side-panel gesture, so the same ref carries it.
        <Box ref={pageRef} data-pane={nav === undefined ? "content" : "nav"} sx={layer}>
          {nav ?? content}
        </Box>
      )}
    </Box>
  );
}
