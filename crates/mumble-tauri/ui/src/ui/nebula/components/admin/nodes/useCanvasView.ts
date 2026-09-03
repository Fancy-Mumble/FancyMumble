import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/**
 * Pan and zoom for a node canvas, with KiCad's bindings.
 *
 * KiCad's convention is worth copying rather than inventing around, because it
 * is what anyone who draws graphs for a living already has in their hands: the
 * **wheel zooms** rather than scrolls, and it zooms *at the pointer* so the
 * thing you are looking at stays under it. Every other binding follows from
 * that one - the wheel is spent, so panning moves to the middle button and to
 * the wheel under a modifier.
 *
 * | Gesture | Does |
 * |---|---|
 * | Wheel | Zoom about the pointer |
 * | Ctrl + wheel | Pan horizontally |
 * | Shift + wheel | Pan vertically |
 * | Middle drag | Pan |
 * | Right drag | Pan |
 * | `Home` | Fit everything on screen |
 * | `+` / `-` | Zoom about the centre |
 *
 * A touchscreen has none of those - no wheel, no middle button, no right
 * button - so it gets the gestures every map and canvas on a phone already
 * uses, and they are not a translation of the mouse bindings:
 *
 * | Gesture | Does |
 * |---|---|
 * | One finger on empty canvas | Pan |
 * | Two fingers | Pinch to zoom, and pan with the midpoint |
 * | One finger on a node's header | Drag the node, as a mouse does |
 * | Long press on empty canvas | The add menu |
 *
 * One finger panning is the part worth stating: with a mouse, a left drag on
 * empty canvas is a rubber-band selection, and on a touchscreen it is a pan.
 * Sweeping to select is a mouse idiom, and a finger that panned only once it
 * found a second finger would make the canvas feel stuck.
 *
 * This hook owns the viewport and nothing else. It does not know what is being
 * drawn, so the same hook serves any dialect the editor grows.
 */

/** A point in world coordinates - the space nodes and wires are laid out in. */
export interface Point {
  x: number;
  y: number;
}

/** What has to fit, in world coordinates. */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How far in and out the view goes.
 *
 * Bounded rather than free: past about a third, a node is a coloured smudge
 * with no readable label, and past three the canvas is one field and a wire
 * going off-screen. Both are places a scroll wheel reaches by accident and
 * neither shows anything, so the wheel simply stops there.
 */
export const MIN_SCALE = 0.35;
export const MAX_SCALE = 3;

/** Wheel notches are coarse; this is the per-notch zoom factor. */
const ZOOM_STEP = 1.15;
/** How far a modified wheel notch pans, in screen pixels. */
const PAN_STEP = 90;
/** Space left around the drawing when fitting it to the viewport. */
const FIT_MARGIN = 48;

export interface CanvasView {
  scale: number;
  /** Translation in screen pixels, applied before the scale. */
  tx: number;
  ty: number;
  /** For the transformed layer's `transform`. */
  transform: string;
  /** Whether a pan gesture is in flight, for the cursor. */
  panning: boolean;
  /** A pointer position, in world coordinates. */
  toWorld: (clientX: number, clientY: number) => Point;
  /** Frame `bounds` in the viewport. */
  fit: (bounds: Bounds) => void;
  /**
   * Start panning from this press, whatever button or finger made it.
   *
   * For the canvas to call when a press landed somewhere it has decided means
   * "move the view" - a finger on empty canvas. What was under the pointer is
   * a judgement this hook cannot make, so it takes the instruction instead.
   */
  beginPan: (event: React.PointerEvent) => void;
  /** Back to 1:1 at the origin. */
  reset: () => void;
  /** Spread onto the viewport element. */
  handlers: {
    onPointerDown: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerUp: (event: React.PointerEvent) => void;
    onContextMenu: (event: React.MouseEvent) => void;
  };
}

/** Where the viewport is looking. Screen translation, then scale. */
export interface View {
  scale: number;
  tx: number;
  ty: number;
}

/**
 * Zoom about a point on screen, keeping whatever is under it there.
 *
 * That fixed point is the whole feel of it. Zooming about the viewport
 * centre means aiming at a node, zooming, and finding it has slid off the
 * edge - which is why every drawing tool that gets this right anchors on the
 * pointer instead.
 *
 * `screenX`/`screenY` are relative to the viewport, not the page.
 */
export function zoomAbout(view: View, screenX: number, screenY: number, factor: number): View {
  // The floor gives way to a view that is already below it, which a fit
  // of a large graph produces. Clamping to a fixed floor there would make
  // the first zoom-*out* notch jump the view closer, which is the one
  // thing a zoom control must never do.
  const floor = Math.min(MIN_SCALE, view.scale);
  const scale = clamp(view.scale * factor, floor, MAX_SCALE);
  if (scale === view.scale) return view;
  // The world point under the cursor, before and after, is the same one.
  const worldX = (screenX - view.tx) / view.scale;
  const worldY = (screenY - view.ty) / view.scale;
  return { scale, tx: screenX - worldX * scale, ty: screenY - worldY * scale };
}

/** The view that frames `bounds` in a viewport of `width` x `height`. */
export function fitView(width: number, height: number, bounds: Bounds): View {
  const drawn = Math.max(1, bounds.maxX - bounds.minX);
  const tall = Math.max(1, bounds.maxY - bounds.minY);
  // Only the ceiling applies. `MIN_SCALE` exists to stop a wheel running
  // away by accident; a fit is somebody asking to see the whole drawing,
  // and refusing to go far enough out would answer that by leaving half
  // of it off-screen - which looks exactly like the fit not working.
  const scale = Math.min((width - FIT_MARGIN * 2) / drawn, (height - FIT_MARGIN * 2) / tall, MAX_SCALE);
  // Centred, not corner-anchored: a drawing narrower than the viewport
  // pinned to the top-left reads as though it failed to fit.
  return {
    scale,
    tx: (width - drawn * scale) / 2 - bounds.minX * scale,
    ty: (height - tall * scale) / 2 - bounds.minY * scale,
  };
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * @param viewport The element the gestures are measured against. The
 * transformed layer must be its child, with `transform-origin: 0 0`.
 */
export function useCanvasView(
  viewport: RefObject<HTMLElement | null>,
  /** What `Home` should frame. Asked at the moment the key is pressed, so a
   *  graph that has grown since mount still fits. */
  getBounds?: () => Bounds,
): CanvasView {
  const [view, setView] = useState<View>({ scale: 1, tx: 0, ty: 0 });
  const [panning, setPanning] = useState(false);
  /** The pointer that owns the pan, and where it was last seen. */
  const pan = useRef<{ id: number; x: number; y: number } | null>(null);

  const toWorld = useCallback(
    (clientX: number, clientY: number): Point => {
      const box = viewport.current?.getBoundingClientRect();
      if (!box) return { x: 0, y: 0 };
      return {
        x: (clientX - box.left - view.tx) / view.scale,
        y: (clientY - box.top - view.ty) / view.scale,
      };
    },
    [viewport, view.tx, view.ty, view.scale],
  );

  /**
   * The fingers currently down, so a pinch can be measured between two of them.
   *
   * A ref rather than state: it changes on every pointer event of a gesture and
   * nothing renders from it - the view does, and that is set separately.
   */
  const touches = useRef(new Map<number, Point>());
  /** The span the fingers had at the last frame, which a pinch is measured against. */
  const pinch = useRef<Span | null>(null);

  const zoomAt = useCallback((screenX: number, screenY: number, factor: number) => {
    setView((current) => zoomAbout(current, screenX, screenY, factor));
  }, []);

  // Attached natively rather than through React's `onWheel`, which is passive:
  // `preventDefault` is ignored there, and the page scrolls out from under the
  // zoom on every notch.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      // KiCad's modifiers. Note the trackpad wrinkle: a pinch arrives as a
      // wheel event with `ctrlKey` set, so on a trackpad pinch pans instead of
      // zooming. That is what the binding says, and honouring the modifier is
      // more predictable than guessing which device sent the event.
      if (event.ctrlKey || event.shiftKey) {
        const distance = Math.sign(event.deltaY || event.deltaX) * PAN_STEP;
        setView((current) =>
          event.ctrlKey
            ? { ...current, tx: current.tx - distance }
            : { ...current, ty: current.ty - distance },
        );
        return;
      }
      const box = element.getBoundingClientRect();
      const factor = event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAt(event.clientX - box.left, event.clientY - box.top, factor);
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [viewport, zoomAt]);

  const fit = useCallback(
    (bounds: Bounds) => {
      const box = viewport.current?.getBoundingClientRect();
      if (box) setView(fitView(box.width, box.height, bounds));
    },
    [viewport],
  );

  const reset = useCallback(() => setView({ scale: 1, tx: 0, ty: 0 }), []);

  // Keys are bound on the viewport rather than the window: a canvas is one
  // surface among several on the page, and Home belongs to whichever the
  // pointer is over, not to whatever happens to have focus.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const onKey = (event: KeyboardEvent) => {
      const box = element.getBoundingClientRect();
      if (event.key === "Home") {
        event.preventDefault();
        const bounds = getBounds?.();
        if (bounds) setView(fitView(box.width, box.height, bounds));
      } else if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        zoomAt(box.width / 2, box.height / 2, ZOOM_STEP);
      } else if (event.key === "-") {
        event.preventDefault();
        zoomAt(box.width / 2, box.height / 2, 1 / ZOOM_STEP);
      }
    };
    element.addEventListener("keydown", onKey);
    return () => element.removeEventListener("keydown", onKey);
  }, [viewport, zoomAt, getBounds]);

  /** Middle or right button: the two KiCad pans. Left is the editor's. */
  const isPanButton = (button: number) => button === 1 || button === 2;

  const beginPan = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    pan.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setPanning(true);
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType === "touch") {
        touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        // The second finger takes over from whatever the first was doing. A
        // pinch that had to begin with both fingers landing in the same frame
        // is a pinch nobody can perform.
        if (touches.current.size === 2) {
          pan.current = null;
          setPanning(false);
          pinch.current = spanOf(touches.current);
          event.preventDefault();
        }
        return;
      }
      if (!isPanButton(event.button)) return;
      beginPan(event);
    },
    [beginPan],
  );

  const movePan = useCallback((event: React.PointerEvent) => {
    const held = pan.current;
    if (!held || held.id !== event.pointerId) return;
    const dx = event.clientX - held.x;
    const dy = event.clientY - held.y;
    pan.current = { id: held.id, x: event.clientX, y: event.clientY };
    // Panning moves the view by screen pixels, never by world units: the
    // drawing has to keep up with the pointer exactly, at every zoom.
    setView((current) => ({ ...current, tx: current.tx + dx, ty: current.ty + dy }));
  }, []);

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (event.pointerType !== "touch" || !touches.current.has(event.pointerId)) {
        movePan(event);
        return;
      }
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      const held = pinch.current;
      if (touches.current.size < 2 || !held || held.distance === 0) {
        movePan(event);
        return;
      }

      const box = viewport.current?.getBoundingClientRect();
      if (!box) return;
      const now = spanOf(touches.current);
      event.preventDefault();
      setView((current) => {
        // Zoom about the midpoint the fingers had, so whatever is between them
        // stays between them, then carry the view by however far that midpoint
        // travelled - which is what makes a pinch pan as well as zoom.
        const zoomed = zoomAbout(
          current,
          held.centre.x - box.left,
          held.centre.y - box.top,
          now.distance / held.distance,
        );
        return {
          ...zoomed,
          tx: zoomed.tx + (now.centre.x - held.centre.x),
          ty: zoomed.ty + (now.centre.y - held.centre.y),
        };
      });
      pinch.current = now;
    },
    [movePan, viewport],
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    if (touches.current.delete(event.pointerId) && touches.current.size < 2) {
      // Lifting one of two fingers ends the pinch rather than continuing it
      // from a span of one: the remaining finger is a pan, and re-measuring
      // would make the view jump the moment somebody let go.
      pinch.current = null;
    }
    if (pan.current?.id !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
  }, []);

  // A right-drag that panned must not also open a menu when it is released.
  const onContextMenu = useCallback((event: React.MouseEvent) => event.preventDefault(), []);

  return {
    scale: view.scale,
    tx: view.tx,
    ty: view.ty,
    transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
    panning,
    toWorld,
    fit,
    reset,
    beginPan,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onContextMenu },
  };
}

/** How far apart two fingers are, and where their midpoint is. */
interface Span {
  distance: number;
  centre: Point;
}

/**
 * The span of the first two fingers down.
 *
 * The first two, deliberately, and not all of them: a third finger landing
 * mid-pinch would otherwise move the midpoint and jump the view, and nobody
 * putting a third finger on the glass meant to zoom somewhere else.
 */
function spanOf(touches: ReadonlyMap<number, Point>): Span {
  const [a, b] = [...touches.values()];
  if (!a || !b) return { distance: 0, centre: a ?? { x: 0, y: 0 } };
  return {
    distance: Math.hypot(b.x - a.x, b.y - a.y),
    centre: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  };
}

/** What the drawing occupies, for [`CanvasView.fit`]. */
export function boundsOf(
  nodes: readonly { x: number; y: number }[],
  sizeOf: (node: { x: number; y: number }) => { width: number; height: number },
): Bounds {
  if (nodes.length === 0) return { minX: 0, minY: 0, maxX: 1, maxY: 1 };
  return nodes.reduce<Bounds>(
    (acc, node) => {
      const { width, height } = sizeOf(node);
      return {
        minX: Math.min(acc.minX, node.x),
        minY: Math.min(acc.minY, node.y),
        maxX: Math.max(acc.maxX, node.x + width),
        maxY: Math.max(acc.maxY, node.y + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity },
  );
}
