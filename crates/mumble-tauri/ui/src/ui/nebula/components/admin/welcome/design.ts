/**
 * The design model: a greeting laid out as blocks, with a typed signature.
 *
 * Taken from the design mock (`Greeting Design Editor.dc.html`), which settles
 * the questions a written spec left open — and settles one of them the other
 * way from how the spec guessed. Worth stating plainly, because it is the
 * decision everything else here follows from:
 *
 * **Blocks carry absolute positions.** `x`, `y` and `w` on a sheet, snapped to
 * a 4px grid, dragged and resized. An earlier draft argued a design should be a
 * vertical stack because a Qt client cannot honour coordinates. The mock's
 * answer is better: the *base* design is positioned, and the targets that
 * cannot honour that flatten it — which is a rule this module implements once
 * (`flowOf`) rather than a freedom taken away from whoever is designing.
 *
 * ## Inputs
 *
 * A design declares what it takes, and the graph fills it: any number of
 * **text slots**, fed by reusable-text nodes and rendered by `slot` blocks
 * wherever they are placed, and any number of **conditions**, fed by settled
 * conditions and used as on/off gates on any block. The greeting node draws one
 * port per declared input.
 *
 * ## Targets
 *
 * `base` is the master; the other four inherit from it and diverge
 * field-by-field. An override is a patch, never a second copy of the design:
 * editing a heading in base moves it in every target that has not overridden
 * *that field*, which is the whole reason this is not four documents.
 */

/** The five tabs. `base` is the master; the rest are what clients get. */
export const TARGETS = ["base", "plain", "rich", "html", "qt"] as const;
export type Target = (typeof TARGETS)[number];

/** A target that can diverge. `base` is what they diverge *from*. */
export type Variant = Exclude<Target, "base">;

export const TARGET_LABELS: Record<Target, { label: string; title: string }> = {
  base: { label: "Base", title: "The master design every target inherits" },
  plain: { label: "Plain", title: "Plain text" },
  rich: { label: "Rich", title: "Rich text subset" },
  html: { label: "HTML", title: "Full HTML clients" },
  qt: { label: "Qt", title: "Mumble 1.5 and older" },
};

export const BLOCK_TYPES = [
  "mark",
  "heading",
  "text",
  "button",
  "divider",
  "image",
  "callout",
  "links",
  "slot",
  "theme",
] as const;
export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABELS: Record<BlockType, string> = {
  mark: "Mark",
  heading: "Heading",
  text: "Text",
  button: "Button",
  divider: "Divider",
  image: "Image",
  callout: "Callout",
  links: "Link cards",
  slot: "Text slot",
  theme: "Theme",
};

/** One card in a `links` block. */
export interface LinkItem {
  kicker: string;
  label: string;
  url: string;
}

export interface Block {
  readonly id: string;
  readonly type: BlockType;
  /** Where it sits on the sheet, snapped to `GRID`. */
  x: number;
  y: number;
  w: number;
  /** Only the blocks whose height is not their content's: `mark`, `image`. */
  h?: number;
  size?: number;
  align?: "left" | "center" | "right";
  text?: string;
  /** `mark` only: one or two characters. */
  glyph?: string;
  /** `button` only. A link on the targets that cannot draw a button. */
  style?: "button" | "link";
  /** `button` only. http(s), which is all any client here will follow. */
  url?: string;
  /** `slot` only: the name of the text input rendered here. */
  slot?: string;
  /** Any block: the name of the condition that switches it on. */
  gate?: string;
  items?: LinkItem[];
}

/** A declared input. `text` ones are filled by slots, `bool` ones gate blocks. */
export interface Input {
  readonly id: string;
  name: string;
  /** The reusable-text node wired to it, or empty. Text inputs only. */
  wired?: string;
  /** What the editor previews it as. Never sent; the server evaluates the wire. */
  on?: boolean;
}

/** A patch per block, per target. Fields only — never a second design. */
export type Overrides = Partial<Record<Variant, Record<string, Partial<Block>>>>;

export interface Design {
  /** How wide the sheet is, which is what the positions are relative to. */
  sheetW: number;
  slots: Input[];
  conditions: Input[];
  blocks: Block[];
  overrides: Overrides;
}

/** Positions snap to this. Four is fine enough to place and coarse enough to line up. */
export const GRID = 4;

/** The narrowest and widest a sheet may be dragged. */
export const SHEET_MIN = 560;
export const SHEET_MAX = 1180;

export const snap = (value: number, on = true): number =>
  on ? Math.round(value / GRID) * GRID : Math.round(value);

/* -- What each target can draw -------------------------------------------- */

/**
 * Which block types a target simply cannot render.
 *
 * Dropped rather than approximated, and each of these is a real limit rather
 * than a style choice:
 *
 * * `plain` is text. A badge, a rule and a row of cards are all shape, and
 *   shape has no plain-text spelling worth having - a row of dashes is worse
 *   than nothing.
 * * `qt` and `rich` have no picture to draw: the artwork lives in the server's
 *   livery, which those paths have no way to fetch.
 */
export function droppedOn(type: BlockType, target: Target): boolean {
  switch (target) {
    case "plain":
      return type === "mark" || type === "image" || type === "divider" || type === "links";
    case "qt":
    case "rich":
      return type === "image";
    default:
      return false;
  }
}

/**
 * What the palette offers while a target tab is open.
 *
 * The target selector is what makes free positioning safe, and this is the
 * other half of it: on the Qt tab an operator is not offered an image, because
 * that path cannot fetch one, and on the Plain tab they are not offered a
 * badge, a rule or a card row. A block that cannot be drawn is not a block you
 * can add - which is a better answer than adding it and explaining afterwards
 * why it is missing.
 *
 * The base tab offers everything, because base is the design; what each target
 * does with it is that target's business.
 */
export function insertableOn(target: Target): BlockType[] {
  return BLOCK_TYPES.filter((type) => !droppedOn(type, target));
}

/**
 * Whether a target lays out in document order rather than on the sheet.
 *
 * `plain` is a stream of characters: there is no left, no width, and no font
 * size. Everything else keeps the geometry, which is what makes the base
 * design worth positioning in the first place.
 */
export const isFlat = (target: Target): boolean => target === "plain";

/* -- Resolving --------------------------------------------------------------*/

/** The patch this target holds for `block`, if any. */
export function overrideOf(design: Design, target: Target, block: string): Partial<Block> | undefined {
  return target === "base" ? undefined : design.overrides[target]?.[block];
}

/** A block as `target` sees it: the base, with that target's patch over it. */
export function effective(design: Design, target: Target, block: Block): Block {
  const patch = overrideOf(design, target, block.id);
  return patch ? { ...block, ...patch } : block;
}

/**
 * The blocks a target actually draws, in the order it draws them.
 *
 * Reading order for a flat target is **top to bottom, then left to right** -
 * derived from the positions rather than stored, so there is no second ordering
 * to maintain and no way for it to disagree with what is on the sheet. A block
 * moved above another in the editor moves above it in the plain text, with
 * nothing to press.
 *
 * Ties on `y` are broken by `x`, which is what makes two blocks side by side
 * read left to right.
 */
export function flowOf(design: Design, target: Target): Block[] {
  const shown = design.blocks
    .map((block) => effective(design, target, block))
    .filter((block) => !droppedOn(block.type, target));
  if (!isFlat(target)) return shown;
  return [...shown].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** Whether this block is switched on, for a preview with these conditions set. */
export function gateOpen(design: Design, block: Block): boolean {
  if (!block.gate) return true;
  const condition = design.conditions.find((entry) => entry.name === block.gate);
  // A gate naming a condition that no longer exists is open rather than shut:
  // a block that vanished because somebody renamed an input is a block nobody
  // can find again.
  return condition ? condition.on !== false : true;
}

/* -- Editing ---------------------------------------------------------------*/

/**
 * Set one field, on the base or as an override.
 *
 * The whole of what a target tab does. Editing on `base` writes the block;
 * editing on any other tab writes that target's patch and leaves the base
 * alone, which is what "switch a tab to diverge just there" means.
 */
export function setField<K extends keyof Block>(
  design: Design,
  target: Target,
  id: string,
  key: K,
  value: Block[K],
): Design {
  if (target === "base") {
    return {
      ...design,
      blocks: design.blocks.map((block) => (block.id === id ? { ...block, [key]: value } : block)),
    };
  }
  const held = design.overrides[target] ?? {};
  return {
    ...design,
    overrides: {
      ...design.overrides,
      [target]: { ...held, [id]: { ...held[id], [key]: value } },
    },
  };
}

/** Take one block back to what base says. */
export function revertBlock(design: Design, target: Target, id: string): Design {
  if (target === "base") return design;
  const held = { ...(design.overrides[target] ?? {}) };
  delete held[id];
  return { ...design, overrides: { ...design.overrides, [target]: held } };
}

/** Take a whole target back to base. */
export function revertTarget(design: Design, target: Target): Design {
  if (target === "base") return design;
  return { ...design, overrides: { ...design.overrides, [target]: {} } };
}

/** How many blocks this target has diverged on - the count on its tab. */
export function overrideCount(design: Design, target: Target): number {
  return target === "base" ? 0 : Object.keys(design.overrides[target] ?? {}).length;
}

export function addBlock(design: Design, block: Block): Design {
  return { ...design, blocks: [...design.blocks, block] };
}

/** Remove a block, and every target's override of it. */
export function removeBlock(design: Design, id: string): Design {
  const overrides: Overrides = {};
  for (const [target, held] of Object.entries(design.overrides)) {
    const kept = { ...held };
    delete kept[id];
    overrides[target as Variant] = kept;
  }
  return { ...design, blocks: design.blocks.filter((block) => block.id !== id), overrides };
}

/**
 * The design a fresh block opens with.
 *
 * Not empty, deliberately. A blank sheet teaches an operator nothing about what
 * a design is for, and the first thing anybody wants is the thing this starts
 * as: a badge, a title, a line, and a button. It also arrives with one input of
 * each kind, because the signature is the part that is hardest to guess at from
 * an empty editor - and the ports it puts on the node are the whole reason a
 * design block is a node rather than a settings page.
 */
export function starterDesign(): Design {
  const id = () => {
    seq += 1;
    return `b${Date.now().toString(36)}${seq.toString(36)}`;
  };
  return {
    sheetW: 520,
    slots: [{ id: "slot1", name: "rules" }],
    conditions: [{ id: "cond1", name: "is_new_member", on: true }],
    blocks: [
      { id: id(), type: "mark", x: 216, y: 28, w: 88, h: 88, glyph: "◆", align: "center" },
      {
        id: id(),
        type: "heading",
        x: 44,
        y: 136,
        w: 432,
        size: 30,
        align: "center",
        text: "Welcome aboard",
      },
      {
        id: id(),
        type: "text",
        x: 44,
        y: 192,
        w: 432,
        size: 14,
        align: "center",
        text: "Good to have you here.",
      },
      { id: id(), type: "divider", x: 44, y: 240, w: 432 },
      { id: id(), type: "slot", x: 44, y: 264, w: 432, slot: "rules" },
      {
        id: id(),
        type: "button",
        x: 44,
        y: 340,
        w: 432,
        align: "center",
        style: "button",
        text: "Register your account",
        gate: "is_new_member",
      },
    ],
    overrides: {},
  };
}

let seq = 0;

/* -- What is wrong with it -------------------------------------------------*/

/**
 * Problems an operator can act on, named by block.
 *
 * Not "invalid design": somebody looking at fourteen blocks cannot act on that.
 */
export function designProblems(design: Design): string[] {
  const problems: string[] = [];
  const slots = new Set(design.slots.map((input) => input.name));
  const conditions = new Set(design.conditions.map((input) => input.name));

  for (const block of design.blocks) {
    const what = BLOCK_LABELS[block.type];
    if (block.type === "slot") {
      if (!block.slot) problems.push(`A ${what} names no text input.`);
      else if (!slots.has(block.slot)) {
        problems.push(`${what} uses “${block.slot}”, which is not an input any more.`);
      }
    }
    if (block.gate && !conditions.has(block.gate)) {
      problems.push(`${what} is gated on “${block.gate}”, which is not an input any more.`);
    }
  }

  for (const input of design.slots) {
    if (!input.wired) problems.push(`The text input “${input.name}” has nothing wired to it.`);
  }

  // A target that drew nothing would arrive as an empty greeting, which reads
  // as a broken server rather than as a server with nothing to say.
  for (const target of TARGETS) {
    if (target === "base") continue;
    if (design.blocks.length > 0 && flowOf(design, target).length === 0) {
      problems.push(`Nothing at all is drawn on ${TARGET_LABELS[target].label}.`);
    }
  }

  return problems;
}
