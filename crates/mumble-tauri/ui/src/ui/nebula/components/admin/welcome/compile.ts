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

import { sanitizeHtml } from "@core/utils/sanitizeHtml";
import { escapeHtml, plainTextOf, richBody, splitInlineSlots } from "./markup";
import { qtSafe } from "./qtHtml";
import {
  NOTICE_STYLE,
  carriesInline,
  fixedColour,
  inkFor,
  themedColour,
  flowOf,
  isFlat,
  nest,
  type Block,
  type Design,
  type Nested,
  type Variant,
} from "./design";

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
  /**
   * The condition that switches this part *off*.
   *
   * What makes an A/B block one block: the two branches compile to two parts on
   * the same condition, one kept when it holds and one when it does not, and
   * the server never has to know they belong together.
   */
  readonly visibleUnless?: string;
  /**
   * Join this part to the one before it with nothing between them.
   *
   * What makes an inline usage inline. A paragraph carrying `{{name}}` compiles
   * to three parts - the words before, the input, the words after - and on the
   * plain target `JOIN` would otherwise put a blank line inside a sentence.
   */
  readonly inline?: boolean;
  /** A slot part only: what is sent when the input arrives empty. */
  readonly fallback?: string;
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
  if (isFlat(target)) {
    return shown.flatMap((block) =>
      partsOf(block, { open: "", inner: plainOf(block), close: "" }, target),
    );
  }
  return partsOfLevel(nest(shown), target);
}

/**
 * One level of the tree as parts: rows of blocks, and groups holding more.
 *
 * Recursive because a group is a block like any other from the outside and a
 * whole sheet from the inside. What it may *not* do is flatten: a group's
 * markup has to open before its children and close after them, and the parts
 * in between still carry their own gates and slots, which is why this returns
 * a list rather than a string.
 */
function partsOfLevel(nodes: readonly Nested[], target: Variant): Part[] {
  const parts: Part[] = [];
  const blocks = nodes.map((node) => node.block);
  const kids = new Map(nodes.map((node) => [node.block.id, node.children]));
  for (const row of rowsOf(blocks)) {
    const share = widths(row);
    if (row.length === 1 && row[0].type === "group") {
      parts.push(...groupParts(row[0], kids.get(row[0].id) ?? [], target));
      continue;
    }
    // A row of more than one, where some may be groups: each cell is opened
    // and closed around whatever is inside it.
    if (row.some((block) => block.type === "group")) {
      parts.push({ literal: `<table ${tableAttrs(target)}><tr>` });
      for (const [index, block] of row.entries()) {
        const inner = kids.get(block.id) ?? [];
        parts.push({ literal: `<td ${cellAttrs(target, { width: share[index], align: "left" })}>` });
        parts.push(
          ...(block.type === "group"
            ? groupParts(block, inner, target)
            : partsOf(block, rowWrap(block, 100, target), target)),
        );
        parts.push({ literal: "</td>" });
      }
      parts.push({ literal: "</tr></table>" });
      continue;
    }
    // A row is one part unless something in it is decided per peer. A gate can
    // remove a cell and a slot is substituted whole, and either would leave the
    // server re-balancing a table - which is a layout engine in Rust, and the
    // one thing this design exists to avoid.
    const perPeer = row.some(
      (block) =>
        block.gate !== undefined ||
        block.type === "slot" ||
        (carriesInline(block.type) && (block.text ?? "").includes("{{")),
    );
    if (!perPeer) {
      parts.push({ literal: rowMarkup(row, share, target) });
      continue;
    }
    for (const [index, block] of row.entries()) {
      parts.push(...partsOf(block, rowWrap(block, share[index], target), target));
    }
  }
  return parts;
}

/**
 * A group, opened around its children and closed after them.
 *
 * The three flows are three different questions and not one with a setting:
 *
 * * **stack** puts each child on its own line, which is the ordinary sheet.
 * * **row** puts them side by side at their own widths, `gap` apart. A
 *   negative gap overlaps them, which is all an avatar cluster is.
 * * **cells** divides the width into equal columns with `gap` of gutter, which
 *   is what two cards beside each other want and what a row of three
 *   overlapping circles very much does not.
 */
function groupParts(node: Block, children: readonly Nested[], target: Variant): Part[] {
  // A group holding something is as tall as what it holds; an empty one is the
  // box it was drawn as. That is decided here rather than by the operator,
  // because it is not a choice - a card frozen at the height of its outline is
  // a card with a hole in the bottom of it.
  const group: Block = children.length === 0 ? node : { ...node, boxed: false };
  const gate = group.gate ? { visibleIf: group.gate } : {};
  const { bg, fg } = colours(group, target);
  const flow = group.flow ?? "stack";

  if (legacyLayout(target)) {
    // Qt has no block box that carries paint, so a group there is the table it
    // has always had to be. A row and a stack are both one column of cells;
    // only `cells` is genuinely several, and Qt draws that as it draws any row.
    const open =
      `<table ${tableAttrs(target)}><tr><td ${cellAttrs(target, {
        width: 100,
        align: group.align ?? "left",
        style: cellStyle(group, target),
        bg,
        fg,
      })}>` + (fg ? `<font color="${fg}">` : "");
    return [
      { literal: open, ...gate },
      ...childParts(children, flow, target, gate),
      { literal: `${fg ? "</font>" : ""}</td></tr></table>`, ...gate },
    ];
  }

  const box =
    `${fill(group, bg, target)}${fg ? `color:${fg};` : ""}` +
    `${group.align && group.align !== "left" ? `text-align:${group.align};` : ""}`;
  // A group in a row is a box at the width it was drawn; a group on its own
  // line fills what it is given. The first is how a 30px circle stays a 30px
  // circle, and the second is how a panel stays as wide as the message.
  // A row is laid out with flex, which is the only way a child can be given a
  // *share of what is left over* rather than a width of its own. The offsets
  // between children stay margins rather than the container's `gap`, because
  // `gap` cannot be negative and overlapping is the whole point of a cluster.
  //
  // Centred down the row by default: a 30px disc beside a text pill has two
  // different baselines, and lining up the text in them puts the disc
  // somewhere nobody asked for.
  const laid =
    flow === "row" && !legacyLayout(target) ? "display:flex;align-items:center;" : "display:block;";
  const sized = group.fit === true ? `display:inline-block;width:${group.w}px;` : laid;
  const style = `${sized}${box}`.replace(/;$/, "") + cellStyle(group, target);
  return [
    { literal: `<span${wrapperClass(group)} style="${style}">`, ...gate },
    ...childParts(children, flow, target, gate),
    { literal: "</span>", ...gate },
  ];
}

/** The children of a group, laid out the way its flow asks for. */
function childParts(
  children: readonly Nested[],
  flow: "stack" | "row" | "cells",
  target: Variant,
  gate: { visibleIf?: string },
): Part[] {
  if (children.length === 0) return [];
  if (flow === "stack" || legacyLayout(target)) return partsOfLevel(children, target);

  const ordered = [...children].sort((a, b) => a.block.x - b.block.x);
  if (flow === "row") {
    // Side by side at their own widths. The gap is a margin on every child but
    // the first, so a negative one overlaps them - which is the only way to
    // draw a cluster of avatars, and the reason `gap` is not clamped at zero.
    return ordered.flatMap((node, index) => {
      const gap = index === 0 ? undefined : (node.block.gap ?? 0);
      return inlineChild(node, gap, target, gate);
    });
  }
  // Equal columns with a gutter, which is a table because nothing else divides
  // a width in markup that survives the sanitiser.
  // Proportional to how they were drawn, rather than always equal. Two tiles
  // of the same size are the common case and come out the same either way, but
  // a wide one beside a narrow one is a thing an operator can draw and could
  // not previously get.
  const share = widths(ordered.map((node) => node.block));
  const parts: Part[] = [{ literal: `<table ${tableAttrs(target, ";width:100%")}><tr>`, ...gate }];
  for (const [index, node] of ordered.entries()) {
    const gap = node.block.gap ?? 0;
    const side =
      index === 0 ? `padding-right:${gap}px`
      : index === ordered.length - 1 ? `padding-left:${gap}px`
      : `padding-left:${gap}px;padding-right:${gap}px`;
    parts.push({
      literal: `<td style="width:${share[index]}%;vertical-align:top;${side}">`,
      ...gate,
    });
    parts.push(
      ...(node.block.type === "group"
        ? groupParts(node.block, node.children, target)
        : partsOf(node.block, rowWrap(node.block, 100, target), target)),
    );
    parts.push({ literal: "</td>", ...gate });
  }
  parts.push({ literal: "</tr></table>", ...gate });
  return parts;
}

/** One child of a `row` group: an inline box, offset from the one before it. */
function inlineChild(
  node: Nested,
  gap: number | undefined,
  target: Variant,
  gate: { visibleIf?: string },
): Part[] {
  const spaced =
    `${gap === undefined ? "" : `margin-left:${gap}px;`}` +
    // An equal share of what is left over, not a width: two growing buttons
    // take half each whatever their labels say, which is the difference
    // between a pair that spans the card and a pair huddled at the left.
    // A grower takes an equal share of the leftover; everything else holds the
    // width it was drawn at. Without the second half a child whose own markup
    // says `width:100%` - a picture, say - is greedy in a flex row and squeezes
    // the growers down to their longest word.
    `${node.block.grow === true ? "flex:1 1 0;" : `flex:0 0 ${node.block.w}px;`}`;
  if (node.block.type === "group") {
    const inner = groupParts({ ...node.block, fit: true }, node.children, target);
    // The offset rides on the box the group already opens, rather than on a
    // wrapper around it: one span fewer per avatar, against a cap paid on
    // every join.
    const [head, ...rest] = inner;
    return [
      { ...head, literal: (head.literal ?? "").replace('style="', `style="${spaced}`) },
      ...rest,
    ];
  }
  if (selfBoxed(node.block)) {
    // A painted button and an image are already one inline box each. Wrapping
    // either in a second one drew the fill, the rule and the corners twice -
    // a button inside a button - so the offset rides on the box it already has.
    const own = htmlBlock(node.block);
    return [
      {
        literal:
          spaced === "" ? own : own.replace(/style="/, `style="${spaced}`),
        ...gate,
      },
    ];
  }
  const wrap = rowWrap({ ...node.block, fit: true }, 100, target);
  const opened = { ...wrap, open: wrap.open.replace('style="', `style="${spaced}`) };
  return partsOf(node.block, opened, target).map((part) => ({ ...part, ...gate }));
}

/** Every target, as the editor stores them. */
export function compileAll(design: Design): Record<Variant, Part[]> {
  // A target the sheet does not claim gets nothing, and the server falls back
  // to the greeting's written halves for those readers - which is the right
  // answer for a design whose whole vocabulary that target lacks.
  const on = (target: Variant): Part[] =>
    design.only !== undefined && !design.only.includes(target) ? [] : compileTarget(design, target);
  return {
    plain: on("plain"),
    rich: on("rich"),
    html: on("html"),
    qt: on("qt"),
  };
}

/**
 * A block's parts, carrying its gate and its slots where it has any.
 *
 * A list rather than a part, because one text block holding two inline usages
 * is several parts - and a hidden usage is none at all, which is what hiding
 * one means: it is still in the design, and it is not in the message.
 *
 * The split runs *inside* the layout cell, never across it. Three parts each
 * wrapped in their own table would put a sentence on three lines; instead the
 * cell's opening tags ride on the first part and its closing tags on the last,
 * and because every part of one block carries that block's gate, they are kept
 * or dropped together and the tags stay balanced.
 */
function partsOf(block: Block, wrap: Wrap, target: Variant): Part[] {
  const gate = block.gate ? { visibleIf: block.gate } : {};

  if (block.type === "slot") {
    // A hidden slot block sends nothing, but its row was already laid out
    // around it - which is exactly why hiding is not deleting.
    if (block.hidden) return [];
    const body: Part = {
      slot: block.slot ?? "",
      ...(block.fallback ? { fallback: block.fallback } : {}),
      ...gate,
    };
    // A slot used to be the one block that threw its cell away, so everything
    // the design said *about* it - its border, its padding, its size - was
    // dropped and the wired snippet arrived as bare markup in the middle of a
    // laid-out page. The wrap rides as its own literals instead: the wire
    // format has nowhere to put an "around" on a slot part, and it does not
    // need one, because both assemblers join markup parts with nothing and
    // every part here carries the same gate, so the tags stay balanced.
    //
    // The cost is one edge: a slot with nothing wired to it leaves the empty
    // box behind. That is already a named problem in the editor - "the text
    // input X has nothing wired to it" - so it is a state an operator is told
    // about rather than one they ship.
    if (wrap.open === "" && wrap.close === "") return [body];
    return [
      { literal: wrap.open, ...gate },
      { ...body, inline: true },
      { literal: wrap.close, inline: true, ...gate },
    ];
  }

  // The two blocks that are *several* messages rather than one. Each branch is
  // a part on the same condition, so the server keeps whichever holds and never
  // has to know the two belong together.
  if (block.type === "ab") {
    if (!block.gate) return [];
    return [
      { literal: wrap.open + renderCopy({ ...block, type: "text" }, target) + wrap.close, visibleIf: block.gate },
      {
        literal:
          wrap.open + renderCopy({ ...block, type: "text", text: block.altText }, target) + wrap.close,
        visibleUnless: block.gate,
      },
    ].filter((part) => part.literal.trim() !== wrap.open + wrap.close);
  }

  if (block.type === "toggles") {
    return (block.items ?? [])
      .filter((item) => item.kicker !== "" && item.label !== "")
      .map((item) => ({
        literal:
          wrap.open + renderCopy({ ...block, type: "text", text: item.label }, target) + wrap.close,
        visibleIf: item.kicker,
      }));
  }

  // A repeater draws its input's value as one region. Per-item templating would
  // need the server to split a value and run this design once per piece, which
  // it has no way to do - so what it compiles to is the value, and the
  // inspector says as much rather than the block quietly doing less than it
  // looks like it does.
  if (block.type === "repeater") {
    if (!block.slot || block.hidden) return [];
    return [{ slot: block.slot, ...(block.fallback ? { fallback: block.fallback } : {}), ...gate }];
  }

  const body = block.text ?? "";
  if (!carriesInline(block.type) || !body.includes("{{")) {
    return [{ literal: wrap.open + wrap.inner + wrap.close, ...gate }];
  }

  const parts: Part[] = [];
  for (const piece of splitInlineSlots(body)) {
    if ("slot" in piece) {
      if (piece.hidden) continue;
      parts.push({ slot: piece.slot, inline: parts.length > 0, ...gate });
      continue;
    }
    const rendered = renderCopy({ ...block, text: piece.literal }, target);
    if (rendered.trim() === "") continue;
    parts.push({ literal: rendered, inline: parts.length > 0, ...gate });
  }

  if (parts.length === 0) return [];

  // The cell's tags on the outermost parts. A leading slot gets a literal of
  // its own to hang the opening tags on rather than being merged into it.
  const first = parts[0];
  if (first.literal === undefined) parts.unshift({ literal: wrap.open, ...gate });
  else parts[0] = { ...first, literal: wrap.open + first.literal };

  const last = parts[parts.length - 1];
  if (last.literal === undefined) parts.push({ literal: wrap.close, inline: true, ...gate });
  else parts[parts.length - 1] = { ...last, literal: last.literal + wrap.close };

  return parts;
}

/** A block's markup, and the layout tags that go around it. */
interface Wrap {
  readonly open: string;
  readonly inner: string;
  readonly close: string;
}

/** One run of a block's copy, in whatever markup the target reads. */
function renderCopy(block: Block, target: Variant): string {
  if (target === "plain") return plainOf(block);
  return target === "qt" ? qtBlock(block) : htmlBlock(block);
}

/* -- Markup ---------------------------------------------------------------- */

const cell = (attributes: string, body: string) => `<td ${attributes}>${body}</td>`;

/**
 * Layout expressed the way the target will still have it when it arrives.
 *
 * Every HTML surface here renders through `sanitizeHtml`, whose attribute
 * allow-list is `style` and a handful of others - `align`, `valign`, `bgcolor`,
 * `cellspacing`, `cellpadding` and `border` are all stripped. This was emitting
 * exactly those, so a centred design arrived left-aligned and a filled button
 * arrived as a bare link: the compiler was describing a layout in a vocabulary
 * the reader deletes on the way in.
 *
 * So the markup targets get inline `style`, which survives, and Qt keeps the
 * presentational attributes - its rich text is a subset of HTML 4, where those
 * attributes are how this is said and CSS largely is not.
 */
const legacyLayout = (target: Variant): boolean => target === "qt";

/** A layout cell's attributes, in whichever vocabulary the target reads. */
function cellAttrs(
  target: Variant,
  {
    width,
    align,
    style = "",
    bg,
    fg,
    grad,
  }: { width?: number; align?: string; style?: string; bg?: string; fg?: string; grad?: string },
): string {
  const size = width === undefined ? "" : `width="${width}%" `;
  const aligned = align ? ` align="${align}"` : "";

  if (legacyLayout(target)) {
    // No `style` for padding when there is no fill: Qt's CSS has `padding-top`
    // and its three siblings but no `padding` shorthand, so the obvious
    // one-liner was being dropped in silence and every Qt cell drew flush. The
    // table's own `cellpadding` says it in one attribute instead of four
    // properties, which also matters against the server's 4096-character cap.
    //
    // A *filled* cell asks for more room than the table's own padding gives,
    // and that is the one case worth spending the four properties on. The ink
    // is not here: `td` has no colour attribute, so it is a `<font>` around
    // the contents - see `paint`.
    const extra = style.replace(/^;/, "");
    if (!bg) return extra ? `${size}valign="top"${aligned} style="${extra}"` : `${size}valign="top"${aligned}`;
    const filled = extra
      ? extra
      : "padding-left:8px;padding-right:8px;padding-top:6px;padding-bottom:6px";
    return `${size}valign="top"${aligned} bgcolor="${bg}" style="${filled}"`;
  }

  const painted = `${grad ? `;background:${grad}` : ""}${bg ? `;background-color:${bg}` : ""}${fg ? `;color:${fg}` : ""}`;
  // A cell that states its own padding does not want the default on top of it.
  const room = style.includes("padding:") ? "" : `;padding:${bg ? "10px 12px" : "6px"}`;
  return `${size}style="vertical-align:top${align ? `;text-align:${align}` : ""}${room}${painted}${style}"`;
}

/** A layout table's own attributes. */
function tableAttrs(target: Variant, extra = ""): string {
  return legacyLayout(target)
    ? `width="100%" cellspacing="0" cellpadding="6" border="0"`
    : `width="100%" style="border-collapse:collapse${extra}"`;
}

/**
 * The fill and the ink a block asked for.
 *
 * The ink is only ever *derived* when a fill was chosen and no colour was:
 * `inkOn` picks the one that reads on that fill, which is what stops a block
 * being saved with its own words invisible on it. A block with neither keeps
 * the reader's own colours, which is the right default on a client whose theme
 * this editor knows nothing about.
 */
function colours(block: Block, target: Variant): { bg?: string; fg?: string } {
  const chosenBg = block.bg;
  const chosenFg = block.fg ?? (chosenBg ? inkFor(chosenBg) : undefined);
  // A role becomes `var(--…, literal)` where the reader's client can resolve
  // it, and the literal alone where it cannot: Qt has no custom properties, so
  // a variable there is a colour nobody ever sees.
  const say = target === "qt" ? fixedColour : themedColour;
  return {
    bg: chosenBg === undefined ? undefined : say(chosenBg),
    fg: chosenFg === undefined ? undefined : say(chosenFg),
  };
}

/**
 * The look a block asked for, as the target can say it.
 *
 * One place, because these all end up on the same layout cell and because the
 * two vocabularies differ: a browser takes the lot, and Qt reads weight,
 * leading and padding but has never heard of a rounded corner, letter spacing
 * or a measure. What Qt cannot do it simply does without - the words are all
 * still there, set in the face that target has.
 */
function look(block: Block, target: Variant): string {
  const parts: string[] = [];
  const legacy = target === "qt";
  const width = block.borderWidth ?? 1;
  const stroke = block.borderStyle ?? "solid";
  if (block.border !== undefined) {
    const rule = legacy ? fixedColour(block.border) : themedColour(block.border);
    // Qt has no `border` shorthand, so the three properties are stated - the
    // same reason its padding is written out longhand.
    parts.push(
      legacy
        ? `border-style:${stroke};border-width:${width}px;border-color:${rule}`
        : `border:${width}px ${stroke} ${rule}`,
    );
  }
  if (block.weight !== undefined) parts.push(`font-weight:${block.weight}`);
  // A fixed line box wins over a proportional one: it is how a chip centres a
  // single line of text against a height it was given rather than a height its
  // words happened to make.
  if (block.leadPx !== undefined) parts.push(`line-height:${block.leadPx}px`);
  else if (block.leading !== undefined) parts.push(`line-height:${block.leading}%`);
  if (block.padCss !== undefined) {
    // Written out longhand for Qt, which has the four properties and not the
    // shorthand - and only where it is one value, because Qt cannot express
    // "no room above and room at the sides" any other way than by saying so.
    parts.push(legacy ? qtPadding(block.padCss) : `padding:${block.padCss}`);
  } else if (block.pad !== undefined) {
    parts.push(
      legacy
        ? `padding-top:${block.pad}px;padding-right:${block.pad}px;padding-bottom:${block.pad}px;padding-left:${block.pad}px`
        : `padding:${block.pad}px`,
    );
  }
  if (legacy) return parts.length > 0 ? `;${parts.join(";")}` : "";
  // The lit top edge, after the border it overrides. On a dark surface this is
  // the whole of what an inset highlight would do, in a property that survives
  // the sanitiser - which `box-shadow` does not.
  if (block.borderTop !== undefined) {
    parts.push(`border-top:${width}px ${stroke} ${themedColour(block.borderTop)}`);
  }
  // Depth, which on a dark ground is usually a spread ring or an inset
  // highlight rather than anything that looks like a dropped shadow.
  if (block.shadow !== undefined) parts.push(`box-shadow:${block.shadow}`);
  if (block.textShadow !== undefined) parts.push(`text-shadow:${block.textShadow}`);
  if (block.valign !== undefined) parts.push(`vertical-align:${block.valign}`);
  // Frosted glass: a blur of what is behind, which needs a fill over it to be
  // visible at all. The WebKit prefix is not redundant - the client renders in
  // WebKitGTK on Linux, which still wants it.
  if (block.blurBehind !== undefined) {
    parts.push(`backdrop-filter:blur(${block.blurBehind}px)`);
    parts.push(`-webkit-backdrop-filter:blur(${block.blurBehind}px)`);
  }
  if (block.blur !== undefined) parts.push(`filter:blur(${block.blur}px)`);
  if (block.ratio !== undefined) parts.push(`aspect-ratio:${block.ratio}`);
  // A background picture's geometry. The picture itself is not here: a `url()`
  // is a fetch and the sanitiser refuses every one, so the client paints it in
  // from the assets that travelled beside the markup.
  if (block.bgAsset !== undefined) {
    parts.push(`background-size:${block.bgFit ?? "cover"}`);
    parts.push(`background-position:${block.bgPos ?? "center"}`);
    parts.push("background-repeat:no-repeat");
  }
  if (block.round === true) parts.push("border-radius:50%");
  else if (block.radius !== undefined) parts.push(`border-radius:${block.radius}px`);
  // A radius clips the box's own background and border and nothing else, so
  // anything drawn inside it - a picture, a child card, a filled row - runs
  // straight through the corner it was supposed to be rounded by. Clipping is
  // what makes the radius apply to the *contents* as well as the box.
  //
  // Only where there is a radius to clip to. Applied to every box regardless,
  // it would quietly cut off whatever a fixed-height block happened to
  // overflow, which is a different decision and not one anybody asked for.
  if (CLIPS.has(block.type) && (block.round === true || block.radius !== undefined)) {
    parts.push("overflow:hidden");
  }
  if (block.margin !== undefined) parts.push(`margin:${block.margin}`);
  // A group's drawn height is how the sheet decides what is inside it, not a
  // height for the message: a card sized by its contents would otherwise
  // arrive at whatever the operator happened to drag the box to. Only a group
  // with nothing in it is a box in its own right - a circle, a rule, a spacer -
  // and `boxed` is how the caller says which this is.
  if (block.h !== undefined && SIZED_BOX.has(block.type) && block.boxed !== false) {
    parts.push(`height:${block.h}px`);
  }
  if (block.tracking !== undefined) {
    // Trimmed rather than fixed to two places: -0.022em and -0.25em are both
    // real values, and `toFixed(2)` turns the first into -0.02, which is a
    // visible error on a display line.
    parts.push(`letter-spacing:${trim(block.tracking / 100)}em`);
  }
  if (block.measure !== undefined) parts.push(`max-width:${block.measure}px`);
  // A measure only means anything if the column can be narrower than the cell,
  // and a centred block wants the leftover space split rather than trailing.
  if (block.measure !== undefined && block.align === "center") parts.push("margin-left:auto;margin-right:auto");
  return parts.length > 0 ? `;${parts.join(";")}` : "";
}

/**
 * Blocks that hold something a radius has to be clipped to.
 *
 * A group holds other blocks and an image holds a picture; both draw *inside*
 * their box and both escape a rounded corner without this. Everything else on
 * the list draws its own words, which a radius already contains.
 */
const CLIPS = new Set<Block["type"]>(["group", "image", "panel", "card", "notice", "presence"]);

/** Blocks whose height is theirs to state rather than their content's. */
const SIZED_BOX = new Set<Block["type"]>(["group", "image", "mark", "spacer", "presence"]);

/** A number as CSS writes it: no trailing zeroes, no leading zero to spare. */
function trim(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** A CSS padding shorthand as Qt's four longhand properties. */
function qtPadding(css: string): string {
  const v = css.trim().split(/\s+/);
  const [top, right, bottom, left] =
    v.length === 1 ? [v[0], v[0], v[0], v[0]]
    : v.length === 2 ? [v[0], v[1], v[0], v[1]]
    : v.length === 3 ? [v[0], v[1], v[2], v[1]]
    : [v[0], v[1], v[2], v[3]];
  return `padding-top:${top};padding-right:${right};padding-bottom:${bottom};padding-left:${left}`;
}

/**
 * The background declarations for a block, in the order CSS reads them.
 *
 * A gradient and a flat fill are used *together* - a translucent panel with a
 * wash of colour over one corner is two layers, not one - and the order is not
 * free: `background` is a shorthand that resets the colour, so it has to be
 * written first and `background-color` after it. Written the other way round,
 * the fill silently disappears.
 *
 * Qt has never heard of a gradient and gets the flat fill alone, which is the
 * same downgrade every other painted thing takes on that target.
 */
function fill(block: Block, bg: string | undefined, target: Variant): string {
  const wash = block.grad !== undefined && target !== "qt" ? `background:${block.grad};` : "";
  return `${wash}${bg === undefined ? "" : `background-color:${bg};`}`;
}

/** Qt has no colour attribute on a cell, so the ink is a `<font>` round it. */
function paint(inner: string, fg?: string): string {
  return fg ? `<font color="${fg}">${inner}</font>` : inner;
}

/**
 * What the layout cell has to carry for the block inside it.
 *
 * Only a text block needs anything: its body is markup that brings its own
 * tags, so the one thing the design says about it that the markup does not -
 * how big it is - has nowhere else to go. Qt is left out because Qt never had
 * it: that target has always drawn text at the size the client chose.
 */
function cellStyle(block: Block, target: Variant): string {
  // Any block that was given one, not only a text block. `size` was read for
  // `text` alone, so setting it on a panel or a card did nothing at all and
  // there was no way to make a hero line big - which is most of what separates
  // a designed greeting from a typed one.
  // Qt included. `font-size` is on Qt's own supported list, and this target
  // used to be left at the client's own size on the grounds that it had never
  // had another - which was true when nothing could ask for one. Now that a
  // block can, a hero line that came out at body size on Classic would be the
  // editor ignoring the control rather than the target lacking it.
  const sized =
    block.size !== undefined && !HAS_OWN_SIZE.has(block.type) ? `;font-size:${block.size}px` : "";
  return sized + look(block, target);
}

/** Blocks whose own markup already states a size, so the cell must not. */
const HAS_OWN_SIZE = new Set<Block["type"]>(["heading", "mark", "footer", "code"]);

/**
 * A one-block row, opened and closed separately.
 *
 * The same markup `rowMarkup` produces for a row of one, taken apart so a block
 * whose copy has to be split can keep the cell around all of its pieces.
 */
function rowWrap(block: Block, share: number, target: Variant): Wrap {
  // A solo block on a CSS target is a div whether or not it is decided per
  // peer: the gate changes when it is sent, not what it is wrapped in.
  if (!legacyLayout(target) && share === 100) return soloMarkup(block, target);
  const align = block.align ?? "left";
  const legacy = target === "qt";
  if (block.fit === true) {
    // Split through the fitted block's own table rather than around it, so a
    // gated or slotted badge is still a badge and not a full-width bar.
    const shell = fitted(block, target, "\u0000");
    const [head, tail] = shell.split("\u0000");
    return {
      open: `<table ${tableAttrs(target)}><tr><td ${cellAttrs(target, { width: share, align })}>${head}`,
      inner: legacy ? qtBlock(block) : htmlBlock(block),
      close: `${tail}</td></tr></table>`,
    };
  }
  const { bg, fg } = colours(block, target);
  const attributes = cellAttrs(target, {
    width: share,
    align,
    style: cellStyle(block, target),
    bg,
    fg,
  });
  return {
    open: `<table ${tableAttrs(target)}><tr><td ${attributes}>${legacy && fg ? `<font color="${fg}">` : ""}`,
    inner: legacy ? qtBlock(block) : htmlBlock(block),
    close: `${legacy && fg ? "</font>" : ""}</td></tr></table>`,
  };
}

/**
 * A block that sits only as wide as its own words.
 *
 * A row of one is full width, which is right for a paragraph and wrong for a
 * badge - and a badge stretched across the whole column is most of what makes
 * a design read as a masthead from 2004. `fit` moves the block's paint onto a
 * table that shrinks to its contents, inside a cell that then only says where
 * to put it.
 *
 * The button has always done exactly this; this is the same trick offered as a
 * control any block can have, which is what a pill, a chip, a tag or a small
 * key line needs and what nothing here could previously express.
 */
function fitted(block: Block, target: Variant, inner: string): string {
  const { bg, fg } = colours(block, target);
  if (legacyLayout(target)) {
    // Qt shrinks a table to its contents too, and takes the fill as an
    // attribute. It has no `margin`, so a fitted block there is left where the
    // alignment attribute on the outer cell put it.
    //
    // The room is `cellpadding` only when the block did not ask for a padding
    // of its own: `look` writes that out longhand on the cell, and stating it
    // both ways would pad a badge twice.
    const attrs = [
      bg === undefined ? "" : `bgcolor="${bg}"`,
      `cellpadding="${block.pad === undefined ? 6 : 0}"`,
      `cellspacing="0"`,
      `border="${block.border === undefined ? 0 : 1}"`,
    ]
      .filter(Boolean)
      .join(" ");
    const style = cellStyle(block, target).replace(/^;/, "");
    return `<table ${attrs}><tr><td${style === "" ? "" : ` style="${style}"`}>${paint(inner, fg)}</td></tr></table>`;
  }
  // A `span` set to `inline-block`, and not a `div`: `div` is not on the
  // sanitiser's tag list, so every reader would delete the wrapper and keep
  // its contents - which is a fill, a padding and a radius silently thrown
  // away. `span` and `display` are both allowed, and an inline-block shrinks
  // to its contents and *is* moved by the enclosing `text-align`, so a fitted
  // block is centred by the same property that centres its words.
  const roomy = block.pad !== undefined || block.padCss !== undefined;
  const paintStyle =
    `${fill(block, bg, target)}${fg ? `color:${fg};` : ""}` + (roomy ? "" : "padding:6px;");
  // A block box where it was told to grow, so its padding and rule are
  // measured inside the share it is given rather than added on top of it.
  const how = block.grow === true ? "block" : "inline-block";
  return `<span style="display:${how};${paintStyle.replace(/;$/, "")}${cellStyle(block, target)}">${inner}</span>`;
}

/**
 * One cell of a row: the block, painted, at its share of the width.
 *
 * A fitted block is the exception - it keeps its paint on an inner table, so
 * the cell around it carries nothing but the width and the alignment.
 */
function layoutCell(block: Block, share: number, target: Variant): string {
  const align = block.align ?? "left";
  const inner = target === "qt" ? qtBlock(block) : htmlBlock(block);
  if (block.fit === true) {
    return cell(cellAttrs(target, { width: share, align }), fitted(block, target, inner));
  }
  const { bg, fg } = colours(block, target);
  return cell(
    cellAttrs(target, {
      width: share,
      align,
      style: cellStyle(block, target),
      bg,
      fg,
      ...(target === "qt" ? {} : { grad: block.grad }),
    }),
    target === "qt" ? paint(inner, fg) : inner,
  );
}

/**
 * A block alone on its line, on a target that reads CSS.
 *
 * Qt needs the table: its rich text is HTML 4, where a block box carries no
 * padding, no fill and no alignment. Every other target reads `style`, and for
 * those the table was scaffolding around a single cell - `<table width="100%"
 * style="border-collapse:collapse"><tr><td width="100%" style="vertical-align:
 * top;…">` and its closing tags, about two hundred characters, to say "put this
 * on its own line".
 *
 * That was 57% of a compiled greeting, against a 4096-character cap the server
 * spends on every single join. A `span` set to `display:block` says the same
 * thing in a fifth of it, and the two properties the cell had that a block box
 * does not need - its width and its vertical alignment - are exactly the two
 * that meant nothing in a row of one.
 *
 * A `span`, specifically, and never a `div`: `div` is not on the sanitiser's
 * tag list. A `div` wrapper is deleted on the way in and its children kept, so
 * the whole point of the wrapper - the fill, the padding, the alignment - would
 * arrive as nothing at all. `span` and `display` are both allowed.
 */
function soloMarkup(block: Block, target: Variant): Wrap {
  // An image is inline content, and a wrapper it did not ask for is not free:
  // a block box around it removes the line box, and with it the few pixels of
  // descender space under the picture that every layout around one is drawn
  // against. It gets a wrapper when it was given something that needs one -
  // an alignment, a margin, a fill - and otherwise it is just the picture.
  if (block.type === "image" && !needsBox(block)) {
    return { open: "", inner: htmlBlock(block), close: "" };
  }
  // A painted button already *is* the box: its own markup carries the fill,
  // the rule, the corners and the room. A wrapper repeating all of it draws a
  // button inside a button, so what is left for the wrapper is the one thing
  // an inline box cannot do for itself - say where on the line to sit.
  if (selfBoxed(block)) {
    const put = block.align === undefined || block.align === "left" ? "" : `text-align:${block.align};`;
    const spaced = block.margin === undefined ? "" : `margin:${block.margin};`;
    const outer = `${put}${spaced}`.replace(/;$/, "");
    return outer === ""
      ? { open: "", inner: htmlBlock(block), close: "" }
      : { open: `<span style="display:block;${outer}">`, inner: htmlBlock(block), close: "</span>" };
  }
  const align = block.align ?? "left";
  const aligned = align === "left" ? "" : `text-align:${align};`;
  if (block.fit === true) {
    const shell = fitted(block, target, "\u0000");
    const [head, tail] = shell.split("\u0000");
    return {
      open: aligned === "" ? head : `<span style="display:block;${aligned}">${head}`,
      inner: htmlBlock(block),
      close: aligned === "" ? tail : `${tail}</span>`,
    };
  }
  const { bg, fg } = colours(block, target);
  const painted = `${fill(block, bg, target)}${fg ? `color:${fg};` : ""}`;
  const pad =
    block.pad === undefined && block.padCss === undefined && bg !== undefined
      ? "padding:10px 12px;"
      : "";
  const style = `${aligned}${painted}${pad}`.replace(/;$/, "") + cellStyle(block, target);
  return {
    open: `<span${wrapperClass(block)} style="display:block;${style.replace(/^;/, "")}">`,
    inner: htmlBlock(block),
    close: "</span>",
  };
}

/** One row of the layout table. */
function rowMarkup(row: readonly Block[], share: readonly number[], target: Variant): string {
  if (!legacyLayout(target) && row.length === 1) {
    const wrap = soloMarkup(row[0], target);
    return wrap.open + wrap.inner + wrap.close;
  }
  const cells = row.map((block, index) => layoutCell(block, share[index], target)).join("");
  return `<table ${tableAttrs(target)}><tr>${cells}</tr></table>`;
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
      // The body as written, not wrapped: it is markup with its own block tags
      // and there is no element to put around it. `div` is not on the
      // allow-list every renderer here filters through, and a `span` holding a
      // `<p>` is closed by the parser at the first one. The size rides on the
      // layout cell instead, which every child inherits from.
      //
      // Filtered on the way out even though the field escapes what is typed
      // into it: this is the copy the server stores and every client is sent,
      // and a paste can put anything in a contenteditable. The other two
      // targets are filtered by construction - Qt through its own subset, and
      // plain by having no tags at all.
      // A line rather than a paragraph, where the block says so: the block is
      // already the box, and a `<p>` inside it brings margins that fight the
      // ones the block was given.
      return sanitizeHtml(block.bare === true ? (block.text ?? "") : richBody(block.text));
    case "mark":
      return `<p style="margin:0;font-size:${block.h ?? 40}px">${escapeHtml(block.glyph ?? "")}</p>`;
    case "divider":
      return "<hr>";
    case "callout":
      return `<blockquote style="margin:0">${sanitizeHtml(richBody(block.text))}</blockquote>`;
    case "panel":
      // Just its words. What makes a panel a panel is its fill, and a fill is
      // the layout cell's business now - which is what lets a heading or a
      // list have one too.
      return sanitizeHtml(richBody(block.text));
    case "html":
      // Written as markup, sent as markup - through the same allow-list every
      // reader filters it through anyway, so what the operator sees here is
      // what survives the trip. Not `richBody`: this block *is* the source,
      // and wrapping a bare line of it in a paragraph would be the editor
      // deciding something the operator was in the middle of writing.
      return sanitizeHtml(block.text ?? "");
    case "notice": {
      const paint = NOTICE_STYLE[block.tone ?? "info"];
      return (
        `<table width="100%" style="border-collapse:collapse"><tr>` +
        cell(
          `style="width:4px;background-color:${paint.rule}${
            block.radius ? `;border-radius:${block.radius}px 0 0 ${block.radius}px` : ""
          }"`,
          "",
        ) +
        cell(
          `style="width:26px;background-color:${paint.wash};color:${paint.rule};` +
            `font-weight:700;text-align:center;vertical-align:top;padding:8px 0"`,
          paint.mark,
        ) +
        cell(
          `style="background-color:${paint.wash};color:${paint.ink};padding:8px 10px${
            block.radius ? `;border-radius:0 ${block.radius}px ${block.radius}px 0` : ""
          }"`,
          sanitizeHtml(richBody(block.text)),
        ) +
        `</tr></table>`
      );
    }
    case "button":
      return button(block, false, "html");
    case "links":
      return links(block, false, "html");
    case "quote":
      return `<blockquote style="margin:0;font-style:italic">${sanitizeHtml(richBody(block.text))}</blockquote>`;
    case "code":
      return `<pre style="margin:0;font-family:monospace;white-space:pre-wrap">${text}</pre>`;
    case "list":
      return list(block);
    case "spacer":
      // A row of its own with nothing in it. `height` on the cell is the one
      // spacing primitive the sanitiser and Qt both leave alone.
      return `<div style="height:${block.h ?? 24}px"></div>`;
    case "columns":
      return links(block, false, "html");
    case "table":
      return table(block);
    case "card":
      return `<table width="100%" style="border-collapse:collapse"><tr>${cell(
        `style="border:1px solid ${QUIET};padding:10px"`,
        sanitizeHtml(richBody(block.text)),
      )}</tr></table>`;
    case "footer":
      // A `div`, not a `p`, for the reason the Qt path already says: the body
      // is prose that brings its own paragraph tags, and a paragraph inside a
      // paragraph is closed by the parser at the first one - so the footer's
      // own words ended up outside the small grey box they were meant to be in.
      //
      // The size and the colour are defaults rather than assertions. Both used
      // to be written flat, which beat the block's own `size` and `fg` from the
      // cell outside - so a footer given a colour in the inspector kept the
      // fixed grey and the control looked broken.
      return (
        `<div style="margin:0;font-size:${block.size ?? 11}px` +
        `${block.fg === undefined ? `;color:${QUIET}` : ""}">` +
        `${sanitizeHtml(richBody(block.text))}</div>`
      );
    case "social":
      return links(block, false, "html");
    case "rating":
      return `<p style="margin:0;color:${ACCENT}">${stars(block)}</p>`;
    case "countdown":
      return `<p style="margin:0"><b>${escapeHtml(deadline(block))}</b></p>`;
    case "toggles":
      // Compiled by the caller into one gated part per branch, so the block
      // itself renders nothing.
      return "";
    case "ab":
      return "";
    case "repeater":
      return "";
    case "video":
    case "qr":
      // Both are a link to something rather than the something: a video is not
      // embeddable in any surface here, and a QR code is a picture of a URL the
      // reader already has as a URL.
      return block.url
        ? `<p style="margin:0"><a href="${escapeHtml(block.url)}" style="color:${ACCENT}"><b>${
            text || escapeHtml(block.url)
          }</b></a></p>`
        : "";
    case "image":
      // A picture held as an asset is *named*, not inlined: the bytes travel
      // beside the markup rather than inside it, so a photograph costs what a
      // photograph costs instead of a third more as base64 - and it is not
      // held to the four kilobytes a string greeting is capped at.
      //
      // The marker is a class for the same reason the presence block's is: the
      // sanitiser runs with `ALLOW_DATA_ATTR: false`, so a `data-` attribute
      // would be stripped and the client would never learn which picture this
      // is. The client swaps it for a real `<img>` from the payload.
      if (block.asset !== undefined && block.asset !== "") {
        // The box on the marker, and how to fit into it as a class - `overflow`
        // and `data-` are both stripped by the sanitiser, so neither can carry
        // it. The client puts the picture in and applies the fit.
        const how = block.picFit === undefined ? "" : ` fm-fit-${block.picFit}`;
        const box = pictureBox(block);
        return (
          `<span class="${ASSET_CLASS} fm-a-${escapeHtml(block.asset)}${how}"` +
          `${box === "" ? "" : ` style="${box.replace(/;$/, "")}"`}></span>`
        );
      }
      // An `<img>` with the picture inlined. This used to compile to nothing
      // at all, on the grounds that the artwork was the server's livery and no
      // markup here could reach it - which meant a design could not carry so
      // much as a line icon, and every "image" an operator placed silently
      // arrived as a gap.
      //
      // The source has to be a data URI: the sanitiser drops an `<img>`
      // pointing anywhere else, so that a greeting cannot log the address of
      // everybody who joins.
      return block.src
        ? `<img src="${escapeHtml(block.src)}"${block.w ? ` width="${block.w}"` : ""}` +
            `${block.h ? ` height="${block.h}"` : ""}${pictureFit(block)} alt="">`
        : "";
    case "presence":
      return presenceMarkup(block);
    case "theme":
    case "slot":
      // A theme is a container the editor draws and a reader never sees; a
      // slot is substituted rather than rendered.
      return "";
  }
  return "";
}

/**
 * The class a Fancy client swaps for a live presence component.
 *
 * A class and not a data attribute: the sanitiser every reader renders through
 * is configured with `ALLOW_DATA_ATTR: false`, so `data-` is stripped on the
 * way in, and `class` is on its attribute list.
 */
export const PRESENCE_CLASS = "fm-presence";

/**
 * The class marking where a picture from the payload goes.
 *
 * Paired with a second class naming which picture - `fm-a-<id>` - exactly as
 * the presence block carries its face count, and for the same reason: a class
 * survives the sanitiser and a `data-` attribute does not.
 */
export const ASSET_CLASS = "fm-asset";

/**
 * The class marking a block whose *background* is a picture from the payload.
 *
 * Separate from `ASSET_CLASS` because the client does two different things
 * with them: one is replaced by an `<img>`, the other keeps its contents and
 * gets the picture painted behind them.
 */
export const BACKDROP_CLASS = "fm-backdrop";

/** The classes a wrapper carries, if any, as a ready-made attribute. */
function wrapperClass(block: Block): string {
  if (block.bgAsset === undefined || block.bgAsset === "") return "";
  return ` class="${BACKDROP_CLASS} fm-a-${escapeHtml(block.bgAsset)}"`;
}

/**
 * Who is on the server, as markup.
 *
 * The one block whose value cannot be compiled. Everything else on a sheet is
 * decided when the operator saves; how many people are online is only true at
 * the moment somebody looks, and a number frozen into the markup at save time
 * would be wrong by the first join and wrong for ever after. Nor can the server
 * fill it in on the way out - it substitutes wired snippets and nothing else,
 * and a count written at handshake is already stale by the time the greeting is
 * still sitting in the pinned panel an hour later.
 *
 * So this compiles to a marker with the operator's own words inside it, and the
 * client that renders the greeting replaces the marker with a live component
 * reading its own user list. That gives real faces and a real number, updated
 * as people come and go.
 *
 * The words inside are not a placeholder - they are the honest fallback. A
 * reader whose client does not do the swap sees "Members online" rather than a
 * gap where a number should be, and never sees a count that is not true.
 */
function presenceMarkup(block: Block): string {
  const words = escapeHtml((block.text ?? "").trim() || "online");
  // How many faces rides in a second class, and the label is the words
  // themselves. Neither can be an attribute of its own: the sanitiser is
  // configured with `ALLOW_DATA_ATTR: false`, so a `data-` attribute is
  // stripped on the way in and the component would never hear about either.
  const faces = block.faces === undefined ? "" : ` fm-faces-${Math.max(0, Math.round(block.faces))}`;
  // The fallback sits centred in the space the cluster will take. The block
  // reserves its own height either way - see `SIZED_BOX` - so a client that
  // does the swap does not reflow the whole greeting when the component
  // arrives, and one that does not is left with a tidy line rather than a
  // 30-pixel hole.
  const centred = block.h === undefined ? "" : ` style="line-height:${block.h}px"`;
  return `<span class="${PRESENCE_CLASS}${faces}"${centred}>${words}</span>`;
}

/**
 * How a picture sits in the box it was given, as a `style` attribute.
 *
 * `cover` crops it to fill, which is what a band wants; `contain` fits the
 * whole picture inside and keeps its shape, which is what "take the height and
 * stay in proportion" means and what a logo needs. Absent leaves the picture at
 * whatever shape it is, which is what an icon wants.
 */
function pictureFit(block: Block): string {
  const fit = block.picFit === undefined ? "" : `object-fit:${block.picFit};display:block;width:100%;height:100%`;
  // Straight onto the `<img>`, which is the painted box here - so it needs no
  // clipping wrapper and cannot be knocked out of alignment by one.
  const rounded =
    block.round === true ? "border-radius:50%" : block.radius === undefined ? "" : `border-radius:${block.radius}px`;
  const style = [fit, rounded].filter(Boolean).join(";");
  return style === "" ? "" : ` style="${style}"`;
}

/**
 * The box a picture is fitted *into*, on the marker that stands for it.
 *
 * `object-fit` needs something to fit into, and a bare marker has no size at
 * all - so a picture told to keep its shape inside a box took its own natural
 * size instead and pushed everything else off the page. The block's drawn
 * height is that box.
 */
function pictureBox(block: Block): string {
  const rounded =
    block.round === true
      ? ";border-radius:50%;overflow:hidden"
      : block.radius === undefined
        ? ""
        : `;border-radius:${block.radius}px;overflow:hidden`;
  if (block.picFit === undefined && block.ratio === undefined) {
    // Even with nothing to fit, a rounded picture needs a box to be rounded.
    return rounded === "" ? "" : `display:block${rounded}`;
  }
  const tall = block.ratio !== undefined ? `aspect-ratio:${block.ratio}` : `height:${block.h ?? 120}px`;
  // The width it was drawn at, not the width of whatever holds it. `width:100%`
  // turned a 72px circle into a 320px ellipse the moment it was put in a
  // column - a picture is the size it was placed at, and `max-width` is what
  // keeps a wide one from overflowing a narrower container.
  return `display:block;width:${block.w}px;max-width:100%;${tall}${rounded}`;
}

/** Five stars, of which some are filled. */
function stars(block: Block): string {
  const filled = Math.max(0, Math.min(5, Math.round(block.stars ?? 5)));
  return "★".repeat(filled) + "☆".repeat(5 - filled);
}

/**
 * A countdown, as the only thing a sent message can say about one.
 *
 * The label and the date it runs to. Nothing here ticks: a greeting is
 * assembled at handshake and then read, so a "3 days left" baked in at that
 * moment is wrong by the time anybody scrolls back to it, where the date it
 * was counting to stays true.
 */
function deadline(block: Block): string {
  const label = block.text ?? "";
  if (!block.until) return label;
  const when = new Date(`${block.until}T00:00:00Z`);
  const said = Number.isNaN(when.getTime())
    ? block.until
    : when.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return label ? `${label} ${said}` : said;
}

/** A bulleted list, which is the one structure both HTML and Qt agree on. */
function list(block: Block): string {
  const lines = (block.lines ?? []).filter((line) => line.trim() !== "");
  if (lines.length === 0) return "";
  return `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`;
}

/**
 * A table, header row first.
 *
 * Two dialects of the same grid. The rules and the padding are `style` on the
 * markup targets, because that is what their sanitiser keeps, and attributes
 * on Qt, because Qt reads `border` and `cellpadding` and has neither a
 * `border` nor a `padding` shorthand in its CSS - the properties were being
 * dropped, so the one block whose whole point is being ruled arrived unruled.
 */
function table(block: Block, qt = false): string {
  const rows = (block.rows ?? []).filter((row) => row.length > 0);
  if (rows.length === 0) return "";
  const body = rows
    .map((cells, index) => {
      const head = index === 0;
      const tag = head ? "b" : "span";
      return `<tr>${cells
        .map((text) =>
          cell(
            qt
              ? `valign="top"${head ? ` bgcolor="${PANEL_BG}"` : ""}`
              : `style="vertical-align:top;padding:4px;border:1px solid ${QUIET}"`,
            qt && head
              ? `<font color="${PANEL_FG}"><b>${escapeHtml(text)}</b></font>`
              : `<${tag}>${escapeHtml(text)}</${tag}>`,
          ),
        )
        .join("")}</tr>`;
    })
    .join("");
  return qt
    ? `<table width="100%" border="1" cellpadding="4" cellspacing="0">${body}</table>`
    : `<table width="100%" style="border-collapse:collapse">${body}</table>`;
}

/** One block, in markup Qt renders. */
/* -- Qt -------------------------------------------------------------------- */

/**
 * The surfaces Qt can paint, and what has to be said on each.
 *
 * A colour is never set on its own here. Qt draws the welcome text on whatever
 * background the client's theme gives it, so a panel that sets a pale fill and
 * leaves the text alone is unreadable to anyone on a dark theme - the fill
 * arrives, the light text stays light. Every fill below therefore carries the
 * ink that goes on it.
 */
const PANEL_BG = "#eef2f7";
const PANEL_FG = "#1c2430";
const CODE_BG = "#f3f3f3";

/**
 * A filled, padded box - the one shape Qt has.
 *
 * There is no `border-radius`, no `box-shadow` and no `div` with a background
 * worth relying on, but a one-cell table takes `bgcolor`, `cellpadding` and
 * `border`, and those three are enough to be a card, a button, a code panel or
 * a notice. This is the primitive everything shaped below is built from.
 */
function qtBox(
  body: string,
  { bg, fg, pad = 8, border = 0, width, align }: {
    bg?: string;
    fg?: string;
    pad?: number;
    border?: number;
    width?: string;
    align?: string;
  },
): string {
  const attrs = [
    width ? `width="${width}"` : "",
    bg ? `bgcolor="${bg}"` : "",
    `cellpadding="${pad}"`,
    `cellspacing="0"`,
    `border="${border}"`,
  ]
    .filter(Boolean)
    .join(" ");
  const inner = fg ? `<font color="${fg}">${body}</font>` : body;
  return `<table ${attrs}><tr>${cell(align ? `align="${align}"` : "", inner)}</tr></table>`;
}

/**
 * A block with a coloured bar down its left edge.
 *
 * The oldest trick in the book and still the right one: a two-cell table whose
 * first cell is four pixels wide and painted. Qt has no `border-left` it will
 * paint reliably on a block, but it will paint a cell, so the bar *is* a cell.
 */
function qtBar(body: string, colour: string, bg?: string): string {
  const fill = bg ? ` bgcolor="${bg}"` : "";
  const ink = bg ? `<font color="${PANEL_FG}">${body}</font>` : body;
  return (
    `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td width="4" bgcolor="${colour}"></td>` +
    `<td${fill} style="padding-left:10px;padding-top:6px;padding-bottom:6px;padding-right:8px">${ink}</td>` +
    `</tr></table>`
  );
}

/**
 * Which heading tag a size means.
 *
 * Qt's own `h1`-`h6` rather than a `<font size="+2">`, because the tags carry
 * the space above and below them as well as the size - and vertical rhythm is
 * the thing this target has least of any other way to get.
 */
function qtHeading(block: Block): string {
  const size = block.size ?? (block.level === 2 ? 20 : 26);
  return size >= 26 ? "h1" : size >= 19 ? "h2" : "h3";
}

/** One block, in markup Qt renders. */
function qtBlock(block: Block): string {
  const text = escapeHtml(block.text ?? "");
  const align = block.align ?? "left";
  switch (block.type) {
    case "heading": {
      const tag = qtHeading(block);
      return `<${tag} align="${align}">${text}</${tag}>`;
    }
    case "text":
      // Through the Qt subset for the same reason a slot is: the body is
      // whatever somebody formatted, and Qt draws a subset of HTML 4. The
      // wrapper carries the line height, which Qt does read and which is most
      // of what makes a paragraph look composed rather than typed.
      return `<div style="line-height:135%">${qtSafe(richBody(block.text))}</div>`;
    case "mark":
      return `<p align="${align}"><font size="+4" color="${ACCENT}"><b>${escapeHtml(
        block.glyph ?? "",
      )}</b></font></p>`;
    case "divider":
      return "<hr>";
    case "callout":
      // A tinted panel with an accent edge, which is what a callout is
      // everywhere - and now what it is here too, rather than grey italics.
      return qtBar(qtSafe(richBody(block.text)), ACCENT, PANEL_BG);
    case "panel":
      return qtSafe(richBody(block.text));
    case "html":
      // Reduced to the subset Qt draws, which is the whole point of having a
      // separate target: raw markup written for a browser is exactly the kind
      // that arrives on Qt with half its styling silently gone.
      return qtSafe(block.text ?? "");
    case "notice": {
      // The one block on this canvas that is *about* its colour, so it is the
      // one worth spending Qt's small vocabulary on: a painted rule, a washed
      // panel and a mark, all of them cells, because a cell is the only thing
      // Qt reliably fills. The mark is a plain BMP character - a client with
      // no glyph for a fancier one draws a hollow box, which says less than
      // nothing.
      const paint = NOTICE_STYLE[block.tone ?? "info"];
      return (
        `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr>` +
        `<td width="4" bgcolor="${paint.rule}"></td>` +
        `<td width="26" bgcolor="${paint.wash}" align="center" valign="top" ` +
        `style="padding-top:7px;padding-bottom:7px"><font color="${paint.rule}"><b>${paint.mark}</b></font></td>` +
        `<td bgcolor="${paint.wash}" style="padding-left:8px;padding-right:8px;padding-top:6px;padding-bottom:6px">` +
        `<font color="${paint.ink}">${qtSafe(richBody(block.text))}</font></td>` +
        `</tr></table>`
      );
    }
    case "button":
      return button(block, true, "qt");
    case "links":
    case "social":
      return links(block, true, "qt");
    case "columns":
      // A real table, not a list: columns are the one block whose whole
      // meaning is that these things sit beside each other, and side by side
      // is precisely what a `<table>` still does on Qt.
      return links(block, false, "qt");
    case "quote":
      return qtBar(`<i>${qtSafe(richBody(block.text))}</i>`, QUIET);
    case "code":
      return qtBox(`<pre>${text}</pre>`, { bg: CODE_BG, fg: PANEL_FG, pad: 8, width: "100%" });
    case "list":
      return list(block);
    case "spacer":
      // Height belongs to the table in Qt's attribute list, never to the cell,
      // and an empty cell collapses - so the space is held open by a run of
      // non-breaking spaces at a size nobody can see.
      return (
        `<table width="100%" height="${block.h ?? 24}" cellpadding="0" cellspacing="0" border="0">` +
        `<tr><td><font size="1">&nbsp;</font></td></tr></table>`
      );
    case "table":
      return table(block, true);
    case "card":
      // Bordered rather than filled: a card is a container for whatever prose
      // is in it, and painting it would mean overriding that prose's colours.
      return qtBox(qtSafe(richBody(block.text)), { pad: 10, border: 1, width: "100%" });
    case "footer":
      // A `div`, not a `p`: the body is prose that brings its own paragraph
      // tags, and a paragraph inside a paragraph is closed by the parser at
      // the first one - which would put the footer's own text outside the
      // font it is meant to be small and grey inside.
      // No rule of its own. Qt drew one and the markup targets did not, so the
      // same design ended with a line on the old client and without one on the
      // new - and a template that put a divider above its footer got two. A
      // rule is a divider block, which is a thing the operator can see, move
      // and delete.
      //
      // The alignment is the block's, too. This forced a left-aligned footer to
      // the centre, which is the one alignment a design cannot ask for.
      return (
        `<div align="${align}">` +
        `<font size="-1"${block.fg === undefined ? ` color="${QUIET}"` : ""}>` +
        `${qtSafe(richBody(block.text))}</font></div>`
      );
    case "rating":
      return `<p align="${align}"><font size="+1" color="${ACCENT}">${stars(block)}</font></p>`;
    case "countdown":
      return `<p align="${align}"><b>${escapeHtml(deadline(block))}</b></p>`;
    case "video":
    case "qr":
      // A link to the thing rather than the thing, exactly as the HTML target
      // does it: Qt embeds neither, and the URL is the content either way.
      return block.url
        ? `<p align="${align}"><a href="${escapeHtml(block.url)}"><font color="${ACCENT}"><b>${
            text || escapeHtml(block.url)
          }</b></font></a></p>`
        : "";
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
/** Whether this block was given anything that a wrapper has to carry. */
function needsBox(block: Block): boolean {
  return (
    (block.align !== undefined && block.align !== "left") ||
    block.margin !== undefined ||
    block.bg !== undefined ||
    block.grad !== undefined ||
    block.border !== undefined ||
    block.pad !== undefined ||
    block.padCss !== undefined
  );
}

/**
 * Whether this block's own markup is already a complete inline box.
 *
 * Such a block needs no wrapper: it has its own fill, rule, corners and room,
 * and a wrapper carrying the same properties draws every one of them twice.
 */
function selfBoxed(block: Block): boolean {
  return (block.type === "button" && paintedButton(block)) || block.type === "image";
}

/** Whether this button was given a look of its own, rather than the default. */
function paintedButton(block: Block): boolean {
  return (
    block.bg !== undefined ||
    block.fg !== undefined ||
    block.border !== undefined ||
    block.grad !== undefined
  );
}

function button(block: Block, qt: boolean, target: Variant): string {
  const label = escapeHtml(block.text ?? "");
  const href = escapeHtml(block.url ?? "");
  const asLink = block.style === "link" || href === "";

  if (qt) {
    // Qt gets a real button now. It used to get a bare link on the argument
    // that a filled cell inside a layout cell nests two tables deep and draws
    // badly - it does not, and the call it *was* costing was the one thing on
    // a welcome screen the operator most wants pressed. `bgcolor` and
    // `cellpadding` are both in Qt's own attribute list, so a padded filled
    // cell with a bold link in it arrives as drawn.
    // The ink follows the fill, and only the filled one has a fill. A ghost
    // button is an outline with nothing painted behind it, so the white that
    // reads on the accent is white on whatever the client's background is -
    // which on the ordinary light theme is a button nobody can see.
    const filled = !asLink && block.style !== "ghost";
    const ink = filled ? ON_ACCENT : ACCENT;
    const inner = href
      ? `<a href="${href}"><font color="${ink}"><b>${label}</b></font></a>`
      : `<font color="${ink}"><b>${label}</b></font>`;
    if (asLink) return inner;
    return filled
      ? qtBox(inner, { bg: ACCENT, pad: 8, align: "center" })
      : qtBox(inner, { pad: 6, border: 1, align: "center" });
  }

  // A button the design has dressed itself: its own fill, ink, rule, corners
  // and type, as one inline box. Every other block became a box an operator
  // could style and this one stayed a fixed accent rectangle, which made the
  // single most designed element on a greeting the only one nobody could
  // design.
  if (!asLink && paintedButton(block)) {
    const { bg, fg } = colours(block, target);
    const own =
      `display:${block.grow === true ? "block" : "inline-block"};${fill(block, bg, target)}` +
      `${fg ? `color:${fg};` : ""}text-decoration:none` +
      // A grown button centres its label: it is no longer the width of the
      // words, so left-aligned text in a full-width button reads as a mistake.
      `${block.grow === true ? `;text-align:${block.align ?? "center"}` : ""}` +
      `${block.size === undefined ? "" : `;font-size:${block.size}px`}` +
      look(block, target);
    return href
      ? `<a href="${href}" style="${own}">${label}</a>`
      : `<span style="${own}">${label}</span>`;
  }

  const ink = asLink ? themedColour("auto:accent") : themedColour("auto:onAccent");
  const inner = href
    ? `<a href="${href}" style="text-decoration:none;color:${ink}"><b>${label}</b></a>`
    : `<b>${label}</b>`;
  if (asLink) return inner;
  // The fill is a `style`, not a `bgcolor`: the sanitiser every HTML surface
  // renders through drops the attribute, and a button that arrives with no
  // fill is a link that has been given a lot of padding.
  // The theme's accent, not a fixed blue: the one element an operator most
  // wants on-brand was the one ignoring the reader's theme entirely.
  const accentFill = themedColour("auto:accent");
  const filled = legacyLayout(target)
    ? cell(`bgcolor="${ACCENT}" align="center"`, inner)
    : cell(
        `style="background-color:${accentFill};text-align:center;padding:${block.pad ?? 8}px;` +
          `border-radius:${block.radius ?? 4}px"`,
        inner,
      );
  const attrs = legacyLayout(target) ? `cellpadding="8" cellspacing="0" border="0"` : `style="border-collapse:collapse"`;
  return `<table ${attrs}><tr>${filled}</tr></table>`;
}

/** A row of link cards, which on Qt is a list because cells nest badly. */
function links(block: Block, qt: boolean, target: Variant): string {
  const items = (block.items ?? []).filter((item) => item.label !== "");
  if (items.length === 0) return "";
  const legacy = target === "qt";
  const one = (item: (typeof items)[number]) => {
    // Small caps and a little word spacing, both of which Qt does read, so a
    // kicker on the old client is the same quiet label it is on the new one
    // rather than a shouted line of capitals.
    const kicker = item.kicker
      ? legacy
        ? `<font size="-1" color="${QUIET}"><span style="font-variant:small-caps;word-spacing:2px">${escapeHtml(
            item.kicker,
          )}</span></font><br>`
        : `<font color="${QUIET}" size="-1">${escapeHtml(item.kicker.toUpperCase())}</font><br>`
      : "";
    const label = escapeHtml(item.label);
    const link = item.url
      ? legacy
        ? `<a href="${escapeHtml(item.url)}"><font color="${ACCENT}"><b>${label} &rarr;</b></font></a>`
        : `<a href="${escapeHtml(item.url)}" style="color:${ACCENT}"><b>${label} &rarr;</b></a>`
      : `<b>${label}</b>`;
    return kicker + link;
  };
  // A list where the items are a set of links, a table where they are meant to
  // sit beside each other. Qt draws both; what differs is what the block means.
  if (qt) return `<ul>${items.map((item) => `<li>${one(item)}</li>`).join("")}</ul>`;
  const width = Math.floor(100 / items.length);
  const cells = items.map((item) => cell(cellAttrs(target, { width }), one(item))).join("");
  return `<table ${tableAttrs(target)}><tr>${cells}</tr></table>`;
}

/** One block as text, which is all the plain target has. */
function plainOf(block: Block): string {
  switch (block.type) {
    case "notice": {
      const paint = NOTICE_STYLE[block.tone ?? "info"];
      const said = plainTextOf(richBody(block.text)).trim();
      return said === "" ? "" : `[${paint.mark}] ${said}`;
    }
    case "html":
      // The words out of the markup. A reader on a server with `allow_html`
      // off would otherwise be sent the angle brackets themselves.
      return plainTextOf(block.text ?? "");
    case "text":
      return plainTextOf(richBody(block.text));
    case "code":
      return block.text ?? "";
    case "quote":
      return plainTextOf(richBody(block.text));
    case "list":
      return (block.lines ?? []).filter(Boolean).map((line) => `• ${line}`).join("\n");
    case "table":
      return (block.rows ?? []).map((cells) => cells.join(" · ")).join("\n");
    case "footer":
      return plainTextOf(richBody(block.text));
    case "social":
      return (block.items ?? [])
        .filter((item) => item.label !== "")
        .map((item) => (item.url ? `${item.label}: ${item.url}` : item.label))
        .join("\n");
    case "countdown":
      return deadline(block);
    case "heading":
      return block.text ?? "";
    case "callout":
    case "card":
      return plainTextOf(richBody(block.text));
    case "button": {
      const label = block.text ?? "";
      return block.url ? `${label}: ${block.url}` : label;
    }
    case "links":
      return (block.items ?? [])
        .filter((item) => item.label !== "")
        .map((item) => (item.url ? `${item.label}: ${item.url}` : item.label))
        .join("\n");
    case "presence":
      // The words, and no number. Plain text goes to a client that will never
      // run the component, and a count nobody can keep current is worse than
      // no count - so this says what the block is about and stops there.
      return (block.text ?? "").trim();
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
  const kept = parts.filter(
    (part) =>
      (part.visibleIf === undefined || resolve.condition(part.visibleIf)) &&
      (part.visibleUnless === undefined || !resolve.condition(part.visibleUnless)),
  );

  let out = "";
  let first = true;
  for (const part of kept) {
    const piece =
      part.slot === undefined ? (part.literal ?? "") : slotBody(part, target, resolve);
    // An inline part joins with nothing whatever the target's separator is:
    // it is the middle of somebody's sentence, not the next thing being said.
    // Empty pieces are dropped, but an inline one must not take the separator
    // of the part after it with it.
    if (piece === "") continue;
    if (part.inline === true) out += piece;
    else if (first) out += piece;
    else out += JOIN[target] + piece;
    first = false;
  }
  return out;
}

function slotBody(
  part: Part,
  target: Variant,
  resolve: { slot: (name: string) => string },
): string {
  // The fallback is the operator's answer to an input that arrives empty, and
  // it is copy - so it goes through the same filter the value would.
  const html = resolve.slot(part.slot ?? "") || (part.fallback ?? "");
  if (html === "") return "";
  if (target === "plain") return plainTextOf(html);
  if (target === "qt") return qtSafe(html);
  return html;
}
