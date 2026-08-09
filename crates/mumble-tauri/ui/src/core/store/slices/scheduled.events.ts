/**
 * Scheduled-messages Tauri event listeners.
 *
 * Split out of `store.ts` in the same style as
 * {@link registerPersistentChatEvents} / {@link registerPresenceEvents};
 * `initEventListeners` calls this with its `unlisteners` array.
 */

import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useAppStore } from "..";
import { TauriEvent } from "../../constants/tauriEvents";
import type { ScheduledAck, ScheduledMessage } from "./scheduled";

export async function registerScheduledEvents(unlisteners: UnlistenFn[]): Promise<void> {
  unlisteners.push(
    await listen<{ messages: ScheduledMessage[] }>(TauriEvent.FancyScheduledMessageList, (event) => {
      useAppStore.getState().applyScheduledMessageList(event.payload.messages);
    }),
  );
  unlisteners.push(
    await listen<ScheduledAck>(TauriEvent.FancyScheduledMessageAck, (event) => {
      useAppStore.getState().applyScheduledMessageAck(event.payload);
      // Refresh the pending list after any schedule / cancel outcome.
      void useAppStore.getState().listScheduledMessages();
    }),
  );
}
