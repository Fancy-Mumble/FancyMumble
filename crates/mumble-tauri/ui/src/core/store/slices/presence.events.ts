/**
 * Discord Rich Presence Tauri event listener.
 *
 * The backend emits the whole picture on every change rather than deltas -
 * the list is a handful of entries at most, so reconciling by id would be
 * more code than it saves. Split out of `store.ts` in the same style as
 * {@link registerPersistentChatEvents}; `initEventListeners` calls this with
 * its `unlisteners` array.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "..";
import { TauriEvent } from "../../constants/tauriEvents";
import type { PresenceSnapshot } from "../../types";

export async function registerPresenceEvents(unlisteners: UnlistenFn[]): Promise<void> {
  unlisteners.push(
    await listen<PresenceSnapshot>(TauriEvent.RichPresenceChanged, (event) => {
      useAppStore.getState().applyRichPresence(event.payload);
    }),
  );

  // The listener may already have been started from persisted preferences
  // before the frontend existed, so pull the current picture rather than
  // waiting for the next application to change its activity.
  void useAppStore.getState().refreshRichPresence();
}
