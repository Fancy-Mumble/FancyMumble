/**
 * Attachments on a server that has no file-server plugin.
 *
 * The plugin hands out a signed URL that stays valid for hours, so a message
 * can carry the link itself and every card in every pack just renders it. A
 * canon server signs a URL that is good for about a minute, which is the point
 * of it - so what the message carries is the stored *key*, and the URL is
 * fetched fresh each time somebody actually looks at the file.
 *
 * That difference is confined to this module. A card asks for a source and
 * gets one, or asks to save and it saves; nothing above here has to know which
 * kind of server the file came from.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { FileServerConfig } from "@core/types";
import { base64ToBytes } from "@core/utils/base64";
import type { FileAttachmentInfo } from "./fileAttachments";
import { previewKindForFilename } from "./fileAttachments";

/**
 * How much of a file to pull down just to show it in the message list.
 *
 * A preview is a courtesy, and a courtesy that spends eighty megabytes of
 * somebody's connection without being asked is not one. Past this the card
 * shows its filename and a Save button, which is what the plugin path does for
 * everything that is not public anyway.
 */
export const PREVIEW_BYTE_LIMIT = 8 * 1024 * 1024;

/** Whether this attachment is one only the server can hand out a URL for. */
export function isCanonAttachment(info: FileAttachmentInfo): boolean {
  return typeof info.key === "string" && info.key.length > 0 && !info.url;
}

const MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  svg: "image/svg+xml",
  avif: "image/avif",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  ogv: "video/ogg",
  txt: "text/plain",
  md: "text/markdown",
  json: "application/json",
  csv: "text/csv",
  xml: "application/xml",
  html: "text/html",
  css: "text/css",
  pdf: "application/pdf",
};

/**
 * What a file most likely is, from its name.
 *
 * Guessed here rather than sniffed because the guess is made before the file
 * is read: it is what the upload announces, and what a preview is decoded as.
 * Wrong guesses degrade to a download prompt rather than to a broken render.
 */
export function mimeForFilename(filename: string): string {
  const extension = filename.includes(".") ? filename.slice(filename.lastIndexOf(".") + 1).toLowerCase() : "";
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/** Ask the server for a URL, fetch the object, and hand back its bytes. */
async function fetchObject(key: string): Promise<Uint8Array> {
  const base64 = await invoke<string>("starling_download_to_base64", { key });
  return base64ToBytes(base64);
}

/** Write one shared object to a path the user picked. Returns bytes written. */
export function saveCanonAttachment(key: string, destPath: string): Promise<number> {
  return invoke<number>("starling_download_to_file", { key, destPath });
}

/**
 * A source a media element can use, for an attachment with no standing URL.
 *
 * An object URL rather than a `data:` one: a fifty-megabyte base64 string in a
 * `src` attribute is a fifty-megabyte string in the DOM, and video seeking
 * needs a real resource to range-request against.
 *
 * Returns `null` for anything not worth fetching on sight - too big, not
 * previewable, or not a canon attachment at all - which is the case the card
 * already draws as a plain row with a Save button.
 */
export function useCanonPreviewSrc(info: FileAttachmentInfo): string | null {
  const [source, setSource] = useState<string | null>(null);
  const key = info.key ?? null;
  const { filename, sizeBytes } = info;
  const eligible =
    key !== null &&
    isCanonAttachment(info) &&
    ["image", "audio", "video"].includes(previewKindForFilename(filename)) &&
    (sizeBytes ?? 0) <= PREVIEW_BYTE_LIMIT;

  useEffect(() => {
    if (!eligible || key === null) {
      setSource(null);
      return;
    }
    let url: string | null = null;
    let live = true;
    void fetchObject(key)
      .then((bytes) => {
        if (!live) return;
        // `slice()` detaches the view from any shared buffer, which is what
        // `Blob` wants and what keeps the array from being retained whole.
        url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mimeForFilename(filename) }));
        setSource(url);
      })
      .catch(() => {
        // A preview that cannot be fetched is not an error worth a banner:
        // the card still shows the file and its Save button, which is the
        // path that reports properly when it fails.
        if (live) setSource(null);
      });

    return () => {
      live = false;
      // Revoked on unmount, or the tab holds every image ever scrolled past.
      if (url) URL.revokeObjectURL(url);
    };
  }, [eligible, key, filename]);

  return source;
}

/**
 * What to tell the rest of the client about a server that shares files the
 * canon way.
 *
 * The plugin advertises a config on connect and every pack reads it to decide
 * whether attaching is possible; the canon advertises nothing, so this is the
 * same answer written in the same shape. Most of it is honestly blank: there
 * is no HTTP base URL the frontend may touch, no standing upload token, and no
 * session JWT, because the whole handshake happens in the backend.
 *
 * `canShareFilesPublic` is false because the canon has no way to ask for a
 * public link - `UploadRequest` carries no visibility - so offering the option
 * would be offering something the server cannot do.
 */
export function canonFileServerConfig(sessionId: number): FileServerConfig {
  return {
    baseUrl: "",
    internalBaseUrl: "",
    sessionId,
    uploadToken: "",
    sessionJwt: "",
    // Unknown, and not worth guessing: the server states its ceiling by
    // refusing an upload that passes it, with the number in the refusal.
    maxFileSizeBytes: 0,
    deleteOnTtl: false,
    ttlSeconds: 0,
    maxTtlSeconds: 0,
    deleteOnDownload: false,
    deleteOnDisconnect: false,
    canManageEmotes: false,
    canShareFiles: true,
    canShareFilesPublic: false,
    registered: false,
  };
}
