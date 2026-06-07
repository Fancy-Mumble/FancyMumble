/**
 * Editable server-settings store.
 *
 * Backed by `FancyServerSettings` (wire ID 152) which the server broadcasts to
 * root-Write admins after ServerSync and re-broadcasts whenever a setting (or
 * the set of loaded plugins) changes.  The admin edits are sent back via
 * `save_server_settings` (wire ID 153 `FancyServerSettingsUpdate`).
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { ServerSetting, ServerSettingsSnapshot } from "../../types";

interface ServerSettingsStoreState {
  /** Latest snapshot advertised by the server, or null if none. */
  snapshot: ServerSettingsSnapshot | null;
  /** True while a save is in flight. */
  busy: boolean;
  /** Last error message from a save/load. */
  error: string | null;

  setSnapshot: (snapshot: ServerSettingsSnapshot | null) => void;
  clear: () => void;
  /** Pull the cached snapshot from the backend (e.g. on tab mount / HMR). */
  load: () => Promise<void>;
  /** Admin path: send changed settings to the server to apply at runtime. */
  save: (changed: ServerSetting[]) => Promise<void>;
}

export const useServerSettingsStore = create<ServerSettingsStoreState>((set) => ({
  snapshot: null,
  busy: false,
  error: null,

  setSnapshot: (snapshot) => set({ snapshot }),
  clear: () => set({ snapshot: null, busy: false, error: null }),

  load: async () => {
    try {
      const snapshot = await invoke<ServerSettingsSnapshot | null>("get_server_settings");
      set({ snapshot: snapshot ?? null });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  save: async (changed) => {
    set({ busy: true, error: null });
    try {
      await invoke("save_server_settings", { changed });
      // The server re-broadcasts the stamped snapshot; until then keep busy off.
      set({ busy: false });
    } catch (e) {
      set({ busy: false, error: String(e) });
      throw e;
    }
  },
}));
