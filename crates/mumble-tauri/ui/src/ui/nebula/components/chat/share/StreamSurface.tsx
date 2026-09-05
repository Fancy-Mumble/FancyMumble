import { useCallback, useEffect, useRef, type CSSProperties } from "react";
import {
  activeStreamViewerStrategy,
  StreamViewerStrategyId,
} from "@standard/components/chat/stream/viewerStrategy";
import type { StreamFeed } from "./feeds";

/** Whether the active strategy paints onto a canvas (the native Rust viewer -
 *  mandatory on Linux, where WebKitGTK has no WebRTC) instead of binding a
 *  MediaStream to `<video>`. Constant per page load (the strategy is latched),
 *  so branching on it inside a component never changes hook order. */
export function usesNativeSurface(): boolean {
  return activeStreamViewerStrategy().id === StreamViewerStrategyId.Native;
}

/** Refresh rate of a mirrored tile. The mirror only exists so the focused
 *  feed still animates in the filmstrip; a rail thumbnail moving at twelve
 *  frames is indistinguishable from one moving at sixty. */
const MIRROR_FPS = 12;

/** Longest edge a mirror is drawn at. The rail is 116px wide, so scaling the
 *  copy down keeps a 4K share's mirror off the per-frame budget. */
const MIRROR_MAX_WIDTH = 480;

/**
 * Copy `source` into `target` on a slow loop.
 *
 * The native family decodes each session's slot into exactly ONE canvas - the
 * decoder holds a single element ref - so a feed that has to appear twice (on
 * the stage AND as its own filmstrip tile) cannot simply mount the ref twice:
 * the second mount would steal the paints. The second appearance is a copy
 * instead. The webview family needs none of this, since one MediaStream binds
 * to any number of `<video>` elements.
 */
function useCanvasMirror(
  source: StreamFeed["canvasRef"],
  target: React.RefObject<HTMLCanvasElement | null>,
  active: boolean,
): void {
  useEffect(() => {
    if (!active) return;
    let frame = 0;
    let lastDraw = 0;
    let context: CanvasRenderingContext2D | null = null;
    let contextOf: HTMLCanvasElement | null = null;

    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      if (now - lastDraw < 1000 / MIRROR_FPS) return;
      const from = source.current;
      const to = target.current;
      // Width is zero until the decoder's first paint sizes the canvas.
      if (!from || !to || from.width === 0 || from.height === 0) return;
      lastDraw = now;
      const scale = Math.min(1, MIRROR_MAX_WIDTH / from.width);
      const width = Math.max(1, Math.round(from.width * scale));
      const height = Math.max(1, Math.round(from.height * scale));
      if (to.width !== width || to.height !== height) {
        to.width = width;
        to.height = height;
      }
      if (contextOf !== to) {
        context = to.getContext("2d");
        contextOf = to;
      }
      context?.drawImage(from, 0, 0, width, height);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, source, target]);
}

export interface StreamSurfaceProps {
  readonly feed: StreamFeed;
  /**
   * Native family: whether THIS element is the one the decoder paints into.
   * Exactly one mount per feed may claim it; the others mirror. The webview
   * family ignores it.
   */
  readonly primary: boolean;
  readonly style: CSSProperties;
  /** Set on the stage's surface only, so the e2e registry keeps naming one
   *  element per stream rather than one per tile. */
  readonly testId?: string;
  /** Receives the mounted element, whichever kind it turned out to be - the
   *  screenshot button needs something to read pixels off. */
  readonly mediaRef?: React.MutableRefObject<HTMLVideoElement | HTMLCanvasElement | null>;
}

/**
 * The pixels of one feed, drawn by whichever viewer family is active.
 *
 * Every difference between the two families is contained here: the stage and
 * the filmstrip place this component and know nothing about `<video>` versus
 * canvas, MediaStreams versus decoder refs.
 */
export function StreamSurface({ feed, primary, style, testId, mediaRef }: Readonly<StreamSurfaceProps>) {
  const native = usesNativeSurface();
  const video = useRef<HTMLVideoElement | null>(null);
  const mirror = useRef<HTMLCanvasElement | null>(null);
  useCanvasMirror(feed.canvasRef, mirror, native && !primary && feed.live);
  const { canvasRef, stream } = feed;

  // A memoised callback ref, not an inline one: an inline callback is torn
  // down and re-attached on every render, and a decoder ref that blinks
  // through null between paints drops frames on the floor.
  const attachCanvas = useCallback(
    (node: HTMLCanvasElement | null) => {
      (primary ? canvasRef : mirror).current = node;
      if (mediaRef) mediaRef.current = node;
    },
    [canvasRef, mediaRef, primary],
  );
  const attachVideo = useCallback(
    (node: HTMLVideoElement | null) => {
      video.current = node;
      if (node && node.srcObject !== stream) node.srcObject = stream;
      if (mediaRef) mediaRef.current = node;
    },
    [mediaRef, stream],
  );

  useEffect(() => {
    const element = video.current;
    if (element && element.srcObject !== stream) element.srcObject = stream;
  }, [stream]);

  // Identifying attributes go on the tagged (stage) surface only, so a feed
  // that also mirrors into the filmstrip is still one element per stream.
  const identity = testId
    ? {
        "data-testid": testId,
        "data-own": feed.own ? "true" : "false",
        "data-session": feed.session,
        // Who this stream is of. The stage is the only place a viewer sees a
        // remote broadcast in this pack - there is no "X is sharing" banner to
        // carry the name instead - so it has to be readable here.
        "data-broadcaster-name": feed.name,
      }
    : {};

  if (native) return <canvas ref={attachCanvas} {...identity} style={style} />;
  return <video ref={attachVideo} autoPlay playsInline muted {...identity} style={style} />;
}
