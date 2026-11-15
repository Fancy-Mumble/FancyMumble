import { describe, expect, it } from "vitest";
import { MAX_SCALE, MIN_SCALE, boundsOf, fitView, zoomAbout, type View } from "./useCanvasView";

const IDENTITY: View = { scale: 1, tx: 0, ty: 0 };

/** Where a world point lands on screen under `view`. */
const toScreen = (view: View, x: number, y: number) => ({
  x: x * view.scale + view.tx,
  y: y * view.scale + view.ty,
});

/** Where a screen point falls in the world under `view`. */
const toWorld = (view: View, x: number, y: number) => ({
  x: (x - view.tx) / view.scale,
  y: (y - view.ty) / view.scale,
});

describe("canvas view", () => {
  describe("zooming about the pointer", () => {
    it("keeps whatever is under the cursor under the cursor", () => {
      // The property the whole gesture is judged on. If this drifts, aiming at
      // a node and zooming walks it off the edge, which is the single thing
      // that makes a canvas feel broken.
      const before = { scale: 1, tx: -120, ty: 40 };
      const [px, py] = [300, 210];
      const anchored = toWorld(before, px, py);

      const after = zoomAbout(before, px, py, 1.15);
      const moved = toScreen(after, anchored.x, anchored.y);

      expect(moved.x).toBeCloseTo(px, 6);
      expect(moved.y).toBeCloseTo(py, 6);
    });

    it("holds the anchor across a long run of notches", () => {
      // Each step is exact, but they compose - a small bias would only show up
      // after a dozen of them, which is exactly how far a real scroll goes.
      let view: View = { scale: 1, tx: 15, ty: -7 };
      const [px, py] = [420, 130];
      const anchored = toWorld(view, px, py);

      for (let i = 0; i < 6; i++) view = zoomAbout(view, px, py, 1.15);
      for (let i = 0; i < 6; i++) view = zoomAbout(view, px, py, 1 / 1.15);

      const moved = toScreen(view, anchored.x, anchored.y);
      expect(moved.x).toBeCloseTo(px, 4);
      expect(moved.y).toBeCloseTo(py, 4);
      expect(view.scale).toBeCloseTo(1, 6);
    });

    it("never zooms in when asked to zoom out, even below the floor", () => {
      // A fit of a large graph leaves the view below MIN_SCALE. A fixed
      // floor would then pull it back up on the next zoom-out notch.
      const wide: View = { scale: 0.2, tx: 0, ty: 0 };
      expect(zoomAbout(wide, 100, 100, 1 / 1.15).scale).toBeLessThanOrEqual(wide.scale);
    });

    it("stops rather than inverting at the limits", () => {
      let out: View = IDENTITY;
      for (let i = 0; i < 60; i++) out = zoomAbout(out, 200, 200, 1 / 1.15);
      expect(out.scale).toBe(MIN_SCALE);

      let inward: View = IDENTITY;
      for (let i = 0; i < 60; i++) inward = zoomAbout(inward, 200, 200, 1.15);
      expect(inward.scale).toBe(MAX_SCALE);
    });

    it("does not move the view at all once it is clamped", () => {
      // A wheel notch that changes nothing must also pan nothing, or a canvas
      // already at full zoom slides sideways under the pointer.
      const clamped: View = { scale: MAX_SCALE, tx: 33, ty: 44 };
      expect(zoomAbout(clamped, 100, 100, 1.15)).toBe(clamped);
    });
  });

  describe("fitting", () => {
    it("centres the drawing in the viewport", () => {
      const bounds = { minX: 0, minY: 0, maxX: 400, maxY: 200 };
      const view = fitView(1000, 600, bounds);

      const topLeft = toScreen(view, bounds.minX, bounds.minY);
      const bottomRight = toScreen(view, bounds.maxX, bounds.maxY);
      // Equal margins on both axes is what "centred" means here.
      expect(topLeft.x).toBeCloseTo(1000 - bottomRight.x, 6);
      expect(topLeft.y).toBeCloseTo(600 - bottomRight.y, 6);
    });

    it("frames a drawing that does not start at the origin", () => {
      // Nodes are dragged around, so the graph rarely sits at 0,0 - a fit that
      // ignored the offset would centre empty canvas.
      const bounds = { minX: 900, minY: -300, maxX: 1300, maxY: -100 };
      const view = fitView(1000, 600, bounds);
      const topLeft = toScreen(view, bounds.minX, bounds.minY);
      const bottomRight = toScreen(view, bounds.maxX, bounds.maxY);
      expect(topLeft.x).toBeCloseTo(1000 - bottomRight.x, 6);
      expect(topLeft.y).toBeCloseTo(600 - bottomRight.y, 6);
    });

    it("does not magnify a small drawing past the zoom ceiling", () => {
      const view = fitView(1000, 600, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
      expect(view.scale).toBeLessThanOrEqual(MAX_SCALE);
    });

    it("leaves everything inside the viewport", () => {
      const bounds = { minX: -50, minY: -50, maxX: 2400, maxY: 1800 };
      const view = fitView(1000, 600, bounds);
      const topLeft = toScreen(view, bounds.minX, bounds.minY);
      const bottomRight = toScreen(view, bounds.maxX, bounds.maxY);
      expect(topLeft.x).toBeGreaterThanOrEqual(0);
      expect(topLeft.y).toBeGreaterThanOrEqual(0);
      expect(bottomRight.x).toBeLessThanOrEqual(1000);
      expect(bottomRight.y).toBeLessThanOrEqual(600);
    });
  });

  describe("bounds", () => {
    it("covers every node and its size", () => {
      const nodes = [
        { x: 10, y: 20 },
        { x: 300, y: 5 },
      ];
      const bounds = boundsOf(nodes, () => ({ width: 200, height: 80 }));
      expect(bounds).toEqual({ minX: 10, minY: 5, maxX: 500, maxY: 100 });
    });

    it("answers something usable for an empty canvas", () => {
      // fitView divides by the extent, so an empty graph must not hand it a
      // zero - or a fresh canvas fits to NaN and renders nothing.
      const bounds = boundsOf([], () => ({ width: 0, height: 0 }));
      const view = fitView(800, 600, bounds);
      expect(Number.isFinite(view.scale)).toBe(true);
      expect(Number.isFinite(view.tx)).toBe(true);
      expect(Number.isFinite(view.ty)).toBe(true);
    });
  });
});
