/**
 * How big a picture is, before anything has decoded it.
 *
 * A message body carries its pictures inline, as `data:` URLs, and the browser
 * only reports `naturalWidth` once it has decoded one. Joining a persistent
 * channel hands it a hundred of those at once: every row is laid out at zero
 * height, each decode lands whenever it lands, and the column jumps under the
 * reader for as long as the queue takes. Reserving the right box needs the
 * size *now*, not on `load`.
 *
 * Every format we accept writes its dimensions in the first handful of bytes,
 * so they can be read straight out of the base64 without decoding an image at
 * all - a few hundred bytes of work per picture, on the render path.
 *
 * A picture the body points at by URL cannot be measured this way; it is
 * remembered instead, once, when it first loads ({@link rememberImageSize}),
 * so the second view of a conversation reserves its box like the rest.
 */

/** The dimensions of a picture, in its own pixels. */
export interface ImageSize {
  readonly width: number;
  readonly height: number;
}

/**
 * How much of a picture is looked at.
 *
 * Only JPEG needs more than a few dozen bytes - its frame header sits after
 * whatever EXIF the camera wrote, and a phone's thumbnail block runs to tens
 * of kilobytes. Past this the picture is simply unmeasured, which costs a
 * reserved box, not a rendered one.
 */
const HEADER_BYTES = 64 * 1024;

/** Sizes measured from a loaded `<img>`, for sources that carry no header here. */
const measured = new Map<string, ImageSize>();

/**
 * How many remote pictures are remembered.
 *
 * Keys are URLs, values a pair of numbers, so the ceiling is about paranoia
 * rather than bytes: nothing should be able to grow without one.
 */
const MEASURED_CAP = 4096;

/**
 * Record what a picture measured once the browser had decoded it.
 *
 * Only useful for sources this module cannot read - a remote URL. A `data:`
 * URL is measured from its own bytes every time, which is cheaper than
 * holding a megabyte-long string as a map key.
 */
export function rememberImageSize(src: string, size: ImageSize): void {
  if (!src || src.startsWith("data:")) return;
  if (size.width <= 0 || size.height <= 0) return;
  if (measured.has(src)) return;
  if (measured.size >= MEASURED_CAP) {
    const oldest = measured.keys().next();
    if (!oldest.done) measured.delete(oldest.value);
  }
  measured.set(src, size);
}

/** Forget every remembered size. For tests, and for a fresh connection. */
export function forgetImageSizes(): void {
  measured.clear();
}

/**
 * The size of the picture at `src`, or `null` when it cannot be known yet.
 *
 * Synchronous by design: the caller is a render, and a size that arrives after
 * one is a size that arrives after the layout it was meant to prevent.
 */
export function imageSizeFromSource(src: string): ImageSize | null {
  if (!src) return null;
  if (!src.startsWith("data:")) return measured.get(src) ?? null;

  const comma = src.indexOf(",");
  if (comma < 0) return null;
  const meta = src.slice(5, comma);
  const payload = src.slice(comma + 1);

  if (meta.startsWith("image/svg+xml")) {
    return svgSize(meta.includes(";base64") ? decodeBase64Text(payload) : decodeTextPayload(payload));
  }
  if (!meta.includes(";base64")) return null;

  const header = decodeHeader(payload);
  return header ? sizeFromBytes(header) : null;
}

/** Read a picture's dimensions out of its leading bytes. */
export function sizeFromBytes(bytes: Uint8Array): ImageSize | null {
  const size =
    pngSize(bytes) ??
    gifSize(bytes) ??
    jpegSize(bytes) ??
    webpSize(bytes) ??
    bmpSize(bytes) ??
    isoBmffSize(bytes);
  if (!size) return null;
  // A header that parsed but says nothing usable is the same as no header:
  // reserving a zero-sized box is the bug this module exists to prevent.
  return size.width > 0 && size.height > 0 ? size : null;
}

// --- Bounded base64 ------------------------------------------------

/** Decode at most {@link HEADER_BYTES} of a base64 payload. */
function decodeHeader(payload: string): Uint8Array | null {
  const wanted = Math.ceil(HEADER_BYTES / 3) * 4;
  const take = Math.min(payload.length, wanted);
  // atob wants whole quartets; a trailing partial one is dropped rather than
  // padded, since three bytes at the end of a 64 KiB window decide nothing.
  const chunk = payload.slice(0, take - (take % 4));
  if (!chunk) return null;
  try {
    const bin = atob(chunk);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}

/** Decode a base64 payload as text (SVG markup). */
function decodeBase64Text(payload: string): string {
  try {
    return atob(payload.slice(0, Math.ceil(HEADER_BYTES / 3) * 4));
  } catch {
    return "";
  }
}

/** Decode a percent-encoded (or plain) `data:` text payload. */
function decodeTextPayload(payload: string): string {
  try {
    return decodeURIComponent(payload);
  } catch {
    return payload;
  }
}

// --- Byte readers --------------------------------------------------

function be16(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) << 8) | (b[at + 1] ?? 0);
}

function be32(b: Uint8Array, at: number): number {
  return (((b[at] ?? 0) << 24) | ((b[at + 1] ?? 0) << 16) | ((b[at + 2] ?? 0) << 8) | (b[at + 3] ?? 0)) >>> 0;
}

function le16(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8);
}

function le24(b: Uint8Array, at: number): number {
  return (b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16);
}

function le32(b: Uint8Array, at: number): number {
  return ((b[at] ?? 0) | ((b[at + 1] ?? 0) << 8) | ((b[at + 2] ?? 0) << 16) | ((b[at + 3] ?? 0) << 24)) >>> 0;
}

/** Whether `text` sits at `at` as plain ASCII. */
function tag(b: Uint8Array, at: number, text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (b[at + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

// --- Formats -------------------------------------------------------

/** PNG (and APNG): the IHDR chunk is always the first one. */
function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24) return null;
  if (b[0] !== 0x89 || !tag(b, 1, "PNG")) return null;
  if (!tag(b, 12, "IHDR")) return null;
  return { width: be32(b, 16), height: be32(b, 20) };
}

/** GIF: the logical screen descriptor follows the six-byte signature. */
function gifSize(b: Uint8Array): ImageSize | null {
  if (b.length < 10 || !tag(b, 0, "GIF8")) return null;
  return { width: le16(b, 6), height: le16(b, 8) };
}

/**
 * JPEG: walk the segment chain to the frame header.
 *
 * The dimensions live in whichever SOF marker the encoder used - baseline,
 * progressive, arithmetic - and everything before it (EXIF, ICC, a JFIF
 * thumbnail) is skipped by its own declared length.
 */
function jpegSize(b: Uint8Array): ImageSize | null {
  if (b.length < 4 || b[0] !== 0xff || b[1] !== 0xd8) return null;
  let at = 2;
  while (at + 9 < b.length) {
    if (b[at] !== 0xff) return null;
    const marker = b[at + 1];
    // Padding, and the standalone markers that carry no length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0x01 || (marker !== undefined && marker >= 0xd0 && marker <= 0xd9)) {
      at += 2;
      continue;
    }
    // Compressed data starts here; a frame header we have not seen by now is
    // one this file does not have.
    if (marker === 0xda) return null;
    const length = be16(b, at + 2);
    if (length < 2) return null;
    const isFrame =
      marker !== undefined &&
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 && // Huffman tables
      marker !== 0xc8 && // JPEG extensions
      marker !== 0xcc; // arithmetic conditioning
    if (isFrame) return { width: be16(b, at + 7), height: be16(b, at + 5) };
    at += 2 + length;
  }
  return null;
}

/** WebP: three container flavours, each with the size in a different place. */
function webpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 30 || !tag(b, 0, "RIFF") || !tag(b, 8, "WEBP")) return null;
  // Lossy: a VP8 keyframe header, behind its three-byte frame tag and sync.
  if (tag(b, 12, "VP8 ")) {
    const at = 23;
    if (b[at] !== 0x9d || b[at + 1] !== 0x01 || b[at + 2] !== 0x2a) return null;
    return { width: le16(b, at + 3) & 0x3fff, height: le16(b, at + 5) & 0x3fff };
  }
  // Lossless: fourteen bits each, packed behind the signature byte.
  if (tag(b, 12, "VP8L")) {
    if (b[20] !== 0x2f) return null;
    const bits = le32(b, 21);
    return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
  }
  // Extended (animation, alpha, ICC): the canvas size, minus one, as 24 bits.
  if (tag(b, 12, "VP8X")) {
    return { width: le24(b, 24) + 1, height: le24(b, 27) + 1 };
  }
  return null;
}

/** BMP: the DIB header. A negative height means top-down rows, same size. */
function bmpSize(b: Uint8Array): ImageSize | null {
  if (b.length < 26 || b[0] !== 0x42 || b[1] !== 0x4d) return null;
  const width = le32(b, 18) | 0;
  const height = le32(b, 22) | 0;
  return { width: Math.abs(width), height: Math.abs(height) };
}

/**
 * AVIF / HEIC: the `ispe` property box.
 *
 * A still in an ISO-BMFF container is a collection of items - the picture, and
 * often a thumbnail of it - each with its own `ispe`, and which one is the
 * primary item is several boxes of indirection away. The largest is taken
 * instead: a thumbnail is by definition not it, and being wrong here costs a
 * reserved box that the picture then corrects.
 */
function isoBmffSize(b: Uint8Array): ImageSize | null {
  if (b.length < 16 || !tag(b, 4, "ftyp")) return null;
  let best: ImageSize | null = null;
  for (let at = 8; at + 16 <= b.length; at++) {
    if (!tag(b, at, "ispe")) continue;
    const size = { width: be32(b, at + 8), height: be32(b, at + 12) };
    if (size.width <= 0 || size.height <= 0) continue;
    if (!best || size.width * size.height > best.width * best.height) best = size;
  }
  return best;
}

/** `<svg width="640" height="480">`, or the viewBox it sizes itself by. */
function svgSize(markup: string): ImageSize | null {
  const open = /<svg\b[^>]*>/i.exec(markup);
  if (!open) return null;
  const attrs = open[0];
  const width = svgLength(/\bwidth\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]);
  const height = svgLength(/\bheight\s*=\s*["']([^"']*)["']/i.exec(attrs)?.[1]);
  if (width && height) return { width, height };
  const box = /\bviewBox\s*=\s*["']\s*[-\d.]+[,\s]+[-\d.]+[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(attrs);
  if (!box) return null;
  const boxWidth = svgLength(box[1]);
  const boxHeight = svgLength(box[2]);
  return boxWidth && boxHeight ? { width: boxWidth, height: boxHeight } : null;
}

/**
 * A positive length in pixels, or nothing.
 *
 * `width="50%"` is not a size, it is a share of a box this code does not know;
 * neither is `10em`. Only a bare number, or one written in `px`, is a picture
 * saying how big it is.
 */
function svgLength(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  const text = raw.trim();
  if (!/^[\d.]+(px)?$/i.test(text)) return null;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) && value > 0 ? value : null;
}
