import { describe as suite, expect, it } from "vitest";
import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { assemble, compileAll, compileTarget, rowsOf, type Part } from "./compile";
import { qtViolations } from "./qtHtml";
import { DESIGN_TEMPLATES } from "./templates";
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
    slots: [{ id: "s1", name: "rules" }],
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

suite("a text block, which is written in the WYSIWYG", () => {
  const rich = (html: string) => design([block("t", "text", { size: 18, text: html })]);
  const only = (target: Parameters<typeof compileTarget>[1], html: string) =>
    compileTarget(rich(html), target)
      .map((part) => part.literal ?? "")
      .join("");

  it("keeps the formatting somebody applied", () => {
    // The whole point of the field: bold stays bold on every target that has
    // a way to say it.
    const markup = only("html", "<p>House <strong>rules</strong> apply.</p>");
    expect(markup).toContain("<strong>rules</strong>");
    expect(only("qt", "<p>House <strong>rules</strong> apply.</p>")).toMatch(/<b>rules<\/b>|<strong>rules<\/strong>/);
  });

  it("puts the size on the cell, because the body brings its own tags", () => {
    // There is nowhere else for it: `div` is not on the allow-list and a span
    // around a paragraph is closed by the parser at the first one.
    expect(only("html", "<p>Hello</p>")).toContain("font-size:18px");
    expect(only("html", "<p>Hello</p>")).not.toContain("<div");
  });

  it("flattens to text on the target that has no tags", () => {
    // A list is the case worth pinning: the plain half is still read by
    // somebody, so the items survive as lines rather than as one paragraph.
    const plain = only("plain", "<p>Before you speak:</p><ul><li>Be kind</li><li>Push to talk</li></ul>");
    expect(plain).toContain("Before you speak:");
    expect(plain).toContain("• Be kind");
    expect(plain).not.toContain("<li>");
  });

  it("passes the body through the Qt subset rather than sending it whole", () => {
    // Qt draws a subset of HTML 4, and the field can produce more than that.
    const qt = only("qt", '<p style="text-align:center">Hi</p><ul><li>One</li></ul>');
    expect(qtViolations(qt)).toEqual([]);
  });

  it("filters the markup on the way out, because a paste is not typing", () => {
    // The field escapes what is typed into it; a contenteditable will take a
    // whole document from the clipboard.
    expect(only("html", "<p>Hi</p><script>steal()</script>")).not.toContain("<script");
  });

  it("reads copy that was written before the block had an editor", () => {
    // Every design drawn until now holds a bare string, and so does every
    // template: the words are the words, and the line breaks are paragraphs.
    // An empty block still compiles to its cell, as every empty block always
    // has - what it must not do is invent a paragraph to put in it.
    expect(only("html", "")).not.toContain("<p>");
    const legacy = compileTarget(design([block("t", "text", { text: "Good to have you here." })]), "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(legacy).toContain("<p>Good to have you here.</p>");
  });

  it("does not read an ampersand in that old copy as markup", () => {
    // The reason plain copy cannot simply be handed to a renderer.
    const legacy = compileTarget(design([block("t", "text", { text: "Rules & manners" })]), "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(legacy).toContain("Rules &amp; manners");
  });
});

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

  it("draws a button as a filled cell on both, in each one's own vocabulary", () => {
    const html = compileTarget(frontPage(), "html")
      .map((p) => p.literal ?? "")
      .join("");
    const qt = compileTarget(frontPage(), "qt")
      .map((p) => p.literal ?? "")
      .join("");
    // A `style`, not a `bgcolor`. This used to assert the attribute, which is
    // the thing the reader's own sanitiser strips - so the assertion passed
    // while every recipient got an unfilled button.
    //
    // The fill is the theme's own accent, with the literal behind it: a reader
    // on a themed client paints the button in their accent, and one rendering
    // this markup anywhere else still gets a filled button rather than a bare
    // word on the page.
    expect(html).toContain("background-color:var(--color-accent, #3399dd)");
    // And Qt the other way round: `bgcolor` and `cellpadding` are both in its
    // own attribute list, and a `style` fill is what *it* would drop. It used
    // to be sent a bare link on the theory that nested tables draw badly;
    // they do not, and the call to action was the thing losing by it.
    expect(qt).toContain("<a href");
    expect(qt).toContain('bgcolor="#3399dd"');
    expect(qt).toContain('cellpadding="8"');
    // The ink is always set with the fill: Qt paints the welcome text over
    // whatever the client's theme gives it, so a fill without a colour is
    // white-on-white for anybody on a light theme.
    expect(qt).toContain(`color="${"#ffffff"}"`);
  });

  it("uses only the CSS Qt actually reads", () => {
    // Qt has `padding-left` and no `padding`, `align` as an attribute and no
    // `text-align` property. Both were being emitted, and Qt drops what it
    // does not know without a word - so the layout arrived flush and
    // left-aligned while every test still passed.
    const qt = compileTarget(frontPage(), "qt")
      .map((p) => p.literal ?? "")
      .join("");
    expect(qt).not.toMatch(/style="[^"]*[^-]padding:/);
    expect(qt).not.toMatch(/style="[^"]*text-align:/);
    expect(qt).toContain('align="center"');
  });

  it("keeps its layout through the sanitiser every reader renders with", () => {
    // The bug this pins: the compiler described the layout in `align`,
    // `valign`, `bgcolor` and `cellpadding`, none of which are on the
    // allow-list - so a centred design arrived left-aligned and a filled
    // button arrived as a bare link. What is asserted is the *surviving*
    // markup, because that is what somebody actually reads.
    const clean = sanitizeHtml(
      compileTarget(frontPage(), "html")
        .map((part) => part.literal ?? "")
        .join(""),
    );
    expect(clean).toContain("text-align:center");
    // Both halves of the themed fill survive: DOMPurify's CSS filter keeps a
    // custom property and its fallback intact, which is the whole reason the
    // auto colours can be sent as `var()` rather than resolved before send.
    expect(clean).toContain("background-color:var(--color-accent, #3399dd)");
    expect(clean).not.toContain("align=");
    expect(clean).not.toContain("bgcolor");
  });

  it("keeps the legacy attributes for Qt, whose rich text is HTML 4", () => {
    const qt = compileTarget(frontPage(), "qt")
      .map((part) => part.literal ?? "")
      .join("");
    expect(qt).toContain('align="center"');
    expect(qt).toContain('cellspacing="0"');
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

/**
 * The three controls a restrained design needs, and none of which worked.
 *
 * All three were found by rendering the "modern" template rather than by
 * reading it: a badge that came out as a full-width bar, a bordered card with
 * nothing inside its border, and a footer that drew a rule on one target and
 * not on the other.
 */
suite("blocks that carry their own box", () => {
  it("fits a badge to its words instead of stretching it across the row", () => {
    // A block alone in a row is full width, which is right for a paragraph and
    // wrong for a pill. The paint has to move off the layout cell and onto a
    // table that shrinks, or the accent reads as a banner.
    const pill = design([
      block("1", "panel", { fit: true, bg: "#eef", pad: 8, radius: 999, text: "<p>NEW</p>" }),
    ]);
    const html = compileTarget(pill, "html")
      .map((part) => part.literal ?? "")
      .join("");
    // An inline-block shrinks to its words. What must not happen is the fill
    // landing on a block-level box, which would paint the whole column.
    expect(html).toContain('<span style="display:inline-block;background-color:#eef');
    expect(html).not.toMatch(/display:block;[^"]*background-color/);
    // And it has to still be there after the sanitiser: `div` is not on the
    // tag allow-list, so wrapping this in one deletes the box and keeps the
    // words - which is how the fill, the padding and the radius would all
    // arrive as nothing.
    const clean = sanitizeHtml(html);
    expect(clean).toContain("display:inline-block");
    expect(clean).toContain("background-color:#eef");

    const qt = compileTarget(pill, "qt")
      .map((part) => part.literal ?? "")
      .join("");
    // Qt shrinks a table to its contents too, and takes the fill as `bgcolor`.
    expect(qt).toContain('<table bgcolor="#eef"');
    expect(qt).not.toMatch(/width="100%"[^>]*bgcolor/);
  });

  it("keeps a fitted block fitted when it is gated", () => {
    // A gated block goes down the split path, which wraps the cell around the
    // pieces. That path knew nothing about fitting, so gating a badge silently
    // turned it back into a bar.
    const parts = compileTarget(
      design([block("1", "panel", { fit: true, gate: "registration_closed", bg: "#eef", text: "<p>NEW</p>" })]),
      "html",
    );
    const html = parts.map((part) => part.literal ?? "").join("");
    expect(parts.every((part) => part.visibleIf === "registration_closed")).toBe(true);
    expect(html).toContain("display:inline-block");
    expect(html).not.toMatch(/display:block;[^"]*background-color/);
  });

  it("draws the box a slot block asked for, around the snippet wired to it", () => {
    // A slot used to throw its cell away, so a bordered, padded slot arrived as
    // bare markup dropped into the middle of a laid-out page. The wrap rides as
    // its own literals because the wire format has nowhere to put an "around".
    const parts = compileTarget(
      design([block("1", "slot", { slot: "rules", border: "#dde", radius: 14, pad: 18 })]),
      "html",
    );
    expect(parts).toHaveLength(3);
    expect(parts[0].literal).toContain("border:1px solid #dde");
    expect(parts[1].slot).toBe("rules");
    expect(parts[2].literal).toContain("</span>");
    // And it closes: the box is around the snippet, not beside it.
    const whole = assemble(parts, "html", {
      condition: () => true,
      slot: () => "<p>Be kind.</p>",
    });
    expect(whole).toMatch(/border:1px solid #dde[^]*<p>Be kind\.<\/p>[^]*<\/span>/);
    // The box has to survive the sanitiser, or it is a box nobody sees.
    expect(sanitizeHtml(whole)).toContain("border:1px solid #dde");
  });

  it("still sends a bare slot as one part when it has no box to draw", () => {
    // The common case stays one part. Three parts where one would do is three
    // times the wire format for the same words.
    const parts = compileTarget(design([block("1", "slot", { slot: "rules" })]), "plain");
    expect(parts).toHaveLength(1);
    expect(parts[0].slot).toBe("rules");
  });

  it("gives a footer the same rule and the same alignment on both targets", () => {
    // Qt drew a rule of its own and forced a left-aligned footer to the centre,
    // and the markup targets did neither - so one design ended with a line on
    // the old client and without one on the new, and a template with a divider
    // above its footer got two.
    const sheet = design([block("1", "footer", { align: "left", text: "Only once" })]);
    const qt = compileTarget(sheet, "qt")
      .map((part) => part.literal ?? "")
      .join("");
    const html = compileTarget(sheet, "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(qt).not.toContain("<hr>");
    expect(html).not.toContain("<hr>");
    expect(qt).toContain('<div align="left">');
  });

  it("lets a footer keep the colour and size it was given", () => {
    // Both were written flat inside the footer's own markup, which beat the
    // block's `fg` and `size` coming from the cell outside - so a footer given
    // a colour in the inspector kept the fixed grey and the control looked
    // broken.
    const html = compileTarget(
      design([block("1", "footer", { fg: "auto:accent", size: 14, text: "Only once" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("font-size:14px");
    expect(html).not.toContain("color:#888888");
    expect(html).toContain("color:var(--color-accent, #3399dd)");
  });

  it("does not nest a paragraph inside a paragraph in a footer", () => {
    // The body brings its own `<p>`, and a paragraph inside a paragraph is
    // closed by the parser at the first one - which put the footer's words
    // outside the small grey box they were meant to be in.
    const html = compileTarget(
      design([block("1", "footer", { text: "<p>Only once</p>" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).not.toMatch(/<p[^>]*>\s*<p/);
  });
});

/**
 * The controls a design system needs to draw something current, each of which
 * was found by building a flat mock first and then failing to rebuild it.
 *
 * The mock and the rebuild render pixel-for-pixel identical, verified in a
 * browser against the same sanitiser a client uses. What is asserted here is
 * the markup behind each of the things that had to change for that to be true,
 * because a pixel comparison is not something a unit test can run.
 */
suite("what a modern sheet needs", () => {
  it("nests blocks inside a group by where they are drawn", () => {
    // Geometry rather than a stored parent, which is the same bargain rows
    // already make: an operator drags a card onto a panel and it is on the
    // panel, with nothing to press and nothing that can disagree with the
    // sheet.
    const sheet = design([
      block("panel", "group", { x: 0, y: 0, w: 500, h: 300, bg: "#111", pad: 20 }),
      block("inside", "text", { x: 20, y: 40, w: 200, text: "in" }),
      block("outside", "text", { x: 20, y: 400, w: 200, text: "out" }),
    ]);
    const html = compileTarget(sheet, "html")
      .map((part) => part.literal ?? "")
      .join("");
    // The one inside is between the group's tags; the one below it is after.
    expect(html).toMatch(/background-color:#111[^]*>in<[^]*<\/span>[^]*>out</);
  });

  it("lets a group overlap its children, which is what a cluster is", () => {
    const sheet = design([
      block("row", "group", { x: 0, y: 0, w: 300, h: 60, flow: "row" }),
      block("a", "group", { x: 10, y: 10, w: 30, h: 30, round: true, bg: "#f00" }),
      block("b", "group", { x: 50, y: 10, w: 30, h: 30, round: true, bg: "#0f0", gap: -11 }),
    ]);
    const html = compileTarget(sheet, "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("margin-left:-11px");
    expect(html).toContain("border-radius:50%");
    // An empty group keeps the height it was drawn as - it *is* its rectangle.
    expect(html).toContain("height:30px");
  });

  it("does not freeze a group holding something at its drawn height", () => {
    // The rectangle is how the sheet decides what is inside it, which is not
    // the same question as how tall the box is when somebody reads it. A card
    // frozen at the height of its outline is a card with a hole in it.
    const sheet = design([
      block("card", "group", { x: 0, y: 0, w: 300, h: 90, bg: "#111" }),
      block("in", "text", { x: 10, y: 20, w: 200, text: "words" }),
    ]);
    const html = compileTarget(sheet, "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).not.toContain("height:90px");
  });

  it("paints a gradient behind the fill rather than instead of it", () => {
    // Order is not free: `background` is a shorthand that resets the colour, so
    // written the other way round the flat fill silently disappears.
    const html = compileTarget(
      design([block("g", "group", { x: 0, y: 0, w: 300, h: 90, grad: "linear-gradient(#123,#456)", bg: "#111" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toMatch(/background:linear-gradient\(#123,#456\);background-color:#111/);
    // And Qt, which has never heard of one, gets the flat fill alone.
    const qt = compileTarget(
      design([block("g", "group", { x: 0, y: 0, w: 300, h: 90, grad: "linear-gradient(#123,#456)", bg: "#111" })]),
      "qt",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(qt).not.toContain("gradient");
  });

  it("draws a picture, inlined, and keeps it through the sanitiser", () => {
    // This compiled to nothing at all until now, so every image an operator
    // placed arrived as a gap. A data URI because the sanitiser drops an
    // `<img>` pointing anywhere else, deliberately: a greeting must not be
    // able to log the address of everybody who joins.
    const src = "data:image/svg+xml;base64,PHN2Zy8+";
    const html = compileTarget(design([block("i", "image", { x: 0, y: 0, w: 18, h: 18, src })]), "html")
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain(`<img src="${src}" width="18" height="18" alt="">`);
    expect(sanitizeHtml(html)).toContain(src);
    // And no wrapper it did not ask for: a block box around a picture removes
    // the line box, and with it the descender space every layout around one is
    // drawn against. That was the last three pixels between the rebuild and
    // the mock.
    expect(html).not.toContain("display:block");
  });

  it("drops a picture pointing anywhere but at itself", () => {
    const html = compileTarget(
      design([block("i", "image", { x: 0, y: 0, w: 18, h: 18, src: "https://example.org/a.png" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(sanitizeHtml(html)).not.toContain("example.org");
  });

  it("keeps a fractional letter spacing, which is the only useful kind", () => {
    // Inter's own metric for a 32px line is -0.022em. Rounded to whole
    // hundredths it becomes -0.02, which is a visible error on a display line.
    const html = compileTarget(
      design([block("h", "text", { x: 0, y: 0, w: 400, tracking: -2.2, text: "Hi" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("letter-spacing:-0.022em");
  });

  it("gives a button the look the design asked for", () => {
    // Every other block became a box an operator could style and this one
    // stayed a fixed accent rectangle, which made the most designed element on
    // a greeting the only one nobody could design.
    const html = compileTarget(
      design([
        block("b", "button", {
          x: 0, y: 0, w: 200,
          text: "Register", url: "https://example.org/r",
          bg: "#5e6ad2", border: "#6e79e0", borderTop: "#8b94ea", fg: "#f7f8f8",
          radius: 7, padCss: "9px 17px", size: 13.5, weight: 510,
        }),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("background-color:#5e6ad2");
    expect(html).toContain("border-top:1px solid #8b94ea");
    expect(html).toContain("padding:9px 17px");
    expect(html).toContain("font-weight:510");
    // One box, not two: it used to be wrapped in a second styled box that drew
    // the fill, the rule and the corners all over again.
    expect(html.match(/background-color:#5e6ad2/g)).toHaveLength(1);
  });

  it("does not guess an ink from a fill it cannot read", () => {
    // `inkOn` reads a hex. It used to return its dark default for a
    // translucent fill, which set the text inside every `rgba(…)` panel to
    // near-black on a dark theme.
    const html = compileTarget(
      design([block("p", "group", { x: 0, y: 0, w: 300, h: 80, bg: "rgba(255,255,255,.02)" })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).not.toMatch(/color:#[0-9a-f]{6}/i);
  });

  it("keeps the modern sheet inside the cap the server pays on every join", () => {
    // 4096 characters, spent at every handshake. The layout scaffolding used
    // to be 57% of it.
    const modern = DESIGN_TEMPLATES.find((entry) => entry.id === "modern");
    const markup = compileTarget(modern!.build(), "rich")
      .map((part) => part.literal ?? "")
      .join("");
    expect(markup.length).toBeLessThan(4096);
  });
});

/**
 * The rule and the shadow, which had almost no controls at all.
 *
 * A border could be given a colour and nothing else - it was always one pixel
 * and always solid, and the field was even called "hairline" because that was
 * the only thing it could draw. Neither shadow existed, in the design or in the
 * sanitiser's allow-list, so there was no way to say "raised" at all.
 */
suite("rules and shadows", () => {
  const boxed = (fields: Partial<Block>): string =>
    compileTarget(design([block("b", "group", { x: 0, y: 0, w: 300, h: 90, ...fields })]), "html")
      .map((part) => part.literal ?? "")
      .join("");

  it("draws a rule at the thickness and in the style it was given", () => {
    expect(boxed({ border: "#888", borderWidth: 3, borderStyle: "dashed" })).toContain(
      "border:3px dashed #888",
    );
  });

  it("keeps one pixel and solid as the defaults, so nothing moves", () => {
    expect(boxed({ border: "#888" })).toContain("border:1px solid #888");
  });

  it("draws the lit top edge in the same weight as the rule under it", () => {
    // Two different thicknesses on the same box is a box with a step in it.
    const html = boxed({ border: "#222", borderTop: "#eee", borderWidth: 2 });
    expect(html).toContain("border:2px solid #222");
    expect(html).toContain("border-top:2px solid #eee");
  });

  it("says the same thing to Qt in the vocabulary Qt has", () => {
    // No `border` shorthand there, so the three properties are written out -
    // and the style and width have to ride along or Qt draws its own default.
    const qt = compileTarget(
      design([block("b", "group", { x: 0, y: 0, w: 300, h: 90, border: "#888", borderWidth: 2, borderStyle: "dotted" })]),
      "qt",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(qt).toContain("border-style:dotted");
    expect(qt).toContain("border-width:2px");
  });

  it("carries both shadows through the sanitiser every reader renders with", () => {
    // The whole reason they can be offered: they were not on the allow-list,
    // so a design that used either would have arrived with neither and no
    // error anywhere to say so.
    const html = boxed({
      shadow: "inset 0 1px 0 0 rgba(255,255,255,0.10)",
      textShadow: "0 1px 2px rgba(0,0,0,0.55)",
    });
    const clean = sanitizeHtml(html);
    expect(clean).toContain("box-shadow:inset 0 1px 0 0 rgba(255,255,255,0.10)");
    expect(clean).toContain("text-shadow:0 1px 2px rgba(0,0,0,0.55)");
  });

  it("spares Qt a shadow it has never heard of", () => {
    const qt = compileTarget(
      design([block("b", "group", { x: 0, y: 0, w: 300, h: 90, shadow: "0 2px 4px #000" })]),
      "qt",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(qt).not.toContain("box-shadow");
  });
});

suite("sharing a row", () => {
  const row = (...kids: Partial<Block>[]): string =>
    compileTarget(
      design([
        block("r", "group", { x: 0, y: 0, w: 500, h: 60, flow: "row" }),
        ...kids.map((fields, index) =>
          block(`k${index}`, "button", {
            x: 10 + index * 200,
            y: 10,
            w: 180,
            h: 34,
            text: `B${index}`,
            url: "https://example.org",
            bg: "#5e6ad2",
            ...fields,
          }),
        ),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");

  it("lays a row out with flex, which is what makes a share possible", () => {
    // A share of what is *left over* cannot be written as a width: the labels
    // decide how much is left, and they are not known here.
    expect(row({}, {})).toContain("display:flex");
  });

  it("gives each growing child an equal share of the leftover", () => {
    const html = row({ grow: true }, { grow: true });
    expect(html.match(/flex:1 1 0/g)).toHaveLength(2);
  });

  it("leaves a child that was not told to grow at its own width", () => {
    const html = row({ grow: true }, {});
    expect(html.match(/flex:1 1 0/g)).toHaveLength(1);
  });

  it("draws a growing button as a block, so its padding fits inside its share", () => {
    // `width:100%` would measure the padding and the rule on top of the share
    // and overflow it. A block box is given the share and fits them inside.
    const html = row({ grow: true, padCss: "9px 17px" });
    expect(html).toContain("display:block");
    expect(html).toContain("padding:9px 17px");
  });

  it("centres the label of a button that is no longer the width of its words", () => {
    expect(row({ grow: true })).toContain("text-align:center");
  });

  it("keeps overlapping possible, which a container gap could not express", () => {
    // CSS `gap` cannot be negative, so the offsets stay margins - which is the
    // whole reason a cluster of avatars can overlap at all.
    expect(row({}, { gap: -11 })).toContain("margin-left:-11px");
  });

  it("divides a cells group the way its children were drawn", () => {
    // Equal was the only option. A wide tile beside a narrow one is something
    // an operator can draw and could not previously get.
    const html = compileTarget(
      design([
        block("g", "group", { x: 0, y: 0, w: 600, h: 90, flow: "cells" }),
        block("a", "text", { x: 10, y: 10, w: 400, text: "wide" }),
        block("b", "text", { x: 420, y: 10, w: 200, text: "narrow" }),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("width:67%");
    expect(html).toContain("width:33%");
  });
});

suite("what is drawn inside what", () => {
  it("does not let two blocks each be the other's parent", () => {
    // Containment by centre point alone is not an ordering: a wide short band
    // and a tall narrow column can each hold the other's middle, and a card
    // inset into the panel it sits on does exactly that. Left at that, neither
    // was a root, both were pruned as unreachable, and the whole sheet
    // compiled to *nothing* - silently, with no error anywhere.
    const html = compileTarget(
      design([
        block("panel", "group", { x: 0, y: 0, w: 560, h: 340, bg: "#111" }),
        block("card", "group", { x: 20, y: 20, w: 520, h: 300, bg: "#222" }),
        block("words", "text", { x: 40, y: 40, w: 300, h: 40, bare: true, text: "inside" }),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("inside");
    // And in the right order: the outer opens first, then the inner, then the
    // words - which is what "the card is on the panel" means in markup.
    expect(html).toMatch(/#111[^]*#222[^]*inside/);
  });

  it("puts a block in the smallest thing that holds it", () => {
    const html = compileTarget(
      design([
        block("panel", "group", { x: 0, y: 0, w: 560, h: 340, bg: "#111" }),
        block("card", "group", { x: 20, y: 20, w: 300, h: 200, bg: "#222" }),
        block("words", "text", { x: 40, y: 40, w: 200, h: 30, bare: true, text: "in the card" }),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    // The words are inside the card, so the card's box closes after them.
    expect(html).toMatch(/#222[^]*in the card[^]*<\/span>/);
  });
});

suite("pictures behind, and pictures that keep their shape", () => {
  const one = (fields: Partial<Block>, type: Block["type"] = "group"): string =>
    compileTarget(design([block("b", type, { x: 0, y: 0, w: 400, h: 200, ...fields })]), "html")
      .map((part) => part.literal ?? "")
      .join("");

  it("names the picture behind a block rather than fetching it", () => {
    // A `url()` in CSS is a fetch, and the sanitiser refuses every one of them
    // - so the markup carries the geometry and the client paints the picture
    // in from the bytes that travelled beside it.
    const html = one({ bgAsset: "hero", bgFit: "contain" });
    expect(html).toContain("fm-backdrop");
    expect(html).toContain("fm-a-hero");
    expect(html).toContain("background-size:contain");
    expect(html).toContain("background-position:center");
    expect(html).not.toContain("url(");
  });

  it("fills with cover unless the design says otherwise", () => {
    expect(one({ bgAsset: "hero" })).toContain("background-size:cover");
  });

  it("keeps the whole thing through the sanitiser", () => {
    // Every one of these properties had to be allowed for this to mean
    // anything; before that a frosted card arrived as a flat one.
    const clean = sanitizeHtml(one({ bgAsset: "hero", blurBehind: 18, bg: "rgba(0,0,0,.4)" }));
    expect(clean).toContain("fm-backdrop");
    expect(clean).toContain("backdrop-filter:blur(18px)");
    expect(clean).toContain("-webkit-backdrop-filter:blur(18px)");
    expect(clean).toContain("background-size:cover");
  });

  it("gives a fitted picture a box to be fitted into", () => {
    // `object-fit` needs something to fit *into*. A bare marker has no size, so
    // a picture told to keep its shape took its own natural size instead and
    // pushed the rest of the sheet off the page.
    const html = one({ asset: "pic", picFit: "contain", h: 250 }, "image");
    expect(html).toContain("fm-fit-contain");
    expect(html).toContain("height:250px");
  });

  it("holds a shape where one was asked for", () => {
    expect(one({ asset: "pic", ratio: "16/9" }, "image")).toContain("aspect-ratio:16/9");
  });

  it("stops a picture being greedy in a row", () => {
    // A picture's own markup says `width:100%`, which in a flex row squeezes
    // every growing sibling down to its longest word. A child that was not
    // told to grow holds the width it was drawn at.
    const html = compileTarget(
      design([
        block("r", "group", { x: 0, y: 0, w: 500, h: 200, flow: "row" }),
        block("words", "text", { x: 10, y: 10, w: 300, h: 100, grow: true, text: "hi" }),
        block("pic", "image", { x: 320, y: 10, w: 150, h: 100, asset: "p", picFit: "contain" }),
      ]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("flex:1 1 0");
    expect(html).toContain("flex:0 0 150px");
  });
});

suite("rounded corners, and what is inside them", () => {
  const one = (fields: Partial<Block>, type: Block["type"] = "group"): string =>
    compileTarget(design([block("b", type, { x: 0, y: 0, w: 120, h: 120, ...fields })]), "html")
      .map((part) => part.literal ?? "")
      .join("");

  it("clips a rounded box, because a radius alone does not", () => {
    // `border-radius` clips the element's own background and border and
    // nothing else, so a picture or a child card in the corner runs straight
    // through it. This was a rounded box with square contents.
    const html = one({ radius: 14, bg: "#111" });
    expect(html).toContain("border-radius:14px");
    expect(html).toContain("overflow:hidden");
  });

  it("does not clip a box that was never rounded", () => {
    // Applied regardless it would quietly cut off whatever a fixed-height
    // block happened to overflow, which is a different decision entirely.
    expect(one({ bg: "#111" })).not.toContain("overflow:hidden");
  });

  it("leaves a text block's own words alone", () => {
    // A block that draws its own words needs no clipping: the radius already
    // contains them, and clipping could take a descender off the last line.
    expect(one({ radius: 10, bare: true, text: "hi" }, "text")).not.toContain("overflow:hidden");
  });

  it("rounds a picture, and clips the picture to it", () => {
    const html = one({ asset: "p", picFit: "cover", radius: 12 }, "image");
    expect(html).toContain("border-radius:12px");
    expect(html).toContain("overflow:hidden");
  });

  it("makes a circle a circle rather than an ellipse", () => {
    // The width it was drawn at, not the width of whatever holds it: a 72px
    // round picture in a 320px column came out as a 320px ellipse.
    const html = compileTarget(
      design([block("b", "image", { x: 0, y: 0, w: 72, h: 72, asset: "p", picFit: "cover", round: true })]),
      "html",
    )
      .map((part) => part.literal ?? "")
      .join("");
    expect(html).toContain("width:72px");
    expect(html).toContain("max-width:100%");
    expect(html).toContain("border-radius:50%");
    // Not stretched to its container: `;width:100%` would be, `max-width` is
    // the thing that keeps a wide picture from overflowing and is fine.
    expect(html).not.toMatch(/[;"]width:100%/);
  });

  it("puts the radius straight on an inlined picture, which needs no clipping", () => {
    // An `<img>` *is* the painted box, so it rounds itself - and cannot be
    // knocked out of alignment by a wrapper that exists only to clip it.
    const html = one({ src: "data:image/webp;base64,AA", radius: 8 }, "image");
    expect(html).toMatch(/<img[^>]*border-radius:8px/);
  });

  it("keeps all of it through the sanitiser", () => {
    const clean = sanitizeHtml(one({ radius: 14, bg: "#111" }));
    expect(clean).toContain("border-radius:14px");
    expect(clean).toContain("overflow:hidden");
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

/**
 * What the old clients are actually sent.
 *
 * Mumble 1.5 and older hand the welcome text to `QTextDocument`, which renders
 * a documented subset of HTML 4 and CSS 2.1 and **drops the rest without
 * saying so**. That silence is the whole problem: markup outside the subset
 * still renders, just not as drawn, so nothing short of checking the output
 * against the list catches it.
 */
suite("what Qt is sent", () => {
  /** One of every block, so nothing is checked only by not being present. */
  const everything = (): Design =>
    design([
      block("h", "heading", { text: "Welcome aboard", size: 30, align: "center" }),
      block("t", "text", { text: "<p>Have a look around.</p>", align: "center" }),
      block("m", "mark", { glyph: "◆", align: "center", h: 72 }),
      block("d", "divider"),
      block("c", "callout", { text: "<p>The rules are pinned in #Lounge.</p>" }),
      block("q", "quote", { text: "<p>Said once, and well.</p>" }),
      block("k", "card", { text: "<p>Maintenance on Saturday.</p>" }),
      block("o", "code", { text: "connect magical.rocks" }),
      block("l", "list", { lines: ["Be kind", "Mind the topics"] }),
      block("s", "spacer", { h: 24 }),
      block("b", "button", { text: "Register", url: "https://example.org/r", style: "button" }),
      block("g", "button", { text: "Details", url: "https://example.org/d", style: "ghost" }),
      block("n", "links", {
        items: [{ kicker: "Browse", label: "Channels", url: "https://example.org/c" }],
      }),
      block("w", "columns", {
        items: [
          { kicker: "Live", label: "Status", url: "https://example.org/s" },
          { kicker: "Docs", label: "Guide", url: "https://example.org/g" },
        ],
      }),
      block("a", "table", { rows: [["Night", "Time"], ["Tuesday", "20:00"]] }),
      block("r", "rating", { stars: 4 }),
      block("u", "countdown", { text: "Until", until: "2026-10-03" }),
      block("f", "footer", { text: "<p>You will only see this once.</p>" }),
      block("v", "video", { text: "Watch", url: "https://example.org/v" }),
    ]);

  const markup = () =>
    compileTarget(everything(), "qt")
      .map((part) => part.literal ?? "")
      .join("");

  it("uses no tag and no property Qt would drop", () => {
    // `qtViolations` reads the same list the docs do, so this is the whole
    // question asked in one line.
    expect(qtViolations(markup())).toEqual([]);
  });

  it("says padding the long way, because Qt has no shorthand", () => {
    // Qt's CSS has `padding-left` and its three siblings and no `padding`.
    // The layout cells were emitting the shorthand, so every Qt cell drew
    // flush against its neighbour while the tests all passed.
    expect(markup()).not.toMatch(/style="[^"]*[^-]padding:/);
    expect(markup()).not.toMatch(/style="[^"]*[^-]margin:/);
  });

  it("aligns with the attribute, because Qt has no text-align", () => {
    const qt = markup();
    expect(qt).not.toMatch(/style="[^"]*text-align/);
    expect(qt).toContain('align="center"');
  });

  it("draws the blocks it used to drop on the floor", () => {
    // A card, a spacer and a filled button were all dropped on the grounds
    // that Qt paints no borders or backgrounds. It paints both, on a table
    // cell, which is what all three are now made of.
    const qt = markup();
    expect(qt, "card").toContain('border="1"');
    expect(qt, "spacer").toMatch(/height="24"/);
    expect(qt, "button").toContain('bgcolor="#3399dd"');
  });

  it("pairs every fill with the ink that goes on it", () => {
    // Qt draws the greeting over whatever the client's theme provides, so a
    // panel that sets a pale background and leaves the text colour alone is
    // unreadable to everybody running a dark theme.
    for (const filled of markup().matchAll(/bgcolor="([^"]+)"/g)) {
      if (filled[1] === "#3399dd" && filled.index !== undefined) {
        expect(markup().slice(filled.index)).toMatch(/color="#ffffff"/);
      }
    }
    expect(markup()).toContain('color="#1c2430"');
  });

  it("keeps every block's words, so nothing is silently lost", () => {
    const qt = markup();
    for (const said of ["Welcome aboard", "Register", "Channels", "Status", "Tuesday", "Until"]) {
      expect(qt, said).toContain(said);
    }
  });
});

suite("a Qt button", () => {
  const one = (style: Block["style"]) =>
    compileTarget(design([block("b", "button", { text: "Register", url: "https://e.org", style })]), "qt")
      .map((part) => part.literal ?? "")
      .join("");

  it("fills the solid one and writes on it in the colour that reads there", () => {
    expect(one("button")).toContain('bgcolor="#3399dd"');
    expect(one("button")).toContain('color="#ffffff"');
  });

  it("does not write a ghost button in the colour of a fill it has not got", () => {
    // The bug this pins, and it was invisible in every sense: a ghost button
    // is an outline with nothing painted behind it, so the white that reads on
    // the accent was white on the client's own background. The markup was
    // perfectly valid Qt and the button could not be seen.
    const ghost = one("ghost");
    expect(ghost).toContain('border="1"');
    expect(ghost).not.toContain("#ffffff");
    expect(ghost).toContain('color="#3399dd"');
  });

  it("leaves a link a link", () => {
    // Every row is a table on this target, so the question is not whether
    // there is one - it is whether the link got a box of its own.
    expect(one("link")).not.toContain("bgcolor");
    expect(one("link")).not.toContain('border="1"');
    expect(one("link")).toContain('color="#3399dd"');
  });
});

/**
 * The two colours a block can be given.
 *
 * A fill and an ink, on any block that draws words. The rule that matters is
 * the one about the *pair*: a greeting is read on somebody else's theme, so a
 * fill with no ink chosen must still say what colour its words are, or a pale
 * panel is blank to everyone whose client draws text light.
 */
suite("colouring a block", () => {
  const only = (target: Parameters<typeof compileTarget>[1], fields: Partial<Block>) =>
    compileTarget(design([block("h", "heading", { text: "Welcome", ...fields })]), target)
      .map((part) => part.literal ?? "")
      .join("");

  it("says nothing about colour when nothing was chosen", () => {
    // The default is the reader's own colours, which is the only choice that
    // is right on a theme this editor knows nothing about.
    expect(only("html", {})).not.toContain("color:");
    expect(only("qt", {})).not.toContain("bgcolor");
    expect(only("qt", {})).not.toContain("<font color");
  });

  it("paints the fill on the cell, in each target's own vocabulary", () => {
    expect(only("html", { bg: "#eef2f7" })).toContain("background-color:#eef2f7");
    expect(only("qt", { bg: "#eef2f7" })).toContain('bgcolor="#eef2f7"');
  });

  it("gives a fill an ink even when none was chosen", () => {
    // The invariant. A pale fill takes dark words and a dark fill takes light
    // ones, worked out rather than left to the reader's theme.
    expect(only("html", { bg: "#eef2f7" })).toContain("color:#1c2430");
    expect(only("html", { bg: "#1c2430" })).toContain("color:#ffffff");
    expect(only("qt", { bg: "#1c2430" })).toContain('<font color="#ffffff">');
  });

  it("lets a chosen ink win over the one the fill would have picked", () => {
    expect(only("html", { bg: "#eef2f7", fg: "#cc3b3b" })).toContain("color:#cc3b3b");
    expect(only("html", { bg: "#eef2f7", fg: "#cc3b3b" })).not.toContain("color:#1c2430");
    expect(only("qt", { bg: "#eef2f7", fg: "#cc3b3b" })).toContain('<font color="#cc3b3b">');
  });

  it("colours words that have no fill behind them at all", () => {
    expect(only("html", { fg: "#2f9e5f" })).toContain("color:#2f9e5f");
    expect(only("qt", { fg: "#2f9e5f" })).toContain('<font color="#2f9e5f">');
    expect(only("qt", { fg: "#2f9e5f" })).not.toContain("bgcolor");
  });

  it("still writes only what Qt reads", () => {
    expect(qtViolations(only("qt", { bg: "#1c2430", fg: "#ffffff" }))).toEqual([]);
    // Qt has the four padding properties and no shorthand, and a filled cell
    // is the one place this asks for more room than `cellpadding` gives.
    expect(only("qt", { bg: "#1c2430" })).toContain("padding-left:8px");
    expect(only("qt", { bg: "#1c2430" })).not.toMatch(/style="[^"]*[^-]padding:/);
  });

  it("leaves the plain half alone, because text has no colour", () => {
    expect(only("plain", { bg: "#1c2430", fg: "#ffffff" })).toBe("Welcome");
  });
});

/**
 * What regular Fancy Mumble is sent, and what its own sanitiser leaves of it.
 *
 * The fork does not receive the design and lay it out; there is no renderer for
 * one outside this editor. It receives **markup**, and by `target_for` in
 * `starling/crates/runtime/src/greeting.rs` the markup it receives is the
 * `rich` target - not `html`, and not `qt`.
 *
 * Then it renders that through `sanitizeHtml`, the one allow-list every
 * surface in this client filters untrusted markup through. That list keeps
 * `style` and drops `bgcolor`, `align`, `border` and `cellpadding` - which is
 * exactly why the markup targets say everything in inline CSS and only Qt uses
 * the attributes. A colour that did not survive this would be a greeting that
 * looked right in the editor and arrived grey.
 */
suite("what the fork actually receives", () => {
  const sheet = (): Design =>
    design([
      block("h", "heading", { text: "Welcome", bg: "#1c2430", align: "center" }),
      block("t", "text", { y: 200, text: "<p>Amber</p>", fg: "#cc8a1a" }),
      block("n", "notice", { y: 300, tone: "warning", text: "<p>Ask first</p>" }),
      block("p", "panel", { y: 400, bg: "#3399dd", text: "<p>Accent</p>" }),
      block("c", "card", { y: 500, bg: "#f6efe2", text: "<p>Sand</p>" }),
      block("b", "button", { y: 600, style: "button", text: "Register", url: "https://example.org/r" }),
    ]);

  const rich = () =>
    compileTarget(sheet(), "rich")
      .map((part) => part.literal ?? "")
      .join("");

  it("draws the notices and the fills on the fork's own target", () => {
    // `rich` used to differ from `html` only by dropping pictures, and it
    // still does - so everything added since has to be checked here and not
    // only on `html`, which no Fancy client is ever sent.
    const markup = rich();
    expect(markup).toContain("background-color:#1c2430");
    expect(markup).toContain("color:#cc8a1a");
    expect(markup).toContain("background-color:#3399dd");
    // The warning notice, by its rule and its mark.
    expect(markup).toContain("#cc8a1a");
    expect(markup).toContain("background-color:#fdf4e4");
  });

  it("loses none of it to the sanitiser the fork renders with", () => {
    const markup = rich();
    const clean = sanitizeHtml(markup);
    for (const kept of [
      "background-color:#1c2430",
      "background-color:#3399dd",
      "background-color:#f6efe2",
      "color:#cc8a1a",
      "color:#ffffff",
    ]) {
      expect(clean, kept).toContain(kept);
    }
    // The layout survives too: every cell and every table is still there.
    expect(clean.split("<td").length).toBe(markup.split("<td").length);
    expect(clean.split("<table").length).toBe(markup.split("<table").length);
  });

  it("never leans on an attribute the fork's sanitiser strips", () => {
    // `bgcolor` and friends are Qt's vocabulary. On this target they would be
    // removed in transit, and the greeting would arrive unpainted.
    const markup = rich();
    expect(markup).not.toContain("bgcolor=");
    expect(markup).not.toContain("cellpadding=");
    expect(markup).not.toMatch(/<td[^>]*\salign=/);
  });
});

/**
 * A colour that is a role rather than a value.
 *
 * The problem it solves: a greeting is read on somebody else's screen, in a
 * theme this operator has never seen, in a mode they did not choose. A fixed
 * colour cannot be right for all of them; a role can, because the reader's own
 * client resolves it.
 */
suite("colours that follow the reader's theme", () => {
  const one = (target: Parameters<typeof compileTarget>[1], fields: Partial<Block>) =>
    compileTarget(design([block("h", "heading", { text: "Welcome", ...fields })]), target)
      .map((part) => part.literal ?? "")
      .join("");

  it("asks the reader's client for the colour, on the targets that can be asked", () => {
    for (const target of ["rich", "html"] as const) {
      expect(one(target, { bg: "auto:accent" })).toContain("background-color:var(--color-accent");
    }
  });

  it("always carries a literal inside the variable, for a client that has none", () => {
    // `var(--x, #hex)`: the fallback is the whole reason a client that has
    // never heard of the variable still gets a painted block.
    expect(one("rich", { bg: "auto:accent" })).toContain("var(--color-accent, #3399dd)");
    expect(one("rich", { fg: "auto:muted" })).toContain("var(--color-text-secondary, #888888)");
  });

  it("sends Classic Mumble the literal alone, because Qt has no variables", () => {
    const qt = one("qt", { bg: "auto:accent" });
    expect(qt).toContain('bgcolor="#3399dd"');
    expect(qt).not.toContain("var(");
  });

  it("pairs a role with the ink that belongs on it, declared not measured", () => {
    // Luminance cannot be measured for a colour nobody knows until read time,
    // so the pairing is declared - the same invariant, kept another way.
    expect(one("rich", { bg: "auto:accent" })).toContain("color:var(--color-text-on-accent");
    expect(one("rich", { bg: "auto:surface" })).toContain("color:var(--color-text-primary");
    expect(one("qt", { bg: "auto:accent" })).toContain('<font color="#ffffff">');
  });

  it("lets a chosen ink win over the role's own pairing", () => {
    expect(one("rich", { bg: "auto:accent", fg: "#cc3b3b" })).toContain("color:#cc3b3b");
  });

  it("survives the sanitiser the fork renders with", () => {
    // A variable in an inline style is exactly the kind of thing an allow-list
    // eats, so this is the assertion the whole mechanism rests on.
    const clean = sanitizeHtml(one("rich", { bg: "auto:accent" }));
    expect(clean).toContain("var(--color-accent, #3399dd)");
    expect(clean).toContain("var(--color-text-on-accent, #ffffff)");
  });

  it("leaves the plain half alone, which has no colour to follow", () => {
    expect(one("plain", { bg: "auto:accent", fg: "auto:text" })).toBe("Welcome");
  });
});
