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
}
