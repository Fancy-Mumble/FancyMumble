/**
 * "Open in a private window": the one answer every pack's menu asks for.
 *
 * The work is the backend's - `commands::browser` finds the default browser
 * and knows its private-mode switch, because no operating system has a verb
 * for this and every browser has a flag for it. What lives here is the part a
 * menu needs: whether to draw the row at all, and what happens when it is
 * clicked.
 *
 * Two rules the packs must not re-derive:
 *
 * - **Ask before drawing.** The row is offered only where it can be honoured.
 *   A default browser with no private mode - Safari, or anything unrecognised
 *   - would otherwise give a row that can only fail.
 * - **Never fall back to an ordinary window.** Quietly opening a normal window
 *   for someone who asked for a private one breaks exactly the promise the row
 *   made. A failure says so instead.
 */

import { invoke } from "@tauri-apps/api/core";

/**
 * The answer to "can this machine do it at all", asked once.
 *
 * Cached as the promise rather than the result, so a menu opening twice in
 * quick succession does not resolve the default browser twice - on Linux that
 * is two `xdg-settings` processes for a question whose answer changes about
 * once a year.
 *
 * The cost of caching is a default browser changed mid-session: the row then
 * reflects the old answer until the client restarts. That is the right trade
 * against spawning a process on every right-click, and the failure it can
 * cause is a message rather than a wrong window.
 */
let supported: Promise<boolean> | null = null;

/** Whether a private window can be opened on this machine. */
export function canOpenPrivately(): Promise<boolean> {
  supported ??= invoke<boolean>("can_open_url_private").catch(() => false);
  return supported;
}

/** Forget the cached answer. Tests only - nothing in the app changes it. */
export function resetPrivateBrowsingCache(): void {
  supported = null;
}

/**
 * Open one URL in a new private window of the default browser.
 *
 * Rejects rather than opening anything when the browser cannot be launched or
 * the URL is not `http`/`https`. Callers show the reason; they must not retry
 * through the ordinary opener.
 */
export async function openPrivately(url: string): Promise<void> {
  await invoke("open_url_private", { url });
}

/**
 * Open privately, or say why nothing happened.
 *
 * A native dialog rather than a toast, for the same reason the row is gated on
 * [`canOpenPrivately`]: the reader asked for a window and did not get one, and
 * that is not something to mention quietly at the edge of the screen. The
 * caller supplies the sentence, because the backend's reason is English and a
 * German dialog carrying an English clause is worse than one without it - the
 * reason goes to the console, where it is for us rather than for them.
 */
export async function openPrivatelyOrExplain(url: string, failure: string): Promise<void> {
  try {
    await openPrivately(url);
  } catch (error) {
    console.warn("private window failed:", error);
    const { message } = await import("@tauri-apps/plugin-dialog");
    await message(failure, { kind: "error" }).catch(() => undefined);
  }
}
