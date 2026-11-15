/**
 * What a message body says, as text a person would read off the screen.
 *
 * Several small surfaces show a body without rendering it: the quote preview
 * above a reply, the caption under a popped-out picture, the draft a message
 * is opened into for editing. Each of them used to strip tags with a regex and
 * undo `&lt;`, `&gt;` and `&amp;` - the three entities this client's own
 * composer writes - and nothing else.
 *
 * A stock Mumble client writes a good deal more. Its chat bar escapes quotes
 * as `&quot;`, its Ctrl+Enter plain-text mode turns every space into `&nbsp;`,
 * and its Send-Message dialog wraps each line in a `<p>`. Read the old way, a
 * stock message quoted as `say&nbsp;&quot;hi&quot;` and a two-paragraph one
 * as a single welded word. So the decoding and the block boundaries live here,
 * once, and every preview reads a body the same way.
 */

/**
 * The named entities a chat body realistically carries.
 *
 * Not the HTML5 table - that is two thousand names for a handful of previews.
 * Anything missing here is still decoded where a DOM is present (see
 * {@link decodeHtmlEntities}); without one it is left as written, which reads
 * oddly but loses nothing.
 */
const NAMED: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "­",
  copy: "©",
  reg: "®",
  trade: "™",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  laquo: "«",
  raquo: "»",
  bull: "•",
  middot: "·",
  deg: "°",
  euro: "€",
  pound: "£",
  times: "×",
  divide: "÷",
};

const ENTITY_RE = /&(#\d+|#[xX][0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g;

/** One code point from a numeric reference, or null for one that names none. */
function codePoint(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0 || value > 0x10ffff) return null;
  // Surrogate halves are not characters; `fromCodePoint` would happily build a
  // lone one, which then breaks every string operation downstream.
  if (value >= 0xd800 && value <= 0xdfff) return null;
  return String.fromCodePoint(value);
}

/** A named entity outside the table, asked of the browser's own parser. */
function decodeNamedViaDom(match: string): string | null {
  if (typeof DOMParser === "undefined") return null;
  const text = new DOMParser().parseFromString(match, "text/html").body.textContent ?? "";
  // A name the parser does not know comes back as the literal it was given.
  return text && text !== match ? text : null;
}

/**
 * Turn every character reference in `text` back into its character.
 *
 * One pass, so `&amp;lt;` becomes `&lt;` rather than `<`: decoding the
 * ampersand first and then looking again is how a message that talks *about*
 * an entity ends up showing something else.
 */
export function decodeHtmlEntities(text: string): string {
  if (!text.includes("&")) return text;
  return text.replace(ENTITY_RE, (match, body: string) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const value = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      return codePoint(value) ?? match;
    }
    return NAMED[body] ?? NAMED[body.toLowerCase()] ?? decodeNamedViaDom(match) ?? match;
  });
}

/**
 * Elements whose text is never on screen.
 *
 * A `<style>` block's text is CSS and a `<script>`'s is code; a preview that
 * printed them would show the reader something the message itself never does.
 */
const HIDDEN_TAGS: ReadonlySet<string> = new Set([
  "script",
  "style",
  "template",
  "noscript",
  "head",
  "title",
]);

/** Elements that do not end a line. Everything else is treated as a block. */
const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a",
  "abbr",
  "b",
  "bdi",
  "bdo",
  "big",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "img",
  "ins",
  "kbd",
  "label",
  "mark",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr",
]);

/** The text of one node, with a newline wherever a line ended on screen. */
function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const tag = (node as Element).tagName.toLowerCase();
  if (HIDDEN_TAGS.has(tag)) return "";
  if (tag === "br") return "\n";
  let inner = "";
  for (const child of Array.from(node.childNodes)) inner += walk(child);
  return INLINE_TAGS.has(tag) ? inner : `\n${inner}\n`;
}

/** The same reading without a DOM: tags become boundaries, entities decode. */
function regexText(body: string): string {
  const stripped = body
    .replaceAll(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, "")
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<\/(?:p|div|li|h[1-6]|blockquote|pre|tr)\s*>/gi, "\n")
    .replaceAll(/<[^>]*>/g, "");
  return decodeHtmlEntities(stripped);
}

export interface VisibleTextOptions {
  /**
   * Keep line breaks as `\n`, for a surface that can show more than one line
   * (a caption). Off, every boundary is one space - the form for a one-line
   * preview, where a newline would be drawn as nothing at all.
   */
  readonly multiline?: boolean;
}

/**
 * The words a body shows, without its markup.
 *
 * Comments (the client's own markers) say nothing, pictures say nothing, and
 * every entity is decoded - `&nbsp;` to a plain space, because a preview that
 * cannot wrap where the message could is a preview that clips mid-word.
 */
export function bodyVisibleText(body: string, options: VisibleTextOptions = {}): string {
  const withoutComments = body.replaceAll(/<!--[\s\S]*?-->/g, "");
  const raw =
    typeof DOMParser === "undefined"
      ? regexText(withoutComments)
      : walk(new DOMParser().parseFromString(withoutComments, "text/html").body);
  const text = raw.replaceAll(" ", " ");
  if (!options.multiline) return text.replace(/\s+/g, " ").trim();
  return text
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
