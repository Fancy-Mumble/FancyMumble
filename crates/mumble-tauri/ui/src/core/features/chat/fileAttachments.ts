import { rebaseFileServerUrl } from "@core/store";
import type { FileAccessMode } from "@core/types";
import { base64ToBytes, bytesToBase64 } from "@core/utils/base64";

export interface FileAttachmentInfo {
  readonly url: string;
  readonly filename: string;
  readonly sizeBytes?: number;
  readonly mode: FileAccessMode;
  readonly expiresAt?: number | null;
}

export const FANCY_FILE_MARKER_RE = /<!-- FANCY_FILE:([A-Za-z0-9+/=]+) -->/;

export function encodeFileAttachmentMarker(info: FileAttachmentInfo): string {
  const bytes = new TextEncoder().encode(JSON.stringify(info));
  return `<!-- FANCY_FILE:${bytesToBase64(bytes)} -->`;
}

export function decodeFileAttachmentPayload(payload: string): FileAttachmentInfo | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(base64ToBytes(payload))) as FileAttachmentInfo;
    if (typeof parsed?.url !== "string" || typeof parsed?.filename !== "string") return null;
    return { ...parsed, url: rebaseFileServerUrl(parsed.url) };
  } catch {
    return null;
  }
}

export type PreviewKind = "image" | "audio" | "video" | "text" | "other";

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "ogg", "flac", "m4a", "aac", "opus", "oga"]);
const VIDEO_EXTS = new Set(["mp4", "webm", "mov", "mkv", "m4v", "ogv"]);
const TEXT_EXTS = new Set(["txt", "md", "log", "json", "csv", "xml", "html", "css", "js", "ts", "rs", "py", "yml", "yaml", "toml"]);

export function previewKindForFilename(filename: string): PreviewKind {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  if (IMAGE_EXTS.has(extension)) return "image";
  if (AUDIO_EXTS.has(extension)) return "audio";
  if (VIDEO_EXTS.has(extension)) return "video";
  if (TEXT_EXTS.has(extension)) return "text";
  return "other";
}
