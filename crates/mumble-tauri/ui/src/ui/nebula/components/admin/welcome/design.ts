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

import { isBuiltIn } from "./builtins";
import { inlineSlotsOf, renameInlineSlot, setInlineSlotHidden, withoutSlotTokens } from "./markup";

/**
 * Everything compiled and stored, one per kind of reader.
 *
 * All four go on the wire whatever the editor shows: the server picks between
 * them per peer (`target_for` in `starling/crates/runtime/src/greeting.rs`),
 * and a variant that stopped being compiled would be a set of clients that
 * stopped being greeted.
 */
export const VARIANTS = ["plain", "rich", "html", "qt"] as const;
export type Variant = (typeof VARIANTS)[number];

/**
 * The tabs the editor offers, which is a shorter list than what it compiles.
 *
 * `plain` and `html` used to be tabs and are not any more, and neither is a
 * loss:
 *
 * * **Plain** is text. There is nothing to lay out and nothing to colour, so a
 *   tab for it offered an operator a sheet on which every control did nothing.
 * * **HTML** differs from **Rich** only in that Rich drops pictures - and no
 *   Fancy client is ever sent HTML, because `target_for` gives the fork Rich.
 *   Two tabs that compile the same document, one of which nobody receives, is
 *   a choice with no answer.
 *
 * Both are still compiled, and both still honour any override a design already
 * carries for them - a document saved when they were tabs keeps what it was
 * given. What is gone is the ability to write *new* divergence there, which is
 * the part that was costing more than it bought.
 */
export const TARGETS = ["base", "rich", "qt"] as const;
export type Target = (typeof TARGETS)[number];

/**
 * Anything a block can be resolved against: a tab, or a variant being
 * compiled.
 *
 * The two lists overlap rather than nest, so the functions that answer "what
 * does this look like there" take the union. An override is only ever *written*
 * for a tab; it is *read* for anything.
 */
export type Surface = Target | Variant;

export const TARGET_LABELS: Record<Surface, { label: string; title: string }> = {
  base: { label: "Base", title: "The master design every target inherits" },
  plain: { label: "Plain", title: "Plain text, for a server with allow_html off" },
  rich: { label: "Rich", title: "Rich text subset" },
  html: { label: "HTML", title: "Full HTML clients" },
  // Named for the client rather than for the toolkit. "Qt" is the answer to a
  // question nobody administering a server is asking; the operator's question
  // is which of the people arriving see this one, and the answer is everybody
  // on the original Mumble.
  qt: {
    label: "Classic Mumble",
    title: "Recommended for the original Mumble client — 1.5 and older, which draw with Qt",
  },
};

/**
 * The four things a notice bar can be saying.
 *
 * Named for the message rather than for the colour - an operator writing "the
 * registration server is down" is looking for the error one, not for the red
 * one, and the colour is this module's business.
 */
/**
 * The fills a panel offers.
 *
 * A short list rather than a free colour field, and the reason is the same one
 * that governs every other painted thing here: a greeting is read on somebody
 * else's screen in somebody else's theme. These are picked to read against
 * both a light and a dark surface, and each is dark or light enough that
 * `inkOn` has an obvious answer for it.
 */
export const BACKGROUND_SWATCHES: readonly { readonly label: string; readonly colour: string }[] = [
  { label: "Paper", colour: "#eef2f7" },
  { label: "Sand", colour: "#f6efe2" },
  { label: "Mint", colour: "#e8f5ee" },
  { label: "Rose", colour: "#fbecec" },
  { label: "Lilac", colour: "#efeafa" },
  { label: "Slate", colour: "#33404f" },
  { label: "Ink", colour: "#1c2430" },
  { label: "Accent", colour: "#3399dd" },
];

/**
 * The colours a rule is worth drawing in.
 *
 * Not the background list. A border wants either a hairline that barely
 * separates two things - which on a dark ground is white at a few percent and
 * on a light one is black at a few percent - or a stated line in the ink of
 * whatever it is bounding. A rule painted "Sand" is a rule nobody can see.
 */
export const BORDER_SWATCHES: readonly { readonly label: string; readonly colour: string }[] = [
  // Named apart from the background swatches on purpose: the two lists sit in
  // the same panel, and two different "Ink" buttons is a panel nobody - and no
  // test - can point at unambiguously.
  { label: "Hairline", colour: "rgba(255,255,255,0.07)" },
  { label: "Rule", colour: "rgba(255,255,255,0.14)" },
  { label: "Soft ink", colour: "rgba(0,0,0,0.08)" },
  { label: "Strong ink", colour: "rgba(0,0,0,0.22)" },
  { label: "Steel", colour: "#888888" },
  { label: "Graphite", colour: "#33404f" },
];

/**
 * Shadows worth offering by name.
 *
 * The first two are the ones a current interface actually uses and neither
 * looks like a dropped shadow: a spread ring stands in for a border and
 * transitions without the box growing, and an inset highlight along the top
 * edge reads as light falling on a raised surface. The last two are ordinary
 * elevation, for when something really is meant to float.
 */
export const SHADOW_PRESETS: readonly { readonly id: string; readonly label: string; readonly css: string }[] = [
  { id: "ring", label: "Ring", css: "0 0 0 1px rgba(255,255,255,0.09)" },
  { id: "lit", label: "Lit edge", css: "inset 0 1px 0 0 rgba(255,255,255,0.10)" },
  { id: "soft", label: "Soft", css: "0 2px 4px rgba(0,0,0,0.30)" },
  { id: "raised", label: "Raised", css: "0 8px 24px -8px rgba(0,0,0,0.45)" },
];

/** The same, for the shadow under a block's words. */
export const TEXT_SHADOW_PRESETS: readonly { readonly id: string; readonly label: string; readonly css: string }[] = [
  { id: "lift", label: "Lift", css: "0 1px 2px rgba(0,0,0,0.55)" },
  { id: "deep", label: "Deep", css: "0 2px 8px rgba(0,0,0,0.65)" },
  { id: "glow", label: "Glow", css: "0 0 14px rgba(110,139,255,0.55)" },
];

/**
 * Colours that are not colours: they name a *role*, and the reader's own
 * client decides what that looks like.
 *
 * The problem a fixed colour has is that a greeting is read on somebody else's
 * screen. An operator running the dark theme picks a fill that reads
 * beautifully for them and it is the wrong choice for every reader on the
 * light one - and there is no colour that is right for both, which is why the
 * fixed swatches are all mid-tones that are merely *acceptable* on each.
 *
 * A role has no such problem. The client already publishes its whole palette
 * as CSS variables that follow the theme the reader chose and whether they are
 * in light or dark mode (`standardVariables` in `nebula/theme.ts`), so a
 * greeting that asks for "the accent" gets that reader's accent, in their
 * mode, resolved by their client at the moment they read it.
 *
 * Each carries a literal as well, and it is not a formality: it is what a
 * client with no such variable falls back to inside `var(…, …)`, and it is
 * what Classic Mumble is sent, because Qt has no custom properties at all.
 *
 * A fill also names the ink that belongs on it. `inkOn` cannot measure the
 * luminance of a colour it will not know until read time, so the pairing has
 * to be declared rather than computed - which is the same invariant, kept a
 * different way.
 */
export interface AutoColour {
  readonly label: string;
  /** The client's own variable for this role. */
  readonly css: string;
  /** What a client without that variable uses, and what Qt is sent. */
  readonly fallback: string;
  /** For a fill: the role whose colour reads on it. */
  readonly ink?: AutoColourId;
}

export type AutoColourId =
  | "auto:accent"
  | "auto:accentSoft"
  | "auto:onAccent"
  | "auto:surface"
  | "auto:line"
  | "auto:text"
  | "auto:muted";

export const AUTO_COLOURS: Record<AutoColourId, AutoColour> = {
  "auto:accent": {
    label: "Accent",
    css: "--color-accent",
    fallback: "#3399dd",
    ink: "auto:onAccent",
  },
  "auto:accentSoft": {
    label: "Accent tint",
    css: "--color-accent-soft",
    fallback: "#e8f2fb",
    // A tint is the accent at low strength, so the accent itself is what reads
    // on it - which is the whole look of a modern badge: the colour stated
    // quietly rather than shouted.
    ink: "auto:accent",
  },
  "auto:onAccent": { label: "On accent", css: "--color-text-on-accent", fallback: "#ffffff" },
  "auto:line": {
    label: "Hairline",
    // The theme's own line colour. Named for glass because that is where the
    // pack first needed it; it is the neutral rule every surface here is
    // separated by.
    css: "--color-glass-border",
    fallback: "#dbe1ea",
  },
  "auto:surface": {
    label: "Surface",
    css: "--color-bg-elevated",
    fallback: "#eef2f7",
    ink: "auto:text",
  },
  "auto:text": { label: "Body text", css: "--color-text-primary", fallback: "#1c2430" },
  "auto:muted": { label: "Muted text", css: "--color-text-secondary", fallback: "#888888" },
};

/** Whether this colour is a role rather than a fixed value. */
export function isAuto(colour: string | undefined): colour is AutoColourId {
  return colour !== undefined && colour in AUTO_COLOURS;
}

/**
 * A colour as a target that understands variables should say it.
 *
 * The role *and* the literal, because `var()` takes a fallback and a client
 * that has never heard of the variable is exactly the client that needs one.
 */
export function themedColour(colour: string): string {
  return isAuto(colour) ? `var(${AUTO_COLOURS[colour].css}, ${AUTO_COLOURS[colour].fallback})` : colour;
}

/** A colour as a target with no variables must have it: one fixed value. */
export function fixedColour(colour: string): string {
  return isAuto(colour) ? AUTO_COLOURS[colour].fallback : colour;
}

/**
 * The ink that goes on a fill, whether the fill is a role or a value.
 *
 * Declared for a role and measured for a value, because a role's colour is not
 * known until somebody reads the greeting.
 */
export function inkFor(bg: string): string | undefined {
  if (isAuto(bg)) return AUTO_COLOURS[bg].ink ?? "auto:text";
  // Only a fill this can actually measure. `inkOn` reads a hex, and a
  // translucent or gradient fill is not one - it used to return its dark
  // default for those, which set the ink of everything inside a `rgba(…)`
  // panel to near-black on a dark theme. A fill whose luminance is unknowable
  // is a fill the reader's own text colour is the right answer for, because a
  // translucent fill *is* mostly whatever is behind it.
  return /^#[0-9a-f]{3,8}$/i.test(bg.trim()) ? inkOn(bg) : undefined;
}

/**
 * The colours text may be set in.
 *
 * A different list from the fills, and it has to be. A block with a fill is
 * read on that fill, so anything goes; a block *without* one is read on
 * whatever surface the reader's client paints - white on the ordinary Mumble
 * theme, near-black on a dark one - so a text colour has to work on both.
 * These are the mid-tones that do. There is deliberately no black and no white
 * here: each of those is invisible on one of the two.
 */
export const TEXT_SWATCHES: readonly { readonly label: string; readonly colour: string }[] = [
  { label: "Accent", colour: "#3399dd" },
  { label: "Green", colour: "#2f9e5f" },
  { label: "Amber", colour: "#cc8a1a" },
  { label: "Red", colour: "#cc3b3b" },
  { label: "Violet", colour: "#8b5cf6" },
  { label: "Teal", colour: "#0f9b9b" },
  { label: "Grey", colour: "#888888" },
];

/**
 * The text colour that reads on a fill.
 *
 * Rec. 709 luminance against a mid threshold. Worked out rather than stored,
 * because the failure it prevents is the one that keeps happening: a panel
 * painted dark with the ink left alone is unreadable to everybody whose client
 * draws text dark, and a pale one is unreadable to everybody whose client
 * draws it light. Deciding here means neither can be saved.
 */
export function inkOn(bg: string): string {
  const hex = bg.replace("#", "");
  if (hex.length !== 6) return "#1c2430";
  const [r, g, b] = [0, 2, 4].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.55 ? "#1c2430" : "#ffffff";
}

export const NOTICE_TONES = ["info", "success", "warning", "danger"] as const;
export type NoticeTone = (typeof NOTICE_TONES)[number];

/**
 * What each tone is drawn with: its mark, its rule, its wash and its ink.
 *
 * The mark is a single character from the basic multilingual plane, which is
 * the part of it every client here has a glyph for - a symbol that arrives as
 * a hollow box says less than no symbol at all.
 *
 * The wash and the ink are always given together. Every surface that paints a
 * background has to state its own text colour, because a greeting is drawn
 * over whatever theme the reader is running: a pale wash with the ink left
 * alone is unreadable to everybody on a dark one.
 */
export const NOTICE_STYLE: Record<NoticeTone, { mark: string; rule: string; wash: string; ink: string }> = {
  info: { mark: "i", rule: "#3399dd", wash: "#eaf4fc", ink: "#12384f" },
  success: { mark: "✓", rule: "#2f9e5f", wash: "#eaf6ef", ink: "#14432c" },
  warning: { mark: "!", rule: "#cc8a1a", wash: "#fdf4e4", ink: "#4d3608" },
  danger: { mark: "✕", rule: "#cc3b3b", wash: "#fcecec", ink: "#4d1414" },
};

export const BLOCK_TYPES = [
  // The original ten.
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
  // Text.
  "quote",
  "list",
  "code",
  "html",
  // Layout.
  "panel",
  "notice",
  "spacer",
  "columns",
  "table",
  "card",
  // Media and brand.
  "video",
  "footer",
  "social",
  // Actions.
  "qr",
  "rating",
  "countdown",
  // Dynamic.
  "toggles",
  "repeater",
  "ab",
  // A box that holds other blocks. Late to the list because everything above
  // it was drawn on the assumption that a design is a flat stack, and it is
  // the one thing that assumption made impossible.
  "group",
  // Who is on the server, drawn live by the client that reads the greeting.
  "presence",
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
  quote: "Quote",
  list: "List",
  code: "Code",
  html: "Raw HTML",
  panel: "Panel",
  notice: "Notice",
  spacer: "Spacer",
  columns: "Columns",
  table: "Table",
  card: "Card",
  video: "Video",
  footer: "Footer",
  social: "Social",
  qr: "QR code",
  rating: "Rating",
  countdown: "Countdown",
  toggles: "Toggle group",
  repeater: "Repeater",
  ab: "A/B block",
  group: "Group",
  presence: "Who is online",
};

/* -- The palette ----------------------------------------------------------- */

/**
 * The palette's sections.
 *
 * Twenty-eight entries is past the point where a flat grid is scanned rather
 * than read, so they are grouped by what an operator is trying to do - put
 * words down, arrange them, show something, ask for something, or vary it per
 * reader - and the search box is there for everybody who already knows the
 * name.
 */
export const PALETTE_CATEGORIES = ["text", "layout", "media", "actions", "dynamic"] as const;
export type PaletteCategory = (typeof PALETTE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<PaletteCategory, string> = {
  text: "Text",
  layout: "Layout",
  media: "Media & brand",
  actions: "Actions",
  dynamic: "Dynamic",
};

/**
 * One thing the palette offers.
 *
 * An *entry*, not a type: `Button`, `Ghost btn` and `Link` are three entries on
 * one `button` block, because what separates them is a preset field and a
 * reader cannot tell the difference between "three kinds of block" and "one
 * block with three treatments" - but a maintainer very much can, and one type
 * with a `style` is the version that only has to be compiled once.
 */
export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** The mark the tile and the layer row carry. */
  readonly glyph: string;
  readonly category: PaletteCategory;
  readonly type: BlockType;
  /** What makes this entry itself, over the type's own defaults. */
  readonly preset?: Partial<Block>;
  /** Extra words the search should match, for entries known by another name. */
  readonly keywords?: readonly string[];
}

export const PALETTE: readonly PaletteItem[] = [
  // -- text
  { id: "heading", label: "Heading", glyph: "H1", category: "text", type: "heading" },
  {
    id: "subhead",
    label: "Subhead",
    glyph: "H2",
    category: "text",
    type: "heading",
    preset: { level: 2, size: 20 },
    keywords: ["subtitle", "h2"],
  },
  { id: "text", label: "Text", glyph: "¶", category: "text", type: "text", keywords: ["paragraph", "body"] },
  { id: "quote", label: "Quote", glyph: "“", category: "text", type: "quote", keywords: ["blockquote"] },
  { id: "list", label: "List", glyph: "•", category: "text", type: "list", keywords: ["bullets"] },
  { id: "code", label: "Code", glyph: "</>", category: "text", type: "code", keywords: ["monospace", "pre"] },
  {
    id: "html",
    label: "Raw HTML",
    glyph: "<>",
    category: "text",
    type: "html",
    keywords: ["markup", "source", "embed", "custom"],
  },

  // -- layout
  { id: "divider", label: "Divider", glyph: "—", category: "layout", type: "divider", keywords: ["rule", "hr"] },
  { id: "spacer", label: "Spacer", glyph: "⇕", category: "layout", type: "spacer", keywords: ["gap", "space"] },
  { id: "columns", label: "Columns", glyph: "◫", category: "layout", type: "columns", keywords: ["grid", "side by side"] },
  { id: "table", label: "Table", glyph: "▦", category: "layout", type: "table", keywords: ["rows", "cells"] },
  { id: "callout", label: "Callout", glyph: "▌", category: "layout", type: "callout", keywords: ["note", "aside"] },
  {
    id: "panel",
    label: "Panel",
    glyph: "■",
    category: "layout",
    type: "panel",
    keywords: ["background", "colour", "color", "fill", "block", "banner"],
  },
  // Four entries on one block, as the three buttons are: what separates them
  // is a preset field, and "four kinds of notice" is how an operator looks for
  // them even though it is one thing to compile.
  {
    id: "notice-info",
    label: "Info bar",
    glyph: "ℹ",
    category: "layout",
    type: "notice",
    preset: { tone: "info", text: "<p>Something worth knowing.</p>" },
    keywords: ["notice", "banner", "note"],
  },
  {
    id: "notice-success",
    label: "Success bar",
    glyph: "✓",
    category: "layout",
    type: "notice",
    preset: { tone: "success", text: "<p>That worked.</p>" },
    keywords: ["notice", "banner", "ok", "good"],
  },
  {
    id: "notice-warning",
    label: "Warning bar",
    glyph: "⚠",
    category: "layout",
    type: "notice",
    preset: { tone: "warning", text: "<p>Worth reading before you carry on.</p>" },
    keywords: ["notice", "banner", "caution"],
  },
  {
    id: "notice-danger",
    label: "Error bar",
    glyph: "✕",
    category: "layout",
    type: "notice",
    preset: { tone: "danger", text: "<p>This is broken right now.</p>" },
    keywords: ["notice", "banner", "danger", "alert", "critical"],
  },
  { id: "card", label: "Card", glyph: "▢", category: "layout", type: "card", keywords: ["panel", "box"] },

  // -- media and brand
  { id: "image", label: "Image", glyph: "▣", category: "media", type: "image", keywords: ["picture", "artwork"] },
  { id: "mark", label: "Mark", glyph: "◈", category: "media", type: "mark", keywords: ["badge", "logo", "glyph"] },
  { id: "video", label: "Video", glyph: "▶", category: "media", type: "video", keywords: ["clip", "embed"] },
  { id: "theme", label: "Theme", glyph: "◐", category: "media", type: "theme", keywords: ["colours", "livery"] },
  { id: "footer", label: "Footer", glyph: "▤", category: "media", type: "footer", keywords: ["small print", "legal"] },
  { id: "social", label: "Social", glyph: "◉", category: "media", type: "social", keywords: ["links", "profiles"] },

  // -- actions
  { id: "button", label: "Button", glyph: "▭", category: "actions", type: "button", preset: { style: "button" } },
  {
    id: "ghost",
    label: "Ghost btn",
    glyph: "▯",
    category: "actions",
    type: "button",
    preset: { style: "ghost" },
    keywords: ["outline", "secondary"],
  },
  {
    id: "link",
    label: "Link",
    glyph: "↗",
    category: "actions",
    type: "button",
    preset: { style: "link" },
    keywords: ["anchor", "href"],
  },
  { id: "qr", label: "QR code", glyph: "▩", category: "actions", type: "qr", keywords: ["scan"] },
  { id: "rating", label: "Rating", glyph: "★", category: "actions", type: "rating", keywords: ["stars", "feedback"] },
  { id: "countdown", label: "Countdown", glyph: "⌛", category: "actions", type: "countdown", keywords: ["timer", "expires"] },

  // -- dynamic
  { id: "slot", label: "Text slot", glyph: "Aa", category: "dynamic", type: "slot", keywords: ["input", "variable"] },
  {
    id: "toggles",
    label: "Toggle group",
    glyph: "◑",
    category: "dynamic",
    type: "toggles",
    keywords: ["condition", "switch"],
  },
  { id: "repeater", label: "Repeater", glyph: "⧉", category: "dynamic", type: "repeater", keywords: ["loop", "each"] },
  { id: "ab", label: "A/B block", glyph: "⇄", category: "dynamic", type: "ab", keywords: ["split", "variant"] },
  {
    id: "presence",
    label: "Who is online",
    glyph: "◍",
    category: "dynamic",
    type: "presence",
    keywords: ["online", "members", "people", "avatars", "faces", "count", "live", "presence"],
  },
  {
    id: "group",
    label: "Group",
    glyph: "▣",
    category: "layout",
    type: "group",
    keywords: ["box", "panel", "container", "card", "frame", "stack", "row"],
  },
];

/** The palette entry an existing block came from, for its mark and its name. */
export function paletteOf(block: Block): PaletteItem {
  const exact = PALETTE.find(
    (item) =>
      item.type === block.type &&
      (item.preset?.style === undefined || item.preset.style === block.style) &&
      (item.preset?.level === undefined || item.preset.level === block.level),
  );
  // `links` is no longer offered, and a design drawn when it was still holds
  // one - so the fallback is by type, and only then a mark of last resort.
  return (
    exact ??
    PALETTE.find((item) => item.type === block.type) ?? {
      id: block.type,
      label: BLOCK_LABELS[block.type],
      glyph: "▦",
      category: "layout",
      type: block.type,
    }
  );
}

/** What the palette offers on this target, optionally narrowed by a search. */
export function paletteFor(target: Surface, query = ""): PaletteItem[] {
  const needle = query.trim().toLowerCase();
  return PALETTE.filter((item) => !droppedOn(item.type, target)).filter((item) => {
    if (needle === "") return true;
    return (
      item.label.toLowerCase().includes(needle) ||
      CATEGORY_LABELS[item.category].toLowerCase().includes(needle) ||
      (item.keywords ?? []).some((word) => word.includes(needle))
    );
  });
}

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
  /** `heading` only: 1 for a heading, 2 for a subhead. */
  level?: 1 | 2;
  /** `mark` only: one or two characters. */
  glyph?: string;
  /** `button` only. A link on the targets that cannot draw a button. */
  style?: "button" | "ghost" | "link";
  /** `notice` only: which of the four it is, which decides its colour and mark. */
  tone?: NoticeTone;
  /**
   * The colour behind this block, as `#rrggbb`. Absent means none.
   *
   * A property of the block rather than of one kind of block: a heading, a
   * paragraph and a list all read better on a fill sometimes, and having a
   * "panel" be the only thing that could carry one meant wrapping content in a
   * block it did not belong in.
   */
  bg?: string;
  /**
   * A hairline around this block, as a colour. Absent means none.
   *
   * The control restraint is made of. A card defined by a one-pixel rule
   * rather than by a filled panel is most of what separates a current design
   * from one that reaches for a saturated block of colour every time it wants
   * to group two things - and until now the only bordered thing in the whole
   * system was the card, at a fixed grey nobody could change.
   *
   * One pixel, always. A thicker rule is a different design decision and not
   * one this needs; what it needs is the difference between *a* rule and none.
   */
  border?: string;
  /**
   * Whether this block sits only as wide as its own words.
   *
   * A block alone on its line is full width, which is what a paragraph wants
   * and what a badge does not: a pill stretched across the column stops being
   * a pill and becomes a masthead. Fitting one is how a tag, a chip or a
   * status pellet is made, and it is the difference between colour used as an
   * accent and colour used as a banner.
   *
   * It only means anything against `bg`, `border` or `pad` - a block with no
   * paint on it looks the same either way, because there is nothing to see the
   * edge of.
   */
  fit?: boolean;
  /**
   * A gradient painted behind this block, as full CSS.
   *
   * Separate from `bg`, and not a kind of it, because the two are used
   * *together*: a panel is a flat translucent fill with a soft wash of colour
   * over one corner, and collapsing them into one field means choosing. It is
   * written whole - `radial-gradient(110% 80% at 0% 0%, …)` - because there is
   * no useful smaller vocabulary for a gradient that a control could offer.
   *
   * Emitted as `background`, which is on the sanitiser's property list;
   * `background-color`, which is what `bg` uses, does not accept one. Qt has
   * never heard of a gradient and gets the flat fill alone.
   */
  grad?: string;
  /**
   * A brighter rule along the top edge alone, as a colour.
   *
   * The cheapest depth cue there is on a dark surface, and the one every
   * current dark interface uses: light falls from above, so the top edge of a
   * raised panel catches it and the other three do not. A real one is an inset
   * shadow, which no sanitiser here allows; a lighter `border-top` over a
   * dimmer `border` is the same picture in a property that survives.
   */
  borderTop?: string;
  /** How thick `border` is, in pixels. One unless something says otherwise. */
  borderWidth?: number;
  /**
   * Whether the rule is drawn solid, dashed or dotted.
   *
   * Solid unless asked otherwise. A dashed rule is what a placeholder, a drop
   * zone or a cut line is made of, and the compiler used to write `solid` flat
   * so there was no way to draw any of them.
   */
  borderStyle?: "solid" | "dashed" | "dotted";
  /**
   * A shadow behind this block, as full CSS.
   *
   * Written whole because a shadow is four numbers and a colour and there is no
   * smaller vocabulary worth offering. What it is *for* on a dark interface is
   * usually not a drop shadow at all: a `0 0 0 1px` spread ring in place of a
   * border, or an `inset 0 1px 0` highlight along the top edge that reads as
   * light falling on a raised surface.
   *
   * The markup targets only. Qt has never heard of it, and drops it in silence
   * like everything else it does not know.
   */
  shadow?: string;
  /**
   * A shadow under this block's words, as full CSS.
   *
   * The one thing that makes a display line readable over a busy background,
   * and separately a way to draw a glow around a word. Same vocabulary and
   * same caveat as `shadow`: written whole, and markup targets only.
   */
  textShadow?: string;
  /**
   * A radius given as a percentage instead of pixels.
   *
   * Only really one value matters - 50%, which is what makes a box a circle,
   * and so what makes an avatar an avatar. A pixel radius cannot say it,
   * because the box has to stay round at whatever size it ends up.
   */
  round?: boolean;
  /** Space *outside* this block, as CSS. Absent means none. */
  margin?: string;
  /** Padding as full CSS, for the blocks whose room is not the same all round. */
  padCss?: string;
  /** A fixed line box in pixels, which is how a chip centres one line of text. */
  leadPx?: number;
  /**
   * The data URI of the picture an `image` block draws.
   *
   * A data URI and not a link, because the sanitiser every reader renders
   * through drops an `<img>` whose `src` points anywhere else - deliberately,
   * so that a greeting cannot be used to log the address of everybody who
   * joins. The practical consequence is that artwork has to be small: the
   * whole compiled greeting is capped at 4096 characters, so this is the place
   * for a line icon or a mark, and never for a photograph.
   */
  src?: string;
  /**
   * The id of a picture in the design's own asset list.
   *
   * The other way to put a picture in a block, and the one that can carry a
   * photograph. `src` inlines a data URI into the message, which every client
   * can read and which therefore has to fit the four kilobytes a *string*
   * greeting is capped at - fine for a line icon, hopeless for anything else.
   * An asset travels as bytes to the clients that can receive bytes, so it is
   * held to a quarter of a megabyte instead.
   *
   * The trade is reach: a block drawn from an asset is drawn by Fancy clients
   * and nobody else. That is the same bargain `Design.only` already makes, and
   * the editor says so where the picture is chosen.
   */
  asset?: string;
  /**
   * A picture painted *behind* this block's contents.
   *
   * The other thing a photograph is for. `asset` puts one in a box of its own;
   * this puts one under words, which is what a hero band with a title on it
   * actually is - and it is why `blurBehind` exists beside it, because text
   * over a photograph is unreadable without something between them.
   *
   * Named rather than inlined for the same reason `asset` is, and applied by
   * the client rather than by the markup: a `url()` in CSS is a fetch, and the
   * sanitiser refuses every one of them.
   */
  bgAsset?: string;
  /**
   * How a background picture fills its box.
   *
   * `cover` crops to fill, `contain` fits the whole picture in, `fill` stretches
   * it. Cover is what a band wants and what this defaults to; contain is for a
   * logo or a mark that must not lose its edges.
   */
  bgFit?: "cover" | "contain" | "fill";
  /** Which part of a background picture survives the crop. `center` unless said. */
  bgPos?: string;
  /**
   * A blur applied to whatever is *behind* this block, in pixels.
   *
   * Frosted glass: a translucent fill over a blurred backdrop. The current way
   * to put words on a photograph and keep both - the picture still reads as a
   * picture, and the text sits on something rather than floating on noise.
   *
   * Needs a fill to be visible at all: blurring a backdrop and then painting
   * nothing over it shows the blur and nothing else.
   */
  blurBehind?: number;
  /** A blur applied to this block itself, in pixels. For a picture used as texture. */
  blur?: number;
  /**
   * How a picture sits in the box it was given.
   *
   * `cover` crops it to fill the box, which is what a band wants. `contain`
   * fits the whole picture inside, keeping its shape - which is what "take the
   * height and stay in proportion" means, and what a logo needs.
   */
  picFit?: "cover" | "contain" | "fill" | "none";
  /** The shape a block holds itself to, as CSS: `16/9`, `1`. */
  ratio?: string;
  /**
   * How the children of a `group` are laid out.
   *
   * * `stack` - each on its own line, which is the ordinary flow.
   * * `row` - side by side at their own widths, `gap` pixels apart. A negative
   *   gap overlaps them, which is exactly what an avatar cluster is.
   * * `cells` - side by side in equal columns, `gap` pixels of gutter between.
   *
   * `row` and `cells` are not the same layout with different numbers: a row
   * hugs its contents and a cell grid divides the width. Two cards beside each
   * other want the second; three overlapping circles want the first.
   */
  flow?: "stack" | "row" | "cells";
  /** Pixels between the children of a `row` or `cells` group. May be negative. */
  gap?: number;
  /**
   * Whether this block takes a share of the space left over in its row.
   *
   * What a pair of buttons across the foot of a card needs: two of them, both
   * growing, share the full width between them instead of huddling at the left
   * in whatever width their labels happened to make. Two growing children take
   * half each, three a third each - it is a share of the leftover, not a fixed
   * width, so the row stays right whatever the labels say.
   *
   * Only means anything inside a `row` group, which is the only flow with
   * leftover space to divide: a `cells` group has already divided it and a
   * `stack` gives every child the whole width anyway.
   */
  grow?: boolean;
  /**
   * `presence` only: how many faces to draw before the rest become a count.
   *
   * A cluster is a glance, not a census. Past four or five overlapping discs
   * nobody is reading faces any more, and the number beside them is doing all
   * the work - so this is where the drawing stops and the counting starts.
   */
  faces?: number;
  /**
   * Whether this block's drawn height is a height in the message too.
   *
   * A group's rectangle is how the sheet decides what is inside it, which is
   * not the same question as how tall the box should be when somebody reads
   * it: a card is as tall as its contents, and freezing it at whatever the
   * operator dragged the outline to is how a card ends up with a hole in the
   * bottom of it. An empty group *is* its rectangle - a circle, a rule, a
   * space - and that is what this says.
   */
  boxed?: boolean;
  /**
   * How this block sits against the others on its line, when they are boxes of
   * different heights.
   *
   * Only means anything inside a `row` group. Three circles and a text pill
   * are four inline boxes with four different baselines, and the default -
   * baseline - lines up the *text* in them, which puts the circles somewhere
   * nobody asked for. `middle` is what makes a cluster a cluster.
   */
  valign?: "top" | "middle" | "bottom";
  /**
   * Whether this block's words are a line rather than a paragraph.
   *
   * A block that carries its own box - a fill, a padding, a margin - does not
   * want a `<p>` inside it as well: the paragraph brings margins of its own
   * that fight the ones the block was given, and a paragraph inside an inline
   * box is not something the parser is obliged to keep. A heading, a label, a
   * button's caption and a chip's text are all lines.
   *
   * Prose stays prose. This is for the single line, which is most of what a
   * designed sheet is made of.
   */
  bare?: boolean;
  /**
   * How round this block's corners are, in pixels. Absent means square.
   *
   * The single biggest thing separating a greeting that looks current from one
   * that looks like 2003, and until now there was no way to ask for it. Every
   * markup client this ships to honours `border-radius`; Qt does not, and a
   * rounded card there is simply a square one, which is the same downgrade
   * every other rounded thing on that target takes.
   */
  radius?: number;
  /**
   * The space between this block's edge and its words, in pixels.
   *
   * Generous space is most of what "designed" looks like, and a fixed six
   * pixels is what every block had. Only meaningful with a fill or a border -
   * padding on nothing is nothing.
   */
  pad?: number;
  /**
   * How heavy the words are.
   *
   * Any number, not one of four. The client ships Inter as a variable font,
   * whose weight axis is continuous, and the stops current interfaces actually
   * use are between the named ones - 510 for body and 590 for emphasis, where
   * 400 reads thin on a dark ground and 700 reads like a shout. A control that
   * offered Normal, Semi and Heavy could not ask for any of them.
   */
  weight?: number;
  /**
   * Letter spacing, in hundredths of an em. Fractional: the useful values are
   * not whole numbers.
   *
   * Inter's own metrics put the tracking of a 32px line at -0.022em and of a
   * 15px line at -0.011em, which are -2.2 and -1.1 here. Rounding those to
   * whole hundredths is a visible error on a display line, which is the one
   * place tracking matters most.
   *
   * Negative tightens, which is what a large display heading wants; positive
   * opens up, which is what a small upper-case eyebrow wants. Both are the
   * kind of adjustment that reads as *typeset* rather than typed.
   *
   * Qt has no `letter-spacing`, so that target keeps the face as it is.
   */
  tracking?: number;
  /** Line height as a percentage. 140 is comfortable for prose, 105 for display. */
  leading?: number;
  /**
   * The widest this block's words are allowed to run, in pixels.
   *
   * A measure. A paragraph the full width of a chat pane is a paragraph nobody
   * finishes, and this is the only way to say so. Qt has no `max-width`, and
   * takes the full column there.
   */
  measure?: number;
  /**
   * The colour the words are set in, as `#rrggbb`. Absent means the default.
   *
   * The default is not "black": it is `inkOn(bg)` where the block has a fill,
   * and the reader's own text colour where it has not. That is what keeps a
   * filled block readable without anybody having to think about it, and it is
   * why this is optional rather than defaulted at the point of writing.
   */
  fg?: string;
  /** `button`, `video`, `qr` and `social` items. http(s), which is all any client here will follow. */
  url?: string;
  /** `slot` only: the name of the text input rendered here. */
  slot?: string;
  /**
   * `slot` only: what is drawn when the input arrives empty.
   *
   * A slot with nothing behind it renders as a hole in the middle of a
   * greeting; this is the operator's answer to that, sent in the slot's place
   * rather than left to the reader to notice.
   */
  fallback?: string;
  /**
   * `slot` only: this usage is switched off without being deleted.
   *
   * The same input is often placed in several spots while a design is being
   * worked out, and hiding one is how an operator tries the design without it -
   * a delete would take the block's position and size with it.
   */
  hidden?: boolean;
  /** Any block: the name of the condition that switches it on. */
  gate?: string;
  /** `links`, `columns`, `social`: the cards or columns inside it. */
  items?: LinkItem[];
  /** `ab` only: the copy sent when the gate does *not* hold. */
  altText?: string;
  /**
   * `rating` only: how many stars are filled, of five.
   *
   * Its own field rather than `size`, which everywhere else on a block is the
   * font size in pixels - a rating whose star count was its type size was a
   * block with no way to be four stars at 14px.
   */
  stars?: number;
  /**
   * `countdown` only: the moment it counts to, as `YYYY-MM-DD`.
   *
   * The editor shows how far off that is; the message shows the date. A
   * greeting is assembled once at handshake and then read, so nothing in it can
   * tick - and a deadline somebody can read is worth more than a number frozen
   * at the moment they joined.
   */
  until?: string;
  /** `list` only: one line per item. */
  lines?: string[];
  /** `table` only: rows of cells, the first being the header. */
  rows?: string[][];
}

/** A declared input. `text` ones are filled by slots, `bool` ones gate blocks. */
export interface Input {
  readonly id: string;
  name: string;
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
  /**
   * The pictures this design draws, stored once each.
   *
   * Out here rather than on the block for the same reason the server keeps them
   * out of a compiled target: the same photograph is one picture however many
   * blocks draw it, and a copy per block would be the same bytes several times
   * over in the one place bytes are expensive.
   *
   * A block names one by id. Absent on a design that draws none, which is every
   * design that predates them.
   */
  assets?: DesignAsset[];
  /**
   * The targets this sheet is compiled for. Absent means all of them.
   *
   * Not every design can be said in every vocabulary, and a sheet built out of
   * gradients, inlined pictures and rounded translucent panels is a sheet the
   * old client can draw none of. Flattening one into Classic's table markup
   * produces something nobody designed *and* blows the 4096-character cap the
   * server spends on every join, because Qt needs a whole table around each
   * block where a browser needs a span.
   *
   * A target left out has no compiled parts, and the server already knows what
   * to do with that: it falls back to the greeting's own written halves, which
   * is what that reader was getting before anybody drew a sheet. So the honest
   * arrangement for a design like that is a modern sheet for the clients that
   * can draw it and a written paragraph for the ones that cannot - rather than
   * one document pretending to be both.
   */
  only?: readonly Variant[];
}

/**
 * A picture a design carries.
 *
 * Held as a data URI here because the editor draws it - the artboard, the
 * preview and the block browser all need something an `<img>` can take - and
 * converted to bytes on the way to the server, which is where the base64 stops
 * being paid for.
 *
 * `w` and `h` are what it was *encoded* at, not what it is drawn at. A picture
 * scaled down to fit a budget and then drawn larger is a blurry picture, and
 * the editor needs to be able to say so.
 */
export interface DesignAsset {
  /** Referenced from a block, and from the markup as `fm-a-<id>`. */
  readonly id: string;
  /** `image/webp`, `image/jpeg`, `image/png`. */
  readonly mime: string;
  /** The whole `data:` URI, prefix included. */
  readonly src: string;
  readonly w: number;
  readonly h: number;
  /** What it weighs as bytes, which is what the server's cap counts. */
  readonly bytes: number;
}

/**
 * The design's pictures, with the ones nothing draws any more left out.
 *
 * Called after a block stops naming one. A design that kept every picture it
 * had ever been shown would pay for all of them on every join - and the two
 * fields that can name one, `asset` and `bgAsset`, both have to be asked, or
 * removing a block's foreground picture would take a background still in use.
 */
export function keptAssets(design: Design): DesignAsset[] {
  const drawn = new Set<string>();
  for (const block of design.blocks) {
    if (block.asset !== undefined) drawn.add(block.asset);
    if (block.bgAsset !== undefined) drawn.add(block.bgAsset);
  }
  return (design.assets ?? []).filter((asset) => drawn.has(asset.id));
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
export function droppedOn(type: BlockType, target: Surface): boolean {
  switch (target) {
    case "plain":
      // Anything whose whole content is a shape rather than words. A spacer is
      // white space, a QR code is a picture of a link the plain half already
      // carries as a link, and a rating is five characters of decoration.
      return (
        type === "mark" ||
        type === "image" ||
        type === "divider" ||
        type === "links" ||
        type === "spacer" ||
        type === "video" ||
        type === "qr" ||
        type === "rating" ||
        type === "columns" ||
        type === "card"
      );
    case "qt":
      // Only the picture. Everything else on this list used to be here on the
      // grounds that Qt would not paint a border or a background - it will,
      // on a table cell, which is what a card, a spacer and a filled button
      // are all built from now. What remains genuinely impossible is artwork:
      // Qt's rich text has no data URI, so an inlined picture is a broken
      // image icon there rather than a picture.
      return type === "image";
    case "rich":
      // An image is drawn here now. It used to be on this list because the
      // artwork was the server's livery and this path could not fetch one;
      // what a design carries instead is the picture itself, inlined, which
      // needs nothing fetched and is the only kind of image the sanitiser
      // every reader renders through will keep.
      return type === "video" || type === "qr";
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
export function insertableOn(target: Surface): BlockType[] {
  return BLOCK_TYPES.filter((type) => !droppedOn(type, target));
}

/**
 * Whether a block is one whose size the operator sets.
 *
 * A slot is not: what arrives at send time is the size it takes, and a handle
 * that promised otherwise would be resizing a placeholder rather than the
 * value. Hiding the usage is the way to drop it from the design, which is what
 * the inspector says in its place.
 */
export function resizable(block: Block): boolean {
  return block.type !== "slot";
}

/**
 * Whether a block's copy can hold an input *inside* it.
 *
 * Prose can: a paragraph split around a value is still one paragraph. A label
 * cannot - a button's text becomes one `<a>` and a heading one `<h2>`, so
 * splitting either around an input would produce two of them. Those blocks bind
 * to an input whole, through a slot, or not at all.
 */
/**
 * Whether a block's body is markup rather than a plain string.
 *
 * The same set that can hold an input inside it, and for the same reason: these
 * are the blocks whose body is *prose*, and prose people write has bold in it.
 *
 * An earlier pass had only `text` here and left the other four with a plain
 * field. That was fixing the wrong end of a real bug - a rich editor had been
 * pointed at fields that were escaped on the way out, so markup reached readers
 * as tags. Taking the editor away made the output correct by making the block
 * less useful; rendering and compiling these as the markup they are makes it
 * correct without that.
 */
export function isRichBody(type: BlockType): boolean {
  return carriesInline(type);
}

export function carriesInline(type: BlockType): boolean {
  return type === "text" || type === "quote" || type === "callout" || type === "card" || type === "footer";
}

/** Whether a block's height is the operator's rather than its content's. */
export function hasHeight(type: BlockType): boolean {
  return type === "mark" || type === "image" || type === "video" || type === "spacer" || type === "qr";
}

/**
 * Whether a target lays out in document order rather than on the sheet.
 *
 * `plain` is a stream of characters: there is no left, no width, and no font
 * size. Everything else keeps the geometry, which is what makes the base
 * design worth positioning in the first place.
 */
export const isFlat = (target: Surface): boolean => target === "plain";

/* -- Resolving --------------------------------------------------------------*/

/**
 * A block moved through the stack, without moving it on the sheet.
 *
 * Blocks are positioned, so they overlap, and which one is on top is the order
 * they are stored in - later is nearer the reader. That was an order an
 * operator could only change by deleting a block and adding it again, which
 * also loses everything written in it.
 *
 * Only the *drawing* is affected. What each target compiles to is ordered
 * geometrically, top to bottom and then left to right (`rowsOf`), so bringing
 * a block forward changes what covers what on the sheet and changes nothing
 * about the message anybody is sent.
 */
export function reorderBlock(design: Design, id: string, to: "front" | "forward" | "backward" | "back"): Design {
  const at = design.blocks.findIndex((block) => block.id === id);
  if (at === -1) return design;
  const last = design.blocks.length - 1;
  const target =
    to === "front" ? last : to === "back" ? 0 : to === "forward" ? Math.min(last, at + 1) : Math.max(0, at - 1);
  if (target === at) return design;
  const blocks = [...design.blocks];
  const [moved] = blocks.splice(at, 1);
  blocks.splice(target, 0, moved);
  return { ...design, blocks };
}

/**
 * One target's design, copied onto another.
 *
 * What it is for: designing once and then adapting. An operator lays a
 * greeting out on Base, switches to Classic Mumble, and wants to start from
 * what they already drew rather than from the same blank sheet again - or has
 * tuned Classic and wants Rich to match it.
 *
 * Best effort, and the two words are meant separately:
 *
 * * **Best**, in that everything the destination *can* hold is carried over
 *   whole - position, size, copy, colours, gates, every field.
 * * **Effort**, in that a block the destination cannot draw at all is left
 *   behind rather than approximated. Copying a picture onto Classic Mumble
 *   would write an override for a block that target drops, which is an
 *   override nobody can see, edit or clear.
 *
 * Written as *overrides* rather than into the blocks themselves, because that
 * is what a target is: base stays the master, and this fills in one target's
 * divergence from it. Copying onto `base` is therefore the one direction that
 * writes blocks - there is nothing for base to diverge from.
 */
export function copyDesignTo(design: Design, from: Surface, to: Target): Design {
  if (from === to) return design;
  const source = design.blocks.map((block) => effective(design, from, block));

  if (to === "base") {
    // Onto the master: the blocks themselves, and that target's own overrides
    // dropped - they described a divergence from a base that no longer exists.
    return { ...design, blocks: source, overrides: { ...design.overrides, [from]: undefined } };
  }

  const patch: Record<string, Partial<Block>> = {};
  for (const block of source) {
    if (droppedOn(block.type, to)) continue;
    // Everything but the identity, which is what makes it the same block.
    const { id: _id, type: _type, ...fields } = block;
    patch[block.id] = fields;
  }
  return { ...design, overrides: { ...design.overrides, [to]: patch } };
}

/**
 * What a target will not draw of what is on the sheet.
 *
 * The warning the editor shows when you switch to one. Nothing is lost from
 * the *design* - a dropped block is still there, and still drawn on every
 * target that can hold it - but it is not in the message those readers get,
 * and that is worth saying out loud at the moment somebody starts working on
 * that target rather than after they save.
 */
export function droppedBy(design: Design, target: Surface): BlockType[] {
  const kinds = new Set<BlockType>();
  for (const block of design.blocks) {
    if (droppedOn(block.type, target)) kinds.add(block.type);
  }
  return [...kinds];
}

/** The patch this target holds for `block`, if any. */
export function overrideOf(design: Design, target: Surface, block: string): Partial<Block> | undefined {
  return target === "base" ? undefined : design.overrides[target]?.[block];
}

/** A block as `target` sees it: the base, with that target's patch over it. */
export function effective(design: Design, target: Surface, block: Block): Block {
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
export function flowOf(design: Design, target: Surface): Block[] {
  const shown = design.blocks
    .map((block) => effective(design, target, block))
    .filter((block) => !droppedOn(block.type, target));
  if (!isFlat(target)) return shown;
  return [...shown].sort((a, b) => a.y - b.y || a.x - b.x);
}

/**
 * A block and whatever is drawn inside it.
 *
 * The design is stored as a flat list and nested by geometry, which is the same
 * bargain `rowsOf` already makes: two blocks are a row because their tops line
 * up, and a block is inside a group because it is drawn inside the group. There
 * is no stored parent to keep in step with what is on the sheet, no way for the
 * two to disagree, and nothing to press - an operator drags a card onto a panel
 * and it is on the panel.
 *
 * The cost is that containment is decided by a rectangle, so a group has to
 * have a real height. That is why a group is the one block the editor always
 * gives an `h` and always lets you resize: its size is not a consequence of its
 * contents, it is the question being asked.
 */
export interface Nested {
  readonly block: Block;
  children: Nested[];
}

/** The room a block takes on the sheet, for comparing one against another. */
const areaOf = (block: Block): number => block.w * (block.h ?? 12);

/**
 * Whether `inner` is drawn inside `outer`.
 *
 * Two conditions, and the second is not decoration. Containment by centre point
 * alone is *not* an ordering: a wide short band and a tall narrow column can
 * each hold the other's middle, and a card overlapping the bottom of the panel
 * it sits on does exactly that. Left at that, the two were each other's parent,
 * neither was a root, and the whole sheet compiled to nothing at all - which is
 * what a greeting with a frosted card over a photograph did.
 *
 * Requiring the parent to be strictly bigger makes it an ordering again: a
 * cycle would need two blocks each larger than the other. Equal areas are not
 * a tie to break, they are two blocks neither of which is inside the other.
 */
function within(inner: Block, outer: Block): boolean {
  const cx = inner.x + inner.w / 2;
  const cy = inner.y + (inner.h ?? 12) / 2;
  const held =
    cx > outer.x && cx < outer.x + outer.w && cy > outer.y && cy < outer.y + (outer.h ?? 0);
  return held && areaOf(outer) > areaOf(inner);
}

/**
 * The blocks as a tree, nested by what is drawn inside what.
 *
 * The innermost group wins, so a card on a panel belongs to the card. Ties are
 * impossible: two groups of the same area cannot both contain the same centre
 * point unless they are the same rectangle, and then the earlier one takes it
 * and the later one is empty, which is what the sheet shows.
 */
export function nest(blocks: readonly Block[]): Nested[] {
  const groups = blocks.filter((block) => block.type === "group");
  const nodes = new Map<string, Nested>(
    blocks.map((block) => [block.id, { block, children: [] as Nested[] }]),
  );
  const roots: Nested[] = [];
  for (const block of blocks) {
    // Smallest first, so the innermost group that contains this block wins.
    const parent = groups
      .filter((group) => group.id !== block.id && within(block, group))
      .sort((a, b) => areaOf(a) - areaOf(b))[0];
    const node = nodes.get(block.id);
    if (node === undefined) continue;
    if (parent === undefined) roots.push(node);
    else nodes.get(parent.id)?.children.push(node);
  }
  // Cycles are impossible now that a parent must be strictly bigger, but the
  // walk still guards against one: this runs on every keystroke over a document
  // the editor is not the only writer of, and a stack overflow on the login
  // path is a worse answer than a block drawn once.
  const seen = new Set<string>();
  const prune = (list: Nested[]): Nested[] =>
    list.filter((node) => {
      if (seen.has(node.block.id)) return false;
      seen.add(node.block.id);
      node.children = prune(node.children);
      return true;
    });
  return prune(roots);
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

/* -- The signature ---------------------------------------------------------*/

/** Which list an input lives in. Text ones fill slots; bool ones gate blocks. */
export type InputKind = "slot" | "condition";

/**
 * A name a port can carry.
 *
 * The name *is* the binding - a wire lands on `in:<name>`, a slot block names
 * one, a gate names one - so it has to be something that reads the same
 * everywhere it appears. Lower case, words joined by underscores, and nothing
 * else: a name with a colon in it would split a port id, and one that differs
 * from another only by case is two ports an operator cannot tell apart.
 *
 * Empty is a legitimate result here (somebody clearing the field), and the
 * caller decides what to do about it rather than this inventing a name.
 */
export function normaliseInputName(raw: string): string {
  return raw
    .toLowerCase()
    .replaceAll(/[^a-z0-9_\s-]/g, "")
    .trim()
    .replaceAll(/[\s-]+/g, "_")
    .replaceAll(/_{2,}/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Every name already taken, in either list: one namespace, one set of ports. */
function takenNames(design: Design, except?: string): Set<string> {
  return new Set(
    [...design.slots, ...design.conditions]
      .filter((input) => input.id !== except)
      .map((input) => input.name),
  );
}

/** `name`, or `name_2`, or whatever the first free one is. */
function freeName(design: Design, wanted: string, except?: string): string {
  const taken = takenNames(design, except);
  if (!taken.has(wanted)) return wanted;
  for (let n = 2; ; n += 1) {
    const candidate = `${wanted}_${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Declare another input.
 *
 * Named rather than left blank, because the name is what appears on the node's
 * port the moment this returns: an unnamed port is one nobody can wire to, and
 * a design that briefly had one would briefly have a port called nothing.
 */
export function addInput(design: Design, kind: InputKind): Design {
  seq += 1;
  const input: Input = {
    id: `i${Date.now().toString(36)}${seq.toString(36)}`,
    name: freeName(design, kind === "slot" ? "text" : "toggle"),
    ...(kind === "condition" ? { on: true } : {}),
  };
  return kind === "slot"
    ? { ...design, slots: [...design.slots, input] }
    : { ...design, conditions: [...design.conditions, input] };
}

/**
 * Rename an input, and everything inside the design that names it.
 *
 * The blocks are rewritten here; the *wire* to the port is the graph's, and the
 * editor cannot reach it - see `renameDesignInput` in `model.ts`, which does
 * both and is what the editor actually calls.
 *
 * A name that normalises to nothing, or to one already taken, is answered with
 * the nearest free one rather than refused: somebody typing over a name passes
 * through every prefix of it, and a field that rejected each would be a field
 * nobody can type in.
 */
export function renameInput(design: Design, id: string, raw: string): { design: Design; name: string } {
  const input = [...design.slots, ...design.conditions].find((entry) => entry.id === id);
  if (!input) return { design, name: "" };
  const wanted = normaliseInputName(raw);
  const name = freeName(design, wanted === "" ? input.name : wanted, id);
  if (name === input.name) return { design, name };

  const rename = (list: Input[]) => list.map((entry) => (entry.id === id ? { ...entry, name } : entry));
  const was = input.name;
  return {
    design: {
      ...design,
      slots: rename(design.slots),
      conditions: rename(design.conditions),
      blocks: design.blocks.map((block) => ({
        ...block,
        slot: block.slot === was ? name : block.slot,
        gate: block.gate === was ? name : block.gate,
        // Inline usages carry the name in the copy itself, so a rename that
        // stopped at the fields would leave every `{{was}}` in a paragraph
        // pointing at an input that no longer exists.
        text: block.text === undefined ? block.text : renameInlineSlot(block.text, was, name),
        items: block.items?.map((item) =>
          item.kicker === was ? { ...item, kicker: name } : item,
        ),
      })),
      overrides: mapOverrides(design.overrides, (patch) => ({
        ...patch,
        slot: patch.slot === was ? name : patch.slot,
        gate: patch.gate === was ? name : patch.gate,
      })),
    },
    name,
  };
}

/**
 * Undeclare an input, and unbind whatever pointed at it.
 *
 * A block left naming an input that is gone is the one state `designProblems`
 * cannot help with: it reads as a design that is broken rather than as one an
 * operator simplified. A gate is dropped (the block becomes unconditional,
 * which is what "no longer switched by anything" means) and a slot block is
 * left naming nothing, which the problems list *does* name - because an empty
 * slot block is a hole in the greeting and somebody has to choose what fills it.
 */
export function removeInput(design: Design, id: string): Design {
  const input = [...design.slots, ...design.conditions].find((entry) => entry.id === id);
  if (!input) return design;
  const gone = input.name;
  return {
    ...design,
    slots: design.slots.filter((entry) => entry.id !== id),
    conditions: design.conditions.filter((entry) => entry.id !== id),
    blocks: design.blocks.map((block) => ({
      ...block,
      slot: block.slot === gone ? undefined : block.slot,
      gate: block.gate === gone ? undefined : block.gate,
      // A branch whose condition is gone would be sent unconditionally, which
      // is the opposite of what it said.
      items: block.items?.filter((item) => item.kicker !== gone),
    })),
    overrides: mapOverrides(design.overrides, (patch) => ({
      ...patch,
      slot: patch.slot === gone ? undefined : patch.slot,
      gate: patch.gate === gone ? undefined : patch.gate,
    })),
  };
}

/** Whether a preview toggle is on. Only conditions have one. */
export function setInputPreview(design: Design, id: string, on: boolean): Design {
  return {
    ...design,
    conditions: design.conditions.map((entry) => (entry.id === id ? { ...entry, on } : entry)),
  };
}

/** Every target's patch, run through one function. */
function mapOverrides(overrides: Overrides, patch: (held: Partial<Block>) => Partial<Block>): Overrides {
  const out: Overrides = {};
  for (const [target, held] of Object.entries(overrides)) {
    out[target as Variant] = Object.fromEntries(
      Object.entries(held).map(([id, fields]) => [id, patch(fields)]),
    );
  }
  return out;
}

/* -- The clipboard ---------------------------------------------------------*/

/**
 * The tag that says a clipboard string is a block from an editor like this one.
 *
 * Versioned for the same reason the node canvas's is: the shape of a `Block` is
 * this editor's to change, and a build that pasted an older one as if it were
 * current would put a block on the sheet with fields nobody wrote.
 */
const FORMAT = "fancy-mumble/design-block@1";

/**
 * A block as text, so a copy can leave this window.
 *
 * Two servers open in two windows is how somebody moves a callout they like
 * from one greeting to another, and an in-memory clipboard cannot do it - the
 * node canvas already works this way, and a block that did not would be the
 * odd one out on the same screen.
 */
export function encodeBlock(block: Block): string {
  return JSON.stringify({ format: FORMAT, block });
}

/**
 * A block read back, or `null` for text that is not one.
 *
 * Pasting a URL or a paragraph onto a sheet does nothing, rather than adding a
 * block with no type - so the id is minted by the caller and the type is
 * checked here, which are the two fields nothing downstream tolerates being
 * wrong.
 */
export function decodeBlock(text: string): Block | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) return null;
    const held = parsed as { format?: unknown; block?: unknown };
    if (held.format !== FORMAT || typeof held.block !== "object" || held.block === null) return null;
    const block = held.block as Block;
    if (!BLOCK_TYPES.includes(block.type)) return null;
    return {
      ...block,
      x: Number.isFinite(block.x) ? block.x : 0,
      y: Number.isFinite(block.y) ? block.y : 0,
      w: Number.isFinite(block.w) && block.w > 0 ? block.w : 240,
    };
  } catch {
    // Unparseable is simply not a block. The clipboard holds whatever the
    // operator last copied anywhere, and most of it is prose.
    return null;
  }
}

/* -- Usages ---------------------------------------------------------------- */

/**
 * Every place one input is actually used.
 *
 * The thing this model got wrong at first was assuming an input had *one*
 * home - one slot block, one gated block. In practice a name goes in the
 * heading and again in the footer, a condition switches three things on at
 * once, and a product name lands in a hundred places. So a usage is a first
 * class thing an operator can count, step through, select and switch off, and
 * the input is what they all share.
 *
 * Usages are **derived**, never stored: they are read off the blocks and the
 * copy, so there is no second list to fall out of step with the design. The one
 * thing that *is* stored is whether a usage is hidden - which lives on the
 * thing being hidden (a flag on the block, a marker in the token), never in a
 * table of its own.
 */
export type UsageKind = "slot" | "inline" | "gate";

/** The bands a design is read in, for grouping a long list of usages. */
export const SECTIONS = ["header", "body", "footer"] as const;
export type Section = (typeof SECTIONS)[number];

export const SECTION_LABELS: Record<Section, string> = {
  header: "Header",
  body: "Body",
  footer: "Footer",
};

export interface Usage {
  /** Stable across a re-read, so a selection survives an edit elsewhere. */
  readonly id: string;
  /** The input's name. */
  readonly input: string;
  readonly kind: UsageKind;
  /** The block it is in. */
  readonly block: string;
  /** For an inline usage, which token in that block's copy. Otherwise zero. */
  readonly at: number;
  /** Which usage of this input it is, counting from one, in reading order. */
  readonly index: number;
  /** What it is called in a list: "Text slot", "Text · inline", "Button". */
  readonly label: string;
  readonly hidden: boolean;
  readonly section: Section;
}

/**
 * Which band of the sheet a block sits in.
 *
 * By position rather than by a container, because the design has no sections -
 * it is a sheet with things on it. The top eighth and the bottom eighth of a
 * design are reliably its header and its footer in the single-column layouts
 * these actually are, and everything between is the body.
 */
function sectionOf(block: Block, sheetH: number): Section {
  if (sheetH <= 0) return "body";
  if (block.y < sheetH * 0.18) return "header";
  if (block.y > sheetH * 0.78) return "footer";
  return "body";
}

/** How tall the design reads as, for the section bands. */
function extentOf(design: Design): number {
  return design.blocks.reduce((low, block) => Math.max(low, block.y + (block.h ?? 40)), 0);
}

/**
 * Every usage in a design, in reading order.
 *
 * Reading order - down the sheet, then across - rather than stacking order,
 * because the numbers this produces are drawn *on* the artboard and have to
 * count the way somebody's eye does.
 */
export function usagesOf(design: Design): Usage[] {
  const sheetH = extentOf(design);
  const ordered = [...design.blocks].sort((a, b) => a.y - b.y || a.x - b.x);
  const found: Usage[] = [];

  for (const block of ordered) {
    const section = sectionOf(block, sheetH);
    if ((block.type === "slot" || block.type === "repeater") && block.slot) {
      found.push({
        id: `${block.id}:slot`,
        input: block.slot,
        kind: "slot",
        block: block.id,
        at: 0,
        index: 0,
        label: BLOCK_LABELS[block.type],
        hidden: block.hidden === true,
        section,
      });
    }
    // A toggle group gates each of its branches on its own condition, so it is
    // as many usages as it has branches.
    if (block.type === "toggles") {
      for (const [at, item] of (block.items ?? []).entries()) {
        if (!item.kicker) continue;
        found.push({
          id: `${block.id}:branch:${at}`,
          input: item.kicker,
          kind: "gate",
          block: block.id,
          at,
          index: 0,
          label: `${BLOCK_LABELS.toggles} · ${item.label || "branch"}`,
          hidden: false,
          section,
        });
      }
    }
    for (const inline of inlineSlotsOf(block.text)) {
      found.push({
        id: `${block.id}:inline:${inline.at}`,
        input: inline.name,
        kind: "inline",
        block: block.id,
        at: inline.at,
        index: 0,
        label: `${BLOCK_LABELS[block.type]} · inline`,
        hidden: inline.hidden,
        section,
      });
    }
    if (block.gate) {
      found.push({
        id: `${block.id}:gate`,
        input: block.gate,
        kind: "gate",
        block: block.id,
        at: 0,
        index: 0,
        label: BLOCK_LABELS[block.type],
        hidden: false,
        section,
      });
    }
  }

  // Numbered per input, which is what the badges on the artboard say.
  const seen = new Map<string, number>();
  return found.map((usage) => {
    const next = (seen.get(usage.input) ?? 0) + 1;
    seen.set(usage.input, next);
    return { ...usage, index: next };
  });
}

/** Just the usages of one input. */
export function usagesOfInput(design: Design, input: string): Usage[] {
  return usagesOf(design).filter((usage) => usage.input === input);
}

/** How many usages each input has, for the dock's cards. */
export function usageCounts(design: Design): Map<string, number> {
  const counts = new Map<string, number>();
  for (const usage of usagesOf(design)) counts.set(usage.input, (counts.get(usage.input) ?? 0) + 1);
  return counts;
}

/** How many usages of one input sit in each section, for a long card. */
export function usagesBySection(usages: readonly Usage[]): Map<Section, number> {
  const counts = new Map<Section, number>();
  for (const usage of usages) counts.set(usage.section, (counts.get(usage.section) ?? 0) + 1);
  return counts;
}

/**
 * Switch one usage off, or back on.
 *
 * Two stores because there are two kinds of usage and each keeps the flag where
 * the thing itself is: a slot block has a field, an inline usage has a marker
 * in the copy beside it. A gate is not hideable - switching a condition off is
 * what the condition is for, and hiding one of its usages would be a second,
 * invisible way of saying the same thing.
 */
export function hideUsage(design: Design, usage: Usage, hidden: boolean): Design {
  if (usage.kind === "gate") return design;
  return {
    ...design,
    blocks: design.blocks.map((block) => {
      if (block.id !== usage.block) return block;
      if (usage.kind === "slot") return { ...block, hidden };
      return { ...block, text: setInlineSlotHidden(block.text ?? "", usage.at, hidden) };
    }),
  };
}

/** Put an inline usage of an input at the end of a block's copy. */
export function addInlineUsage(design: Design, blockId: string, input: string): Design {
  return {
    ...design,
    blocks: design.blocks.map((block) =>
      block.id === blockId ? { ...block, text: `${block.text ?? ""} {{${input}}}`.trim() } : block,
    ),
  };
}

/** A block's copy as words, with its inline usages shown as their names. */
export function readableText(block: Block): string {
  return withoutSlotTokens(block.text ?? "");
}

/* -- What is wrong with it -------------------------------------------------*/

/** One thing wrong with a design, and what it is wrong *about*. */
export interface Issue {
  message: string;
  /** The block at fault, where one block is. */
  block?: string;
  /** The declared input at fault, by name. */
  input?: string;
}

/**
 * Problems an operator can act on, named by block.
 *
 * Not "invalid design": somebody looking at fourteen blocks cannot act on that.
 *
 * Each one carries its subject as well as its sentence, so a status bar can
 * offer to *go to* the thing at fault rather than only naming it. The sentence
 * stays the single source for [`designProblems`], which is what the summary
 * lines and the tests read.
 */
export function designIssues(design: Design, wired: ReadonlySet<string> = new Set()): Issue[] {
  const issues: Issue[] = [];
  const slots = new Set(design.slots.map((input) => input.name));
  const conditions = new Set(design.conditions.map((input) => input.name));

  for (const block of design.blocks) {
    const what = BLOCK_LABELS[block.type];
    if (block.type === "slot") {
      if (!block.slot) issues.push({ message: `A ${what} names no text input.`, block: block.id });
      else if (!slots.has(block.slot)) {
        issues.push({
          message: `${what} uses “${block.slot}”, which is not an input any more.`,
          block: block.id,
        });
      }
    }
    // An inline usage is as capable of naming a dead input as a slot block is,
    // and is harder to spot: it is one word in the middle of a paragraph. A
    // built-in is neither: it is not declared here and never has to be.
    for (const inline of inlineSlotsOf(block.text)) {
      if (!slots.has(inline.name) && !isBuiltIn(inline.name)) {
        issues.push({
          message: `${what} mentions “${inline.name}” inline, which is not an input any more.`,
          block: block.id,
        });
      }
    }
    if (block.gate && !conditions.has(block.gate)) {
      issues.push({
        message: `${what} is gated on “${block.gate}”, which is not an input any more.`,
        block: block.id,
      });
    }
  }

  // From the graph rather than from the design: what feeds an input is a wire
  // on the canvas, and a copy of that fact inside the design would be a second
  // place for it to be wrong.
  for (const input of design.slots) {
    if (!wired.has(input.name)) {
      issues.push({
        message: `The text input “${input.name}” has nothing wired to it.`,
        input: input.name,
      });
    }
  }
  for (const input of design.conditions) {
    if (!wired.has(input.name)) {
      issues.push({
        message: `The condition “${input.name}” has nothing wired to it.`,
        input: input.name,
      });
    }
  }

  // A variant that drew nothing would arrive as an empty greeting, which
  // reads as a broken server rather than as a server with nothing to say.
  //
  // Every variant, not only the ones with a tab: Plain and HTML are still
  // compiled and still sent, so a design that comes out empty on either is
  // still a set of readers who are greeted with nothing.
  for (const variant of VARIANTS) {
    if (design.blocks.length > 0 && flowOf(design, variant).length === 0) {
      issues.push({ message: `Nothing at all is drawn on ${TARGET_LABELS[variant].label}.` });
    }
  }

  return issues;
}

/** The same problems as sentences, for everything that only reads them. */
export function designProblems(design: Design, wired: ReadonlySet<string> = new Set()): string[] {
  return designIssues(design, wired).map((issue) => issue.message);
}
