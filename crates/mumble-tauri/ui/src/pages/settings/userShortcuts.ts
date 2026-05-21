/**
 * Per-user "jump-to-DM" shortcuts (Mumble-style friends).
 *
 * Mirrors Mumble's classic friends feature: a friend is identified by their
 * TLS certificate hash alone -- not by server.  When the shortcut fires,
 * the backend's session registry is searched across every connected
 * server, the first match's tab is activated, and the DM is opened.
 *
 * `serverId` / `serverLabel` are kept only as a UI hint reminding the user
 * which server they originally created the binding from; they are not
 * required to resolve the user.
 */

import { load } from "@tauri-apps/plugin-store";
import {
  register,
  unregister,
  isRegistered,
} from "@tauri-apps/plugin-global-shortcut";

export interface UserShortcut {
  /** Stable id (UUID) so the UI can edit/remove specific entries. */
  id: string;
  /** Hotkey combo, e.g. "Ctrl+Alt+1". Empty string = inactive. */
  hotkey: string;
  /** Display name captured when the shortcut was created. */
  userName: string;
  /** TLS certificate hash of the target user.  When set, the shortcut
   *  resolves across every connected server.  When unset (anonymous
   *  user), the binding is server-scoped and resolved via the saved
   *  {@link serverId} + {@link userName} fallback. */
  userHash?: string;
  /** Optional: server id where this binding was created.  Required when
   *  {@link userHash} is missing; otherwise just a UI hint. */
  serverId?: string;
  /** Optional display label for {@link serverId}. */
  serverLabel?: string;
}

const SHORTCUT_STORE = "shortcuts.json";
const USER_SHORTCUTS_KEY = "userShortcuts";

export async function loadUserShortcuts(): Promise<UserShortcut[]> {
  const store = await load(SHORTCUT_STORE, { autoSave: true, defaults: {} });
  const saved = await store.get<UserShortcut[]>(USER_SHORTCUTS_KEY);
  return Array.isArray(saved) ? saved : [];
}

export async function saveUserShortcuts(shortcuts: UserShortcut[]): Promise<void> {
  const store = await load(SHORTCUT_STORE, { autoSave: true, defaults: {} });
  await store.set(USER_SHORTCUTS_KEY, shortcuts);
}

/** Globally-broadcast event payload emitted when a user shortcut fires. */
export interface JumpToUserDetail {
  userName: string;
  /** Present when the bound user has a certificate hash. */
  userHash?: string;
  /** Present when the binding is server-scoped (anonymous user fallback). */
  serverId?: string;
}

export const JUMP_TO_USER_EVENT = "fancy:jump-to-user";

/** Register the global hotkey for a single user shortcut. */
export async function applyUserShortcut(s: UserShortcut): Promise<void> {
  if (!s.hotkey) return;
  try {
    if (await isRegistered(s.hotkey)) await unregister(s.hotkey);
    await register(s.hotkey, (event) => {
      if (event.state !== "Pressed") return;
      const detail: JumpToUserDetail = {
        userName: s.userName,
        userHash: s.userHash,
        serverId: s.serverId,
      };
      globalThis.dispatchEvent(new CustomEvent(JUMP_TO_USER_EVENT, { detail }));
    });
  } catch (e) {
    console.warn(`Failed to register user shortcut "${s.hotkey}":`, e);
  }
}

export async function clearUserShortcut(hotkey: string): Promise<void> {
  if (!hotkey) return;
  try {
    if (await isRegistered(hotkey)) await unregister(hotkey);
  } catch {
    /* ignore */
  }
}

export async function applyAllUserShortcuts(shortcuts: UserShortcut[]): Promise<void> {
  for (const s of shortcuts) {
    await applyUserShortcut(s);
  }
}
