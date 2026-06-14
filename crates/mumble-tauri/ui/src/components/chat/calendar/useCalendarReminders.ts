import { useEffect, useRef } from "react";
import { sendNotification } from "@tauri-apps/plugin-notification";
import { useAppStore } from "../../../store";
import { PLUGIN_NAME_CALENDAR } from "../../../constants/pluginData";
import { loadCalendarFromStore, publishCalendar, useCalendarStore } from "./calendarStore";
import { expandEvent } from "./recurrence";
import { MS_PER_MINUTE } from "./calendarDates";
import { shortTime } from "./calendarFormat";

const CHECK_INTERVAL_MS = 20_000;
const FIRED_CAP = 500;

/**
 * App-level calendar lifecycle + reminders (mounted once in `App`):
 *  - loads the user's saved calendar and re-publishes their meetings once the
 *    file-server is available (so reminders work even if the panel is never
 *    opened, and peers get catch-up on connect);
 *  - polls for due reminders and fires an OS notification + a sound cue.
 *
 * Online-only for now; the same fire point is where persistent-PM delivery for
 * offline users would later hook in.
 */
export function useCalendarReminders(): void {
  const fsReady = useAppStore((s) => !!s.fileServerConfig?.sessionJwt);
  // Only act on servers that actually run the `fancy-calendar` plugin, so we
  // never publish to a missing relay or fire reminders from a stale calendar
  // after switching to a server without the feature.
  const calendarActive = useAppStore((s) => s.pluginInfos.has(PLUGIN_NAME_CALENDAR));
  const firedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!fsReady || !calendarActive) return;
    void loadCalendarFromStore().then(publishCalendar);
  }, [fsReady, calendarActive]);

  useEffect(() => {
    if (!calendarActive) return;
    const tick = () => {
      const now = Date.now();
      const fired = firedRef.current;
      for (const event of useCalendarStore.getState().events) {
        const offset = event.reminderMinutes;
        if (offset == null || event.myStatus === "declined") continue;
        const offsetMs = offset * MS_PER_MINUTE;
        for (const occ of expandEvent(event, now, now + offsetMs + MS_PER_MINUTE)) {
          const remindAt = occ.start - offsetMs;
          const key = `${occ.key}:${offset}`;
          if (remindAt <= now && occ.start > now && !fired.has(key)) {
            fired.add(key);
            globalThis.dispatchEvent(new CustomEvent("fancy:calendar-reminder"));
            try {
              sendNotification({
                title: event.title || "Meeting",
                body: `Starts at ${shortTime(occ.start)}${event.location ? ` · ${event.location}` : ""}`,
              });
            } catch {
              /* OS notifications may be unavailable on this platform */
            }
          }
        }
      }
      if (fired.size > FIRED_CAP) fired.clear();
    };
    tick();
    const id = setInterval(tick, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [calendarActive]);
}
