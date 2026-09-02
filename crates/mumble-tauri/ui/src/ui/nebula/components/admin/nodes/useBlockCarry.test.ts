/**
 * Carrying a block from the browser to the canvas.
 *
 * The gesture has to coexist with a click on the same element - the chips add
 * on click and the cards have a `+ add` - so what is pinned here is the seam
 * between the two: how far a press travels before it stops being a click, and
 * that a release anywhere the canvas does not want puts nothing down.
 */

import { act, renderHook } from "@testing-library/react";
import { describe as suite, expect, it, vi } from "vitest";
import type { PointerEvent as ReactPointerEvent } from "react";
import { useBlockCarry, type CanvasDrop } from "./useBlockCarry";
import type { GraphNode } from "./graph";
import type { BlockDef } from "./spec";

interface Node extends GraphNode {
  kind: "thing";
}

const BLOCK: BlockDef<Node> = {
  id: "thing",
  label: "Thing",
  description: "A thing.",
  category: "Things",
  tone: "accent",
  create: (x, y) => ({ id: "n1", kind: "thing", x, y }),
  inputs: [],
  outputs: [],
};

/** A canvas that owns the rectangle from (100,100) to (400,400). */
function target() {
  const drop = vi.fn<(block: BlockDef<Node>, x: number, y: number) => void>();
  const api: CanvasDrop<Node> = {
    accepts: (x, y) => x >= 100 && x <= 400 && y >= 100 && y <= 400,
    drop,
  };
  return { drop, ref: { current: api } };
}

const press = (x: number, y: number) => ({ button: 0, clientX: x, clientY: y }) as ReactPointerEvent;

const move = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointermove", { clientX: x, clientY: y }));
  });

const release = (x: number, y: number) =>
  act(() => {
    window.dispatchEvent(new MouseEvent("pointerup", { clientX: x, clientY: y }));
  });

suite("carrying a block", () => {
  it("is not a drag until the pointer has actually travelled", () => {
    const { drop, ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(12, 11);
    // Two pixels is somebody clicking, not somebody dragging: nothing is
    // being carried and there is no ghost to draw.
    expect(result.current.carry).toBeNull();

    release(12, 11);
    expect(drop).not.toHaveBeenCalled();
  });

  it("picks the block up once it does, and says where it may be put down", () => {
    const { ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(60, 40);
    expect(result.current.carry?.block.id).toBe("thing");
    // Still over the browser, so letting go here would do nothing.
    expect(result.current.carry?.over).toBe(false);

    move(200, 200);
    expect(result.current.carry?.over).toBe(true);
  });

  it("puts it down where it was released", () => {
    const { drop, ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(200, 200);
    release(260, 180);

    expect(drop).toHaveBeenCalledWith(BLOCK, 260, 180);
    // The ghost goes with the release, whatever came of it.
    expect(result.current.carry).toBeNull();
  });

  it("drops nothing when it is released anywhere else", () => {
    const { drop, ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(200, 200);
    release(20, 20);

    expect(drop).not.toHaveBeenCalled();
  });

  it("gives the block back when the drag is abandoned", () => {
    const { drop, ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(200, 200);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.carry).toBeNull();

    // And the release that follows is not a late drop.
    release(200, 200);
    expect(drop).not.toHaveBeenCalled();
  });

  it("ignores a press that is not the left button", () => {
    const { drop, ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    // Right-drag pans the canvas; starting a carry with it would fight that.
    act(() => result.current.start(BLOCK, { button: 2, clientX: 10, clientY: 10 } as ReactPointerEvent));
    move(200, 200);
    release(200, 200);

    expect(result.current.carry).toBeNull();
    expect(drop).not.toHaveBeenCalled();
  });

  it("stops the document selecting text while the block is in the air", () => {
    const { ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    // Still a click as far as anyone knows, so nothing is suppressed yet.
    expect(document.body.style.userSelect).toBe("");

    move(200, 200);
    // Otherwise a drag across the browser sweeps every description it passes
    // into a selection, and the panel is unusable.
    expect(document.body.style.userSelect).toBe("none");

    release(200, 200);
    expect(document.body.style.userSelect).toBe("");
  });

  it("gives selection back when the drag is abandoned rather than released", () => {
    const { ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(200, 200);
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(document.body.style.userSelect).toBe("");
  });

  it("eats the click a finished drag leaves on the chip it started from", () => {
    const { ref } = target();
    const { result } = renderHook(() => useBlockCarry(ref));
    const clicked = vi.fn();
    window.addEventListener("click", clicked);

    act(() => result.current.start(BLOCK, press(10, 10)));
    move(200, 200);
    release(200, 200);
    act(() => {
      window.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Otherwise a chip dragged onto the canvas would also add one the way a
    // clicked chip does, and one gesture would leave two nodes.
    expect(clicked).not.toHaveBeenCalled();
    window.removeEventListener("click", clicked);
  });
});
