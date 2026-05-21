/**
 * Persistent friends list - Mumble-style, identified by TLS cert hash.
 *
 * A friend is added from the user context menu in the channel sidebar and
 * appears on the global Friends tab.  Identification follows the same rule
 * as user shortcuts: a TLS certificate hash uniquely addresses the user
 * across every connected server.  The `serverId` / `serverLabel` fields are
 * kept only as a UI hint reminding the user which server they originally
 * added the friend from.
 *
 * Friends without a certificate hash (anonymous users) are still saved so
 * they show up in the list, but cannot be auto-resolved across servers.
 */

import { load } from "@tauri-apps/plugin-store";

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

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCodePoint(b);
  return btoa(s);
}

export function base64ToBytes(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.codePointAt(i) ?? 0;
  return out;
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
}): Promise<boolean> {
  const friends = await getFriends();
  return friends.some((f) => isSameFriend(f, opts));
}

function isSameFriend(
  a: Pick<Friend, "userHash" | "userName" | "serverId">,
  b: Pick<Friend, "userHash" | "userName" | "serverId">,
): boolean {
  if (a.userHash && b.userHash) return a.userHash === b.userHash;
  if (a.userHash || b.userHash) return false;
  return a.serverId === b.serverId && a.userName === b.userName;
}

/**
 * Adds a friend if not already present.  Returns the newly-created entry,
 * or the existing entry when the friend was already saved.
 */
export async function addFriend(input: {
  userName: string;
  userHash?: string;
  serverId?: string;
  serverLabel?: string;
}): Promise<Friend> {
  const friends = await getFriends();
  const existing = friends.find((f) => isSameFriend(f, input));
  if (existing) return existing;
  const friend: Friend = {
    id: crypto.randomUUID(),
    userName: input.userName,
    userHash: input.userHash,
    serverId: input.serverId,
    serverLabel: input.serverLabel,
    addedAt: Date.now(),
  };
  await saveFriends([...friends, friend]);
  return friend;
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
export async function updateFriendAvatar(
  id: string,
  bytes: number[] | Uint8Array,
): Promise<void> {
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
