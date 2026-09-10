/**
 * What a reader can do with a picture they right-clicked.
 *
 * A picture in a conversation arrives by three different roads - inline in the
 * message as a `data:` URI, as an object URL the offloader handed back, or as
 * a link to the file server - and every one of them draws the same `<img>`.
 * The actions below are written against that: they take the `src` as the
 * gallery wrote it and work out for themselves how to get the bytes behind it,
 * so a menu row never has to know which of the three it is looking at.
 *
 * The one thing the webview cannot do on its own is write a file the reader
 * picked, which is what `save_image_as` is for - the dialog is opened on the
 * host side, so the only path this ever writes to is one a person chose.
 */
import { invoke } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { rebaseFileServerUrl } from "@core/store/fileServer";
import { base64ToBytes, bytesToBase64 } from "@core/utils/base64";

/** The extension a saved copy gets, by what the bytes turned out to be. */
const EXTENSION_FOR_MIME: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/svg+xml": "svg",
  "image/avif": "avif",
};

/** Whether the picture is something the network fetched, rather than carried. */
export function isRemoteImage(src: string): boolean {
  return /^https?:/i.test(src);
}

/**
 * What the bytes are, read out of the bytes themselves.
 *
 * The host hands back base64 and nothing else - no content type - and a
 * picture named `.png` by a link is not necessarily one. Every format here is
 * identified by its own first few bytes, which is the only honest answer.
 */
function sniffImageMime(bytes: Uint8Array): string {
  const at = (index: number) => bytes[index] ?? -1;
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47) return "image/png";
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return "image/jpeg";
  if (at(0) === 0x47 && at(1) === 0x49 && at(2) === 0x46) return "image/gif";
  if (at(0) === 0x42 && at(1) === 0x4d) return "image/bmp";
  if (at(0) === 0x52 && at(1) === 0x49 && at(8) === 0x57 && at(9) === 0x45) return "image/webp";
  return "application/octet-stream";
}

/**
 * The picture's bytes, whichever road it came in by.
 *
 * `data:` and `blob:` are the webview's own, so `fetch` reads them without
 * asking anyone. A file-server link is the exception: the browser is not the
 * one holding the session, and a direct fetch of it is refused by CORS - so
 * the same command that pulls an inline 3D model down is asked instead, and
 * it carries the credential the picture needs.
 */
export async function loadImageBlob(src: string): Promise<Blob> {
  if (!isRemoteImage(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new Error(`load image: ${response.status}`);
    return await response.blob();
  }
  try {
    const response = await fetch(src);
    if (response.ok) return await response.blob();
  } catch {
    // CORS, or a host the webview cannot reach. The session below can.
  }
  const config = useAppStore.getState().fileServerConfig;
  const credential = config?.sessionJwt ? { kind: "session", value: config.sessionJwt } : undefined;
  const encoded = await invoke<string>("download_to_base64", {
    request: { url: rebaseFileServerUrl(src), credential, maxBytes: 0 },
  });
  const bytes = base64ToBytes(encoded);
  return new Blob([bytes as BlobPart], { type: sniffImageMime(bytes) });
}

/**
 * A name to offer the save dialog.
 *
 * The link's own last segment where there is one - a file sent as
 * `holiday.jpg` should be saved as `holiday.jpg` - and otherwise a stamped
 * name, because a pasted picture has never had one. The extension is decided
 * by what the bytes are rather than by what the name claimed, so a screenshot
 * pasted straight out of the clipboard does not land on disk as `image.bin`.
 */
export function imageFileName(src: string, mime: string): string {
  const extension = EXTENSION_FOR_MIME[mime] ?? "png";
  if (isRemoteImage(src)) {
    try {
      const path = new URL(src).pathname;
      const last = decodeURIComponent(path.slice(path.lastIndexOf("/") + 1)).trim();
      // Only a name that already carries an extension; a signed download URL
      // ending in an opaque id would otherwise become the filename.
      if (/\.[a-z0-9]{2,5}$/i.test(last)) return last;
    } catch {
      // Not a URL after all - fall through to the stamped name.
    }
  }
  const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-").slice(0, 19);
  return `image-${stamp}.${extension}`;
}

/**
 * Re-encode to PNG.
 *
 * Chromium writes exactly one image type to the clipboard, and a JPEG handed
 * to `ClipboardItem` is refused rather than converted. An animated GIF loses
 * its animation on the way through, which is what every other browser does
 * with the same action.
 */
async function toPngBlob(blob: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("no 2d canvas context");
    context.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("png encode failed"))), "image/png");
    });
  } finally {
    bitmap.close();
  }
}

/** Put the picture itself - not its address - on the clipboard. */
export async function copyImageToClipboard(src: string): Promise<void> {
  const blob = await loadImageBlob(src);
  const png = blob.type === "image/png" ? blob : await toPngBlob(blob);
  await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
}

/**
 * Ask where the picture goes, then put it there.
 *
 * Returns the path written, or null when the reader closed the dialog without
 * choosing one - which is a cancellation rather than a failure, and the menu
 * says nothing about it.
 */
export async function saveImageAs(src: string): Promise<string | null> {
  const blob = await loadImageBlob(src);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return await invoke<string | null>("save_image_as", {
    dataBase64: bytesToBase64(bytes),
    defaultFilename: imageFileName(src, blob.type || sniffImageMime(bytes)),
  });
}
