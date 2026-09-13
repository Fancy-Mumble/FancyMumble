/**
 * Voice store slice: local voice/transport state (active/muted/deafened,
 * UDP-vs-TCP, in-call, who's talking, which channels are being listened to)
 * and the toggle actions.
 *
 * Part of the `store.ts` split. `AppState` is imported type-only.
 *
 * None of these actions writes the on-reconnect preference itself. They ask
 * `persistVoiceState` (in the root store) to record whatever the voice state
 * settles to, which is also what the `voice-state-changed` listener does - one
 * writer, so a slow action's write can no longer land after a newer one and
 * undo it. `disableVoice` is the exception, and says why there.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { VoiceState } from "../../types";
import type { AppState } from "..";
import { cancelVoicePersist, persistVoiceState } from "..";
import { updatePreferences } from "../../preferencesStorage";

export interface VoiceSlice {
  voiceState: VoiceState;
  /** True when audio is transported over UDP (false = TCP tunnel). */
  udpActive: boolean;
  /**
   * Name of the cipher encrypting UDP audio ("OCB2-AES128" on a stock server,
   * "XChaCha20-Poly1305" on Fancy 0.4.0+). Null on the TCP tunnel.
   */
  udpCipher: string | null;
  /** True while the user is in an active mobile call session. */
  inCall: boolean;
  /** Session IDs of users currently transmitting audio (talking). */
  talkingSessions: Set<number>;
  /**
   * How each talking user's audio reaches us, by session: the server's voice
   * context (0 in-channel, 1 shout, 2 whisper, 3 listen). Dropped when the
   * user stops talking.
   */
  voiceContexts: Map<number, number>;
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
  "voiceState" | "udpActive" | "udpCipher" | "inCall" | "talkingSessions" | "voiceContexts" | "listenedChannels"
>;

/** Default voice state (also spread into the root `INITIAL` for resets). */
export const voiceInitialState: VoiceState_ = {
  voiceState: "inactive",
  udpActive: false,
  udpCipher: null,
  inCall: false,
  talkingSessions: new Set<number>(),
  voiceContexts: new Map<number, number>(),
  listenedChannels: new Set<number>(),
};

/** The voice contexts the roster marks. */
export const VOICE_CONTEXT_SHOUT = 1;
export const VOICE_CONTEXT_WHISPER = 2;

/**
 * Which cue a voice context earns, if any. In-channel speech and a channel
 * listen sound like what they are; a whisper and a shout do not, and answering
 * one out loud is answering it in front of the whole room.
 */
export function voiceContextKind(context: number | undefined): "whisper" | "shout" | null {
  if (context === VOICE_CONTEXT_WHISPER) return "whisper";
  if (context === VOICE_CONTEXT_SHOUT) return "shout";
  return null;
}

export const createVoiceSlice: StateCreator<AppState, [], [], VoiceSlice> = (set) => ({
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
      persistVoiceState();
    } catch (e) {
      console.error("enable_voice error:", e);
    }
  },

  disableVoice: async () => {
    try {
      await invoke("disable_voice");
      set({ voiceState: "inactive", inCall: false, talkingSessions: new Set(), voiceContexts: new Map() });
      // The one preference `persistVoiceState` will not write: it refuses to
      // record "inactive", because a disconnect reports the same thing and a
      // teardown is not a decision. Turning voice off here *is* the decision,
      // so it is written by hand - and anything already queued is dropped
      // first, or it would turn voice back on for the next connect.
      cancelVoicePersist();
      updatePreferences({ voiceOnReconnect: false, voiceMutedOnReconnect: false }).catch(() => {});
    } catch (e) {
      console.error("disable_voice error:", e);
    }
  },

  toggleMute: async () => {
    try {
      await invoke("toggle_mute");
      // What the mute *became* is the backend's answer, delivered as a
      // `voice-state-changed` event; this only asks for the write, and the
      // debounce means whichever of the two arrives last is what decides.
      persistVoiceState();
    } catch (e) {
      console.error("toggle_mute error:", e);
    }
  },

  toggleDeafen: async () => {
    try {
      await invoke("toggle_deafen");
      // Deafening mutes as well, so it moves the state this store remembers.
      persistVoiceState();
    } catch (e) {
      console.error("toggle_deafen error:", e);
    }
  },
});
