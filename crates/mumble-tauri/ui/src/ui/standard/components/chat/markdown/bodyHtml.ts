/**
 * What to render for a message body that arrived as plain text.
 *
 * A body on the wire is HTML: that is what Mumble carries and what this
 * client's composer sends, so the renderers hand it to the DOM as markup.
 * Plenty of bodies are not HTML, though - a bot posting through the protocol,
 * a legacy client, a bridge, a plugin - and those arrive as the markdown their
 * author typed. Rendered as markup, that text is literally what it says:
 * `**Nice**` prints its own asterisks, and a code span prints its backticks.
 *
 * So a body with no markup in it is read as markdown instead, through the very
 * converter the composer sends with. Both directions then speak one dialect:
 * what a Fancy client writes and what a bot writes come out looking the same,
 * which is the whole point of the formatting being there.
 *
 * The test for "no markup" is deliberately blunt. Anything that looks like a
 * tag or a comment, and anything already carrying an HTML entity, is left
 * exactly as it came: `markdownToHtml` escapes `<`, `>` and `&` on the way in,
 * so running it over real markup would print the tags and double-escape the
 * entities - a far worse failure than an unformatted asterisk. The markers
 * this client hides in bodies (`<!-- FANCY_POLL:… -->` and friends) are
 * comments, so a body still holding one is left alone too; the renderers lift
 * those out before they get here.
 */

import { markdownToHtml } from "./MarkdownInput";

/** A tag or a comment - the two shapes markup starts with. */
const MARKUP_RE = /<[a-zA-Z!/]/;

/** `&amp;`, `&#39;`, `&#x2F;` - a body that is already escaped. */
const ENTITY_RE = /&(?:#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/;

/** True when the body is markup already and must be rendered as it stands. */
export function isMarkupBody(body: string): boolean {
  return MARKUP_RE.test(body) || ENTITY_RE.test(body);
}

/**
 * The HTML to render for one message body, formatting it first if it is the
 * plain markdown a bot or a legacy client sends.
 */
export function bodyToHtml(body: string): string {
  return isMarkupBody(body) ? body : markdownToHtml(body);
}
