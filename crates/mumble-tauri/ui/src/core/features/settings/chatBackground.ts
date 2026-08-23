/**
 * The chat wallpaper's transfer layer.
 *
 * Wallpaper bytes never ride the personalization record. The backend keeps
 * every file - the picked still or clip, its poster, and the pre-processed
 * variants - in its chat-backgrounds store, and the record holds only names.
 * This module is the one place that turns those names back into something the
 * webview can render: one binary-IPC read per file per session, wrapped in a
 * blob URL and cached.
 *
 * Blob URLs deliberately, not the asset protocol: WebKitGTK's media player
 * fetches through GStreamer, which cannot open Tauri's custom scheme, so a
 * `<video src="asset://...">` fails on Linux before decoding even starts. A
 * blob is served from the page's own process and plays everywhere the codec
 * does.
 */

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { resizeImage } from "./imageUtils";

/** Marks a record value as a store file name rather than a data-URL. */
export const STORE_REF_PREFIX = "bgstore:";

export function isStoreRef(value: string | null | undefined): value is string {
  return typeof value === "string" && value.startsWith(STORE_REF_PREFIX);
}

export const toStoreRef = (fileName: string): string => `${STORE_REF_PREFIX}${fileName}`;
export const storeRefName = (ref: string): string => ref.slice(STORE_REF_PREFIX.length);

export interface PickedChatBackground {
  kind: "image" | "video";
  fileName: string;
}

/**
 * Open the OS picker for an image or a video.
 *
 * The choice never crosses the webview: the backend copies a clip (or decodes,
 * downscales and stores a still - the source may be a 100 MB photograph) and
 * only the stored name comes back. `null` means the user cancelled.
 */
export function pickChatBackground(): Promise<PickedChatBackground | null> {
  return invoke<PickedChatBackground | null>("pick_chat_background");
}

/** Poster bounds, matching the Rust extractor's output. */
const POSTER_MAX_WIDTH = 960;
const POSTER_MAX_HEIGHT = 540;
const POSTER_MAX_BYTES = 300_000;

const MIME_BY_EXTENSION: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

function mimeFor(fileName: string): string {
  const extension = fileName.slice(fileName.lastIndexOf(".") + 1).toLowerCase();
  return MIME_BY_EXTENSION[extension] ?? "application/octet-stream";
}

/**
 * Blob URLs by stored file name.
 *
 * Names are UUIDs minted per write, so an entry can never go stale - but the
 * map is pruned on replace/clear so a session that picks wallpapers all day
 * does not pin every one of them in memory.
 */
const blobUrls = new Map<string, string>();

/**
 * Read one stored file over binary IPC and hand back a playable blob URL.
 *
 * `null` means the store no longer has the file - a record copied between
 * machines, or a cleaned data directory - which callers render as "no
 * wallpaper" rather than an error.
 */
export async function storedBackgroundUrl(fileName: string): Promise<string | null> {
  const cached = blobUrls.get(fileName);
  if (cached) return cached;
  try {
    const bytes = await invoke<ArrayBuffer>("read_chat_background", { fileName });
    const url = URL.createObjectURL(new Blob([bytes], { type: mimeFor(fileName) }));
    blobUrls.set(fileName, url);
    return url;
  } catch {
    return null;
  }
}

/** Drop every cached blob URL except the named survivors. */
export function releaseStoredBackgrounds(except: readonly string[] = []) {
  for (const [name, url] of blobUrls) {
    if (!except.includes(name)) {
      URL.revokeObjectURL(url);
      blobUrls.delete(name);
    }
  }
}

/**
 * Resolve a record value - data-URL or `bgstore:` ref - to a renderable src.
 */
export async function resolveBackgroundSource(value: string | null): Promise<string | null> {
  if (!value) return null;
  if (!isStoreRef(value)) return value;
  return storedBackgroundUrl(storeRefName(value));
}

/** Hook form of [`resolveBackgroundSource`], for render paths. */
export function useResolvedBackgroundSource(value: string | null): string | null {
  const [src, setSrc] = useState<string | null>(() =>
    isStoreRef(value) ? (blobUrls.get(storeRefName(value)) ?? null) : value,
  );
  useEffect(() => {
    if (!isStoreRef(value)) {
      setSrc(value);
      return;
    }
    let active = true;
    const cached = blobUrls.get(storeRefName(value));
    setSrc(cached ?? null);
    if (!cached) {
      void storedBackgroundUrl(storeRefName(value)).then((url) => {
        if (active) setSrc(url);
      });
    }
    return () => {
      active = false;
    };
  }, [value]);
  return src;
}

/** Hook: blob URL for a raw stored name (`chatBgVideo` and friends). */
export function useStoredBackgroundUrl(fileName: string | null): string | null {
  return useResolvedBackgroundSource(fileName ? toStoreRef(fileName) : null);
}

/**
 * Bake blur/dim into a stored still and return the processed file's name.
 */
export function processBackgroundImage(
  fileName: string,
  sigma: number,
  dim: number,
): Promise<string> {
  return invoke<string>("process_chat_background_image", { fileName, sigma, dim });
}

/**
 * Have the backend decode a poster frame out of a stored clip with its own
 * bundled H.264 decoder. `null` means the clip is not something it can open
 * (WebM, or an exotic stream) - fall back to [`captureAndStorePoster`].
 */
export function extractBackgroundPoster(fileName: string): Promise<string | null> {
  return invoke<string | null>("extract_chat_background_poster", { fileName });
}

/**
 * Bake blur/dim into every frame of a stored clip. Long-running - minutes for
 * a long clip; subscribe [`onBakeProgress`] for updates. Rejects for clips the
 * backend cannot decode, which callers treat as "stay on the live CSS filter",
 * not as a failed pick.
 */
export function bakeBackgroundVideo(
  fileName: string,
  sigma: number,
  dim: number,
): Promise<string> {
  return invoke<string>("bake_chat_background_video", { fileName, sigma, dim });
}

/** Forget the wallpaper: every stored file, and every cached blob URL. */
export async function clearChatBackgroundStore(): Promise<void> {
  await invoke("clear_chat_background");
  releaseStoredBackgrounds();
}

export interface BakeProgress {
  done: number;
  total: number;
}

/** Subscribe to bake progress; returns an unsubscribe function. */
export function onBakeProgress(callback: (progress: BakeProgress) => void): () => void {
  const pending = listen<BakeProgress>("chat-background-bake-progress", (event) =>
    callback(event.payload),
  );
  return () => {
    void pending.then((unlisten) => unlisten());
  };
}

/**
 * How long a webview decode attempt may take before it is called a failure.
 */
const PROBE_TIMEOUT_MS = 15_000;

/** Human words for a `MediaError`, which is otherwise a bare code. */
function describeMediaError(error: MediaError | null): string {
  switch (error?.code) {
    case MediaError.MEDIA_ERR_DECODE:
      return "This system is missing the codecs to play that video.";
    case MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED:
      return "This system's webview does not support that video format.";
    case MediaError.MEDIA_ERR_NETWORK:
    case MediaError.MEDIA_ERR_ABORTED:
      return "That video could not be read.";
    default:
      return "That video could not be played.";
  }
}

/** Load `src` into an off-screen `<video>` until its first frame is ready. */
function loadVideoFrame(src: string, seekIn: boolean): Promise<HTMLVideoElement> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "auto";
  video.playsInline = true;
  video.src = src;
  // Attached, because not every engine will paint a detached video into a
  // canvas, and off-screen because this one is never meant to be seen.
  video.style.cssText = "position:fixed;left:-9999px;width:1px;height:1px;opacity:0";
  document.body.appendChild(video);

  const cleanup = () => {
    video.onerror = null;
    video.onseeked = null;
    video.onloadeddata = null;
    // Dropping the source lets the webview release the decoder before the
    // element is collected.
    video.removeAttribute("src");
    video.load();
    video.remove();
  };

  return new Promise<HTMLVideoElement>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("That video took too long to decode."));
    }, PROBE_TIMEOUT_MS);
    const settle = (run: () => void) => {
      clearTimeout(timer);
      run();
    };

    video.onerror = () =>
      settle(() => {
        const message = describeMediaError(video.error);
        cleanup();
        reject(new Error(message));
      });
    video.onseeked = () => settle(() => resolve(video));
    video.onloadeddata = () => {
      if (!seekIn) {
        settle(() => resolve(video));
        return;
      }
      // The opening frame of a clip is often black, which would make for a
      // poor still. A moment in is nearly always real picture.
      const target = Math.min(0.1, (video.duration || 0) / 2);
      if (target > 0) video.currentTime = target;
      else settle(() => resolve(video));
    };
  }).catch((error) => {
    cleanup();
    throw error;
  });
}

/**
 * Can this webview actually play the clip at `src`?
 *
 * Purely advisory: an unplayable wallpaper still shows its poster, so the
 * caller's job is to say so, not to refuse the pick.
 */
export async function probeVideoPlayback(
  src: string,
): Promise<{ playable: boolean; reason: string | null }> {
  try {
    const video = await loadVideoFrame(src, false);
    video.removeAttribute("src");
    video.load();
    video.remove();
    return { playable: true, reason: null };
  } catch (error) {
    return {
      playable: false,
      reason: error instanceof Error ? error.message : "That video could not be played.",
    };
  }
}

/**
 * Decode one frame of `src` in the webview, cap it like the Rust poster
 * extractor would, and store it as the wallpaper's poster.
 *
 * The fallback for clips the backend cannot open (WebM): here the webview is
 * the only decoder available, so a failure really does mean the system cannot
 * show this clip at all.
 */
export async function captureAndStorePoster(src: string): Promise<string> {
  const video = await loadVideoFrame(src, true);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context || canvas.width === 0 || canvas.height === 0)
      throw new Error("This system could not decode that video.");
    context.drawImage(video, 0, 0);

    const capped = await resizeImage(
      canvas.toDataURL("image/jpeg", 0.9),
      POSTER_MAX_WIDTH,
      POSTER_MAX_HEIGHT,
      POSTER_MAX_BYTES,
      "image/jpeg",
    );
    const base64 = capped.slice(capped.indexOf(",") + 1);
    return await invoke<string>("store_chat_background_poster", { imageBase64: base64 });
  } finally {
    video.removeAttribute("src");
    video.load();
    video.remove();
  }
}
