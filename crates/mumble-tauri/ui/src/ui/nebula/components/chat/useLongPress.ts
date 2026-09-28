/**
 * Press and hold, for the one thing a phone cannot do: right-click.
 *
 * A message's menu is where most of its actions live, and a touch screen has no
 * secondary button to open it with. Standard answers with a long-press; this is
 * the same gesture, opened at the finger rather than in the middle of the
 * screen, so the menu comes up beside the message it is about.
 */
import { useEffect, useRef } from "react";

/** How long the finger has to stay down. Standard's figure. */
export const LONG_PRESS_MS = 500;
/** How far it may drift first: a scroll that starts on a message is not a hold. */
const MOVE_TOLERANCE_PX = 10;
/**
 * How long after a hold the tap and the platform's own menu are swallowed.
 * Lifting the finger clicks whatever was under it, and Android's webview raises
 * `contextmenu` for the same hold - either would act on the message a second time.
 */
const SWALLOW_MS = 700;

export interface LongPressPoint {
  x: number;
  y: number;
}

export function useLongPress(
  onLongPress: (point: LongPressPoint, target: EventTarget | null, element: HTMLElement) => void,
  enabled: boolean,
) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<LongPressPoint | null>(null);
  const firedAt = useRef(0);
  // The latest callback, so a timer started before a re-render still opens the
  // menu for what the row shows now.
  const callback = useRef(onLongPress);
  callback.current = onLongPress;

  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };
  useEffect(() => cancel, []);

  const handlers = enabled
    ? {
        onTouchStart: (event: React.TouchEvent<HTMLElement>) => {
          cancel();
          if (event.touches.length !== 1) return;
          const touch = event.touches[0];
          const point = { x: touch.clientX, y: touch.clientY };
          const element = event.currentTarget;
          const target = event.target;
          start.current = point;
          timer.current = setTimeout(() => {
            timer.current = null;
            start.current = null;
            firedAt.current = Date.now();
            if ("vibrate" in navigator) navigator.vibrate(12);
            callback.current(point, target, element);
          }, LONG_PRESS_MS);
        },
        onTouchMove: (event: React.TouchEvent<HTMLElement>) => {
          const from = start.current;
          const touch = event.touches[0];
          if (!from || !touch) return;
          if (Math.hypot(touch.clientX - from.x, touch.clientY - from.y) > MOVE_TOLERANCE_PX) cancel();
        },
        onTouchEnd: cancel,
        onTouchCancel: cancel,
      }
    : {};

  return {
    handlers,
    /** Whether a hold has just opened the menu, so what follows it is swallowed. */
    justFired: () => Date.now() - firedAt.current < SWALLOW_MS,
  };
}
