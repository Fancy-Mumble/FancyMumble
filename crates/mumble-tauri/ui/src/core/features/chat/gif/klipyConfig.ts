/**
 * klipyConfig - shared Klipy API key state.
 *
 * Kept in its own tiny module so the (heavy) GIF browser components
 * (`GifPicker`, `KlipyGifBrowser`) can be lazy-loaded: the eager
 * preference-loading code (App / Settings) only needs the setter, not the
 * full component bundle.
 */

/** Module-level custom API key, applied from user preferences. */
let customApiKey: string | undefined;

/** Apply a user-provided Klipy API key. */
export function setKlipyApiKey(key: string | undefined): void {
  customApiKey = key?.trim() || undefined;
}

/** Current active Klipy API key, if any. */
export function getActiveApiKey(): string | undefined {
  return customApiKey || undefined;
}
