import { describe as suite, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  addBlock,
  addInput,
  decodeBlock,
  designProblems,
  droppedOn,
  effective,
  encodeBlock,
  flowOf,
  gateOpen,
  insertableOn,
  isFlat,
  overrideCount,
  normaliseInputName,
  removeBlock,
  removeInput,
  renameInput,
  revertBlock,
  revertTarget,
  setField,
  snap,
  TARGETS,
  VARIANTS,
  copyDesignTo,
  droppedBy,
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
    slots: [{ id: "s1", name: "rules" }],
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

  it("drops the picture only where it cannot be drawn at all", () => {
    // Qt alone. Its rich text has no data URI, so an inlined picture is a
    // broken-image icon there rather than a picture.
    //
    // `rich` used to be on this list because the artwork was the server's
    // livery and the compiler could not fetch one. What a design carries is
    // the picture itself, inlined, which needs nothing fetched - and is the
    // only kind of `<img>` the sanitiser every reader renders through keeps.
    expect(droppedOn("image", "qt")).toBe(true);
    expect(droppedOn("image", "rich")).toBe(false);
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
    // Every declared input wired, which is the canvas's half of "fine".
    const wired = new Set(["rules", "is_new_member", "registration_closed"]);
    expect(designProblems(design(), wired)).toEqual([]);
  });

  it("names an input nothing feeds, in either list", () => {
    // The check that was dead until now: it read a field on the design that
    // nothing ever wrote, so it fired on every design forever.
    const problems = designProblems(design(), new Set(["rules"]));
    expect(problems).toEqual([
      "The condition “is_new_member” has nothing wired to it.",
      "The condition “registration_closed” has nothing wired to it.",
    ]);
  });
});

suite("the grid", () => {
  it("snaps to four, and rounds when it is off", () => {
    expect(snap(102)).toBe(104);
    expect(snap(101)).toBe(100);
    expect(snap(101.4, false)).toBe(101);
  });
});

suite("carrying a block between windows", () => {
  const callout = { ...block("c", "callout"), text: "Registration is closed.", gate: "shut" };

  it("survives the round trip with everything that makes it that block", () => {
    // The gate especially: a callout pasted without it is a callout everybody
    // sees, which is the opposite of what was copied.
    expect(decodeBlock(encodeBlock(callout))).toMatchObject({
      type: "callout",
      text: "Registration is closed.",
      gate: "shut",
    });
  });

  it("is not fooled by whatever else the clipboard is holding", () => {
    // Which is most of the time: the operator copied a URL, or a paragraph out
    // of the rules they are about to paste in.
    expect(decodeBlock("https://example.org")).toBeNull();
    expect(decodeBlock("")).toBeNull();
    expect(decodeBlock(JSON.stringify({ block: callout }))).toBeNull();
    expect(decodeBlock(JSON.stringify({ format: "fancy-mumble/design-block@1" }))).toBeNull();
  });

  it("refuses a block whose type this build does not draw", () => {
    // From a newer editor. A block with no renderer is one nothing can select,
    // move or delete once it is on the sheet.
    const text = JSON.stringify({
      format: "fancy-mumble/design-block@1",
      block: { ...callout, type: "carousel" },
    });
    expect(decodeBlock(text)).toBeNull();
  });

  it("repairs a position that arrived as nonsense rather than dropping it", () => {
    // A block at NaN is invisible and unselectable; a block at the origin is
    // one the operator can see and drag.
    const text = JSON.stringify({
      format: "fancy-mumble/design-block@1",
      block: { ...callout, x: Number.NaN, y: Number.NaN, w: 0 },
    });
    expect(decodeBlock(text)).toMatchObject({ x: 0, y: 0, w: 240 });
  });
});

suite("declaring inputs", () => {
  const held = (): Design => ({
    sheetW: 520,
    slots: [{ id: "s1", name: "rules" }],
    conditions: [{ id: "c1", name: "is_new_member", on: true }],
    blocks: [
      { ...block("slot", "slot"), slot: "rules" },
      { ...block("gated", "callout"), gate: "is_new_member" },
    ],
    overrides: { qt: { gated: { gate: "is_new_member" } } },
  });

  it("adds one that is named, because the name is the port", () => {
    // A port called nothing is a port nobody can wire to, and it would appear
    // on the node the moment this returns.
    const design = addInput(held(), "slot");
    expect(design.slots).toHaveLength(2);
    expect(design.slots[1]?.name).toBe("text");
    expect(design.slots[1]?.id).not.toBe(design.slots[0]?.id);
  });

  it("does not hand out a name that is already a port", () => {
    // Both lists are one namespace: two ports with one name is a wire that
    // lands on whichever the editor happened to draw first.
    const one = addInput(held(), "slot");
    const two = addInput(one, "slot");
    const three = addInput(two, "condition");
    expect(two.slots.map((input) => input.name)).toEqual(["rules", "text", "text_2"]);
    expect(three.conditions.map((input) => input.name)).toEqual(["is_new_member", "toggle"]);
  });

  it("renames what points at it, including a target's override", () => {
    // The override is the one that gets forgotten: a Qt tab that still gates
    // on the old name is a block that shows to everybody on Qt and nobody
    // anywhere else.
    const { design, name } = renameInput(held(), "c1", "Is New Member");
    expect(name).toBe("is_new_member");
    const renamed = renameInput(design, "c1", "brand new").design;
    expect(renamed.conditions[0]?.name).toBe("brand_new");
    expect(renamed.blocks.find((b) => b.id === "gated")?.gate).toBe("brand_new");
    expect(renamed.overrides.qt?.gated?.gate).toBe("brand_new");
  });

  it("keeps the name it had when the new one is empty or taken", () => {
    // Somebody clearing the field to retype it passes through empty, and a
    // field that renamed the port to nothing on the way would break the wire
    // between two keystrokes.
    expect(renameInput(held(), "s1", "").name).toBe("rules");
    expect(renameInput(held(), "s1", "!!!").name).toBe("rules");
    expect(renameInput(held(), "s1", "is_new_member").name).toBe("is_new_member_2");
  });

  it("unbinds what pointed at one that is removed", () => {
    // A block naming an input that is gone reads as a broken design rather
    // than as one somebody simplified.
    const design = removeInput(removeInput(held(), "c1"), "s1");
    expect(design.conditions).toEqual([]);
    expect(design.blocks.find((b) => b.id === "gated")?.gate).toBeUndefined();
    expect(design.blocks.find((b) => b.id === "slot")?.slot).toBeUndefined();
    expect(design.overrides.qt?.gated?.gate).toBeUndefined();
  });

  it("says a slot block with nothing to bind to is a problem", () => {
    // Which is the one case removal deliberately leaves behind: a hole in the
    // greeting is somebody's decision to make, not this function's.
    const design = removeInput(held(), "s1");
    expect(designProblems(design, new Set())).toContain("A Text slot names no text input.");
  });

  it("normalises a name to something a port can be called", () => {
    expect(normaliseInputName("House Rules")).toBe("house_rules");
    expect(normaliseInputName("  new-member  ")).toBe("new_member");
    expect(normaliseInputName("in:rules")).toBe("inrules");
    expect(normaliseInputName("!!!")).toBe("");
  });
});

/**
 * The tabs an operator gets, against the documents every reader gets.
 *
 * These are two different lists and the difference is the point: Plain and
 * HTML stopped being tabs, and neither stopped being *sent*.
 */
suite("what is editable and what is compiled", () => {
  it("offers a tab only where there is something to decide", () => {
    expect([...TARGETS]).toEqual(["base", "rich", "qt"]);
  });

  it("still compiles every variant a reader can be sent", () => {
    // `target_for` on the server hands out all four. A variant that stopped
    // being compiled would be a set of clients that stopped being greeted.
    expect([...VARIANTS]).toEqual(["plain", "rich", "html", "qt"]);
  });

  it("keeps honouring an override a design already carries for a dropped tab", () => {
    // Documents saved while Plain and HTML were tabs still hold their
    // divergence, and losing it silently on the next open would be the editor
    // rewriting somebody's design because its own UI changed.
    const held: Design = {
      ...design(),
      blocks: [block("1", "heading", { text: "Base words" })],
      overrides: { html: { "1": { text: "HTML words" } } },
    };
    expect(effective(held, "html", held.blocks[0]).text).toBe("HTML words");
    expect(effective(held, "base", held.blocks[0]).text).toBe("Base words");
  });
});

/**
 * Copying one target's design onto another.
 *
 * For designing once and adapting, rather than laying the same greeting out
 * twice from a blank sheet.
 */
suite("copying a design between targets", () => {
  const sheet = (): Design => ({
    ...design(),
    blocks: [
      block("1", "heading", { text: "Welcome", bg: "#1c2430" }),
      block("2", "image", { y: 200 }),
      block("3", "text", { y: 300, text: "<p>Words</p>" }),
    ],
    overrides: {},
  });

  it("carries everything the destination can hold, whole", () => {
    const copied = copyDesignTo(sheet(), "base", "qt");
    expect(copied.overrides.qt?.["1"]).toMatchObject({ text: "Welcome", bg: "#1c2430" });
    expect(copied.overrides.qt?.["3"]).toMatchObject({ text: "<p>Words</p>" });
  });

  it("leaves behind what the destination cannot draw at all", () => {
    // An override for a block that target drops is one nobody can see, edit
    // or clear. Classic Mumble has no way to fetch the artwork.
    const copied = copyDesignTo(sheet(), "base", "qt");
    expect(copied.overrides.qt?.["2"]).toBeUndefined();
    // And the block itself is untouched: it is still in the design, and still
    // drawn everywhere that can hold it.
    expect(copied.blocks.some((b) => b.id === "2")).toBe(true);
  });

  it("writes the blocks themselves when the destination is base", () => {
    // There is nothing for the master to diverge from, so copying onto it is
    // the one direction that changes the design rather than an override.
    const from: Design = { ...sheet(), overrides: { qt: { "1": { text: "Qt words" } } } };
    const copied = copyDesignTo(from, "qt", "base");
    expect(copied.blocks.find((b) => b.id === "1")?.text).toBe("Qt words");
    // That target's overrides went with it: they described a base that is gone.
    expect(copied.overrides.qt).toBeUndefined();
  });

  it("copies what a target actually shows, not what base says", () => {
    const from: Design = { ...sheet(), overrides: { qt: { "1": { text: "Qt words" } } } };
    expect(copyDesignTo(from, "qt", "rich").overrides.rich?.["1"]).toMatchObject({ text: "Qt words" });
  });

  it("does nothing at all when both ends are the same target", () => {
    const held = sheet();
    expect(copyDesignTo(held, "qt", "qt")).toBe(held);
  });
});

suite("warning about what a target leaves out", () => {
  it("names the kinds this target will not draw", () => {
    const held: Design = {
      ...design(),
      blocks: [block("1", "heading"), block("2", "image"), block("3", "video", { y: 200 })],
      overrides: {},
    };
    expect(droppedBy(held, "qt").sort()).toEqual(["image"]);
    expect(droppedBy(held, "rich").sort()).toEqual(["video"]);
  });

  it("says nothing when the target can draw all of it", () => {
    const held: Design = { ...design(), blocks: [block("1", "heading")], overrides: {} };
    expect(droppedBy(held, "qt")).toEqual([]);
    expect(droppedBy(held, "base")).toEqual([]);
  });
});
