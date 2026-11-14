/**
 * The room inside a box a server's document draws (`boxPadding.ts`): given
 * where the document left none, the document's own where it set it, nothing
 * for what is not a box, and nothing at all outside the welcome message and
 * channel descriptions.
 */

import { describe, expect, it } from "vitest";
import { sanitizeHtml, sanitizeMessageHtml } from "../sanitizeHtml";
import { sanitizeBio } from "../bioSanitize";

const PANEL = "background-color:#0d1014;border:2px solid #3c4048";

/** The document, sanitised for a welcome, as a tree to query. */
function padded(html: string): Document {
  return new DOMParser().parseFromString(
    `<body>${sanitizeHtml(html, { padBoxes: true })}</body>`,
    "text/html",
  );
}

/**
 * What the style attribute of the first `selector` says of `property`, the
 * last declaration winning: read from the text, because jsdom's CSSOM mixes up
 * padding longhands set one at a time.
 */
function said(doc: Document, selector: string, property: string): string {
  const el = doc.querySelector(selector);
  if (el === null) throw new Error(`no ${selector}`);
  let value = "";
  for (const decl of (el.getAttribute("style") ?? "").split(";")) {
    const [name, ...rest] = decl.split(":");
    const side = property.split("-")[1];
    if (name.trim() === property) value = rest.join(":").trim();
    else if (name.trim() === property.split("-")[0] && side !== undefined) {
      const words = rest.join(":").trim().split(/\s+/);
      const [top, right = top, bottom = top, left = right] = words;
      value = { top, right, bottom, left }[side] ?? "";
    }
  }
  return value;
}

/** Each side's padding of the first `selector`, as its style says it. */
function padding(doc: Document, selector: string): string[] {
  return ["top", "right", "bottom", "left"].map((side) => said(doc, selector, `padding-${side}`));
}

const DEFAULT = ["0.6em", "0.9em", "0.6em", "0.9em"];

describe("a box with no padding of its own", () => {
  it("is a cell of a table with a border and a fill: the cell gets the room, not the table", () => {
    const doc = padded(`<table style="${PANEL}"><tr><td><p>Words</p></td></tr></table>`);
    expect(padding(doc, "td")).toEqual(DEFAULT);
    expect(padding(doc, "table")).toEqual(["", "", "", ""]);
  });

  it("is a paragraph with a fill, a list item with a border, a block span", () => {
    expect(padding(padded('<p style="background-color:#222">Filled</p>'), "p")).toEqual(DEFAULT);
    expect(padding(padded('<ul><li style="border:1px solid #888">Edged</li></ul>'), "li")).toEqual(DEFAULT);
    expect(padding(padded(`<span style="display:block;${PANEL}">A block</span>`), "span")).toEqual(DEFAULT);
  });

  it("is a link made into a button", () => {
    const doc = padded('<p><a href="https://example.org" style="background-color:#42a5f5">Register</a></p>');
    expect(padding(doc, "a")).toEqual(DEFAULT);
  });

  it("drops its first child's top margin and its last child's bottom margin", () => {
    const doc = padded(`<table style="${PANEL}"><tr><td><p>One</p><p>Two</p></td></tr></table>`);
    const [first, last] = Array.from(doc.querySelectorAll<HTMLElement>("p"));
    expect(first.getAttribute("style")).toBe("margin-top:0");
    expect(last.getAttribute("style")).toBe("margin-bottom:0");
  });

  it("keeps a margin the document set on that child", () => {
    const doc = padded(`<p style="${PANEL}"><span style="display:block;margin-top:20px">x</span></p>`);
    expect(said(doc, "span", "margin-top")).toBe("20px");
  });
});

describe("a box with padding of its own", () => {
  it("keeps every side the document set, zero included", () => {
    const doc = padded(`<table style="${PANEL}"><tr><td style="padding:0">Flush on purpose</td></tr></table>`);
    expect(padding(doc, "td")).toEqual(["0", "0", "0", "0"]);
  });

  it("keeps the sides it set and gets the room on the others", () => {
    const doc = padded(`<p style="${PANEL};padding-left:20px"><b>x</b></p>`);
    expect(padding(doc, "p")).toEqual(["0.6em", "0.9em", "0.6em", "20px"]);
  });

  it("keeps its children's margins on the sides it set", () => {
    const doc = padded(`<table style="${PANEL}"><tr><td style="padding:4px"><p>One</p></td></tr></table>`);
    expect(doc.querySelector("p")?.getAttribute("style")).toBeNull();
  });
});

describe("what is not a box", () => {
  it.each([
    ["a plain paragraph", "<p>Words</p>", "p"],
    ["a table only for layout", "<table><tr><td>Words</td></tr></table>", "td"],
    ["a highlighted word in a line", '<p>A <span style="background-color:#ff0">word</span></p>', "span"],
    ["a picture", '<img src="data:image/png;base64,iVBORw0KGgo=" style="border:1px solid red">', "img"],
    ["a border of no width", '<p style="border:0 solid red">Words</p>', "p"],
    ["a border of no style", '<p style="border:2px">Words</p>', "p"],
    ["a border set to none", '<p style="border:2px solid red;border-style:none">Words</p>', "p"],
    ["a transparent fill", '<p style="background-color:transparent">Words</p>', "p"],
    ["a fill of no alpha", '<p style="background-color:rgba(0, 0, 0, 0)">Words</p>', "p"],
  ])("gets nothing: %s", (_, html, selector) => {
    expect(padding(padded(html), selector)).toEqual(["", "", "", ""]);
  });
});

describe("other surfaces", () => {
  const BOXED = `<table style="${PANEL}"><tr><td><p>Words</p></td></tr></table>`;

  it("leave sanitizeHtml without the option exactly as it was", () => {
    expect(sanitizeHtml(BOXED)).not.toContain("padding");
    expect(sanitizeHtml(BOXED)).not.toContain("margin");
  });

  it("leave chat messages and bios untouched", () => {
    expect(sanitizeMessageHtml(BOXED)).not.toContain("padding");
    expect(sanitizeBio(BOXED)).not.toContain("padding");
  });
});

describe("an empty box", () => {
  it("gets nothing: a stripe of colour beside a callout keeps its width", () => {
    const doc = padded(
      '<table style="border-collapse:collapse"><tr><td style="width:4px;background-color:#3399dd"></td>' +
        '<td style="background-color:#eaf4fc">Words</td></tr></table>',
    );
    expect(padding(doc, "td")).toEqual(["", "", "", ""]);
    expect(padding(doc, "td + td")).toEqual(DEFAULT);
  });
});
