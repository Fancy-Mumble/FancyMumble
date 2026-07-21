/** Connection lifecycle, server identity/config and the saved/public server
 *  lists. */

export type ConnectionStatus = "disconnected" | "connecting" | "connected";

/**
 * Multi-server: stable identifier for a connected server, minted by the
 * backend on each `connect` call.  Phase A: surfaced via the
 * `list_servers` / `get_active_server` / `set_active_server` Tauri
 * commands and stamped onto every emitted event payload as `serverId`.
 */
export type ServerId = string;

/**
 * User-visible summary of a connected (or connecting) server returned
 * by the `list_servers` command.
 */
export interface SessionMeta {
  id: ServerId;
  label: string;
  host: string;
  port: number;
  username: string;
  certLabel: string | null;
  status: ConnectionStatus;
}

export interface ServerLogEntry {
  timestamp_ms: number;
  message: string;
}

export interface MumbleServerConfig {
  max_message_length: number;
  max_image_message_length: number;
  allow_html: boolean;
  webrtc_sfu_available: boolean;
  /**
   * Optional override for the Fancy Mumble REST API base URL, sent by
   * the server when its HTTP interface is hosted behind a reverse
   * proxy or ingress. When set, clients should prefer this URL over
   * any per-plugin `base_url` advertised via plugin-data. `null` means
   * "no override".
   */
  fancy_rest_api_url: string | null;
}

/** Aggregated server info from the backend (version, host, codec, etc.). */
export interface ServerInfo {
  host: string;
  port: number;
  user_count: number;
  max_users: number | null;
  protocol_version: string | null;
  fancy_version: number | null;
  release: string | null;
  os: string | null;
  max_bandwidth: number | null;
  opus: boolean;
}

/** A saved server connection stored persistently. */
export interface SavedServer {
  /** Unique id (crypto.randomUUID). */
  id: string;
  /** Display label chosen by the user - falls back to host. */
  label: string;
  host: string;
  port: number;
  username: string;
  /** TLS client certificate label, or null to connect anonymously. */
  cert_label: string | null;
  /** Whether this server is pinned as a favourite (shown at the top). */
  favorite?: boolean;
}

/** Result of pinging a server via TCP + UDP. */
export interface ServerPingResult {
  online: boolean;
  /** Round-trip time in ms, null when offline. */
  latency_ms: number | null;
  /** Current user count from UDP ping, null if unavailable. */
  user_count: number | null;
  /** Max user count from UDP ping, null if unavailable. */
  max_user_count: number | null;
  /** Server version string (e.g. "1.5.634"), null if unavailable. */
  server_version: string | null;
}

// --- Public Server List -------------------------------------------

/** A public Mumble server from the official directory. */
export interface PublicServer {
  name: string;
  country: string;
  country_code: string;
  ip: string;
  port: number;
  region: string;
  url: string;
}
