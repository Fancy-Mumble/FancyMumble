import { rebaseFileServerUrl } from "@core/store";
import type { FileAccessMode } from "@core/types";
import { base64ToBytes, bytesToBase64 } from "@core/utils/base64";

export interface FileAttachmentInfo {
  /** A link anyone holding it can fetch, or `""` when there is no such link. */
  readonly url: string;
  readonly filename: string;
  readonly sizeBytes?: number;
  readonly mode: FileAccessMode;
  readonly expiresAt?: number | null;
  /**
   * The stored key, on a server that signs a URL per request.
   *
   * Present instead of `url`, not alongside it: the URL such a server would
   * put here expires in about a minute, so a message carrying one would be a
   * message with a dead link in it by the time anyone scrolled back to it.
   * See `starlingFiles.ts` for how a card turns this into something to render.
   */
  readonly key?: string;
  /**
   * The stored key of a small stand-in picture for this file, when one exists.
   *
   * An ordinary object, fetched exactly the way {@link key} is - there is no
   * second route and no second kind of URL. Two things can put it here: the
   * server derives one on upload for any image it can read and reports it as
   * `thumb_key`, and the sender makes one for an image big enough to be worth
   * standing in for (see `useFileUpload.ts`). Empty or absent means there is
   * none, and a card falls back to the full object.
   *
   * *What this does and does not say about privacy:* file attachments are
   * **not** end-to-end encrypted today - `key` above is the storage key, and
   * the only sealing that exists is server-side and derived from a password
   * during upload. So a server-derived thumbnail discloses nothing the server
   * could not already read. The sender-made one is what matters on a channel
   * whose bytes the server never sees, which is why the client makes its own
   * rather than waiting for the server's.
   */
  readonly thumbKey?: string;
  /**
   * The full picture's pixel size, when the sender measured it.
   *
   * Layout, not decoration: a row that knows the shape of what is coming can
   * hold exactly that much room open, so a channel of photographs does not
   * shove itself down the page as each one decodes. Absent for everything
   * that is not an image, and for images the sender could not decode.
   */
  readonly width?: number;
  readonly height?: number;
}

export const FANCY_FILE_MARKER_RE = /<!-- FANCY_FILE:([A-Za-z0-9+/=]+) -->/;

export function encodeFileAttachmentMarker(info: FileAttachmentInfo): string {
  const bytes = new TextEncoder().encode(JSON.stringify(info));
  return `<!-- FANCY_FILE:${bytesToBase64(bytes)} -->`;
}

/**
 * A pixel count worth believing, or `undefined`.
 *
 * A marker is written by whoever sent the message, so the numbers in it are
 * someone else's. A row sizes itself from these, and a zero, a negative or a
 * NaN would size it to nothing or to a hole; the cap is loose enough that no
 * real camera reaches it and tight enough that a made-up number cannot open a
 * mile of blank column.
 */
const MAX_STATED_DIMENSION = 65_536;

function statedDimension(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= MAX_STATED_DIMENSION
    ? Math.round(value)
    : undefined;
}

export function decodeFileAttachmentPayload(payload: string): FileAttachmentInfo | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(payload))) as FileAttachmentInfo;
    if (typeof parsed?.filename !== "string") return null;
    // One of the two has to be there. A marker with neither names no file at
    // all, and drawing a card for it would be drawing a download button that
    // cannot be pressed.
    const hasKey = typeof parsed.key === "string" && parsed.key.length > 0;
    if (typeof parsed.url !== "string" || (parsed.url.length === 0 && !hasKey)) return null;
    // Rebasing is for the plugin: it rewrites a URL that names an origin the
    // server advertised. There is nothing to rebase when there is no URL.
    return {
      ...parsed,
      url: parsed.url ? rebaseFileServerUrl(parsed.url) : "",
      thumbKey:
        typeof parsed.thumbKey === "string" && parsed.thumbKey.length > 0 ? parsed.thumbKey : undefined,
      width: statedDimension(parsed.width),
      height: statedDimension(parsed.height),
    };
  } catch {
    return null;
  }
}

/**
 * The box a row should hold open for this attachment, as a CSS `aspect-ratio`.
 *
 * `undefined` when the sender stated no size, which is the case a row has
 * always had to guess at. Given as a ratio rather than a height because the
 * column's width is the layout's to decide and the picture's is not.
 */
export function attachmentAspectRatio(info: FileAttachmentInfo): string | undefined {
  return info.width && info.height ? `${info.width} / ${info.height}` : undefined;
}

export type PreviewKind = "image" | "audio" | "video" | "text" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "oga"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv"]);
const TEXT_EXTS = new Set([
  "txt",
  "md",
  "log",
  "json",
  "csv",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "rs",
  "py",
  "yml",
  "yaml",
  "toml",
]);

/** What a "photo or video" picker offers, as extensions without the dot. */
export const MEDIA_EXTENSIONS: readonly string[] = [...IMAGE_EXTS, ...VIDEO_EXTS];

export function previewKindForFilename(filename: string): PreviewKind {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  if (IMAGE_EXTS.has(extension)) return "image";
  if (AUDIO_EXTS.has(extension)) return "audio";
  if (VIDEO_EXTS.has(extension)) return "video";
  if (TEXT_EXTS.has(extension)) return "text";
  return "other";
}
