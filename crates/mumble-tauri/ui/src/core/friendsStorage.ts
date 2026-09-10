/**
 * Persistent friends list - Mumble-style, keyed by TLS cert hash.
 *
 * A friend is added from the user context menu in the channel sidebar and
 * appears on the global Friends tab.
 *
 * The certificate hash is how a friend is *found* across connected servers, but
 * it does not by itself say who they are: a certificate is a login, and one
 * login can be used by several accounts (a second identity, a test account).
 * So the registered account (`userId`) and the server it belongs to
 * (`serverHost`/`serverPort`) are saved beside the hash, and it is those that
 * decide whether a user wearing that certificate really is this friend - see
 * `@core/friendsPresence`, which every design resolves through.
 *
 * Friends without a certificate hash (anonymous users) are still saved so
 * they show up in the list, but cannot be auto-resolved across servers.
 */

import { load } from "./utils/store";
import { bytesToBase64, base64ToBytes } from "./utils/base64";

// Re-exported for backwards compatibility with prior consumers.
export { base64ToBytes };

export interface Friend {
  /** Stable id (UUID) for editing/removing individual entries. */
  id: string;
  /** Display name captured at the time of adding. */
  userName: string;
  /** TLS certificate hash (hex SHA-1).  When set, the friend resolves
   *  across every connected server. */
  userHash?: string;
  /** Origin server hint - the server the friend was added on. */
  serverId?: string;
  /** Display label for {@link serverId}. */
  serverLabel?: string;
  /** The friend's registered user id on {@link serverId}, captured while they
   *  were online.  Lets us open the (persisted, E2E) friend channel even when
   *  the friend is offline - the channel name is derived from both user ids. */
  userId?: number;
  /** Connection target for {@link serverId} (host/port/username/cert), captured
   *  from the session the friend was added on.  Because a live server id is a
   *  random per-connection UUID, these stable fields are what let us re-find the
   *  friend's connected session - or offer to (re)connect to it when we aren't. */
  serverHost?: string;
  serverPort?: number;
  serverUsername?: string;
  serverCertLabel?: string | null;
  /** Unix epoch millis when the friend was added. */
  addedAt: number;
  /** Cached avatar (raw texture bytes) as base64. Stored so the icon
   *  remains visible when the friend is offline. */
  avatar?: string;
  /** Size in bytes of the cached avatar - used to detect changes
   *  without decoding base64. */
  avatarSize?: number;
  /** Unix epoch millis when the cached avatar was last refreshed. */
  avatarUpdatedAt?: number;
}

/**
 * Stable grouping key for a friend's origin server.
 *
 * The stored {@link Friend.serverId} is a per-connection UUID - the backend mints
 * a fresh one on every connect - so friends added across different sessions of
 * the *same* server carry different ids and would split into multiple,
 * identically-labelled groups.  Prefer the stable display label, then the
 * connection target, and only fall back to the (volatile) id.
 */
export function friendServerKey(
  f: Pick<Friend, "serverLabel" | "serverHost" | "serverPort" | "serverUsername" | "serverId">,
): string {
  if (f.serverLabel) return `label:${f.serverLabel}`;
  if (f.serverHost != null) return `addr:${f.serverHost}:${f.serverPort}:${f.serverUsername ?? ""}`;
  return f.serverId ?? "";
}

const FRIENDS_STORE = "friends.json";
const FRIENDS_KEY = "friends";

/** Broadcast event fired whenever the persisted friends list changes. */
export const FRIENDS_CHANGED_EVENT = "fancy:friends-changed";

export async function getFriends(): Promise<Friend[]> {
  const store = await load(FRIENDS_STORE, { autoSave: true, defaults: {} });
  const saved = await store.get<Friend[]>(FRIENDS_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveFriends(friends: Friend[]): Promise<void> {
  const store = await load(FRIENDS_STORE, { autoSave: true, defaults: {} });
  await store.set(FRIENDS_KEY, friends);
  globalThis.dispatchEvent(new CustomEvent(FRIENDS_CHANGED_EVENT));
}

/**
 * Returns true if a friend matching the provided identity already exists.
 * Matches by `userHash` when available, otherwise by `serverId` + `userName`.
 */
export async function hasFriend(opts: {
  userHash?: string;
  userName: string;
  serverId?: string;
  userId?: number;
}): Promise<boolean> {
  const friends = await getFriends();
  return friends.some((f) => isSameFriend(f, opts));
}

/**
 * Whether two records describe the same person.
 *
 * The certificate is the first word, not the last: the same login can carry
 * more than one registered account, and two accounts are two people even when
 * they share a certificate - so when both sides name an account, that decides.
 */
function isSameFriend(
  a: Pick<Friend, "userHash" | "userName" | "serverId" | "userId">,
  b: Pick<Friend, "userHash" | "userName" | "serverId" | "userId">,
): boolean {
  if (a.userHash && b.userHash) {
    if (a.userHash !== b.userHash) return false;
    if (a.userId != null && b.userId != null) return a.userId === b.userId;
    return true;
  }
  if (a.userHash || b.userHash) return false;
  return a.serverId === b.serverId && a.userName === b.userName;
}

/**
 * Adds a friend if not already present.  Returns the newly-created entry,
 * or the existing entry when the friend was already saved.
 */
/** Optional identity/reconnection details captured while a friend is online. */
export interface FriendIdentity {
  userId?: number;
  serverHost?: string;
  serverPort?: number;
  serverUsername?: string;
  serverCertLabel?: string | null;
}

/**
 * Copy the defined {@link FriendIdentity} fields from `src` onto `dst`.
 *
 * `fill` mode writes only what is still unknown. Everything here is *identity* -
 * which account this friend is, and which login of ours knows them - and a
 * background resolver that overwrites it can only ever be guessing: it has
 * found a live user it believes to be the friend, and if that belief is wrong
 * (one certificate, two accounts) the record silently becomes a different
 * person, with no way back short of deleting the friend. Only the user pointing
 * at somebody and saying "this one" (`addFriend`) overwrites.
 */
function applyIdentity(dst: Friend, src: FriendIdentity, mode: "fill" | "overwrite"): boolean {
  let changed = false;
  const keys: (keyof FriendIdentity)[] = [
    "userId",
    "serverHost",
    "serverPort",
    "serverUsername",
    "serverCertLabel",
  ];
  for (const k of keys) {
    const v = src[k];
    if (mode === "fill" && dst[k] !== undefined) continue;
    if (v !== undefined && dst[k] !== v) {
      (dst as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  return changed;
}

export async function addFriend(
  input: {
    userName: string;
    userHash?: string;
    serverId?: string;
    serverLabel?: string;
  } & FriendIdentity,
): Promise<Friend> {
  const friends = await getFriends();
  const existing = friends.find((f) => isSameFriend(f, input));
  if (existing) {
    // Already saved - the user is pointing at this person right now, so what
    // they are looking at wins over what was captured last time.
    if (applyIdentity(existing, input, "overwrite")) await saveFriends([...friends]);
    return existing;
  }
  const friend: Friend = {
    id: crypto.randomUUID(),
    userName: input.userName,
    userHash: input.userHash,
    serverId: input.serverId,
    serverLabel: input.serverLabel,
    addedAt: Date.now(),
  };
  applyIdentity(friend, input, "overwrite");
  await saveFriends([...friends, friend]);
  return friend;
}

/**
 * Backfill a saved friend's identity / reconnection details (no-op when nothing
 * changes or the friend was removed).  Called when a friend is resolved online,
 * so older entries gain the `userId` + connection target needed to open their
 * chat while offline or to (re)connect to their server.
 *
 * Backfill only: a field that is already known is left alone, because this runs
 * off a live match that may not be the friend at all.  Call it only for a match
 * on the friend's own server (`isFriendsOwnServer`) - a registered id from
 * anywhere else is a different account's.
 */
export async function updateFriendIdentity(id: string, identity: FriendIdentity): Promise<void> {
  const friends = await getFriends();
  const friend = friends.find((f) => f.id === id);
  if (!friend) return;
  if (applyIdentity(friend, identity, "fill")) await saveFriends([...friends]);
}

export async function removeFriend(id: string): Promise<void> {
  const friends = await getFriends();
  const next = friends.filter((f) => f.id !== id);
  if (next.length !== friends.length) await saveFriends(next);
}

/**
 * Persists a friend's avatar bytes (raw texture as returned by
 * `get_user_texture`).  No-op when the friend has been removed or the
 * bytes are identical to what is already cached.
 */
export async function updateFriendAvatar(id: string, bytes: number[] | Uint8Array): Promise<void> {
  const friends = await getFriends();
  const idx = friends.findIndex((f) => f.id === id);
  if (idx === -1) return;
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (arr.length === 0) return;
  const current = friends[idx];
  if (current.avatarSize === arr.length && current.avatar != null) return;
  const b64 = bytesToBase64(arr);
  if (current.avatar === b64) return;
  const updated: Friend = {
    ...current,
    avatar: b64,
    avatarSize: arr.length,
    avatarUpdatedAt: Date.now(),
  };
  const next = [...friends];
  next[idx] = updated;
  await saveFriends(next);
}
