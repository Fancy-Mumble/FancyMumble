/**
 * Your notepad: where it is kept and how it is encrypted.
 *
 * On a server the notepad is a room the `fancy-friends` plugin provisions for
 * you alone. The room's protocol is fixed when it is created and the plugin
 * finds rooms by name, so each protocol has a room of its own: changing the
 * encryption starts a new notepad rather than converting the old one. Kept on
 * this device it is never sent anywhere, and is encrypted at rest with the same
 * key as saved direct messages.
 *
 * Everything here is pure; opening, copying and deleting live in
 * `@core/notepadActions`.
 */

import type { PchatProtocol } from "./types";
import type { Friend } from "./friendsStorage";
import { DM_CHANNEL_PREFIX } from "./utils/appConstants";

/** The protocols a notepad room can be created with. */
export type NotepadProtocol = Extract<
  PchatProtocol,
  "signal_v1" | "fancy_v1_full_archive" | "server_managed"
>;

export const NOTEPAD_PROTOCOLS: readonly NotepadProtocol[] = [
  "signal_v1",
  "fancy_v1_full_archive",
  "server_managed",
];

/** One of your logins, as a notepad location names it. */
export interface NotepadLogin {
  host: string;
  port: number;
  username: string;
}

export type NotepadLocation = { kind: "local" } | ({ kind: "server" } & NotepadLogin);

export interface NotepadSettings {
  location: NotepadLocation;
  /** Ignored for a notepad on this device. */
  protocol: NotepadProtocol;
}

/** The notepad in effect, and the saved self record it lives under on a server. */
export interface ResolvedNotepad extends NotepadSettings {
  friend: Friend | null;
}

/** The channel id local notes are filed under. Server channel ids are never negative. */
export const LOCAL_NOTES_CHANNEL_ID = -1;

/** Fired when the notepad preference is saved, so every open list follows it. */
export const NOTEPAD_CHANGED_EVENT = "fancy:notepad-changed";

/** Matches the `fancy-friends` plugin: the default protocol keeps the bare name,
 *  so notepads created before the choice existed are still found. */
const ROOM_SUFFIX: Record<NotepadProtocol, string> = {
  signal_v1: "",
  fancy_v1_full_archive: "+fancy",
  server_managed: "+server",
};

export function notepadRoomName(userId: number, protocol: NotepadProtocol): string {
  return `${DM_CHANNEL_PREFIX}${userId}${ROOM_SUFFIX[protocol]}`;
}

export function isSelfLogin(friend: Friend, login: NotepadLogin): boolean {
  return (
    friend.self === true &&
    friend.serverHost === login.host &&
    friend.serverPort === login.port &&
    friend.serverUsername === login.username
  );
}

/** Your saved logins, oldest first. */
export function selfLogins(friends: readonly Friend[]): Friend[] {
  return friends
    .filter((friend) => friend.self && friend.serverHost != null && friend.serverPort != null)
    .sort((left, right) => left.addedAt - right.addedAt);
}

/**
 * The notepad in effect.
 *
 * The saved choice when there is one and its login is still known; otherwise
 * the first login you were saved on, and this device when there is none - a
 * guest has nowhere else to keep notes.
 */
export function resolveNotepad(
  saved: NotepadSettings | undefined,
  friends: readonly Friend[],
): ResolvedNotepad {
  const logins = selfLogins(friends);
  const protocol = saved?.protocol ?? "signal_v1";
  if (saved?.location.kind === "local") return { location: { kind: "local" }, protocol, friend: null };
  if (saved?.location.kind === "server") {
    const { location } = saved;
    const friend = logins.find((login) => isSelfLogin(login, location));
    if (friend) return { location, protocol, friend };
  }
  const first = logins[0];
  if (!first) return { location: { kind: "local" }, protocol, friend: null };
  return {
    location: {
      kind: "server",
      host: first.serverHost!,
      port: first.serverPort!,
      username: first.serverUsername ?? "",
    },
    protocol,
    friend: first,
  };
}

/** Whether two settings name the same notepad. The protocol does not matter on this device. */
export function sameNotepad(left: NotepadSettings, right: NotepadSettings): boolean {
  if (left.location.kind === "local" || right.location.kind === "local") {
    return left.location.kind === right.location.kind;
  }
  return (
    left.protocol === right.protocol &&
    left.location.host === right.location.host &&
    left.location.port === right.location.port &&
    left.location.username === right.location.username
  );
}

/** A settings value without the resolved record, fit to store. */
export function toSettings(notepad: NotepadSettings): NotepadSettings {
  return { location: notepad.location, protocol: notepad.protocol };
}
