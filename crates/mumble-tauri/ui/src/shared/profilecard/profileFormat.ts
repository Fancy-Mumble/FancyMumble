/**
 * FancyMumble profile format - serialisation helpers.
 *
 * The user's Mumble comment stores a JSON payload inside an HTML comment
 * so legacy clients simply hide it.  The visible bio text follows.
 *
 * Format:
 *   <!--FANCY:{"v":1,"decoration":"sparkle",...}-->
 *   (bio HTML here)
 *
 * The `texture` (avatar) uses the standard Mumble `UserState.texture`
 * bytes field and is **not** part of this comment payload.
 *
 * The protobuf `comment` field is `optional string` -> must be valid
 * UTF-8.  Binary data (e.g. banner images) is base64-encoded.
 */

import type { FancyProfile } from "./profileTypes";

const FANCY_PREFIX = "<!--FANCY:";
const FANCY_SUFFIX = "-->";

/** Build a Mumble comment string from profile data + bio. */
export function serializeProfile(profile: FancyProfile, bio: string): string {
  const payload: FancyProfile = { ...profile, v: 1 };
  // Strip undefined keys for a compact string.
  const json = JSON.stringify(payload, (_k, v) => (v === undefined ? undefined : v));
  const marker = `${FANCY_PREFIX}${json}${FANCY_SUFFIX}`;
  return bio ? `${marker}\n${bio}` : marker;
}

/** Parse a Mumble comment -> FancyMumble profile + visible bio.
 *
 *  Returns `null` profile when the comment was not written by
 *  FancyMumble (i.e. it's a regular comment from a legacy client).
 *
 *  Result is memoized in a small LRU cache because the same comment
 *  string is often parsed by many components per render pass.
 */
type ParsedComment = { profile: FancyProfile | null; bio: string };
const PARSE_CACHE_MAX = 256;
const parseCommentCache = new Map<string, ParsedComment>();

export function parseComment(comment: string): ParsedComment {
  const cached = parseCommentCache.get(comment);
  if (cached) {
    parseCommentCache.delete(comment);
    parseCommentCache.set(comment, cached);
    return cached;
  }
  const result = parseCommentImpl(comment);
  parseCommentCache.set(comment, result);
  if (parseCommentCache.size > PARSE_CACHE_MAX) {
    const oldest = parseCommentCache.keys().next().value;
    if (oldest !== undefined) parseCommentCache.delete(oldest);
  }
  return result;
}

function parseCommentImpl(comment: string): ParsedComment {
  if (!comment.startsWith(FANCY_PREFIX)) {
    return { profile: null, bio: comment };
  }
  const end = comment.indexOf(FANCY_SUFFIX, FANCY_PREFIX.length);
  if (end === -1) {
    return { profile: null, bio: comment };
  }
  const json = comment.substring(FANCY_PREFIX.length, end);
  const bioStart = end + FANCY_SUFFIX.length;
  const bio = comment.substring(bioStart).replace(/^\n/, "");
  try {
    return { profile: withoutRemoteFetches(JSON.parse(json) as FancyProfile), bio };
  } catch {
    return { profile: null, bio: comment };
  }
}

/** A picture the profile carries itself, which is what the format stores. */
const INLINE_IMAGE_RE = /^data:image\/[a-z0-9.+-]+;base64,/i;

/** A value that would make a stylesheet fetch: `url(`, `image-set(`, or a CSS escape hiding either. */
const FETCHING_VALUE_RE = /url\s*\(|image-set\s*\(|\\/i;

/** `src` when it is an inline picture, and nothing otherwise. */
export function inlineImageOnly(src: unknown): string | undefined {
  return typeof src === "string" && INLINE_IMAGE_RE.test(src.trim()) ? src : undefined;
}

/**
 * Drop anything in a received profile that would make the viewer's client
 * fetch something.
 *
 * The profile is somebody else's, and drawing it must not tell a third party
 * who looked at it and when. The format stores pictures inline, so a banner or
 * sticker that is an address instead is dropped as if it were absent; and the
 * free-form values the card writes into styles (custom backgrounds, borders,
 * colours) are dropped when they could load an image of their own. The fields
 * that are prose, and never reach a style, keep whatever they say.
 */
export function withoutRemoteFetches<T>(value: T): T {
  if (typeof value === "string") return (FETCHING_VALUE_RE.test(value) ? undefined : value) as T;
  if (Array.isArray(value))
    return value.map((item) => withoutRemoteFetches(item)).filter((item) => item !== undefined) as T;
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    let kept: unknown;
    // Pictures are stored inline, and only an inline one is drawn.
    if (IMAGE_KEYS.has(key)) kept = inlineImageOnly(item);
    else if (TEXT_KEYS.has(key)) kept = item;
    else kept = withoutRemoteFetches(item);
    if (kept !== undefined) out[key] = kept;
  }
  return out as T;
}

/** Fields holding a picture. */
const IMAGE_KEYS = new Set(["image", "icon", "decorationImage"]);

/** Fields holding prose, which is printed and never written into a style. */
const TEXT_KEYS = new Set(["status", "pronouns", "contact"]);

/** Convert a `data:` URL to a plain `number[]` suitable for Tauri `Vec<u8>`. */
export function dataUrlToBytes(dataUrl: string): number[] {
  const base64 = dataUrl.split(",")[1] ?? "";
  const binary = atob(base64);
  return Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * Convert raw texture bytes (as `number[]`) to a data-URL suitable for `<img src>`.
 *
 * Detects JPEG vs PNG from the magic bytes; defaults to `image/png`.
 */
export function textureToDataUrl(bytes: number[]): string {
  if (bytes.length === 0) return "";
  const mime = bytes[0] === 0xff && bytes[1] === 0xd8 ? "image/jpeg" : "image/png";
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return `data:${mime};base64,${btoa(binary)}`;
}
