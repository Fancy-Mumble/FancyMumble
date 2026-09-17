/**
 * Selectors that answer with a value rather than with a collection.
 *
 * A component that selects `users` re-renders whenever anybody joins, leaves,
 * mutes or is re-sent by the backend - and in the message river that meant a
 * hundred rows re-rendering to learn a fact about one person that had not
 * changed. A selector returning a string or a number compares equal to itself,
 * so its reader renders again only when the answer does.
 *
 * These live in core rather than in a pack: what "my own certificate" means is
 * not a design decision, and all three packs ask it.
 */
import type { AppState } from "./index";

/**
 * Your own certificate hash, or undefined before the roster has arrived.
 *
 * Every surface that draws a read receipt needs it, and each of them used to
 * scan the whole user list for it on every render.
 */
export function selectOwnHash(state: AppState): string | undefined {
  const own = state.ownSession;
  if (own === null) return undefined;
  return state.users.find((user) => user.session === own)?.hash;
}

/** One poll by id, so a row watches its own poll instead of every poll. */
export function selectPoll(pollId: string) {
  return (state: AppState) => state.polls.get(pollId);
}

/**
 * The certificates of everyone standing in one channel, as one string.
 *
 * The read receipt asks "have they all read it", which is a question about a
 * set of people. Answered as a list it would be a new array per render; as a
 * key it is a string that changes only when the room's membership does.
 */
export function selectChannelHashKey(channelId: number) {
  return (state: AppState): string => {
    const hashes: string[] = [];
    for (const user of state.users) {
      if (user.channel_id === channelId && user.hash) hashes.push(user.hash);
    }
    return hashes.sort().join(",");
  };
}

/** The same membership, as the list the receipt helpers take. */
export function hashesOf(key: string): string[] {
  return key === "" ? [] : key.split(",");
}
