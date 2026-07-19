/**
 * Native (Rust-peer) stream viewing for webviews without WebRTC.
 *
 * Distro WebKitGTK builds (Ubuntu's included) compile WebRTC out, so on
 * Linux the webview has no `RTCPeerConnection` and the normal viewer layer
 * (`startWatching` in useScreenShare) cannot exist. Where that is the case
 * ({@link WEBVIEW_HAS_RTC} false) the Rust side runs the SFU viewer peer
 * instead (`start_native_stream_view`) and streams the video payload over a
 * Tauri IPC channel.
 *
 * Delivery is chosen for maximum hardware use:
 *
 * - "h264" (preferred): Rust forwards the COMPRESSED access units (AVCC,
 *   with the stream's SPS/PPS arriving as an out-of-band avcC config
 *   message - WebKit's WebCodecs only decodes with a `description`, its
 *   Annex-B mode errors); this hook decodes them with `VideoDecoder`
 *   (WebKit's GStreamer backend - NVDEC/VA-API hardware where present) and
 *   paints `VideoFrame`s onto a canvas composited on the GPU (Skia-GL).
 *   IPC carries exactly the stream bitrate; nobody transcodes anything.
 * - "jpeg" (fallback for webviews without WebCodecs): Rust decodes and
 *   sends JPEG frames, painted via `createImageBitmap` (async, off the
 *   main thread) onto the same canvas.
 *
 * Painting bypasses React entirely - state flips once per slot when the
 * first frame arrives (to drop placeholders), never per frame.
 *
 * Windows (WebView2 = Chromium, full WebRTC) never takes any of this - the
 * webview `<video>` viewer stays exactly as it is.
 *
 * Channel wire format: each message is a BATCH of records (Rust coalesces
 * ~50 ms per message so the GTK main thread pays one eval/fetch per batch,
 * not per frame). Each record: `[recordLen u32 LE]`, then a 14-byte header
 * `[midIndex u8, flags u8, width u16 LE, height u16 LE, timestampUs u64 LE]`
 * and the payload (recordLen spans header + payload). flags bit 0 =
 * keyframe, bit 1 = H.264 (else JPEG), bit 2 = decoder config (payload is
 * the track's avcC record, not a frame).
 */
import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useAppStore } from "../../../store";
import { getTrackContentMap } from "./trackContent";
import type { StatsSample, VideoTrackStats } from "./StreamStatsPanel";
import { registerStreamViewerStrategy, type StatsSampler } from "./viewerStrategy";

// Singleton state (running viewers keyed per session, live IPC channels,
// the strategy registration): a hot-swap must reload the page like
// useScreenShare does, not strand stale decoders on dead instances.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

/** Whether this webview can run WebRTC viewers at all (see module doc). */
export const WEBVIEW_HAS_RTC = typeof RTCPeerConnection !== "undefined";

/** Whether this webview can decode H.264 itself (drives the delivery mode). */
const WEBVIEW_HAS_WEBCODECS = typeof VideoDecoder === "function";

const HEADER_LEN = 14;

/** Above this decode backlog, delta chunks are dropped until the next
 *  keyframe (catch-up instead of runaway latency on a slow decoder). */
const MAX_DECODE_QUEUE = 30;

/** Minimum spacing of keyframe (PLI) requests per view. */
const KEYFRAME_REQUEST_MS = 1000;

/** What the panel needs to know; frames go straight to the canvases. */
export interface NativeStreamState {
  /** A display (screen/window) frame has been painted. */
  readonly hasDisplay: boolean;
  /** A camera frame has been painted (PiP visible). */
  readonly hasCamera: boolean;
  /** The viewer failed to start (or its start was rejected). */
  readonly failed: boolean;
}

/** Sliding window for the painted-fps estimate. */
const FPS_WINDOW_MS = 2000;

/** JS-side decode/paint metrics of one slot, for the stats sampler. */
export interface SlotMetrics {
  /** Frames painted (cumulative). */
  readonly painted: number;
  /** Painted frames per second over the last {@link FPS_WINDOW_MS}. */
  readonly fps: number;
  /** Canvas (frame) dimensions; 0 before the first paint. */
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
}

/** One canvas-painting sink for one track slot (display or camera). */
interface Slot {
  /** (Re)configure the H.264 decoder from an avcC record. */
  configure(avcc: Uint8Array<ArrayBuffer>): void;
  feed(isH264: boolean, key: boolean, timestampUs: number, bytes: Uint8Array<ArrayBuffer>): void;
  metrics(): SlotMetrics;
  dispose(): void;
}

function makeSlot(
  canvasRef: React.RefObject<HTMLCanvasElement | null>,
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
  // Stats-for-Nerds metrics (cheap counters; no per-frame allocations
  // beyond the fps ring).
  let fedBytes = 0;
  let fedChunks = 0;
  let fedKeyframes = 0;
  let painted = 0;
  const paintTimes: number[] = [];
  let lastPaintMs = 0;
  let avgGapMs = 0;
  let freezeCount = 0;
  let freezeDurationS = 0;

  const markPaint = () => {
    const now = performance.now();
    painted += 1;
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

  const paintTarget = (width: number, height: number): CanvasRenderingContext2D | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return canvas.getContext("2d");
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
    const ctx = paintTarget(frame.displayWidth, frame.displayHeight);
    ctx?.drawImage(frame, 0, 0);
    frame.close();
    // No canvas yet = the slot's tile mounts on first-content state (the
    // camera PiP); flip the state and drop the frame so it appears.
    if (ctx) markPaint();
    else markContent();
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
      // use, on this (main) thread - if the first share freezes the window,
      // this number is the evidence.
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
      if (tookMs > 50) {
        console.info(`[stream-view] decoder init took ${tookMs.toFixed(0)}ms (${codec})`);
      }
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
      requestKeyframe();
      return;
    }
    if (!key && decoder.decodeQueueSize > MAX_DECODE_QUEUE) {
      // Falling behind: skip to the next keyframe instead of queueing lag.
      dropUntilKey = true;
    }
    if ((needKey || dropUntilKey) && !key) {
      requestKeyframe();
      return;
    }
    needKey = false;
    dropUntilKey = false;
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
    createImageBitmap(new Blob([bytes], { type: "image/jpeg" }))
      .then((bitmap) => {
        // Async decodes can finish out of order; newer wins.
        if (disposed || seq <= jpegPainted) {
          bitmap.close();
          return;
        }
        jpegPainted = seq;
        const ctx = paintTarget(bitmap.width, bitmap.height);
        ctx?.drawImage(bitmap, 0, 0);
        bitmap.close();
        if (ctx) markPaint();
        else markContent();
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
        width: canvasRef.current?.width ?? 0,
        height: canvasRef.current?.height ?? 0,
        queue: decoder?.decodeQueueSize ?? 0,
        fedBytes,
        fedChunks,
        fedKeyframes,
        freezeCount,
        freezeDurationS,
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

/** JS-side metrics of mounted native viewports, keyed by broadcaster
 *  session - the stats sampler reads them without reaching into hooks. */
const sessionMetrics = new Map<number, () => { display: SlotMetrics; camera: SlotMetrics }>();

/**
 * Drive the native viewer for `session` while `active`, painting frames
 * into the given canvases. Returns placeholder/PiP visibility state.
 */
export function useNativeStreamView(
  session: number,
  active: boolean,
  displayCanvasRef: React.RefObject<HTMLCanvasElement | null>,
  cameraCanvasRef: React.RefObject<HTMLCanvasElement | null>,
): NativeStreamState {
  const [hasDisplay, setHasDisplay] = useState(false);
  const [hasCamera, setHasCamera] = useState(false);
  const [failed, setFailed] = useState(false);
  // Refs are stable across renders; keep the effect keyed on session/active.
  const canvases = useRef({ display: displayCanvasRef, camera: cameraCanvasRef });
  canvases.current = { display: displayCanvasRef, camera: cameraCanvasRef };

  useEffect(() => {
    if (!active || session <= 0) return;
    let disposed = false;
    let lastKeyframeRequest = 0;

    const requestKeyframe = () => {
      const now = Date.now();
      if (disposed || now - lastKeyframeRequest < KEYFRAME_REQUEST_MS) return;
      lastKeyframeRequest = now;
      invoke("request_stream_keyframe", { session }).catch(() => {});
    };

    const slots = {
      display: makeSlot(canvases.current.display, () => setHasDisplay(true), requestKeyframe),
      camera: makeSlot(canvases.current.camera, () => setHasCamera(true), requestKeyframe),
    };
    sessionMetrics.set(session, () => ({
      display: slots.display.metrics(),
      camera: slots.camera.metrics(),
    }));

    // Receive-side heartbeat, mirroring the Rust sink's sender-side one:
    // together they localise a stall (sent-but-not-received = IPC/channel;
    // received-but-not-painted = decoder; neither = peer).
    let received = 0;
    let receivedBytes = 0;
    const diagnostics = setInterval(() => {
      const m = sessionMetrics.get(session)?.();
      const d = m?.display;
      console.info(
        `[stream-view] session=${session} rx=${received}` +
          ` rxMB=${(receivedBytes / 1e6).toFixed(1)}` +
          ` painted=${d?.painted ?? 0} fps=${(d?.fps ?? 0).toFixed(1)}` +
          ` queue=${d?.queue ?? 0} freezes=${d?.freezeCount ?? 0}`,
      );
    }, 5000);

    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buf) => {
      if (disposed || !(buf instanceof ArrayBuffer)) return;
      receivedBytes += buf.byteLength;
      // Each message batches length-prefixed records (Rust coalesces up to
      // ~50 ms per message - one eval/fetch round-trip instead of one per
      // frame, which used to saturate the GTK main thread).
      const view = new DataView(buf);
      let offset = 0;
      while (offset + 4 + HEADER_LEN <= buf.byteLength) {
        const recordLen = view.getUint32(offset, true);
        offset += 4;
        if (recordLen < HEADER_LEN || offset + recordLen > buf.byteLength) {
          console.warn("[stream-view] malformed batch record; dropping remainder");
          break;
        }
        received += 1;
        const mid = String(view.getUint8(offset));
        const flags = view.getUint8(offset + 1);
        const keyframe = (flags & 1) !== 0;
        const isH264 = (flags & 2) !== 0;
        const isConfig = (flags & 4) !== 0;
        const timestampUs = Number(view.getBigUint64(offset + 6, true));
        const bytes = new Uint8Array(buf, offset + HEADER_LEN, recordLen - HEADER_LEN);
        // The START announcement says what each mid carries; without one
        // the first track is the display, the second the camera.
        const content = getTrackContentMap(session)[mid] ?? (mid === "0" ? "screen" : "camera");
        const slot = content === "camera" ? slots.camera : slots.display;
        if (isConfig) slot.configure(bytes);
        else slot.feed(isH264, keyframe, timestampUs, bytes);
        offset += recordLen;
      }
    };

    const serverId = useAppStore.getState().activeServerId;
    invoke("start_native_stream_view", {
      session,
      serverId,
      mode: WEBVIEW_HAS_WEBCODECS ? "h264" : "jpeg",
      onFrame: channel,
    }).catch((e) => {
      console.error("[stream-view] start_native_stream_view failed:", e);
      if (!disposed) setFailed(true);
    });

    return () => {
      disposed = true;
      clearInterval(diagnostics);
      sessionMetrics.delete(session);
      slots.display.dispose();
      slots.camera.dispose();
      invoke("stop_native_stream_view", { session }).catch(() => {});
      setHasDisplay(false);
      setHasCamera(false);
      setFailed(false);
    };
  }, [session, active]);

  return { hasDisplay, hasCamera, failed };
}

// ---------------------------------------------------------------------------
// Viewer-strategy registration (native family)
// ---------------------------------------------------------------------------

/** Rust-side stats of the native viewer peer (serde camelCase mirror of
 *  `fancy_screenshare::viewer::ViewerStats`). */
interface NativeViewerRustStats {
  readonly connectionState: string;
  readonly rttMs: number | null;
  readonly icePath: string | null;
  readonly videos: readonly {
    readonly mid: string;
    readonly ssrc: number;
    readonly packetsReceived: number;
    readonly bytesReceived: number;
    readonly nackCount: number;
    readonly pliCount: number;
  }[];
}

/** Stats sampler over the native peer + the viewport's decode metrics
 *  (factory product of the native strategy; per open panel). */
function createNativeStatsSampler(session: number): StatsSampler {
  return {
    async sample() {
      let rust: NativeViewerRustStats | null = null;
      try {
        rust = await invoke<NativeViewerRustStats | null>("native_stream_view_stats", { session });
      } catch {
        rust = null; // viewer gone (or platform stub)
      }
      const metrics = sessionMetrics.get(session)?.();
      if (!rust && !metrics) return null;

      const contentMap = getTrackContentMap(session);
      const codecLabel = WEBVIEW_HAS_WEBCODECS ? "H264 (WebCodecs)" : "H264 → JPEG (Rust)";
      const videos: VideoTrackStats[] = (rust?.videos ?? []).map((v) => {
        const content = contentMap[v.mid] ?? (v.mid === "0" ? "screen" : "camera");
        const m = content === "camera" ? metrics?.camera : metrics?.display;
        return {
          mid: v.mid,
          frameWidth: m && m.width > 0 ? m.width : null,
          frameHeight: m && m.height > 0 ? m.height : null,
          framesPerSecond: m?.fps ?? null,
          framesDecoded: m?.painted ?? 0,
          framesDropped: 0,
          freezeCount: m?.freezeCount ?? 0,
          totalFreezesDurationS: m?.freezeDurationS ?? 0,
          packetsReceived: v.packetsReceived,
          packetsLost: 0, // webrtc-rs exposes no receive-side loss counter
          jitterMs: null,
          videoCodec: codecLabel,
          decoderImplementation:
            `${WEBVIEW_HAS_WEBCODECS ? "VideoDecoder" : "ImageBitmap"}` +
            ` · queue ${m?.queue ?? 0} · pli ${v.pliCount} · nack ${v.nackCount}`,
          powerEfficient: null,
          totalDecodeTimeS: 0,
        };
      });

      const first = videos[0] ?? null;
      const jsBytes = metrics ? metrics.display.fedBytes + metrics.camera.fedBytes : 0;
      const rustBytes = (rust?.videos ?? []).reduce((sum, v) => sum + v.bytesReceived, 0);
      const sample: StatsSample = {
        timestampMs: performance.now(),
        frameWidth: first?.frameWidth ?? null,
        frameHeight: first?.frameHeight ?? null,
        framesPerSecond: first?.framesPerSecond ?? null,
        framesDecoded: first?.framesDecoded ?? 0,
        framesDropped: 0,
        freezeCount: first?.freezeCount ?? 0,
        totalFreezesDurationS: first?.totalFreezesDurationS ?? 0,
        // Prefer the wire truth (RTP bytes); fall back to channel bytes.
        bytesReceived: rustBytes > 0 ? rustBytes : jsBytes,
        packetsReceived: videos.reduce((sum, v) => sum + v.packetsReceived, 0),
        packetsLost: 0,
        jitterMs: null,
        jitterBufferDelay: 0,
        jitterBufferEmittedCount: 0,
        videoCodec: first?.videoCodec ?? codecLabel,
        audioCodec: null,
        rttMs: rust?.rttMs ?? null,
        icePath: rust?.icePath ?? null,
        videos,
      };
      return { sample, connectionState: rust?.connectionState ?? "unknown" };
    },
  };
}

// The native family: a Rust peer per session, the webview only decoding
// (WebCodecs) and painting. The default wherever the webview lacks WebRTC;
// the runtime flag in viewerStrategy.ts can force it elsewhere once the
// backend compiles there.
registerStreamViewerStrategy({
  id: "native",
  // The backing commands (start/stop/stats/keyframe) and the Rust viewer
  // are compiled for Linux only today.
  isAvailable: () => /linux/i.test(navigator.userAgent),
  // Native viewports own their receive-path lifecycle on mount/unmount;
  // there is no pre-connect outside them.
  watch: async () => {},
  isWatching: () => false,
  unwatch: () => {},
  createStatsSampler: createNativeStatsSampler,
});

// Warm WebKit's codec stack off the critical path: the first WebCodecs use
// in a session scans the GStreamer plugin registry and probes decoders ON
// THE MAIN THREAD, which surfaced as the whole window freezing at "Setting
// up stream..." on the session's first share. Doing the probe shortly after
// load moves that cost to idle app startup. (Timing log in newDecoder
// verifies whether any residual first-share cost remains.)
if (WEBVIEW_HAS_WEBCODECS) {
  setTimeout(() => {
    const t0 = performance.now();
    void VideoDecoder.isConfigSupported({ codec: "avc1.42E01E" })
      .then(() => {
        const tookMs = performance.now() - t0;
        if (tookMs > 50) {
          console.info(`[stream-view] codec warmup took ${tookMs.toFixed(0)}ms`);
        }
      })
      .catch(() => {});
  }, 1500);
}
