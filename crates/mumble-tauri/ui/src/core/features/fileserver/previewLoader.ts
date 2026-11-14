/**
 * Shared preview byte-loading + caching for file-server files.  The actual
 * base64 fetch is injected (`fetchBase64`) so the same decode/cache path serves
 * both the admin dashboard (`/admin/files/{id}/raw`) and a user's own files
 * (`/me/files/{id}/raw`).
 */

/** Fetch a file's bytes as standard base64.  `maxBytes` caps the transfer
 *  (0 = server default). */
export type FetchBase64 = (fileId: string, maxBytes: number) => Promise<string>;

// fileId -> object URL of the fetched bytes.  Cached so re-opening a preview
// (or a thumbnail scrolling back into view) doesn't re-hit the backend.
const previewCache = new Map<string, string>();

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Fetch a file's bytes and return a same-origin object URL for rendering.
 *  Cached by file id. */
export async function cachedPreviewUrl(
  fetchBase64: FetchBase64,
  fileId: string,
  mime: string,
  maxBytes: number,
): Promise<string> {
  const cached = previewCache.get(fileId);
  if (cached) return cached;
  const bytes = decodeBase64(await fetchBase64(fileId, maxBytes));
  const url = URL.createObjectURL(
    new Blob([bytes as BlobPart], { type: mime || "application/octet-stream" }),
  );
  previewCache.set(fileId, url);
  return url;
}

/** Fetch a text file's contents (for the text preview). */
export async function cachedPreviewText(
  fetchBase64: FetchBase64,
  fileId: string,
  maxBytes: number,
): Promise<string> {
  const bytes = decodeBase64(await fetchBase64(fileId, maxBytes));
  return new TextDecoder().decode(bytes);
}

/** Drop a cached preview (after a file is deleted) and free its object URL. */
export function dropPreview(fileId: string): void {
  const url = previewCache.get(fileId);
  if (url) {
    URL.revokeObjectURL(url);
    previewCache.delete(fileId);
  }
}
