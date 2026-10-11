/**
 * What a stock Mumble client is shown in place of the parts it cannot draw.
 *
 * Much of what a Fancy client sends is a comment: a file card is a
 * `FANCY_FILE` marker, a reply is a `FANCY_QUOTE`, a document invite and a
 * watch-together session are markers too, and a legacy client draws every
 * comment as nothing - the message arrived, and it was empty. Other parts
 * are markup Qt draws wrongly: a remote `<img>` becomes an invisible pixel, a
 * `<video>` becomes its file name, and a spoiler is drawn in the clear
 * because Qt ignores the blur.
 *
 * So the sender adds, beside each of those, something legacy Mumble can draw:
 * a line of text, a link, or - for a picture - an inline `data:` copy, the one
 * kind of image it loads. All of it sits inside a fence of two comments, and
 * only legacy clients ever see it. The backend cuts the fence out of the
 * sealed copy, out of the sender's own row and out of every message it
 * receives (`fancy_utils::html::strip_legacy_fallback`), so a Fancy client
 * draws exactly what it drew before.
 *
 * Every fallback is measured against the server's limits before it is added
 * (`withLegacyBlock`): the server refuses an over-long message for everybody,
 * and a courtesy line for one kind of client is never worth that.
 */
import type { ChatMessage, FileAccessMode } from "@core/types";
import { formatBytes } from "@core/utils/format";
import { escapeAttr, fitDataUrl, INLINE_MAX_WIDTH, mediaToHtml, videoPosterDataUrl } from "@core/utils/media";
import { bodyToPlainText } from "./bodyText";
import type { FileAttachmentInfo } from "./fileAttachments";
import { previewKindForFilename } from "./fileAttachments";
import {
  escapeLegacyText,
  fancyOnly,
  legacyFence,
  serverAccepts,
  stripLegacyFallback,
  withLegacyBlock,
  type MessageLimits,
} from "./legacyFallbackMarker";
import { mimeForFilename } from "./starlingFiles";

export {
  serverAccepts,
  stripLegacyFallback,
  withLegacyBlock,
  type MessageLimits,
} from "./legacyFallbackMarker";

/**
 * Below this a copy is not worth sending.
 *
 * A picture squeezed into fewer bytes than this is a smear, and a smear that
 * pushes the caption towards the server's limit helps nobody.
 */
const MIN_FALLBACK_BYTES = 8_000;

/**
 * Above this the original is not read again for a copy.
 *
 * The upload streamed it from disk; a copy means reading all of it into the
 * webview as base64 and decoding it, while the message waits to be sent.
 */
const MAX_SOURCE_BYTES = 25 * 1024 * 1024;

/** The longest name a copy's `alt` carries, so the name cannot eat the budget. */
const MAX_ALT_CHARS = 64;

/** The default `imagemessagelength`, for a server that did not say. */
const DEFAULT_IMAGE_MESSAGE_LENGTH = 131_072;

/**
 * The height every stacked copy in one message shares.
 *
 * A legacy client refuses to lay out a message taller than 2048 pixels and
 * shows "Text object too large to display" instead. One copy is held to the
 * inline box (1000 high) already, but four copies of four photographs on a
 * server with a raised limit stack to 4000. They share this instead, which
 * leaves room under 2048 for the caption and the lines around them.
 */
const LEGACY_STACK_HEIGHT = 1_800;

/** The most a video's still may take: a glimpse, not a second upload. */
const MAX_POSTER_BYTES = 48_000;

/** The longest snippet of a quoted message a legacy reply carries. */
const MAX_QUOTE_SNIPPET = 120;

/** The limits of the server the message goes to, as the store holds them. */
async function currentLimits(): Promise<MessageLimits> {
  const { useAppStore } = await import("@core/store");
  return useAppStore.getState().serverConfig;
}

function imageLimitOf(limits: Pick<MessageLimits, "max_image_message_length">): number {
  return limits.max_image_message_length > 0 ? limits.max_image_message_length : DEFAULT_IMAGE_MESSAGE_LENGTH;
}

// --- Files ---------------------------------------------------------

/** One file in the batch, as far as an inline copy needs to know it. */
export interface LegacyFallbackSource {
  readonly filePath: string;
  readonly filename: string;
  readonly sizeBytes?: number;
}

/** One shared file: what its marker says, and where the sender still has it. */
export interface LegacyFallbackFile {
  readonly info: FileAttachmentInfo;
  /** The local file, when there is one - an inline copy is read from it. */
  readonly filePath?: string;
}

/** How the batch was shared, as far as the fallback cares. */
export interface LegacyFallbackShare {
  readonly mode: FileAccessMode;
  readonly ttlSeconds?: number;
}

/**
 * Legacy copies for the pictures in a batch, as one fenced block per picture.
 *
 * They share whatever the server's limit leaves after `body`: the server
 * measures the whole message, and a message over the limit is refused for
 * everybody, Fancy clients included. A picture that does not fit, cannot be
 * decoded or is not a picture at all gets no copy; the message still goes.
 */
export async function legacyImageFallbacks(
  sources: readonly LegacyFallbackSource[],
  body: string,
  imageMessageLength: number,
): Promise<string[]> {
  const copies = await legacyCopies(sources, body.length, imageMessageLength);
  return copies.filter((copy): copy is string => copy !== null);
}

/** {@link legacyImageFallbacks}, one entry per source, `null` where there is no copy. */
async function legacyCopies(
  sources: readonly LegacyFallbackSource[],
  used: number,
  imageMessageLength: number,
): Promise<(string | null)[]> {
  const isCandidate = (source: LegacyFallbackSource) =>
    previewKindForFilename(source.filename) === "image" &&
    (source.sizeBytes === undefined || source.sizeBytes <= MAX_SOURCE_BYTES);
  const count = sources.filter(isCandidate).length;
  if (count === 0) return sources.map(() => null);
  const limit = imageMessageLength > 0 ? imageMessageLength : DEFAULT_IMAGE_MESSAGE_LENGTH;
  const maxHeight = Math.floor(LEGACY_STACK_HEIGHT / count);
  // Every block after the body costs the newline that joins it on.
  let remaining = limit - used;
  let left = count;
  const out: (string | null)[] = [];
  for (const source of sources) {
    if (!isCandidate(source)) {
      out.push(null);
      continue;
    }
    const share = Math.floor(remaining / left) - 1;
    left -= 1;
    const block = await legacyImageFallback(source, share, maxHeight);
    out.push(block);
    if (block) remaining -= block.length + 1;
  }
  return out;
}

/** One fenced copy no longer than `maxChars`, or `null`. */
async function legacyImageFallback(
  source: LegacyFallbackSource,
  maxChars: number,
  maxHeight: number,
): Promise<string | null> {
  const wrap = (src: string) =>
    legacyFence(mediaToHtml(src, "image", source.filename.slice(0, MAX_ALT_CHARS)));
  const reserve = wrap("").length;
  if (maxChars - reserve < MIN_FALLBACK_BYTES) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64 = await invoke<string>("read_file_base64", { path: source.filePath });
    const fitted = await fitDataUrl(`data:${mimeForFilename(source.filename)};base64,${base64}`, maxChars, {
      reserve,
      maxWidth: INLINE_MAX_WIDTH,
      maxHeight,
    });
    const block = wrap(fitted);
    // `fitDataUrl`'s last resort can still overshoot a small budget.
    return block.length <= maxChars ? block : null;
  } catch (e) {
    console.warn("legacy copy of a picture failed:", e);
    return null;
  }
}

/** `0:07`, `12:40`: a clip's length the way the voice card says it. */
function clipLength(durationMs: number): string {
  const seconds = Math.max(0, Math.round(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A link a legacy reader can open, or `null`.
 *
 * Only a public share's own `https` URL, and only one that does not expire:
 *
 * - A session share has no URL a browser could use - a Starling share is a
 *   key the client signs per look, and the plugin's session link wants the
 *   Mumble session that a browser does not have.
 * - A password share's URL is harmless (the bytes behind it are sealed, and
 *   every member of the channel could read the marker anyway) but useless:
 *   the password is sent by the Fancy download dialog, not typed into a web
 *   page, so a legacy reader would be handed a link that cannot open.
 * - An expiring link would sit in every legacy log, and in the server's
 *   archive, long after it stopped working.
 */
function durableLink(info: FileAttachmentInfo, share: LegacyFallbackShare): string | null {
  if (info.mode !== "public" || share.mode !== "public") return null;
  if ((share.ttlSeconds ?? 0) > 0 || (info.expiresAt ?? 0) > 0) return null;
  return /^https:\/\/\S+$/i.test(info.url) ? info.url : null;
}

/** The one line a legacy client reads for a file: what it is, and where, if anywhere. */
export function legacyFileLine(info: FileAttachmentInfo, share: LegacyFallbackShare): string {
  if (info.voice) return `🎤 Voice message (${clipLength(info.voice.durationMs)})`;
  const icon = previewKindForFilename(info.filename) === "image" ? "🖼️" : "📎";
  const link = durableLink(info, share);
  const name = escapeLegacyText(info.filename);
  const shown = link ? `<a href="${escapeAttr(link)}">${name}</a>` : name;
  const size = info.sizeBytes ? ` (${formatBytes(info.sizeBytes)})` : "";
  const sealed = info.mode === "password" ? " 🔒" : "";
  return `${icon} ${shown}${size}${sealed}`;
}

/**
 * `body` with legacy fallbacks for the files it announces.
 *
 * The one call every file-server send goes through. A picture gets an inline
 * copy where one may be sent; everything else - and a picture that got no
 * copy - gets a line naming it, with a link where there is a durable public
 * one (see {@link durableLink}).
 *
 * Two kinds of share get no copy. A password share is sealed so the server
 * cannot read it, and an inline copy beside it would hand over exactly what
 * the password withholds. A share that expires would outlive itself: the copy
 * sits in every legacy client's log, and in the server's archive, long after
 * the link is dead. Both still get their line - the name was never secret,
 * it is in the marker every member of the channel receives.
 */
export async function withLegacyFallback(
  body: string,
  files: readonly LegacyFallbackFile[],
  share: LegacyFallbackShare,
): Promise<string> {
  const limits = await currentLimits();
  if (!limits.allow_html || files.length === 0) return body;
  const copiesAllowed = share.mode !== "password" && (share.ttlSeconds ?? 0) <= 0;
  const sources: LegacyFallbackSource[] = files.map((file) => ({
    filePath: copiesAllowed && file.filePath && !file.info.voice ? file.filePath : "",
    filename: copiesAllowed && file.filePath && !file.info.voice ? file.info.filename : "",
    sizeBytes: file.info.sizeBytes,
  }));
  // The lines are budgeted first, as if no picture got a copy: they are a
  // few dozen characters each, and a copy that ate their room would leave a
  // picture that failed to decode with nothing at all.
  const everyLine = legacyFence(files.map((file) => legacyFileLine(file.info, share)).join("<br>"));
  const copies = await legacyCopies(
    sources.filter((source) => source.filePath !== ""),
    body.length + everyLine.length + 1,
    imageLimitOf(limits),
  );
  let copyIndex = 0;
  const lines: string[] = [];
  const blocks: string[] = [];
  for (const [index, file] of files.entries()) {
    const copy = sources[index].filePath !== "" ? copies[copyIndex++] : null;
    if (copy) blocks.push(copy);
    else lines.push(legacyFileLine(file.info, share));
  }
  const withLines = withLegacyBlock(body, lines.join("<br>"), limits);
  for (const candidate of [
    [withLines, ...blocks],
    [body, ...blocks],
  ]) {
    const joined = candidate.join("\n");
    if (serverAccepts(joined, limits)) return joined;
  }
  return body;
}

// --- Spoilers ------------------------------------------------------

const SPOILER_SPAN_OPEN = /<span class="spoiler"[^>]*>/g;
const SPOILER_IMG = /<img\b[^>]*\sdata-spoiler="1"[^>]*>/g;
const SPOILER_VIDEO = /<video\b[^>]*\sdata-spoiler="1"[^>]*>[\s\S]*?<\/video>/g;

/** What a legacy client reads where a spoiler was. */
export const LEGACY_SPOILER_TEXT = "[spoiler]";

/**
 * Every spoiler in `html`, replaced by what `replace` makes of it.
 *
 * A spoiler span may hold markup of its own (`||**x**||` is a `<b>` inside
 * it, a link inside it is an `<a>`), so its end is found by counting spans
 * rather than by the first `</span>`. A span that never closes is left as it
 * is: guessing where it ends could swallow the rest of the message.
 */
function replaceSpoilers(html: string, replace: (spoiler: string) => string): string {
  let out = "";
  let rest = html;
  for (;;) {
    SPOILER_SPAN_OPEN.lastIndex = 0;
    const open = SPOILER_SPAN_OPEN.exec(rest);
    if (!open) break;
    const contentStart = open.index + open[0].length;
    const end = matchingSpanEnd(rest, contentStart);
    if (end === null) break;
    out += rest.slice(0, open.index) + replace(rest.slice(open.index, end));
    rest = rest.slice(end);
  }
  out += rest;
  return out.replace(SPOILER_IMG, replace).replace(SPOILER_VIDEO, replace);
}

/** Index just past the `</span>` that closes a span whose content starts at `from`. */
function matchingSpanEnd(html: string, from: number): number | null {
  const tags = /<span\b[^>]*>|<\/span\s*>/gi;
  tags.lastIndex = from;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += tag[0].startsWith("</") ? -1 : 1;
    if (depth === 0) return tag.index + tag[0].length;
  }
  return null;
}

/**
 * `html` with every spoiler hidden from legacy clients.
 *
 * Qt draws neither the blur on a `<span class="spoiler">` nor the one on a
 * `data-spoiler` picture: a stock client shows the punchline, or the image,
 * in the clear. So the spoiler itself goes into a `FANCY_ONLY` comment, which
 * Qt draws as nothing and a Fancy client puts back exactly as it was, and the
 * legacy reader gets "[spoiler]" in a fence. A Fancy client therefore draws
 * the same spoiler, blurred, as it always did.
 *
 * Not measured against the limits, unlike every other fallback: leaving this
 * one out would show the spoiler to legacy readers, and keeping it secret is
 * the reason it is there. It costs a few dozen characters, and a spoiler
 * picture is fitted with that already reserved. A picture in the comment
 * still counts towards the image limit, exactly as it did outside it.
 *
 * Nothing changes on a server with HTML off: it strips every tag and comment
 * and delivers the words to everybody, spoiler or not.
 */
export function hideSpoilersFromLegacy(html: string, limits: MessageLimits): string {
  // Once is enough, and twice would be wrong: a span already hidden still
  // reads `<span class="spoiler">` inside its comment (only hyphens are
  // encoded), and hiding it again would put a comment inside a comment.
  if (!limits.allow_html || html.includes("<!-- FANCY_ONLY:")) return html;
  return replaceSpoilers(html, (spoiler) => `${fancyOnly(spoiler)}${legacyFence(LEGACY_SPOILER_TEXT)}`);
}

/** What hiding one spoiler of this markup adds to a body, for a picture's budget. */
export function spoilerOverhead(html: string): number {
  return fancyOnly(html).length - html.length + legacyFence(LEGACY_SPOILER_TEXT).length;
}

// --- Replies -------------------------------------------------------

/** One line of a quoted message, as a legacy reader should see it. */
function quoteSnippet(body: string): string {
  const visible = replaceSpoilers(stripLegacyFallback(body), () => ` ${LEGACY_SPOILER_TEXT} `);
  let text = bodyToPlainText(visible);
  if (!text) {
    if (/<!-- FANCY_FILE:/.test(body)) text = "📎 file";
    else if (/<img\b/i.test(body)) text = "🖼️ picture";
    else if (/<video\b/i.test(body)) text = "🎬 video";
    else text = "…";
  }
  const chars = Array.from(text);
  return chars.length > MAX_QUOTE_SNIPPET ? `${chars.slice(0, MAX_QUOTE_SNIPPET).join("")}…` : text;
}

/**
 * `body` with the messages it replies to quoted for legacy clients.
 *
 * A reply's `FANCY_QUOTE` marker names the message by id, and a Fancy client
 * draws the quote from its own copy. A legacy client has neither the marker
 * nor the id, so without this a reply reads as an answer to nothing. The
 * quote goes first, the way a reader expects it, and is a short plain-text
 * snippet: the full message is in their log already, and a quoted picture
 * would double the size of the reply.
 */
export function withQuoteFallback(
  body: string,
  quotes: readonly Pick<ChatMessage, "sender_name" | "body">[],
  limits: MessageLimits,
): string {
  if (quotes.length === 0) return body;
  const html = quotes
    .map(
      (quote) =>
        `<blockquote>${escapeLegacyText(quote.sender_name)}: ${escapeLegacyText(quoteSnippet(quote.body))}</blockquote>`,
    )
    .join("");
  return withLegacyBlock(body, html, limits, "before");
}

// --- Remote pictures -----------------------------------------------

/**
 * A link to a remote picture, for the reader whose client will not load it.
 *
 * Legacy Mumble loads only `data:` images; a GIF from the picker is an
 * `https` URL and is drawn as an invisible pixel. The link at least says
 * what was sent and lets the reader open it. Anything but `https` gets
 * nothing: it is not what the picker sends, and a legacy client drops links
 * of most other schemes anyway.
 */
export function remoteImageLink(url: string, title: string): string {
  if (!/^https:\/\/\S+$/i.test(url)) return "";
  const label = title.trim() ? `GIF: ${title.trim()}` : "GIF";
  return `<a href="${escapeAttr(url)}">${escapeLegacyText(label)}</a>`;
}

/** `body` (a remote picture) with its link fenced in for legacy clients. */
export function withRemoteImageLink(body: string, url: string, title: string, limits: MessageLimits): string {
  return withLegacyBlock(body, remoteImageLink(url, title), limits);
}

/**
 * `html` with a link for every remote picture in it.
 *
 * For a composer that sends whatever its editor holds, where a picked GIF is
 * one node among the words rather than a message of its own.
 */
export function withRemoteImageLinks(html: string, limits: MessageLimits): string {
  const links: string[] = [];
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\ssrc="([^"]*)"/i.exec(tag)?.[1];
    if (!src || !/^https:\/\//i.test(src)) continue;
    const alt = /\salt="([^"]*)"/i.exec(tag)?.[1] ?? "";
    links.push(remoteImageLink(decodeAttr(src), decodeAttr(alt)));
  }
  return withLegacyBlock(html, links.filter(Boolean).join("<br>"), limits);
}

function decodeAttr(value: string): string {
  return value
    .replaceAll("&quot;", '"')
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

// --- Videos --------------------------------------------------------

/**
 * `body` (an inline video) with a still and a line for legacy clients.
 *
 * Qt drops the `<video>` tag and draws what is inside it, so a clip reaches a
 * legacy client as its file name. The still is a frame of the clip, fitted
 * into what the server's limit leaves after the video itself; when that is
 * too little for a picture worth looking at, the line goes alone.
 */
export async function withVideoFallback(
  body: string,
  file: File,
  name: string,
  limits: MessageLimits,
): Promise<string> {
  if (!limits.allow_html) return body;
  const line = `🎬 ${escapeLegacyText(name)}`;
  const alt = name.slice(0, MAX_ALT_CHARS);
  const wrapped = (poster: string) =>
    withLegacyBlock(body, `${line}<br>${mediaToHtml(poster, "image", alt)}`, limits);
  // What the body, the fence, the tag and the line already cost.
  const overhead = wrapped("").length - body.length;
  const room = Math.min(MAX_POSTER_BYTES, imageLimitOf(limits) - body.length - overhead);
  if (overhead > 0 && room >= MIN_FALLBACK_BYTES) {
    const poster = await videoPosterDataUrl(file, room, { reserve: 0 });
    if (poster) {
      const withPoster = wrapped(poster);
      if (withPoster !== body) return withPoster;
    }
  }
  return withLegacyBlock(body, line, limits);
}

/** The limits of the server the message goes to, for callers outside React. */
export { currentLimits as currentMessageLimits };
