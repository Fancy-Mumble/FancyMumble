/**
 * Standard (non-URL-safe) base64 <-> bytes helpers.
 *
 * Consolidates the several byte-string-loop copies that previously lived in
 * `dmStorage`, `friendsStorage`, `FileAttachmentCard` and `LiveDocEmbedView`.
 * Operates on raw bytes (each char maps to one byte), so the input to
 * `bytesToBase64` must be a `Uint8Array` of byte values (0-255).
 */

/** Encode raw bytes to a standard base64 string. */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode a standard base64 string back to raw bytes. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
