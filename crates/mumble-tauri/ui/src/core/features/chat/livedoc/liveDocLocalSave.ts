/**
 * liveDocLocalSave - a tiny singleton registry so the plugin-disabled dialog
 * can offer to export the currently-open LiveDoc to a local file before the
 * live-doc plugin's UI is torn down.
 *
 * The active `LiveDocPanel` registers a save callback while it is mounted (it
 * owns the editor API + export plumbing); the dialog reads it back.  Kept out
 * of the store because it carries a live closure, not serialisable state.
 */

/** Saves the open document to a local file; resolves when done/cancelled. */
export type LiveDocLocalSaveFn = () => Promise<void>;

let handler: LiveDocLocalSaveFn | null = null;

/** Register (or clear, with `null`) the active document's local-save callback. */
export function setLiveDocLocalSave(fn: LiveDocLocalSaveFn | null): void {
  handler = fn;
}

/** The current local-save callback, or `null` when no document is open. */
export function getLiveDocLocalSave(): LiveDocLocalSaveFn | null {
  return handler;
}
