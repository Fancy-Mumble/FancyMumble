/**
 * Friend-chat channel client: drives the server-side `fancy-friends` plugin that
 * backs a friend DM (or a self-notepad) with a **detached, end-to-end-encrypted
 * (`signal_v1`), persisted channel** between two registered users.
 *
 * Flow: `requestFriendChannel(targetUserId)` asks the plugin to create-or-find
 * the pair's channel; the server replies `friends.room { peerUserId, channelId }`
 * which the store turns into a `joinChannel` + `selectChannel` (so the friend
 * chat *is* that channel - E2E, persisted, channel-only history). When the peer
 * isn't registered, the plugin isn't present, or provisioning doesn't resolve,
 * the caller falls back to a classic (non-persisted) direct message.
 */
import { sendPluginMessage } from "./store/plugins";
import type { NotepadProtocol } from "./notepad";

/** Stable plugin identifier (matches the plugin's `PluginInfo` name). */
export const FRIENDS_PLUGIN = "fancy-friends";
/** Client -> plugin: open (create-or-find) the DM room for a friend pair. */
export const MSG_FRIENDS_OPEN = "friends.open";
/** Plugin -> client: the channel hosting a friend chat. */
export const MSG_FRIENDS_ROOM = "friends.room";

/** Fired with the {@link FriendsRoomDetail} whenever a `friends.room` lands. */
export const FRIENDS_ROOM_EVENT = "fancy:friends-room";

/** Inbound `friends.room` payload. */
export interface FriendsRoomDetail {
  /** The registered user id of the *other* side of the chat (self == own id). */
  readonly peerUserId: number;
  /** The detached signal channel hosting the chat. */
  readonly channelId: number;
}

/**
 * Ask the `fancy-friends` plugin to provision (or locate) the detached
 * `signal_v1` channel for a chat with `targetUserId`. Omit `targetUserId` for a
 * self-notepad, whose `protocol` picks which of your notepad rooms opens (a
 * server whose plugin predates the choice ignores it and opens the Signal one).
 * No-op-safe: if the plugin is absent the server simply drops the message and
 * no `friends.room` arrives, so the caller's classic-DM fallback stands.
 */
export function requestFriendChannel(targetUserId?: number, protocol?: NotepadProtocol): void {
  const payload = typeof targetUserId === "number" ? { targetUserId } : protocol ? { protocol } : {};
  void sendPluginMessage(FRIENDS_PLUGIN, MSG_FRIENDS_OPEN, payload).catch((e) => {
    console.error("[friends] sendPluginMessage failed:", e);
  });
}

/** The next `friends.room` for `peerUserId`, or a rejection after `timeoutMs`. */
export function waitForFriendsRoom(peerUserId: number, timeoutMs = 10_000): Promise<FriendsRoomDetail> {
  return new Promise((resolve, reject) => {
    const onRoom = (event: Event) => {
      const room = (event as CustomEvent<FriendsRoomDetail>).detail;
      if (room.peerUserId !== peerUserId) return;
      done();
      resolve(room);
    };
    const timer = globalThis.setTimeout(() => {
      done();
      reject(new Error("the server did not open the notepad"));
    }, timeoutMs);
    const done = () => {
      globalThis.clearTimeout(timer);
      globalThis.removeEventListener(FRIENDS_ROOM_EVENT, onRoom);
    };
    globalThis.addEventListener(FRIENDS_ROOM_EVENT, onRoom);
  });
}

/** Parse an inbound `friends.room` payload, or null if malformed. */
export function parseFriendsRoom(data: Record<string, unknown>): FriendsRoomDetail | null {
  const peerUserId = data.peerUserId;
  const channelId = data.channelId;
  if (typeof peerUserId !== "number" || typeof channelId !== "number") return null;
  return { peerUserId, channelId };
}
