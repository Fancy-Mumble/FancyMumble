//! Core UI value types serialised to the frontend: channels, users, chat
//! messages and the connection status.

use serde::Serialize;

use mumble_protocol::state::PchatProtocol;

use super::serde_helpers::{serialize_pchat_protocol, serialize_string_len_owned};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChannelEntry {
    pub id: u32,
    pub parent_id: Option<u32>,
    pub name: String,
    /// Channel description blob.  Serialised to the frontend as
    /// `description_size: u32 | null` (byte length only) to keep
    /// `get_channels` payloads small; fetched lazily via
    /// `get_channel_description`.
    #[serde(rename = "description_size", serialize_with = "serialize_string_len_owned")]
    pub description: String,
    /// SHA-256 hash of the description blob.  Internal tracking only;
    /// not serialised to the frontend.
    #[serde(skip)]
    pub description_hash: Option<Vec<u8>>,
    pub user_count: u32,
    /// Server-reported permission bitmask for this channel.
    /// `None` until a `PermissionQuery` response is received.
    pub permissions: Option<u32>,
    /// Whether the channel is temporary.
    pub temporary: bool,
    /// Channel sort position.
    pub position: i32,
    /// Maximum users allowed (0 = unlimited).
    pub max_users: u32,
    /// Persistent-chat protocol.  `None` if not announced by the server.
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "serialize_pchat_protocol")]
    pub pchat_protocol: Option<PchatProtocol>,
    /// Maximum stored messages (0 = unlimited).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pchat_max_history: Option<u32>,
    /// Auto-delete after N days (0 = forever).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pchat_retention_days: Option<u32>,
    /// Key custodian cert hashes (Section 5.7).
    #[serde(skip)]
    pub pchat_key_custodians: Vec<String>,
    /// Whether the channel requires a password (token) to enter.
    #[serde(default)]
    pub is_enter_restricted: bool,
    /// Whether this channel is hidden (only users with SeeChannel see it).
    #[serde(default)]
    pub hidden: bool,
    /// Whether this channel is detached: parentless (like the root), never shown
    /// in the channel tree, and only ever delivered to Fancy clients. Surfaced in
    /// the Meetings/Private-rooms viewer instead. Derived from the ChannelState
    /// `attributes` set (CHANNEL_ATTRIBUTE_DETACHED).
    #[serde(default)]
    pub detached: bool,
    /// Channel expiry mode: 0 = none, 1 = absolute, 2 = sliding.
    #[serde(default)]
    pub expiry_mode: u32,
    /// Expiry lifetime / idle window in seconds (0 = none).
    #[serde(default)]
    pub expiry_duration_secs: u32,
    /// Server-computed absolute expiry deadline (unix seconds, 0 = none).
    #[serde(default)]
    pub expires_at: u64,
}

/// Sentinel `channel_id` for a "presence-hidden" user: the server announces such
/// a user to us (sync, channel-move, or a message identity announce) so we can
/// show them as **online** and attribute their messages, while withholding which
/// channel they actually sit in, because we lack `SeeChannel` for it. It is not a
/// real channel id (channel ids are assigned from 0 upward), so such a user is
/// kept in the user list (online, friend/DM lookups by hash succeed) but never
/// renders in the channel tree - in particular never at root.
///
/// The server sends this id **explicitly** (it matches the server's
/// `PRESENCE_HIDDEN_CHANNEL_ID`) and only to Fancy clients. We must NOT infer it
/// from a merely-absent channel id: the server omits `channel_id` for users in
/// the root channel (id 0), so treating "no channel id" as hidden would wrongly
/// hide everyone in root.
pub const PRESENCE_HIDDEN_CHANNEL: u32 = u32::MAX;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UserEntry {
    pub session: u32,
    pub name: String,
    pub channel_id: u32,
    /// Registered user ID. `None` means the user is not registered.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<u32>,
    /// Loaded avatar bytes.  Internal only: never serialised (the frontend
    /// fetches them on demand via `get_user_texture`).  `None` until the blob
    /// has actually been requested + received, so the backend does NOT hold an
    /// avatar for every connected user - only for those a client has viewed.
    #[serde(skip)]
    pub texture: Option<Vec<u8>>,
    /// Avatar existence/version marker, serialised to the frontend as
    /// `texture_size: u32 | null`.  Non-zero whenever the user HAS an avatar -
    /// even before its bytes are loaded - so the UI knows to fetch it; its
    /// value changes when the avatar changes so caches invalidate.  Derived
    /// from the server's `texture_hash` (or the inline blob length).
    #[serde(rename = "texture_size")]
    pub texture_marker: Option<u32>,
    /// Loaded comment/bio text.  Internal only: never serialised (the frontend
    /// fetches it on demand via `get_user_comment`).  `None` until requested,
    /// so the backend does not hold every user's (potentially banner-laden) bio
    /// - only those a client has viewed.
    #[serde(skip)]
    pub comment: Option<String>,
    /// Comment existence/version marker, serialised as `comment_size: u32 | null`
    /// (mirrors `texture_size`).  Non-zero whenever the user HAS a comment - even
    /// before its text is loaded - so the UI knows to fetch it; changes when the
    /// comment changes so caches invalidate.
    #[serde(rename = "comment_size")]
    pub comment_marker: Option<u32>,
    /// Server-side admin mute.
    pub mute: bool,
    /// Server-side admin deafen.
    pub deaf: bool,
    /// Suppressed by the server (e.g. moved to AFK channel).
    pub suppress: bool,
    /// User has self-muted.
    pub self_mute: bool,
    /// User has self-deafened.
    pub self_deaf: bool,
    /// Priority speaker status.
    pub priority_speaker: bool,
    /// TLS certificate hash (hex-encoded SHA-1). Used as stable identity
    /// for persistent chat key management.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// Server-advertised client capabilities (see `UserState.ClientFeature`).
    #[serde(skip)]
    pub client_features: Vec<i32>,
}

impl UserEntry {
    pub fn new(session: u32) -> Self {
        Self {
            session,
            name: String::new(),
            channel_id: 0,
            user_id: None,
            texture: None,
            texture_marker: None,
            comment_marker: None,
            comment: None,
            mute: false,
            deaf: false,
            suppress: false,
            self_mute: false,
            self_deaf: false,
            priority_speaker: false,
            hash: None,
            client_features: Vec::new(),
        }
    }

    /// Returns `true` if this user advertises E2EE persistent chat support.
    pub fn has_pchat_e2ee(&self) -> bool {
        use mumble_protocol::proto::mumble_tcp::user_state::ClientFeature;
        self.client_features
            .contains(&(ClientFeature::FeaturePchatE2ee as i32))
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChatMessage {
    pub sender_session: Option<u32>,
    pub sender_name: String,
    /// TLS certificate hash of the sender.  Stable across reconnects,
    /// allowing the frontend to resolve the sender's profile even when
    /// `sender_session` is stale or `None`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sender_hash: Option<String>,
    pub body: String,
    pub channel_id: u32,
    pub is_own: bool,
    /// When set, this message is a direct message (DM) to/from a specific user.
    /// The value is the *other* user's session ID (the conversation partner).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dm_session: Option<u32>,
    /// Unique message identifier (Fancy Mumble extension).
    /// `None` when the server/sender does not support extensions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message_id: Option<String>,
    /// Unix epoch milliseconds (Fancy Mumble extension).
    /// `None` when the server/sender does not support extensions.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    /// `true` when the message came from a legacy (non-E2EE) client on a
    /// pchat-enabled channel and was therefore sent in plaintext.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub is_legacy: bool,
    /// When set, the message was edited at this Unix-epoch-millisecond timestamp.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub edited_at: Option<u64>,
    /// Whether this message is pinned.
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    /// Certificate hash of the user who pinned this message.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_by: Option<String>,
    /// Unix epoch milliseconds when the message was pinned.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pinned_at: Option<u64>,
    /// Plugin-authored origin: the `plugin_name` of the plugin that
    /// injected this message via a `chat-message` interaction
    /// response.  `None` for ordinary user/server messages.
    ///
    /// Component interactions on this message route back to this
    /// plugin so the originating handler can react.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_name: Option<String>,
    /// Plugin-authored UI components attached to this message,
    /// rendered inline in the chat bubble below the body.  Stored
    /// as opaque JSON (mirroring the
    /// [`mumble_plugin_api::ActionRow`] wire format) so this crate
    /// does not have to depend on the plugin API.  `None` (or an
    /// empty array) means no interactive components.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plugin_components: Option<serde_json::Value>,
}

impl ChatMessage {
    /// Ensure the message has a `message_id`, generating a UUID if absent.
    ///
    /// A stable ID is required so the offloading system can refer to the
    /// message across encrypt/store/restore cycles.
    pub fn ensure_id(&mut self) {
        if self.message_id.is_none() {
            self.message_id = Some(uuid::Uuid::new_v4().to_string());
        }
    }
}

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionStatus {
    #[default]
    Disconnected,
    Connecting,
    Connected,
}
