/**
 * Whether GIFs are on at all, for the buttons that open a picker.
 *
 * Two ways in, and neither makes this machine talk to Klipy behind the user's
 * back: a key of their own, set with a warning that says exactly that, or a
 * server that searches *and* serves the pictures through its own media proxy.
 * With neither there is no GIF button to press (see klipyConfig.ts and
 * serverGifs.ts for the two halves).
 */

import { useSyncExternalStore } from "react";
import { klipyEnabled, subscribeKlipyKey } from "./klipyConfig";
import { serverGifsPrivate, subscribeServerGifSupport } from "./serverGifs";

/** Whether a GIF picker may open. */
export function gifsEnabled(): boolean {
  return klipyEnabled() || serverGifsPrivate();
}

function subscribe(listener: () => void): () => void {
  const offKey = subscribeKlipyKey(listener);
  const offServer = subscribeServerGifSupport(listener);
  return () => {
    offKey();
    offServer();
  };
}

/** {@link gifsEnabled}, as a hook that follows the key and the server's answer. */
export function useGifsEnabled(): boolean {
  return useSyncExternalStore(subscribe, gifsEnabled, gifsEnabled);
}
