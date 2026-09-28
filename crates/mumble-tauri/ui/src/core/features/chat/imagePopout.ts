/**
 * What the image popout window needs out of a chat message.
 *
 * `open_image_popout` opens a borderless always-on-top viewer with an info bar
 * under the picture, and the frontend is what fills that bar in. Two packs
 * offer the action from their message menus, so which picture a message
 * carries - and which of its words go under it - is answered here rather than
 * separately in each design's chat view.
 */
import {
  FANCY_FILE_MARKER_RE,
  decodeFileAttachmentPayload,
  previewKindForFilename,
  type FileAttachmentInfo,
} from "./fileAttachments";

/** How much of the surrounding message the info bar will show. */
const MAX_CAPTION_LENGTH = 280;

/**
 * The picture a message can be popped out to its own window, or null.
 *
 * An inline `<img>` first, since a pasted or server-fetched picture is the
 * common case; failing that, a file-server attachment that is an image and is
 * public, whose URL any window can load without asking anyone.
 *
 * Everything else answers `null` here and is answered by
 * {@link resolvePopOutImage} instead, which can go and fetch. Kept because a
 * menu has to know whether to offer the item before anything is fetched, and
 * because an address that is already in hand should not cost a round trip.
 */
export function findPopOutImageSrc(body: string): string | null {
  const inline = /<img[^>]+src="([^"]+)"/i.exec(body);
  if (inline?.[1]) return inline[1];
  const fileMatch = FANCY_FILE_MARKER_RE.exec(body);
  if (fileMatch) {
    const info: FileAttachmentInfo | null = decodeFileAttachmentPayload(fileMatch[1]);
    if (info && previewKindForFilename(info.filename) === "image" && info.mode === "public" && info.url) {
      return info.url;
    }
  }
  return null;
}

/** The image attachment a message carries, whatever it would take to show it. */
export function popOutAttachment(body: string): FileAttachmentInfo | null {
  const fileMatch = FANCY_FILE_MARKER_RE.exec(body);
  if (!fileMatch) return null;
  const info = decodeFileAttachmentPayload(fileMatch[1]);
  return info && previewKindForFilename(info.filename) === "image" ? info : null;
}

/**
 * Whether a message has a picture worth offering the pop-out for at all.
 *
 * Cheap and synchronous, because a menu decides whether to draw the item
 * while it is opening and cannot wait for a fetch to find out.
 */
export function hasPopOutImage(body: string): boolean {
  return findPopOutImageSrc(body) !== null || popOutAttachment(body) !== null;
}

/** What {@link resolvePopOutImage} could not do on its own. */
export type PopOutFailure = "needs-password" | "unavailable";

/** A source the pop-out window can be pointed at, or the reason there is none. */
export type PopOutImage = { readonly src: string } | { readonly failure: PopOutFailure };

/**
 * The **full** picture behind a message, fetched if that is what it takes.
 *
 * The full object and never the thumbnail: the lightbox is the one place in
 * the client whose entire purpose is to show the picture at its own size, and
 * standing a 320 px stand-in up at full screen would be the one place the
 * thumbnail must not reach.
 *
 * Three routes, in the order they cost:
 *
 * 1. An inline `<img>`, or a public link - already an address, nothing moves.
 * 2. A stored key - `starling_media_url` hands back a loopback address whose
 *    bytes are pulled through a signed URL that never leaves the backend, so
 *    a **session** share opens here for the first time. It used to answer
 *    `null`, which is why a private screenshot could be previewed in the row
 *    and then refused a window of its own.
 * 3. A **password** share, whose object is sealed with a key derived from the
 *    password: the signed route hands back ciphertext, so the only way to see
 *    it is to redeem the password for a ticket, spend it, and point the
 *    window at the file that came down. Without a password this reports
 *    `"needs-password"` rather than opening a window onto noise, so the
 *    caller can ask for one and come back.
 *
 * *Not a privacy claim:* file attachments are **not** end-to-end encrypted
 * today. A password share is the only sealing there is, it is server-side and
 * derived from the password, and everything else is readable by the server.
 */
export async function resolvePopOutImage(body: string, password?: string): Promise<PopOutImage> {
  const direct = findPopOutImageSrc(body);
  if (direct) return { src: direct };

  const info = popOutAttachment(body);
  const key = info?.key ?? "";
  if (!info || key.length === 0) return { failure: "unavailable" };

  if (info.mode === "password") {
    if (!password || !info.url) return { failure: "needs-password" };
    return await sealedPopOutImage(info, key, password);
  }

  try {
    const { canonMediaUrl } = await import("./starlingFiles");
    return { src: await canonMediaUrl(key) };
  } catch (e) {
    console.warn("pop-out image address failed:", e);
    return { failure: "unavailable" };
  }
}

/**
 * A password share, brought down to disk and handed over as a local address.
 *
 * Down to disk rather than into memory: the bytes are opened by the *server*
 * once the ticket is spent, so what comes back is an ordinary picture, and a
 * picture a window is going to display belongs in a file the window can load
 * instead of in a base64 string pushed across the IPC boundary. The empty
 * write is only how a scratch path with the right extension is obtained -
 * the download overwrites it a moment later.
 */
async function sealedPopOutImage(
  info: FileAttachmentInfo,
  key: string,
  password: string,
): Promise<PopOutImage> {
  try {
    const [{ convertFileSrc, invoke }, { mimeForFilename, saveCanonAttachment }] = await Promise.all([
      import("@tauri-apps/api/core"),
      import("./starlingFiles"),
    ]);
    const destPath = await invoke<string>("write_attachment_bytes", {
      dataBase64: "",
      mimeType: mimeForFilename(info.filename),
    });
    const written = await saveCanonAttachment(key, destPath, { url: info.url, password });
    if (written <= 0) return { failure: "unavailable" };
    return { src: convertFileSrc(destPath) };
  } catch (e) {
    // "wrong password" comes back from the redeem step, and is the one
    // failure worth sending the caller round again for.
    const detail = e instanceof Error ? e.message : String(e);
    console.warn("pop-out of a sealed image failed:", e);
    return { failure: detail.includes("password") ? "needs-password" : "unavailable" };
  }
}

/**
 * The message's own words, for the bar under the picture.
 *
 * Markers, the image itself and every remaining tag come out; line breaks
 * survive as newlines, because a caption sent as two lines was written as two.
 * Null when nothing is left, so the bar draws no empty row.
 */
export function imagePopoutCaption(body: string): string | null {
  const text = body
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(/<img\b[^>]*>/gi, "")
    .replaceAll(/<br\s*\/?>/gi, "\n")
    .replaceAll(/<[^>]*>/g, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&")
    .trim();
  return text.length > 0 ? text.slice(0, MAX_CAPTION_LENGTH) : null;
}
