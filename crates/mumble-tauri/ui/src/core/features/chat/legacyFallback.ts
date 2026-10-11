/**
 * What a stock Mumble client is shown in place of a file-server picture.
 *
 * A picture shared through the file server travels as a `FANCY_FILE`
 * comment, and a legacy client draws a comment as nothing: the message
 * arrived, and it was empty. Legacy Mumble can draw exactly one kind of
 * picture - an inline `data:` image - so the sender puts a copy of that kind
 * beside the marker, fenced by two comments of its own.
 *
 * Only legacy clients ever see it. The backend cuts the fence out of the
 * sealed copy, out of the sender's own row and out of every message it
 * receives (`fancy_utils::html::strip_legacy_fallback`), so a Fancy client
 * draws the card and nothing else.
 */
import type { FileAccessMode } from "@core/types";
import { fitDataUrl, mediaToHtml } from "@core/utils/media";
import { previewKindForFilename } from "./fileAttachments";
import { LEGACY_FALLBACK_CLOSE, LEGACY_FALLBACK_OPEN } from "./legacyFallbackMarker";
import { mimeForFilename } from "./starlingFiles";

export { stripLegacyFallback } from "./legacyFallbackMarker";

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

/** One file in the batch, as far as the fallback needs to know it. */
export interface LegacyFallbackSource {
  readonly filePath: string;
  readonly filename: string;
  readonly sizeBytes?: number;
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
  const images = sources.filter(
    (source) =>
      previewKindForFilename(source.filename) === "image" &&
      (source.sizeBytes === undefined || source.sizeBytes <= MAX_SOURCE_BYTES),
  );
  if (images.length === 0) return [];
  const limit = imageMessageLength > 0 ? imageMessageLength : DEFAULT_IMAGE_MESSAGE_LENGTH;
  // Every block after the body costs the newline that joins it on.
  let remaining = limit - body.length;
  const out: string[] = [];
  for (const [index, image] of images.entries()) {
    const share = Math.floor(remaining / (images.length - index)) - 1;
    const block = await legacyImageFallback(image, share);
    if (!block) continue;
    out.push(block);
    remaining -= block.length + 1;
  }
  return out;
}

/**
 * `body` with legacy copies of the pictures in `sources` appended.
 *
 * The one call every file-server send goes through. Two kinds of share get
 * none. A password share is sealed so the server cannot read it, and an
 * inline copy beside it would hand over exactly what the password withholds.
 * A share that expires would outlive itself: the copy sits in every legacy
 * client's log, and in the server's archive, long after the link is dead.
 */
export async function withLegacyFallback(
  body: string,
  sources: readonly LegacyFallbackSource[],
  share: LegacyFallbackShare,
): Promise<string> {
  if (share.mode === "password" || (share.ttlSeconds ?? 0) > 0) return body;
  const { useAppStore } = await import("@core/store");
  const { serverConfig } = useAppStore.getState();
  const fallbacks = await legacyImageFallbacks(sources, body, serverConfig.max_image_message_length);
  return [body, ...fallbacks].join("\n");
}

/** One fenced copy no longer than `maxChars`, or `null`. */
async function legacyImageFallback(source: LegacyFallbackSource, maxChars: number): Promise<string | null> {
  const wrap = (src: string) =>
    `${LEGACY_FALLBACK_OPEN}${mediaToHtml(src, "image", source.filename.slice(0, MAX_ALT_CHARS))}${LEGACY_FALLBACK_CLOSE}`;
  // `fitDataUrl` reserves 100 for an `<img>` of its own; whatever the fence
  // and the name cost beyond that comes off the picture.
  const overhead = Math.max(0, wrap("").length - 100);
  if (maxChars - overhead < MIN_FALLBACK_BYTES) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64 = await invoke<string>("read_file_base64", { path: source.filePath });
    const fitted = await fitDataUrl(
      `data:${mimeForFilename(source.filename)};base64,${base64}`,
      maxChars - overhead,
    );
    const block = wrap(fitted);
    // `fitDataUrl`'s last resort can still overshoot a small budget.
    return block.length <= maxChars ? block : null;
  } catch (e) {
    console.warn("legacy copy of a picture failed:", e);
    return null;
  }
}
