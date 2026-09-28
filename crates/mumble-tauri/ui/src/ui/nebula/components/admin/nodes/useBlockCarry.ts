import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import type { GraphNode } from "./graph";
import type { BlockDef } from "./spec";

/**
 * Carrying a block from the browser onto the canvas.
 *
 * Pointer events rather than HTML5 drag-and-drop, which is the same decision
 * the server rail came to: the native API cannot drag an arbitrary element
 * without a drag image nobody can style, it fires no useful move events over a
 * transformed surface, and it is a second gesture system running beside the one
 * the canvas already uses for nodes, wires and rubber bands.
 *
 * The drag arms only after the pointer has actually travelled, so a click on a
 * card is still a click: the browser's `+ add` and the favourite chips keep
 * working, and nothing is dropped by somebody who merely pressed and released.
 */

/** What the canvas offers as somewhere to put a block down. */
export interface CanvasDrop<N extends GraphNode> {
  /** Whether a pointer there is over the canvas at all. */
  accepts(clientX: number, clientY: number): boolean;
  /** Put a block down there, and select it on arrival. */
  drop(block: BlockDef<N>, clientX: number, clientY: number): void;
}

/** A block under the pointer, on its way to the canvas. */
export interface Carry<N extends GraphNode> {
  readonly block: BlockDef<N>;
  readonly x: number;
  readonly y: number;
  /** Whether letting go here would put the block down. */
  readonly over: boolean;
}

/** How far the pointer travels before a press becomes a drag. */
const THRESHOLD = 4;

export function useBlockCarry<N extends GraphNode>(target: RefObject<CanvasDrop<N> | null>) {
  const [carry, setCarry] = useState<Carry<N> | null>(null);
  /** The press in flight, before it has moved far enough to be a drag. */
  const pressed = useRef<{ block: BlockDef<N>; x: number; y: number; armed: boolean } | null>(null);

  const start = useCallback((block: BlockDef<N>, event: ReactPointerEvent) => {
    if (event.button !== 0) return;
    pressed.current = { block, x: event.clientX, y: event.clientY, armed: false };
  }, []);

  // On the window rather than on the card: the pointer spends the whole of an
  // interesting drag somewhere else entirely, and a card that only heard about
  // its own events would lose the block the moment it left.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const held = pressed.current;
      if (!held) return;
      if (!held.armed) {
        const travelled = Math.abs(event.clientX - held.x) + Math.abs(event.clientY - held.y);
        if (travelled <= THRESHOLD) return;
        held.armed = true;
        holdSelection();
      }
      setCarry({
        block: held.block,
        x: event.clientX,
        y: event.clientY,
        over: target.current?.accepts(event.clientX, event.clientY) ?? false,
      });
    };

    const up = (event: PointerEvent) => {
      const held = pressed.current;
      pressed.current = null;
      setCarry(null);
      if (!held?.armed) return;
      releaseSelection();
      swallowClick();
      if (target.current?.accepts(event.clientX, event.clientY)) {
        target.current.drop(held.block, event.clientX, event.clientY);
      }
    };

    const cancel = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !pressed.current) return;
      pressed.current = null;
      releaseSelection();
      setCarry(null);
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      window.removeEventListener("keydown", cancel);
      // Unmounting mid-drag - the page navigating away under a carried block -
      // must not leave the whole document unselectable behind it.
      releaseSelection();
    };
  }, [target]);

  return { carry, start };
}

/**
 * Stop the document selecting text for as long as a block is in the air.
 *
 * The panel says `user-select: none` for itself and the canvas says it for
 * itself, but a drag crosses everything in between - the bar, the footer, the
 * page behind them - and a pointer held down over text is a text selection
 * everywhere that has not said otherwise. The few pixels before the drag armed
 * may already have caught some, so that is dropped too.
 */
function holdSelection(): void {
  window.getSelection()?.removeAllRanges();
  document.body.style.userSelect = "none";
}

function releaseSelection(): void {
  document.body.style.userSelect = "";
}

/**
 * Eat the click a finished drag leaves behind.
 *
 * A drag that starts and ends on the same chip still fires a click, and that
 * chip's click adds a block - so without this, dropping one on the canvas and
 * changing your mind halfway would leave two. The listener is removed on the
 * next tick either way, so a drag released over nothing cannot leave a trap set
 * for an unrelated click later.
 */
function swallowClick(): void {
  const eat = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener("click", eat, { capture: true, once: true });
  window.setTimeout(() => window.removeEventListener("click", eat, { capture: true }), 0);
}
