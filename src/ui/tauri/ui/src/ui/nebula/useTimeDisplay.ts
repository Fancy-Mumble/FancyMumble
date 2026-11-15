/**
 * The clock settings the message river reads its timestamps under.
 *
 * Read once at the top of the client and passed down, for the same reason
 * `useChatDisplay` is: the alternative is every row in a busy channel holding
 * its own subscription to three values that change when somebody visits a
 * settings page.
 *
 * Re-read on `preferences-changed` rather than only at mount, so switching to
 * a 12-hour clock re-reads the conversation behind the settings page instead
 * of waiting for the next launch.
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getPreferences } from "@core/preferencesStorage";
import { DEFAULT_TIME_DISPLAY, type TimeDisplay } from "./selectors";

/**
 * The live clock settings.
 *
 * The OS clock format is asked for once and kept across preference changes:
 * it is a fact about the machine, not about the record, and on Windows it is
 * the only reliable answer - WebView2's `Intl` probe reports 12-hour on a
 * system set to 24.
 */
export function useTimeDisplay(): TimeDisplay {
  const [display, setDisplay] = useState<TimeDisplay>(DEFAULT_TIME_DISPLAY);

  useEffect(() => {
    let live = true;
    const read = () => {
      void getPreferences()
        .then((preferences) => {
          if (!live) return;
          setDisplay((previous) => ({
            ...previous,
            timeFormat: preferences.timeFormat,
            localTime: preferences.convertToLocalTime,
          }));
        })
        .catch(() => undefined);
    };
    read();
    globalThis.addEventListener("preferences-changed", read);
    return () => {
      live = false;
      globalThis.removeEventListener("preferences-changed", read);
    };
  }, []);

  useEffect(() => {
    let live = true;
    invoke<"12h" | "24h" | null>("get_system_clock_format")
      .then((format) => {
        if (live && format !== null) {
          setDisplay((previous) => ({ ...previous, systemUses24h: format === "24h" }));
        }
      })
      .catch(() => {
        // No answer from the platform (a browser preview, or an OS that does
        // not expose it): "auto" falls back to `Intl`, which is what
        // `formatTimestamp` does when this stays undefined.
      });
    return () => {
      live = false;
    };
  }, []);

  return display;
}
