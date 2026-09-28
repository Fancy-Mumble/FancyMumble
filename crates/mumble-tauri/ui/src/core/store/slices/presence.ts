/**
 * Discord Rich Presence slice: what other applications on this machine are
 * currently advertising, plus the listener's own status.
 *
 * Deliberately outside the root `INITIAL`: this is local-machine state that
 * has nothing to do with the Mumble connection, so a disconnect must not
 * clear it.
 */

import { invoke } from "@tauri-apps/api/core";
import type { StateCreator } from "zustand";
import type { PresenceEntry, PresenceSnapshot, PresenceStatus } from "../../types";
import type { AppState } from "..";

/** Status shown before the backend has answered, and after it is switched off. */
export const PRESENCE_DISABLED: PresenceStatus = { enabled: false, bridgeState: null, slot: null };

export interface PresenceSlice {
  /** Live presence, oldest connection first. */
  richPresence: PresenceEntry[];
  /** Whether the listener is running and how it relates to Discord. */
  richPresenceStatus: PresenceStatus;

  /** Replace the whole picture from a backend snapshot or event. */
  applyRichPresence: (snapshot: PresenceSnapshot) => void;
  /** Ask the backend for the current picture (initial load, or after a reload). */
  refreshRichPresence: () => Promise<void>;
  /** Turn the listener on or off and store the resulting status. */
  setRichPresenceEnabled: (enabled: boolean, resolveArtwork: boolean) => Promise<void>;
}

/** State-only portion of {@link PresenceSlice}. */
type PresenceState = Pick<PresenceSlice, "richPresence" | "richPresenceStatus">;

/** Default presence state. Not part of `INITIAL` - see the module comment. */
export const presenceInitialState: PresenceState = {
  richPresence: [],
  richPresenceStatus: PRESENCE_DISABLED,
};

export const createPresenceSlice: StateCreator<AppState, [], [], PresenceSlice> = (set) => ({
  ...presenceInitialState,

  applyRichPresence: (snapshot) => {
    set({ richPresence: snapshot.entries, richPresenceStatus: snapshot.status });
  },

  refreshRichPresence: async () => {
    try {
      const snapshot = await invoke<PresenceSnapshot>("presence_snapshot");
      set({ richPresence: snapshot.entries, richPresenceStatus: snapshot.status });
    } catch (e) {
      // Absent on Android, where there is no Discord IPC endpoint to host.
      console.debug("presence_snapshot unavailable:", e);
      set({ richPresence: [], richPresenceStatus: PRESENCE_DISABLED });
    }
  },

  setRichPresenceEnabled: async (enabled, resolveArtwork) => {
    try {
      const status = await invoke<PresenceStatus>("presence_set_enabled", {
        enabled,
        resolveArtwork,
      });
      set((s) => ({
        richPresenceStatus: status,
        richPresence: status.enabled ? s.richPresence : [],
      }));
    } catch (e) {
      console.error("presence_set_enabled error:", e);
      set({ richPresenceStatus: PRESENCE_DISABLED, richPresence: [] });
    }
  },
});
