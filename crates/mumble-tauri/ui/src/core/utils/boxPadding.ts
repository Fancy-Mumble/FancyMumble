/**
 * Room inside the boxes a server's document draws.
 *
 * A welcome message or a channel description often draws a panel of its own: a
 * table with a border and a fill, a paragraph with a background. Written by
 * hand, such a panel often says nothing about the room inside it, and a
 * browser then sets the text against its edge. The rule, the same in the
 * native client (`src/ui/gpui/src/page/style.rs`):
 *
 * - A *box* is a block, a table cell or a button-like link (`<a>`) that has a
 *   visible border or a fill of its own, or a cell of a table that has one.
 *   A table's own padding is not used when its borders collapse, so a table
 *   that is a box passes the room to its cells.
 * - A side whose padding the document set (`padding` or `padding-<side>`, zero
 *   included) keeps the document's value. Every other side of a box gets
 *   {@link BOX_PADDING}.
 * - Where a box got that room above, its first child's own top margin is
 *   dropped, and below, its last child's bottom margin: a paragraph's 1em
 *   would otherwise stand on top of the padding and leave the box lopsided. A
 *   margin the document set on the child stands.
 * - Nothing else gets anything: a plain paragraph, a table used only for
 *   layout, a picture, a highlighted word in a line, and a box with nothing
 *   in it (a stripe of colour beside a callout, a swatch): there is no text
 *   to keep off its edge, and room would only change its shape.
 *
 * Only for those two surfaces: {@link sanitizeHtml} applies it when asked,
 * and chat messages and bios never ask.
 */

/** The room a box gets where the document gave it none: above and below, and at the sides. */
export const BOX_PADDING = { vertical: "0.6em", horizontal: "0.9em" } as const;

const SIDES = ["top", "right", "bottom", "left"] as const;
type Side = (typeof SIDES)[number];

/** Elements laid out as blocks unless their style says otherwise. */
const BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "ul", "ol", "li"]);
/** `display` values that make an element a box of its own. */
const BLOCK_DISPLAY = /^(block|inline-block|flex|inline-flex|grid|inline-grid|flow-root|list-item|table|table-cell)$/;
const BORDER_STYLES = new Set([
  "none",
  "hidden",
  "dotted",
  "dashed",
  "solid",
  "double",
  "groove",
  "ridge",
  "inset",
  "outset",
]);

/** A style attribute, as its declarations in order, names in lower case. */
function declarations(el: Element): [string, string][] {
  return (el.getAttribute("style") ?? "")
    .split(";")
    .map((decl): [string, string] | null => {
      const colon = decl.indexOf(":");
      if (colon < 0) return null;
      return [decl.slice(0, colon).trim().toLowerCase(), decl.slice(colon + 1).trim().toLowerCase()];
    })
    .filter((decl): decl is [string, string] => decl !== null);
}

/** The values of a one-to-four-value shorthand, one per side. */
function perSide(values: string[]): Record<Side, string> {
  const [top, right = top, bottom = top, left = right] = values;
  return { top, right, bottom, left };
}

function isZero(width: string): boolean {
  return /^0(\.0*)?[a-z%]*$/.test(width);
}

/** Whether any side of a border these declarations draw can be seen. */
function hasBorder(decls: [string, string][]): boolean {
  const style: Record<Side, string> = { top: "none", right: "none", bottom: "none", left: "none" };
  const width: Record<Side, string> = { top: "medium", right: "medium", bottom: "medium", left: "medium" };
  for (const [name, value] of decls) {
    const words = value.split(/\s+/).filter(Boolean);
    const side = /^border-(top|right|bottom|left)$/.exec(name)?.[1] as Side | undefined;
    if (name === "border" || side !== undefined) {
      const said = words.find((word) => BORDER_STYLES.has(word)) ?? "none";
      const wide = words.find((word) => /^(thin|medium|thick|[\d.]+[a-z%]*)$/.test(word)) ?? "medium";
      for (const each of side === undefined ? SIDES : [side]) {
        style[each] = said;
        width[each] = wide;
      }
    } else if (name === "border-style" && words.length > 0) {
      Object.assign(style, perSide(words));
    } else if (name === "border-width" && words.length > 0) {
      Object.assign(width, perSide(words));
    }
  }
  return SIDES.some((each) => style[each] !== "none" && style[each] !== "hidden" && !isZero(width[each]));
}

/** Whether these declarations give the element a fill that can be seen. */
function hasFill(decls: [string, string][]): boolean {
  let fill = false;
  for (const [name, value] of decls) {
    if (name !== "background" && name !== "background-color" && name !== "background-image") continue;
    const clear =
      /^(transparent|none|initial|inherit|unset|revert|currentcolor)?$/.test(value) ||
      /^(rgba|hsla)\(.*[,/]\s*0(\.0*)?%?\s*\)$/.test(value) ||
      /^#([0-9a-f]{3}0|[0-9a-f]{6}00)$/.test(value);
    fill = !clear;
  }
  return fill;
}

function isBox(el: Element): boolean {
  const decls = declarations(el);
  return hasBorder(decls) || hasFill(decls);
}

/** Whether an element is laid out as a box of its own: a block, or a link made into a button. */
function standsAlone(el: Element, decls: [string, string][]): boolean {
  const tag = el.tagName.toLowerCase();
  const display = decls.filter(([name]) => name === "display").pop()?.[1];
  if (display !== undefined) return BLOCK_DISPLAY.test(display);
  return BLOCKS.has(tag) || tag === "a" || tag === "td" || tag === "th";
}

/** The sides of an element whose padding its style sets. */
function paddedSides(decls: [string, string][]): Set<Side> {
  const sides = new Set<Side>();
  for (const [name] of decls) {
    if (name === "padding") SIDES.forEach((side) => sides.add(side));
    const side = /^padding-(top|right|bottom|left)$/.exec(name)?.[1] as Side | undefined;
    if (side !== undefined) sides.add(side);
  }
  return sides;
}

/** Whether an element's style sets its margin on `side`. */
function hasMargin(el: Element, side: Side): boolean {
  return declarations(el).some(([name]) => name === "margin" || name === `margin-${side}`);
}

/** The element at one end of `box`'s contents, if nothing but white space stands before (or after) it. */
function endChild(box: Element, first: boolean): Element | null {
  const nodes = Array.from(box.childNodes);
  for (const node of first ? nodes : nodes.reverse()) {
    if (node.nodeType === 3 && (node.textContent ?? "").trim() === "") continue;
    return node.nodeType === 1 ? (node as Element) : null;
  }
  return null;
}

function addStyle(el: Element, declaration: string): void {
  const style = (el.getAttribute("style") ?? "").trim();
  el.setAttribute("style", style === "" ? declaration : `${style.replace(/;$/, "")};${declaration}`);
}

/** Give every box under `root` the room the rule above says, in place. */
export function padBoxes(root: ParentNode): void {
  for (const el of Array.from(root.querySelectorAll("*"))) {
    const tag = el.tagName.toLowerCase();
    if (tag === "table" || tag === "img" || tag === "hr" || tag === "br") continue;
    const decls = declarations(el);
    if (!standsAlone(el, decls)) continue;
    const cell = tag === "td" || tag === "th";
    const table = cell ? el.closest("table") : null;
    if (!(hasBorder(decls) || hasFill(decls) || (table !== null && isBox(table)))) continue;
    if ((el.textContent ?? "").trim() === "" && el.querySelector("img") === null) continue;
    const set = paddedSides(decls);
    for (const side of SIDES) {
      if (set.has(side)) continue;
      const room = side === "top" || side === "bottom" ? BOX_PADDING.vertical : BOX_PADDING.horizontal;
      addStyle(el, `padding-${side}:${room}`);
    }
    if (!set.has("top")) {
      const first = endChild(el, true);
      if (first !== null && !hasMargin(first, "top")) addStyle(first, "margin-top:0");
    }
    if (!set.has("bottom")) {
      const last = endChild(el, false);
      if (last !== null && !hasMargin(last, "bottom")) addStyle(last, "margin-bottom:0");
    }
  }
}
