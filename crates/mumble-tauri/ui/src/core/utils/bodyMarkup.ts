/**
 * Small repairs to a message body's markup before any pack draws it.
 *
 * A stock Mumble client writes perfectly valid HTML that nevertheless renders
 * badly here, in ways that have nothing to do with which pack is drawing it:
 *
 * - A pasted picture is sent as `<br /><img …/>`. Once the picture is lifted
 *   out into a gallery tile, the line break it sat behind is all that is left,
 *   and it draws as an empty line above the photograph.
 * - The Send-Message dialog ends a message on empty paragraphs
 *   (`<p style="-qt-paragraph-type:empty"><br /></p>`), which draw as blank
 *   lines at the bottom of the bubble.
 * - Ctrl+Enter sends "plain text", which Qt escapes by turning every single
 *   space into `&nbsp;`. A browser may not break a line at a non-breaking
 *   space, so a paragraph of it is one unbreakable word that wraps wherever
 *   the bubble edge happens to fall - in the middle of a word.
 *
 * Each pack has its own sanitiser and its own idea of what to lift out of a
 * body, but all of them hand a string to the DOM in the end, so these work on
 * the string and are called at that last step.
 */

/** Something that draws as nothing at the edge of a body: a break, an empty paragraph, whitespace. */
const EDGE_NOISE =
  "(?:\\s|<br\\s*\\/?>|<p\\b[^>]*>(?:\\s|&nbsp;|\\u00a0|<br\\s*\\/?>)*<\\/p\\s*>|<div\\b[^>]*>(?:\\s|&nbsp;|\\u00a0|<br\\s*\\/?>)*<\\/div\\s*>)";
const LEADING_NOISE_RE = new RegExp(`^${EDGE_NOISE}+`, "i");
const TRAILING_NOISE_RE = new RegExp(`${EDGE_NOISE}+$`, "i");

/**
 * Drop line breaks and empty paragraphs from the very start and end of a body.
 *
 * Only the edges: a blank line between two paragraphs was typed, and is kept.
 * A non-breaking space on its own is not noise either - at the start of a
 * plain-text message it is the first line's indentation.
 */
export function trimBodyEdges(html: string): string {
  return html.replace(LEADING_NOISE_RE, "").replace(TRAILING_NOISE_RE, "");
}

/**
 * A tag, a comment, or a run of text between them.
 *
 * Quoted attribute values are matched whole, so a `>` inside one does not end
 * the tag early and leave the rest of it to be treated as prose.
 */
const TOKEN_RE = /<!--[\s\S]*?-->|<(?:[^>"']|"[^"]*"|'[^']*')*>|[^<]+|</g;

/** The spellings of a non-breaking space a body may carry. */
const NBSP_RE = /&nbsp;|&#160;|&#[xX]0*[aA]0;/g;

/** A run of non-breaking spaces with something visible on both sides. */
const INNER_NBSP_RUN_RE = /(?<=\S) +(?=\S)/g;

/**
 * Let text made of non-breaking spaces wrap between words again.
 *
 * Inside a line only: a run with a visible character on each side keeps its
 * width but ends in an ordinary space, so the browser can break there. One
 * `&nbsp;` between two words becomes one plain space - the space the author
 * typed. Two or more become that many columns still, the last of them
 * breakable, so text lined up with several spaces stays lined up.
 *
 * A run at the start of a line, or one standing on its own, is left exactly
 * as written: that is indentation, and an ordinary space there would collapse
 * into nothing. Tags and comments are never touched, so an attribute value
 * that happens to hold one keeps it.
 */
export function relaxNonBreakingSpaces(html: string): string {
  if (!html.includes("&nbsp;") && !html.includes(" ") && !html.includes("&#")) return html;
  let out = "";
  for (const [token] of html.matchAll(TOKEN_RE)) {
    if (token.startsWith("<") && token.length > 1) {
      out += token;
      continue;
    }
    // `\S` does not match U+00A0, so normalising the entities to the character
    // first is what lets one pattern see a run however it was spelled.
    out += token.replace(NBSP_RE, " ").replace(INNER_NBSP_RUN_RE, (run) => `${" ".repeat(run.length - 1)} `);
  }
  return out;
}

/**
 * A body made ready for the DOM: edges trimmed, non-breaking spaces relaxed.
 *
 * The one entry point the packs call, so a fix for the next stock-client
 * quirk lands in all three at once.
 */
export function prepareBodyHtml(html: string): string {
  return relaxNonBreakingSpaces(trimBodyEdges(html));
}

/**
 * Markup that the edit box cannot hand back.
 *
 * Editing works on the markdown a body converts to, and a picture, a clip or a
 * frame has no markdown form: the draft opened as the caption alone (or as an
 * empty line), and saving it sent that in place of the message - the picture
 * gone from every client in the channel.
 */
const UNEDITABLE_RE = /<(?:img|video|audio|source|iframe|object|embed|canvas|svg)\b/i;

/** Whether a body can be opened for editing without losing part of it. */
export function isEditableBody(body: string): boolean {
  return !UNEDITABLE_RE.test(body);
}
