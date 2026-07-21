/**
 * Blob-based display URLs for raw texture bytes (avatars, icons).
 *
 * Historically textures were rendered via base64 `data:` URLs.  That
 * embeds the full image into every `<img src>` DOM attribute AND keeps
 * the base64 string on the JS heap - a single oversized avatar measured
 * 5.3 MB per <img>, dominating the renderer's DOM weight.  An object
 * URL is a ~50-byte handle; the bytes live once in the browser's blob
 * storage.
 *
 * Oversized textures are additionally downscaled to avatar resolution:
 * Chromium keeps *decoded* bitmaps in its image cache, so a 720x720
 * animated GIF rendered into a 32 px avatar slot costs decoded-frame
 * memory out of all proportion (width x height x 4 bytes x frames).
 * Downscaling to a 128 px static WebP caps that cost; the animation of
 * such monster avatars is intentionally dropped.
 */

/** Textures larger than this are downscaled for display. */
export const TEXTURE_DOWNSCALE_THRESHOLD = 256 * 1024;

/** Longest edge of a downscaled avatar texture. */
const AVATAR_MAX_DIM = 128;

/** Detect the image MIME type from magic bytes (default: image/png). */
export function sniffImageMime(u8: Uint8Array): string {
  if (u8.length >= 3 && u8[0] === 0x47 && u8[1] === 0x49 && u8[2] === 0x46) return "image/gif";
  if (u8.length >= 2 && u8[0] === 0xff && u8[1] === 0xd8) return "image/jpeg";
  if (u8.length >= 4 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return "image/png";
  if (
    u8.length >= 12
    && u8[0] === 0x52 && u8[1] === 0x49 && u8[2] === 0x46 && u8[3] === 0x46
    && u8[8] === 0x57 && u8[9] === 0x45 && u8[10] === 0x42 && u8[11] === 0x50
  ) {
    return "image/webp";
  }
  return "image/png";
}

function toU8(bytes: number[] | Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes instanceof Uint8Array && bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  return new Uint8Array(bytes);
}

/**
 * Synchronously wrap texture bytes in a blob object URL (no downscale).
 * Returns "" for empty input.  Callers own the URL and should release
 * it with [`revokeDisplayUrl`] when it is no longer rendered.
 */
export function bytesToObjectUrl(bytes: number[] | Uint8Array): string {
  if (bytes.length === 0) return "";
  const u8 = toU8(bytes);
  return URL.createObjectURL(new Blob([u8], { type: sniffImageMime(u8) }));
}

/**
 * Convert texture bytes to a display URL, downscaling oversized images
 * to avatar resolution (see module docs).  Falls back to the full-size
 * blob when decoding/downscaling is unavailable or fails.
 */
export async function bytesToAvatarUrl(bytes: number[] | Uint8Array): Promise<string> {
  if (bytes.length === 0) return "";
  const u8 = toU8(bytes);
  const blob = new Blob([u8], { type: sniffImageMime(u8) });
  if (u8.length <= TEXTURE_DOWNSCALE_THRESHOLD) return URL.createObjectURL(blob);

  try {
    const bitmap = await createImageBitmap(blob);
    const scale = AVATAR_MAX_DIM / Math.max(bitmap.width, bitmap.height);
    if (scale >= 1) {
      // Big file but small dimensions - keep the original encoding.
      bitmap.close();
      return URL.createObjectURL(blob);
    }
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return URL.createObjectURL(blob);
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const scaled = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
    return URL.createObjectURL(scaled);
  } catch {
    return URL.createObjectURL(blob);
  }
}

/** Release a display URL created by this module.  Safe to call with
 *  `data:` URLs, empty strings, or plain text - only `blob:` URLs are
 *  revoked. */
export function revokeDisplayUrl(url: string | null | undefined): void {
  if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
}
