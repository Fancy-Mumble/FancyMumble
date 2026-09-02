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
 * public - a private one is only readable through the session that fetched it,
 * and a second window has none.
 */
export function findPopOutImageSrc(body: string): string | null {
  const inline = /<img[^>]+src="([^"]+)"/i.exec(body);
  if (inline?.[1]) return inline[1];
  const fileMatch = FANCY_FILE_MARKER_RE.exec(body);
  if (fileMatch) {
    const info: FileAttachmentInfo | null = decodeFileAttachmentPayload(fileMatch[1]);
    if (info && previewKindForFilename(info.filename) === "image" && info.mode === "public") {
      return info.url;
    }
  }
  return null;
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
