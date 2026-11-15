/**
 * The two halves of a greeting body, and how each is made from the other.
 *
 * Every message node carries **both** a markup half and a plain half, and that
 * is not redundancy - it is the wire format. A server with `allow_html` off
 * sends the plain form, because a client that cannot render tags prints them,
 * and a greeting full of `<p>` reads as a broken server rather than as a
 * welcome. The server picks between the two at handshake
 * (`starling/crates/runtime/src/greeting.rs::compose`); the editor's job is to
 * make sure both say the same thing.
 *
 * So the plain half is *derived* while a node is being written in the editor,
 * never typed alongside. A operator who formats a paragraph and leaves the
 * plain field on last week's wording has published two different greetings and
 * can only see one of them.
 */

/**
 * Characters of markup one node may carry.
 *
 * The server's own cap (`MAX_BODY` in `starling/crates/runtime/src/greeting.rs`)
 * and checked here so an over-long body is a problem in the status bar rather
 * than a refused save with the whole document rejected. Counted per half: the
 * server measures the markup and the plain text separately.
 *
 * It is paid on every join rather than once, which is what the cap is about
 * rather than storage - and it is the reason the editor offers no image button
 * for these nodes. One embedded screenshot is a data: URL several times this
 * long.
 */
export const MAX_BODY = 4096;

/** Tags whose content starts and ends a line of plain text. */
const BLOCKS = new Set([
  "P",
  "DIV",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "LI",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "PRE",
  "TABLE",
  "TR",
]);

/** What a list item is marked with in the plain half. */
const BULLET = "• ";

/**
 * The plain half of some markup: what a client that cannot render tags reads.
 *
 * Structure becomes line breaks and list items become bullets, because the
 * plain form is still *read* by somebody - flattening a page of house rules
 * into one paragraph would be technically lossless and unusable. Everything
 * else is dropped, which is the point: this is the fallback, not a second
 * document to maintain.
 *
 * Uses the DOM to parse rather than a regex over tags, for the ordinary reason:
 * `<p title="a > b">` is one element and three regexes will tell you otherwise.
 */
export function plainTextOf(html: string): string {
  if (html.trim() === "") return "";
  const parsed = new DOMParser().parseFromString(html, "text/html");
  const out: string[] = [];

  const walk = (node: Node): void => {
    // Text and element only. Comments carry nothing a reader wants.
    if (node.nodeType === 3) {
      out.push(node.nodeValue ?? "");
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName;
    if (tag === "BR" || tag === "HR") {
      out.push("\n");
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) out.push("\n");
    if (tag === "LI") out.push(BULLET);
    for (const child of Array.from(element.childNodes)) walk(child);
    // A list item closes with nothing, because the next item opens with its
    // own break: closing with one too would leave a blank line between every
    // bullet, and a list is the one structure that reads as a single block.
    if (block && tag !== "LI") out.push("\n");
  };
  for (const child of Array.from(parsed.body.childNodes)) walk(child);

  return (
    out
      .join("")
      // Markup is indented and wrapped by whatever wrote it, so runs of
      // whitespace in the source are not spacing anybody chose.
      .replaceAll("\u00a0", " ")
      .replaceAll(/[ \t]+/g, " ")
      .replaceAll(/ *\n */g, "\n")
      // One blank line between paragraphs; a nest of divs would otherwise
      // open with six.
      .replaceAll(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/** `&`, `<` and `>` as text, for putting plain words inside markup. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * Some plain text as markup: one paragraph per line.
 *
 * What happens when an operator switches a node from plain to formatted. Blank
 * lines are the paragraph break they were typing, so they become the gap
 * between paragraphs rather than empty paragraphs of their own.
 */
export function paragraphsOf(plain: string): string {
  const lines = plain
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("");
}

/**
 * A text block's content as markup.
 *
 * The field holds what the WYSIWYG produced, which is HTML. Two things hold a
 * bare string instead: a design drawn before the block had an editor, and a
 * template whose copy is written as plain words in the source - and a bare
 * string handed to a renderer loses the line breaks somebody typed and mangles
 * an `&`. So anything with no tag in it is read as the plain text it is.
 *
 * The one case this gets wrong is legacy plain copy containing a literal `<`,
 * which is read as markup and then dropped by the sanitiser. Nothing this
 * editor has ever written looks like that: the field is escaped on the way out
 * of Tiptap, so a `<` typed today arrives here as `&lt;`.
 */
export function richBody(text: string | undefined): string {
  const body = text ?? "";
  return body.includes("<") ? body : paragraphsOf(body);
}

/**
 * A greeting's parts assembled the way the server assembles them.
 *
 * The markup halves are joined with nothing between them, because each is a
 * block that closes itself; the plain halves are joined with a space, because
 * they are not. Both are the server's own rule, and a preview that guessed at
 * either would be showing something nobody will receive.
 */
export function composeMarkup(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join("");
}

export function composePlain(parts: readonly string[]): string {
  return parts
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ");
}

/* -- Inline slots ---------------------------------------------------------- */

/**
 * A text input used *inside* a paragraph, written as `{{name}}`.
 *
 * A token in the copy rather than an element in the markup, and that is the
 * whole decision here. A `<span data-slot>` would be the tidier document, and
 * it would not survive the trip: the rich-text field parses through Tiptap,
 * which drops nodes it has no extension for, and the sanitiser every renderer
 * filters through is configured `ALLOW_DATA_ATTR: false`. A token is plain
 * text, so it survives being typed, pasted, formatted, bolded and round-tripped
 * through both - and it is how an operator would write one by hand anyway.
 *
 * A hidden usage keeps its token and gains a marker, because hiding is meant to
 * be reversible: deleting the token would lose where it was.
 */
const SLOT_TOKEN = /\{\{\s*([a-z0-9_.]+)\s*(\|hidden)?\s*\}\}/gi;

/** How an inline usage is written, for everything that has to produce one. */
export function slotToken(name: string, hidden = false): string {
  return hidden ? `{{${name}|hidden}}` : `{{${name}}}`;
}

/** One inline usage found in some copy. */
export interface InlineSlot {
  readonly name: string;
  readonly hidden: boolean;
  /** Which token this is in the text, counting from zero. */
  readonly at: number;
}

/** Every inline usage in some copy, in reading order. */
export function inlineSlotsOf(text: string | undefined): InlineSlot[] {
  const body = text ?? "";
  const found: InlineSlot[] = [];
  for (const match of body.matchAll(SLOT_TOKEN)) {
    found.push({ name: match[1].toLowerCase(), hidden: match[2] !== undefined, at: found.length });
  }
  return found;
}

/** The same copy with one usage hidden or shown again. */
export function setInlineSlotHidden(text: string, at: number, hidden: boolean): string {
  let seen = -1;
  return text.replaceAll(SLOT_TOKEN, (whole, name: string) => {
    seen += 1;
    return seen === at ? slotToken(String(name).toLowerCase(), hidden) : whole;
  });
}

/** The same copy with every usage of one input renamed. */
export function renameInlineSlot(text: string, from: string, to: string): string {
  return text.replaceAll(SLOT_TOKEN, (whole, name: string, flag: string | undefined) =>
    String(name).toLowerCase() === from ? slotToken(to, flag !== undefined) : whole,
  );
}

/** One run of copy: either literal markup, or an input to be substituted. */
export type Piece = { readonly literal: string } | { readonly slot: string; readonly hidden: boolean };

/**
 * Copy split at its inline usages, so each run can be compiled on its own.
 *
 * The literal runs are markup and stay markup; each token becomes a part the
 * server substitutes. Splitting rather than replacing is what lets one
 * paragraph carry two different inputs and still arrive as one paragraph.
 */
export function splitInlineSlots(text: string): Piece[] {
  const pieces: Piece[] = [];
  let last = 0;
  for (const match of text.matchAll(SLOT_TOKEN)) {
    const at = match.index ?? 0;
    if (at > last) pieces.push({ literal: text.slice(last, at) });
    pieces.push({ slot: match[1].toLowerCase(), hidden: match[2] !== undefined });
    last = at + match[0].length;
  }
  if (last < text.length) pieces.push({ literal: text.slice(last) });
  return pieces;
}

/**
 * Copy with every token taken out, for reading it as words.
 *
 * A hidden usage leaves nothing; a shown one leaves its name, because the
 * layer list and the plain fallback both have to say *something* stands here.
 */
export function withoutSlotTokens(text: string, shown = (name: string) => `$${name}`): string {
  return text
    .replaceAll(SLOT_TOKEN, (_whole, name: string, flag: string | undefined) =>
      flag === undefined ? shown(String(name).toLowerCase()) : "",
    )
    .replaceAll(/[ \t]{2,}/g, " ");
}
