/**
 * Magic strings exchanged through the generic plugin transport.
 *
 * `PluginDataId` lists the `data_id` values carried by the legacy
 * `PluginDataTransmission` envelope (Tauri event `plugin-data`).
 *
 * `PluginPayloadType` lists the `payloadType` discriminator carried by
 * the modern `PluginMessage` envelope (Tauri event `plugin-message`),
 * minus the Tier-1 `Interaction` / `InteractionResponse` types which
 * already have constants in `plugins/tier1/types.ts`.
 *
 * Both must stay in lock-step with the corresponding strings on the
 * Rust side (`mumble-protocol`/`mumble-server` plugins).
 */

import i18next from "i18next";
export enum PluginDataId {
  FileServerConfig = "fancy-file-server-config",
  LiveDocConfig = "fancy-live-doc-config",
  PluginInfo = "fancy-plugin-info",
  ServerEmotes = "fancy-server-emotes",
  /** Legacy: polls are now native protobuf messages.  Still listed so
   *  the early-return guard in the `plugin-data` handler is self-
   *  documenting. */
  Poll = "fancy-poll",
  /** Legacy: see {@link PluginDataId.Poll}. */
  PollVote = "fancy-poll-vote",
  /** Legacy: live-doc invites/announces now travel through
   *  `PluginMessage` (see {@link PluginPayloadType}). */
  LiveDocInvite = "fancy-live-doc/invite",
  /** Legacy: see {@link PluginDataId.LiveDocInvite}. */
  LiveDocAnnounce = "fancy-live-doc/announce",
}

export enum PluginPayloadType {
  Invite = "Invite",
  Announce = "Announce",
  /** Host-broadcast lifecycle events: a server plugin was enabled/disabled at
   *  runtime.  `pluginName` identifies which plugin; no payload.  Mirrors the
   *  host's `PAYLOAD_TYPE_PLUGIN_ACTIVATED` / `_DEACTIVATED` string constants
   *  (kept as strings on the wire - the generic `payload_type` field is
   *  intentionally plugin-agnostic). */
  PluginActivated = "PluginActivated",
  PluginDeactivated = "PluginDeactivated",
}

/** Stable plugin identifiers used by the host's plugin-status broadcasts and
 *  the `fancy-plugin-info` registry. */
export const PLUGIN_NAME_FILE_SERVER = "fancy-file-server";
export const PLUGIN_NAME_LIVE_DOC = "fancy-live-doc";
export const PLUGIN_NAME_CALENDAR = "fancy-calendar";

/** Human-friendly display name for a known plugin id (falls back to the id). */
export function friendlyPluginName(name: string): string {
  switch (name) {
    case PLUGIN_NAME_FILE_SERVER:
      return i18next.t("common:plugins.fileServer", { defaultValue: "File server" });
    case PLUGIN_NAME_LIVE_DOC:
      return i18next.t("common:plugins.liveDoc", { defaultValue: "Live documents" });
    case PLUGIN_NAME_CALENDAR:
      return i18next.t("common:plugins.calendar", { defaultValue: "Calendar" });
    default:
      return name;
  }
}
