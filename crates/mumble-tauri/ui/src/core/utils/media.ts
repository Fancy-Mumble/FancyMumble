/**
 * Utilities for encoding media files as base64 HTML for Mumble messages.
 *
 * Mumble text messages are HTML.  Images/videos are embedded as
 * `<img src="data:...;base64,...">` or `<video>` tags with base64 data URLs.
 * The server enforces `image_message_length` as the max byte length.
 */

/** Detected media type from file. */
export type MediaKind = "image" | "gif" | "video";

const EXT_TO_MIME: Record<string, string> = {
  // Images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  // Video
  mp4: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  avi: "video/x-msvideo",
  // Audio
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/opus",
  wav: "audio/wav",
  flac: "audio/flac",
  aac: "audio/aac",
  m4a: "audio/mp4",
  // Documents
  pdf: "application/pdf",
  // Archives
  zip: "application/zip",
  gz: "application/gzip",
  tar: "application/x-tar",
  // Text
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  json: "application/json",
};

/** Infer a MIME type from a file path's extension.
 *  Returns `null` when the extension is unknown. */
export function inferMimeType(filePath: string): string | null {
  const ext = filePath.toLowerCase().split(".").pop() ?? "";
  return EXT_TO_MIME[ext] ?? null;
}

/** Detect kind from MIME type. */
export function mediaKind(mime: string): MediaKind | null {
  if (mime === "image/gif") return "gif";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  return null;
}

/**
 * Yield control back to the browser event loop so React/CSS can paint
 * a frame between long-running synchronous canvas operations.  Without
 * this, JPEG re-encoding inside `fitImage` blocks the main thread for
 * several seconds on mobile devices, freezing any pending-message
 * progress UI.
 */
function yieldToUI(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Read a File as a base64 data-URL string.
 * Returns the full `data:<mime>;base64,...` string.
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/**
 * The largest picture an inline image is sent at - the same box legacy Mumble
 * scales its own pasted images into.
 *
 * Bytes are not the only limit. A legacy client lays the message out before
 * drawing it and refuses any message whose layout covers more than 2048x2048
 * pixels, showing "Text object too large to display" instead. A phone photo
 * squeezed under the byte limit by quality alone is still 12 megapixels, so
 * the box is enforced whether or not the bytes already fit.
 */
export const INLINE_MAX_WIDTH = 1600;
export const INLINE_MAX_HEIGHT = 1000;

/** How a picture is fitted, beyond its byte budget. */
export interface FitOptions {
  /**
   * Characters of the budget the markup around the picture will take.
   *
   * Defaults to 100, an `<img>` with a short name. A caller that knows what
   * else rides in the message - a gallery marker, a caption, a spoiler
   * wrapper - says so, or the server measures a body that was fitted as if
   * those were not there and refuses it.
   */
  readonly reserve?: number;
  /** A smaller box than the default, for a picture that shares the layout. */
  readonly maxWidth?: number;
  readonly maxHeight?: number;
}

/**
 * Compress / downscale an image so its base64 data-URL fits within
 * `maxBytes`, and its pixels within `INLINE_MAX_WIDTH` x `INLINE_MAX_HEIGHT`.
 * Returns the data-URL string.
 *
 * Strategy - maximize visual quality:
 *   1. Original fits both limits -> return untouched (lossless).
 *   2. Re-encode as JPEG at full resolution.
 *      Binary-search quality 0.1-0.95 to find the highest quality
 *      that fits.  Keeping original pixel dimensions is almost always
 *      preferable over scaling down.
 *   3. Only if even quality 0.1 at full resolution overflows, scale
 *      down.  Estimate a starting scale from the size ratio, then
 *      binary-search to maximize dimensions.  Finally sweep quality
 *      upward at the chosen scale to use any remaining budget.
 */
export async function fitImage(file: File, maxBytes: number, options: FitOptions = {}): Promise<string> {
  if (maxBytes < 5000) maxBytes = 131072; // guard against bogus limits

  // An unreadable source would otherwise encode to a well-formed but payloadless
  // `data:image/png;base64,` URL, slip under the size check below, and be sent
  // as an empty image.
  if (file.size === 0) throw new Error(`${file.name || "image"} is empty`);

  return fitDataUrl(await fileToDataUrl(file), maxBytes, options);
}

/**
 * The types a stock Mumble client can decode out of the box.
 *
 * Qt draws an inline image through its image plugins, and the ones every
 * Mumble build ships are these. A WebP, AVIF or SVG that fits the byte limit
 * still reaches a legacy client as a broken-image box - and an inline image
 * is seen by every client in the channel, legacy ones included - so anything
 * else is redrawn rather than passed through.
 */
const LEGACY_DECODABLE = /^data:image\/(png|jpeg|gif|bmp);/;

/** {@link fitImage} for a picture already read into a data-URL. */
export async function fitDataUrl(
  dataUrl: string,
  maxBytes: number,
  options: FitOptions = {},
): Promise<string> {
  const img = await loadImage(dataUrl);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (naturalW === 0 || naturalH === 0) throw new Error("Image has zero dimensions");

  // Leave room for the HTML wrapper (<img src="..." alt="..." />)
  const budget = maxBytes - (options.reserve ?? 100);
  const boxW = options.maxWidth ?? INLINE_MAX_WIDTH;
  const boxH = options.maxHeight ?? INLINE_MAX_HEIGHT;

  // 1. Original fits -> return as-is.
  const boxScale = Math.min(1, boxW / naturalW, boxH / naturalH);
  if (boxScale === 1 && dataUrl.length <= budget && LEGACY_DECODABLE.test(dataUrl)) return dataUrl;
  // A type stock Mumble cannot read, small enough to keep: redrawn as PNG
  // first, which keeps its transparency, where JPEG would paint it black.
  if (boxScale === 1 && !LEGACY_DECODABLE.test(dataUrl)) {
    const canvas = new OffscreenCanvas(naturalW, naturalH);
    canvas.getContext("2d")?.drawImage(img, 0, 0);
    const png = await blobToDataUrl(await canvas.convertToBlob({ type: "image/png" }));
    if (png.length <= budget) return png;
  }

  // Every scale below is relative to the picture already fitted into the box.
  const srcW = naturalW * boxScale;
  const srcH = naturalH * boxScale;

  /** Render at `scale` x original dimensions with given JPEG `quality`. */
  async function tryEncode(scale: number, quality: number): Promise<string> {
    // Yield BEFORE the heavy synchronous draw+encode so React can paint
    // the optimistic "preparing" placeholder between iterations.
    await yieldToUI();
    const w = Math.max(1, Math.round(srcW * scale));
    const h = Math.max(1, Math.round(srcH * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(img, 0, 0, w, h);
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
    return blobToDataUrl(blob);
  }

  /** Binary-search quality at a fixed `scale` to maximize it. */
  async function bestQualityAt(
    scale: number,
    qMin: number,
    qMax: number,
    iterations: number,
  ): Promise<string | null> {
    // Verify that qMin actually fits.
    let best = await tryEncode(scale, qMin);
    if (best.length > budget) return null;

    let lo = qMin,
      hi = qMax;
    for (let i = 0; i < iterations; i++) {
      const mid = (lo + hi) / 2;
      const r = await tryEncode(scale, mid);
      if (r.length <= budget) {
        best = r;
        lo = mid;
      } else {
        hi = mid;
      }
    }
    return best;
  }

  // 2. Try full resolution - binary-search quality.
  const fullRes = await bestQualityAt(1, 0.1, 0.95, 8);
  if (fullRes) return fullRes;

  // 3. Full resolution doesn't fit even at q=0.1 -> scale down.
  //    Estimate starting scale from the byte-size ratio.
  const lowQ = await tryEncode(1, 0.1);
  const estScale = Math.min(0.95, Math.sqrt(budget / lowQ.length) * 1.1);

  //    Find a guaranteed-to-fit lower bound by halving from the estimate.
  let lo = 0;
  let bestScaled: string | null = null;
  let probe = estScale;
  for (let i = 0; i < 15 && probe >= 0.005; i++) {
    const r = await tryEncode(probe, 0.7);
    if (r.length <= budget) {
      bestScaled = r;
      lo = probe;
      break;
    }
    probe *= 0.5;
  }
  if (!bestScaled) return tryEncode(0.01, 0.1); // absolute fallback

  //    Binary-search scale upward from lo.
  let hi = Math.min(1, lo * 3);
  for (let i = 0; i < 12; i++) {
    if (hi - lo < 0.002) break;
    const mid = (lo + hi) / 2;
    const r = await tryEncode(mid, 0.7);
    if (r.length <= budget) {
      bestScaled = r;
      lo = mid;
    } else {
      hi = mid;
    }
  }

  //    Maximize quality at the final scale.
  const finalQ = await bestQualityAt(lo, 0.7, 0.95, 6);
  return finalQ ?? bestScaled;
}

/**
 * Build the HTML string to embed a media file in a Mumble text message.
 *
 * When `spoiler` is set, the element carries a `data-spoiler="1"` marker so
 * the receiving client renders it heavily blurred until clicked. The marker
 * rides along on the tag itself and survives the server's verbatim message
 * relay (the same way the message body's `<!-- FANCY_* -->` markers do).
 */
export function mediaToHtml(dataUrl: string, kind: MediaKind, fileName: string, spoiler = false): string {
  const spoilerAttr = spoiler ? ' data-spoiler="1"' : "";
  switch (kind) {
    case "image":
    case "gif":
      return `<img src="${dataUrl}" alt="${escapeAttr(fileName)}"${spoilerAttr} />`;
    case "video":
      return `<video src="${dataUrl}" controls${spoilerAttr}>${escapeAttr(fileName)}</video>`;
  }
}

/**
 * Whether a picture already sits inside the inline box.
 *
 * The question a GIF passthrough has to ask before skipping the redraw: its
 * bytes may fit while its pixels do not, and a legacy client refuses to lay
 * out a message that covers more than 2048x2048.
 */
export async function fitsInlineBox(dataUrl: string): Promise<boolean> {
  const img = await loadImage(dataUrl);
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  return w > 0 && h > 0 && w <= INLINE_MAX_WIDTH && h <= INLINE_MAX_HEIGHT;
}

/**
 * A still of a video, fitted into `maxBytes`, or `null` when there is none.
 *
 * What a legacy client is shown for an inline `<video>`: Qt drops the tag and
 * draws its text, so without this a clip arrives as its file name.
 */
export async function videoPosterDataUrl(
  file: File,
  maxBytes: number,
  options: FitOptions = {},
): Promise<string | null> {
  try {
    const frame = await extractVideoFrame(file);
    return await fitDataUrl(await blobToDataUrl(frame), maxBytes, options);
  } catch (e) {
    console.warn("video poster failed:", e);
    return null;
  }
}

/** The inline pictures in a body: the attribute before each, its data URL, the quote after. */
const INLINE_IMAGE_RE = /(<img\b[^>]*?\ssrc=")(data:image\/[^"]+)(")/gi;

/**
 * `html` with its inline pictures shrunk until the whole body fits `maxChars`.
 *
 * Each picture was fitted on its own when it was inserted, but the server
 * measures the message: three pictures that each fit the limit are a body
 * three times over it, refused for everybody. The pictures share what the
 * rest of the body leaves, and only those over their share are redrawn.
 * Throws when the share is too small for any picture worth sending, so the
 * composer can say so instead of posting smears.
 */
export async function fitInlineImages(html: string, maxChars: number): Promise<string> {
  if (html.length <= maxChars) return html;
  const sources = Array.from(html.matchAll(INLINE_IMAGE_RE), (match) => match[2]);
  if (sources.length === 0) return html;
  const fixed = html.length - sources.reduce((total, src) => total + src.length, 0);
  const share = Math.floor((maxChars - fixed) / sources.length);
  if (share < 5000) throw new Error("Too many pictures for one message on this server.");
  const fitted: string[] = [];
  for (const src of sources)
    fitted.push(src.length <= share ? src : await fitDataUrl(src, share, { reserve: 0 }));
  let index = 0;
  const out = html.replace(INLINE_IMAGE_RE, (_match, before: string, _src: string, after: string) => {
    const src = fitted[index];
    index += 1;
    return `${before}${src}${after}`;
  });
  if (out.length > maxChars) throw new Error("Too many pictures for one message on this server.");
  return out;
}

/** Per-image quality for a gallery: `"full"` uses the whole image-size limit
 *  per image; `"compressed"` targets a smaller per-image budget. */
export type GalleryQuality = "full" | "compressed";

/** Hard cap on images per gallery (each is sent as its own message). */
export const MAX_GALLERY_IMAGES = 10;

/**
 * Compress a video to fit within `maxBytes`.
 *
 * If the raw file already fits, returns it as-is.  Otherwise extracts a
 * poster frame and compresses it as a JPEG image via `fitImage`.
 *
 * Returns `{ dataUrl, kind }` - `kind` will be `"video"` when the
 * original was kept, or `"image"` when a still frame was extracted.
 */
export async function fitVideo(
  file: File,
  maxBytes: number,
  options: FitOptions = {},
): Promise<{ dataUrl: string; kind: MediaKind }> {
  const dataUrl = await fileToDataUrl(file);

  // If the raw video fits, return as-is. "Fits" includes the markup around
  // it: a clip that filled the limit by itself was refused once its tag and
  // name were added.
  if (dataUrl.length <= maxBytes - (options.reserve ?? 100)) {
    return { dataUrl, kind: "video" };
  }

  // Video is far too large for the Mumble limit - extract a poster
  // frame and compress it as JPEG so the recipient sees something.
  console.log(`[fitVideo] video too large (${dataUrl.length} > ${maxBytes}), extracting poster frame`);

  const frameBlob = await extractVideoFrame(file);
  const frameFile = new File([frameBlob], "frame.jpg", {
    type: "image/jpeg",
  });
  const frameDataUrl = await fitImage(frameFile, maxBytes, options);
  return { dataUrl: frameDataUrl, kind: "image" };
}

// --- Helpers ------------------------------------------------------

/**
 * Extract a representative frame from a video file as a JPEG blob.
 * Seeks to 1 s or 25 % of duration (whichever is smaller).
 */
async function extractVideoFrame(file: File): Promise<Blob> {
  const url = URL.createObjectURL(file);
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";

    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(new Error("Failed to load video"));
      video.src = url;
    });

    // Seek to a representative position.
    const seekTo = Math.min(1, video.duration * 0.25);
    if (seekTo > 0) {
      await new Promise<void>((resolve) => {
        video.onseeked = () => resolve();
        video.currentTime = seekTo;
      });
    }

    const w = video.videoWidth || 1;
    const h = video.videoHeight || 1;
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext("2d");
    ctx?.drawImage(video, 0, 0, w, h);

    return canvas.convertToBlob({ type: "image/jpeg", quality: 0.92 });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Fetch a remote URL and return its contents as a data URL.
 * Useful for converting external image URLs (e.g. Klipy) into
 * self-contained data URIs that can be sent as binary.
 */
export async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
  const blob = await res.blob();
  return blobToDataUrl(blob);
}
