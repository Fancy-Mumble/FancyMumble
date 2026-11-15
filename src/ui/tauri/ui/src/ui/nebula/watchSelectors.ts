/**
 * Selectors over the watch-together sessions that are cheap enough to run on
 * every store write.
 *
 * A zustand selector is not a memo: it is called again for every mutation the
 * store takes, from anywhere in the client. So a selector that sorts and joins
 * a list is doing that work on every arriving message, every talking edge and
 * every ping, to answer a question that only changes when somebody starts or
 * stops a shared video.
 */
import type { AppState } from "@core/store";

/** One answer per map, kept for as long as that map is the live one. */
const keyByMap = new WeakMap<object, string>();

/**
 * Which watch sessions exist, as a string that changes only when one does.
 *
 * The map itself is replaced on every sync heartbeat, so selecting it would
 * re-render its readers every couple of seconds through a film. The key is
 * stable across those heartbeats, and the join behind it now runs once per
 * replacement rather than once per store write.
 */
export function selectLiveWatchKey(state: AppState): string {
  const sessions = state.watchSessions;
  const cached = keyByMap.get(sessions);
  if (cached !== undefined) return cached;
  const key = [...sessions.keys()].sort().join(",");
  keyByMap.set(sessions, key);
  return key;
}
