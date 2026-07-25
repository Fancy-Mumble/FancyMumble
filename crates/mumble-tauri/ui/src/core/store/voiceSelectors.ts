/**
 * Selectors for the local user's own voice flags.
 *
 * Deafen is deliberately *not* part of `voiceState` (which only describes the
 * local capture pipeline: inactive / active / muted). It is a server-side flag
 * on our own user, echoed back as `self_deaf`, so every surface that shows a
 * deafen indicator must read it from here. Keeping that in one place stops each
 * UI from inventing its own - and wrong - derivation.
 */

import type { AppState } from ".";

/** Our own user entry, or `undefined` before the server assigns a session. */
export function selectOwnUser(state: AppState) {
  return state.ownSession === null ? undefined : state.users.find((user) => user.session === state.ownSession);
}

/** Whether we have deafened ourselves (server-confirmed). */
export function selectSelfDeafened(state: AppState): boolean {
  return selectOwnUser(state)?.self_deaf ?? false;
}

/**
 * Whether the microphone is live: voice is running and not muted.
 *
 * Note "not active" covers both muted and inactive, which is why an indicator
 * keyed only on `voiceState === "muted"` shows a live mic while voice is off.
 */
export function selectMicLive(state: AppState): boolean {
  return state.voiceState === "active";
}
