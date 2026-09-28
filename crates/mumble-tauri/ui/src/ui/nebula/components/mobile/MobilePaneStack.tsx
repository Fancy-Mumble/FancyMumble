/**
 * The panes of the phone layout, stacked, and moved by a finger.
 *
 * The list and the thing it opened used to be one or the other: switching
 * unmounted the half you left, so every "back" rebuilt the channel tree and
 * every channel tap rebuilt the conversation, and there was nothing to drag.
 * Here both halves stay mounted and the front one slides over the other, and
 * the side panel a window keeps beside the conversation waits off the right
 * edge - the way every chat app on a phone moves:
 *
 * - swipe right anywhere on an open page to go back to its list;
 * - swipe left on the list to bring the page you left back;
 * - swipe left on a conversation to pull the side panel in from the right,
 *   and right again (or a tap on what it covers) to put it away.
 *
 * Motion is written straight to the layers' `style` from the touch handlers,
 * so a drag never re-renders anything; React only hears about it when the
 * pane, or whether the side panel is out, actually changes.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
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
/** A drag released past this share of the way finishes the move. */
const COMMIT_FRACTION = 0.33;
/** A flick this fast finishes it too, however short. */
const FLING_PX_PER_MS = 0.35;
/** How far the list behind drifts while the page covers it. */
const PARALLAX = 0.25;
/** How far the page gives way while the side panel comes over it. */
const SIDE_PUSH = 0.3;
/** The side panel's width: most of the screen, with the page still in view. */
const SIDE_WIDTH = "min(86%, 380px)";

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

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Put a layer out of reach - hidden, and out of the tab order - or back. */
function reach(el: HTMLElement | null, visible: boolean) {
  if (!el) return;
  el.style.visibility = visible ? "visible" : "hidden";
  if (visible) el.removeAttribute("inert");
  else el.setAttribute("inert", "");
}

interface MobilePaneStackProps {
  pane: MobilePane;
  nav?: ReactNode;
  content?: ReactNode;
  onPane: (pane: MobilePane) => void;
  /** Whether a swipe on the list may bring the page back. */
  forward?: boolean;
  /** The panel that comes in from the right over the page. */
  side?: ReactNode;
  sideOpen?: boolean;
  onSide?: (open: boolean) => void;
}

export function MobilePaneStack({
  pane,
  nav,
  content,
  onPane,
  forward = false,
  side,
  sideOpen = false,
  onSide,
}: Readonly<MobilePaneStackProps>) {
  const base = useTheme().palette.nebula.bg0;
  const boxRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const sideRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const both = nav !== undefined && content !== undefined;
  const target = both ? (pane === "content" ? 1 : 0) : null;
  const hasSide = side !== undefined;
  const sideTarget = hasSide && sideOpen ? 1 : 0;
  // Where the layers are: `p` is the page's share over the list (1 covers
  // it), `q` the side panel's share of its own width on screen.
  const shown = useRef({ p: target ?? 1, q: sideTarget });
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Latest props for the touch handlers, which are bound once.
  const live = useRef({ target, onPane, forward, hasSide, onSide });
  live.current = { target, onPane, forward, hasSide, onSide };

  /** Put every layer where `p` and `q` say, sliding there or jumping. */
  const place = (p: number, q: number, ms: number) => {
    const box = boxRef.current;
    const page = pageRef.current;
    if (!box || !page) return;
    const navEl = navRef.current;
    const sideEl = sideRef.current;
    const scrim = scrimRef.current;
    shown.current = { p, q };
    clearTimeout(settle.current);
    const width = box.clientWidth || 1;
    const sideWidth = sideEl?.offsetWidth || width;
    const transition = ms > 0 ? `transform ${ms}ms ${EASE}, opacity ${ms}ms ${EASE}` : "none";
    for (const el of [navEl, page, sideEl, scrim]) {
      if (!el) continue;
      el.style.transition = transition;
    }
    reach(page, true);
    page.style.transform = `translate3d(${(navEl ? (1 - p) * width : 0) - SIDE_PUSH * q * sideWidth}px,0,0)`;
    if (navEl) {
      reach(navEl, true);
      // Opaque only while it moves over the list: at rest it is the only
      // thing showing, and the chat backdrop behind it is part of the design.
      page.style.background = base;
      page.style.boxShadow = "-8px 0 24px rgba(0,0,0,.28)";
      navEl.style.transform = `translate3d(${-PARALLAX * p * width}px,0,0)`;
      navEl.style.opacity = String(1 - 0.35 * p);
    }
    if (sideEl && scrim) {
      reach(sideEl, true);
      reach(scrim, true);
      sideEl.style.transform = `translate3d(${(1 - q) * 100}%,0,0)`;
      scrim.style.opacity = String(q);
    }
    const rest = () => {
      if (navEl && (p === 0 || p === 1)) {
        // The layer out of sight leaves the tab order and the screen
        // reader's reach, and stops costing a paint.
        reach(p === 1 ? navEl : page, false);
        page.style.background = "";
        page.style.boxShadow = "";
      }
      if (sideEl && scrim && q === 0) {
        reach(sideEl, false);
        reach(scrim, false);
      }
    };
    if (ms > 0) settle.current = setTimeout(rest, ms);
    else rest();
  };

  // A change from outside - a tap, a back press, a header button, or a drag
  // that committed - slides from wherever the layers are to where the props
  // say. The first layout (and a stack that just gained a layer) jumps
  // instead: a list opening on a page would otherwise watch the page fly in.
  const laidOut = useRef<string | null>(null);
  useLayoutEffect(() => {
    const shape = `${both}|${hasSide}`;
    const animate = laidOut.current === shape && !reducedMotion();
    laidOut.current = shape;
    const p = target ?? 1;
    const { p: atP, q: atQ } = shown.current;
    if (animate && atP === p && atQ === sideTarget) return;
    const distance = Math.max(Math.abs(atP - p), Math.abs(atQ - sideTarget));
    place(p, sideTarget, animate ? Math.max(90, PANE_SLIDE_MS * distance) : 0);
    // `place` reads refs only.
  }, [target, sideTarget, both, hasSide]);

  useEffect(() => () => clearTimeout(settle.current), []);

  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    type Drag = {
      x: number;
      y: number;
      from: { p: number; q: number };
      mode: "pending" | "pane" | "side" | "off";
      lastX: number;
      lastT: number;
      v: number;
    };
    let drag: Drag | null = null;

    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || ownedElsewhere(event.target, box)) {
        drag = null;
        return;
      }
      const touch = event.touches[0];
      drag = {
        x: touch.clientX,
        y: touch.clientY,
        from: { ...shown.current },
        mode: "pending",
        lastX: touch.clientX,
        lastT: event.timeStamp,
        v: 0,
      };
    };

    const move = (event: TouchEvent) => {
      if (!drag || drag.mode === "off") return;
      const touch = event.touches[0];
      const dx = touch.clientX - drag.x;
      const dy = touch.clientY - drag.y;
      if (drag.mode === "pending") {
        if (Math.abs(dx) < SLOP_PX && Math.abs(dy) < SLOP_PX) return;
        const { target: at, forward: fwd, hasSide: sided } = live.current;
        const { p, q } = drag.from;
        const onPage = at === null || p === 1;
        if (Math.abs(dx) <= Math.abs(dy) * HORIZONTAL_BIAS) drag.mode = "off";
        else if (q === 1) drag.mode = dx > 0 ? "side" : "off";
        else if (onPage && dx < 0 && sided) drag.mode = "side";
        else if (at === 1 && dx > 0) drag.mode = "pane";
        else if (at === 0 && dx < 0 && fwd) drag.mode = "pane";
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
      if (drag.mode === "pane") {
        const width = box.clientWidth || 1;
        place(clamp01(drag.from.p - moved / width), drag.from.q, 0);
      } else {
        const sideWidth = sideRef.current?.offsetWidth || box.clientWidth || 1;
        place(drag.from.p, clamp01(drag.from.q - moved / sideWidth), 0);
      }
    };

    const end = () => {
      const current = drag;
      drag = null;
      if (!current || current.mode === "pending" || current.mode === "off") return;
      const { onPane: setPane, onSide: setSide } = live.current;
      const { p, q } = shown.current;
      // Leftward is a negative velocity, and both moves below are "more"
      // leftward: the page over the list, the panel over the page.
      const toward = (from: number, at: number) =>
        from === 1
          ? 1 - at > COMMIT_FRACTION || current.v > FLING_PX_PER_MS
            ? 0
            : 1
          : at > COMMIT_FRACTION || current.v < -FLING_PX_PER_MS
            ? 1
            : 0;
      const nextP = current.mode === "pane" ? toward(current.from.p, p) : current.from.p;
      const nextQ = current.mode === "side" ? toward(current.from.q, q) : current.from.q;
      const distance = Math.max(Math.abs(p - nextP), Math.abs(q - nextQ));
      place(nextP, nextQ, reducedMotion() ? 0 : Math.max(90, PANE_SLIDE_MS * distance));
      if (nextP !== current.from.p) setPane(nextP === 1 ? "content" : "nav");
      if (nextQ !== current.from.q) setSide?.(nextQ === 1);
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
    // The handlers read refs only, so they are bound once.
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
      {both && (
        <Box ref={navRef} data-pane="nav" sx={layer}>
          {nav}
        </Box>
      )}
      <Box ref={pageRef} data-pane={both || nav === undefined ? "content" : "nav"} sx={layer}>
        {both ? content : (nav ?? content)}
      </Box>
      {hasSide && (
        <>
          {/* What the panel covers, dimmed; a tap on it puts the panel away. */}
          <Box
            ref={scrimRef}
            aria-hidden
            onClick={() => live.current.onSide?.(false)}
            sx={{ position: "absolute", inset: 0, zIndex: 2, background: "rgba(0,0,0,.45)", opacity: 0 }}
          />
          <Box
            ref={sideRef}
            data-pane="side"
            sx={{
              ...layer,
              left: "auto",
              width: SIDE_WIDTH,
              zIndex: 3,
              transform: "translate3d(100%,0,0)",
              boxShadow: "-12px 0 32px rgba(0,0,0,.35)",
            }}
          >
            {side}
          </Box>
        </>
      )}
    </Box>
  );
}
