/** Channels, users, chat messages and read receipts - the core live-session
 *  value types mirroring the Rust backend structs. */

/** Persistent-chat protocol for a channel. */
export type PchatProtocol = "none" | "fancy_v1_full_archive" | "signal_v1";

export interface ChannelEntry {
  id: number;
  parent_id: number | null;
  name: string;
  /** Byte length of the channel description, or null if empty.
   *  The actual HTML must be fetched lazily via `get_channel_description` -
   *  use `useChannelDescription(channelId, description_size)` from the store. */
  description_size: number | null;
  user_count: number;
  /** Server-reported permission bitmask, or null if not yet queried. */
  permissions: number | null;
  /** Whether the channel is temporary. */
  temporary: boolean;
  /** Channel sort position. */
  position: number;
  /** Maximum users allowed (0 = unlimited). */
  max_users: number;
  /** Persistent-chat protocol, if announced by the server. */
  pchat_protocol?: PchatProtocol;
  /** Maximum stored messages (0 = unlimited). */
  pchat_max_history?: number;
  /** Auto-delete after N days (0 = forever). */
  pchat_retention_days?: number;
  /** Whether the channel requires a password (token) to enter. */
  is_enter_restricted?: boolean;
  /** Whether the channel is hidden (only users with SeeChannel see it). */
  hidden?: boolean;
  /** Whether the channel is detached: parentless, never shown in the channel
   *  tree, only delivered to Fancy clients (e.g. meeting rooms). Surfaced in the
   *  Meetings/Private-rooms viewer instead. */
  detached?: boolean;
  /** Channel expiry mode: 0 = none, 1 = absolute, 2 = sliding. */
  expiry_mode?: number;
  /** Expiry lifetime / idle window in seconds (0 = none). */
  expiry_duration_secs?: number;
  /** Server-computed absolute expiry deadline (unix seconds, 0 = none). */
  expires_at?: number;
}

export interface UserEntry {
  session: number;
  name: string;
  channel_id: number;
  /** Registered user ID, or null/undefined if not registered. */
  user_id?: number | null;
  /** Byte length of the avatar image, or null if no avatar.
   *  The actual bytes must be fetched lazily via `get_user_texture` -
   *  use `useUserAvatar(session, texture_size)` from the store. */
  texture_size: number | null;
  /** Existence/version marker for a live user's comment/bio, or null if none.
   *  The text is fetched lazily via `get_user_comment` - use
   *  `useUserComment(session, comment_size)`.  (Bios may carry a FancyMumble
   *  profile JSON marker.)  Optional only so test/synthetic `UserEntry`
   *  literals need not set it; live backend payloads always include it. */
  comment_size?: number | null;
  /** Inline comment text.  Only set on synthetic/offline member entries
   *  (registered-members list); live users leave this undefined and resolve
   *  the bio through `comment_size` + `useUserComment`. */
  comment?: string | null;
  /** Server-side admin mute. */
  mute: boolean;
  /** Server-side admin deafen. */
  deaf: boolean;
  /** Suppressed by the server. */
  suppress: boolean;
  /** User has self-muted. */
  self_mute: boolean;
  /** User has self-deafened. */
  self_deaf: boolean;
  /** Priority speaker status. */
  priority_speaker: boolean;
  /** TLS certificate hash (hex-encoded SHA-1). Used as stable identity. */
  hash?: string;
}

export interface ChatMessage {
  sender_session: number | null;
  sender_name: string;
  /** TLS certificate hash of the sender. Stable across reconnects. */
  sender_hash?: string | null;
  body: string;
  channel_id: number;
  is_own: boolean;
  /** When set, this message is a DM. Value is the other user's session ID. */
  dm_session?: number | null;
  /** Unique message identifier (Fancy Mumble extension). Absent on legacy servers. */
  message_id?: string | null;
  /** Unix epoch milliseconds (Fancy Mumble extension). Absent on legacy servers. */
  timestamp?: number | null;
  /** When true the message was sent by a legacy (non-E2EE) client on a pchat channel. */
  is_legacy?: boolean;
  /** Unix epoch millis when the message was edited. Absent if never edited. */
  edited_at?: number | null;
  /** Whether this message is pinned to the channel. */
  pinned?: boolean;
  /** Display name of the user who pinned this message. */
  pinned_by?: string | null;
  /** Unix epoch millis when the message was pinned. */
  pinned_at?: number | null;
  /** When set, this bubble was authored by the named plugin via the
   *  `chat_message!` macro rather than received from a user. */
  plugin_name?: string | null;
  /** Opaque ActionRow[] payload for plugin-authored bubbles.  The
   *  shape mirrors `ResponseKind.chat-message.components`; rendered
   *  by `RenderComponent` in `MessageItem`. */
  plugin_components?: readonly unknown[] | null;
}

/**
 * An optimistically-rendered chat message that is currently being sent
 * to the server.  Lives only in the frontend store; replaced by the
 * real ChatMessage once `send_message` resolves successfully (or marked
 * as failed if the send rejects).
 */
export interface PendingMessage {
  /** Frontend-generated correlation id (UUID). */
  pendingId: string;
  /** Channel id this message targets. Null when sending a DM. */
  channelId: number | null;
  /** Other participant's session for DMs. Null for channel messages. */
  dmSession: number | null;
  /** HTML body that was passed to send_message. */
  body: string;
  /** Unix epoch ms when the send was initiated. */
  createdAt: number;
  /** Lifecycle state. */
  state: "sending" | "failed";
  /** Optional error message when state === "failed". */
  errorMessage?: string;
}

// --- Read receipts ------------------------------------------------

/** A single user's read watermark for a channel. */
export interface ReadState {
  cert_hash: string;
  name: string;
  is_online: boolean;
  last_read_message_id: string;
  timestamp: number;
}

/** Payload emitted by the backend when a read-receipt-deliver arrives. */
export interface ReadReceiptDeliverPayload {
  channel_id: number;
  read_states: ReadState[];
  query_message_id?: string | null;
}
