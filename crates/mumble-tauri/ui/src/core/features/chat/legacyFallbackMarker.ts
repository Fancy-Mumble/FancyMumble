/**
 * The fence around a body's legacy-only part, and the cut that removes it.
 *
 * Apart from `legacyFallback.ts` so the store can ask what a body looks like
 * to a Fancy client without importing the code that builds the copy.
 *
 * A body can carry two kinds of part that only one side reads:
 *
 * - A *fence*, `<!-- FANCY_LEGACY -->…<!-- /FANCY_LEGACY -->`: drawn by a stock
 *   Mumble client, cut out by a Fancy one. It is how a message whose real
 *   content is a marker comment - a file card, a reply, a document invite -
 *   still says something to a client that draws comments as nothing.
 * - A *Fancy-only* comment, `<!-- FANCY_ONLY:… -->`: drawn as nothing by a
 *   stock client, expanded back into markup by a Fancy one. It is how a
 *   spoiler keeps its content away from a renderer that would show it in the
 *   clear: Qt ignores the blur, so the only safe place for the content is
 *   somewhere Qt does not draw at all.
 *
 * Both are undone by `fancy_utils::html::strip_legacy_fallback` on every body
 * the backend hands up, and by {@link stripLegacyFallback} here for a body
 * that has not been through it yet. The two are one rule and must agree.
 */
export const LEGACY_FALLBACK_OPEN = "<!-- FANCY_LEGACY -->";
export const LEGACY_FALLBACK_CLOSE = "<!-- /FANCY_LEGACY -->";

/**
 * Says "this body carries a fallback" where nothing else in it does.
 *
 * The cut only happens beside a Fancy marker (see {@link stripLegacyFallback}),
 * and a GIF or a video is plain markup with no marker of its own. This one is
 * removed along with the fence, so the body a Fancy client draws is byte for
 * byte the one it drew before fallbacks existed.
 */
export const LEGACY_FALLBACK_TAG = "<!-- FANCY_FALLBACK -->";

const FANCY_ONLY_OPEN = "<!-- FANCY_ONLY:";
const FANCY_ONLY_CLOSE = " -->";

const LEGACY_FALLBACK_RE = /<!-- FANCY_LEGACY -->[\s\S]*?<!-- \/FANCY_LEGACY -->/g;
const FANCY_ONLY_RE = /<!-- FANCY_ONLY:([\s\S]*?) -->/g;
/** A Fancy marker that is not the opening fence itself. */
const FANCY_MARKER_RE = /<!-- FANCY_(?!LEGACY -->)/;

/** `html` fenced so only legacy clients draw it. */
export function legacyFence(html: string): string {
  return `${LEGACY_FALLBACK_OPEN}${html}${LEGACY_FALLBACK_CLOSE}`;
}

/**
 * `html` hidden in a comment that only a Fancy client opens.
 *
 * A comment may not contain `--`, and Qt ends one at the first `-->`, so
 * every hyphen goes in as `&#45;` and comes back out as a hyphen. That is
 * exact for markup this client wrote: its text is escaped, so a literal
 * `&#45;` in it is already `&amp;#45;` and never mistaken for one of ours.
 * Base64 has no hyphen, so a picture in here costs what it cost outside.
 */
export function fancyOnly(html: string): string {
  return `${FANCY_ONLY_OPEN}${html.replaceAll("-", "&#45;")}${FANCY_ONLY_CLOSE}`;
}

/** Text made safe to stand in markup, for the lines a fallback is written in. */
export function escapeLegacyText(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

/**
 * The same cut the backend makes, for a body that has not been through it yet.
 *
 * Only beside a Fancy marker, as there: a fence in a body with no marker
 * outside it is text somebody wrapped to hide it from Fancy clients, and it
 * stays. The fence's own opening comment does not count, nor does anything
 * inside a fence - a marker in the part that is cut cannot vouch for the cut.
 */
export function stripLegacyFallback(body: string): string {
  if (!body.includes(LEGACY_FALLBACK_OPEN) && !body.includes(FANCY_ONLY_OPEN)) return body;
  const cut = body.replace(LEGACY_FALLBACK_RE, "");
  if (!FANCY_MARKER_RE.test(cut)) return body;
  return cut
    .replaceAll(LEGACY_FALLBACK_TAG, "")
    .replace(FANCY_ONLY_RE, (_match, inner: string) => inner.replaceAll("&#45;", "-"))
    .trimEnd();
}

/** Whether `body` carries a marker the cut would accept, outside any fence. */
function hasFancyMarker(body: string): boolean {
  return FANCY_MARKER_RE.test(body.replace(LEGACY_FALLBACK_RE, ""));
}

/** The three server settings that decide whether a body is delivered. */
export interface MessageLimits {
  readonly max_message_length: number;
  readonly max_image_message_length: number;
  readonly allow_html: boolean;
}

/**
 * Whether the server would deliver `body`, by Starling's own rule.
 *
 * A transcription of `starling_text::filter::check`, which is murmur's
 * `isTextAllowed`: with HTML on, the whole body is bounded by the image
 * limit, and a body over the text limit is measured again with its markup
 * stripped. A refused message is refused for everybody, Fancy clients
 * included, so a fallback is only ever added when this still holds after it.
 *
 * Measured in UTF-16 units where the server counts code points: never less
 * than the server's count, so the answer errs towards leaving a fallback out.
 */
export function serverAccepts(body: string, limits: MessageLimits): boolean {
  const over = (length: number, limit: number) => limit > 0 && length > limit;
  const textLimit = limits.max_message_length;
  if (!limits.allow_html) return !over(stripHtmlLikeServer(body).length, textLimit);
  if (over(body.length, limits.max_image_message_length)) return false;
  if (!over(body.length, textLimit)) return true;
  if (!body.includes("<")) return false;
  return !over(stripHtmlLikeServer(body).length, textLimit);
}

/** Starling's `strip_html`: the words between the tags, as the server counts them. */
function stripHtmlLikeServer(html: string): string {
  let out = "";
  let tag = "";
  let inTag = false;
  if (html.includes("<")) {
    for (const ch of html) {
      if (ch === "<") {
        inTag = true;
        tag = "";
      } else if (ch === ">" && inTag) {
        inTag = false;
        const closing = tag.startsWith("/");
        const name = (tag.replace(/^\/+/, "").split(/[ /\t]/)[0] ?? "").toLowerCase();
        if (name === "br" || (closing && name === "p")) out += "\n";
      } else if (inTag) {
        tag += ch;
      } else {
        out += ch;
      }
    }
  } else {
    out = html;
  }
  const simplified = out
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .trim();
  return simplified.replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * `body` with `html` fenced in for legacy clients, or `body` unchanged.
 *
 * Unchanged when the server has HTML off - it would strip the fence and hand
 * its words to everybody - and when the fallback would push the message over
 * a limit the bare message was under. A legacy client missing a courtesy
 * line is a small loss; a message nobody receives is not.
 *
 * `before` puts the block at the start, for a fallback that reads before the
 * message (a quote above a reply); otherwise it goes on the end.
 */
export function withLegacyBlock(
  body: string,
  html: string,
  limits: MessageLimits,
  position: "before" | "after" = "after",
): string {
  if (!limits.allow_html || html === "") return body;
  const tag = hasFancyMarker(body) ? "" : LEGACY_FALLBACK_TAG;
  const block = `${tag}${legacyFence(html)}`;
  const candidate = position === "before" ? `${block}${body}` : `${body}\n${block}`;
  return serverAccepts(candidate, limits) ? candidate : body;
}
