/**
 * Yourself, kept in the friends list.
 *
 * Chatting with yourself is a private notepad the `fancy-friends` plugin
 * provisions like any friend pair, so every login you use it on is saved as a
 * friend record (`Friend.self`). Being saved is what keeps it listed after that
 * server is closed, under the server it belongs to, where clicking it offers to
 * connect - the same as any other friend.
 *
 * The record is written from here rather than from a Friends screen so that it
 * exists for every registered login, whichever design is showing.
 */

import { invoke } from "@tauri-apps/api/core";
import { FRIENDS_PLUGIN } from "./friendsChannel";
import { saveSelfFriend, updateFriendAvatar, type SelfFriendInput } from "./friendsStorage";
import type { SessionMeta, UserEntry } from "./types";

/** The part of the app store this watches. */
interface WatchedState {
  activeServerId: string | null;
  sessions: readonly SessionMeta[];
  users: readonly UserEntry[];
  ownSession: number | null;
  pluginInfos: ReadonlyMap<string, unknown>;
}

interface WatchedStore {
  getState(): WatchedState;
  subscribe(listener: (state: WatchedState) => void): () => void;
}

/** Your self-friend record for `session`, or null for a guest, who has no
 *  registered id to name a notepad after. */
export function selfFriendInput(session: SessionMeta, ownUser: UserEntry | null): SelfFriendInput | null {
  if (ownUser?.user_id == null || ownUser.user_id < 0) return null;
  return {
    userName: ownUser.name,
    userId: ownUser.user_id,
    ...(ownUser.hash ? { userHash: ownUser.hash } : {}),
    serverId: session.id,
    ...(session.label ? { serverLabel: session.label } : {}),
    serverHost: session.host,
    serverPort: session.port,
    serverUsername: session.username,
    serverCertLabel: session.certLabel,
  };
}

/** Keep the active login's self-friend saved. Returns the unsubscribe. */
export function watchSelfFriend(store: WatchedStore): () => void {
  let seen: WatchedState | null = null;
  let lastKey = "";
  let running = false;
  let again = false;

  const syncOnce = async () => {
    const state = store.getState();
    const serverId = state.activeServerId;
    if (serverId === null || !state.pluginInfos.has(FRIENDS_PLUGIN)) return;
    const session = state.sessions.find((entry) => entry.id === serverId);
    if (session?.status !== "connected") return;

    // Not the store's `users` and `ownSession`: a server switch lands them at
    // different moments, and pairing one server's session number with the
    // other's user list would save a stranger as you. The backend answers both
    // about one server; a switch while it answers discards the answer.
    const own = await invoke<number | null>("get_own_session");
    const users = await invoke<UserEntry[]>("get_users");
    if (own === null || store.getState().activeServerId !== serverId) return;

    const ownUser = users.find((user) => user.session === own) ?? null;
    const input = selfFriendInput(session, ownUser);
    if (!input) return;
    const key = JSON.stringify([input, ownUser?.texture_size ?? null]);
    if (key === lastKey) return;

    const saved = await saveSelfFriend(input);
    lastKey = key;
    // Cached so the row keeps your picture while this server is closed.
    const textureSize = ownUser?.texture_size;
    if (!textureSize || saved.avatarSize === textureSize) return;
    const bytes = await invoke<number[] | null>("get_user_texture", { session: own });
    if (bytes && bytes.length > 0 && store.getState().activeServerId === serverId) {
      await updateFriendAvatar(saved.id, bytes);
    }
  };

  const sync = async () => {
    if (running) {
      again = true;
      return;
    }
    running = true;
    try {
      do {
        again = false;
        await syncOnce();
      } while (again);
    } catch (reason) {
      console.warn("saving yourself as a friend failed:", reason);
    } finally {
      running = false;
    }
  };

  const onChange = (state: WatchedState) => {
    if (
      seen?.activeServerId === state.activeServerId &&
      seen.sessions === state.sessions &&
      seen.users === state.users &&
      seen.ownSession === state.ownSession &&
      seen.pluginInfos === state.pluginInfos
    ) {
      return;
    }
    seen = state;
    void sync();
  };

  onChange(store.getState());
  return store.subscribe(onChange);
}
