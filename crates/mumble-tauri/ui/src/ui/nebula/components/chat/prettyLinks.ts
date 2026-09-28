/**
 * Printing a pasted link as something a person can read.
 *
 * A URL somebody pasted arrives in the body as its own anchor text, in full:
 * scheme, host, path, and the two hundred characters of tracking parameters
 * the site added when they copied it. Set in link blue and underlined, that is
 * three wrapped lines of noise above a card that already says where the link
 * goes and what is at the other end.
 *
 * So the *display* is trimmed to the host and enough of the path to tell two
 * links apart, and nothing else changes: the `href` is untouched, copy and
 * paste still yield the whole URL, and the full thing is on the `title` for
 * anyone who wants to read it. Only anchors whose text is their own href are
 * touched - a link somebody wrote words for keeps the words.
 */

/** The longest a trimmed link is allowed to be, in characters. */
const LIMIT = 48;

/**
 * `url` as host plus a trimmed path, or `undefined` if it is not a URL.
 *
 * The query string goes entirely: it is where the tracking parameters live,
 * and the ones that are not tracking are unreadable anyway. The path is then
 * cut from the *end*, whole segments at a time, because what a reader wants
 * off a link is where it is going - `tagesschau.de/ausland/europa/…` - and
 * the last segment of an article URL is a slug of the headline with an id and
 * a file extension stuck to it. The headline is on the card already; the
 * slug is the ugliest part of the URL and the least worth keeping.
 */
export function prettyUrl(url: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined;
  const host = parsed.hostname.replace(/^www\./, "");
  const path = parsed.pathname.replace(/\/$/, "");
  if (!path) return host;
  if (host.length + path.length <= LIMIT) return `${host}${path}`;
  // Whole segments from the front, for as many as fit, and an ellipsis for
  // what was dropped. A segment is a word somebody chose; half of one is not.
  const segments = path.split("/").filter(Boolean);
  let shown = host;
  for (const segment of segments) {
    if (shown.length + segment.length + 2 > LIMIT) break;
    shown = `${shown}/${segment}`;
  }
  return `${shown}/…`;
}

/**
 * Rewrite the anchors in `html` that are bare URLs.
 *
 * Takes already-sanitised markup and returns markup: the parse is into an
 * inert `<template>`, which does not run scripts, load resources or execute
 * event handlers, and only the anchors' *text* is replaced. Sanitising remains
 * the caller's job and happens before this.
 */
export function prettyLinks(html: string): string {
  if (!html.includes("<a")) return html;
  const holder = document.createElement("template");
  holder.innerHTML = html;
  for (const anchor of Array.from(holder.content.querySelectorAll("a[href]"))) {
    const href = anchor.getAttribute("href") ?? "";
    const text = anchor.textContent?.trim() ?? "";
    // Only a link that is its own text. Anything a person wrote words for is
    // theirs, and a partial match ("see example.com/a") is a sentence.
    if (text !== href) continue;
    const pretty = prettyUrl(href);
    if (!pretty || pretty === text) continue;
    anchor.textContent = pretty;
    // The whole thing stays one hover away, and in the accessible name.
    anchor.setAttribute("title", href);
  }
  return holder.innerHTML;
}

/**
 * Whether `html` is nothing but the links in it.
 *
 * A message somebody pasted a link into and typed nothing else has already
 * been said by the card under it: the poster names the source, prints the
 * title and *is* the link. Printing the URL above it as well - underlined, in
 * link blue, across the top of the bubble - is the same fact twice, and the
 * louder of the two is the one nobody reads.
 *
 * Only when the entire body is links: a sentence with a link in it is a
 * sentence, and dropping that would drop what somebody wrote.
 */
export function isOnlyLinks(html: string): boolean {
  if (!html.includes("<a")) return false;
  const holder = document.createElement("template");
  holder.innerHTML = html;
  // Anything that is not text - a picture, a mention chip, an emoji - means
  // the body carries something of its own.
  for (const node of Array.from(holder.content.querySelectorAll("*"))) {
    if (node.tagName !== "A" && node.tagName !== "P" && node.tagName !== "BR") return false;
  }
  for (const anchor of Array.from(holder.content.querySelectorAll("a"))) {
    anchor.remove();
  }
  return (holder.content.textContent ?? "").trim().length === 0;
}
