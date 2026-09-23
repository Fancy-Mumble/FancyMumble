/**
 * klipyConfig - shared Klipy API key state.
 *
 * Kept in its own tiny module so the (heavy) GIF browser components
 * (`GifPicker`, `KlipyGifBrowser`) can be lazy-loaded: the eager
 * preference-loading code (App / Settings) only needs the setter, not the
 * full component bundle.
 *
 * # The key is the user's consent to Klipy
 *
 * A key of the user's own means this machine talks to Klipy: searches go to
 * its API, and thumbnails load from its CDN, so Klipy sees the user's IP
 * address. Setting one is where the user is told so (the warning beside the key
 * field in each pack's settings). Without one the client never contacts Klipy
 * - GIFs then come only from a server that proxies them, see gifAccess.ts.
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

/** The refusal every GIF path answers with when GIFs are off. */
export const KLIPY_DISABLED_MESSAGE =
  "GIFs are off: this server does not serve them privately, and no Klipy API key is set.";

export function subscribeKlipyKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** {@link klipyEnabled}, as a hook that re-renders when the key changes. */
export function useKlipyEnabled(): boolean {
  return useSyncExternalStore(subscribeKlipyKey, klipyEnabled, klipyEnabled);
}
