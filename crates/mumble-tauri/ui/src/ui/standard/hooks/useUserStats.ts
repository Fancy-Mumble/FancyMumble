import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { UserStats } from "@core/types";

/**
 * Request and listen for a user's stats while `active` is true.
 * Returns the latest UserStats or null while loading / inactive.
 */
export function useUserStats(
  session: number | null,
  active: boolean,
): UserStats | null {
  const [stats, setStats] = useState<UserStats | null>(null);

  // The listener must be registered before the request goes out: `listen()`
  // is an async IPC round-trip, and a fast (local) server can answer before
  // an un-awaited registration commits. Tauri does not replay events, so
  // losing that race left the stats dialog empty.
  useEffect(() => {
    if (!active || session === null) {
      setStats(null);
      return;
    }
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    (async () => {
      const un = await listen<UserStats>("user-stats", (event) => {
        if (event.payload.session === session) {
          setStats(event.payload);
        }
      });
      if (cancelled) {
        un();
        return;
      }
      unlisten = un;
      invoke("request_user_stats", { session }).catch(() => {});
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [session, active]);

  return stats;
}
