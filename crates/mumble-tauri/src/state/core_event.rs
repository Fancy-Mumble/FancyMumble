//! What the engine tells its view.
//!
//! Every event crosses the engine/host seam as an [`Event`]: a [`CoreEvent`]
//! plus the session it is about. A native view matches on the enum and takes
//! the payload as the Rust value it is. A view that speaks JSON (the webview)
//! calls [`Event::into_wire`], which writes the event out under the name and
//! in the shape its frontend has always listened for.

use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

use super::audio::CaptureState;
use super::canon_emotes::CanonEmote;
use super::handler::audit::{AuditResponsePayload, AuditSnapshotPayload};
use super::handler::custom_reactions_config::CustomReactionPayload;
use super::handler::draw_stroke::DrawStrokePayload;
use super::handler::files::{
    ChannelFiles, ManagedFiles, RefusedRequest, SharedFile, VoiceSupportPayload,
};
use super::handler::forum::{ForumFetchResponsePayload, ForumPostPayload};
use super::handler::gifs::{GifPagePayload, GifRefusedPayload, GifSupportPayload};
use super::handler::invites::InvitesPayload;
use super::handler::link_preview::LinkPreviewResponsePayload;
use super::handler::livery::LiverySnapshot;
use super::handler::operator_ticket::OperatorTicket;
use super::handler::plugin_admin::{PluginAdminAckPayload, PluginAdminListPayload};
use super::handler::plugin_message::PluginMessagePayload;
use super::handler::poll::{PollPayload, PollVotePayload};
use super::handler::read_receipt::ReadReceiptDeliverPayload;
use super::handler::records::RecordChanged;
use super::handler::scheduled_message::{ScheduledMessageAckPayload, ScheduledMessagePayload};
use super::handler::typing_indicator::TypingIndicatorPayload;
use super::handler::version::ServerVersionPayload;
use super::handler::watch_sync::WatchSyncPayload;
#[cfg(not(target_os = "android"))]
use super::presence::PresenceSnapshot;
use super::sessions::ServerId;
use super::types::{
    AccountAck, AccountSettings, AclPayload, AudioTransportPayload, AuditConfigSnapshot,
    AuditEntryPayload, BanEntryPayload, ChannelDeniedPayload, CryptoStatsPayload,
    CurrentChannelPayload, CustodianPinPayload, DisconnectedPayload, DmUnreadPayload,
    KeyHoldersChangedPayload, KeyShareRequestPayload, KeyShareRequestsChangedPayload,
    LatencyPayload, ListenDeniedPayload, MicAmplitudePayload, NewDmPayload, NewMessagePayload,
    OnboardingConfig, OnboardingResponse, PchatFetchCompletePayload, PchatHistoryLoadingPayload,
    PchatKeyRevokedPayload, PchatSendRejectedPayload, PermissionDeniedPayload, PinDeliverPayload,
    PinFetchResponsePayload, PluginDataPayload, PluginRegistryEntryPayload, ReactionDeliverPayload,
    ReactionFetchResponsePayload, RegisteredUserPayload, RejectedPayload, ServerLogEntry,
    ServerSettingsSnapshot, SignalBridgeErrorPayload, UnreadPayload, UploadProgressPayload,
    UserCommentPayload, UserStatsPayload, VoiceActivationCalibrationPayload, VoiceReplayState,
    VoiceState, WebRtcSignalPayload,
};
use super::voice_message::RecorderState;
use super::whisper::WhisperDenials;

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
    /// The server's answer to a change to the user's account.
    AccountAck(AccountAck),
    /// Another of the account's devices wrote a synced record.
    AccountRecordChanged(RecordChanged),
    /// An answer from the invites service; which one is in its `kind`.
    Invites(InvitesPayload),
    /// The user's account on this server, as the server now has it.
    AccountSettings(AccountSettings),
    /// The server's onboarding questions.
    OnboardingConfig(OnboardingConfig),
    /// The user's own onboarding answers, or `None` if they gave none.
    OnboardingResponse(Option<OnboardingResponse>),
    /// How loud the microphone is, while a view is testing it.
    MicAmplitude(MicAmplitudePayload),
    /// Voice activation settled on new thresholds for this microphone.
    VoiceActivationCalibrated(VoiceActivationCalibrationPayload),
    /// The "hear yourself" replay started recording, started playing or stopped.
    VoiceReplayState(VoiceReplayState),
    /// The channels the server will not let the user whisper to.
    WhisperDenials(WhisperDenials),
    /// How a voice message recording is going.
    VoiceMessageState(RecorderState),
    /// Which voice target a talking user is speaking to (a whisper, a shout).
    UserVoiceContext {
        /// The session that is talking.
        session: u32,
        /// The voice target of its current utterance.
        context: u8,
    },
    /// The microphone could not be opened; `None` once it opens again.
    CaptureError(Option<CaptureState>),
    /// The whisper key went down or came up.
    WhisperState(bool),
    /// What the user is playing, as Discord-style rich presence reports it.
    #[cfg(not(target_os = "android"))]
    RichPresenceChanged(PresenceSnapshot),
}

impl CoreEvent {
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
            Self::AccountAck(_) => "account-ack",
            Self::AccountRecordChanged(_) => "account-record-changed",
            Self::Invites(_) => "invites",
            Self::AccountSettings(_) => "account-settings",
            Self::OnboardingConfig(_) => "onboarding-config",
            Self::OnboardingResponse(_) => "onboarding-response",
            Self::MicAmplitude(_) => "mic-amplitude",
            Self::VoiceActivationCalibrated(_) => "voice-activation-calibrated",
            Self::VoiceReplayState(_) => "voice-replay-state",
            Self::WhisperDenials(_) => super::whisper::WHISPER_DENIALS_EVENT,
            Self::VoiceMessageState(_) => super::voice_message::STATE_EVENT,
            Self::UserVoiceContext { .. } => super::voice_decode::VOICE_CONTEXT_EVENT,
            Self::CaptureError(_) => super::audio::CAPTURE_ERROR_EVENT,
            Self::WhisperState(_) => super::whisper::WHISPER_STATE_EVENT,
            #[cfg(not(target_os = "android"))]
            Self::RichPresenceChanged(_) => super::presence::PRESENCE_EVENT,
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
                | Self::AccountAck(_)
                | Self::AccountRecordChanged(_)
                | Self::Invites(_)
                | Self::AccountSettings(_)
                | Self::OnboardingConfig(_)
                | Self::OnboardingResponse(_)
                | Self::MicAmplitude(_)
                | Self::VoiceActivationCalibrated(_)
                | Self::VoiceReplayState(_)
                | Self::WhisperDenials(_)
                | Self::VoiceMessageState(_)
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
            Self::AccountAck(payload) => payload.serialize(serializer),
            Self::AccountRecordChanged(payload) => payload.serialize(serializer),
            Self::Invites(payload) => payload.serialize(serializer),
            Self::AccountSettings(settings) => keyed(serializer, "settings", settings),
            Self::OnboardingConfig(config) => keyed(serializer, "config", config),
            Self::OnboardingResponse(response) => keyed(serializer, "response", response),
            Self::MicAmplitude(payload) => payload.serialize(serializer),
            Self::VoiceActivationCalibrated(payload) => payload.serialize(serializer),
            Self::VoiceReplayState(payload) => payload.serialize(serializer),
            Self::WhisperDenials(payload) => payload.serialize(serializer),
            Self::VoiceMessageState(payload) => payload.serialize(serializer),
            Self::UserVoiceContext { session, context } => (session, context).serialize(serializer),
            Self::CaptureError(state) => state.serialize(serializer),
            Self::WhisperState(active) => active.serialize(serializer),
            #[cfg(not(target_os = "android"))]
            Self::RichPresenceChanged(snapshot) => snapshot.serialize(serializer),
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
        let payload = match self.server {
            // These two carry a `serverId` of their own, which wins unless it
            // is null, so the payload has to be looked at to tell.
            Some(server)
                if matches!(
                    self.kind,
                    CoreEvent::Disconnected(_) | CoreEvent::ConnectionRejected(_)
                ) =>
            {
                let mut value = serde_json::to_value(&self.kind)?;
                stamp_server_id(&mut value, server.to_string());
                serde_json::value::to_raw_value(&value)?
            }
            Some(server) if self.kind.payload_is_object() => {
                let json = serde_json::to_string(&self.kind)?;
                RawValue::from_string(with_server_id(json, server))?
            }
            _ => serde_json::value::to_raw_value(&self.kind)?,
        };
        Ok((name, payload))
    }
}

/// `json`, an object that has no `serverId` field, with one added.
///
/// Spliced into the text rather than parsed, changed and written out again:
/// most events are stamped, some are megabytes of base64, and a parsed tree
/// costs several times the payload in allocations for the sake of one field.
fn with_server_id(json: String, server: ServerId) -> String {
    let Some(fields) = json.strip_prefix('{') else {
        return json;
    };
    let separator = if fields.trim_start().starts_with('}') {
        ""
    } else {
        ","
    };
    format!("{{\"serverId\":\"{server}\"{separator}{fields}")
}

/// Insert (or replace) a `serverId` field into a JSON-object payload.
///
/// Replaces missing OR explicitly-null `serverId` fields.  Payloads
/// serialised from `Option<String>::None` produce `"serverId": null`,
/// which would otherwise prevent the frontend from routing the event
/// to the correct tab.
fn stamp_server_id(payload: &mut serde_json::Value, id: impl Into<String>) {
    let Some(obj) = payload.as_object_mut() else {
        return;
    };
    if obj.get("serverId").is_none_or(serde_json::Value::is_null) {
        let _ = obj.insert("serverId".to_owned(), serde_json::Value::String(id.into()));
    }
}

#[cfg(test)]
mod tests;
