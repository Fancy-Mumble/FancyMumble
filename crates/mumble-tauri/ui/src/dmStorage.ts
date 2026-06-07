/**
 * Persistent, on-device DM message history.
 *
 * Messages are encrypted with AES-GCM using a 256-bit key generated on
 * first use and stored locally (in `dm-key.json`).  The history itself
 * lives in `dm-history.json`, keyed by a stable friend identifier
 * (`hash:<certHash>` when available, otherwise `anon:<serverId>:<name>`).
 *
 * The store contents are ciphertext + nonce, base64-encoded.  Per-friend
 * history is capped at {@link MAX_MESSAGES_PER_FRIEND} entries to keep
 * the file size bounded; the oldest entries are dropped first.
 *
 * Persistence is gated by the `persistDms` user preference - when
 * disabled, no helpers in this module read or write any data (callers
 * must check {@link isDmPersistenceEnabled} first).
 */

import { load } from "@tauri-apps/plugin-store";
import type { ChatMessage } from "./types";
import { getPreferences } from "./preferencesStorage";
import { bytesToBase64, base64ToBytes } from "./utils/base64";

const STORE_FILE = "dm-history.json";
const KEY_STORE_FILE = "dm-key.json";
const KEY_STORE_KEY = "encKey";
const HISTORY_KEY_PREFIX = "history:";

const MAX_MESSAGES_PER_FRIEND = 5000;
const IV_LENGTH = 12;

let cachedKey: Promise<CryptoKey> | null = null;

async function importRawKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function getEncryptionKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = (async () => {
    const store = await load(KEY_STORE_FILE, { autoSave: true, defaults: {} });
    const existing = await store.get<string>(KEY_STORE_KEY);
    if (typeof existing === "string" && existing.length > 0) {
      return importRawKey(base64ToBytes(existing));
    }
    const generated = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    );
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", generated));
    await store.set(KEY_STORE_KEY, bytesToBase64(raw));
    return importRawKey(raw);
  })();
  try {
    return await cachedKey;
  } catch (e) {
    cachedKey = null;
    throw e;
  }
}

async function encryptJson(value: unknown): Promise<string> {
  const key = await getEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: iv as BufferSource }, key, plaintext as BufferSource),
  );
  const out = new Uint8Array(iv.length + ciphertext.length);
  out.set(iv, 0);
  out.set(ciphertext, iv.length);
  return bytesToBase64(out);
}

async function decryptJson<T>(payload: string): Promise<T> {
  const key = await getEncryptionKey();
  const bytes = base64ToBytes(payload);
  if (bytes.length <= IV_LENGTH) throw new Error("ciphertext too short");
  const iv = bytes.slice(0, IV_LENGTH);
  const ciphertext = bytes.slice(IV_LENGTH);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

/** Stable per-friend key for use as the storage entry name. */
export function friendKeyFor(
  user: { hash?: string | null; name: string },
  serverId?: string | null,
): string {
  if (user.hash) return `hash:${user.hash}`;
  return `anon:${serverId ?? ""}:${user.name}`;
}

/** Returns the user preference governing whether DMs are persisted. */
export async function isDmPersistenceEnabled(): Promise<boolean> {
  try {
    const prefs = await getPreferences();
    return prefs.persistDms === true;
  } catch {
    return false;
  }
}

export async function loadDmHistory(friendKey: string): Promise<ChatMessage[]> {
  try {
    const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
    const payload = await store.get<string>(`${HISTORY_KEY_PREFIX}${friendKey}`);
    if (typeof payload !== "string" || payload.length === 0) return [];
    return await decryptJson<ChatMessage[]>(payload);
  } catch (e) {
    console.warn("loadDmHistory failed", e);
    return [];
  }
}

export async function saveDmHistory(
  friendKey: string,
  messages: ChatMessage[],
): Promise<void> {
  try {
    const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
    const trimmed = messages.length > MAX_MESSAGES_PER_FRIEND
      ? messages.slice(messages.length - MAX_MESSAGES_PER_FRIEND)
      : messages;
    const payload = await encryptJson(trimmed);
    await store.set(`${HISTORY_KEY_PREFIX}${friendKey}`, payload);
  } catch (e) {
    console.warn("saveDmHistory failed", e);
  }
}

export async function clearDmHistory(friendKey: string): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
  await store.delete(`${HISTORY_KEY_PREFIX}${friendKey}`);
}

export async function clearAllDmHistory(): Promise<void> {
  const store = await load(STORE_FILE, { autoSave: true, defaults: {} });
  const keys = await store.keys();
  for (const k of keys) {
    if (k.startsWith(HISTORY_KEY_PREFIX)) await store.delete(k);
  }
}

/**
 * Merges remote DM messages (from the current session) into a persisted
 * history.  Order is preserved (persisted first, then any remote entries
 * that are not already present).  Duplicates are detected by
 * `message_id` when available, otherwise by `(sender_session, timestamp,
 * body)` triples.
 */
export function mergeMessages(
  persisted: ChatMessage[],
  remote: ChatMessage[],
): ChatMessage[] {
  const seen = new Set<string>();
  const keyOf = (m: ChatMessage) =>
    m.message_id ?? `${m.sender_session ?? "?"}|${m.timestamp ?? "?"}|${m.body}`;
  const out: ChatMessage[] = [];
  for (const m of persisted) {
    const k = keyOf(m);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(m);
    }
  }
  for (const m of remote) {
    const k = keyOf(m);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(m);
    }
  }
  return out;
}
