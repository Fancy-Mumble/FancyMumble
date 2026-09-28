/**
 * Opening, copying and deleting a notepad: the part of `@core/notepad` that
 * talks to servers and storage.
 *
 * Changing where the notepad lives starts a new one. Copying the old notes
 * across and deleting them from where they were are separate choices, and they
 * run in that order - read, copy, delete - so a copy that fails never costs the
 * originals.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useAppStore } from "./store";
import { TauriEvent } from "./constants/tauriEvents";
import { getPreferences, updatePreferences } from "./preferencesStorage";
import { requestFriendChannel, waitForFriendsRoom } from "./friendsChannel";
import { clearLocalNotes, loadLocalNotes, localNote, saveLocalNotes } from "./localNotes";
import {
  NOTEPAD_CHANGED_EVENT,
  type NotepadLogin,
  type NotepadSettings,
  type ResolvedNotepad,
} from "./notepad";
import type { ChatMessage, SessionMeta } from "./types";

/** Why a notepad change stopped. */
export type NotepadFailure =
  "notConnected" | "notRegistered" | "protocolUnsupported" | "readFailed" | "copyFailed" | "deleteFailed";

export class NotepadError extends Error {
  constructor(
    readonly reason: NotepadFailure,
    detail?: string,
  ) {
    super(detail ?? reason);
  }
}

export interface NotepadAuthor {
  name: string;
  hash?: string | null;
}

export interface NotepadProgress {
  step: "reading" | "copying" | "deleting";
  done: number;
  total: number;
}

export interface NotepadChangeResult {
  copied: number;
  deleted: number;
  /** Notes that could not be deleted because the server never gave them an id. */
  skipped: number;
}

const PAGE_TIMEOUT_MS = 15_000;
const DELETE_BATCH = 50;

export async function getNotepadSettings(): Promise<NotepadSettings | undefined> {
  return (await getPreferences()).notepad;
}

export async function saveNotepadSettings(settings: NotepadSettings): Promise<void> {
  await updatePreferences({ notepad: settings });
  globalThis.dispatchEvent(new CustomEvent(NOTEPAD_CHANGED_EVENT));
}

/** The connected session for one of your logins, or null. */
export function loginSession(
  login: NotepadLogin,
  sessions: readonly SessionMeta[] = useAppStore.getState().sessions,
): SessionMeta | null {
  return (
    sessions.find(
      (session) =>
        session.status === "connected" &&
        session.host === login.host &&
        session.port === login.port &&
        session.username === login.username,
    ) ?? null
  );
}

/** Whether the notepad can be read or written now. One on this device always can. */
export function isNotepadReachable(notepad: NotepadSettings, sessions: readonly SessionMeta[]): boolean {
  return notepad.location.kind === "local" || loginSession(notepad.location, sessions) !== null;
}

/** Open the room behind a server notepad, switching to its server first. Resolves to the channel id. */
export async function openServerNotepad(notepad: ResolvedNotepad): Promise<number> {
  if (notepad.location.kind !== "server") throw new NotepadError("notConnected");
  const session = loginSession(notepad.location);
  if (!session) throw new NotepadError("notConnected");
  const userId = notepad.friend?.userId;
  if (userId == null) throw new NotepadError("notRegistered");

  const store = useAppStore.getState();
  if (store.activeServerId !== session.id) await store.switchServer(session.id);
  // Listening before asking, so an answer quicker than the send cannot be missed.
  const room = waitForFriendsRoom(userId);
  requestFriendChannel(undefined, notepad.protocol);
  const { channelId } = await room;
  // A plugin older than the choice ignores it and answers with the Signal room.
  const protocol = useAppStore
    .getState()
    .channels.find((channel) => channel.id === channelId)?.pchat_protocol;
  if (protocol && protocol !== notepad.protocol) throw new NotepadError("protocolUnsupported");
  return channelId;
}

function withTimeout<T>(promise: Promise<T>, ms: number, error: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = globalThis.setTimeout(() => reject(error()), ms);
    promise.then(
      (value) => {
        globalThis.clearTimeout(timer);
        resolve(value);
      },
      (reason: unknown) => {
        globalThis.clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason)));
      },
    );
  });
}

/** Fetch one page of history older than `beforeId`; resolves to whether there is more. */
async function fetchPage(channelId: number, beforeId: string | undefined): Promise<boolean> {
  let settle: (more: boolean) => void = () => undefined;
  const page = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const unlisten = await listen<{ channel_id: number; has_more: boolean }>(
    TauriEvent.PchatFetchComplete,
    (event) => {
      if (event.payload.channel_id === channelId) settle(event.payload.has_more);
    },
  );
  try {
    await useAppStore.getState().fetchHistory(channelId, beforeId);
    return await withTimeout(
      page,
      PAGE_TIMEOUT_MS,
      () => new NotepadError("readFailed", "history timed out"),
    );
  } finally {
    unlisten();
  }
}

/**
 * Every note in a server notepad, oldest first.
 *
 * Collected page by page into a map rather than read off the backend once at
 * the end: the backend keeps a bounded window of each conversation in memory,
 * so the oldest pages may already be gone from it by the time the last arrives.
 */
async function readServerNotes(channelId: number, onProgress?: (progress: NotepadProgress) => void) {
  const notes = new Map<string, ChatMessage>();
  const collect = async () => {
    const loaded = await invoke<ChatMessage[]>("get_messages", { channelId });
    let added = 0;
    for (const message of loaded) {
      if (message.send_failed || message.plugin_name) continue;
      const key = message.message_id ?? `${message.timestamp ?? ""}|${message.body}`;
      if (notes.has(key)) continue;
      notes.set(key, message);
      added += 1;
    }
    return added;
  };
  const oldestId = () =>
    [...notes.values()]
      .filter((message) => message.message_id)
      .sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0))[0]?.message_id ?? undefined;

  await collect();
  let more = await fetchPage(channelId, oldestId());
  let stalls = 0;
  for (;;) {
    const added = await collect();
    onProgress?.({ step: "reading", done: notes.size, total: notes.size });
    stalls = added === 0 ? stalls + 1 : 0;
    if (!more || stalls >= 2) break;
    more = await fetchPage(channelId, oldestId());
  }
  return [...notes.values()].sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0));
}

async function readNotes(
  notepad: ResolvedNotepad,
  onProgress?: (progress: NotepadProgress) => void,
): Promise<ChatMessage[]> {
  if (notepad.location.kind === "local") return loadLocalNotes();
  try {
    return await readServerNotes(await openServerNotepad(notepad), onProgress);
  } catch (error) {
    if (error instanceof NotepadError) throw error;
    throw new NotepadError("readFailed", String(error));
  }
}

async function writeNotes(
  notepad: ResolvedNotepad,
  notes: readonly ChatMessage[],
  author: NotepadAuthor,
  onProgress?: (progress: NotepadProgress) => void,
): Promise<number> {
  if (notepad.location.kind === "local") {
    const existing = await loadLocalNotes();
    const copies = notes.map((note) => localNote(note.body, author, note.timestamp ?? Date.now()));
    const merged = [...existing, ...copies].sort(
      (left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0),
    );
    await saveLocalNotes(merged);
    if (useAppStore.getState().localNotesOpen) useAppStore.setState({ localNotes: merged });
    return copies.length;
  }

  const channelId = await openServerNotepad(notepad);
  // Straight to the backend rather than through `sendMessage`, which records a
  // failure as a pending bubble instead of throwing - a copy has to stop there.
  for (const [index, note] of notes.entries()) {
    try {
      await invoke("send_message", { channelId, body: note.body });
    } catch (error) {
      throw new NotepadError("copyFailed", String(error));
    }
    onProgress?.({ step: "copying", done: index + 1, total: notes.length });
  }
  void useAppStore.getState().refreshMessages(channelId);
  return notes.length;
}

async function deleteNotes(
  notepad: ResolvedNotepad,
  notes: readonly ChatMessage[],
  onProgress?: (progress: NotepadProgress) => void,
): Promise<{ deleted: number; skipped: number }> {
  if (notepad.location.kind === "local") {
    await clearLocalNotes();
    useAppStore.setState({ localNotes: [] });
    return { deleted: notes.length, skipped: 0 };
  }

  const ids = notes.map((note) => note.message_id).filter((id): id is string => !!id);
  const channelId = await openServerNotepad(notepad);
  for (let start = 0; start < ids.length; start += DELETE_BATCH) {
    const messageIds = ids.slice(start, start + DELETE_BATCH);
    try {
      // signal_v1 keeps no server-side history: the notes are only this
      // device's decrypted copies, so that is what is forgotten.
      if (notepad.protocol === "signal_v1") await invoke("forget_local_messages", { channelId, messageIds });
      else await useAppStore.getState().deletePchatMessages(channelId, { messageIds });
    } catch (error) {
      throw new NotepadError("deleteFailed", String(error));
    }
    onProgress?.({ step: "deleting", done: Math.min(start + DELETE_BATCH, ids.length), total: ids.length });
  }
  if (notepad.protocol === "signal_v1") void useAppStore.getState().refreshMessages(channelId);
  return { deleted: ids.length, skipped: notes.length - ids.length };
}

/**
 * Carry out what a notepad change asked for besides the change itself.
 *
 * The notes are read once, before anything is written, so the copy and the
 * delete act on the same set - a note written to the old notepad mid-change is
 * neither copied nor deleted.
 */
export async function changeNotepad(options: {
  from: ResolvedNotepad;
  to: ResolvedNotepad;
  copy: boolean;
  deleteOld: boolean;
  author: NotepadAuthor;
  onProgress?: (progress: NotepadProgress) => void;
}): Promise<NotepadChangeResult> {
  const { from, to, copy, deleteOld, author, onProgress } = options;
  if (!copy && !deleteOld) return { copied: 0, deleted: 0, skipped: 0 };
  onProgress?.({ step: "reading", done: 0, total: 0 });
  const notes = await readNotes(from, onProgress);
  const copied = copy ? await writeNotes(to, notes, author, onProgress) : 0;
  const { deleted, skipped } = deleteOld
    ? await deleteNotes(from, notes, onProgress)
    : { deleted: 0, skipped: 0 };
  return { copied, deleted, skipped };
}
