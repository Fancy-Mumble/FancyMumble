/**
 * Decode/paint worker of the native stream viewer.
 *
 * WHY A WORKER: WebKitGTK ties the page's task servicing to window state -
 * an unfocused or occluded window is throttled and eventually suspended -
 * and even focused, the main thread is shared with React, chat and the
 * (paint-hungry) video wallpaper. Decoding and painting there means
 * decoder outputs queue during any stall and replay as a fast-forward
 * burst afterwards; observed as fps collapsing to 0 with rx still
 * climbing, a PLI storm, and a catch-up sprint on refocus. Worker event
 * loops are exempt from page visibility throttling, so the whole receive
 * path - batch parsing, WebCodecs decode, canvas paint - lives here,
 * painting onto `OffscreenCanvas`es transferred from the tiles' canvases.
 * As a bonus this moves WebKit's multi-second first-use GStreamer plugin
 * scan (decoder construction) off the window's main thread.
 *
 * The main thread keeps what must stay there: the Tauri IPC channel (its
 * per-batch work is one zero-copy `postMessage` transfer), the
 * `request_stream_keyframe` invoke, and React state flips - all driven by
 * the messages defined below.
 */
import {
  forEachBatchRecord,
  makeSlot,
  routeSlot,
  type Slot,
  type SlotKind,
  type SlotMetrics,
} from "./nativeStreamCore";
import type { TrackContentMap } from "./trackContent";

/** Messages the main thread sends the worker. */
export type StreamWorkerRequest =
  /** A canvas surface, transferred once per canvas element for its life. */
  | { readonly type: "canvas"; readonly id: number; readonly canvas: OffscreenCanvas }
  /** Begin decoding for one mounted view. `view` is a unique id per
   *  mounted viewport, NOT the broadcaster session: two viewports of the
   *  SAME session (own preview + a tile, a popout) are independent
   *  pipelines, exactly as they were when decoding ran in-page - keying by
   *  session made the second mount dispose the first's decoders while
   *  both channels kept feeding. */
  | { readonly type: "start"; readonly view: number; readonly session: number }
  /** Point a view's slot at a transferred canvas (re-bindable: the same
   *  canvas element - transferable only ONCE - may serve later views). */
  | {
      readonly type: "bind";
      readonly view: number;
      readonly slot: SlotKind;
      readonly canvasId: number;
    }
  /** One channel batch (buffer transferred) plus the CURRENT track content
   *  map - routing follows the map as START announcements update it. */
  | {
      readonly type: "batch";
      readonly view: number;
      readonly buf: ArrayBuffer;
      readonly contentMap: TrackContentMap;
    }
  /** Tear down a view's slots (decoders closed). */
  | { readonly type: "stop"; readonly view: number };

/** Messages the worker sends the main thread. */
export type StreamWorkerEvent =
  /** Capability handshake, posted once on startup. */
  | { readonly type: "ready"; readonly h264: boolean; readonly jpeg: boolean }
  /** A slot painted (or received) its first frame - mount its tile. */
  | { readonly type: "first-frame"; readonly view: number; readonly slot: SlotKind }
  /** A slot needs an IDR (the invoke lives on the main thread). */
  | { readonly type: "request-keyframe"; readonly view: number }
  /** Periodic per-view metrics snapshot for the stats sampler. */
  | {
      readonly type: "metrics";
      readonly view: number;
      readonly display: SlotMetrics;
      readonly camera: SlotMetrics;
      readonly received: number;
      readonly receivedBytes: number;
    };

// The app tsconfig compiles against the DOM lib, under which `self` types
// as Window; this is the worker-runtime shape actually present.
const port = self as unknown as {
  onmessage: ((e: MessageEvent<StreamWorkerRequest>) => void) | null;
  postMessage(message: StreamWorkerEvent): void;
};

/** Transferred canvases by id, outliving views (see "bind" above). */
const canvases = new Map<number, OffscreenCanvas>();

interface View {
  readonly display: Slot;
  readonly camera: Slot;
  readonly canvasIds: { display: number | null; camera: number | null };
  received: number;
  receivedBytes: number;
}

const views = new Map<number, View>();

function makeView(view: number): View {
  const canvasIds: View["canvasIds"] = { display: null, camera: null };
  const slotFor = (slot: SlotKind): Slot =>
    makeSlot(
      (width, height) => {
        const id = canvasIds[slot];
        const canvas = id === null ? undefined : canvases.get(id);
        if (!canvas) return null;
        if (canvas.width !== width || canvas.height !== height) {
          canvas.width = width;
          canvas.height = height;
        }
        return canvas.getContext("2d");
      },
      () => port.postMessage({ type: "first-frame", view, slot }),
      () => port.postMessage({ type: "request-keyframe", view }),
    );
  return {
    display: slotFor("display"),
    camera: slotFor("camera"),
    canvasIds,
    received: 0,
    receivedBytes: 0,
  };
}

port.onmessage = (e) => {
  const msg = e.data;
  switch (msg.type) {
    case "canvas":
      canvases.set(msg.id, msg.canvas);
      break;
    case "start":
      // Trace unconditionally: when the page freezes at share start, the
      // presence/absence of this line localises where JS stopped.
      console.info(`[stream-view] decode worker: view ${msg.view} started (session ${msg.session})`);
      views.get(msg.view)?.display.dispose();
      views.get(msg.view)?.camera.dispose();
      views.set(msg.view, makeView(msg.view));
      break;
    case "bind": {
      const view = views.get(msg.view);
      if (view) view.canvasIds[msg.slot] = msg.canvasId;
      break;
    }
    case "batch": {
      const view = views.get(msg.view);
      if (!view) break;
      view.receivedBytes += msg.buf.byteLength;
      view.received += forEachBatchRecord(msg.buf, (record) => {
        const slot = view[routeSlot(record.mid, msg.contentMap)];
        if (record.isConfig) slot.configure(record.bytes);
        else slot.feed(record.isH264, record.keyframe, record.timestampUs, record.bytes);
      });
      break;
    }
    case "stop": {
      const view = views.get(msg.view);
      view?.display.dispose();
      view?.camera.dispose();
      views.delete(msg.view);
      break;
    }
  }
};

// Metrics push: worker timers are not visibility-throttled, so this keeps
// honest even while the window's own intervals are suspended.
setInterval(() => {
  for (const [id, view] of views) {
    port.postMessage({
      type: "metrics",
      view: id,
      display: view.display.metrics(),
      camera: view.camera.metrics(),
      received: view.received,
      receivedBytes: view.receivedBytes,
    });
  }
}, 1000);

// Capability handshake: everything here needs OffscreenCanvas; H.264 mode
// additionally needs WebCodecs in worker scope, JPEG mode createImageBitmap.
// A webview missing these gets `ready` with both false and the main thread
// falls back to in-page decoding.
const hasOffscreen = typeof OffscreenCanvas === "function";
port.postMessage({
  type: "ready",
  h264: hasOffscreen && typeof VideoDecoder === "function",
  jpeg: hasOffscreen && typeof createImageBitmap === "function",
});
