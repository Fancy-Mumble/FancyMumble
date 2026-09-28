import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRowHover } from "./rowHover";

/**
 * Two messages, one above the other, each drawing its strip when hovered.
 *
 * The rows are given boxes by hand because jsdom lays nothing out, and the
 * whole of this is a question about where the pointer is: the corridor a row
 * keeps its strip through is measured off the row's own rectangle.
 */
const BOXES: Record<string, DOMRect> = {
  // The upper message, and the lower one whose strip is drawn over it.
  upper: { x: 0, y: 60, width: 600, height: 40, top: 60, bottom: 100, left: 0, right: 600 } as DOMRect,
  lower: { x: 0, y: 110, width: 600, height: 40, top: 110, bottom: 150, left: 0, right: 600 } as DOMRect,
};

function Row({ name }: Readonly<{ name: string }>) {
  const { hovered, ref, onMouseEnter, onMouseLeave } = useRowHover();
  return (
    <div
      data-testid={name}
      ref={(node) => {
        if (node) node.getBoundingClientRect = () => BOXES[name]!;
        ref.current = node;
      }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {hovered && <span data-testid={`${name}-strip`} />}
    </div>
  );
}

const strip = (name: string) => screen.queryByTestId(`${name}-strip`);
const at = (x: number, y: number) => ({ clientX: x, clientY: y });

describe("useRowHover", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    render(
      <>
        <Row name="upper" />
        <Row name="lower" />
      </>,
    );
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const tick = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms);
    });

  it("keeps the strip on the row it belongs to while the pointer crosses to it", () => {
    fireEvent.mouseEnter(screen.getByTestId("lower"), at(400, 130));
    expect(strip("lower")).toBeTruthy();

    // Up and to the left, which for a strip drawn above the row means over the
    // message above: that message must not take the hover out from under it.
    fireEvent.mouseLeave(screen.getByTestId("lower"));
    fireEvent.mouseEnter(screen.getByTestId("upper"), at(300, 95));
    expect(strip("lower")).toBeTruthy();
    expect(strip("upper")).toBeNull();

    // Still travelling, however slowly: each move puts the clock back.
    for (let step = 0; step < 10; step += 1) {
      tick(200);
      fireEvent.mouseMove(document, at(280 - step * 10, 92));
    }
    expect(strip("lower")).toBeTruthy();
  });

  it("hands the strip over to a message the pointer has settled on", () => {
    fireEvent.mouseEnter(screen.getByTestId("lower"), at(400, 130));
    fireEvent.mouseLeave(screen.getByTestId("lower"));
    fireEvent.mouseEnter(screen.getByTestId("upper"), at(300, 95));

    // The reader was not reaching for anything; they stopped to read.
    tick(1_000);
    expect(strip("lower")).toBeNull();
    expect(strip("upper")).toBeTruthy();
  });

  it("gives up the strip at once when the pointer leaves the corridor", () => {
    fireEvent.mouseEnter(screen.getByTestId("lower"), at(400, 130));
    fireEvent.mouseLeave(screen.getByTestId("lower"));

    // Nowhere near the strip: a pill left hanging over a message for a third of
    // a second after the pointer has gone elsewhere is a pill on the wrong row.
    fireEvent.mouseMove(document, at(400, 400));
    expect(strip("lower")).toBeNull();
    expect(strip("upper")).toBeNull();
  });

  it("gives it straight to a message entered well away from the corridor", () => {
    fireEvent.mouseEnter(screen.getByTestId("lower"), at(400, 130));
    fireEvent.mouseLeave(screen.getByTestId("lower"));
    fireEvent.mouseEnter(screen.getByTestId("upper"), at(300, 62));

    expect(strip("upper")).toBeTruthy();
    expect(strip("lower")).toBeNull();
  });
});
