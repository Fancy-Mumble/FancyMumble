/**
 * The notepad kept on this device.
 *
 * Stored through `dmStorage`, so it is encrypted at rest with the same on-device
 * key. Unlike saved direct messages it is not gated on `persistDms`: keeping
 * notes locally is the whole point of choosing this location.
 */

import type { ChatMessage } from "./types";
import { clearDmHistory, loadDmHistory, saveDmHistory } from "./dmStorage";
import { LOCAL_NOTES_CHANNEL_ID } from "./notepad";

const STORAGE_KEY = "notepad:local";

export function loadLocalNotes(): Promise<ChatMessage[]> {
  return loadDmHistory(STORAGE_KEY);
}

export function saveLocalNotes(notes: ChatMessage[]): Promise<void> {
  return saveDmHistory(STORAGE_KEY, notes);
}

export function clearLocalNotes(): Promise<void> {
  return clearDmHistory(STORAGE_KEY);
}

/** A note as the conversation pane draws it. */
export function localNote(
  body: string,
  author: { name: string; hash?: string | null },
  timestamp = Date.now(),
): ChatMessage {
  return {
    sender_session: null,
    sender_name: author.name,
    sender_hash: author.hash ?? null,
    body,
    channel_id: LOCAL_NOTES_CHANNEL_ID,
    is_own: true,
    message_id: crypto.randomUUID(),
    timestamp,
  };
}
