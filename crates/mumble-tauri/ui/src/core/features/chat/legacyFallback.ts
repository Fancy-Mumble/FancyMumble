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
import { useAppStore } from "@core/store";
import type { FileAccessMode } from "@core/types";
import { fitDataUrl, mediaToHtml } from "@core/utils/media";
import { previewKindForFilename } from "./fileAttachments";
import { mimeForFilename } from "./starlingFiles";

export const LEGACY_FALLBACK_OPEN = "<!-- FANCY_LEGACY -->";
export const LEGACY_FALLBACK_CLOSE = "<!-- /FANCY_LEGACY -->";

const LEGACY_FALLBACK_RE = /<!-- FANCY_LEGACY -->[\s\S]*?<!-- \/FANCY_LEGACY -->/g;

/** The same cut the backend makes, for a body that has not been through it yet. */
export function stripLegacyFallback(body: string): string {
  if (!body.includes(LEGACY_FALLBACK_OPEN)) return body;
  return body.replace(LEGACY_FALLBACK_RE, "").trimEnd();
}

/**
 * Below this a copy is not worth sending.
 *
 * A picture squeezed into fewer bytes than this is a smear, and a smear that
 * pushes the caption towards the server's limit helps nobody.
 */
const MIN_FALLBACK_BYTES = 8_000;

/** The fence and the `<img ... />` around the data-URL. */
const FALLBACK_OVERHEAD = LEGACY_FALLBACK_OPEN.length + LEGACY_FALLBACK_CLOSE.length + 200;

/** The default `imagemessagelength`, for a server that did not say. */
const DEFAULT_IMAGE_MESSAGE_LENGTH = 131_072;

/** One file in the batch, as far as the fallback needs to know it. */
export interface LegacyFallbackSource {
  readonly filePath: string;
  readonly filename: string;
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
  const images = sources.filter((source) => previewKindForFilename(source.filename) === "image");
  if (images.length === 0) return [];
  const limit = imageMessageLength > 0 ? imageMessageLength : DEFAULT_IMAGE_MESSAGE_LENGTH;
  let remaining = limit - body.length;
  const out: string[] = [];
  for (const [index, image] of images.entries()) {
    const share = Math.floor(remaining / (images.length - index)) - FALLBACK_OVERHEAD;
    if (share < MIN_FALLBACK_BYTES) continue;
    const block = await legacyImageFallback(image, share);
    if (!block) continue;
    out.push(block);
    remaining -= block.length;
  }
  return out;
}

/**
 * `body` with legacy copies of the pictures in `sources` appended.
 *
 * The one call every file-server send goes through. A password share gets
 * none: it is sealed so the server cannot read it, and an inline copy beside
 * it would hand over exactly what the password withholds.
 */
export async function withLegacyFallback(
  body: string,
  sources: readonly LegacyFallbackSource[],
  mode: FileAccessMode,
): Promise<string> {
  if (mode === "password") return body;
  const { serverConfig } = useAppStore.getState();
  const fallbacks = await legacyImageFallbacks(sources, body, serverConfig.max_image_message_length);
  return [body, ...fallbacks].join("\n");
}

async function legacyImageFallback(source: LegacyFallbackSource, maxBytes: number): Promise<string | null> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    const base64 = await invoke<string>("read_file_base64", { path: source.filePath });
    const fitted = await fitDataUrl(`data:${mimeForFilename(source.filename)};base64,${base64}`, maxBytes);
    // `fitDataUrl`'s last resort can still overshoot a small budget.
    if (fitted.length > maxBytes) return null;
    return `${LEGACY_FALLBACK_OPEN}${mediaToHtml(fitted, "image", source.filename)}${LEGACY_FALLBACK_CLOSE}`;
  } catch (e) {
    console.warn("legacy copy of a picture failed:", e);
    return null;
  }
}
