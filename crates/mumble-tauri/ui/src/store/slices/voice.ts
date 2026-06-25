/**
 * Voice store slice: local voice/transport state (active/muted/deafened,
 * UDP-vs-TCP, in-call, who's talking, which channels are being listened to)
 * and the toggle actions.
 *
 * Part of the `store.ts` split. `AppState` is imported type-only. The
 * reconnect-restore guard `isRestoringVoice` is a live binding imported from
 * the root store (the voice-state event handler there owns its mutation; here
 * it's only read inside `toggleMute`).
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { VoiceState } from "../../types";
import type { AppState } from "../../store";
import { isRestoringVoice } from "../../store";
import { updatePreferences } from "../../preferencesStorage";

export interface VoiceSlice {
  voiceState: VoiceState;
  /** True when audio is transported over UDP (false = TCP tunnel). */
  udpActive: boolean;
  /** True while the user is in an active mobile call session. */
  inCall: boolean;
  /** Session IDs of users currently transmitting audio (talking). */
  talkingSessions: Set<number>;
  /** Channels the local user is listening to (without being a member). */
  listenedChannels: Set<number>;

  toggleListen: (channelId: number) => Promise<void>;
  enableVoice: () => Promise<void>;
  disableVoice: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleDeafen: () => Promise<void>;
}

/** State-only portion of {@link VoiceSlice}. */
type VoiceState_ = Pick<
  VoiceSlice,
  "voiceState" | "udpActive" | "inCall" | "talkingSessions" | "listenedChannels"
>;

/** Default voice state (also spread into the root `INITIAL` for resets). */
export const voiceInitialState: VoiceState_ = {
  voiceState: "inactive",
  udpActive: false,
  inCall: false,
  talkingSessions: new Set<number>(),
  listenedChannels: new Set<number>(),
};

export const createVoiceSlice: StateCreator<AppState, [], [], VoiceSlice> = (set, get) => ({
  ...voiceInitialState,

  toggleListen: async (channelId) => {
    try {
      const isNowListened = await invoke<boolean>("toggle_listen", {
        channelId,
      });
      set((prev) => {
        const next = new Set(prev.listenedChannels);
        if (isNowListened) next.add(channelId);
        else next.delete(channelId);
        return { listenedChannels: next };
      });
    } catch (e) {
      console.error("toggle_listen error:", e);
    }
  },

  enableVoice: async () => {
    try {
      await invoke("enable_voice");
      set({ voiceState: "active", inCall: true });
      updatePreferences({ voiceOnReconnect: true }).catch(() => {});
    } catch (e) {
      console.error("enable_voice error:", e);
    }
  },

  disableVoice: async () => {
    try {
      await invoke("disable_voice");
      set({ voiceState: "inactive", inCall: false, talkingSessions: new Set() });
      updatePreferences({ voiceOnReconnect: false, voiceMutedOnReconnect: false }).catch(() => {});
    } catch (e) {
      console.error("disable_voice error:", e);
    }
  },

  toggleMute: async () => {
    // Capture state BEFORE the await so pref write is deterministic and
    // ordered relative to the user action, not the async Rust IPC delivery.
    // "active" -> will be muted; "muted" or "inactive" -> will be active.
    const willBeMuted = get().voiceState === "active";
    try {
      await invoke("toggle_mute");
      if (!isRestoringVoice) {
        updatePreferences({ voiceOnReconnect: true, voiceMutedOnReconnect: willBeMuted }).catch(() => {});
      }
    } catch (e) {
      console.error("toggle_mute error:", e);
    }
  },

  toggleDeafen: async () => {
    try {
      await invoke("toggle_deafen");
    } catch (e) {
      console.error("toggle_deafen error:", e);
    }
  },
});
