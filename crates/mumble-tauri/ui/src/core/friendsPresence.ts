/**
 * Where a saved friend is right now - the one place that asks.
 *
 * A friend is saved as a TLS certificate hash, and for a long time that was
 * taken to mean the hash *is* the person. It is not: a certificate is a login,
 * and one login can carry several accounts (a second identity, a test account,
 * a bot run from the same machine). Resolving a friend by hash alone therefore
 * answers with whoever holds that certificate at the moment - which is how a
 * row labelled with one friend's name ends up opening a chat with someone else.
 *
 * So the lookup is told who it is looking for: the registered account saved
 * with the friend, and the open session they were saved on. On that server the
 * account decides, and a stranger wearing the same certificate is refused; any
 * other open server is still searched by certificate alone, because a
 * registered id means nothing there - that is what keeps "my friend is online
 * somewhere else today" working.
 *
 * All three designs (Standard, Aurora, Nebula) read the same saved list, so
 * they resolve it through here rather than each inventing the rule.
 */

import { invoke } from "@tauri-apps/api/core";
import type { Friend } from "./friendsStorage";
import type { SessionMeta } from "./types";

/** Where a friend was found online, as `find_user_by_hash` answers it. */
export interface FriendMatch {
  serverId: string;
  userSession: number;
  userName: string;
  /** The matched user's registered account, when they have one. */
  userId?: number | null;
}

/**
 * The open session matching the login the friend was saved on - same server,
 * same account of *ours* - if it is open.
 *
 * A stored `serverId` is a per-connection UUID minted afresh on every connect,
 * so the connection *target* is what identifies the session across restarts.
 * This is the session a friend chat opens on: it is the login whose message
 * history and friend rooms the friend belongs to.
 */
export function friendLoginSession(friend: Friend, sessions: readonly SessionMeta[]): SessionMeta | null {
  if (friend.serverHost == null) return null;
  return (
    sessions.find(
      (session) =>
        session.status === "connected" &&
        session.host === friend.serverHost &&
        session.port === friend.serverPort &&
        session.username === friend.serverUsername,
    ) ?? null
  );
}

/**
 * Any open connection to the friend's *server*, preferring the login they were
 * saved on.
 *
 * Which of our own identities is connected does not change who the friend is,
 * so this - not the login - is what scopes the presence lookup: it is the
 * server whose registered account ids the friend's saved `userId` belongs to.
 */
export function friendServerSession(friend: Friend, sessions: readonly SessionMeta[]): SessionMeta | null {
  if (friend.serverHost == null) return null;
  const onServer = sessions.filter(
    (session) =>
      session.status === "connected" &&
      session.host === friend.serverHost &&
      session.port === friend.serverPort,
  );
  return onServer.find((session) => session.username === friend.serverUsername) ?? onServer[0] ?? null;
}

/**
 * Resolve one saved friend to a live user, or null when they are not visible on
 * any open connection.
 *
 * Anonymous friends (no certificate) can never be resolved and answer null
 * without asking the backend.
 */
export async function resolveFriendMatch(
  friend: Friend,
  sessions: readonly SessionMeta[],
): Promise<FriendMatch | null> {
  if (!friend.userHash) return null;
  const origin = friendServerSession(friend, sessions);
  return (
    (await invoke<FriendMatch | null>("find_user_by_hash", {
      userHash: friend.userHash,
      userId: friend.userId ?? null,
      serverId: origin?.id ?? null,
    })) ?? null
  );
}

/**
 * Whether `session` is a connection to the server the friend belongs to.
 *
 * What a friend record says about a person - their registered id, how to reach
 * their server - is only true of *that* server, so it may only be learned, or
 * re-learned, from a session pointed at it. A friend seen on some other open
 * server is a different account there, and writing what we see there into the
 * record replaces the friend with a stranger.
 *
 * A record that has no server saved yet (added before the target was kept) has
 * nothing to contradict, so the first session that resolves it may fill it in.
 */
export function isFriendsOwnServer(friend: Friend, session: SessionMeta | null | undefined): boolean {
  if (!session) return false;
  if (friend.serverHost == null) return true;
  return session.host === friend.serverHost && session.port === friend.serverPort;
}

/**
 * Whether a live user may be treated as `friend`.
 *
 * The backend already refuses the wrong account on the friend's own server;
 * this is the same question asked of a user the UI found by itself (by session
 * number, on the active connection), where nothing has vouched for them.
 */
export function matchFitsFriend(
  friend: Friend,
  user: { readonly user_id?: number | null } | null | undefined,
): boolean {
  if (!user) return false;
  if (friend.userId == null || user.user_id == null) return true;
  return friend.userId === user.user_id;
}
