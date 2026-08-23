/**
 * Nebula's connection to the backend's event stream.
 *
 * `initEventListeners` is what turns Tauri events into store state: without it
 * nothing ever answers `ServerConnected`, so a connect attempt sets
 * "Negotiating with server..." and stays there forever. Every pack has to call
 * it exactly once, for as long as the client is mounted.
 *
 * The store speaks in router paths because Standard is a routed app. Nebula has
 * no router - it swaps screens in place - so the paths are translated here
 * rather than dragging a `MemoryRouter` into the pack for two string constants.
 */
import { useEffect, useRef } from "react";
import { initEventListeners } from "@core/store";
import type { Screen } from "./clientState";

export function useNebulaEventBridge(openScreen: (screen: Screen) => void): void {
  // Held in a ref so a caller that re-creates the callback cannot tear down and
  // re-subscribe the whole listener set mid-session.
  const openScreenRef = useRef(openScreen);
  useEffect(() => {
    openScreenRef.current = openScreen;
  }, [openScreen]);

  useEffect(() => {
    // Outside the webview (tests, plain browser) there is no event stream to
    // subscribe to, and every listener would just be a rejected invoke.
    if (!("__TAURI_INTERNALS__" in globalThis)) return;

    let cancelled = false;
    let unlisteners: (() => void)[] = [];
    void initEventListeners((path) => openScreenRef.current(path.startsWith("/chat") ? "chat" : "connect"))
      .then((listeners) => {
        if (cancelled) listeners.forEach((unlisten) => unlisten());
        else unlisteners = listeners;
      })
      .catch((reason) => console.error("Nebula event bootstrap failed:", reason));
    return () => {
      cancelled = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, []);
}
