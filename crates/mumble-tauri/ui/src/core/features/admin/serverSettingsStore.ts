/**
 * Editable server-settings store.
 *
 * Backed by `FancyServerSettings` (wire ID 152) which the server broadcasts to
 * root-Write admins after ServerSync and re-broadcasts whenever a setting (or
 * the set of loaded plugins) changes.  The admin edits are sent back via
 * `save_server_settings` (wire ID 153 `FancyServerSettingsUpdate`).
 *
 * An epoch-1 server (Starling) does not broadcast: it answers a query, on the
 * same service that carries the livery.  So `load` asks, and waits for the
 * answer to arrive on the `server-settings` event rather than calling an
 * unanswered question "this server has no settings" - which is what the screen
 * reported to admins of servers that have them.
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

/**
 * How long a query gets before "no answer" becomes the answer.
 *
 * A ceiling rather than a delay: the wait ends the moment a snapshot lands, and
 * this only bounds the case where none ever does - a server that does not carry
 * the settings at all, or a session without the permission to read them, both
 * of which answer with silence.
 */
export const ANSWER_TIMEOUT_MS = 3000;

/** Resolves when a snapshot arrives, or when waiting for one stops being fair. */
function answered(): Promise<void> {
  // The answer can beat the subscription: the query resolves once the frame is
  // queued, and the event carrying the reply is handled on the same loop.
  if (useServerSettingsStore.getState().snapshot) return Promise.resolve();

  let unsubscribe: (() => void) | undefined;
  const arrival = new Promise<void>((resolve) => {
    unsubscribe = useServerSettingsStore.subscribe((state) => {
      if (state.snapshot) resolve();
    });
  });
  const elapsed = new Promise<void>((resolve) => {
    setTimeout(resolve, ANSWER_TIMEOUT_MS);
  });
  return Promise.race([arrival, elapsed]).finally(() => unsubscribe?.());
}

export const useServerSettingsStore = create<ServerSettingsStoreState>((set) => ({
  snapshot: null,
  busy: false,
  error: null,

  setSnapshot: (snapshot) => set({ snapshot }),
  clear: () => set({ snapshot: null, busy: false, error: null }),

  load: async () => {
    try {
      const cached = await invoke<ServerSettingsSnapshot | null>("get_server_settings");
      if (cached) {
        set({ snapshot: cached });
        return;
      }
      set({ snapshot: null });
      await invoke("request_server_settings");
      await answered();
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
