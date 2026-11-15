import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UserStats } from "@core/types";
import { appendSample, sampleOf, type StatsSample } from "./userInfoModel";

/** How often the sheet asks again while it is open. */
const POLL_MS = 1000;

/**
 * A person's connection figures, kept current for as long as something shows
 * them.
 *
 * Standard's `useUserStats` asks once, which is right for a card that shows a
 * single number. The sheet draws the last 45 seconds, so it asks every second
 * and keeps what came back. The listener goes up before the first request
 * for the reason `useUserStats` gives: a local server answers before an
 * un-awaited registration commits, and Tauri does not replay events.
 */
export function useLiveUserStats(
  session: number | null,
  active: boolean,
): { stats: UserStats | null; samples: StatsSample[] } {
  const [stats, setStats] = useState<UserStats | null>(null);
  const [samples, setSamples] = useState<StatsSample[]>([]);

  useEffect(() => {
    setStats(null);
    setSamples([]);
    if (!active || session === null || session < 0) return;

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    const request = () => invoke("request_user_stats", { session }).catch(() => undefined);

    void (async () => {
      const off = await listen<UserStats>("user-stats", (event) => {
        if (event.payload.session !== session) return;
        setStats(event.payload);
        setSamples((current) => appendSample(current, sampleOf(event.payload, Date.now())));
      });
      if (cancelled) {
        off();
        return;
      }
      unlisten = off;
      void request();
      timer = setInterval(() => void request(), POLL_MS);
    })();

    return () => {
      cancelled = true;
      unlisten?.();
      if (timer) clearInterval(timer);
    };
  }, [session, active]);

  return { stats, samples };
}
