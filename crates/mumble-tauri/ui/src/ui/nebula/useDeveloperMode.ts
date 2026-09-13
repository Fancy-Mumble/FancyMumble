/**
 * Whether the user runs the client in developer mode.
 *
 * Read from the shared preferences record rather than asked of the store:
 * `userMode` lives there, and Standard gates its developer tools on the same
 * field. Followed through `preferences-changed`, so switching the mode in
 * Settings shows or hides those tools without a restart.
 */
import { useEffect, useState } from "react";
import { getPreferences } from "@core/preferencesStorage";

export function useDeveloperMode(): boolean {
  const [developer, setDeveloper] = useState(false);
  useEffect(() => {
    let live = true;
    const load = () =>
      void getPreferences()
        .then((prefs) => {
          if (live) setDeveloper(prefs.userMode === "developer");
        })
        .catch(() => undefined);
    load();
    globalThis.addEventListener("preferences-changed", load);
    return () => {
      live = false;
      globalThis.removeEventListener("preferences-changed", load);
    };
  }, []);
  return developer;
}
