/**
 * Native (Rust-peer) stream viewing: the "native" viewer-strategy family.
 *
 * Distro WebKitGTK builds (Ubuntu's included) compile WebRTC out, so on
 * Linux the webview has no `RTCPeerConnection` and the normal viewer layer
 * (`startWatching` in useScreenShare) cannot exist. Where that is the case
 * ({@link WEBVIEW_HAS_RTC} false) the Rust side runs the SFU viewer peer
 * instead (`start_native_stream_view`) and streams the video payload over a
 * Tauri IPC channel. On Windows the same Rust route is available as an
 * opt-in alternative to the webview's WebRTC (the "Stream viewer backend"
 * switch in Settings -> Advanced).
 *
 * Delivery is chosen for maximum hardware use:
 *
 * - "h264" (preferred): Rust forwards the COMPRESSED access units (AVCC,
 *   with the stream's SPS/PPS arriving as an out-of-band avcC config
 *   message - WebKit's WebCodecs only decodes with a `description`, its
 *   Annex-B mode errors); they are decoded with `VideoDecoder` (WebKit's
 *   GStreamer backend - NVDEC/VA-API hardware where present) and painted
 *   as `VideoFrame`s onto a canvas composited on the GPU (Skia-GL).
 *   IPC carries exactly the stream bitrate; nobody transcodes anything.
 * - "jpeg" (fallback for webviews without WebCodecs): Rust decodes and
 *   sends JPEG frames, painted via `createImageBitmap` (async, off the
 *   main thread) onto the same canvas.
 *
 * Decode and paint run in a dedicated worker (nativeStreamViewWorker.ts,
 * painting via `OffscreenCanvas`) so they survive WebKit's page throttling
 * - an unfocused/occluded window used to freeze playback and replay it as
 * a fast-forward burst on refocus - and stay clear of main-thread
 * contention (React, chat, the video wallpaper). A webview without worker
 * OffscreenCanvas support falls back to decoding in-page; both paths share
 * their logic via nativeStreamCore.ts. Painting bypasses React entirely -
 * state flips once per slot when the first frame arrives (to drop
 * placeholders), never per frame.
 *
 * Windows (WebView2 = Chromium, full WebRTC) defaults to the webview
 * `<video>` viewer and only takes this path when the user selects the
 * native backend in the advanced settings.
 *
 * Channel wire format: each message is a BATCH of records (Rust coalesces
 * frames that arrive within ~20 ms of each other so a 60 fps stream costs
 * the GTK main thread a few evals/fetches per second, not sixty; a frame
 * after a quiet spell is delivered at once). Each record: `[recordLen u32 LE]`, then a 14-byte header
 * `[midIndex u8, flags u8, width u16 LE, height u16 LE, timestampUs u64 LE]`
 * and the payload (recordLen spans header + payload). flags bit 0 =
 * keyframe, bit 1 = H.264 (else JPEG), bit 2 = decoder config (payload is
 * the track's avcC record, not a frame). Parsing lives in
 * nativeStreamCore.ts (`forEachBatchRecord`).
 */
import { useEffect, useRef, useState } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useAppStore } from "@core/store";
import { getTrackContentMap } from "./trackContent";
import {
  EMPTY_SLOT_METRICS,
  forEachBatchRecord,
  makeSlot,
  routeSlot,
  type SlotKind,
  type SlotMetrics,
} from "./nativeStreamCore";
import type { StreamWorkerEvent, StreamWorkerRequest } from "./nativeStreamViewWorker";
import StreamViewWorker from "./nativeStreamViewWorker?worker";
import type { PlayoutState, StatsSample, VideoTrackStats } from "./StreamStatsPanel";
import { lastServerPingMs } from "./serverPing";
import { registerStreamViewerStrategy, StreamViewerStrategyId, type StatsSampler } from "./viewerStrategy";

// Singleton state (running viewers keyed per session, live IPC channels,
// the decode worker, the strategy registration): a hot-swap must reload
// the page like useScreenShare does, not strand stale decoders on dead
// instances.
if (import.meta.hot) {
  import.meta.hot.accept(() => {
    import.meta.hot!.invalidate();
  });
}

/** Whether this webview can run WebRTC viewers at all (see module doc). */
export const WEBVIEW_HAS_RTC = typeof RTCPeerConnection !== "undefined";

/** Whether this webview can decode H.264 itself (drives the delivery mode
 *  on the in-page fallback path; the worker reports its own capability). */
const WEBVIEW_HAS_WEBCODECS = typeof VideoDecoder === "function";

/** Serde values of `fancy_screenshare::viewer::DeliveryMode` - the payload
 *  kind `start_native_stream_view` streams (see the module doc). */
enum NativeDeliveryMode {
  H264 = "h264",
  Jpeg = "jpeg",
}

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

// ---------------------------------------------------------------------------
// Decode worker (singleton; sessions multiplex over it)
// ---------------------------------------------------------------------------

interface WorkerCaps {
  readonly h264: boolean;
  readonly jpeg: boolean;
}

/** Per-view receiver of worker events, registered while a view runs.
 *  Keyed by the unique view id, NOT the session: two viewports of the
 *  same broadcast are independent pipelines. */
interface WorkerViewHandlers {
  onFirstFrame(slot: SlotKind): void;
  onKeyframeRequest(): void;
  onMetrics(msg: Extract<StreamWorkerEvent, { type: "metrics" }>): void;
}

let decodeWorker: Worker | null = null;
let workerCapsPromise: Promise<WorkerCaps | null> | null = null;
const workerViews = new Map<number, WorkerViewHandlers>();
let nextWorkerViewId = 1;

/** Ids of canvases already transferred to the worker: an element can be
 *  transferred exactly once, then only re-BOUND to later sessions. */
const transferredCanvases = new WeakMap<HTMLCanvasElement, number>();
let nextCanvasId = 1;

function postToWorker(msg: StreamWorkerRequest, transfer?: Transferable[]) {
  decodeWorker?.postMessage(msg, transfer ?? []);
}

/** localStorage key that opts back IN to decoding in the worker.
 *
 *      localStorage.setItem("fancy.streamDecodeWorker", "on")
 *
 *  The worker exists for a real reason: decode and paint off the main thread
 *  is what stops WebKitGTK throttling playback in an unfocused window. It is
 *  nevertheless OFF by default, because on WebKitGTK it is actively
 *  destructive - measured on GNOME 50 / WebKitGTK 4.1 on 2026-08-30:
 *
 *  * Surfaces swap contents. Screen-share frames appear in the chat
 *    wallpaper and the wallpaper appears in the share - in BOTH directions,
 *    which no capture-side bug can produce; only the compositing side can.
 *  * `WebCore: Worker` segfaults take the whole web process down, and with
 *    it the entire UI: 15 in one day against zero in the three days before
 *    the worker landed.
 *  * Freezes: 274 (440 s) with the worker, 6 (1.3 s) without, same session
 *    length and same encoder.
 *
 *  Two things are tangled here and both need attention before this flips
 *  back. Ours: `bindCanvases` re-derives elements from React refs on every
 *  batch, while `transferredCanvases`/`nextCanvasId` are module-global
 *  across every view, so a remounted or reordered tile can bind a surface
 *  another view still owns. WebKit's: OffscreenCanvas plus `VideoDecoder`
 *  inside a worker scope is a lightly travelled path there, and the
 *  segfaults are inside libc under WebKit, not in our code.
 *
 *  Restoring this means fixing the binding lifecycle AND confirming the web
 *  process survives - the unfocused-window throttling it was written to
 *  cure is the lesser bug. */
const DECODE_WORKER_KEY = "fancy.streamDecodeWorker";

/** Whether the decode worker has been explicitly opted into. */
function decodeWorkerEnabled(): boolean {
  try {
    return localStorage.getItem(DECODE_WORKER_KEY) === "on";
  } catch {
    // Private mode / storage denied: keep the safe default.
    return false;
  }
}

/**
 * Spawn the decode worker (once) and resolve its capabilities; null means
 * no usable worker (spawn failed, handshake timed out, or the worker scope
 * lacks OffscreenCanvas) and views run the in-page fallback.
 */
function workerCapabilities(): Promise<WorkerCaps | null> {
  workerCapsPromise ??= new Promise((resolve) => {
    if (!decodeWorkerEnabled()) {
      console.info(
        `[stream-view] decoding in-page; set ${DECODE_WORKER_KEY}="on" to use the decode worker`,
      );
      resolve(null);
      return;
    }
    let worker: Worker;
    try {
      worker = new StreamViewWorker();
    } catch (e) {
      console.warn("[stream-view] decode worker unavailable, decoding in-page:", e);
      resolve(null);
      return;
    }
    const fail = (why: string) => {
      console.warn(`[stream-view] decode worker ${why}; decoding in-page`);
      worker.terminate();
      resolve(null);
    };
    const timeout = setTimeout(() => fail("handshake timed out"), 3000);
    worker.onerror = (e) => {
      clearTimeout(timeout);
      fail(`failed: ${e.message}`);
    };
    worker.onmessage = (e: MessageEvent<StreamWorkerEvent>) => {
      const msg = e.data;
      if (msg.type !== "ready") return;
      clearTimeout(timeout);
      if (!msg.h264 && !msg.jpeg) {
        fail("scope lacks OffscreenCanvas");
        return;
      }
      worker.onerror = (err) => {
        // Post-handshake errors: log them; running sessions keep their
        // state (a crashed worker surfaces as a stalled view, and the
        // existing keyframe/timeout machinery already reports that).
        console.error("[stream-view] decode worker error:", err.message);
      };
      worker.onmessage = (evt: MessageEvent<StreamWorkerEvent>) => {
        const event = evt.data;
        if (event.type === "ready") return;
        const handlers = workerViews.get(event.view);
        if (!handlers) return;
        if (event.type === "first-frame") handlers.onFirstFrame(event.slot);
        else if (event.type === "request-keyframe") handlers.onKeyframeRequest();
        else handlers.onMetrics(event);
      };
      decodeWorker = worker;
      resolve({ h264: msg.h264, jpeg: msg.jpeg });
    };
  });
  return workerCapsPromise;
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
    let teardown: (() => void) | null = null;

    const requestKeyframe = () => {
      const now = Date.now();
      if (disposed || now - lastKeyframeRequest < KEYFRAME_REQUEST_MS) return;
      lastKeyframeRequest = now;
      invoke("request_stream_keyframe", { session }).catch(() => {});
    };

    const setFirst = (slot: SlotKind) => (slot === "display" ? setHasDisplay : setHasCamera)(true);

    // Receive-side heartbeat, mirroring the Rust sink's sender-side one:
    // together they localise a stall (sent-but-not-received = IPC/channel;
    // received-but-not-painted = decoder; neither = peer). `read` pulls
    // from wherever the counters live (worker snapshot or local slots).
    const heartbeat = (read: () => { rx: number; rxBytes: number; display: SlotMetrics }) =>
      setInterval(() => {
        const { rx, rxBytes, display } = read();
        console.info(
          `[stream-view] session=${session} rx=${rx}` +
            ` rxMB=${(rxBytes / 1e6).toFixed(1)}` +
            ` painted=${display.painted} fps=${display.fps.toFixed(1)}` +
            ` queue=${display.queue} freezes=${display.freezeCount}`,
        );
      }, 5000);

    /** Worker path: batches are transferred to the decode worker; this
     *  side only flips tile state, rate-limits PLIs and mirrors metrics. */
    const wireWorker = (channel: Channel<ArrayBuffer>) => {
      const view = nextWorkerViewId++;
      let latest = { display: EMPTY_SLOT_METRICS, camera: EMPTY_SLOT_METRICS, rx: 0, rxBytes: 0 };
      workerViews.set(view, {
        onFirstFrame: setFirst,
        onKeyframeRequest: requestKeyframe,
        onMetrics: (m) => {
          latest = { display: m.display, camera: m.camera, rx: m.received, rxBytes: m.receivedBytes };
        },
      });
      sessionMetrics.set(session, () => ({ display: latest.display, camera: latest.camera }));
      postToWorker({ type: "start", view, session });

      // A canvas element can be transferred exactly once, ever; later
      // sessions on the same element re-BIND its worker-side surface.
      // Tiles mount on first-content state, so refs may fill in late -
      // retried per batch until both slots are bound.
      const bound: { display: number | null; camera: number | null } = {
        display: null,
        camera: null,
      };
      const bindCanvases = () => {
        for (const slot of ["display", "camera"] as const) {
          const el = canvases.current[slot].current;
          if (!el) continue;
          let id = transferredCanvases.get(el);
          if (id === undefined) {
            try {
              const off = el.transferControlToOffscreen();
              id = nextCanvasId++;
              transferredCanvases.set(el, id);
              postToWorker({ type: "canvas", id, canvas: off }, [off]);
            } catch (e) {
              // Already consumed by a 2d context (in-page fallback ran on
              // this element earlier). Unrecoverable for this element;
              // remember that so the warning fires once.
              transferredCanvases.set(el, -1);
              console.warn("[stream-view] canvas not transferable to decode worker:", e);
              continue;
            }
          }
          if (id !== -1 && bound[slot] !== id) {
            bound[slot] = id;
            postToWorker({ type: "bind", view, slot, canvasId: id });
          }
        }
      };
      bindCanvases();

      channel.onmessage = (buf) => {
        if (disposed || !(buf instanceof ArrayBuffer)) return;
        bindCanvases();
        postToWorker(
          { type: "batch", view, buf, contentMap: getTrackContentMap(session) },
          [buf],
        );
      };

      const diagnostics = heartbeat(() => ({
        rx: latest.rx,
        rxBytes: latest.rxBytes,
        display: latest.display,
      }));
      return () => {
        clearInterval(diagnostics);
        workerViews.delete(view);
        postToWorker({ type: "stop", view });
      };
    };

    /** In-page fallback: the pre-worker pipeline, for webviews without
     *  worker OffscreenCanvas. Subject to page throttling by nature. */
    const wireInPage = (channel: Channel<ArrayBuffer>) => {
      const slotTarget = (ref: React.RefObject<HTMLCanvasElement | null>) => (w: number, h: number) => {
        const canvas = ref.current;
        if (!canvas) return null;
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w;
          canvas.height = h;
        }
        return canvas.getContext("2d");
      };
      const slots = {
        display: makeSlot(slotTarget(canvases.current.display), () => setHasDisplay(true), requestKeyframe),
        camera: makeSlot(slotTarget(canvases.current.camera), () => setHasCamera(true), requestKeyframe),
      };
      sessionMetrics.set(session, () => ({
        display: slots.display.metrics(),
        camera: slots.camera.metrics(),
      }));

      let received = 0;
      let receivedBytes = 0;
      channel.onmessage = (buf) => {
        if (disposed || !(buf instanceof ArrayBuffer)) return;
        receivedBytes += buf.byteLength;
        const contentMap = getTrackContentMap(session);
        received += forEachBatchRecord(buf, (record) => {
          const slot = slots[routeSlot(record.mid, contentMap)];
          if (record.isConfig) slot.configure(record.bytes);
          else slot.feed(record.isH264, record.keyframe, record.timestampUs, record.bytes);
        });
      };

      const diagnostics = heartbeat(() => ({
        rx: received,
        rxBytes: receivedBytes,
        display: slots.display.metrics(),
      }));
      return () => {
        clearInterval(diagnostics);
        slots.display.dispose();
        slots.camera.dispose();
      };
    };

    // Async setup: the worker handshake resolves in milliseconds (and only
    // once per page); the channel stays silent until the invoke below.
    (async () => {
      const caps = await workerCapabilities();
      if (disposed) return;
      const channel = new Channel<ArrayBuffer>();
      let mode: NativeDeliveryMode;
      if (caps) {
        mode = caps.h264 ? NativeDeliveryMode.H264 : NativeDeliveryMode.Jpeg;
        teardown = wireWorker(channel);
      } else {
        mode = WEBVIEW_HAS_WEBCODECS ? NativeDeliveryMode.H264 : NativeDeliveryMode.Jpeg;
        teardown = wireInPage(channel);
      }
      const serverId = useAppStore.getState().activeServerId;
      invoke("start_native_stream_view", {
        session,
        serverId,
        mode,
        onFrame: channel,
      }).catch((e) => {
        console.error("[stream-view] start_native_stream_view failed:", e);
        if (!disposed) setFailed(true);
      });
    })();

    return () => {
      disposed = true;
      teardown?.();
      sessionMetrics.delete(session);
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
  readonly audio: {
    readonly packetsReceived: number;
    readonly bytesReceived: number;
  } | null;
  readonly videos: readonly {
    readonly mid: string;
    readonly ssrc: number;
    readonly packetsReceived: number;
    readonly bytesReceived: number;
    readonly packetsLost: number;
    readonly jitterMs: number | null;
    readonly nackCount: number;
    readonly pliCount: number;
  }[];
}

/** Stats sampler over the native peer + the viewport's decode metrics
 *  (factory product of the native strategy; per open panel). */
/** The RTT to report, and where it came from (see `serverPing`). */
function rtt(iceRttMs: number | null): { rttMs: number | null; rttSource: "server-ping" | null } {
  if (iceRttMs !== null && iceRttMs > 0) return { rttMs: iceRttMs, rttSource: null };
  const ping = lastServerPingMs();
  return ping === null ? { rttMs: null, rttSource: null } : { rttMs: ping, rttSource: "server-ping" };
}

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

      // What the shared desktop audio is doing, if the broadcast carries
      // any: the voice mixer plays it out, so it has a real jitter buffer
      // to report where the video path has none.
      let playout: PlayoutState = { kind: "none" };
      try {
        const audio = await invoke<{
          targetMs: number;
          floorMs: number;
          bufferedMs: number;
        } | null>("native_stream_audio_playout", { session });
        if (audio) playout = { kind: "buffer", ...audio };
      } catch {
        /* the command is Linux-only; "none" is the right answer elsewhere */
      }

      const contentMap = getTrackContentMap(session);
      const codecLabel = WEBVIEW_HAS_WEBCODECS ? "H264 (WebCodecs)" : "H264 → JPEG (Rust)";
      const videos: VideoTrackStats[] = (rust?.videos ?? []).map((v) => {
        // Slot attribution mirrors the frame routing (nativeStreamCore's
        // routeSlot): a camera-only share paints in the display slot, so
        // reading `metrics.camera` for it would report an idle slot for a
        // track that is decoding fine.
        const m = routeSlot(v.mid, contentMap) === "camera" ? metrics?.camera : metrics?.display;
        return {
          mid: v.mid,
          frameWidth: m && m.width > 0 ? m.width : null,
          frameHeight: m && m.height > 0 ? m.height : null,
          framesPerSecond: m?.fps ?? null,
          framesDecoded: m?.painted ?? 0,
          framesDropped: m?.dropped ?? 0,
          freezeCount: m?.freezeCount ?? 0,
          totalFreezesDurationS: m?.freezeDurationS ?? 0,
          packetsReceived: v.packetsReceived,
          packetsLost: v.packetsLost,
          jitterMs: v.jitterMs,
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
        framesDropped: videos.reduce((sum, v) => sum + v.framesDropped, 0),
        freezeCount: first?.freezeCount ?? 0,
        totalFreezesDurationS: first?.totalFreezesDurationS ?? 0,
        // Prefer the wire truth (RTP bytes); fall back to channel bytes.
        bytesReceived: rustBytes > 0 ? rustBytes : jsBytes,
        packetsReceived: videos.reduce((sum, v) => sum + v.packetsReceived, 0),
        packetsLost: videos.reduce((sum, v) => sum + v.packetsLost, 0),
        jitterMs: first?.jitterMs ?? null,
        // The native Rust viewer has no jitter buffer; what stands in its
        // place is the in-page delay from channel arrival to paint (decode
        // queue + the decoder's own hold), summed over painted frames the
        // way the spec counter is. Target and floor stay 0: nothing here
        // asks for delay, so the panel's "floor" reads as the truth.
        jitterBufferDelay: metrics ? metrics.display.paintDelayS + metrics.camera.paintDelayS : 0,
        jitterBufferEmittedCount: metrics ? metrics.display.painted + metrics.camera.painted : 0,
        jitterBufferTargetDelay: 0,
        jitterBufferMinimumDelay: 0,
        videoCodec: first?.videoCodec ?? codecLabel,
        audioCodec: null,
        ...rtt(rust?.rttMs ?? null),
        icePath: rust?.icePath ?? null,
        playout,
        audioPacketsReceived: rust?.audio?.packetsReceived ?? null,
        videos,
      };
      return { sample, connectionState: rust?.connectionState ?? "unknown" };
    },
  };
}

// The native family: a Rust peer per session (Rust-side signaling), the
// webview only decoding (WebCodecs) and painting. The default wherever the
// webview lacks WebRTC; on Windows it is selectable via the Settings ->
// Advanced backend switch (persisted through viewerStrategy.ts). Concrete
// factory: viewports own their receive-path lifecycle on mount/unmount, so
// the transport product is a coherent no-op - there is no pre-connect
// outside them.
registerStreamViewerStrategy({
  id: StreamViewerStrategyId.Native,
  // The backing commands (start/stop/stats/keyframe) and the Rust viewer
  // compile on Linux and Windows. Android's webview UA also claims "Linux",
  // but its commands are stubs - keep it excluded.
  isAvailable: () =>
    /windows nt/i.test(navigator.userAgent) ||
    (/linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent)),
  createReceiveTransport: () => ({
    open: async () => {},
    isOpen: () => false,
    close: () => {},
  }),
  createStatsSampler: createNativeStatsSampler,
});

// NOTE: no synchronous codec "warmup" here. WebKitGTK runs the first
// WebCodecs call's GStreamer plugin-registry scan on the CALLING thread
// (~3s). On the worker path that thread is the decode worker's, so the
// window stays responsive; only the in-page fallback still pays it on the
// main thread, behind the "Setting up stream..." overlay, where the timing
// log in nativeStreamCore's newDecoder surfaces it.
