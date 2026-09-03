import { describe as suite, expect, it } from "vitest";
import { TOLERANCE, snapTo, snapWidth } from "./snapping";
import type { Block } from "./design";

const block = (id: string, fields: Partial<Block> = {}): Block => ({
  id,
  type: "text",
  x: 100,
  y: 100,
  w: 200,
  ...fields,
});

const SHEET = 520;

suite("lining up with what is already there", () => {
  it("snaps a left edge to another block's left edge", () => {
    const other = block("other", { x: 60, y: 40 });
    const moving = block("moving", { x: 63, y: 300 });
    const landed = snapTo(moving, 63, 300, [other], SHEET, true);
    expect(landed.x).toBe(60);
  });

  it("centres two blocks of different widths on each other", () => {
    // The thing a grid cannot do: both of these are on the grid already and
    // still not centred, which is the difference between a design that looks
    // made and one that looks nearly made.
    const other = block("other", { x: 60, y: 40, w: 400 }); // centre 260
    const moving = block("moving", { w: 100 });
    const landed = snapTo(moving, 208, 300, [other], SHEET, true);
    expect(landed.x + 100 / 2).toBe(260);
  });

  it("snaps to the sheet's own vertical centre line", () => {
    // What most designs are built around, and the sheet is the only thing that
    // offers it before there is anything else on the page.
    const moving = block("moving", { w: 200 });
    const landed = snapTo(moving, 158, 300, [], SHEET, true);
    expect(landed.x + 100).toBe(SHEET / 2);
  });

  it("snaps to the sheet's own horizontal centre line", () => {
    // The other half of the pair. A sheet is as tall as what is on it, so the
    // height is passed in rather than stored - and the line moves as the
    // design grows, which is what centring against it means.
    const moving = block("moving", { h: 100 });
    const landed = snapTo(moving, 40, 447, [], SHEET, true, 1000);
    expect(landed.y + 50).toBe(500);
  });

  it("has no horizontal centre before the sheet has a height", () => {
    const landed = snapTo(block("moving"), 40, 251, [], SHEET, true);
    expect(landed.y).toBe(252);
  });

  it("snaps tops to tops", () => {
    const other = block("other", { x: 320, y: 240 });
    const landed = snapTo(block("moving"), 40, 243, [other], SHEET, true);
    expect(landed.y).toBe(240);
  });

  it("falls back to the grid where nothing is in range", () => {
    const landed = snapTo(block("moving"), 102, 251, [], SHEET, true);
    expect(landed.x).toBe(104);
    expect(landed.y).toBe(252);
  });

  it("leaves a position alone when the grid is off and nothing catches", () => {
    const landed = snapTo(block("moving"), 103, 251, [], SHEET, false);
    expect(landed.x).toBe(103);
    expect(landed.y).toBe(251);
  });

  it("takes the nearest line when two are in range", () => {
    const near = block("near", { x: 100 });
    const far = block("far", { x: 104 });
    const landed = snapTo(block("moving"), 101, 400, [near, far], SHEET, true);
    expect(landed.x).toBe(100);
  });

  it("does not reach past its tolerance", () => {
    const other = block("other", { x: 60 });
    const landed = snapTo(block("moving"), 60 + TOLERANCE + 1, 400, [other], SHEET, true);
    expect(landed.x).not.toBe(60);
  });

  it("never puts a block off the top or the left of the sheet", () => {
    const landed = snapTo(block("moving"), -40, -40, [], SHEET, true);
    expect(landed.x).toBe(0);
    expect(landed.y).toBe(0);
  });
});

suite("the lines it draws", () => {
  it("says which line caught it, so nothing moves for an invisible reason", () => {
    const other = block("other", { x: 60, y: 40 });
    const landed = snapTo(block("moving"), 63, 300, [other], SHEET, true);
    const vertical = landed.guides.find((guide) => guide.axis === "x");
    expect(vertical?.at).toBe(60);
  });

  it("draws the line across both of the things it aligned", () => {
    // A rule that stopped at the block being dragged would not show what it
    // lined up *with*.
    const other = block("other", { x: 60, y: 40, h: 30 });
    const landed = snapTo(block("moving"), 63, 300, [other], SHEET, true);
    const vertical = landed.guides.find((guide) => guide.axis === "x");
    expect(vertical?.sheet).toBe(false);
    expect(vertical?.from).toBe(40);
    expect(vertical?.to).toBeGreaterThanOrEqual(300);
  });

  it("runs a sheet line the whole way down the sheet", () => {
    // A page guide is a property of the page. Drawn over only the blocks that
    // happen to share it, it stops halfway and reads as a stray rule - which
    // is exactly what it looked like.
    const other = block("other", { x: 216, y: 28, w: 88, h: 88 }); // also centred
    const moving = block("moving", { w: 200 });
    const landed = snapTo(moving, 158, 300, [other], SHEET, true, 900);
    const vertical = landed.guides.find((guide) => guide.axis === "x");
    expect(vertical?.sheet).toBe(true);
    expect(vertical?.from).toBe(0);
    expect(vertical?.to).toBe(900);
  });

  it("draws nothing when nothing caught", () => {
    expect(snapTo(block("moving"), 400, 400, [], SHEET, true).guides).toEqual([]);
  });

  it("can catch on both axes at once", () => {
    const other = block("other", { x: 60, y: 240 });
    const landed = snapTo(block("moving"), 62, 242, [other], SHEET, true);
    expect(landed.guides.map((guide) => guide.axis).sort()).toEqual(["x", "y"]);
  });
});

suite("resizing", () => {
  it("snaps a right edge to another block's right edge", () => {
    const other = block("other", { x: 60, w: 300 }); // right edge 360
    const moving = block("moving", { x: 60 });
    const landed = snapWidth(moving, 297, [other], SHEET, true);
    expect(moving.x + landed.w).toBe(360);
  });

  it("snaps a right edge to the sheet's edge", () => {
    const moving = block("moving", { x: 44 });
    const landed = snapWidth(moving, SHEET - 44 - 3, [], SHEET, true);
    expect(moving.x + landed.w).toBe(SHEET);
  });

  it("never lets a block be dragged smaller than it can be seen", () => {
    expect(snapWidth(block("moving"), 4, [], SHEET, true).w).toBe(48);
  });

  it("falls back to the grid, and says no line caught", () => {
    const landed = snapWidth(block("moving", { x: 0 }), 202, [], SHEET, true);
    expect(landed.w).toBe(204);
    expect(landed.guides).toEqual([]);
  });
});
