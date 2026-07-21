/** Plugin metadata broadcast by the server (`fancy-plugin-info`) and custom
 *  server emotes (`fancy-server-emotes`). */

/** A single key/value debug row advertised by a plugin's
 *  `MumblePlugin::info_json` payload. Rendered verbatim in the
 *  Server Info panel under the plugin's card. */
export interface PluginInfoDebugRow {
  label: string;
  value: string | number | boolean;
}

/** Per-plugin metadata broadcast by the server via the
 *  `fancy-plugin-info` envelope shortly after a client connects.
 *  All fields except `name`/`version` are optional and rendered
 *  generically. */
export interface PluginInfoPayload {
  description?: string;
  author?: string;
  homepage?: string;
  capabilities?: string[];
  debug_rows?: PluginInfoDebugRow[];
  /** Allow plugins to carry forward-compatible extra fields. */
  [extra: string]: unknown;
}

/** Decoded `fancy-plugin-info` envelope. Stored in the Zustand
 *  `pluginInfos` map keyed by plugin name. */
export interface PluginInfoRecord {
  name: string;
  version: string;
  info: PluginInfoPayload;
}

/** A custom emote pushed by the server via the `fancy-server-emotes`
 *  plugin-data channel. The image is delivered inline as a base64 `data:`
 *  URL so it can be rendered without a follow-up HTTP request. */
export interface CustomServerEmote {
  /** Unique short identifier (e.g. `myCustom`). */
  shortcode: string;
  /** Fallback unicode emoji shown when the image cannot be loaded. */
  aliasEmoji: string;
  /** Optional human-readable description. */
  description?: string;
  /** `data:<mime>;base64,<...>` URL containing the emote bytes. */
  imageDataUrl: string;
}
