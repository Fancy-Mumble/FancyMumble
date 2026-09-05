/**
 * A message body as text: for reading, for searching, and for the clipboard.
 *
 * A body on the wire is HTML, and every one of those three jobs wants it
 * without the markup. The obvious way to get there - `textContent`, or a regex
 * that eats `<[^>]*>` - is wrong in the same way for both: it concatenates the
 * text of adjacent blocks with nothing between them. `<p>Hello</p><p>World</p>`
 * comes out `HelloWorld`, a `<br>` vanishes, and a bulleted list becomes one
 * run-on word. That is a paste that does not reproduce the message, a quote
 * preview that reads as gibberish, and a search that cannot find "Hello World"
 * in a message plainly showing it.
 *
 * So the walk is explicit about which elements are boundaries. Inline elements
 * are listed and everything else is treated as a block, rather than the other
 * way round: the inline set is small, closed and known, while the block set
 * is open - a custom element or an unknown tag separates words, which is the
 * safe answer for all three jobs.
 *
 * Two separators, because the jobs differ. Searching and previewing want one
 * line, so blocks are joined with a space. The clipboard wants the message
 * back, so blocks are joined with a newline and a paste reproduces what was on
 * screen.
 */

/** Elements that do not separate words. Everything else is a block.
 *
 * Exported because the mention renderer walks the same way and has to make the
 * same call: a chip must appear exactly where a notification fires, and two
 * lists of inline tags would be two chances for those to drift apart. */
export const INLINE_TAGS: ReadonlySet<string> = new Set([
  "a", "abbr", "b", "bdi", "bdo", "big", "cite", "code", "data", "del", "dfn",
  "em", "font", "i", "img", "ins", "kbd", "label", "mark", "meter", "output",
  "q", "ruby", "s", "samp", "small", "span", "strong", "sub", "sup", "time",
  "tt", "u", "var", "wbr",
]);

/** Text of one node, with `sep` standing where a block boundary was. */
function walk(node: Node, sep: string, skip: ReadonlySet<string>): string {
  if (node.nodeType === Node.TEXT_NODE) return node.nodeValue ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toLowerCase();
  // A skipped element contributes nothing but still separates what surrounds it.
  if (skip.has(tag)) return sep;
  // A line break is a boundary with no content of its own.
  if (tag === "br") return sep;
  let inner = "";
  for (const child of Array.from(el.childNodes)) inner += walk(child, sep, skip);
  return INLINE_TAGS.has(tag) ? inner : `${sep}${inner}${sep}`;
}

/** Parse `body` and walk it, or return it as-is where there is no DOM. */
function extract(body: string, sep: string, skip: ReadonlySet<string>): string | null {
  if (typeof DOMParser === "undefined") return null;
  return walk(new DOMParser().parseFromString(body, "text/html").body, sep, skip);
}

const NOTHING_SKIPPED: ReadonlySet<string> = new Set<string>();

export interface PlainTextOptions {
  /** Tags whose subtree contributes no text - `code` and `pre` for a scan that
   *  must not read what the writer was quoting rather than saying. */
  readonly skip?: ReadonlySet<string>;
}

/**
 * One line of text for a body: what it says, with every run of whitespace -
 * including the boundaries between blocks - collapsed to a single space.
 *
 * This is the form to search and to preview with.
 */
export function bodyToPlainText(body: string, options: PlainTextOptions = {}): string {
  const text = extract(body, " ", options.skip ?? NOTHING_SKIPPED);
  return (text ?? body).replace(/\s+/g, " ").trim();
}

/**
 * A body as it would be pasted: block structure kept as line breaks, runs of
 * blank lines squeezed to one, and no leading or trailing blank line.
 *
 * Horizontal whitespace inside a line is still collapsed - HTML's own runs of
 * spaces and newlines are layout, not content, and pasting the source's
 * indentation would be pasting something the reader never saw.
 */
export function bodyToCopyText(body: string): string {
  const text = extract(body, "\n", NOTHING_SKIPPED);
  if (text === null) return body;
  return text
    .replace(/[^\S\n]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
