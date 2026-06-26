/**
 * Direct-message (DM) store slice: the currently-viewed DM conversation, its
 * messages, and per-user unread counts, plus the select/send/refresh actions.
 *
 * Part of the `store.ts` split (see `./persistentChat.ts` for the pattern).
 * `AppState` is imported type-only; the shared `newPendingId` /
 * `bodyNeedsProgressUI` helpers are imported from the root store (used only
 * inside action bodies, so the cycle is eval-safe). DM-persistence merging
 * (`applyDmPersistence`) is DM-only and lives here.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { ChatMessage, UserEntry } from "../../types";
import type { AppState } from "../../store";
import { newPendingId, bodyNeedsProgressUI } from "../../store";
import { requestFriendChannel, FRIENDS_PLUGIN } from "../../friendsChannel";
import {
  friendKeyFor as dmFriendKeyFor,
  isDmPersistenceEnabled,
  loadDmHistory,
  mergeMessages as mergeDmMessages,
  saveDmHistory,
} from "../../dmStorage";

/**
 * Merges newly-fetched remote DM messages with the encrypted on-device
 * history (when the user has enabled DM persistence) and writes the
 * merged log back.  When persistence is disabled the remote messages
 * are returned unchanged.
 */
async function applyDmPersistence(
  state: { users: UserEntry[]; activeServerId: string | null },
  session: number,
  remote: ChatMessage[],
): Promise<ChatMessage[]> {
  if (!(await isDmPersistenceEnabled())) return remote;
  const user = state.users.find((u) => u.session === session);
  if (!user) return remote;
  const key = dmFriendKeyFor({ hash: user.hash, name: user.name }, state.activeServerId);
  const persisted = await loadDmHistory(key);
  const merged = mergeDmMessages(persisted, remote);
  void saveDmHistory(key, merged);
  return merged;
}

export interface DmSlice {
  /** Session ID of the user whose DM chat is currently viewed. */
  selectedDmUser: number | null;
  /** DM messages for the currently viewed conversation. */
  dmMessages: ChatMessage[];
  /** DM unread counts keyed by user session. */
  dmUnreadCounts: Record<number, number>;
  /** Registered peer `user_id` -> the detached signal channel that hosts the
   *  E2E, persisted friend chat with them (resolved via the `fancy-friends`
   *  plugin). Lets a re-opened chat jump straight to the channel. */
  friendChannels: Record<number, number>;

  selectDmUser: (session: number) => Promise<void>;
  sendDm: (targetSession: number, body: string) => Promise<void>;
  refreshDmMessages: (session: number) => Promise<void>;
  /** Record the channel the `fancy-friends` plugin provisioned for a peer. */
  bindFriendChannel: (peerUserId: number, channelId: number) => void;
}

/** State-only portion of {@link DmSlice}. */
type DmState = Pick<DmSlice, "selectedDmUser" | "dmMessages" | "dmUnreadCounts" | "friendChannels">;

/** Default DM state (single source of truth; also spread into the root `INITIAL`
 *  so `reset()` / disconnect / switchServer clear it). */
export const dmInitialState: DmState = {
  selectedDmUser: null,
  dmMessages: [],
  dmUnreadCounts: {},
  friendChannels: {},
};

export const createDmSlice: StateCreator<AppState, [], [], DmSlice> = (set, get) => ({
  ...dmInitialState,

  selectDmUser: async (session) => {
    // Toggle: clicking the currently-selected DM user a second time
    // switches back to the channel the local user is currently in.
    const { selectedDmUser, currentChannel, selectChannel } = get();
    if (selectedDmUser === session) {
      if (currentChannel == null) {
        set({ selectedDmUser: null, dmMessages: [], selectedUser: null });
      } else {
        await selectChannel(currentChannel);
        set({ selectedUser: null });
      }
      return;
    }
    set({ selectedDmUser: session, selectedChannel: null, messages: [], selectedUser: session });
    try {
      await invoke("select_dm_user", { session });
      const remote = await invoke<ChatMessage[]>("get_dm_messages", { session });
      const dmMessages = await applyDmPersistence(get(), session, remote);
      set({ dmMessages });
    } catch (e) {
      console.error("select_dm_user error:", e);
    }

    // Upgrade to an E2E persisted channel when possible: a friend chat between
    // two *registered* users is backed by a detached signal_v1 channel via the
    // `fancy-friends` plugin. We've already shown the classic DM above as the
    // optimistic fallback; if the peer is registered and the plugin is present,
    // bind/switch to the channel (the inbound `friends.room` does the switch).
    // Unregistered peer / no plugin / no response -> the classic DM stands.
    const st = get();
    const peerUserId = st.users.find((u) => u.session === session)?.user_id;
    if (peerUserId != null && st.pluginInfos.has(FRIENDS_PLUGIN)) {
      const bound = st.friendChannels[peerUserId];
      if (bound != null) {
        // Read the friend room without joining it (idempotent: re-fetches history
        // + re-passes the key challenge only if not already done this session).
        void st.peekChannel(bound);
        st.selectChannel(bound);
      } else {
        requestFriendChannel(peerUserId);
      }
    }
  },

  sendDm: async (targetSession, body) => {
    const pendingId = newPendingId();
    const showPlaceholder = bodyNeedsProgressUI(body);
    if (showPlaceholder) {
      set((s) => ({
        pendingMessages: [
          ...s.pendingMessages,
          {
            pendingId,
            channelId: null,
            dmSession: targetSession,
            body,
            createdAt: Date.now(),
            state: "sending",
          },
        ],
      }));
    }
    try {
      await invoke("send_dm", { targetSession, body });
      const remote = await invoke<ChatMessage[]>("get_dm_messages", { session: targetSession });
      const dmMessages = await applyDmPersistence(get(), targetSession, remote);
      if (showPlaceholder) {
        set((s) => ({
          dmMessages,
          pendingMessages: s.pendingMessages.filter((p) => p.pendingId !== pendingId),
        }));
      } else {
        set({ dmMessages });
      }
    } catch (e) {
      console.error("send_dm error:", e);
      if (showPlaceholder) {
        const detail = e instanceof Error ? e.message : String(e);
        set((s) => ({
          pendingMessages: s.pendingMessages.map((p) =>
            p.pendingId === pendingId
              ? { ...p, state: "failed" as const, errorMessage: detail }
              : p,
          ),
        }));
      }
    }
  },

  refreshDmMessages: async (session) => {
    try {
      const remote = await invoke<ChatMessage[]>("get_dm_messages", { session });
      const dmMessages = await applyDmPersistence(get(), session, remote);
      set({ dmMessages });
    } catch (e) {
      console.error("refresh dm messages error:", e);
    }
  },

  bindFriendChannel: (peerUserId, channelId) => {
    set((s) => ({ friendChannels: { ...s.friendChannels, [peerUserId]: channelId } }));
  },
});
