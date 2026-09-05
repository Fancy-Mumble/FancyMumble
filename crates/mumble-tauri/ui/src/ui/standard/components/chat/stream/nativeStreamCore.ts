/**
 * Shared core of the native viewer receive path: the per-track decode/paint
 * slot, the channel batch parser and the track-to-slot routing rule.
 *
 * Deliberately environment-agnostic - no React, no Tauri, no `document`:
 * the paint target is an injected provider, so the same logic runs both on
 * the main thread (the fallback path in nativeStreamView.ts, painting via
 * a React canvas ref) and inside the decode worker
 * (nativeStreamViewWorker.ts, painting onto transferred `OffscreenCanvas`es
 * where it escapes WebKit's page throttling).
 */
import type { TrackContentMap } from "./trackContent";

/** Byte layout of one record header in a channel batch (see the wire
 *  format described in nativeStreamView.ts's module doc). */
const HEADER_LEN = 14;

/** Above this decode backlog, delta chunks are dropped until the next
 *  keyframe (catch-up instead of runaway latency on a slow decoder). */
const MAX_DECODE_QUEUE = 30;

/** Sliding window for the painted-fps estimate. */
const FPS_WINDOW_MS = 2000;

/** A decoded frame this far (media time) behind the newest fed chunk is
 *  stall backlog - the pipeline was paused (window occluded, decoder
 *  hiccup, main thread busy) while chunks kept arriving. Painting the
 *  backlog replays the missed content as a fast-forward burst and delays
 *  live video by its length; skipping straight to fresh frames is what a
 *  live share wants. */
const STALE_FRAME_US = 500_000;

/** Wall-clock analogue of {@link STALE_FRAME_US} for the JPEG path (JPEG
 *  records are painted by arrival, not media time). */
const STALE_JPEG_MS = 500;

/** Delta chunks keep arriving but no key chunk has for this long (several
 *  GOPs) - upstream keyframes are dying in transit (loss cycles). Feeding
 *  the decoder reference-broken deltas paints nothing and errors nothing;
 *  stop feeding until a key arrives and keep asking for one. */
const KEY_DROUGHT_MS = 8000;

/** JS-side decode/paint metrics of one slot, for the stats sampler. */
export interface SlotMetrics {
  /** Frames painted (cumulative). */
  readonly painted: number;
  /** Painted frames per second over the last {@link FPS_WINDOW_MS}. */
  readonly fps: number;
  /** Frame dimensions of the last paint; 0 before the first. */
  readonly width: number;
  readonly height: number;
  /** VideoDecoder backlog (0 in JPEG mode). */
  readonly queue: number;
  /** Payload bytes / chunks / keyframes received on the channel. */
  readonly fedBytes: number;
  readonly fedChunks: number;
  readonly fedKeyframes: number;
  /** Paint gaps far above the running average (visible stutter). */
  readonly freezeCount: number;
  readonly freezeDurationS: number;
  /** Frames discarded before paint: chunks dropped while waiting for a
   *  keyframe or behind a decode backlog, decoded frames skipped as stall
   *  backlog, JPEGs overtaken by a newer one. */
  readonly dropped: number;
  /** Cumulative seconds between a frame arriving on the channel and its
   *  paint - the native path's analogue of the webview's jitter-buffer
   *  delay (decode queue + decoder hold), summed over painted frames. */
  readonly paintDelayS: number;
}

/** An all-zero metrics value (before the first worker snapshot). */
export const EMPTY_SLOT_METRICS: SlotMetrics = {
  painted: 0,
  fps: 0,
  width: 0,
  height: 0,
  queue: 0,
  fedBytes: 0,
  fedChunks: 0,
  fedKeyframes: 0,
  freezeCount: 0,
  freezeDurationS: 0,
  dropped: 0,
  paintDelayS: 0,
};

/** Either thread's 2D context; the drawing surface behind it resizes to
 *  the frame inside the provider. */
export type SlotContext2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Yields the slot's (frame-sized) paint target, or null while no surface
 *  is mounted yet - the slot still flips its first-content signal then, so
 *  the owning tile can mount one. */
export type PaintTargetProvider = (width: number, height: number) => SlotContext2D | null;

/** One canvas-painting sink for one track slot (display or camera). */
export interface Slot {
  /** (Re)configure the H.264 decoder from an avcC record. */
  configure(avcc: Uint8Array<ArrayBuffer>): void;
  feed(isH264: boolean, key: boolean, timestampUs: number, bytes: Uint8Array<ArrayBuffer>): void;
  metrics(): SlotMetrics;
  dispose(): void;
}

export function makeSlot(
  paintTarget: PaintTargetProvider,
  onFirstFrame: () => void,
  requestKeyframe: () => void,
): Slot {
  let disposed = false;
  let marked = false;
  let decoder: VideoDecoder | null = null;
  /** avcC record of the current parameter sets (H.264 mode). Chunks before
   *  the first config are undecodable and get dropped (needKey covers it). */
  let description: Uint8Array<ArrayBuffer> | null = null;
  let needKey = true;
  let dropUntilKey = false;
  /** Serialises async JPEG paints so a stale bitmap never lands last. */
  let jpegSeq = 0;
  let jpegPainted = 0;
  /** Newest fed media timestamp / feed wall-clock, for stale-frame drops. */
  let newestFedTsUs = 0;
  let newestFedAtMs = 0;
  /** Wall clock of the last key chunk fed (0 before the first). */
  let lastKeyFedMs = 0;
  // Stats-for-Nerds metrics (cheap counters; no per-frame allocations
  // beyond the fps ring).
  let fedBytes = 0;
  let fedChunks = 0;
  let fedKeyframes = 0;
  let painted = 0;
  let paintedWidth = 0;
  let paintedHeight = 0;
  const paintTimes: number[] = [];
  let lastPaintMs = 0;
  let avgGapMs = 0;
  let freezeCount = 0;
  let freezeDurationS = 0;
  let dropped = 0;
  let paintDelayS = 0;
  /** Channel-arrival time per fed chunk, keyed by media timestamp, so a
   *  painted frame can be charged its full in-page delay. */
  const arrivals = new Map<number, number>();
  const ARRIVALS_CAP = 512;

  const markPaint = (width: number, height: number) => {
    const now = performance.now();
    painted += 1;
    paintedWidth = width;
    paintedHeight = height;
    paintTimes.push(now);
    while (paintTimes.length > 0 && now - paintTimes[0]! > FPS_WINDOW_MS) {
      paintTimes.shift();
    }
    if (lastPaintMs > 0) {
      const gap = now - lastPaintMs;
      // Freeze, spec-flavoured: an inter-frame gap far above the running
      // average (and above human-visible stutter).
      if (avgGapMs > 0 && gap > Math.max(3 * avgGapMs, 150)) {
        freezeCount += 1;
        freezeDurationS += gap / 1000;
      }
      avgGapMs = avgGapMs === 0 ? gap : avgGapMs * 0.9 + gap * 0.1;
    }
    lastPaintMs = now;
    markContent();
  };

  const markContent = () => {
    if (!marked) {
      marked = true;
      onFirstFrame();
    }
  };

  const paintVideoFrame = (frame: VideoFrame) => {
    if (disposed) {
      frame.close();
      return;
    }
    // Stall backlog: skip to fresh frames instead of replaying it (the
    // decoder still consumed the chunk, so its reference chain is intact).
    const arrivedMs = arrivals.get(frame.timestamp);
    arrivals.delete(frame.timestamp);
    if (frame.timestamp + STALE_FRAME_US < newestFedTsUs) {
      frame.close();
      dropped += 1;
      markContent();
      return;
    }
    const ctx = paintTarget(frame.displayWidth, frame.displayHeight);
    ctx?.drawImage(frame, 0, 0);
    const { displayWidth, displayHeight } = frame;
    frame.close();
    // No canvas yet = the slot's tile mounts on first-content state (the
    // camera PiP); flip the state and drop the frame so it appears.
    if (ctx) {
      if (arrivedMs !== undefined) paintDelayS += (performance.now() - arrivedMs) / 1000;
      markPaint(displayWidth, displayHeight);
    } else {
      markContent();
    }
  };

  const newDecoder = (): VideoDecoder | null => {
    if (description === null) return null;
    // WebKit's WebCodecs decodes H.264 only in AVCC mode: the avcC record
    // is the `description`, and its bytes [1..4] are the exact
    // profile/compat/level for the codec string.
    const codec = `avc1.${[...description.subarray(1, 4)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .toUpperCase()}`;
    try {
      // Timed: WebKit builds its whole GStreamer decode pipeline on first
      // use, on this thread - in the worker that cost stays off the
      // window's main thread; on the fallback path this number is the
      // evidence when the first share freezes the window.
      const t0 = performance.now();
      const dec = new VideoDecoder({
        output: paintVideoFrame,
        error: (e) => {
          // A fatal error closes the decoder; rebuild on the next chunk
          // and resync on a fresh IDR.
          console.warn("[stream-view] VideoDecoder error:", e.message);
          decoder = null;
          needKey = true;
          requestKeyframe();
        },
      });
      dec.configure({ codec, description, optimizeForLatency: true });
      const tookMs = performance.now() - t0;
      // Unconditional: WebKit's first decoder pays the GStreamer
      // plugin-registry scan on the constructing thread; when a share
      // start freezes the page, whether this line printed (and how long
      // it took) is the first question.
      console.info(`[stream-view] decoder init took ${tookMs.toFixed(0)}ms (${codec})`);
      return dec;
    } catch (e) {
      console.warn(`[stream-view] VideoDecoder configure(${codec}) failed:`, e);
      return null;
    }
  };

  const feedChunk = (key: boolean, timestampUs: number, bytes: Uint8Array<ArrayBuffer>) => {
    decoder ??= newDecoder();
    if (decoder === null) {
      // No parameter sets yet (joined before the config message): ask for
      // an IDR, whose access unit carries them.
      dropped += 1;
      requestKeyframe();
      return;
    }
    if (key) {
      lastKeyFedMs = performance.now();
    } else if (lastKeyFedMs > 0 && performance.now() - lastKeyFedMs > KEY_DROUGHT_MS) {
      // Keyframe drought (see KEY_DROUGHT_MS): resync instead of feeding
      // reference-broken deltas forever.
      dropUntilKey = true;
    }
    if (!key && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      // Falling behind: skip to the next keyframe instead of queueing lag.
      dropUntilKey = true;
    }
    if ((needKey || dropUntilKey) && !key) {
      dropped += 1;
      requestKeyframe();
      return;
    }
    needKey = false;
    dropUntilKey = false;
    newestFedTsUs = Math.max(newestFedTsUs, timestampUs);
    // Bounded: a frame the decoder never returns (error, reset) would
    // otherwise leave its entry behind forever.
    if (arrivals.size >= ARRIVALS_CAP) arrivals.clear();
    arrivals.set(timestampUs, performance.now());
    try {
      decoder.decode(
        new EncodedVideoChunk({
          type: key ? "key" : "delta",
          timestamp: timestampUs,
          data: bytes,
        }),
      );
    } catch (e) {
      console.warn("[stream-view] decode() rejected chunk:", e);
      decoder = null;
      needKey = true;
      requestKeyframe();
    }
  };

  const feedJpeg = (bytes: Uint8Array<ArrayBuffer>) => {
    jpegSeq += 1;
    const seq = jpegSeq;
    const fedAtMs = performance.now();
    newestFedAtMs = fedAtMs;
    createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
      .then((bitmap) => {
        // Async decodes can finish out of order; newer wins. A bitmap fed
        // long before the newest one is stall backlog - skip it.
        if (disposed || seq <= jpegPainted || newestFedAtMs - fedAtMs > STALE_JPEG_MS) {
          bitmap.close();
          if (!disposed) {
            dropped += 1;
            markContent();
          }
          return;
        }
        jpegPainted = seq;
        const ctx = paintTarget(bitmap.width, bitmap.height);
        ctx?.drawImage(bitmap, 0, 0);
        const { width, height } = bitmap;
        bitmap.close();
        if (ctx) {
          paintDelayS += (performance.now() - fedAtMs) / 1000;
          markPaint(width, height);
        } else {
          markContent();
        }
      })
      .catch(() => {});
  };

  return {
    configure(avcc) {
      if (disposed) return;
      description = avcc;
      // New parameter sets invalidate the running decoder (resolution
      // change); the next chunk rebuilds it and resyncs on a keyframe.
      try {
        decoder?.close();
      } catch {
        /* already closed */
      }
      decoder = null;
      needKey = true;
    },
    feed(isH264, key, timestampUs, bytes) {
      if (disposed) return;
      fedBytes += bytes.byteLength;
      fedChunks += 1;
      if (key) fedKeyframes += 1;
      if (isH264) feedChunk(key, timestampUs, bytes);
      else feedJpeg(bytes);
    },
    metrics() {
      const now = performance.now();
      while (paintTimes.length > 0 && now - paintTimes[0]! > FPS_WINDOW_MS) {
        paintTimes.shift();
      }
      return {
        painted,
        fps: paintTimes.length / (FPS_WINDOW_MS / 1000),
        width: paintedWidth,
        height: paintedHeight,
        queue: decoder?.decodeQueueSize ?? 0,
        fedBytes,
        fedChunks,
        fedKeyframes,
        freezeCount,
        freezeDurationS,
        dropped,
        paintDelayS,
      };
    },
    dispose() {
      disposed = true;
      try {
        decoder?.close();
      } catch {
        /* already closed by an error */
      }
      decoder = null;
    },
  };
}

/** One parsed record of a channel batch. */
export interface BatchRecord {
  readonly mid: string;
  readonly keyframe: boolean;
  readonly isH264: boolean;
  readonly isConfig: boolean;
  readonly timestampUs: number;
  readonly bytes: Uint8Array<ArrayBuffer>;
}

/**
 * Walk the length-prefixed records of one channel batch (wire format in
 * nativeStreamView.ts's module doc). Returns the record count.
 */
export function forEachBatchRecord(buf: ArrayBuffer, each: (record: BatchRecord) => void): number {
  const view = new DataView(buf);
  let records = 0;
  let offset = 0;
  while (offset + 4 + HEADER_LEN <= buf.byteLength) {
    const recordLen = view.getUint32(offset, true);
    offset += 4;
    if (recordLen < HEADER_LEN || offset + recordLen > buf.byteLength) {
      console.warn("[stream-view] malformed batch record; dropping remainder");
      break;
    }
    records += 1;
    const flags = view.getUint8(offset + 1);
    each({
      mid: String(view.getUint8(offset)),
      keyframe: (flags & 1) !== 0,
      isH264: (flags & 2) !== 0,
      isConfig: (flags & 4) !== 0,
      timestampUs: Number(view.getBigUint64(offset + 6, true)),
      bytes: new Uint8Array(buf, offset + HEADER_LEN, recordLen - HEADER_LEN),
    });
    offset += recordLen;
  }
  return records;
}

/** Which slot a track paints into. */
export type SlotKind = "display" | "camera";

/**
 * Route a track to its slot. A camera goes to the camera slot only when a
 * screen track exists beside it. The camera slot is the PiP, and the PiP
 * is an *aside*: it mounts only next to a display track (`hasMedia &&
 * hasCameraMedia` in the viewer components), and the display canvas itself
 * stays hidden until the display slot paints. Routing a camera-ONLY share
 * to the PiP slot therefore decodes every frame against a canvas that can
 * never mount - `markContent` flips `hasCamera` and drops the frame "so
 * the tile appears", but the tile's other condition can never come true -
 * and the share is invisible to everyone, own preview and remote viewers
 * alike. The webview family binds a camera-only stream to the main
 * `<video>`, so the camera takes the display slot here too: a camera-only
 * share IS the main view.
 *
 * When a screen track joins later (share extended), the updated map moves
 * the camera to the PiP slot; the next IDR re-delivers its avcC to the new
 * slot (configs are rebuilt from in-band SPS/PPS), and the slot's
 * keyframe-request loop forces that IDR.
 *
 * Without a START announcement the first track is the display, the second
 * the camera.
 */
export function routeSlot(mid: string, contentMap: TrackContentMap): SlotKind {
  const content = contentMap[mid] ?? (mid === "0" ? "screen" : "camera");
  const aside = content === "camera" && Object.values(contentMap).includes("screen");
  return aside ? "camera" : "display";
}
