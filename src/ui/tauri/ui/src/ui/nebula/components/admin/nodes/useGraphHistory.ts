import { useCallback, useRef, useState } from "react";

/**
 * Undo and redo for whatever a page is editing.
 *
 * The node canvas had none, and that is the thing that makes an operator
 * cautious with it: every gesture on a graph is destructive - a mis-drag
 * scatters a selection, Delete takes a node and its wires, a template can
 * replace the canvas - and without a way back, the safe move is to not touch
 * it. Which is the opposite of what a canvas is for.
 *
 * Snapshots rather than a command log, and deliberately: a welcome graph is
 * some tens of small objects, so a copy of one costs nothing worth measuring,
 * and the alternative - an inverse for every operation - is a second
 * implementation of every edit that has to be kept in step with the first
 * forever. The one thing snapshots need is a rule about *when* to take one.
 *
 * ## Coalescing
 *
 * A drag calls `set` on every pointer move, and typing calls it on every
 * keystroke. One entry per call would make undo step a node back across the
 * canvas a pixel at a time. So a change arriving within `QUIET` of the last one
 * replaces the present instead of pushing it: a drag becomes one entry, a burst
 * of typing becomes one entry, and a pause between them starts a new one.
 *
 * That is a heuristic, and it is the right kind: being wrong means an operator
 * undoes slightly more or slightly less than they expected and can press it
 * again. There is no correct answer available without every caller declaring
 * its own transaction boundaries, which is a burden on every call site to fix a
 * problem nobody has.
 */

/** How long a pause has to be before the next change is its own undo step. */
const QUIET = 600;

export interface History<T> {
  readonly value: T;
  /** Change it, recording an undo step where enough time has passed. */
  readonly set: (next: T) => void;
  /**
   * Change it *without* recording a step, ever.
   *
   * For a change the operator did not make - a document arriving from the
   * server - which must not become a thing they can "undo" back to whatever
   * happened to be on screen while it loaded.
   */
  readonly reset: (next: T) => void;
  readonly undo: () => void;
  readonly redo: () => void;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

export function useGraphHistory<T>(initial: T | (() => T)): History<T> {
  const [past, setPast] = useState<T[]>([]);
  const [value, setValue] = useState<T>(initial);
  const [future, setFuture] = useState<T[]>([]);
  /** When the last change landed, for the coalescing rule above. */
  const last = useRef(0);

  const set = useCallback((next: T) => {
    const now = Date.now();
    const continuing = now - last.current < QUIET;
    last.current = now;
    setValue((current) => {
      // The *previous* value is what goes on the stack, and only when this
      // change starts a new step: mid-drag, the step already holds where the
      // node was before the drag began, which is where undo should land.
      if (!continuing) setPast((stack) => [...stack, current]);
      return next;
    });
    // Anything done after an undo abandons what was undone. Keeping it would
    // mean redo restoring a state that no longer follows from what is on
    // screen.
    setFuture([]);
  }, []);

  const reset = useCallback((next: T) => {
    last.current = 0;
    setPast([]);
    setFuture([]);
    setValue(next);
  }, []);

  const undo = useCallback(() => {
    // Broken here, so the step being undone cannot be coalesced into.
    last.current = 0;
    setPast((stack) => {
      if (stack.length === 0) return stack;
      setValue((current) => {
        setFuture((ahead) => [current, ...ahead]);
        return stack[stack.length - 1];
      });
      return stack.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    last.current = 0;
    setFuture((ahead) => {
      if (ahead.length === 0) return ahead;
      setValue((current) => {
        setPast((stack) => [...stack, current]);
        return ahead[0];
      });
      return ahead.slice(1);
    });
  }, []);

  return { value, set, reset, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0 };
}
