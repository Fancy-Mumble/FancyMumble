/** Discord Rich Presence observed from other applications on this machine.
 *
 *  Mirrors the payloads emitted by `crates/mumble-tauri/src/state/presence.rs`.
 *  Note the mixed casing: the envelope is camelCase like every other backend
 *  payload, but the fields *inside* `activity` keep Discord's own snake_case
 *  names, because they are parsed straight off the wire and forwarded to a
 *  running Discord client unmodified.
 */

/** Bounds of the elapsed/remaining counter, in epoch milliseconds. */
export interface PresenceTimestamps {
  start?: number | null;
  end?: number | null;
}

/** Artwork hover text. The image fields themselves are opaque keys; use the
 *  pre-resolved `largeImageUrl` / `smallImageUrl` on the entry instead. */
export interface PresenceAssets {
  large_image?: string | null;
  large_text?: string | null;
  small_image?: string | null;
  small_text?: string | null;
}

/** Group/lobby occupancy, as `[current, maximum]`. */
export interface PresenceParty {
  id?: string | null;
  size?: number[] | null;
}

/** A labelled link an application attached to its presence. */
export interface PresenceButton {
  label: string;
  url?: string | null;
}

/** What an application says it is doing. */
export interface PresenceActivity {
  name?: string | null;
  /** Discord activity type: 0 playing, 1 streaming, 2 listening, 3 watching. */
  type?: number | null;
  details?: string | null;
  state?: string | null;
  timestamps?: PresenceTimestamps | null;
  assets?: PresenceAssets | null;
  party?: PresenceParty | null;
  buttons?: PresenceButton[] | null;
  url?: string | null;
}

/** One application's presence, with artwork already resolved to URLs. */
export interface PresenceEntry {
  /** Stable for the life of the application's connection, not across restarts. */
  id: number;
  applicationId: string;
  applicationName?: string | null;
  pid?: number | null;
  processName?: string | null;
  activity: PresenceActivity;
  /** Best available label, already resolved through the fallback chain. */
  displayName: string;
  largeImageUrl?: string | null;
  smallImageUrl?: string | null;
}

/** How the listener sits relative to a running Discord client.
 *
 *  - `standalone` - we hold Discord's IPC slot 0 and Discord is not running.
 *  - `bridged` - Discord is running and every frame is forwarded to it, so it
 *    still displays everything.
 *  - `intercepting` - we hold slot 0 with forwarding off, so Discord shows
 *    nothing. Not reachable from the UI.
 *  - `blocked` - Discord started first and holds the slot, so we observe
 *    nothing until the launch order flips.
 */
export type PresenceBridgeState = "standalone" | "bridged" | "intercepting" | "blocked";

/** Whether the listener is running, and where it ended up. */
export interface PresenceStatus {
  enabled: boolean;
  bridgeState?: PresenceBridgeState | null;
  /** Which Discord IPC slot was taken. Anything but 0 means nothing arrives. */
  slot?: number | null;
}

/** Full presence picture; the payload of every `rich-presence-changed` event. */
export interface PresenceSnapshot {
  status: PresenceStatus;
  entries: PresenceEntry[];
}
