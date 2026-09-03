/**
 * A positioned design, compiled for the clients that cannot draw one.
 *
 * A native client is sent the design and lays it out itself. Everything else -
 * stock Mumble, an old Fancy build, a server with `allow_html` off - is sent
 * markup, and this is where that markup is made. It runs in the editor, at save
 * time, once: the server stores what comes out and assembles it per peer. No
 * layout engine in Rust, and no second implementation of anything the editor
 * already knows.
 *
 * ## Rows
 *
 * The base design has absolute positions and none of these targets does. Qt has
 * no `position` at all, and the sanitiser every HTML surface renders through
 * allows no flexbox and no grid, so **a table is the only layout primitive that
 * survives the trip** - which is exactly what the hand-written welcome screens
 * this replaces were built out of.
 *
 * So positions are turned into rows: blocks whose vertical extents overlap are
 * one row, ordered left to right within it, and each row becomes a `<tr>` with
 * a cell per block and widths taken from the design. A single-column design -
 * which most are - comes out as one cell per row and reads exactly as drawn.
 * Two cards side by side come out side by side. Nothing has to be re-authored
 * per target, and nothing is positioned by a client that cannot position.
 *
 * ## Parts
 *
 * The output is a *list*, not a string, because two things are only known when
 * somebody actually connects: which gated blocks are on, and what text is wired
 * into each slot. A part carries the condition that switches it on and the
 * server drops it or keeps it; a slot part names an input and the server
 * substitutes. Assembly is a loop over a list.
 */

import { escapeHtml, plainTextOf } from "./markup";
import { qtSafe } from "./qtHtml";
import { flowOf, isFlat, type Block, type Design, type Variant } from "./design";

/**
 * One piece of a compiled greeting.
 *
 * Exactly one of `literal` and `slot` is set. `visibleIf` names a condition, or
 * is absent for a part that is always sent.
 */
export interface Part {
  readonly literal?: string;
  readonly slot?: string;
  readonly visibleIf?: string;
}

/** How the four markup targets separate their parts when assembled. */
export const JOIN: Record<Variant, string> = {
  // Each part is a table row or a block that closes itself.
  html: "",
  rich: "",
  qt: "",
  // Text has nothing to close, so the separation has to be real.
  plain: "\n\n",
};

/* -- Rows ------------------------------------------------------------------ */

/**
 * How far apart two tops may be and still be one row.
 *
 * Four grid steps. Blocks put side by side are aligned by eye against a 4px
 * grid, so they end up within a few pixels of each other; blocks meant to be
 * stacked are a line apart at the very least.
 *
 * Proximity of *tops* rather than overlap of extents, and that is deliberate:
 * most blocks carry no height - it is their content's - so an extent would have
 * to be guessed, and a guess of 28px silently welds a rule to the paragraph
 * below it. A tall block beside two stacked ones is the case this gets
 * conservatively wrong, splitting it into two rows rather than inventing a
 * nested cell; the operator sees exactly that on the target tab.
 */
const ROW_TOLERANCE = 16;

/**
 * The blocks grouped into rows, in reading order.
 *
 * Two blocks are in the same row when their tops line up. Within a row, left to
 * right; between rows, top to bottom.
 *
 * Geometric rather than a stored grouping: an operator drags a card up beside
 * another and they become a row, with nothing to press and no group to keep in
 * step with what is on the sheet.
 */
export function rowsOf(blocks: readonly Block[]): Block[][] {
  const ordered = [...blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: Block[][] = [];
  for (const block of ordered) {
    const row = rows.at(-1);
    if (row && block.y - row[0].y <= ROW_TOLERANCE) row.push(block);
    else rows.push([block]);
  }
  for (const row of rows) row.sort((a, b) => a.x - b.x);
  return rows;
}

/** Each block's share of its row, as a percentage that adds to 100. */
function widths(row: readonly Block[]): number[] {
  const total = row.reduce((sum, block) => sum + block.w, 0) || 1;
  // Against the row rather than the sheet: a row of one is full width however
  // narrow it was drawn, which is what a reader in a chat pane needs.
  return row.map((block) => Math.max(1, Math.round((block.w / total) * 100)));
}

/* -- Compiling ------------------------------------------------------------- */

/**
 * A design as parts, for one markup target.
 *
 * A gated block becomes its own part so the server can drop it; a row holding
 * one is split, because half a table row is not a table row. A row whose blocks
 * are all ungated stays one part, which keeps the common case to one string.
 */
export function compileTarget(design: Design, target: Variant): Part[] {
  const shown = flowOf(design, target);
  if (shown.length === 0) return [];
  if (isFlat(target)) return shown.map((block) => plainPart(block));

  const parts: Part[] = [];
  for (const row of rowsOf(shown)) {
    const share = widths(row);
    // A row is one part unless something in it is decided per peer. A gate can
    // remove a cell and a slot is substituted whole, and either would leave the
    // server re-balancing a table - which is a layout engine in Rust, and the
    // one thing this design exists to avoid.
    const perPeer = row.some((block) => block.gate !== undefined || block.type === "slot");
    if (!perPeer) {
      parts.push({ literal: rowMarkup(row, share, target) });
      continue;
    }
    for (const [index, block] of row.entries()) {
      parts.push(withGate(block, rowMarkup([block], [share[index]], target)));
    }
  }
  return parts;
}

/** Every target, as the editor stores them. */
export function compileAll(design: Design): Record<Variant, Part[]> {
  return {
    plain: compileTarget(design, "plain"),
    rich: compileTarget(design, "rich"),
    html: compileTarget(design, "html"),
    qt: compileTarget(design, "qt"),
  };
}

/** A block's markup part, carrying its gate and its slot where it has one. */
function withGate(block: Block, literal: string): Part {
  const part: Part = block.type === "slot" ? { slot: block.slot ?? "" } : { literal };
  return block.gate ? { ...part, visibleIf: block.gate } : part;
}

function plainPart(block: Block): Part {
  const part: Part = block.type === "slot" ? { slot: block.slot ?? "" } : { literal: plainOf(block) };
  return block.gate ? { ...part, visibleIf: block.gate } : part;
}

/* -- Markup ---------------------------------------------------------------- */

const cell = (attributes: string, body: string) => `<td ${attributes}>${body}</td>`;

/** One row of the layout table. */
function rowMarkup(row: readonly Block[], share: readonly number[], target: Variant): string {
  const cells = row
    .map((block, index) => {
      const align = block.align ?? "left";
      const inner = target === "qt" ? qtBlock(block) : htmlBlock(block);
      return cell(`width="${share[index]}%" valign="top" align="${align}" style="padding:6px"`, inner);
    })
    .join("");
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${cells}</tr></table>`;
}

/** A colour that reads on a light surface and a dark one. */
const ACCENT = "#3399dd";
const QUIET = "#888888";
const ON_ACCENT = "#ffffff";

/** One block, in markup a browser renders. */
function htmlBlock(block: Block): string {
  const text = escapeHtml(block.text ?? "");
  switch (block.type) {
    case "heading":
      return `<h2 style="margin:0;font-size:${block.size ?? 24}px">${text}</h2>`;
    case "text":
      return `<p style="margin:0;font-size:${block.size ?? 14}px">${text}</p>`;
    case "mark":
      return `<p style="margin:0;font-size:${block.h ?? 40}px">${escapeHtml(block.glyph ?? "")}</p>`;
    case "divider":
      return "<hr>";
    case "callout":
      return `<blockquote style="margin:0">${text}</blockquote>`;
    case "button":
      return button(block, false);
    case "links":
      return links(block, false);
    case "image":
    case "theme":
    case "slot":
      // The artwork is the server's livery, which no markup here can reach; a
      // theme is a container the editor draws and a reader never sees; a slot
      // is substituted rather than rendered.
      return "";
  }
  return "";
}

/** One block, in markup Qt renders. */
function qtBlock(block: Block): string {
  const text = escapeHtml(block.text ?? "");
  switch (block.type) {
    case "heading":
      return `<font size="+2"><b>${text}</b></font>`;
    case "text":
      return text;
    case "mark":
      return `<font size="+3" color="${ACCENT}"><b>${escapeHtml(block.glyph ?? "")}</b></font>`;
    case "divider":
      return "<hr>";
    case "callout":
      return `<font color="${QUIET}"><i>${text}</i></font>`;
    case "button":
      return button(block, true);
    case "links":
      return links(block, true);
    default:
      return "";
  }
}

/**
 * A button.
 *
 * A filled cell with a link in it, which is what a button is in markup that has
 * no button. Qt only ever gets the link form, because a filled cell inside a
 * layout cell is a table two deep and it draws badly.
 */
function button(block: Block, qt: boolean): string {
  const label = escapeHtml(block.text ?? "");
  const href = escapeHtml(block.url ?? "");
  const asLink = qt || block.style === "link" || href === "";
  const inner = href
    ? `<a href="${href}" style="text-decoration:none;color:${asLink ? ACCENT : ON_ACCENT}"><b>${label}</b></a>`
    : `<b>${label}</b>`;
  if (asLink) return inner;
  return (
    `<table cellpadding="8" cellspacing="0" border="0"><tr>` +
    cell(`bgcolor="${ACCENT}" align="center"`, inner) +
    `</tr></table>`
  );
}

/** A row of link cards, which on Qt is a list because cells nest badly. */
function links(block: Block, qt: boolean): string {
  const items = (block.items ?? []).filter((item) => item.label !== "");
  if (items.length === 0) return "";
  const one = (item: (typeof items)[number]) => {
    const kicker = item.kicker
      ? `<font color="${QUIET}" size="-1">${escapeHtml(item.kicker.toUpperCase())}</font><br>`
      : "";
    const label = escapeHtml(item.label);
    const link = item.url
      ? `<a href="${escapeHtml(item.url)}" style="color:${ACCENT}"><b>${label} &rarr;</b></a>`
      : `<b>${label}</b>`;
    return kicker + link;
  };
  if (qt) return `<ul>${items.map((item) => `<li>${one(item)}</li>`).join("")}</ul>`;
  const width = Math.floor(100 / items.length);
  const cells = items
    .map((item) => cell(`width="${width}%" valign="top" style="padding:6px"`, one(item)))
    .join("");
  return `<table width="100%" cellspacing="0" cellpadding="0" border="0"><tr>${cells}</tr></table>`;
}

/** One block as text, which is all the plain target has. */
function plainOf(block: Block): string {
  switch (block.type) {
    case "heading":
    case "text":
    case "callout":
      return block.text ?? "";
    case "button": {
      const label = block.text ?? "";
      return block.url ? `${label}: ${block.url}` : label;
    }
    case "links":
      return (block.items ?? [])
        .filter((item) => item.label !== "")
        .map((item) => (item.url ? `${item.label}: ${item.url}` : item.label))
        .join("\n");
    default:
      return "";
  }
}

/**
 * The parts assembled here, for the preview.
 *
 * The same walk the server does, so what an operator sees is what will be
 * sent - conditions resolved from the design's own preview toggles, slots from
 * whatever the wired snippets say.
 */
export function assemble(
  parts: readonly Part[],
  target: Variant,
  resolve: { condition: (name: string) => boolean; slot: (name: string) => string },
): string {
  return parts
    .filter((part) => part.visibleIf === undefined || resolve.condition(part.visibleIf))
    .map((part) => (part.slot === undefined ? (part.literal ?? "") : slotBody(part.slot, target, resolve)))
    .filter((piece) => piece.trim() !== "")
    .join(JOIN[target]);
}

function slotBody(name: string, target: Variant, resolve: { slot: (name: string) => string }): string {
  const html = resolve.slot(name);
  if (html === "") return "";
  if (target === "plain") return plainTextOf(html);
  if (target === "qt") return qtSafe(html);
  return html;
}
