/**
 * The server strip over a list, and the vertical drag that folds it away.
 *
 * Swipe up on the strip to put it away; swipe down on the header under it to
 * pull it back out. The strip follows the finger - its height is written
 * straight to the element while the drag lasts - and a release past a third
 * of the way, or a flick, finishes the move. The header's button does the
 * same thing for anyone who does not know the gesture is there.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { Box } from "@mui/material";
import { Stack } from "../primitives";

/** How long the strip takes to fold the whole way. */
export const STRIP_FOLD_MS = 200;
const EASE = "cubic-bezier(.2,.8,.2,1)";
const SLOP_PX = 8;
const VERTICAL_BIAS = 1.2;
const COMMIT_FRACTION = 0.33;
const FLING_PX_PER_MS = 0.35;
/** The strip's height when it has not been laid out to measure (a test). */
const FALLBACK_HEIGHT = 88;

function reducedMotion(): boolean {
  return globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

interface MobileStripHostProps {
  /** The strip; null where a screen has none, which leaves the list alone. */
  strip: ReactNode | null;
  hidden: boolean;
  onHidden: (hidden: boolean) => void;
  children: ReactNode;
}

export function MobileStripHost({ strip, hidden, onHidden, children }: Readonly<MobileStripHostProps>) {
  const hostRef = useRef<HTMLDivElement>(null);
  const foldRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  // 1 is the strip all the way out, 0 put away.
  const shown = useRef(hidden ? 0 : 1);
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const live = useRef(onHidden);
  live.current = onHidden;

  const height = () => innerRef.current?.offsetHeight || FALLBACK_HEIGHT;

  /** Fold the strip to `r` of its height, sliding there or jumping. */
  const place = (r: number, ms: number) => {
    const fold = foldRef.current;
    const inner = innerRef.current;
    if (!fold || !inner) return;
    shown.current = r;
    clearTimeout(settle.current);
    const full = height();
    const transition = ms > 0 ? `height ${ms}ms ${EASE}, transform ${ms}ms ${EASE}` : "none";
    fold.style.transition = transition;
    inner.style.transition = transition;
    fold.style.visibility = "visible";
    fold.removeAttribute("inert");
    fold.style.height = `${r * full}px`;
    inner.style.transform = `translate3d(0,${-(1 - r) * full}px,0)`;
    const rest = () => {
      if (r === 1) {
        // Its own height again, so a strip that grows a row keeps it.
        fold.style.height = "";
      } else if (r === 0) {
        fold.style.visibility = "hidden";
        fold.setAttribute("inert", "");
      }
    };
    if (ms > 0) settle.current = setTimeout(rest, ms);
    else rest();
  };

  const laidOut = useRef(false);
  useLayoutEffect(() => {
    if (strip === null) return;
    const target = hidden ? 0 : 1;
    const animate = laidOut.current && !reducedMotion();
    laidOut.current = true;
    if (animate && shown.current === target) return;
    place(target, animate ? STRIP_FOLD_MS : 0);
    // `place` reads refs only.
  }, [hidden, strip === null]);

  useEffect(() => () => clearTimeout(settle.current), []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || strip === null) return;
    type Drag = {
      y: number;
      x: number;
      from: number;
      mode: "pending" | "fold" | "off";
      v: number;
      lastY: number;
      lastT: number;
    };
    let drag: Drag | null = null;

    // A drag that started on the header's button must not also press it.
    const swallowClick = () => {
      const stop = (event: Event) => {
        event.stopPropagation();
        event.preventDefault();
      };
      host.addEventListener("click", stop, { capture: true, once: true });
      setTimeout(() => host.removeEventListener("click", stop, { capture: true }), 400);
    };

    const start = (event: TouchEvent) => {
      drag = null;
      if (event.touches.length !== 1 || !(event.target instanceof Element)) return;
      // The strip itself, or the header straight under it - not the list.
      const handle = event.target.closest("[data-strip-fold], header");
      if (!handle || !host.contains(handle)) return;
      const touch = event.touches[0];
      drag = {
        y: touch.clientY,
        x: touch.clientX,
        from: shown.current,
        mode: "pending",
        v: 0,
        lastY: touch.clientY,
        lastT: event.timeStamp,
      };
    };

    const move = (event: TouchEvent) => {
      if (!drag || drag.mode === "off") return;
      const touch = event.touches[0];
      const dy = touch.clientY - drag.y;
      const dx = touch.clientX - drag.x;
      if (drag.mode === "pending") {
        if (Math.abs(dy) < SLOP_PX && Math.abs(dx) < SLOP_PX) return;
        const upright = Math.abs(dy) > Math.abs(dx) * VERTICAL_BIAS;
        const way = (drag.from === 1 && dy < 0) || (drag.from === 0 && dy > 0);
        drag.mode = upright && way ? "fold" : "off";
        if (drag.mode === "off") return;
        drag.y = touch.clientY;
      }
      if (event.cancelable) event.preventDefault();
      const dt = event.timeStamp - drag.lastT;
      if (dt > 0) drag.v = (touch.clientY - drag.lastY) / dt;
      drag.lastY = touch.clientY;
      drag.lastT = event.timeStamp;
      const r = Math.min(1, Math.max(0, drag.from + (touch.clientY - drag.y) / height()));
      place(r, 0);
    };

    const end = () => {
      const current = drag;
      drag = null;
      if (current?.mode !== "fold") return;
      swallowClick();
      const r = shown.current;
      const next =
        current.from === 1
          ? 1 - r > COMMIT_FRACTION || current.v < -FLING_PX_PER_MS
            ? 0
            : 1
          : r > COMMIT_FRACTION || current.v > FLING_PX_PER_MS
            ? 1
            : 0;
      place(next, reducedMotion() ? 0 : Math.max(80, STRIP_FOLD_MS * Math.abs(r - next)));
      if (next !== current.from) live.current(next === 0);
    };

    host.addEventListener("touchstart", start, { passive: true });
    host.addEventListener("touchmove", move, { passive: false });
    host.addEventListener("touchend", end);
    host.addEventListener("touchcancel", end);
    return () => {
      host.removeEventListener("touchstart", start);
      host.removeEventListener("touchmove", move);
      host.removeEventListener("touchend", end);
      host.removeEventListener("touchcancel", end);
    };
  }, [strip === null]);

  if (strip === null) return <>{children}</>;
  return (
    <Stack ref={hostRef} sx={{ flex: 1, minHeight: 0 }}>
      <Box ref={foldRef} data-strip-fold="" sx={{ flex: "none", overflow: "hidden" }}>
        <Box ref={innerRef}>{strip}</Box>
      </Box>
      {children}
    </Stack>
  );
}
