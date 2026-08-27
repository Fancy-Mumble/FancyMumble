import { useEffect, useMemo, useState } from "react";
import { activeStreamViewerStrategy } from "@standard/components/chat/stream/viewerStrategy";
import { slotForMid, type FeedSlot } from "./feeds";

/** How often the stage's header re-reads the transport. Matches the
 *  Stats-for-Nerds panel's own 1 Hz cadence, so the two never disagree. */
const SAMPLE_MS = 1000;

/** The handful of numbers the mock prints across the top of the stage. */
export interface FeedStats {
  readonly width: number | null;
  readonly height: number | null;
  readonly fps: number | null;
  /** Round-trip time to the server, the same metric the stats panel labels
   *  "Latency" - so the one-line summary and the panel agree. */
  readonly rttMs: number | null;
}

const NO_STATS: FeedStats = { width: null, height: null, fps: null, rttMs: null };

/**
 * Live resolution, frame rate and latency for one feed.
 *
 * Only the focused feed is sampled: the numbers are a caption on the stage,
 * and a `getStats()` round trip per filmstrip tile per second would cost far
 * more than the caption is worth.
 */
export function useFeedStats(session: number | null, slot: FeedSlot): FeedStats {
  const [stats, setStats] = useState<FeedStats>(NO_STATS);
  const sampler = useMemo(
    () => (session === null ? null : activeStreamViewerStrategy().createStatsSampler(session)),
    [session],
  );

  useEffect(() => {
    if (sampler === null || session === null) {
      setStats(NO_STATS);
      return;
    }
    let cancelled = false;
    let inFlight = false;

    const read = () => {
      if (inFlight) return;
      inFlight = true;
      void sampler
        .sample()
        .then((result) => {
          if (cancelled) return;
          if (!result) {
            setStats(NO_STATS);
            return;
          }
          const { sample } = result;
          // A single-track share has no slot to disagree about, so an
          // unmatched lookup falls back to the only track there is.
          const track =
            sample.videos.find((video) => slotForMid(session, video.mid) === slot) ?? sample.videos[0];
          setStats({
            width: track?.frameWidth ?? sample.frameWidth,
            height: track?.frameHeight ?? sample.frameHeight,
            fps: track?.framesPerSecond ?? sample.framesPerSecond,
            rttMs: sample.rttMs,
          });
        })
        .catch(() => {
          /* the transport went away mid-sample; the next tick reports it */
        })
        .finally(() => {
          inFlight = false;
        });
    };

    read();
    const timer = setInterval(read, SAMPLE_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sampler, session, slot]);

  return stats;
}
