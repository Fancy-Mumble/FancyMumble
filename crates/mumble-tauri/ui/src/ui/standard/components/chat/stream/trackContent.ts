/**
 * Broadcast track metadata: what each video track (SDP mid) of a broadcast
 * shows, as announced by START payloads.
 *
 * A LEAF module on purpose - it imports nothing from the stream layer, so
 * both useScreenShare (which writes the map from signaling) and
 * nativeStreamView (which reads it to route frames) can depend on it
 * without forming an import cycle. That cycle previously ping-ponged the
 * two modules' HMR invalidations into an endless update loop.
 */
import type { SourceSelection } from "./ScreenSharePickerDialog";

/** What a broadcast video track carries. */
export type TrackContent = "screen" | "camera";

/** Per-mid content map for one broadcaster ("0" -> screen, "1" -> camera). */
export type TrackContentMap = Readonly<Record<string, TrackContent>>;

/** Track content announced when only a bare/legacy START was received:
 *  a single track that is (or is treated as) a screen. */
export const LEGACY_TRACKS: TrackContentMap = { "0": "screen" };

/** Content maps per broadcaster session, fed by START payloads (and by
 *  ourselves when we are the broadcaster). Module-level like the viewer
 *  PCs: metadata must survive React remounts. */
export const trackContentBySession = new Map<number, TrackContentMap>();

/** Build the START announce payload for a source list. Mid order == source
 *  order (the Rust broadcaster adds one transceiver per source, in order). */
export function buildStartPayload(sources: readonly SourceSelection[]): string {
  return JSON.stringify({
    v: 1,
    tracks: sources.map((s, i) => ({
      mid: String(i),
      content: s.kind === "device" ? "camera" : "screen",
    })),
  });
}

/** Parse a START payload into a content map; empty/malformed payloads (old
 *  clients announce with "") fall back to the single-screen assumption. */
export function parseStartPayload(payload: string): TrackContentMap {
  if (payload === "") return LEGACY_TRACKS;
  try {
    const parsed = JSON.parse(payload) as {
      tracks?: { mid?: string; content?: string }[];
    };
    if (!Array.isArray(parsed.tracks) || parsed.tracks.length === 0) return LEGACY_TRACKS;
    const map: Record<string, TrackContent> = {};
    for (const track of parsed.tracks) {
      if (typeof track.mid === "string") {
        map[track.mid] = track.content === "camera" ? "camera" : "screen";
      }
    }
    return Object.keys(map).length > 0 ? map : LEGACY_TRACKS;
  } catch {
    return LEGACY_TRACKS;
  }
}

/** Per-mid content of one broadcaster's tracks, for labelling/routing. */
export function getTrackContentMap(session: number): TrackContentMap {
  return trackContentBySession.get(session) ?? LEGACY_TRACKS;
}
