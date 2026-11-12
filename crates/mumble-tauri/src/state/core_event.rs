//! What the engine tells its view.
//!
//! Every event crosses the engine/host seam as an [`Event`]: a [`CoreEvent`]
//! plus the session it is about. A native view matches on the enum and takes
//! the payload as the Rust value it is. A view that speaks JSON (the webview)
//! calls [`Event::into_wire`], which writes the event out under the name and
//! in the shape its frontend has always listened for.
//!
//! Not every event is typed yet. Those that are not travel as
//! [`CoreEvent::Untyped`] - a name and its JSON - so they can be moved over
//! one group at a time without the wire format changing under the frontend.

use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

use super::canon_emotes::CanonEmote;
use super::handler::audit::{AuditResponsePayload, AuditSnapshotPayload};
use super::handler::custom_reactions_config::CustomReactionPayload;
use super::handler::draw_stroke::DrawStrokePayload;
use super::handler::files::{
    ChannelFiles, ManagedFiles, RefusedRequest, SharedFile, VoiceSupportPayload,
};
use super::handler::forum::{ForumFetchResponsePayload, ForumPostPayload};
use super::handler::gifs::{GifPagePayload, GifRefusedPayload, GifSupportPayload};
use super::handler::link_preview::LinkPreviewResponsePayload;
use super::handler::livery::LiverySnapshot;
use super::handler::operator_ticket::OperatorTicket;
use super::handler::plugin_admin::{PluginAdminAckPayload, PluginAdminListPayload};
use super::handler::plugin_message::PluginMessagePayload;
use super::handler::poll::{PollPayload, PollVotePayload};
use super::handler::read_receipt::ReadReceiptDeliverPayload;
use super::handler::scheduled_message::{ScheduledMessageAckPayload, ScheduledMessagePayload};
use super::handler::typing_indicator::TypingIndicatorPayload;
use super::handler::version::ServerVersionPayload;
use super::handler::watch_sync::WatchSyncPayload;
use super::sessions::ServerId;
use super::types::{
    AclPayload, AudioTransportPayload, AuditConfigSnapshot, AuditEntryPayload, BanEntryPayload,
    ChannelDeniedPayload, CryptoStatsPayload, CurrentChannelPayload, CustodianPinPayload,
    DisconnectedPayload, DmUnreadPayload, KeyHoldersChangedPayload, KeyShareRequestPayload,
    KeyShareRequestsChangedPayload, LatencyPayload, ListenDeniedPayload, NewDmPayload,
    NewMessagePayload, PchatFetchCompletePayload, PchatHistoryLoadingPayload,
    PchatKeyRevokedPayload, PchatSendRejectedPayload, PermissionDeniedPayload, PinDeliverPayload,
    PinFetchResponsePayload, PluginDataPayload, PluginRegistryEntryPayload, ReactionDeliverPayload,
    ReactionFetchResponsePayload, RegisteredUserPayload, RejectedPayload, ServerLogEntry,
    ServerSettingsSnapshot, SignalBridgeErrorPayload, UnreadPayload, UploadProgressPayload,
    UserCommentPayload, UserStatsPayload, VoiceState, WebRtcSignalPayload,
};

/// Something that happened in the engine that a view may want to show.
pub(crate) enum CoreEvent {
    /// A connection attempt has started.
    Connecting,
    /// The server accepted the connection and sent its initial state.
    Connected,
    /// A session ended, by either side.
    Disconnected(DisconnectedPayload),
    /// The server refused a connection or removed the user.
    ConnectionRejected(RejectedPayload),
    /// Channels, users or their properties changed; a view that mirrors them
    /// should read them again.
    StateChanged,
    /// The local user is now in another channel.
    CurrentChannelChanged(CurrentChannelPayload),
    /// A user started or stopped talking.
    UserTalking {
        /// The session that is talking, or has stopped.
        session: u32,
        /// Whether it is talking now.
        talking: bool,
    },
    /// The local voice state (inactive, active, muted) changed.
    VoiceStateChanged(VoiceState),
    /// A channel received, changed or lost a message.
    NewMessage(NewMessagePayload),
    /// The per-channel unread counts changed.
    UnreadChanged(UnreadPayload),
    /// The per-conversation unread counts for direct messages changed.
    DmUnreadChanged(DmUnreadPayload),
    /// A direct message arrived.
    NewDm(NewDmPayload),
    /// Stored history for a channel started or finished loading.
    PchatHistoryLoading(PchatHistoryLoadingPayload),
    /// A page of stored history has been merged into its channel.
    PchatFetchComplete(PchatFetchCompletePayload),
    /// The server refused to store messages the view already shows as sent.
    PchatSendRejected(PchatSendRejectedPayload),
    /// The set of users holding a channel's key changed.
    PchatKeyHoldersChanged(KeyHoldersChangedPayload),
    /// A peer asked for a channel's key and waits for the user's consent.
    PchatKeyShareRequested(KeyShareRequestPayload),
    /// The key requests still waiting on a channel changed.
    PchatKeyShareRequestsChanged(KeyShareRequestsChangedPayload),
    /// The channel's key failed verification and was thrown away.
    PchatKeyRevoked(PchatKeyRevokedPayload),
    /// A channel that had lost its key has one again.
    PchatKeyRestored(PchatKeyRevokedPayload),
    /// A reaction was added to or removed from a stored message.
    PchatReactionDelivered(ReactionDeliverPayload),
    /// The stored reactions of a channel arrived.
    PchatReactionsFetched(ReactionFetchResponsePayload),
    /// A stored message was pinned or unpinned.
    PchatPinDelivered(PinDeliverPayload),
    /// The pinned messages of a channel arrived.
    PchatPinsFetched(PinFetchResponsePayload),
    /// The Signal bridge could not be loaded, so `SignalV1` channels stay unreadable.
    PchatSignalBridgeError(SignalBridgeErrorPayload),
    /// A file was shared in a channel.
    FileShared(SharedFile),
    /// The files shared in a channel.
    FileListing(ChannelFiles),
    /// The server refused a file request that nothing else was waiting on.
    FileRequestRefused(RefusedRequest),
    /// The answer to a file-management request.
    FilesManaged(ManagedFiles),
    /// What the server allows of voice messages.
    VoiceSupport(VoiceSupportPayload),
    /// The server's custom emotes, all of them.
    ServerEmotesChanged(Vec<CanonEmote>),
    /// An upload moved on by at least one percent.
    UploadProgress(UploadProgressPayload),
    /// A page of the audit log, in answer to a query.
    AuditResponse(AuditResponsePayload),
    /// An avatar or comment the audit log kept, in answer to a request for it.
    AuditSnapshot(AuditSnapshotPayload),
    /// The server's bans, all of them.
    BanList(Vec<BanEntryPayload>),
    /// The groups and access rules of one channel.
    Acl(AclPayload),
    /// The server's registered users.
    RegisteredUsers(Vec<RegisteredUserPayload>),
    /// The comment of one registered user, fetched on demand.
    UserComment(UserCommentPayload),
    /// An entry was just written to the audit log.
    AuditEvent(AuditEntryPayload),
    /// The audit log's configuration, as the server now has it.
    AuditConfig(AuditConfigSnapshot),
    /// The server answered a request for an operator ticket.
    OperatorTicket(OperatorTicket),
    /// The plugins installed on the server.
    PluginAdminList(PluginAdminListPayload),
    /// The outcome of one plugin administration request.
    PluginAdminAck(PluginAdminAckPayload),
    /// A message from a server plugin, its payload left as the plugin wrote it.
    PluginMessage(PluginMessagePayload),
    /// Plugin data that arrived over the legacy transmission path.
    PluginData(PluginDataPayload),
    /// The plugins the server runs, and the slot each one answers on.
    PluginRegistry(Vec<PluginRegistryEntryPayload>),
    /// The server's configuration changed; a view that shows it should read it again.
    ServerConfigChanged,
    /// Which Fancy version and protocol the server speaks, once known.
    ServerVersion(ServerVersionPayload),
    /// A line for the server's activity log.
    ServerLog(ServerLogEntry),
    /// The round trip of the latest control-channel ping.
    PingLatency(LatencyPayload),
    /// The reactions this server defines, all of them.
    CustomReactionsConfig(Vec<CustomReactionPayload>),
    /// How many voice packets arrived well, late or not at all.
    CryptoStats(CryptoStatsPayload),
    /// Voice moved between UDP and the TCP tunnel, or changed cipher.
    AudioTransportChanged(AudioTransportPayload),
    /// Connection statistics for one user, in answer to a request.
    UserStats(UserStatsPayload),
    /// The server's editable settings, as it now has them.
    ServerSettings(ServerSettingsSnapshot),
    /// How the server presents itself: name, colours, artwork.
    ServerLivery(LiverySnapshot),
    /// The server refused something the user asked for.
    PermissionDenied(PermissionDeniedPayload),
    /// The user may not enter a channel.
    ChannelDenied(ChannelDeniedPayload),
    /// The user may not listen to a channel.
    ListenDenied(ListenDeniedPayload),
    /// The custodians a channel's key is pinned to changed.
    CustodianPinChanged(CustodianPinPayload),
    /// A user is typing in a channel.
    TypingIndicator(TypingIndicatorPayload),
    /// How far each member has read a channel.
    ReadReceipts(ReadReceiptDeliverPayload),
    /// The server's preview cards for the links it was asked about.
    LinkPreviews(LinkPreviewResponsePayload),
    /// A direct message was edited or deleted.
    DmEdited(NewDmPayload),
    /// A direct message sent from another of the user's own sessions arrived.
    DmSynced(NewDmPayload),
    /// A stroke on a shared drawing surface.
    DrawStroke(DrawStrokePayload),
    /// A watch-together session started, moved or ended.
    WatchSync(WatchSyncPayload),
    /// WebRTC signalling the view's own peers must answer.
    WebRtcSignal(WebRtcSignalPayload),
    /// A poll was posted in a channel.
    Poll(PollPayload),
    /// Someone voted in a poll.
    PollVote(PollVotePayload),
    /// A forum post was created, edited or deleted.
    ForumPost(ForumPostPayload),
    /// A page of a forum channel's posts.
    ForumPosts(ForumFetchResponsePayload),
    /// The server's answer to scheduling or cancelling a message.
    ScheduledMessageAck(ScheduledMessageAckPayload),
    /// A page of GIF search results.
    GifPage(GifPagePayload),
    /// The server refused a GIF search.
    GifSearchRefused(GifRefusedPayload),
    /// Whether the server offers a GIF search, and through whom.
    GifSupport(GifSupportPayload),
    /// The user's scheduled messages, all of them.
    ScheduledMessages(Vec<ScheduledMessagePayload>),
    /// An event that has not been given a variant yet: its wire name and its
    /// payload, already written out as JSON.
    Untyped {
        /// The name the frontend listens for.
        name: &'static str,
        /// The payload as JSON.
        payload: Box<RawValue>,
    },
}

impl CoreEvent {
    /// An event that has no variant yet, from its wire name and payload.
    ///
    /// # Errors
    ///
    /// When `payload` cannot be represented as JSON.
    pub(crate) fn untyped<S: Serialize>(
        name: &'static str,
        payload: S,
    ) -> Result<Self, serde_json::Error> {
        Ok(Self::Untyped {
            name,
            payload: serde_json::value::to_raw_value(&payload)?,
        })
    }

    /// The name a JSON-speaking view listens for.
    pub(crate) fn name(&self) -> &'static str {
        match self {
            Self::Connecting => "status-changed",
            Self::Connected => "server-connected",
            Self::Disconnected(_) => "server-disconnected",
            Self::ConnectionRejected(_) => "connection-rejected",
            Self::StateChanged => "state-changed",
            Self::CurrentChannelChanged(_) => "current-channel-changed",
            Self::UserTalking { .. } => super::audio::USER_TALKING_EVENT,
            Self::VoiceStateChanged(_) => "voice-state-changed",
            Self::NewMessage(_) => "new-message",
            Self::UnreadChanged(_) => "unread-changed",
            Self::DmUnreadChanged(_) => "dm-unread-changed",
            Self::NewDm(_) => "new-dm",
            Self::PchatHistoryLoading(_) => "pchat-history-loading",
            Self::PchatFetchComplete(_) => "pchat-fetch-complete",
            Self::PchatSendRejected(_) => "pchat-send-rejected",
            Self::PchatKeyHoldersChanged(_) => "pchat-key-holders-changed",
            Self::PchatKeyShareRequested(_) => "pchat-key-share-request",
            Self::PchatKeyShareRequestsChanged(_) => "pchat-key-share-requests-changed",
            Self::PchatKeyRevoked(_) => "pchat-key-revoked",
            Self::PchatKeyRestored(_) => "pchat-key-restored",
            Self::PchatReactionDelivered(_) => "pchat-reaction-deliver",
            Self::PchatReactionsFetched(_) => "pchat-reaction-fetch-response",
            Self::PchatPinDelivered(_) => "pchat-pin-deliver",
            Self::PchatPinsFetched(_) => "pchat-pin-fetch-response",
            Self::PchatSignalBridgeError(_) => "pchat-signal-bridge-error",
            Self::FileShared(_) => "starling-file-shared",
            Self::FileListing(_) => "starling-file-listing",
            Self::FileRequestRefused(_) => "starling-file-refused",
            Self::FilesManaged(_) => "starling-files-managed",
            Self::VoiceSupport(_) => "voice-support",
            Self::ServerEmotesChanged(_) => "server-emotes-changed",
            Self::UploadProgress(_) => "upload-progress",
            Self::AuditResponse(_) => "audit-response",
            Self::AuditSnapshot(_) => "audit-snapshot",
            Self::BanList(_) => "ban-list",
            Self::Acl(_) => "acl",
            Self::RegisteredUsers(_) => "user-list",
            Self::UserComment(_) => "user-comment",
            Self::AuditEvent(_) => "audit-event",
            Self::AuditConfig(_) => "audit-config",
            Self::OperatorTicket(_) => "operator-ticket",
            Self::PluginAdminList(_) => "plugin-admin-list",
            Self::PluginAdminAck(_) => "plugin-admin-ack",
            Self::PluginMessage(_) => "plugin-message",
            Self::PluginData(_) => "plugin-data",
            Self::PluginRegistry(_) => "plugin-registry",
            Self::ServerConfigChanged => "server-config",
            Self::ServerVersion(_) => "server-version",
            Self::ServerLog(_) => "server-log",
            Self::PingLatency(_) => "ping-latency",
            Self::CustomReactionsConfig(_) => "custom-reactions-config",
            Self::CryptoStats(_) => "crypto-stats",
            Self::AudioTransportChanged(_) => "audio-transport-changed",
            Self::UserStats(_) => "user-stats",
            Self::ServerSettings(_) => "server-settings",
            Self::ServerLivery(_) => "server-livery",
            Self::PermissionDenied(_) => "permission-denied",
            Self::ChannelDenied(_) => "channel-denied",
            Self::ListenDenied(_) => "listen-denied",
            Self::CustodianPinChanged(_) => "custodian-pin-changed",
            Self::TypingIndicator(_) => "typing-indicator",
            Self::ReadReceipts(_) => "read-receipt-deliver",
            Self::LinkPreviews(_) => "link-preview-response",
            Self::DmEdited(_) => "dm-edited",
            Self::DmSynced(_) => "dm-synced",
            Self::DrawStroke(_) => "draw-stroke",
            Self::WatchSync(_) => "watch-sync",
            Self::WebRtcSignal(_) => "webrtc-signal",
            Self::Poll(_) => "fancy-poll",
            Self::PollVote(_) => "fancy-poll-vote",
            Self::ForumPost(_) => "fancy-forum-post",
            Self::ForumPosts(_) => "fancy-forum-fetch-response",
            Self::ScheduledMessageAck(_) => "fancy-scheduled-message-ack",
            Self::GifPage(_) => "gif-search-page",
            Self::GifSearchRefused(_) => "gif-search-refused",
            Self::GifSupport(_) => "gif-support",
            Self::ScheduledMessages(_) => "fancy-scheduled-message-list",
            Self::Untyped { name, .. } => name,
        }
    }

    /// Whether the JSON payload is an object, and so can carry the id of the
    /// session it is about.
    fn payload_is_object(&self) -> bool {
        matches!(
            self,
            Self::Disconnected(_)
                | Self::ConnectionRejected(_)
                | Self::CurrentChannelChanged(_)
                | Self::NewMessage(_)
                | Self::UnreadChanged(_)
                | Self::DmUnreadChanged(_)
                | Self::NewDm(_)
                | Self::PchatHistoryLoading(_)
                | Self::PchatFetchComplete(_)
                | Self::PchatSendRejected(_)
                | Self::PchatKeyHoldersChanged(_)
                | Self::PchatKeyShareRequested(_)
                | Self::PchatKeyShareRequestsChanged(_)
                | Self::PchatKeyRevoked(_)
                | Self::PchatKeyRestored(_)
                | Self::PchatReactionDelivered(_)
                | Self::PchatReactionsFetched(_)
                | Self::PchatPinDelivered(_)
                | Self::PchatPinsFetched(_)
                | Self::PchatSignalBridgeError(_)
                | Self::FileShared(_)
                | Self::FileListing(_)
                | Self::FileRequestRefused(_)
                | Self::FilesManaged(_)
                | Self::VoiceSupport(_)
                | Self::UploadProgress(_)
                | Self::AuditResponse(_)
                | Self::AuditSnapshot(_)
                | Self::Acl(_)
                | Self::UserComment(_)
                | Self::AuditEvent(_)
                | Self::AuditConfig(_)
                | Self::OperatorTicket(_)
                | Self::PluginAdminList(_)
                | Self::PluginAdminAck(_)
                | Self::PluginMessage(_)
                | Self::PluginData(_)
                | Self::PluginRegistry(_)
                | Self::ServerVersion(_)
                | Self::ServerLog(_)
                | Self::PingLatency(_)
                | Self::CryptoStats(_)
                | Self::AudioTransportChanged(_)
                | Self::UserStats(_)
                | Self::ServerSettings(_)
                | Self::ServerLivery(_)
                | Self::PermissionDenied(_)
                | Self::ChannelDenied(_)
                | Self::ListenDenied(_)
                | Self::CustodianPinChanged(_)
                | Self::TypingIndicator(_)
                | Self::ReadReceipts(_)
                | Self::LinkPreviews(_)
                | Self::DmEdited(_)
                | Self::DmSynced(_)
                | Self::DrawStroke(_)
                | Self::WatchSync(_)
                | Self::WebRtcSignal(_)
                | Self::Poll(_)
                | Self::PollVote(_)
                | Self::ForumPost(_)
                | Self::ForumPosts(_)
                | Self::ScheduledMessageAck(_)
                | Self::GifPage(_)
                | Self::GifSearchRefused(_)
                | Self::GifSupport(_)
                | Self::ScheduledMessages(_)
        )
    }
}

/// Serialises to the event's JSON payload alone, in the shape the frontend has
/// always received; the name travels separately ([`CoreEvent::name`]).
impl Serialize for CoreEvent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Connecting => "connecting".serialize(serializer),
            Self::Connected | Self::StateChanged | Self::ServerConfigChanged => {
                ().serialize(serializer)
            }
            Self::Disconnected(payload) => payload.serialize(serializer),
            Self::ConnectionRejected(payload) => payload.serialize(serializer),
            Self::CurrentChannelChanged(payload) => payload.serialize(serializer),
            Self::UserTalking { session, talking } => (session, talking).serialize(serializer),
            Self::VoiceStateChanged(state) => state.serialize(serializer),
            Self::NewMessage(payload) => payload.serialize(serializer),
            Self::UnreadChanged(payload) => payload.serialize(serializer),
            Self::DmUnreadChanged(payload) => payload.serialize(serializer),
            Self::NewDm(payload) => payload.serialize(serializer),
            Self::PchatHistoryLoading(payload) => payload.serialize(serializer),
            Self::PchatFetchComplete(payload) => payload.serialize(serializer),
            Self::PchatSendRejected(payload) => payload.serialize(serializer),
            Self::PchatKeyHoldersChanged(payload) => payload.serialize(serializer),
            Self::PchatKeyShareRequested(payload) => payload.serialize(serializer),
            Self::PchatKeyShareRequestsChanged(payload) => payload.serialize(serializer),
            Self::PchatKeyRevoked(payload) => payload.serialize(serializer),
            Self::PchatKeyRestored(payload) => payload.serialize(serializer),
            Self::PchatReactionDelivered(payload) => payload.serialize(serializer),
            Self::PchatReactionsFetched(payload) => payload.serialize(serializer),
            Self::PchatPinDelivered(payload) => payload.serialize(serializer),
            Self::PchatPinsFetched(payload) => payload.serialize(serializer),
            Self::PchatSignalBridgeError(payload) => payload.serialize(serializer),
            Self::FileShared(payload) => payload.serialize(serializer),
            Self::FileListing(payload) => payload.serialize(serializer),
            Self::FileRequestRefused(payload) => payload.serialize(serializer),
            Self::FilesManaged(payload) => payload.serialize(serializer),
            Self::VoiceSupport(payload) => payload.serialize(serializer),
            Self::ServerEmotesChanged(payload) => payload.serialize(serializer),
            Self::UploadProgress(payload) => payload.serialize(serializer),
            Self::AuditResponse(payload) => payload.serialize(serializer),
            Self::AuditSnapshot(payload) => payload.serialize(serializer),
            Self::BanList(payload) => payload.serialize(serializer),
            Self::Acl(payload) => payload.serialize(serializer),
            Self::RegisteredUsers(payload) => payload.serialize(serializer),
            Self::UserComment(payload) => payload.serialize(serializer),
            Self::AuditEvent(entry) => keyed(serializer, "entry", entry),
            Self::AuditConfig(config) => keyed(serializer, "config", config),
            Self::OperatorTicket(ticket) => keyed(serializer, "ticket", ticket),
            Self::PluginAdminList(payload) => payload.serialize(serializer),
            Self::PluginAdminAck(payload) => payload.serialize(serializer),
            Self::PluginMessage(payload) => payload.serialize(serializer),
            Self::PluginData(payload) => payload.serialize(serializer),
            Self::PluginRegistry(plugins) => keyed(serializer, "plugins", plugins),
            Self::ServerVersion(payload) => payload.serialize(serializer),
            Self::ServerLog(payload) => payload.serialize(serializer),
            Self::PingLatency(payload) => payload.serialize(serializer),
            Self::CustomReactionsConfig(payload) => payload.serialize(serializer),
            Self::CryptoStats(payload) => payload.serialize(serializer),
            Self::AudioTransportChanged(payload) => payload.serialize(serializer),
            Self::UserStats(payload) => payload.serialize(serializer),
            Self::ServerSettings(settings) => keyed(serializer, "settings", settings),
            Self::ServerLivery(livery) => keyed(serializer, "livery", livery),
            Self::PermissionDenied(payload) => payload.serialize(serializer),
            Self::ChannelDenied(payload) => payload.serialize(serializer),
            Self::ListenDenied(payload) => payload.serialize(serializer),
            Self::CustodianPinChanged(payload) => payload.serialize(serializer),
            Self::TypingIndicator(payload) => payload.serialize(serializer),
            Self::ReadReceipts(payload) => payload.serialize(serializer),
            Self::LinkPreviews(payload) => payload.serialize(serializer),
            Self::DmEdited(payload) => payload.serialize(serializer),
            Self::DmSynced(payload) => payload.serialize(serializer),
            Self::DrawStroke(payload) => payload.serialize(serializer),
            Self::WatchSync(payload) => payload.serialize(serializer),
            Self::WebRtcSignal(payload) => payload.serialize(serializer),
            Self::Poll(payload) => payload.serialize(serializer),
            Self::PollVote(payload) => payload.serialize(serializer),
            Self::ForumPost(payload) => payload.serialize(serializer),
            Self::ForumPosts(payload) => payload.serialize(serializer),
            Self::ScheduledMessageAck(payload) => payload.serialize(serializer),
            Self::GifPage(payload) => payload.serialize(serializer),
            Self::GifSearchRefused(payload) => payload.serialize(serializer),
            Self::GifSupport(payload) => payload.serialize(serializer),
            Self::ScheduledMessages(messages) => keyed(serializer, "messages", messages),
            Self::Untyped { payload, .. } => payload.serialize(serializer),
        }
    }
}

/// Write `value` out as the one field `key` of an object: the shape of an
/// event whose JSON wraps a single value.
fn keyed<S: Serializer, T: Serialize>(
    serializer: S,
    key: &'static str,
    value: &T,
) -> Result<S::Ok, S::Error> {
    use serde::ser::SerializeMap;

    let mut map = serializer.serialize_map(Some(1))?;
    map.serialize_entry(key, value)?;
    map.end()
}

/// A [`CoreEvent`] and the session it is about.
pub(crate) struct Event {
    /// The session the event belongs to, when the engine knows: events from a
    /// connection's message handlers always carry it, so a view showing
    /// several servers can route them.
    pub server: Option<ServerId>,
    /// What happened.
    pub kind: CoreEvent,
}

impl Event {
    /// The event as a JSON-speaking view receives it: its wire name and its
    /// payload.
    ///
    /// An object payload that does not already say which server it is about
    /// gets a `serverId` field, which is how the frontend routes events to the
    /// right server tab. Other payloads (strings, arrays, `null`) are written
    /// out unchanged.
    ///
    /// # Errors
    ///
    /// When the payload cannot be represented as JSON.
    pub(crate) fn into_wire(self) -> Result<(&'static str, Box<RawValue>), serde_json::Error> {
        let name = self.kind.name();
        if let CoreEvent::Untyped { payload, .. } = self.kind {
            return Ok((name, payload));
        }
        let payload = match self.server {
            Some(server) if self.kind.payload_is_object() => {
                let mut value = serde_json::to_value(&self.kind)?;
                stamp_server_id(&mut value, server.to_string());
                serde_json::value::to_raw_value(&value)?
            }
            _ => serde_json::value::to_raw_value(&self.kind)?,
        };
        Ok((name, payload))
    }
}

/// Insert (or replace) a `serverId` field into a JSON-object payload.
///
/// Replaces missing OR explicitly-null `serverId` fields.  Payloads
/// serialised from `Option<String>::None` produce `"serverId": null`,
/// which would otherwise prevent the frontend from routing the event
/// to the correct tab.
pub(crate) fn stamp_server_id(payload: &mut serde_json::Value, id: impl Into<String>) {
    if !lacks_server_id(payload) {
        return;
    }
    if let Some(obj) = payload.as_object_mut() {
        let _ = obj.insert("serverId".to_owned(), serde_json::Value::String(id.into()));
    }
}

/// Whether `payload` is an object that does not yet say which server it is
/// about. Anything else is forwarded as it is, so there is nothing to look up
/// for it.
pub(crate) fn lacks_server_id(payload: &serde_json::Value) -> bool {
    payload
        .as_object()
        .is_some_and(|obj| obj.get("serverId").is_none_or(serde_json::Value::is_null))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn wire(server: Option<ServerId>, kind: CoreEvent) -> (&'static str, serde_json::Value) {
        let (name, payload) = Event { server, kind }.into_wire().unwrap();
        (name, serde_json::from_str(payload.get()).unwrap())
    }

    /// A variant that wraps a payload must write out exactly that payload:
    /// it is what the untyped emit it replaced sent.
    fn assert_carries<P: Serialize + Clone>(
        name: &str,
        payload: &P,
        variant: impl FnOnce(P) -> CoreEvent,
    ) {
        assert_eq!(
            wire(None, variant(payload.clone())),
            (name, serde_json::to_value(payload).unwrap())
        );
    }

    /// A variant whose JSON wraps its value in a one-field object.
    fn assert_carries_keyed<P: Serialize + Clone>(
        name: &str,
        key: &str,
        payload: &P,
        variant: impl FnOnce(P) -> CoreEvent,
    ) {
        assert_eq!(
            wire(None, variant(payload.clone())),
            (name, serde_json::json!({ key: payload }))
        );
    }

    /// The frontend listens for these exact names and shapes. A typed variant
    /// must write out exactly what the untyped emit it replaced did.
    #[test]
    fn typed_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(None, CoreEvent::Connecting),
            ("status-changed", json!("connecting"))
        );
        assert_eq!(
            wire(None, CoreEvent::Connected),
            ("server-connected", json!(null))
        );
        assert_eq!(
            wire(None, CoreEvent::StateChanged),
            ("state-changed", json!(null))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UserTalking {
                    session: 7,
                    talking: true
                }
            ),
            ("user-talking", json!([7, true]))
        );
        assert_eq!(
            wire(None, CoreEvent::VoiceStateChanged(VoiceState::Inactive)),
            ("voice-state-changed", json!("inactive"))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::CurrentChannelChanged(CurrentChannelPayload { channel_id: 3 })
            ),
            ("current-channel-changed", json!({ "channel_id": 3 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::NewMessage(NewMessagePayload {
                    channel_id: 3,
                    sender_session: Some(9),
                })
            ),
            (
                "new-message",
                json!({ "channel_id": 3, "sender_session": 9 })
            )
        );
        assert_eq!(
            wire(None, CoreEvent::NewDm(NewDmPayload { session: 9 })),
            ("new-dm", json!({ "session": 9 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UnreadChanged(UnreadPayload {
                    unreads: HashMap::from([(3, 2)]),
                })
            ),
            ("unread-changed", json!({ "unreads": { "3": 2 } }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::DmUnreadChanged(DmUnreadPayload {
                    unreads: HashMap::from([(9, 1)]),
                })
            ),
            ("dm-unread-changed", json!({ "unreads": { "9": 1 } }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::Disconnected(DisconnectedPayload {
                    server_id: Some("srv-1".to_owned()),
                    reason: None,
                })
            ),
            (
                "server-disconnected",
                json!({ "serverId": "srv-1", "reason": null })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ConnectionRejected(RejectedPayload {
                    server_id: None,
                    reason: "wrong password".to_owned(),
                    reject_type: Some(3),
                })
            ),
            (
                "connection-rejected",
                json!({ "serverId": null, "reason": "wrong password", "reject_type": 3 })
            )
        );
    }

    #[test]
    fn persistent_chat_history_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(
                None,
                CoreEvent::PchatHistoryLoading(PchatHistoryLoadingPayload {
                    channel_id: 3,
                    loading: true,
                })
            ),
            (
                "pchat-history-loading",
                json!({ "channel_id": 3, "loading": true })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatFetchComplete(PchatFetchCompletePayload {
                    channel_id: 3,
                    has_more: true,
                    total_stored: 40,
                })
            ),
            (
                "pchat-fetch-complete",
                json!({ "channel_id": 3, "has_more": true, "total_stored": 40 })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatSendRejected(PchatSendRejectedPayload {
                    message_ids: vec!["m1".to_owned()],
                    reason: None,
                })
            ),
            (
                "pchat-send-rejected",
                json!({ "message_ids": ["m1"], "reason": null })
            )
        );
    }

    #[test]
    fn persistent_chat_key_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::types::{KeyHolderEntry, PendingKeyShare};

        assert_eq!(
            wire(
                None,
                CoreEvent::PchatKeyHoldersChanged(KeyHoldersChangedPayload {
                    channel_id: 3,
                    holders: vec![KeyHolderEntry {
                        cert_hash: "abc".to_owned(),
                        name: "Ada".to_owned(),
                        is_online: true,
                    }],
                })
            ),
            (
                "pchat-key-holders-changed",
                json!({
                    "channel_id": 3,
                    "holders": [{ "cert_hash": "abc", "name": "Ada", "is_online": true }],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatKeyShareRequested(KeyShareRequestPayload {
                    channel_id: 3,
                    peer_name: "Ada".to_owned(),
                    peer_cert_hash: "abc".to_owned(),
                })
            ),
            (
                "pchat-key-share-request",
                json!({ "channel_id": 3, "peer_name": "Ada", "peer_cert_hash": "abc" })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatKeyShareRequestsChanged(KeyShareRequestsChangedPayload {
                    channel_id: 3,
                    pending: vec![
                        PendingKeyShare {
                            channel_id: 3,
                            peer_cert_hash: "abc".to_owned(),
                            peer_name: "Ada".to_owned(),
                            request_id: None,
                        },
                        PendingKeyShare {
                            channel_id: 3,
                            peer_cert_hash: "def".to_owned(),
                            peer_name: "Bob".to_owned(),
                            request_id: Some("r1".to_owned()),
                        },
                    ],
                })
            ),
            (
                "pchat-key-share-requests-changed",
                json!({
                    "channel_id": 3,
                    "pending": [
                        { "channel_id": 3, "peer_cert_hash": "abc", "peer_name": "Ada" },
                        {
                            "channel_id": 3,
                            "peer_cert_hash": "def",
                            "peer_name": "Bob",
                            "request_id": "r1",
                        },
                    ],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatKeyRevoked(PchatKeyRevokedPayload { channel_id: 3 })
            ),
            ("pchat-key-revoked", json!({ "channel_id": 3 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatKeyRestored(PchatKeyRevokedPayload { channel_id: 3 })
            ),
            ("pchat-key-restored", json!({ "channel_id": 3 }))
        );
    }

    #[test]
    fn persistent_chat_reaction_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::types::StoredReactionPayload;

        assert_eq!(
            wire(
                None,
                CoreEvent::PchatReactionDelivered(ReactionDeliverPayload {
                    channel_id: 3,
                    message_id: "m1".to_owned(),
                    emoji: "+1".to_owned(),
                    action: "add".to_owned(),
                    sender_hash: "abc".to_owned(),
                    sender_name: "Ada".to_owned(),
                    timestamp: 17,
                })
            ),
            (
                "pchat-reaction-deliver",
                json!({
                    "channel_id": 3,
                    "message_id": "m1",
                    "emoji": "+1",
                    "action": "add",
                    "sender_hash": "abc",
                    "sender_name": "Ada",
                    "timestamp": 17,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatReactionsFetched(ReactionFetchResponsePayload {
                    channel_id: 3,
                    reactions: vec![StoredReactionPayload {
                        message_id: "m1".to_owned(),
                        emoji: "+1".to_owned(),
                        sender_hash: "abc".to_owned(),
                        sender_name: "Ada".to_owned(),
                        timestamp: 17,
                    }],
                })
            ),
            (
                "pchat-reaction-fetch-response",
                json!({
                    "channel_id": 3,
                    "reactions": [{
                        "message_id": "m1",
                        "emoji": "+1",
                        "sender_hash": "abc",
                        "sender_name": "Ada",
                        "timestamp": 17,
                    }],
                })
            )
        );
    }

    #[test]
    fn persistent_chat_pin_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::types::StoredPinPayload;

        assert_eq!(
            wire(
                None,
                CoreEvent::PchatPinDelivered(PinDeliverPayload {
                    channel_id: 3,
                    message_id: "m1".to_owned(),
                    pinned: true,
                    pinner_hash: "abc".to_owned(),
                    pinner_name: "Ada".to_owned(),
                    timestamp: 17,
                })
            ),
            (
                "pchat-pin-deliver",
                json!({
                    "channel_id": 3,
                    "message_id": "m1",
                    "pinned": true,
                    "pinner_hash": "abc",
                    "pinner_name": "Ada",
                    "timestamp": 17,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatPinsFetched(PinFetchResponsePayload {
                    channel_id: 3,
                    pins: vec![StoredPinPayload {
                        message_id: "m1".to_owned(),
                        pinner_hash: "abc".to_owned(),
                        pinner_name: "Ada".to_owned(),
                        timestamp: 17,
                    }],
                })
            ),
            (
                "pchat-pin-fetch-response",
                json!({
                    "channel_id": 3,
                    "pins": [{
                        "message_id": "m1",
                        "pinner_hash": "abc",
                        "pinner_name": "Ada",
                        "timestamp": 17,
                    }],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PchatSignalBridgeError(SignalBridgeErrorPayload {
                    message: "no library".to_owned(),
                })
            ),
            (
                "pchat-signal-bridge-error",
                json!({ "message": "no library" })
            )
        );
    }

    #[test]
    fn file_events_keep_their_wire_format() {
        use serde_json::json;

        let shared = || SharedFile {
            key: "k1".to_owned(),
            channel_id: 3,
            owner: 9,
            filename: "a.png".to_owned(),
            size: 512,
            shared_at_ms: 17,
            public: false,
        };
        let shared_json = json!({
            "key": "k1",
            "channelId": 3,
            "owner": 9,
            "filename": "a.png",
            "size": 512,
            "sharedAtMs": 17,
            "public": false,
        });
        assert_eq!(
            wire(None, CoreEvent::FileShared(shared())),
            ("starling-file-shared", shared_json.clone())
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::FileListing(ChannelFiles {
                    channel_id: 3,
                    files: vec![shared()],
                })
            ),
            (
                "starling-file-listing",
                json!({ "channelId": 3, "files": [shared_json] })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::FileRequestRefused(RefusedRequest {
                    request_id: "r1".to_owned(),
                    reason: "no".to_owned(),
                })
            ),
            (
                "starling-file-refused",
                json!({ "requestId": "r1", "reason": "no" })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::VoiceSupport(VoiceSupportPayload {
                    request_id: "r1".to_owned(),
                    available: true,
                    max_seconds: 60,
                    max_bytes: 1024,
                })
            ),
            (
                "voice-support",
                json!({
                    "requestId": "r1",
                    "available": true,
                    "maxSeconds": 60,
                    "maxBytes": 1024,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UploadProgress(UploadProgressPayload {
                    upload_id: "u1".to_owned(),
                    bytes_sent: 5,
                    total_bytes: 10,
                })
            ),
            (
                "upload-progress",
                json!({ "uploadId": "u1", "bytesSent": 5, "totalBytes": 10 })
            )
        );
    }

    #[test]
    fn managed_file_and_emote_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::handler::files::{ManagedFile, StorageStats};

        assert_eq!(
            wire(
                None,
                CoreEvent::FilesManaged(ManagedFiles {
                    request_id: "r1".to_owned(),
                    files: vec![ManagedFile {
                        key: "k1".to_owned(),
                        channel_id: 3,
                        filename: "a.png".to_owned(),
                        mime_type: "image/png".to_owned(),
                        size: 512,
                        mode: "public",
                        shared_at_ms: 17,
                        expires_at: None,
                        downloaded_at_ms: Some(18),
                        share_url: "https://x/k1".to_owned(),
                        uploader_account: None,
                        uploader_name: Some("Ada".to_owned()),
                        uploader_cert: None,
                        uploader_online: true,
                    }],
                    storage: Some(StorageStats {
                        used_bytes: 1,
                        max_total_bytes: 2,
                        max_upload_bytes: 3,
                        file_count: 4,
                    }),
                })
            ),
            (
                "starling-files-managed",
                json!({
                    "requestId": "r1",
                    "files": [{
                        "key": "k1",
                        "channelId": 3,
                        "filename": "a.png",
                        "mimeType": "image/png",
                        "size": 512,
                        "mode": "public",
                        "sharedAtMs": 17,
                        "expiresAt": null,
                        "downloadedAtMs": 18,
                        "shareUrl": "https://x/k1",
                        "uploaderAccount": null,
                        "uploaderName": "Ada",
                        "uploaderCert": null,
                        "uploaderOnline": true,
                    }],
                    "storage": {
                        "usedBytes": 1,
                        "maxTotalBytes": 2,
                        "maxUploadBytes": 3,
                        "fileCount": 4,
                    },
                })
            )
        );
        // An array, so it is never stamped with a session.
        assert_eq!(
            wire(
                Some(ServerId::new()),
                CoreEvent::ServerEmotesChanged(vec![CanonEmote {
                    shortcode: "wave".to_owned(),
                    url: "https://x/wave".to_owned(),
                    alias_emoji: "w".to_owned(),
                    description: "hi".to_owned(),
                }])
            ),
            (
                "server-emotes-changed",
                json!([{
                    "shortcode": "wave",
                    "url": "https://x/wave",
                    "aliasEmoji": "w",
                    "description": "hi",
                }])
            )
        );
    }

    #[test]
    fn audit_events_keep_their_wire_format() {
        use serde_json::json;

        let entry = || AuditEntryPayload {
            id: 4,
            ts: 17,
            source: "core".to_owned(),
            category: "ban".to_owned(),
            severity: "info".to_owned(),
            actor_user_id: Some(1),
            ..AuditEntryPayload::default()
        };
        let entry_json = json!({
            "id": 4,
            "ts": 17,
            "source": "core",
            "category": "ban",
            "severity": "info",
            "actorUserId": 1,
        });
        assert_eq!(
            wire(None, CoreEvent::AuditEvent(entry())),
            ("audit-event", json!({ "entry": entry_json.clone() }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::AuditResponse(AuditResponsePayload {
                    query_id: Some("q1".to_owned()),
                    entries: vec![entry()],
                    has_more: true,
                    next_before_id: Some(3),
                    error: None,
                    chain_ok: Some(true),
                    chain_height: Some(9),
                    chain_error: None,
                })
            ),
            (
                "audit-response",
                json!({
                    "queryId": "q1",
                    "entries": [entry_json],
                    "hasMore": true,
                    "nextBeforeId": 3,
                    "error": null,
                    "chainOk": true,
                    "chainHeight": 9,
                    "chainError": null,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::AuditConfig(AuditConfigSnapshot {
                    revision: 2,
                    advanced_sql_available: true,
                    chain_height: 9,
                    ..AuditConfigSnapshot::default()
                })
            ),
            (
                "audit-config",
                json!({
                    "config": {
                        "settings": [],
                        "revision": 2,
                        "advancedSqlAvailable": true,
                        "chainHeight": 9,
                    },
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::AuditSnapshot(AuditSnapshotPayload {
                    entry_id: "e1".to_owned(),
                    query_id: "q1".to_owned(),
                    found: true,
                    kind: "comment".to_owned(),
                    data_url: None,
                    text: Some("hi".to_owned()),
                    original_size: 2,
                    stored_size: 2,
                })
            ),
            (
                "audit-snapshot",
                json!({
                    "entryId": "e1",
                    "queryId": "q1",
                    "found": true,
                    "kind": "comment",
                    "text": "hi",
                    "originalSize": 2,
                    "storedSize": 2,
                })
            )
        );
    }

    #[test]
    fn admin_events_keep_their_wire_format() {
        use serde_json::json;

        // Arrays, so a session is never stamped onto them.
        let server = Some(ServerId::new());
        assert_eq!(
            wire(
                server,
                CoreEvent::BanList(vec![BanEntryPayload {
                    address: "10.0.0.1".to_owned(),
                    mask: 32,
                    name: "Ada".to_owned(),
                    hash: "abc".to_owned(),
                    reason: "spam".to_owned(),
                    start: "2026-01-01".to_owned(),
                    duration: 60,
                }])
            ),
            (
                "ban-list",
                json!([{
                    "address": "10.0.0.1",
                    "mask": 32,
                    "name": "Ada",
                    "hash": "abc",
                    "reason": "spam",
                    "start": "2026-01-01",
                    "duration": 60,
                }])
            )
        );
        assert_eq!(
            wire(
                server,
                CoreEvent::RegisteredUsers(vec![RegisteredUserPayload {
                    user_id: 1,
                    name: "Ada".to_owned(),
                    last_seen: None,
                    last_channel: Some(3),
                    texture_size: Some(512),
                    comment: None,
                    comment_hash: None,
                }])
            ),
            (
                "user-list",
                json!([{ "user_id": 1, "name": "Ada", "last_channel": 3, "texture_size": 512 }])
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UserComment(UserCommentPayload {
                    user_id: 1,
                    comment: "hi".to_owned(),
                })
            ),
            ("user-comment", json!({ "user_id": 1, "comment": "hi" }))
        );
    }

    #[test]
    fn access_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::types::{AclEntryPayload, AclGroupPayload};

        assert_eq!(
            wire(
                None,
                CoreEvent::Acl(AclPayload {
                    channel_id: 3,
                    inherit_acls: true,
                    groups: vec![AclGroupPayload {
                        name: "admin".to_owned(),
                        inherited: false,
                        inherit: true,
                        inheritable: true,
                        add: vec![1],
                        remove: Vec::new(),
                        inherited_members: Vec::new(),
                        color: None,
                        icon: None,
                        style_preset: None,
                        metadata: HashMap::new(),
                    }],
                    acls: vec![AclEntryPayload {
                        apply_here: true,
                        apply_subs: false,
                        inherited: false,
                        user_id: None,
                        group: Some("admin".to_owned()),
                        grant: 1,
                        deny: 0,
                    }],
                })
            ),
            (
                "acl",
                json!({
                    "channel_id": 3,
                    "inherit_acls": true,
                    "groups": [{
                        "name": "admin",
                        "inherited": false,
                        "inherit": true,
                        "inheritable": true,
                        "add": [1],
                        "remove": [],
                        "inherited_members": [],
                    }],
                    "acls": [{
                        "apply_here": true,
                        "apply_subs": false,
                        "inherited": false,
                        "group": "admin",
                        "grant": 1,
                        "deny": 0,
                    }],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::OperatorTicket(OperatorTicket {
                    token: "t".to_owned(),
                    granted_scopes: vec!["plugins:read".to_owned()],
                    expires_at_ms: 17,
                    base_url: "https://x".to_owned(),
                    denied_reason: String::new(),
                })
            ),
            (
                "operator-ticket",
                json!({
                    "ticket": {
                        "token": "t",
                        "grantedScopes": ["plugins:read"],
                        "expiresAtMs": 17,
                        "baseUrl": "https://x",
                    },
                })
            )
        );
    }

    #[test]
    fn plugin_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(
                None,
                CoreEvent::PluginMessage(PluginMessagePayload {
                    plugin_name: "polls".to_owned(),
                    plugin_slot: Some(2),
                    payload_type: "vote".to_owned(),
                    payload: b"hi".to_vec(),
                    target_sessions: vec![9],
                    channel_id: None,
                    sender_session: Some(9),
                    sender_name: None,
                })
            ),
            (
                "plugin-message",
                json!({
                    "pluginName": "polls",
                    "pluginSlot": 2,
                    "payloadType": "vote",
                    "payload": "aGk=",
                    "targetSessions": [9],
                    "channelId": null,
                    "senderSession": 9,
                    "senderName": null,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PluginData(PluginDataPayload {
                    sender_session: Some(9),
                    data: b"hi".to_vec(),
                    data_id: "fancy-plugin-info".to_owned(),
                })
            ),
            (
                "plugin-data",
                json!({ "sender_session": 9, "data": "aGk=", "data_id": "fancy-plugin-info" })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PluginRegistry(vec![PluginRegistryEntryPayload {
                    plugin_name: "polls".to_owned(),
                    version: "1.0".to_owned(),
                    plugin_slot: Some(2),
                    info_json: None,
                }])
            ),
            (
                "plugin-registry",
                json!({
                    "plugins": [{
                        "pluginName": "polls",
                        "version": "1.0",
                        "pluginSlot": 2,
                        "infoJson": null,
                    }],
                })
            )
        );
    }

    #[test]
    fn plugin_admin_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::handler::plugin_admin::PluginAdminEntryPayload;

        assert_eq!(
            wire(
                None,
                CoreEvent::PluginAdminList(PluginAdminListPayload {
                    plugins: vec![PluginAdminEntryPayload {
                        plugin_name: "polls".to_owned(),
                        version: "1.0".to_owned(),
                        enabled: true,
                        loaded: false,
                        path: None,
                        info_json: None,
                        marketplace_id: Some("m1".to_owned()),
                        installed_at: Some(17),
                        builtin: false,
                        load_error: Some("abi".to_owned()),
                    }],
                    plugins_dir: Some("/plugins".to_owned()),
                    host_abi_version: Some(3),
                })
            ),
            (
                "plugin-admin-list",
                json!({
                    "plugins": [{
                        "plugin_name": "polls",
                        "version": "1.0",
                        "enabled": true,
                        "loaded": false,
                        "path": null,
                        "info_json": null,
                        "marketplace_id": "m1",
                        "installed_at": 17,
                        "builtin": false,
                        "load_error": "abi",
                    }],
                    "plugins_dir": "/plugins",
                    "host_abi_version": 3,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PluginAdminAck(PluginAdminAckPayload {
                    plugin_name: Some("polls".to_owned()),
                    ok: false,
                    error: Some("no".to_owned()),
                    request_id: None,
                    verb: Some("install"),
                })
            ),
            (
                "plugin-admin-ack",
                json!({
                    "plugin_name": "polls",
                    "ok": false,
                    "error": "no",
                    "request_id": null,
                    "verb": "install",
                })
            )
        );
    }

    #[test]
    fn server_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(None, CoreEvent::ServerConfigChanged),
            ("server-config", json!(null))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ServerVersion(ServerVersionPayload {
                    fancy_version: Some(7),
                    fancy_protocol: None,
                })
            ),
            (
                "server-version",
                json!({ "fancy_version": 7, "fancy_protocol": null })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ServerLog(ServerLogEntry {
                    timestamp_ms: 17,
                    message: "Ada connected".to_owned(),
                })
            ),
            (
                "server-log",
                json!({ "timestamp_ms": 17, "message": "Ada connected" })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PingLatency(LatencyPayload { rtt_ms: 12.0 })
            ),
            ("ping-latency", json!({ "rtt_ms": 12.0 }))
        );
        assert_eq!(
            wire(
                Some(ServerId::new()),
                CoreEvent::CustomReactionsConfig(vec![CustomReactionPayload {
                    shortcode: "wave".to_owned(),
                    display: "w".to_owned(),
                    label: None,
                }])
            ),
            (
                "custom-reactions-config",
                json!([{ "shortcode": "wave", "display": "w" }])
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::AudioTransportChanged(AudioTransportPayload {
                    udp_active: true,
                    cipher: Some("aes"),
                })
            ),
            (
                "audio-transport-changed",
                json!({ "udp_active": true, "cipher": "aes" })
            )
        );
        let stats = || crate::state::types::PacketStats {
            good: 1,
            late: 2,
            lost: 3,
            resync: 4,
        };
        let stats_json = json!({ "good": 1, "late": 2, "lost": 3, "resync": 4 });
        assert_eq!(
            wire(
                None,
                CoreEvent::CryptoStats(CryptoStatsPayload {
                    from_client: stats(),
                    to_client: stats(),
                })
            ),
            (
                "crypto-stats",
                json!({ "from_client": stats_json.clone(), "to_client": stats_json })
            )
        );
    }

    #[test]
    fn bulky_server_events_carry_their_payload_unchanged() {
        assert_carries(
            "user-stats",
            &UserStatsPayload {
                session: 9,
                tcp_packets: 4,
                opus: Some(true),
                ..UserStatsPayload::default()
            },
            CoreEvent::UserStats,
        );
        assert_carries_keyed(
            "server-settings",
            "settings",
            &ServerSettingsSnapshot {
                settings: vec![crate::state::types::ServerSetting {
                    key: "motd".to_owned(),
                    ..Default::default()
                }],
                revision: 3,
            },
            CoreEvent::ServerSettings,
        );
        assert_carries_keyed(
            "server-livery",
            "livery",
            &LiverySnapshot {
                version: 2,
                digest: "ab".to_owned(),
                display_name: Some("Home".to_owned()),
                ..LiverySnapshot::default()
            },
            CoreEvent::ServerLivery,
        );
    }

    #[test]
    fn permission_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::types::CustodianPinPayloadInner;

        assert_eq!(
            wire(
                None,
                CoreEvent::PermissionDenied(PermissionDeniedPayload {
                    deny_type: Some(1),
                    reason: None,
                })
            ),
            (
                "permission-denied",
                json!({ "deny_type": 1, "reason": null })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ChannelDenied(ChannelDeniedPayload { channel_id: 3 })
            ),
            ("channel-denied", json!({ "channel_id": 3 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ListenDenied(ListenDeniedPayload { channel_id: 3 })
            ),
            ("listen-denied", json!({ "channel_id": 3 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::CustodianPinChanged(CustodianPinPayload {
                    channel_id: 3,
                    pin: CustodianPinPayloadInner {
                        pinned: vec!["abc".to_owned()],
                        confirmed: true,
                        pending_update: None,
                    },
                })
            ),
            (
                "custodian-pin-changed",
                json!({
                    "channel_id": 3,
                    "pin": { "pinned": ["abc"], "confirmed": true, "pendingUpdate": null },
                })
            )
        );
    }

    #[test]
    fn messaging_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::handler::read_receipt::ReadStatePayload;

        assert_eq!(
            wire(
                None,
                CoreEvent::TypingIndicator(TypingIndicatorPayload {
                    session: 9,
                    channel_id: 3,
                })
            ),
            ("typing-indicator", json!({ "session": 9, "channel_id": 3 }))
        );
        assert_eq!(
            wire(None, CoreEvent::DmEdited(NewDmPayload { session: 9 })),
            ("dm-edited", json!({ "session": 9 }))
        );
        assert_eq!(
            wire(None, CoreEvent::DmSynced(NewDmPayload { session: 9 })),
            ("dm-synced", json!({ "session": 9 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ReadReceipts(ReadReceiptDeliverPayload {
                    channel_id: 3,
                    read_states: vec![ReadStatePayload {
                        cert_hash: "abc".to_owned(),
                        name: "Ada".to_owned(),
                        is_online: true,
                        last_read_message_id: "m1".to_owned(),
                        timestamp: 17,
                    }],
                    query_message_id: None,
                })
            ),
            (
                "read-receipt-deliver",
                json!({
                    "channel_id": 3,
                    "read_states": [{
                        "cert_hash": "abc",
                        "name": "Ada",
                        "is_online": true,
                        "last_read_message_id": "m1",
                        "timestamp": 17,
                    }],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::LinkPreviews(LinkPreviewResponsePayload {
                    request_id: "r1".to_owned(),
                    embeds: Vec::new(),
                    requested_urls: vec!["https://x".to_owned()],
                })
            ),
            (
                "link-preview-response",
                json!({ "request_id": "r1", "embeds": [], "requested_urls": ["https://x"] })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::WebRtcSignal(WebRtcSignalPayload {
                    sender_session: Some(9),
                    target_session: None,
                    signal_type: 2,
                    payload: "sdp".to_owned(),
                })
            ),
            (
                "webrtc-signal",
                json!({
                    "sender_session": 9,
                    "target_session": null,
                    "signal_type": 2,
                    "payload": "sdp",
                })
            )
        );
    }

    #[test]
    fn shared_surface_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::handler::watch_sync::WatchSyncEvent;

        assert_eq!(
            wire(
                None,
                CoreEvent::DrawStroke(DrawStrokePayload {
                    sender_session: 9,
                    channel_id: 3,
                    stroke_id: "s1".to_owned(),
                    color: 255,
                    width: 2.0,
                    width_frac: None,
                    points: vec![0.5, 1.0],
                    is_end: true,
                    is_clear: false,
                    clear_all: false,
                })
            ),
            (
                "draw-stroke",
                json!({
                    "senderSession": 9,
                    "channelId": 3,
                    "strokeId": "s1",
                    "color": 255,
                    "width": 2.0,
                    "widthFrac": null,
                    "points": [0.5, 1.0],
                    "isEnd": true,
                    "isClear": false,
                    "clearAll": false,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::WatchSync(WatchSyncPayload {
                    session_id: Some("w1".to_owned()),
                    actor: Some(9),
                    event: WatchSyncEvent::Join { session: Some(9) },
                })
            ),
            (
                "watch-sync",
                json!({
                    "sessionId": "w1",
                    "actor": 9,
                    "event": { "type": "join", "session": 9 },
                })
            )
        );
    }

    #[test]
    fn poll_and_forum_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(
                None,
                CoreEvent::Poll(PollPayload {
                    channel_id: 3,
                    poll_id: "p1".to_owned(),
                    question: "Lunch?".to_owned(),
                    options: vec!["yes".to_owned()],
                    multiple: false,
                    creator_session: 9,
                    creator_name: None,
                    created_at: None,
                })
            ),
            (
                "fancy-poll",
                json!({
                    "channelId": 3,
                    "pollId": "p1",
                    "question": "Lunch?",
                    "options": ["yes"],
                    "multiple": false,
                    "creatorSession": 9,
                    "creatorName": null,
                    "createdAt": null,
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::PollVote(PollVotePayload {
                    channel_id: 3,
                    poll_id: "p1".to_owned(),
                    selected: vec![0],
                    voter_session: 9,
                    voter_name: Some("Ada".to_owned()),
                })
            ),
            (
                "fancy-poll-vote",
                json!({
                    "channelId": 3,
                    "pollId": "p1",
                    "selected": [0],
                    "voterSession": 9,
                    "voterName": "Ada",
                })
            )
        );
        let post = ForumPostPayload {
            channel_id: 3,
            post_id: "f1".to_owned(),
            thread_id: "t1".to_owned(),
            title: Some("Hello".to_owned()),
            body: None,
            author_hash: None,
            author_session: Some(9),
            author_name: None,
            created_at: Some(17),
            edited_at: None,
            deleted: false,
            reply_count: 2,
        };
        let post_json = json!({
            "channelId": 3,
            "postId": "f1",
            "threadId": "t1",
            "title": "Hello",
            "body": null,
            "authorHash": null,
            "authorSession": 9,
            "authorName": null,
            "createdAt": 17,
            "editedAt": null,
            "deleted": false,
            "replyCount": 2,
        });
        assert_eq!(
            wire(None, CoreEvent::ForumPost(post.clone())),
            ("fancy-forum-post", post_json.clone())
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ForumPosts(ForumFetchResponsePayload {
                    channel_id: 3,
                    thread_id: None,
                    posts: vec![post],
                    has_more: true,
                })
            ),
            (
                "fancy-forum-fetch-response",
                json!({ "channelId": 3, "threadId": null, "posts": [post_json], "hasMore": true })
            )
        );
    }

    #[test]
    fn scheduled_message_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(
                None,
                CoreEvent::ScheduledMessages(vec![ScheduledMessagePayload {
                    schedule_id: "s1".to_owned(),
                    channel_ids: vec![3],
                    tree_ids: Vec::new(),
                    message: Some("hi".to_owned()),
                    deliver_at: Some(17),
                    creator_session: None,
                    creator_hash: None,
                    creator_name: None,
                    created_at: None,
                    status: 0,
                }])
            ),
            (
                "fancy-scheduled-message-list",
                json!({
                    "messages": [{
                        "scheduleId": "s1",
                        "channelIds": [3],
                        "treeIds": [],
                        "message": "hi",
                        "deliverAt": 17,
                        "creatorSession": null,
                        "creatorHash": null,
                        "creatorName": null,
                        "createdAt": null,
                        "status": 0,
                    }],
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ScheduledMessageAck(ScheduledMessageAckPayload {
                    schedule_id: Some("s1".to_owned()),
                    status: 1,
                    reason: None,
                })
            ),
            (
                "fancy-scheduled-message-ack",
                json!({ "scheduleId": "s1", "status": 1, "reason": null })
            )
        );
    }

    #[test]
    fn gif_events_keep_their_wire_format() {
        use serde_json::json;

        use crate::state::handler::gifs::GifResult;

        assert_eq!(
            wire(
                None,
                CoreEvent::GifPage(GifPagePayload {
                    request_id: "r1".to_owned(),
                    results: vec![GifResult {
                        id: "g1".to_owned(),
                        title: "wave".to_owned(),
                        url: "https://x/g1".to_owned(),
                        preview: "https://x/g1s".to_owned(),
                        width: 4,
                        height: 3,
                        preview_width: 2,
                        preview_height: 1,
                        mime: "image/gif".to_owned(),
                    }],
                    page: 1,
                    has_next: false,
                    provider: "klipy".to_owned(),
                })
            ),
            (
                "gif-search-page",
                json!({
                    "request_id": "r1",
                    "results": [{
                        "id": "g1",
                        "title": "wave",
                        "url": "https://x/g1",
                        "preview": "https://x/g1s",
                        "width": 4,
                        "height": 3,
                        "preview_width": 2,
                        "preview_height": 1,
                        "mime": "image/gif",
                    }],
                    "page": 1,
                    "has_next": false,
                    "provider": "klipy",
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::GifSearchRefused(GifRefusedPayload {
                    request_id: "r1".to_owned(),
                    reason: "slow down".to_owned(),
                    retry_after_ms: 500,
                    kind: "rateLimited",
                })
            ),
            (
                "gif-search-refused",
                json!({
                    "request_id": "r1",
                    "reason": "slow down",
                    "retry_after_ms": 500,
                    "kind": "rateLimited",
                })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::GifSupport(GifSupportPayload {
                    request_id: "r1".to_owned(),
                    available: true,
                    media_base: "https://x".to_owned(),
                    provider: "klipy".to_owned(),
                })
            ),
            (
                "gif-support",
                json!({
                    "request_id": "r1",
                    "available": true,
                    "media_base": "https://x",
                    "provider": "klipy",
                })
            )
        );
    }

    #[test]
    fn an_object_payload_is_stamped_with_its_session() {
        let server = ServerId::new();
        let (_, payload) = wire(
            Some(server),
            CoreEvent::NewMessage(NewMessagePayload {
                channel_id: 3,
                sender_session: None,
            }),
        );
        assert_eq!(payload["serverId"], serde_json::json!(server.to_string()));
        assert_eq!(payload["channel_id"], 3);

        // A payload that already names its server keeps what it says.
        let (_, payload) = wire(
            Some(server),
            CoreEvent::Disconnected(DisconnectedPayload {
                server_id: Some("other".to_owned()),
                reason: None,
            }),
        );
        assert_eq!(payload["serverId"], "other");
    }

    #[test]
    fn a_payload_that_is_not_an_object_is_left_alone() {
        let server = ServerId::new();
        assert_eq!(
            wire(Some(server), CoreEvent::StateChanged).1,
            serde_json::json!(null)
        );
        assert_eq!(
            wire(
                Some(server),
                CoreEvent::UserTalking {
                    session: 1,
                    talking: false
                }
            )
            .1,
            serde_json::json!([1, false])
        );
    }

    #[test]
    fn an_untyped_event_passes_through_unchanged() {
        let event =
            CoreEvent::untyped("server-log", serde_json::json!({ "message": "hi" })).unwrap();
        let (name, payload) = wire(Some(ServerId::new()), event);
        assert_eq!(name, "server-log");
        assert_eq!(payload, serde_json::json!({ "message": "hi" }));
    }

    #[test]
    fn stamps_missing_server_id() {
        let mut payload = serde_json::json!({ "channelId": 1 });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "srv-1");
    }

    #[test]
    fn replaces_a_null_server_id_but_keeps_a_real_one() {
        let mut payload = serde_json::json!({ "serverId": null });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "srv-1");

        let mut payload = serde_json::json!({ "serverId": "kept" });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "kept");
    }

    #[test]
    fn leaves_non_objects_untouched() {
        let mut payload = serde_json::json!(["a", "b"]);
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload, serde_json::json!(["a", "b"]));
    }
}
