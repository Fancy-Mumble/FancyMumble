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
