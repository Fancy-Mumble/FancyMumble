import { describe as suite, expect, it } from "vitest";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { assemble, compileAll, compileTarget, rowsOf, type Part } from "./compile";
import { qtViolations } from "./qtHtml";
import type { Block, Design } from "./design";

const block = (id: string, type: Block["type"], fields: Partial<Block> = {}): Block => ({
  id,
  type,
  x: 44,
  y: 100,
  w: 432,
  ...fields,
});

function design(blocks: Block[], extra: Partial<Design> = {}): Design {
  return {
    sheetW: 520,
    slots: [{ id: "s1", name: "rules", wired: "rules" }],
    conditions: [{ id: "c1", name: "registration_closed", on: true }],
    blocks,
    overrides: {},
    ...extra,
  };
}

/** The design from the mock, near enough for the compiler to chew on. */
function frontPage(): Design {
  return design([
    block("1", "mark", { x: 216, y: 28, w: 88, h: 88, glyph: "◆", align: "center" }),
    block("2", "heading", { y: 136, size: 38, align: "center", text: "Welcome to Magical.Rocks" }),
    block("3", "text", { x: 116, y: 196, w: 288, align: "center", text: "The home of Fancy Mumble" }),
    block("4", "divider", { y: 236 }),
    block("5", "slot", { y: 260, slot: "rules" }),
    block("7", "button", {
      y: 492,
      align: "center",
      style: "button",
      text: "Register",
      url: "https://example.org/register",
    }),
    block("8", "callout", { y: 560, text: "Registration is disabled.", gate: "registration_closed" }),
    block("9", "links", {
      y: 620,
      items: [
        { kicker: "Browse", label: "Channel Viewer", url: "https://example.org/c" },
        { kicker: "Live", label: "Server Status", url: "https://example.org/s" },
      ],
    }),
  ]);
}

suite("turning positions into rows", () => {
  it("puts blocks whose extents overlap side by side", () => {
    // What "beside" means to a reader, and what a sorted list of y positions
    // cannot tell you on its own.
    const rows = rowsOf([
      block("right", "text", { x: 300, y: 100, w: 200 }),
      block("left", "text", { x: 40, y: 104, w: 200 }),
      block("below", "text", { x: 40, y: 400 }),
    ]);
    expect(rows.map((row) => row.map((b) => b.id))).toEqual([["left", "right"], ["below"]]);
  });

  it("splits rather than inventing a nested cell", () => {
    // A tall block beside two stacked ones has no table row that says what the
    // sheet says. This gets it conservatively wrong - two rows - rather than
    // guessing at extents, and the operator sees exactly that on the target
    // tab rather than finding out from a member.
    const rows = rowsOf([
      block("tall", "image", { x: 40, y: 100, w: 100, h: 200 }),
      block("a", "text", { x: 200, y: 110 }),
      block("b", "text", { x: 200, y: 250 }),
    ]);
    expect(rows.map((row) => row.map((b) => b.id))).toEqual([["tall", "a"], ["b"]]);
  });

  it("does not weld a rule to the paragraph under it", () => {
    // Most blocks carry no height, so an assumed extent would silently make
    // these one row.
    const rows = rowsOf([block("rule", "divider", { y: 236 }), block("under", "text", { y: 260 })]);
    expect(rows).toHaveLength(2);
  });

  it("reads a single column top to bottom", () => {
    const rows = rowsOf(frontPage().blocks);
    expect(rows.every((row) => row.length === 1)).toBe(true);
    expect(rows.map((row) => row[0].id)).toEqual(["1", "2", "3", "4", "5", "7", "8", "9"]);
  });
});

suite("compiling a target", () => {
  it("makes one part per row, and splits a row that holds a gate", () => {
    // A row that lost a cell to a gate would leave the others stretched over
    // the gap, and a table the server had to re-balance is a layout engine in
    // Rust.
    const parts = compileTarget(
      design([
        block("a", "text", { x: 40, y: 100, w: 200, text: "left" }),
        block("b", "text", { x: 300, y: 100, w: 200, text: "right", gate: "registration_closed" }),
      ]),
      "html",
    );
    expect(parts).toHaveLength(2);
    expect(parts[0].visibleIf).toBeUndefined();
    expect(parts[1].visibleIf).toBe("registration_closed");
  });

  it("carries a slot as a slot, never as markup", () => {
    // The server substitutes it: what the wired snippet says is not known
    // until somebody connects.
    const parts = compileTarget(frontPage(), "html");
    const slot = parts.find((part) => part.slot !== undefined);
    expect(slot?.slot).toBe("rules");
    expect(slot?.literal).toBeUndefined();
  });

  it("carries a gate on the part it belongs to", () => {
    const gated = compileTarget(frontPage(), "html").filter((p) => p.visibleIf !== undefined);
    expect(gated).toHaveLength(1);
    expect(gated[0].visibleIf).toBe("registration_closed");
  });

  it("leaves out what the target cannot draw", () => {
    const plain = compileTarget(frontPage(), "plain");
    const text = plain.map((part) => part.literal ?? "").join(" ");
    // The badge, the rule and the card row are shape, and plain has none.
    expect(text).not.toContain("◆");
    expect(text).toContain("Welcome to Magical.Rocks");
  });

  it("says nothing at all for a design with nothing on it", () => {
    expect(compileTarget(design([]), "html")).toEqual([]);
  });
});

suite("the markup each target gets", () => {
  it("lays every positioned target out with tables, because nothing else survives", () => {
    for (const target of ["html", "rich", "qt"] as const) {
      const markup = compileTarget(frontPage(), target)
        .map((part) => part.literal ?? "")
        .join("");
      expect(markup, target).toContain("<table");
    }
  });

  it("writes only what Qt can draw", () => {
    const markup = compileTarget(frontPage(), "qt")
      .map((part) => part.literal ?? "")
      .join("");
    expect(qtViolations(markup)).toEqual([]);
  });

  it("keeps its structure through the sanitiser every surface renders through", () => {
    const markup = compileTarget(frontPage(), "html")
      .map((part) => part.literal ?? "")
      .join("");
    const clean = sanitizeHtml(markup);
    expect(clean).toContain("<table");
    expect(clean).toContain("example.org/register");
  });

  it("draws a button as a filled cell, and on Qt as a link", () => {
    const html = compileTarget(frontPage(), "html")
      .map((p) => p.literal ?? "")
      .join("");
    const qt = compileTarget(frontPage(), "qt")
      .map((p) => p.literal ?? "")
      .join("");
    expect(html).toContain("bgcolor");
    // A filled cell inside a layout cell is a table two deep, and Qt draws
    // that badly - so those clients get the honest link.
    expect(qt).toContain("<a href");
    expect(qt).not.toContain("bgcolor");
  });

  it("escapes what an operator typed", () => {
    const parts = compileTarget(design([block("x", "heading", { text: "<script>x</script>" })]), "html");
    expect(parts[0].literal).toContain("&lt;script&gt;");
    expect(parts[0].literal).not.toContain("<script>");
  });
});

suite("assembling, the way the server will", () => {
  const resolve = (on: boolean) => ({
    condition: () => on,
    slot: () => "<p>House rules are pinned in #Lounge.</p>",
  });

  it("drops the parts whose condition is false", () => {
    const parts = compileTarget(frontPage(), "html");
    expect(assemble(parts, "html", resolve(true))).toContain("Registration is disabled");
    expect(assemble(parts, "html", resolve(false))).not.toContain("Registration is disabled");
  });

  it("substitutes a slot with what is wired to it", () => {
    const parts = compileTarget(frontPage(), "html");
    expect(assemble(parts, "html", resolve(true))).toContain("House rules are pinned");
  });

  it("hands a slot to each target in that target's own dialect", () => {
    const plain = assemble(compileTarget(frontPage(), "plain"), "plain", resolve(true));
    expect(plain).toContain("House rules are pinned in #Lounge.");
    expect(plain).not.toContain("<p>");
  });

  it("separates plain parts, because text has nothing that closes itself", () => {
    const plain = assemble(compileTarget(frontPage(), "plain"), "plain", resolve(true));
    expect(plain).toContain("\n\n");
  });

  it("leaves an unwired slot out rather than leaving a gap", () => {
    const parts: Part[] = [{ literal: "a" }, { slot: "rules" }, { literal: "b" }];
    const empty = { condition: () => true, slot: () => "" };
    expect(assemble(parts, "plain", empty)).toBe("a\n\nb");
  });
});

suite("every target at once", () => {
  it("compiles all four, so a save stores all four", () => {
    const all = compileAll(frontPage());
    expect(Object.keys(all).sort()).toEqual(["html", "plain", "qt", "rich"]);
    for (const [target, parts] of Object.entries(all)) {
      expect(parts.length, target).toBeGreaterThan(0);
    }
  });
});
