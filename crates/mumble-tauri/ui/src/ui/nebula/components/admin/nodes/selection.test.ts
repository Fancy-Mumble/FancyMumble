import { describe, expect, it } from "vitest";
import { caughtBy, type NodeBox } from "./NodeCanvas";

/** Three nodes in a row, the middle one straddling the others' gap. */
const BOXES: NodeBox[] = [
  { id: "left", x1: 0, y1: 0, x2: 100, y2: 60 },
  { id: "middle", x1: 150, y1: 20, x2: 250, y2: 80 },
  { id: "right", x1: 400, y1: 0, x2: 500, y2: 60 },
];

const band = (fromX: number, fromY: number, toX: number, toY: number) => ({
  from: { x: fromX, y: fromY },
  to: { x: toX, y: toY },
});

describe("rubber band", () => {
  describe("dragged left to right — window", () => {
    it("catches only what is wholly inside", () => {
      // The point of the window selection: pulling a box over a crowded canvas
      // takes the things you drew a box around, not everything it brushed.
      const caught = caughtBy(band(-10, -10, 260, 100), BOXES);
      expect([...caught].sort()).toEqual(["left", "middle"]);
    });

    it("leaves a node that is merely clipped by the edge", () => {
      // The band stops at 200, so `middle` (150..250) is half covered.
      const caught = caughtBy(band(-10, -10, 200, 100), BOXES);
      expect([...caught]).toEqual(["left"]);
    });

    it("catches a node the band exactly matches", () => {
      // Flush edges count as inside; a band drawn precisely round something
      // that then refused to select it would read as the band being broken.
      const caught = caughtBy(band(0, 0, 100, 60), BOXES);
      expect([...caught]).toEqual(["left"]);
    });
  });

  describe("dragged right to left — crossing", () => {
    it("catches anything it touches", () => {
      // Same rectangle as the window case, drawn the other way: `middle` is
      // only clipped, and this time that is enough.
      const caught = caughtBy(band(200, 100, -10, -10), BOXES);
      expect([...caught].sort()).toEqual(["left", "middle"]);
    });

    it("sweeps a line across a row without enclosing anything", () => {
      // The gesture this rule exists for: a thin swipe through several nodes.
      const caught = caughtBy(band(450, 30, 10, 30), BOXES);
      expect([...caught].sort()).toEqual(["left", "middle", "right"]);
    });

    it("still misses what it does not reach", () => {
      const caught = caughtBy(band(300, 30, 260, 30), BOXES);
      expect([...caught]).toEqual([]);
    });
  });

  it("catches nothing from a band with no area", () => {
    // A plain click on empty canvas is a zero-size band, and it must clear the
    // selection rather than select whatever happens to sit under the pointer.
    expect([...caughtBy(band(50, 30, 50, 30), BOXES)]).toEqual([]);
  });

  it("reads the drag direction, not the corner it ended at", () => {
    // Up-and-left is still right-to-left, so it crosses; down-and-left too.
    const up = caughtBy(band(200, 100, -10, -10), BOXES);
    const down = caughtBy(band(200, -10, -10, 100), BOXES);
    expect([...up].sort()).toEqual([...down].sort());
  });
});
