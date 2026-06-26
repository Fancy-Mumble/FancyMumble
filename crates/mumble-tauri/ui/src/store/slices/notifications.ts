/**
 * Notification / per-channel preference slice: silenced channels, push-mute,
 * push-subscription set, and per-user volume overrides.
 *
 * Part of the `store.ts` split. State is set both here and elsewhere
 * (`pushSubscribedChannels` is populated on connect); the shared
 * `updateBadgeCount` helper is imported from the root store. Persistence goes
 * through the per-server `preferencesStorage` setters.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { AppState } from "../../store";
import { updateBadgeCount } from "../../store";
import {
  setSilencedChannel,
  setMutedPushChannel,
  saveUserVolume,
} from "../../preferencesStorage";

export interface NotificationsSlice {
  /** Channel IDs silenced for the current server (notifications suppressed). */
  silencedChannels: Set<number>;
  /** Channel IDs with push notifications disabled (synced to server). */
  mutedPushChannels: Set<number>;
  /** Channel IDs we are push-subscribed to (have SubscribePush permission). */
  pushSubscribedChannels: Set<number>;
  /** Per-user volume overrides keyed by cert hash (0-200, default 100). */
  userVolumes: Record<string, number>;

  toggleSilenceChannel: (channelId: number) => Promise<boolean>;
  isChannelSilenced: (channelId: number) => boolean;
  toggleMutePushChannel: (channelId: number) => Promise<boolean>;
  isPushChannelMuted: (channelId: number) => boolean;
  setUserVolume: (hash: string, volume: number) => void;
}

/** State-only portion of {@link NotificationsSlice}. */
type NotificationsState = Pick<
  NotificationsSlice,
  "silencedChannels" | "mutedPushChannels" | "pushSubscribedChannels" | "userVolumes"
>;

/** Default notification state (also spread into the root `INITIAL` for resets). */
export const notificationsInitialState: NotificationsState = {
  silencedChannels: new Set<number>(),
  mutedPushChannels: new Set<number>(),
  pushSubscribedChannels: new Set<number>(),
  userVolumes: {},
};

export const createNotificationsSlice: StateCreator<AppState, [], [], NotificationsSlice> = (
  set,
  get,
) => ({
  ...notificationsInitialState,

  toggleSilenceChannel: async (channelId) => {
    const { silencedChannels, pendingConnect } = get();
    if (!pendingConnect) return false;
    const serverKey = `${pendingConnect.host}:${pendingConnect.port}`;
    const isSilenced = silencedChannels.has(channelId);
    const updated = await setSilencedChannel(serverKey, channelId, !isSilenced);
    set({ silencedChannels: new Set(updated) });
    updateBadgeCount();
    return !isSilenced;
  },

  isChannelSilenced: (channelId) => {
    return get().silencedChannels.has(channelId);
  },

  toggleMutePushChannel: async (channelId) => {
    const { mutedPushChannels, pendingConnect } = get();
    if (!pendingConnect) return false;
    const serverKey = `${pendingConnect.host}:${pendingConnect.port}`;
    const isMuted = mutedPushChannels.has(channelId);
    const updated = await setMutedPushChannel(serverKey, channelId, !isMuted);
    set({ mutedPushChannels: new Set(updated) });

    // Sync the muted list to the server via native proto message.
    try {
      await invoke("send_push_update", { mutedChannels: updated });
    } catch (e) {
      console.error("Failed to sync push mute to server:", e);
    }

    return !isMuted;
  },

  isPushChannelMuted: (channelId) => {
    return get().mutedPushChannels.has(channelId);
  },

  setUserVolume: (hash, volume) => {
    const next = { ...get().userVolumes };
    if (volume === 100) {
      delete next[hash];
    } else {
      next[hash] = volume;
    }
    set({ userVolumes: next });
    saveUserVolume(hash, volume).catch((err) =>
      console.error("saveUserVolume failed:", err),
    );
  },
});
