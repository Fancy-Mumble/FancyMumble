import { describe as suite, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  addBlock,
  designProblems,
  droppedOn,
  effective,
  flowOf,
  gateOpen,
  insertableOn,
  isFlat,
  overrideCount,
  removeBlock,
  revertBlock,
  revertTarget,
  setField,
  snap,
  type Block,
  type Design,
} from "./design";

const block = (id: string, type: Block["type"], fields: Partial<Block> = {}): Block => ({
  id,
  type,
  x: 44,
  y: 100,
  w: 432,
  ...fields,
});

/** The design from the mock, near enough to hold the rules to. */
function design(): Design {
  return {
    sheetW: 520,
    slots: [{ id: "s1", name: "rules", wired: "rules" }],
    conditions: [
      { id: "c1", name: "is_new_member", on: true },
      { id: "c2", name: "registration_closed", on: true },
    ],
    blocks: [
      block("1", "mark", { x: 216, y: 28, w: 88, h: 88, glyph: "◆" }),
      block("2", "heading", { y: 136, size: 38, align: "center", text: "Welcome to Magical.Rocks" }),
      block("3", "text", { x: 116, y: 196, w: 288, align: "center", text: "The home of Fancy Mumble" }),
      block("4", "divider", { y: 236 }),
      block("7", "button", {
        y: 492,
        align: "center",
        style: "button",
        text: "Register",
        gate: "is_new_member",
      }),
      block("8", "callout", { y: 560, text: "Registration is disabled.", gate: "registration_closed" }),
      block("9", "links", { y: 620 }),
    ],
    overrides: { qt: { "7": { align: "left", style: "link" } }, plain: {} },
  };
}

suite("what each target can draw", () => {
  it("keeps plain to what plain can actually be", () => {
    // A badge, a rule and a row of cards are all shape, and shape has no
    // plain-text spelling worth having.
    for (const type of ["mark", "image", "divider", "links"] as const) {
      expect(droppedOn(type, "plain"), type).toBe(true);
    }
    expect(droppedOn("heading", "plain")).toBe(false);
    expect(droppedOn("text", "plain")).toBe(false);
  });

  it("drops the picture where the artwork cannot be fetched", () => {
    expect(droppedOn("image", "qt")).toBe(true);
    expect(droppedOn("image", "rich")).toBe(true);
    expect(droppedOn("image", "html")).toBe(false);
  });

  it("draws everything on base, because base is the design", () => {
    for (const type of BLOCK_TYPES) expect(droppedOn(type, "base"), type).toBe(false);
    expect(insertableOn("base")).toHaveLength(BLOCK_TYPES.length);
  });

  it("offers only what a target can draw while that tab is open", () => {
    // The other half of the target selector: a block that cannot be drawn is
    // not one you can add, rather than one you add and then wonder about.
    expect(insertableOn("qt")).not.toContain("image");
    expect(insertableOn("plain")).not.toContain("links");
    expect(insertableOn("html")).toContain("image");
  });

  it("lays plain out in document order and everything else on the sheet", () => {
    expect(isFlat("plain")).toBe(true);
    expect(isFlat("qt")).toBe(false);
  });
});

suite("reading order for a flat target", () => {
  it("is top to bottom, then left to right, taken from the positions", () => {
    // Derived rather than stored, so there is no second ordering to maintain
    // and no way for it to disagree with the sheet.
    const laid: Design = {
      ...design(),
      blocks: [
        block("late", "text", { x: 44, y: 400 }),
        block("right", "text", { x: 300, y: 100 }),
        block("left", "text", { x: 44, y: 100 }),
      ],
      overrides: {},
    };
    expect(flowOf(laid, "plain").map((b) => b.id)).toEqual(["left", "right", "late"]);
  });

  it("leaves a positioned target in the order it was written", () => {
    const laid: Design = {
      ...design(),
      blocks: [block("b", "text", { y: 400 }), block("a", "text", { y: 100 })],
      overrides: {},
    };
    expect(flowOf(laid, "html").map((b) => b.id)).toEqual(["b", "a"]);
  });

  it("leaves out what the target cannot draw", () => {
    const ids = flowOf(design(), "plain").map((b) => b.id);
    expect(ids).not.toContain("1");
    expect(ids).not.toContain("4");
    expect(ids).not.toContain("9");
    expect(ids).toContain("2");
  });
});

suite("targets diverging from base", () => {
  it("shows base through, where a target has not said otherwise", () => {
    const held = design();
    expect(effective(held, "html", held.blocks[4]).align).toBe("center");
    // Qt overrode exactly these two fields, and nothing else.
    expect(effective(held, "qt", held.blocks[4]).align).toBe("left");
    expect(effective(held, "qt", held.blocks[4]).style).toBe("link");
    expect(effective(held, "qt", held.blocks[4]).text).toBe("Register");
  });

  it("writes the block on base and a patch anywhere else", () => {
    const held = design();
    const onBase = setField(held, "base", "2", "text", "Hello");
    expect(onBase.blocks[1].text).toBe("Hello");
    expect(onBase.overrides.qt?.["2"]).toBeUndefined();

    const onQt = setField(held, "qt", "2", "text", "Hello");
    expect(onQt.blocks[1].text).toBe("Welcome to Magical.Rocks");
    expect(onQt.overrides.qt?.["2"]?.text).toBe("Hello");
  });

  it("carries a base edit into every target that has not diverged on that field", () => {
    // The whole reason this is one design and not four documents.
    const edited = setField(design(), "base", "7", "text", "Sign up");
    expect(effective(edited, "qt", edited.blocks[4]).text).toBe("Sign up");
    // …and leaves the fields Qt *did* diverge on alone.
    expect(effective(edited, "qt", edited.blocks[4]).align).toBe("left");
  });

  it("takes one block, or a whole target, back to base", () => {
    const held = design();
    expect(overrideCount(held, "qt")).toBe(1);
    expect(overrideCount(revertBlock(held, "qt", "7"), "qt")).toBe(0);
    expect(overrideCount(revertTarget(held, "qt"), "qt")).toBe(0);
    // Base has nothing to revert to.
    expect(revertTarget(held, "base")).toBe(held);
  });

  it("takes a deleted block's overrides with it", () => {
    // Otherwise a new block reusing the id would inherit a stranger's patch.
    const gone = removeBlock(design(), "7");
    expect(gone.blocks.some((b) => b.id === "7")).toBe(false);
    expect(gone.overrides.qt?.["7"]).toBeUndefined();
  });
});

suite("gates", () => {
  it("is open when nothing gates it", () => {
    expect(gateOpen(design(), block("x", "text"))).toBe(true);
  });

  it("follows the condition it names", () => {
    const held = design();
    expect(gateOpen(held, held.blocks[4])).toBe(true);
    const off: Design = { ...held, conditions: [{ id: "c1", name: "is_new_member", on: false }] };
    expect(gateOpen(off, held.blocks[4])).toBe(false);
  });

  it("opens rather than shuts when the condition is gone", () => {
    // A block that vanished because somebody renamed an input is a block
    // nobody can find again.
    const held: Design = { ...design(), conditions: [] };
    expect(gateOpen(held, held.blocks[4])).toBe(true);
  });
});

suite("problems worth naming", () => {
  it("names a slot pointing at an input that no longer exists", () => {
    const held = addBlock(design(), block("s", "slot", { slot: "gone" }));
    expect(designProblems(held).some((p) => p.includes("gone"))).toBe(true);
  });

  it("names a gate pointing at an input that no longer exists", () => {
    const held: Design = { ...design(), conditions: [] };
    const problems = designProblems(held);
    expect(problems.some((p) => p.includes("is_new_member"))).toBe(true);
  });

  it("names a text input with nothing wired to it", () => {
    const held: Design = { ...design(), slots: [{ id: "s1", name: "rules" }] };
    expect(designProblems(held).some((p) => p.includes("rules"))).toBe(true);
  });

  it("says so when a target would draw nothing at all", () => {
    // An empty greeting reads as a broken server rather than as a server with
    // nothing to say.
    const held: Design = {
      ...design(),
      slots: [],
      conditions: [],
      blocks: [block("1", "mark"), block("9", "links")],
      overrides: {},
    };
    expect(designProblems(held).some((p) => p.includes("Plain"))).toBe(true);
  });

  it("is quiet about a design that is fine", () => {
    expect(designProblems(design())).toEqual([]);
  });
});

suite("the grid", () => {
  it("snaps to four, and rounds when it is off", () => {
    expect(snap(102)).toBe(104);
    expect(snap(101)).toBe(100);
    expect(snap(101.4, false)).toBe(101);
  });
});
