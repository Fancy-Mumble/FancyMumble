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
}

export const FANCY_FILE_MARKER_RE = /<!-- FANCY_FILE:([A-Za-z0-9+/=]+) -->/;

export function encodeFileAttachmentMarker(info: FileAttachmentInfo): string {
  const bytes = new TextEncoder().encode(JSON.stringify(info));
  return `<!-- FANCY_FILE:${bytesToBase64(bytes)} -->`;
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
    return { ...parsed, url: parsed.url ? rebaseFileServerUrl(parsed.url) : "" };
  } catch {
    return null;
  }
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
