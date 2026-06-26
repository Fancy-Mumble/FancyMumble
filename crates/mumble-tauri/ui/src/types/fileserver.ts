/** The file-server plugin: per-connection config/capabilities, admin file
 *  listings, and the upload/download value types. */

/** Access mode for a file uploaded via the file-server plugin. */
export type FileAccessMode = "public" | "password" | "session";

/** Configuration for the server-side file-server plugin, advertised to the
 *  client on connect via a `fancy-file-server-config` plugin-data message. */
export interface FileServerConfig {
  /** Base URL of the axum file server (no trailing slash).  Equal to
   *  `internalBaseUrl` unless the server advertises a reverse-proxy
   *  override (`serverConfig.fancy_rest_api_url`), in which case this
   *  is the public/proxied URL used for outbound requests. */
  baseUrl: string;
  /** Internal origin the file-server plugin actually embeds in its
   *  download URLs.  Used by `rebaseFileServerUrl` to decide whether
   *  a given URL is one of ours to rewrite (otherwise unrelated plugin
   *  URLs such as `https://placehold.co/...` would get clobbered). */
  internalBaseUrl: string;
  /** Caller's Mumble session id (echoed back from the server). */
  sessionId: number;
  /** Per-session upload token used as `?token=` on `POST /files`. */
  uploadToken: string;
  /** Session JWT used as `Authorization: Bearer` on `POST /files/{id}/auth`
   *  for `mode=session` downloads. */
  sessionJwt: string;
  /** Maximum allowed upload size in bytes. */
  maxFileSizeBytes: number;
  /** When true, files are deleted after the TTL expires. */
  deleteOnTtl: boolean;
  /** Default time-to-live in seconds (only meaningful when `deleteOnTtl`). */
  ttlSeconds: number;
  /** Maximum lifetime in seconds an uploader may request (`0` = no maximum). */
  maxTtlSeconds: number;
  /** When true, files are deleted after a single successful download. */
  deleteOnDownload: boolean;
  /** When true, all files uploaded by a session are deleted on disconnect. */
  deleteOnDisconnect: boolean;
  /** True when the connected user is allowed to add/remove custom server
   *  emotes via the file-server's `/emotes` admin API. */
  canManageEmotes: boolean;
  /** True when the connected user is allowed to upload files at all
   *  (server-wide hint; per-channel ACL is enforced at upload time). */
  canShareFiles: boolean;
  /** True when the connected user is allowed to share files via
   *  publicly accessible links (`public` and `password` modes).  When
   *  false, only `session`-scoped uploads are permitted. */
  canShareFilesPublic: boolean;
  /** True when the connected user is a registered (non-guest) Mumble
   *  account.  Gates access to per-user private storage (`/me/storage`),
   *  where the live-doc sidebar is persisted. */
  registered: boolean;
}

/** Parsed semantic version triple as returned by `GET /capabilities`. */
export interface FileServerVersionInfo {
  major: number | null;
  minor: number | null;
  patch: number | null;
  /** Human-readable "MAJOR.MINOR.PATCH" or "unknown". */
  display: string;
}

/** Feature flags reported by `GET /capabilities`. */
export interface FileServerFeatures {
  file_uploads: boolean;
  custom_emotes: boolean;
  file_ttl: boolean;
  delete_on_download: boolean;
  delete_on_disconnect: boolean;
}

/** Storage limits reported by `GET /capabilities`. */
export interface FileServerLimits {
  max_file_size_bytes: number;
  max_total_storage_bytes: number;
  ttl_seconds: number;
  max_ttl_seconds: number;
}

/** Response from `GET {baseUrl}/capabilities`. Populated once per
 *  connection after the `fancy-file-server-config` plugin-data arrives. */
export interface FileServerCapabilities {
  plugin: { name: string; version: string };
  mumble_version: FileServerVersionInfo;
  fancy_version: FileServerVersionInfo;
  features: FileServerFeatures;
  limits: FileServerLimits;
}

/** Access mode of a stored file (chosen by the uploader). */
export type FileServerAccessMode = "public" | "password" | "session";

/** One stored file as returned by the admin dashboard endpoint
 *  `GET /admin/files` (proxied via `fileserver_admin_list_files`). */
export interface AdminFileEntry {
  id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  access_mode: FileServerAccessMode;
  channel_id: number;
  server_id: number;
  /** Unix-millis upload time. */
  uploaded_at: number;
  /** Unix-millis last download, or null. */
  downloaded_at: number | null;
  /** Unix-seconds TTL expiry, or null. */
  expires_at: number | null;
  /** Display name of the uploader captured at upload time (null for files
   *  uploaded before this was recorded). */
  uploader_name: string | null;
  /** Stable cert hash of the uploader, used to match a connected user. */
  uploader_cert_hash: string | null;
  /** Stable registered user id of the uploader (>= 0), or null. Preferred over
   *  the cert hash for matching a connected user, since it survives certificate
   *  regeneration across sessions. */
  uploader_user_id: number | null;
  /** Whether the uploader's session is still connected. */
  uploader_online: boolean;
}

/** Aggregate storage usage from the admin dashboard endpoint. */
export interface FileServerStorageStats {
  total_bytes_used: number;
  max_total_storage_bytes: number;
  max_file_size_bytes: number;
  file_count: number;
}

/** `GET /admin/files` response body. */
export interface AdminFilesResponse {
  files: AdminFileEntry[];
  stats: FileServerStorageStats;
}

/** `GET /me/files` response body - the caller's own uploaded files (no
 *  server-wide storage stats, which are admin-only). */
export interface MyFilesResponse {
  files: AdminFileEntry[];
}

/** Successful upload response returned by `upload_file`. */
export interface UploadResponse {
  /** Random file id (also embedded in `download_url`). */
  file_id: string;
  /** Full shareable download URL with `?ex=&is=&hm=` parameters. */
  download_url: string;
  /** Access mode for this file. */
  access_mode: FileAccessMode;
  /** Unix-seconds expiry, or `null` if TTL disabled. */
  expires_at: number | null;
  /** File size in bytes. */
  size_bytes: number;
}

/** A locally-saved download produced via {@link FileServerConfig}. Tracked
 *  in-memory so the user can review/open files they downloaded during a
 *  session via the Downloads panel. */
export interface DownloadEntry {
  /** Stable client-generated id (UUID-ish) used as the React key. */
  id: string;
  /** Display filename (best-effort, taken from the attachment metadata). */
  filename: string;
  /** Absolute path on disk where the file was written. */
  destPath: string;
  /** File size in bytes. */
  sizeBytes: number;
  /** The signed download URL the file came from. */
  sourceUrl: string;
  /** Access mode the file was shared with. */
  mode: FileAccessMode;
  /** `Date.now()` when the download completed. */
  downloadedAt: number;
}

/** Input shape for `addDownload`: everything in {@link DownloadEntry}
 *  except the fields the store fills in (`id`, `downloadedAt`).  Lifted
 *  out of the action signature so it can be referenced by name from
 *  caller code instead of repeating the `Omit<...>` everywhere. */
export type NewDownloadInput = Omit<DownloadEntry, "id" | "downloadedAt">;
