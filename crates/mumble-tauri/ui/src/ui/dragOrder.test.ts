import { describe, expect, it } from "vitest";
import { dropTarget, makeRoom, makeRoomFor, reorderKeys, type DragSlot } from "./dragOrder";

/** Four rows, 40 tall, 10 apart: tops at 0, 50, 100, 150. */
const SLOTS: DragSlot[] = ["a", "b", "c", "d"].map((key, index) => ({
  key,
  top: index * 50,
  bottom: index * 50 + 40,
}));

describe("dropTarget", () => {
  it("names the row the carried one is aimed in front of", () => {
    expect(dropTarget({ key: "a", y: 105, slots: SLOTS })).toBe("c");
  });

  it("aims at the end when the pointer is past every midpoint", () => {
    expect(dropTarget({ key: "a", y: 400, slots: SLOTS })).toBeNull();
  });
});

describe("makeRoom", () => {
  it("steps the rows in between up so the carried one can drop below them", () => {
    // a, carried down to sit in front of d: b and c come up one slot.
    expect([...makeRoom(SLOTS, "a", "d")]).toEqual([
      ["b", -50],
      ["c", -50],
      ["a", 100],
    ]);
  });

  it("steps the rows in between down so the carried one can drop above them", () => {
    expect([...makeRoom(SLOTS, "d", "b")]).toEqual([
      ["b", 50],
      ["c", 50],
      ["d", -100],
    ]);
  });

  it("opens the gap at the end of the list", () => {
    expect([...makeRoom(SLOTS, "b", null)]).toEqual([
      ["c", -50],
      ["d", -50],
      ["b", 100],
    ]);
  });

  it("moves nothing when the row is aimed at the slot it already sits in", () => {
    expect([...makeRoom(SLOTS, "b", "c")]).toEqual([]);
    expect([...makeRoom(SLOTS, "d", null)]).toEqual([]);
  });

  it("moves nothing for a list that holds neither end of the move", () => {
    expect([...makeRoom(SLOTS, "gone", "c")]).toEqual([]);
    expect([...makeRoom(SLOTS, "a", "gone")]).toEqual([]);
  });

  it("measures each step from where that row actually sat", () => {
    // A list of uneven rows: the gap each one opens is its neighbour's, not
    // some assumed row height.
    const uneven: DragSlot[] = [
      { key: "a", top: 0, bottom: 20 },
      { key: "b", top: 20, bottom: 100 },
      { key: "c", top: 100, bottom: 130 },
    ];
    expect([...makeRoom(uneven, "a", null)]).toEqual([
      ["b", -20],
      ["c", -80],
      ["a", 100],
    ]);
  });

  it("previews the order that reorderKeys goes on to persist", () => {
    const keys = SLOTS.map((slot) => slot.key);
    const moved = makeRoom(SLOTS, "a", "d");
    // Every row the preview shifted is one the persisted order also moves.
    expect(reorderKeys(keys, "a", "d")).toEqual(["b", "c", "a", "d"]);
    expect([...moved.keys()].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("makeRoomFor", () => {
  it("steps the rows from the seat down, and reports the seat's size", () => {
    const room = makeRoomFor(SLOTS, 2, 40);
    expect([...room.offsets]).toEqual([
      ["c", 50],
      ["d", 50],
    ]);
    expect(room.step).toBe(50);
  });

  it("opens the seat at the front", () => {
    expect([...makeRoomFor(SLOTS, 0, 40).offsets.keys()]).toEqual(["a", "b", "c", "d"]);
  });

  it("moves nothing for a seat at the end, and still asks for the height", () => {
    const room = makeRoomFor(SLOTS, SLOTS.length, 40);
    expect([...room.offsets]).toEqual([]);
    expect(room.step).toBe(50);
  });

  it("reads a single row's height when the list has no rhythm to read", () => {
    expect(makeRoomFor([{ key: "a", top: 0, bottom: 26 }], 0, 40).step).toBe(26);
  });

  it("falls back to the carried row's height for an empty list", () => {
    expect(makeRoomFor([], 0, 40).step).toBe(40);
  });
});

