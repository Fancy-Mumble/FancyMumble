//! Event payloads emitted to the frontend (connection, messaging, plugin-data,
//! WebRTC signalling and persistent-chat key/reaction/pin events).

use std::collections::HashMap;

use serde::Serialize;

use super::serde_helpers::serialize_bytes_base64;

#[derive(Clone, Serialize)]
pub(crate) struct NewMessagePayload {
    pub channel_id: u32,
    pub sender_session: Option<u32>,
}

/// Emitted when a new direct message arrives.
#[derive(Clone, Serialize)]
pub(crate) struct NewDmPayload {
    /// Session ID of the conversation partner (the sender for incoming DMs).
    pub session: u32,
}

#[derive(Clone, Serialize)]
pub(crate) struct RejectedPayload {
    /// Id of the session that was rejected.  Allows the frontend to
    /// route the rejection to the correct tab and avoid clobbering
    /// other sessions' state.  May be `None` for early connect-time
    /// failures before a session was registered.
    #[serde(rename = "serverId")]
    pub server_id: Option<String>,
    pub reason: String,
    /// Protobuf `Reject.RejectType` value, if available.
    /// `3` = `WrongUserPW`, `4` = `WrongServerPW`.
    pub reject_type: Option<i32>,
}

/// Payload for the `server-disconnected` event.  Carries the id of
/// the session that was disconnected so the frontend can route the
/// event to the correct tab and avoid clobbering other sessions'
/// state.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DisconnectedPayload {
    pub server_id: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct UnreadPayload {
    /// `channel_id` -> unread count
    pub unreads: HashMap<u32, u32>,
}

#[derive(Clone, Serialize)]
pub(crate) struct DmUnreadPayload {
    /// `session_id` -> unread DM count
    pub unreads: HashMap<u32, u32>,
}

#[derive(Clone, Serialize)]
pub(crate) struct ListenDeniedPayload {
    pub channel_id: u32,
}

#[derive(Clone, Serialize)]
pub(crate) struct ChannelDeniedPayload {
    pub channel_id: u32,
}

#[derive(Clone, Serialize)]
pub(crate) struct PermissionDeniedPayload {
    pub deny_type: Option<i32>,
    pub reason: Option<String>,
}

/// Cached snapshot of the server's `PluginRegistry`.  Also forms the
/// `plugin-registry` Tauri event payload (frontend field names match
/// `PluginRegistryEntry` in `ui/src/store.ts`).  We cache it so the UI
/// can resync after an HMR reload, which loses the one-shot event.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PluginRegistryEntryPayload {
    pub plugin_name: String,
    pub version: String,
    pub plugin_slot: Option<u32>,
    pub info_json: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct PluginDataPayload {
    pub sender_session: Option<u32>,
    /// Raw payload bytes, serialized as a base64 string.  A plain
    /// `Vec<u8>` would serialize as a JSON array of numbers, which
    /// `serde_json` represents at ~32 heap bytes per payload byte - a
    /// 1.6 MB server-emotes broadcast measured 51 MB as a `Value` plus
    /// ~19 MB more in the Tauri event script.  Base64 keeps it at
    /// ~1.3x the byte size end to end.
    #[serde(serialize_with = "serialize_bytes_base64")]
    pub data: Vec<u8>,
    pub data_id: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct WebRtcSignalPayload {
    pub sender_session: Option<u32>,
    pub target_session: Option<u32>,
    pub signal_type: i32,
    pub payload: String,
}

#[derive(Clone, Serialize)]
pub(crate) struct CurrentChannelPayload {
    pub channel_id: u32,
}

/// Payload emitted when pchat history loading starts or finishes for a channel.
#[derive(Clone, Serialize)]
pub(crate) struct PchatHistoryLoadingPayload {
    pub channel_id: u32,
    pub loading: bool,
}

/// Payload emitted when a `PchatFetchResponse` has been fully processed.
#[derive(Clone, Serialize)]
pub(crate) struct PchatFetchCompletePayload {
    pub channel_id: u32,
    pub has_more: bool,
    pub total_stored: u32,
}

/// Payload emitted when a `PchatReactionDeliver` is received (single reaction event).
#[derive(Clone, Serialize)]
pub(crate) struct ReactionDeliverPayload {
    pub channel_id: u32,
    pub message_id: String,
    pub emoji: String,
    pub action: String,
    pub sender_hash: String,
    pub sender_name: String,
    pub timestamp: u64,
}

/// A single stored reaction within a `PchatReactionFetchResponse`.
#[derive(Clone, Serialize)]
pub(crate) struct StoredReactionPayload {
    pub message_id: String,
    pub emoji: String,
    pub sender_hash: String,
    pub sender_name: String,
    pub timestamp: u64,
}

/// Payload emitted when a `PchatReactionFetchResponse` is received (batch of reactions).
#[derive(Clone, Serialize)]
pub(crate) struct ReactionFetchResponsePayload {
    pub channel_id: u32,
    pub reactions: Vec<StoredReactionPayload>,
}

/// Payload emitted when a `PchatPinDeliver` is received (pin state change).
#[derive(Clone, Serialize)]
pub(crate) struct PinDeliverPayload {
    pub channel_id: u32,
    pub message_id: String,
    pub pinned: bool,
    pub pinner_hash: String,
    pub pinner_name: String,
    pub timestamp: u64,
}

/// Payload emitted when a `PchatPinFetchResponse` is received (batch of pins).
#[derive(Clone, Serialize)]
pub(crate) struct StoredPinPayload {
    pub message_id: String,
    pub pinner_hash: String,
    pub pinner_name: String,
    pub timestamp: u64,
}

/// Payload emitted when a `PchatPinFetchResponse` is received.
#[derive(Clone, Serialize)]
pub(crate) struct PinFetchResponsePayload {
    pub channel_id: u32,
    pub pins: Vec<StoredPinPayload>,
}

/// A pending key-share request waiting for user approval.
#[derive(Clone, Debug, Serialize)]
pub(crate) struct PendingKeyShare {
    /// Channel that the key would be shared for.
    pub channel_id: u32,
    /// Certificate hash of the peer requesting the key.
    pub peer_cert_hash: String,
    /// Display name of the peer (resolved from current users).
    pub peer_name: String,
    /// Server-assigned request ID (present for consensus key-request path,
    /// `None` for proactive key-announce path).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub request_id: Option<String>,
}

/// Payload for the "pchat-key-share-request" frontend event.
#[derive(Clone, Serialize)]
pub(crate) struct KeyShareRequestPayload {
    pub channel_id: u32,
    pub peer_name: String,
    pub peer_cert_hash: String,
}
/// Payload for the \"pchat-key-share-requests-changed\" event (after approve/dismiss).
#[derive(Clone, Serialize)]
pub(crate) struct KeyShareRequestsChangedPayload {
    pub channel_id: u32,
    pub pending: Vec<PendingKeyShare>,
}
/// A user known to hold the encryption key for a channel.
#[derive(Clone, Debug, Serialize)]
pub struct KeyHolderEntry {
    /// TLS certificate hash (stable identity).
    pub cert_hash: String,
    /// Display name (resolved from online users or last known).
    pub name: String,
    /// Whether the user is currently online.
    pub is_online: bool,
}

/// Payload for the "pchat-key-holders-changed" event.
#[derive(Clone, Serialize)]
pub(crate) struct KeyHoldersChangedPayload {
    pub channel_id: u32,
    pub holders: Vec<KeyHolderEntry>,
}

/// Payload for the "pchat-key-revoked" event.
#[derive(Clone, Serialize)]
pub(crate) struct PchatKeyRevokedPayload {
    pub channel_id: u32,
}

/// Payload for the "pchat-signal-bridge-error" event.
/// Sent when the signal bridge library fails to load, making `SignalV1`
/// encryption unavailable.
#[derive(Clone, Serialize)]
pub(crate) struct SignalBridgeErrorPayload {
    pub message: String,
}

/// Result sent through the oneshot channel when a `PchatAck` for a deletion
/// request is received from the server.
pub(crate) struct DeleteAckResult {
    pub success: bool,
    pub reason: Option<String>,
}
