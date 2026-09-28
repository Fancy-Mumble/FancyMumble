/** The live-doc (collaborative document) plugin: persisted document summaries,
 *  the per-user sidebar tree, sharing and plugin config. */

/** One persisted live-doc document from the admin dashboard endpoint. */
export interface DocumentSummary {
  /** Stable document name (the live-doc `DocKey` filename). */
  name: string;
  /** Sequence number of the most recent revision. */
  latest_rev: number;
  /** Total number of stored revisions. */
  revision_count: number;
  /** Size in bytes of the latest revision. */
  size_bytes: number;
  /** Unix-millis time the document was last written. */
  updated_at: number;
  /** Display name of the creator (first to persist it), or null for documents
   *  stored before owner tracking existed. */
  owner_name: string | null;
  /** Stable cert hash of the creator, so the client can match a live user. */
  owner_cert_hash: string | null;
}

/** `GET /admin/documents` response body. */
export interface AdminDocumentsResponse {
  documents: DocumentSummary[];
}

/** A saved reference to a live document in a user's personal sidebar.
 *  References a server-scoped document by `slug`; `channel` is the
 *  channel it was published to (or `null` for a private doc). */
export interface LiveDocDocLink {
  slug: string;
  title: string;
  channel: number | null;
  /** True if this user created the document. */
  owned: boolean;
}

/** A folder in the sidebar tree (nestable).  Sections and folders share
 *  this shape; a section is simply a top-level folder. */
export interface LiveDocFolder {
  id: string;
  name: string;
  folders: LiveDocFolder[];
  docs: LiveDocDocLink[];
}

/** A top-level user-defined section of the sidebar. */
export type LiveDocSection = LiveDocFolder;

/** The persisted per-user sidebar tree (stored in file-server private
 *  storage under the `livedoc-sidebar` key). */
export interface LiveDocIndex {
  v: number;
  sections: LiveDocSection[];
}

/** One member a document has been shared with, as pushed by the
 *  live-doc plugin's `SharedWith` envelope. */
export interface LiveDocSharedMember {
  cert_hash: string;
  user_id: number;
  display_name: string;
}

/** Configuration advertised by the live-doc plugin to clients on connect
 *  via a `fancy-live-doc-config` plugin-data message. */
export interface LiveDocPluginConfig {
  /** SemVer version string of the live-doc plugin (from its Cargo.toml). */
  version: string;
  /** Base WebSocket URL clients use for Yjs sync connections. */
  wsBaseUrl: string;
}
