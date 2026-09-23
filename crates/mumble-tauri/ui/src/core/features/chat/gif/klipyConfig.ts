/**
 * klipyConfig - shared Klipy API key state.
 *
 * Kept in its own tiny module so the (heavy) GIF browser components
 * (`GifPicker`, `KlipyGifBrowser`) can be lazy-loaded: the eager
 * preference-loading code (App / Settings) only needs the setter, not the
 * full component bundle.
 *
 * # The key is the switch for every GIF feature
 *
 * Everything GIF-shaped reaches Klipy from this machine: a search with a key
 * of the user's own goes to Klipy's API, and even a search the server runs on
 * its own key comes back as thumbnail addresses on Klipy's CDN, which the
 * picker would then load. Either way Klipy sees the user's IP address. So with
 * no key the client does not talk to Klipy at all - no request, no thumbnail,
 * and no GIF button to press - and setting one is where the user is told what
 * that costs (see the warning beside the key field in each pack's settings).
 */

import { useSyncExternalStore } from "react";

/** Module-level custom API key, applied from user preferences. */
let customApiKey: string | undefined;

/** Components showing or hiding a GIF entry point as the key comes and goes. */
const listeners = new Set<() => void>();

/** Apply a user-provided Klipy API key. */
export function setKlipyApiKey(key: string | undefined): void {
  const next = key?.trim() || undefined;
  if (next === customApiKey) return;
  customApiKey = next;
  for (const listener of listeners) listener();
}

/** Current active Klipy API key, if any. */
export function getActiveApiKey(): string | undefined {
  return customApiKey || undefined;
}

/** Whether the user has opted in to Klipy by giving it a key of their own. */
export function klipyEnabled(): boolean {
  return getActiveApiKey() !== undefined;
}

/** The refusal every GIF path answers with when there is no key. */
export const KLIPY_DISABLED_MESSAGE =
  "GIFs are off: add a Klipy API key in Advanced settings to turn them on.";

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** {@link klipyEnabled}, as a hook that re-renders when the key changes. */
export function useKlipyEnabled(): boolean {
  return useSyncExternalStore(subscribe, klipyEnabled, klipyEnabled);
}
