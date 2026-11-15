/**
 * The signal-bridge add-on: whether the library behind Signal (SIGNAL_V1)
 * channels is present, and installing it when it is not.
 *
 * Installers do not bundle the bridge (it is AGPL, the app is not), so the
 * client offers to download it from the project's GitHub releases. The host
 * pins the version, checks the signature, and loads it into every connected
 * session, so an open Signal channel starts working without a reconnect.
 *
 * Shared by the channel banner/prompt and the Plugins settings page, so both
 * see one install in flight rather than racing two.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { create } from "zustand";
import { TauriEvent } from "./constants/tauriEvents";

export interface SignalBridgeStatus {
  /** A bridge library is present where the loader looks. */
  readonly installed: boolean;
  /** Downloaded add-on, or shipped with the app (dev build, distro, Android). */
  readonly source: "addon" | "packaged" | null;
  /** This build can download the add-on for this platform. */
  readonly downloadable: boolean;
  /** The bridge version this client loads. */
  readonly version: string;
}

interface SignalBridgeAddonState {
  status: SignalBridgeStatus | null;
  installing: boolean;
  /** Percent downloaded, while the size is known. */
  progress: number | null;
  error: string | null;
  /** The channel prompt opens by itself once per run, not on every visit. */
  prompted: boolean;
  refresh: () => Promise<void>;
  install: () => Promise<boolean>;
  markPrompted: () => void;
}

export const useSignalBridgeAddon = create<SignalBridgeAddonState>((set, get) => ({
  status: null,
  installing: false,
  progress: null,
  error: null,
  prompted: false,

  refresh: async () => {
    try {
      set({ status: await invoke<SignalBridgeStatus>("signal_bridge_status") });
    } catch (e) {
      console.warn("[signal-bridge] status failed:", e);
    }
  },

  install: async () => {
    if (get().installing) return false;
    set({ installing: true, progress: null, error: null });
    const unlisten = await listen<{ received: number; total: number | null }>(
      TauriEvent.SignalBridgeDownloadProgress,
      ({ payload }) => {
        if (payload.total) set({ progress: Math.floor((payload.received * 100) / payload.total) });
      },
    );
    try {
      const status = await invoke<SignalBridgeStatus>("install_signal_bridge");
      // The host's `signal-bridge-installed` clears the channel banner.
      set({ status, installing: false, progress: null });
      return true;
    } catch (e) {
      set({ installing: false, progress: null, error: String(e) });
      return false;
    } finally {
      unlisten();
    }
  },

  markPrompted: () => set({ prompted: true }),
}));
