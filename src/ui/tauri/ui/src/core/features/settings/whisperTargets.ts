/**
 * Whisper and shout targets, the way Mumble binds them to a key.
 *
 * Upstream gives a whisper shortcut a *target* rather than an action: the key
 * transmits to somewhere other than the channel you are in for as long as it
 * is held. The target is a set of people (a whisper) or a channel (a shout),
 * and a shout can be widened to the channel's links and its sub-tree.
 *
 * # Registered ahead of the key
 *
 * The wire wants session ids, and a session id is only good for one
 * connection, so a binding stores what it means - a certificate hash, a name,
 * a channel id - and {@link resolveWhisperTarget} turns that into sessions
 * against the roster. {@link startWhisperSync} does that every time the roster
 * moves and keeps each target registered in its own slot (its place in the
 * list, plus one), so a key press only switches slots and loses nothing. The
 * press still re-resolves, and the backend re-registers where the slot holds
 * something else.
 *
 * An unresolvable target sends nothing at all. Falling back to the channel is
 * the one outcome a whisper key must never have.
 */

import { invoke } from "@tauri-apps/api/core";
import { register, unregister, isRegistered } from "@tauri-apps/plugin-global-shortcut";
import { useAppStore } from "@core/store";
import { load } from "../../utils/store";

/** A person a whisper reaches, identified the way a binding can outlive them. */
export interface WhisperUserRef {
  /** Display name when the binding was made; the fallback identity. */
  name: string;
  /** TLS certificate hash. Preferred, because it survives a reconnect. */
  hash?: string;
}

/** Which channel a shout goes to. */
export type WhisperChannelMode =
  /** The one picked when the binding was made. */
  | "fixed"
  /** Whichever channel the user is in when the key goes down. */
  | "current";

export interface WhisperTarget {
  /** Stable id, so the settings page can edit one row of several. */
  id: string;
  /** Hotkey combo, e.g. "Ctrl+Alt+1". Empty string = configured but unbound. */
  hotkey: string;
  /** What the user called it. */
  name: string;
  /** Whisper to people, or shout to a channel. */
  kind: "users" | "channel";
  /** `kind === "users"`: who to reach. */
  users: WhisperUserRef[];
  /** `kind === "channel"`: which channel, fixed or followed. */
  channelMode: WhisperChannelMode;
  /** The fixed channel's id, when `channelMode === "fixed"`. */
  channelId?: number;
  /** The fixed channel's name when it was picked, for the settings row. */
  channelName?: string;
  /** Also reach the channels linked to the target channel. */
  links: boolean;
  /** Also reach its sub-channels, recursively. */
  children: boolean;
  /** Restrict the shout to one ACL group. Empty means everyone. */
  group?: string;
}

/** One entry of the `VoiceTarget` the backend registers. */
export interface ResolvedWhisperEntry {
  sessions: number[];
  channelId: number | null;
  group: string | null;
  links: boolean;
  children: boolean;
}

const SHORTCUT_STORE = "shortcuts.json";
const WHISPER_KEY = "whisperTargets";

/** The server has thirty slots; targets past the thirtieth cannot be bound. */
export const MAX_WHISPER_SLOT = 30;

/** Settle time for a burst of roster changes before re-registering. */
const SYNC_DEBOUNCE_MS = 150;

/** Dispatched after the settings page saves, so the sync reloads the list. */
export const WHISPER_TARGETS_CHANGED_EVENT = "fancy:whisper-targets-changed";

/** A target as the "add" button creates it: bound to nothing, reaching nobody. */
export function newWhisperTarget(id: string, name: string): WhisperTarget {
  return {
    id,
    hotkey: "",
    name,
    kind: "users",
    users: [],
    channelMode: "fixed",
    links: false,
    children: false,
  };
}

/**
 * The saved list, as the hotkeys last saw it.
 *
 * The press looks its target up here rather than using the copy its handler was
 * registered with, so an edit takes effect at the next press without a rebind,
 * and so the press knows the slot - the target's place in this list.
 */
let knownTargets: readonly WhisperTarget[] = [];

/** The slot a target at `index` owns, or null past the server's thirty. */
export function whisperSlotForIndex(index: number): number | null {
  return index >= 0 && index < MAX_WHISPER_SLOT ? index + 1 : null;
}

export async function loadWhisperTargets(): Promise<WhisperTarget[]> {
  const store = await load(SHORTCUT_STORE, { autoSave: true, defaults: {} });
  const saved = await store.get<WhisperTarget[]>(WHISPER_KEY);
  const targets = Array.isArray(saved) ? saved : [];
  knownTargets = targets;
  return targets;
}

export async function saveWhisperTargets(targets: WhisperTarget[]): Promise<void> {
  knownTargets = targets;
  const store = await load(SHORTCUT_STORE, { autoSave: true, defaults: {} });
  await store.set(WHISPER_KEY, targets);
}

/**
 * The roster a resolution is made against. Passed in, so the resolver is a
 * pure function of what the client can see.
 */
export interface WhisperRoster {
  users: readonly { session: number; name: string; hash?: string; channel_id?: number }[];
  channels: readonly { id: number }[];
  /** The channel the local user is in, or null while only browsing. */
  currentChannel: number | null;
}

/**
 * Turn a binding into the entry the backend registers, or `null` when it
 * reaches nobody.
 *
 * A user is matched by certificate hash first and by name only when the
 * binding has no hash: the point of storing one is that somebody else taking
 * the name does not inherit the whisper.
 */
export function resolveWhisperTarget(
  target: WhisperTarget,
  roster: WhisperRoster,
): ResolvedWhisperEntry | null {
  const group = target.group?.trim() ? target.group.trim() : null;

  if (target.kind === "users") {
    const sessions = target.users
      .map((ref) => {
        const match = ref.hash
          ? roster.users.find((user) => user.hash === ref.hash)
          : roster.users.find((user) => user.name === ref.name);
        return match?.session;
      })
      .filter((session): session is number => session !== undefined);
    if (sessions.length === 0) return null;
    return { sessions, channelId: null, group, links: false, children: false };
  }

  const channelId =
    target.channelMode === "current"
      ? roster.currentChannel
      : target.channelId !== undefined &&
          roster.channels.some((channel) => channel.id === target.channelId)
        ? target.channelId
        : null;
  if (channelId === null) return null;
  return {
    sessions: [],
    channelId,
    group,
    links: target.links,
    children: target.children,
  };
}

/**
 * The channels the server checks `Whisper` in for this target: the channel a
 * shout names, and the channel each whispered user is standing in. What a
 * refusal - which names only a channel - is matched back to a target by.
 */
export function whisperTargetChannels(target: WhisperTarget, roster: WhisperRoster): number[] {
  const entry = resolveWhisperTarget(target, roster);
  if (!entry) return [];
  const channels = new Set<number>();
  if (entry.channelId !== null) channels.add(entry.channelId);
  for (const session of entry.sessions) {
    const user = roster.users.find((each) => each.session === session);
    if (user?.channel_id !== undefined) channels.add(user.channel_id);
  }
  return [...channels];
}

function rosterOf(state: ReturnType<typeof useAppStore.getState>): WhisperRoster {
  return { users: state.users, channels: state.channels, currentChannel: state.currentChannel };
}

/** What each slot was last registered with, as JSON, for this connection. */
const lastRegistered = new Map<number, string>();

/** Forget what was registered - the connection it was registered on is gone. */
export function resetWhisperRegistrations(): void {
  lastRegistered.clear();
}

/**
 * Register every target in its slot, sending only what changed.
 *
 * A target that resolves to nobody clears its slot, and so does a slot whose
 * target was removed: a registration left behind would keep reaching whoever
 * inherits the session ids it names.
 */
export async function syncWhisperRegistrations(
  targets: readonly WhisperTarget[],
  roster: WhisperRoster,
): Promise<void> {
  const wanted = new Map<number, ResolvedWhisperEntry[]>();
  targets.forEach((target, index) => {
    const slot = whisperSlotForIndex(index);
    if (slot === null) return;
    const entry = resolveWhisperTarget(target, roster);
    wanted.set(slot, entry ? [entry] : []);
  });
  for (const slot of lastRegistered.keys()) {
    if (!wanted.has(slot)) wanted.set(slot, []);
  }

  for (const [slot, entries] of wanted) {
    const key = JSON.stringify(entries);
    if ((lastRegistered.get(slot) ?? "[]") === key) continue;
    try {
      await invoke("whisper_register", { slot, targets: entries });
      if (entries.length === 0) lastRegistered.delete(slot);
      else lastRegistered.set(slot, key);
    } catch {
      // Not connected yet. The connection arriving is itself a roster change,
      // which comes back here.
    }
  }
}

/**
 * Keep the whisper slots registered for as long as the client runs.
 *
 * Re-runs on any change to who is online, the channel tree, or the channel the
 * user is in, and after the settings page saves. A new connection - another
 * server, or a reconnect with a new session - starts with nothing registered,
 * so the record of what was sent is dropped with it. Returns the unsubscribe.
 */
export function startWhisperSync(): () => void {
  let targets: readonly WhisperTarget[] = knownTargets;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const connectionOf = (state: ReturnType<typeof useAppStore.getState>) =>
    `${state.activeServerId ?? ""}:${state.ownSession ?? ""}`;
  let connection = connectionOf(useAppStore.getState());

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!stopped) void syncWhisperRegistrations(targets, rosterOf(useAppStore.getState()));
    }, SYNC_DEBOUNCE_MS);
  };
  const reload = () =>
    void loadWhisperTargets()
      .then((loaded) => {
        targets = loaded;
        schedule();
      })
      .catch(() => undefined);

  const unsubscribe = useAppStore.subscribe((state, prev) => {
    const next = connectionOf(state);
    if (next !== connection) {
      connection = next;
      resetWhisperRegistrations();
      schedule();
      return;
    }
    if (
      state.users !== prev.users ||
      state.channels !== prev.channels ||
      state.currentChannel !== prev.currentChannel
    ) {
      schedule();
    }
  });
  globalThis.addEventListener(WHISPER_TARGETS_CHANGED_EVENT, reload);
  reload();

  return () => {
    stopped = true;
    clearTimeout(timer);
    unsubscribe();
    globalThis.removeEventListener(WHISPER_TARGETS_CHANGED_EVENT, reload);
  };
}

/**
 * Dispatched when a whisper key was pressed but its target reaches nobody.
 * An event rather than a thrown error: the press came from a global hotkey
 * with no caller to catch anything.
 */
export const WHISPER_UNRESOLVED_EVENT = "fancy:whisper-unresolved";

/** Payload of {@link WHISPER_UNRESOLVED_EVENT}. */
export interface WhisperUnresolvedDetail {
  /** The binding's name, so the warning can say which key did nothing. */
  name: string;
}

/**
 * Bind one target's hotkey. Press and release, like push-to-talk. The release
 * is sent even when the press resolved to nothing, so a target that emptied
 * out between the two edges cannot leave the mic held open.
 */
export async function applyWhisperTarget(target: WhisperTarget): Promise<void> {
  if (!target.hotkey) return;
  try {
    if (await isRegistered(target.hotkey)) await unregister(target.hotkey);
    await register(target.hotkey, (event) => {
      if (event.state === "Pressed") {
        const index = knownTargets.findIndex((each) => each.id === target.id);
        const current = knownTargets[index] ?? target;
        const slot = whisperSlotForIndex(index);
        const entry = slot === null ? null : resolveWhisperTarget(current, rosterOf(useAppStore.getState()));
        if (slot === null || !entry) {
          const detail: WhisperUnresolvedDetail = { name: current.name };
          globalThis.dispatchEvent(new CustomEvent(WHISPER_UNRESOLVED_EVENT, { detail }));
          return;
        }
        invoke("whisper_start", { slot, targets: [entry] }).catch(console.error);
      } else if (event.state === "Released") {
        invoke("whisper_end").catch(console.error);
      }
    });
  } catch (e) {
    console.warn(`Failed to register whisper shortcut "${target.hotkey}":`, e);
  }
}

export async function clearWhisperTarget(hotkey: string): Promise<void> {
  if (!hotkey) return;
  try {
    if (await isRegistered(hotkey)) await unregister(hotkey);
  } catch {
    /* ignore */
  }
}

export async function applyAllWhisperTargets(targets: WhisperTarget[]): Promise<void> {
  knownTargets = targets;
  for (const target of targets) {
    await applyWhisperTarget(target);
  }
}

/** How the settings row describes a target in one line. */
export function whisperTargetSummary(
  target: WhisperTarget,
  labels: {
    users: (names: string) => string;
    channel: (name: string) => string;
    currentChannel: string;
    unset: string;
  },
): string {
  if (target.kind === "users") {
    if (target.users.length === 0) return labels.unset;
    return labels.users(target.users.map((user) => user.name).join(", "));
  }
  if (target.channelMode === "current") return labels.currentChannel;
  return target.channelName ? labels.channel(target.channelName) : labels.unset;
}
