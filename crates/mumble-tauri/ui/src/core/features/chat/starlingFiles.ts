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
import type { FileAttachmentInfo } from "./fileAttachments";
import { previewKindForFilename } from "./fileAttachments";

/**
 * How big a picture may be and still be shown on sight.
 *
 * A preview is a courtesy, and a courtesy that spends eighty megabytes of
 * somebody's connection without being asked is not one. Past this the card
 * shows its filename and a Save button, which is what the plugin path does for
 * everything that is not public anyway. A picture whose size the marker does
 * not state gets the same treatment: the cap cannot be checked, and a Save
 * button is the cheaper of the two mistakes.
 *
 * Only a picture is measured against it. Sound and video are played a range
 * at a time, so their size is the player's business rather than this module's.
 */
export const PREVIEW_BYTE_LIMIT = 8 * 1024 * 1024;

/**
 * The kinds a media element draws straight from an address.
 *
 * Everything previewable, which is the point: nothing a card shows is fetched
 * through this module. A picture used to be pulled whole as base64 over IPC -
 * a third bigger than the file, parsed as a string, turned back into bytes,
 * wrapped in a blob, and thrown away on unmount, so scrolling back up through
 * a channel of screenshots fetched every one of them again. An `<img>` pointed
 * at the loopback origin loads the bytes itself, only once it is near the
 * viewport, and the webview's own HTTP cache keeps them for the next mount.
 */
const ADDRESSED_KINDS = new Set(["image", "audio", "video"]);

/**
 * Whether this attachment is one the server hands out per look.
 *
 * The key, not the absence of a URL: a public canon share carries both, and a
 * member of the channel should still fetch it through the session rather than
 * going out to the public address of the server they are already connected to.
 */
export function isCanonAttachment(info: FileAttachmentInfo): boolean {
  return typeof info.key === "string" && info.key.length > 0;
}

/**
 * The object a card should actually draw for this attachment.
 *
 * The thumbnail when there is one, the file itself when there is not. Both
 * are ordinary stored objects fetched the same way, so this is a choice of
 * key and nothing more - no second route, no second kind of address.
 *
 * Only a picture is stood in for. A thumbnail of a film would be a poster
 * frame, which is a different thing that nothing produces yet, and a player
 * pointed at one would play a still image.
 *
 * *Not a privacy claim:* file attachments are **not** end-to-end encrypted
 * today, so a thumbnail the server derived shows the server nothing it could
 * not already read. What the sender's own thumbnail buys is the channel whose
 * bytes the server never sees, where there is no other thumbnail to have.
 */
export function previewKeyFor(info: FileAttachmentInfo): string | null {
  const key = info.key ?? null;
  const thumb = info.thumbKey ?? "";
  if (thumb.length > 0 && previewKindForFilename(info.filename) === "image") return thumb;
  return key;
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

/**
 * Write one shared object to a path the user picked. Returns bytes written.
 *
 * `share` is for a password share and nothing else. Those are sealed with a
 * key derived from the password, so the signed route the other two use would
 * write out ciphertext: the server cannot open the object either, which is the
 * whole of what the mode buys.
 */
export function saveCanonAttachment(
  key: string,
  destPath: string,
  share?: { url: string; password: string },
): Promise<number> {
  return invoke<number>("starling_download_to_file", { key, destPath, share });
}

/**
 * The address a media element can be pointed at for one shared object.
 *
 * An ordinary loopback HTTP URL, because that is the only kind of address a
 * media element can actually load: a webview's media stack fetches over its
 * own HTTP client rather than through the page's loader, so a custom scheme -
 * `asset:` included - never reaches it. The backend answers it with bytes
 * pulled from a signed URL that never leaves the backend, and the address is
 * the same for the life of the run, which is what lets the webview's cache
 * recognise a picture it has already loaded.
 */
export function canonMediaUrl(key: string): Promise<string> {
  return invoke<string>("starling_media_url", { key });
}

/**
 * A source a media element can use, for an attachment with no standing URL.
 *
 * An address on the loopback origin, and nothing is fetched here at all: a
 * player asks for the ranges it wants, which is the only way a file bigger
 * than memory is playable and the only way seeking works, and an `<img>`
 * loads its picture when it comes near the viewport and not before.
 *
 * `null` for anything not worth showing on sight - a picture past
 * {@link PREVIEW_BYTE_LIMIT}, not previewable, or not a canon attachment at
 * all - which is the case the card already draws as a plain row with a Save
 * button.
 */
export function useCanonPreviewSrc(info: FileAttachmentInfo): string | null {
  return useCanonPreview(info).src;
}

/** What {@link useCanonPreviewSrc} found, and whether it is still looking. */
export interface CanonPreview {
  /** The address to draw, or `null` while there is none to draw. */
  readonly src: string | null;
  /**
   * A picture is on its way and has not arrived.
   *
   * The difference between this and a plain `null` is the difference between
   * a box worth holding open and a file that is never going to be a picture:
   * a card that cannot tell them apart draws a filename and a Save button for
   * the length of the wait, then replaces it with a photograph.
   */
  readonly pending: boolean;
}

/** {@link useCanonPreviewSrc}, with the wait it is in reported alongside. */
export function useCanonPreview(info: FileAttachmentInfo): CanonPreview {
  const [src, setSrc] = useState<string | null>(null);
  // An address that could not be had is not one still being asked for: the
  // card goes back to being a row with a Save button, which is the path that
  // reports properly.
  const [failed, setFailed] = useState(false);
  const key = info.key ?? null;
  const { filename, sizeBytes } = info;
  const kind = previewKindForFilename(filename);
  // A password share is excluded rather than merely unhandled: it is sealed
  // with a key derived from the password, so this route returns ciphertext to
  // anyone - including the channel it was shared in. Previewing it would draw
  // a broken image where a locked file belongs, and the password is the
  // reader's to supply, not this client's to hold.
  const canon = key !== null && isCanonAttachment(info) && info.mode !== "password";
  const picture = canon && kind === "image";
  // The thumbnail, when there is one: it is what makes a channel of
  // screenshots affordable to scroll, and it is what a sealed picture will
  // have instead of a preview of the full object once such pictures exist.
  const drawKey = canon ? previewKeyFor(info) : null;
  const thumbed = drawKey !== null && drawKey !== key;
  // A thumbnail is small by construction, so the cap it would be measured
  // against is the full picture's and no longer the question: the eighty
  // megabytes the cap exists to refuse are not the bytes being fetched.
  const withinCap = thumbed || (sizeBytes !== undefined && sizeBytes <= PREVIEW_BYTE_LIMIT);
  const addressed = canon && ADDRESSED_KINDS.has(kind) && (!picture || withinCap);

  // One cheap call that moves no bytes: the origin is started on first ask and
  // the answer is an address, so this costs the same for a thumbnail and a
  // film.
  useEffect(() => {
    if (!addressed || drawKey === null) {
      setSrc(null);
      setFailed(false);
      return;
    }
    let live = true;
    setFailed(false);
    void canonMediaUrl(drawKey)
      .then((url) => {
        if (live) setSrc(url);
      })
      .catch(() => {
        // An origin that will not start is a preview that does not appear.
        // The card still names the file and still offers to save it.
        if (!live) return;
        setSrc(null);
        setFailed(true);
      });
    return () => {
      live = false;
    };
  }, [addressed, drawKey]);

  return {
    src,
    // Only a picture is waited for: a player draws its own poster while it
    // asks for the header, and a card holding a box open for it as well
    // would hold it open twice.
    pending: picture && addressed && src === null && !failed,
  };
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
 * `canShareFilesPublic` and `deleteOnTtl` are both true: `UploadRequest`
 * carries a visibility and a lifetime, and the server answers a public or
 * password share with a link of its own. `maxTtlSeconds` is zero because there
 * is no ceiling on how long a share may last - the operator's `retain_seconds`
 * is the only other clock, and it is not this client's to state.
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
    deleteOnTtl: true,
    ttlSeconds: 0,
    maxTtlSeconds: 0,
    deleteOnDownload: false,
    deleteOnDisconnect: false,
    canManageEmotes: false,
    canShareFiles: true,
    canShareFilesPublic: true,
    registered: false,
  };
}
