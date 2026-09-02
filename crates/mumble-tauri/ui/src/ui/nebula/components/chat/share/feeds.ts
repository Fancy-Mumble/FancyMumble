/**
 * What the share stage is actually a list of.
 *
 * The v2 mock's filmstrip is per *feed*, not per broadcaster: someone sharing
 * a screen and a camera at once contributes two tiles, badged SCR and CAM, and
 * either can be the one on the stage. The transport underneath is still
 * per-session - one viewer connection carrying up to two video tracks - so
 * this module is the seam between the two: {@link SessionMedia} is what one
 * session's transport produces, {@link StreamFeed} is what the stage draws.
 */
import type { RefObject } from "react";
import { getTrackContentMap } from "@standard/components/chat/stream/trackContent";

/** Which of a session's two video slots a feed came from. */
export type FeedSlot = "display" | "camera";

/** What the feed shows. `window` is only ever known for our own broadcast -
 *  see {@link buildFeeds}. */
export type FeedKind = "screen" | "window" | "camera";

/** The three-letter badge the mock puts in a tile's top-right corner. */
export const FEED_BADGE: Record<FeedKind, string> = {
  screen: "SCR",
  window: "WIN",
  camera: "CAM",
};

/**
 * One broadcaster session's live media, whichever viewer family produced it.
 *
 * Both families are represented at once because the family is a page-load
 * constant, not a per-feed one: the webview family fills the streams and the
 * native family the canvas refs, and the surface component reads whichever
 * belongs to the active strategy.
 */
export interface SessionMedia {
  readonly session: number;
  /** Webview family: the screen track, or the camera on a camera-only share. */
  readonly primary: MediaStream | null;
  /** Webview family: the camera *beside* a screen (null when it is alone). */
  readonly camera: MediaStream | null;
  /** Native family: the canvas the decoder paints this session's display slot
   *  into. One element at a time owns it - see StreamSurface. */
  readonly displayRef: RefObject<HTMLCanvasElement | null>;
  /** Native family: same, for the camera-beside-a-screen slot. */
  readonly cameraRef: RefObject<HTMLCanvasElement | null>;
  readonly hasDisplay: boolean;
  readonly hasCamera: boolean;
  /** Native family: the viewer could not be started at all. */
  readonly failed: boolean;
}

/** One tile in the filmstrip, and a candidate for the stage. */
export interface StreamFeed {
  /** `${session}:${slot}` - stable while the feed exists, which is what the
   *  focus selection is remembered by. */
  readonly key: string;
  readonly session: number;
  readonly slot: FeedSlot;
  readonly kind: FeedKind;
  readonly name: string;
  readonly own: boolean;
  readonly stream: MediaStream | null;
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  /** Whether pixels are arriving. False means "announced, still connecting". */
  readonly live: boolean;
  readonly failed: boolean;
}

/** The feed key for one session slot. */
export function feedKey(session: number, slot: FeedSlot): string {
  return `${session}:${slot}`;
}

/**
 * Expand each session's media into the feeds the stage draws.
 *
 * A display feed is listed as soon as the session is announced, so a tile
 * exists to say "Connecting…" rather than the strip growing under the cursor
 * once pixels arrive. A camera feed is listed on the same evidence - the START
 * announce names a camera track beside a screen - falling back to "there is a
 * camera stream" for the legacy announce that names nothing.
 *
 * `ownDisplayKind` is why WIN can only appear on our own tile: the announce
 * carries screen-vs-camera, not screen-vs-window, so for anyone else a shared
 * window is honestly just a screen.
 */
export function buildFeeds(
  media: readonly SessionMedia[],
  nameOf: (session: number) => string,
  ownSession: number | null,
  ownDisplayKind: FeedKind,
  nativeSurface: boolean,
  /** What to call your own feed - the caller translates it. */
  ownLabel: string,
): StreamFeed[] {
  const feeds: StreamFeed[] = [];
  for (const m of media) {
    const content = getTrackContentMap(m.session);
    const contents = Object.values(content);
    const hasScreenTrack = contents.includes("screen");
    const own = m.session === ownSession;
    const name = own ? ownLabel : nameOf(m.session);
    const displayLive = nativeSurface ? m.hasDisplay : m.primary !== null;

    feeds.push({
      key: feedKey(m.session, "display"),
      session: m.session,
      slot: "display",
      // A camera-only share IS the display slot in both families, so its
      // single feed is badged CAM rather than mislabelled as a screen.
      kind: hasScreenTrack ? (own ? ownDisplayKind : "screen") : "camera",
      name,
      own,
      stream: m.primary,
      canvasRef: m.displayRef,
      live: displayLive,
      failed: m.failed,
    });

    const cameraLive = nativeSurface ? m.hasCamera : m.camera !== null;
    if (cameraLive || (hasScreenTrack && contents.includes("camera"))) {
      feeds.push({
        key: feedKey(m.session, "camera"),
        session: m.session,
        slot: "camera",
        kind: "camera",
        name,
        own,
        stream: m.camera,
        canvasRef: m.cameraRef,
        live: cameraLive,
        failed: m.failed,
      });
    }
  }
  return feeds;
}

/** "3 screens · 2 cameras" - the mock's right-hand summary of the strip. */
export function feedSummary(feeds: readonly StreamFeed[]): string {
  const cameras = feeds.filter((f) => f.kind === "camera").length;
  const screens = feeds.length - cameras;
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const parts: string[] = [];
  if (screens > 0) parts.push(plural(screens, "screen"));
  if (cameras > 0) parts.push(plural(cameras, "camera"));
  return parts.join(" · ");
}

/**
 * Which slot an inbound video track belongs to.
 *
 * Mirrors the frame routing in `nativeStreamView` and `computeStreams`: a
 * camera track is the aside (the second tile) only when a screen track runs
 * beside it, because a camera-only share takes the display slot in both
 * families.
 */
export function slotForMid(session: number, mid: string | null): FeedSlot {
  const content = getTrackContentMap(session);
  const kind = (mid === null ? undefined : content[mid]) ?? (mid === "0" ? "screen" : "camera");
  return kind === "camera" && Object.values(content).includes("screen") ? "camera" : "display";
}
