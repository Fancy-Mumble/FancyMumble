//! Mumble message type enumerations and decoded message wrappers.
//!
//! [`TcpMessageType`] maps numeric wire IDs to their protobuf types.
//! [`ControlMessage`] and [`UdpMessage`] carry fully decoded payloads.
//! [`ServerMessage`] is the unified inbound type used by the work queue.
use crate::proto::{fancy, mumble_tcp, mumble_udp};

/// Mumble TCP message type IDs as defined by the protocol.
/// Each variant maps to a protobuf message with a fixed numeric ID
/// used for framing on the wire.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
#[repr(u16)]
pub enum TcpMessageType {
    /// Protocol version negotiation message.
    Version = 0,
    /// UDP audio tunnelled over TCP (fallback).
    UdpTunnel = 1,
    /// Client authentication handshake.
    Authenticate = 2,
    /// Keep-alive ping.
    Ping = 3,
    /// Server rejects the connection.
    Reject = 4,
    /// Server acknowledges successful authentication.
    ServerSync = 5,
    /// Server notifies clients that a channel was removed.
    ChannelRemove = 6,
    /// Channel metadata update.
    ChannelState = 7,
    /// A user disconnected from the server.
    UserRemove = 8,
    /// User state (mute, deafen, channel, etc.) changed.
    UserState = 9,
    /// Ban list from the server.
    BanList = 10,
    /// A text chat message.
    TextMessage = 11,
    /// Server denies an action.
    PermissionDenied = 12,
    /// Access-control list for a channel.
    Acl = 13,
    /// Map of registered users (session -> username).
    QueryUsers = 14,
    /// Encryption key setup for the OCB-encrypted UDP path.
    CryptSetup = 15,
    /// Adds/removes a contextual action button in the Mumble UI.
    ContextActionModify = 16,
    /// A contextual action was triggered by the user.
    ContextAction = 17,
    /// Registered user list.
    UserList = 18,
    /// Configure a voice target for whisper/shout.
    VoiceTarget = 19,
    /// Query or response for channel permissions.
    PermissionQuery = 20,
    /// Negotiated audio codec version.
    CodecVersion = 21,
    /// Detailed statistics for a connected user.
    UserStats = 22,
    /// Request the server to send a large blob (avatar, comment, etc.).
    RequestBlob = 23,
    /// Global server configuration values (max bandwidth, limits, etc.).
    ServerConfig = 24,
    /// Server hints that the client configuration is outdated.
    SuggestConfig = 25,
    /// Plugin data relay between clients (used for polls, pchat, etc.).
    PluginDataTransmission = 26,
    /// Fancy Mumble: encrypted persistent chat message.
    PchatMessage = 100,
    /// Fancy Mumble: fetch stored messages from the server.
    PchatFetch = 101,
    /// Fancy Mumble: server response to a fetch request.
    PchatFetchResponse = 102,
    /// Fancy Mumble: deliver a stored message to the client.
    PchatMessageDeliver = 103,
    /// Fancy Mumble: client announces its E2EE identity keys.
    PchatKeyAnnounce = 104,
    /// Fancy Mumble: peer-to-peer encrypted key exchange.
    PchatKeyExchange = 105,
    /// Fancy Mumble: server requests a key for a new member.
    PchatKeyRequest = 106,
    /// Fancy Mumble: server acknowledgement of a stored message.
    PchatAck = 107,
    /// Fancy Mumble: custodian countersignature for an epoch transition.
    PchatEpochCountersig = 108,
    /// Fancy Mumble: report that a peer holds the channel key.
    PchatKeyHolderReport = 109,
    /// Fancy Mumble: query the server for the list of key holders.
    PchatKeyHoldersQuery = 110,
    /// Fancy Mumble: server response with the key-holder list.
    PchatKeyHoldersList = 111,
    /// Fancy Mumble: server challenge to prove key possession.
    PchatKeyChallenge = 112,
    /// Fancy Mumble: client response to a key-possession challenge.
    PchatKeyChallengeResponse = 113,
    /// Fancy Mumble: server verdict on a key-possession challenge.
    PchatKeyChallengeResult = 114,
    /// Fancy Mumble: delete persisted messages (by ID, time range, or sender).
    PchatDeleteMessages = 115,
    /// Fancy Mumble: server drains offline message queue to a reconnected client.
    PchatOfflineQueueDrain = 116,
    /// Fancy Mumble: client sends a reaction (add/remove) on a persistent message.
    PchatReaction = 117,
    /// Fancy Mumble: server broadcasts a reaction update to channel members.
    PchatReactionDeliver = 118,
    /// Fancy Mumble: server response with reactions for requested messages.
    PchatReactionFetchResponse = 119,
    /// Fancy Mumble: WebRTC screen-sharing signaling relay.
    WebRtcSignal = 120,
    /// Fancy Mumble: Signal sender key distribution (replaces `PluginData` relay).
    PchatSenderKeyDistribution = 121,
    /// Fancy Mumble: FCM push notification registration.
    FancyPushRegister = 122,
    /// Fancy Mumble: push notification mute preferences update.
    FancyPushUpdate = 123,
    /// Fancy Mumble: server broadcasts custom reaction/emoji config.
    FancyCustomReactionsConfig = 124,
    /// Fancy Mumble: live push subscribe for connected clients.
    FancySubscribePush = 125,
    /// Fancy Mumble: client sends a read receipt watermark.
    FancyReadReceipt = 126,
    /// Fancy Mumble: server broadcasts read receipt state.
    FancyReadReceiptDeliver = 127,
    /// Fancy Mumble: client sends a pin/unpin request for a persistent message.
    PchatPin = 128,
    /// Fancy Mumble: server broadcasts a pin state change.
    PchatPinDeliver = 129,
    /// Fancy Mumble: server response with pinned messages for a channel.
    PchatPinFetchResponse = 130,
    /// Fancy Mumble: typing indicator broadcast.
    FancyTypingIndicator = 131,
    /// Fancy Mumble: client requests link previews from the server.
    FancyLinkPreviewRequest = 132,
    /// Fancy Mumble: server responds with link embed metadata.
    FancyLinkPreviewResponse = 133,
    /// Fancy Mumble: synchronised watch-together control event.
    FancyWatchSync = 134,
    /// Fancy Mumble: drawing stroke overlay for screen-share collaboration.
    FancyDrawStroke = 135,
    /// Fancy Mumble: server broadcasts the active onboarding config.
    FancyOnboardingConfig = 136,
    /// Fancy Mumble: admin submits a new onboarding config.
    FancyOnboardingConfigUpdate = 137,
    /// Fancy Mumble: user submits answers to the onboarding questionnaire.
    FancyOnboardingResponse = 138,
    /// Fancy Mumble: user queries their previously-stored onboarding response.
    FancyOnboardingResponseQuery = 139,
    /// Fancy Mumble: server delivers a previously-stored onboarding response.
    FancyOnboardingResponseDeliver = 140,
    /// Fancy Mumble: client announces a new poll (server-relayed to channel).
    FancyPoll = 144,
    /// Fancy Mumble: client casts a vote on a poll (server-relayed to channel).
    FancyPollVote = 145,
    /// Fancy Mumble: admin requests the server plugin inventory.
    FancyPluginAdminListRequest = 146,
    /// Fancy Mumble: server replies with the plugin inventory snapshot.
    FancyPluginAdminList = 147,
    /// Fancy Mumble: admin toggles a plugin enabled / disabled.
    FancyPluginAdminSetEnabled = 148,
    /// Fancy Mumble: admin installs a plugin from the marketplace.
    FancyPluginAdminInstall = 149,
    /// Fancy Mumble: admin removes a plugin from disk.
    FancyPluginAdminUninstall = 150,
    /// Fancy Mumble: server status reply for an admin plugin action.
    FancyPluginAdminAck = 151,
    /// Fancy Mumble: server advertises the editable server-settings schema.
    FancyServerSettings = 152,
    /// Fancy Mumble: admin submits changed server settings.
    FancyServerSettingsUpdate = 153,
    /// Fancy Mumble: server snapshot of the own registered account's settings.
    FancyAccountSettings = 154,
    /// Fancy Mumble: user submits a self-service account operation.
    FancyAccountSettingsUpdate = 155,
    /// Fancy Mumble: server status reply for an account operation.
    FancyAccountAck = 156,
    /// Fancy Mumble: create/edit or broadcast of a forum post.
    FancyForumPost = 157,
    /// Fancy Mumble: fetch forum threads or a thread's posts.
    FancyForumFetch = 158,
    /// Fancy Mumble: response to a forum fetch.
    FancyForumFetchResponse = 159,
    /// Fancy Mumble: delete a forum post (or thread).
    FancyForumDelete = 160,
    /// Fancy Mumble: schedule a message for future delivery.
    FancyScheduledMessage = 161,
    /// Fancy Mumble: request the caller's pending scheduled messages.
    FancyScheduledMessageList = 162,
    /// Fancy Mumble: the caller's scheduled messages.
    FancyScheduledMessageListResponse = 163,
    /// Fancy Mumble: cancel a pending scheduled message.
    FancyScheduledMessageCancel = 164,
    /// Fancy Mumble: acknowledge a schedule/cancel/delivery outcome.
    FancyScheduledMessageAck = 165,
    // 169 is reserved for FancyModSignal (audit spec section 6.5).
    /// Fancy Mumble: auditor searches the audit log / subscribes to a tail.
    FancyAuditQuery = 166,
    /// Fancy Mumble: server replies with a page of audit entries.
    FancyAuditResponse = 167,
    /// Fancy Mumble: server pushes a live-tail audit entry to a subscriber.
    FancyAuditEvent = 168,
    /// Fancy Mumble: server advertises the audit configuration schema.
    FancyAuditConfig = 170,
    /// Fancy Mumble: admin submits changed audit configuration.
    FancyAuditConfigUpdate = 171,
    /// Fancy Mumble: client asks for the server's livery.
    ///
    /// Epoch-0 has no livery message and never will; these two ids are local
    /// tags that never reach a wire. The canon carries both inside outer type
    /// 1013, which is the service that owns the document.
    FancyLiveryQuery = 172,
    /// Fancy Mumble: server sends what it looks like.
    FancyServerLivery = 173,
    /// Fancy Mumble: an admin changes the livery from a connected client.
    FancyLiveryUpdate = 174,
    /// Fancy Mumble: a connected session asks for a short-lived operator
    /// credential, carried on the same outer type 1013 as livery.
    FancyOperatorTicketRequest = 175,
    /// Fancy Mumble: the server's answer to a ticket request.
    FancyOperatorTicketReply = 176,
    /// Fancy Mumble: client asks to share a file, naming what it is sending.
    ///
    /// Epoch-0 has no file message: the plugin did this over plugin-data and
    /// its own HTTP API, so there is nothing to translate from. These ids are
    /// local tags that never reach a wire; the canon carries all seven inside
    /// outer type 1009.
    FancyFileUpload = 177,
    /// Fancy Mumble: client asks for a URL to read an object it knows the key of.
    FancyFileDownload = 178,
    /// Fancy Mumble: client asks what has been shared in a channel.
    FancyFileList = 179,
    /// Fancy Mumble: the server's short-lived signed URL for one request.
    FancyFileGrant = 180,
    /// Fancy Mumble: a file has been shared with the channel.
    FancyFileShare = 181,
    /// Fancy Mumble: the files shared in a channel.
    FancyFileListing = 182,
    /// Fancy Mumble: the server declined a file request, and why.
    FancyFileRefused = 183,
    /// Fancy Mumble: client asks for its own uploads, or for every one of them.
    FancyFileManage = 184,
    /// Fancy Mumble: the answer to that, with the disk stats for an operator.
    FancyFileManaged = 185,
    /// Fancy Mumble: client asks for one stored file to be removed.
    FancyFileForget = 186,
    /// Fancy Mumble: admin asks which settings this server may be told to
    /// change at run time.
    ///
    /// Epoch-0 pushed the schema unasked to whoever held root Write, so it
    /// never needed a question and has no wire form for one; this is a local
    /// tag that never reaches a wire. The canon carries it inside outer type
    /// 1013, the same envelope as `FancyServerSettingsUpdate`.
    FancyServerSettingsQuery = 187,
    /// Fancy Mumble: generic plugin envelope (bidirectional).
    PluginMessage = 200,
    /// Fancy Mumble: server enumerates loaded plugins after `ServerSync`.
    PluginRegistry = 201,
}

/// Generates both `TryFrom<u16> for TcpMessageType` and
/// `ControlMessage::type_id()` / `is_fancy_extension()` from a single
/// list of variant names.  The variant names must match between both
/// enums (except `UdpTunnel` which is handled separately).
macro_rules! message_type_mapping {
    ($($variant:ident),* $(,)?) => {
        impl TryFrom<u16> for TcpMessageType {
            type Error = crate::error::Error;

            fn try_from(value: u16) -> Result<Self, Self::Error> {
                match value {
                    $(v if v == Self::$variant as u16 => Ok(Self::$variant),)*
                    other => Err(crate::error::Error::UnknownMessageType(other)),
                }
            }
        }

        impl ControlMessage {
            /// The `TcpMessageType` wire ID for this message.
            pub fn type_id(&self) -> u16 {
                match self {
                    $(Self::$variant(_) => TcpMessageType::$variant as u16,)*
                }
            }

            /// Whether this is a Fancy Mumble extension type (ID >= 100),
            /// unknown to legacy Mumble servers.
            pub fn is_fancy_extension(&self) -> bool {
                self.type_id() >= FANCY_EXTENSION_TYPE_THRESHOLD
            }
        }
    };
}

/// A decoded TCP control message received from (or to be sent to) the server.
#[derive(Debug, Clone)]
pub enum ControlMessage {
    /// Protocol version negotiation.
    Version(mumble_tcp::Version),
    /// Client authentication.
    Authenticate(mumble_tcp::Authenticate),
    /// Keep-alive ping.
    Ping(mumble_tcp::Ping),
    /// Server rejected the connection.
    Reject(mumble_tcp::Reject),
    /// Successful authentication acknowledgement.
    ServerSync(mumble_tcp::ServerSync),
    /// A channel was removed.
    ChannelRemove(mumble_tcp::ChannelRemove),
    /// Channel metadata update.
    ChannelState(mumble_tcp::ChannelState),
    /// A user disconnected.
    UserRemove(mumble_tcp::UserRemove),
    /// User state change (mute, channel, etc.).
    UserState(mumble_tcp::UserState),
    /// Ban list from the server.
    BanList(mumble_tcp::BanList),
    /// A text chat message.
    TextMessage(mumble_tcp::TextMessage),
    /// Server denied an action.
    PermissionDenied(mumble_tcp::PermissionDenied),
    /// Access-control list for a channel.
    Acl(mumble_tcp::Acl),
    /// Registered user name map.
    QueryUsers(mumble_tcp::QueryUsers),
    /// OCB encryption key setup.
    CryptSetup(mumble_tcp::CryptSetup),
    /// Add/remove a contextual action.
    ContextActionModify(mumble_tcp::ContextActionModify),
    /// A contextual action was triggered.
    ContextAction(mumble_tcp::ContextAction),
    /// Registered user list.
    UserList(mumble_tcp::UserList),
    /// Voice target (whisper/shout) configuration.
    VoiceTarget(mumble_tcp::VoiceTarget),
    /// Channel permission query or response.
    PermissionQuery(mumble_tcp::PermissionQuery),
    /// Negotiated audio codec version.
    CodecVersion(mumble_tcp::CodecVersion),
    /// Detailed user statistics.
    UserStats(mumble_tcp::UserStats),
    /// Request to send a large blob.
    RequestBlob(mumble_tcp::RequestBlob),
    /// Global server configuration values.
    ServerConfig(mumble_tcp::ServerConfig),
    /// Server hints at an outdated client configuration.
    SuggestConfig(mumble_tcp::SuggestConfig),
    /// Plugin data relay message.
    PluginDataTransmission(mumble_tcp::PluginDataTransmission),
    /// Fancy: encrypted persistent chat message.
    PchatMessage(mumble_tcp::PchatMessage),
    /// Fancy: request to fetch stored messages.
    PchatFetch(mumble_tcp::PchatFetch),
    /// Fancy: server response to a fetch request.
    PchatFetchResponse(mumble_tcp::PchatFetchResponse),
    /// Fancy: server delivers a stored message to the client.
    PchatMessageDeliver(mumble_tcp::PchatMessageDeliver),
    /// Fancy: client announces its E2EE identity keys.
    PchatKeyAnnounce(mumble_tcp::PchatKeyAnnounce),
    /// Fancy: peer-to-peer encrypted key exchange.
    PchatKeyExchange(mumble_tcp::PchatKeyExchange),
    /// Fancy: server requests a key for a new member.
    PchatKeyRequest(mumble_tcp::PchatKeyRequest),
    /// Fancy: server acknowledgement of a stored message.
    PchatAck(mumble_tcp::PchatAck),
    /// Fancy: custodian countersignature for an epoch transition.
    PchatEpochCountersig(mumble_tcp::PchatEpochCountersig),
    /// Fancy: report that a peer holds the channel key.
    PchatKeyHolderReport(mumble_tcp::PchatKeyHolderReport),
    /// Fancy: query for list of key holders.
    PchatKeyHoldersQuery(mumble_tcp::PchatKeyHoldersQuery),
    /// Fancy: server response with the key-holder list.
    PchatKeyHoldersList(mumble_tcp::PchatKeyHoldersList),
    /// Fancy: server challenge to prove key possession.
    PchatKeyChallenge(mumble_tcp::PchatKeyChallenge),
    /// Fancy: client response to a key-possession challenge.
    PchatKeyChallengeResponse(mumble_tcp::PchatKeyChallengeResponse),
    /// Fancy: server verdict on a key-possession challenge.
    PchatKeyChallengeResult(mumble_tcp::PchatKeyChallengeResult),
    /// Fancy: delete persisted messages.
    PchatDeleteMessages(mumble_tcp::PchatDeleteMessages),
    /// Fancy: server drains offline message queue.
    PchatOfflineQueueDrain(mumble_tcp::PchatOfflineQueueDrain),
    /// Fancy: client sends a reaction on a persistent message.
    PchatReaction(mumble_tcp::PchatReaction),
    /// Fancy: server broadcasts a reaction update.
    PchatReactionDeliver(mumble_tcp::PchatReactionDeliver),
    /// Fancy: server response with reactions for requested messages.
    PchatReactionFetchResponse(mumble_tcp::PchatReactionFetchResponse),
    /// Fancy: WebRTC screen-sharing signaling relay.
    WebRtcSignal(mumble_tcp::WebRtcSignal),
    /// Fancy: Signal sender key distribution.
    PchatSenderKeyDistribution(mumble_tcp::PchatSenderKeyDistribution),
    /// Fancy: FCM push notification registration.
    FancyPushRegister(mumble_tcp::FancyPushRegister),
    /// Fancy: push notification mute preferences update.
    FancyPushUpdate(mumble_tcp::FancyPushUpdate),
    /// Fancy: server broadcasts custom reaction/emoji config.
    FancyCustomReactionsConfig(mumble_tcp::FancyCustomReactionsConfig),
    /// Fancy: live push subscribe for connected clients.
    FancySubscribePush(mumble_tcp::FancySubscribePush),
    /// Fancy: client sends a read receipt watermark.
    FancyReadReceipt(mumble_tcp::FancyReadReceipt),
    /// Fancy: server broadcasts read receipt state.
    FancyReadReceiptDeliver(mumble_tcp::FancyReadReceiptDeliver),
    /// Fancy: client sends a pin/unpin request.
    PchatPin(mumble_tcp::PchatPin),
    /// Fancy: server broadcasts a pin state change.
    PchatPinDeliver(mumble_tcp::PchatPinDeliver),
    /// Fancy: server response with pinned messages for a channel.
    PchatPinFetchResponse(mumble_tcp::PchatPinFetchResponse),
    /// Fancy: typing indicator broadcast.
    FancyTypingIndicator(mumble_tcp::FancyTypingIndicator),
    /// Fancy: client requests link previews from the server.
    FancyLinkPreviewRequest(mumble_tcp::FancyLinkPreviewRequest),
    /// Fancy: server responds with link embed metadata.
    FancyLinkPreviewResponse(mumble_tcp::FancyLinkPreviewResponse),
    /// Fancy: synchronised watch-together control event.
    FancyWatchSync(mumble_tcp::FancyWatchSync),
    /// Fancy: drawing stroke overlay for screen-share collaboration.
    FancyDrawStroke(mumble_tcp::FancyDrawStroke),
    /// Fancy: server broadcasts the active onboarding config.
    FancyOnboardingConfig(mumble_tcp::FancyOnboardingConfig),
    /// Fancy: admin submits a new onboarding config.
    FancyOnboardingConfigUpdate(mumble_tcp::FancyOnboardingConfigUpdate),
    /// Fancy: user submits answers to the onboarding questionnaire.
    FancyOnboardingResponse(mumble_tcp::FancyOnboardingResponse),
    /// Fancy: user queries their previously-stored onboarding response.
    FancyOnboardingResponseQuery(mumble_tcp::FancyOnboardingResponseQuery),
    /// Fancy: server delivers a previously-stored onboarding response.
    FancyOnboardingResponseDeliver(mumble_tcp::FancyOnboardingResponseDeliver),
    /// Fancy: client announces a new poll in a channel.
    FancyPoll(mumble_tcp::FancyPoll),
    /// Fancy: client casts a vote on a poll.
    FancyPollVote(mumble_tcp::FancyPollVote),
    /// Fancy: admin requests the server plugin inventory.
    FancyPluginAdminListRequest(mumble_tcp::FancyPluginAdminListRequest),
    /// Fancy: server replies with the plugin inventory snapshot.
    FancyPluginAdminList(mumble_tcp::FancyPluginAdminList),
    /// Fancy: admin toggles a plugin enabled / disabled.
    FancyPluginAdminSetEnabled(mumble_tcp::FancyPluginAdminSetEnabled),
    /// Fancy: admin installs a plugin from the marketplace.
    FancyPluginAdminInstall(mumble_tcp::FancyPluginAdminInstall),
    /// Fancy: admin removes a plugin from disk.
    FancyPluginAdminUninstall(mumble_tcp::FancyPluginAdminUninstall),
    /// Fancy: server status reply for an admin plugin action.
    FancyPluginAdminAck(mumble_tcp::FancyPluginAdminAck),
    /// Fancy: server advertises the editable server-settings schema.
    FancyServerSettings(mumble_tcp::FancyServerSettings),
    /// Fancy: admin submits changed server settings.
    FancyServerSettingsUpdate(mumble_tcp::FancyServerSettingsUpdate),
    /// Fancy: admin asks for the editable server-settings schema.
    FancyServerSettingsQuery(fancy::domain::ConfigQuery),
    /// Fancy: server snapshot of the own registered account's settings.
    FancyAccountSettings(mumble_tcp::FancyAccountSettings),
    /// Fancy: user submits a self-service account operation.
    FancyAccountSettingsUpdate(mumble_tcp::FancyAccountSettingsUpdate),
    /// Fancy: server status reply for an account operation.
    FancyAccountAck(mumble_tcp::FancyAccountAck),
    /// Fancy: create/edit or broadcast of a forum post.
    FancyForumPost(mumble_tcp::FancyForumPost),
    /// Fancy: fetch forum threads or a thread's posts.
    FancyForumFetch(mumble_tcp::FancyForumFetch),
    /// Fancy: response to a forum fetch.
    FancyForumFetchResponse(mumble_tcp::FancyForumFetchResponse),
    /// Fancy: delete a forum post (or thread).
    FancyForumDelete(mumble_tcp::FancyForumDelete),
    /// Fancy: schedule a message for future delivery.
    FancyScheduledMessage(mumble_tcp::FancyScheduledMessage),
    /// Fancy: request the caller's pending scheduled messages.
    FancyScheduledMessageList(mumble_tcp::FancyScheduledMessageList),
    /// Fancy: the caller's scheduled messages.
    FancyScheduledMessageListResponse(mumble_tcp::FancyScheduledMessageListResponse),
    /// Fancy: cancel a pending scheduled message.
    FancyScheduledMessageCancel(mumble_tcp::FancyScheduledMessageCancel),
    /// Fancy: acknowledge a schedule/cancel/delivery outcome.
    FancyScheduledMessageAck(mumble_tcp::FancyScheduledMessageAck),
    /// Fancy: auditor searches the audit log / subscribes to a live tail.
    FancyAuditQuery(mumble_tcp::FancyAuditQuery),
    /// Fancy: server replies with a page of audit entries.
    FancyAuditResponse(mumble_tcp::FancyAuditResponse),
    /// Fancy: server pushes a live-tail audit entry to a subscriber.
    FancyAuditEvent(mumble_tcp::FancyAuditEvent),
    /// Fancy: server advertises the audit configuration schema.
    FancyAuditConfig(mumble_tcp::FancyAuditConfig),
    /// Fancy: admin submits changed audit configuration.
    FancyAuditConfigUpdate(mumble_tcp::FancyAuditConfigUpdate),
    /// Fancy: client asks for the server's livery, naming the artwork it holds.
    ///
    /// Carries the canon type rather than a hand-written twin. Every other
    /// variant here wraps an epoch-0 message because one exists; livery has no
    /// epoch-0 form at all, so a second identical struct would be translation
    /// between a shape and itself.
    FancyLiveryQuery(fancy::domain::LiveryQuery),
    /// Fancy: server sends what it looks like - banner, mark, motto, palette.
    FancyServerLivery(fancy::domain::LiveryDoc),
    /// Fancy: an admin changes the livery from a connected client.
    ///
    /// Authorised server-side by `Write` on the root channel, against the
    /// session this frame arrives on. Artwork is not carried here: a banner is
    /// half a megabyte and the control channel is the wrong pipe for it.
    FancyLiveryUpdate(fancy::domain::LiveryUpdate),
    /// Fancy: a connected session asks for a short-lived operator credential,
    /// naming the scopes it wants - a livery image upload, today, and meant
    /// to widen to whatever else this replaces from Ice's admin console.
    FancyOperatorTicketRequest(fancy::domain::OperatorTicketRequest),
    /// Fancy: the server's answer to a ticket request. `granted_scopes` may
    /// be a subset of what was asked for, or empty; see `denied_reason` when
    /// it is.
    FancyOperatorTicketReply(fancy::domain::OperatorTicketReply),
    /// Fancy: client asks to share a file.
    ///
    /// Carries the canon type for the same reason livery does: files have no
    /// epoch-0 form, so a hand-written twin would be translation between a
    /// shape and itself. The bytes never travel here - this asks for a URL,
    /// and [`Self::FancyFileGrant`] answers with one.
    FancyFileUpload(fancy::files::UploadRequest),
    /// Fancy: client asks for a URL to read an object.
    FancyFileDownload(fancy::files::DownloadRequest),
    /// Fancy: client asks what has been shared in a channel.
    FancyFileList(fancy::files::ListRequest),
    /// Fancy: a short-lived signed URL, correlated by `request_id`.
    FancyFileGrant(fancy::files::Grant),
    /// Fancy: a file has been shared with the channel.
    ///
    /// Sent to everyone in it including the uploader, which is how the
    /// uploader learns the final key and the size that actually arrived.
    FancyFileShare(fancy::files::Share),
    /// Fancy: the files shared in a channel.
    FancyFileListing(fancy::files::Listing),
    /// Fancy: ask for the caller's own uploads, or for every one of them.
    FancyFileManage(fancy::files::ManageRequest),
    /// Fancy: the answer to that, with the disk stats for an operator.
    FancyFileManaged(fancy::files::ManageListing),
    /// Fancy: ask for one stored file to be removed.
    FancyFileForget(fancy::files::ForgetRequest),
    /// Fancy: the server declined a file request, carrying a reason.
    FancyFileRefused(fancy::files::Refused),
    /// Fancy: generic plugin envelope (bidirectional).
    PluginMessage(mumble_tcp::PluginMessage),
    /// Fancy: server enumerates loaded plugins.
    PluginRegistry(mumble_tcp::PluginRegistry),
    /// UDP audio tunneled through TCP (fallback path).
    UdpTunnel(Vec<u8>),
}

/// First Fancy Mumble extension type ID. All IDs at or above this
/// threshold are Fancy-specific and unknown to legacy Mumble servers.
///
/// On the epoch-1 wire these numbers are no longer outer types - every Fancy
/// message is framed under its service instead (see [`fancy_services`]). They
/// survive as the identity of a message inside a `PluginDataTransmission`
/// relay, which is how a Fancy client keeps working against vanilla Mumble.
pub const FANCY_EXTENSION_TYPE_THRESHOLD: u16 = TcpMessageType::PchatMessage as u16;

/// First service outer type. Epoch 1 gives every Fancy service exactly one
/// outer type from here up, and nests its messages in that service's envelope.
///
/// What travels under one is the proto3 canon, translated by [`crate::canon`].
/// The proto2 envelopes that used to live in `Mumble.proto` are deleted (M3):
/// they were a second, incompatible definition of these same outer types, and
/// keeping them meant every frame had two possible readings - which is exactly
/// how the two ends silently disagreed.
pub const FANCY_SERVICE_TYPE_MIN: u16 = 1000;

message_type_mapping! {
    Version, UdpTunnel, Authenticate, Ping, Reject, ServerSync,
    ChannelRemove, ChannelState, UserRemove, UserState, BanList,
    TextMessage, PermissionDenied, Acl, QueryUsers, CryptSetup,
    ContextActionModify, ContextAction, UserList, VoiceTarget,
    PermissionQuery, CodecVersion, UserStats, RequestBlob,
    ServerConfig, SuggestConfig, PluginDataTransmission,
    PchatMessage, PchatFetch, PchatFetchResponse, PchatMessageDeliver,
    PchatKeyAnnounce, PchatKeyExchange, PchatKeyRequest, PchatAck,
    PchatEpochCountersig, PchatKeyHolderReport, PchatKeyHoldersQuery,
    PchatKeyHoldersList, PchatKeyChallenge, PchatKeyChallengeResponse,
    PchatKeyChallengeResult, PchatDeleteMessages, PchatOfflineQueueDrain,
    FancyLiveryQuery, FancyServerLivery, FancyLiveryUpdate,
    FancyFileUpload, FancyFileDownload, FancyFileList,
    FancyFileGrant, FancyFileShare, FancyFileListing, FancyFileRefused,
    FancyFileManage, FancyFileManaged, FancyFileForget,
    FancyOperatorTicketRequest, FancyOperatorTicketReply,
    PchatReaction, PchatReactionDeliver, PchatReactionFetchResponse,
    WebRtcSignal, PchatSenderKeyDistribution,
    FancyPushRegister, FancyPushUpdate, FancyCustomReactionsConfig,
    FancySubscribePush, FancyReadReceipt, FancyReadReceiptDeliver,
    PchatPin, PchatPinDeliver, PchatPinFetchResponse,
    FancyTypingIndicator,
    FancyLinkPreviewRequest, FancyLinkPreviewResponse,
    FancyWatchSync, FancyDrawStroke,
    FancyOnboardingConfig, FancyOnboardingConfigUpdate,
    FancyOnboardingResponse, FancyOnboardingResponseQuery,
    FancyOnboardingResponseDeliver,
    FancyPoll, FancyPollVote,
    FancyPluginAdminListRequest, FancyPluginAdminList,
    FancyPluginAdminSetEnabled, FancyPluginAdminInstall,
    FancyPluginAdminUninstall, FancyPluginAdminAck,
    FancyServerSettings, FancyServerSettingsUpdate, FancyServerSettingsQuery,
    FancyAccountSettings, FancyAccountSettingsUpdate, FancyAccountAck,
    FancyForumPost, FancyForumFetch, FancyForumFetchResponse, FancyForumDelete,
    FancyScheduledMessage, FancyScheduledMessageList,
    FancyScheduledMessageListResponse, FancyScheduledMessageCancel,
    FancyScheduledMessageAck,
    FancyAuditQuery, FancyAuditResponse, FancyAuditEvent,
    FancyAuditConfig, FancyAuditConfigUpdate,
    PluginMessage, PluginRegistry,
}

/// A decoded UDP message - either audio or a UDP ping.
#[derive(Debug, Clone)]
pub enum UdpMessage {
    /// An audio packet (encoded speech or music).
    Audio(mumble_udp::Audio),
    /// A UDP-level ping for latency measurement.
    Ping(mumble_udp::Ping),
}

/// Unified inbound message from either transport.
#[derive(Debug, Clone)]
#[allow(
    clippy::large_enum_variant,
    reason = "Control variant must hold a full ControlMessage; boxing would add heap allocation on the hot audio path"
)]
pub enum ServerMessage {
    /// Control-plane message received over TCP.
    Control(ControlMessage),
    /// Real-time audio/ping received over UDP (or UDP-over-TCP tunnel).
    Udp(UdpMessage),
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn tcp_message_type_valid_conversions() {
        let expected = [
            (0u16, TcpMessageType::Version),
            (1, TcpMessageType::UdpTunnel),
            (2, TcpMessageType::Authenticate),
            (3, TcpMessageType::Ping),
            (4, TcpMessageType::Reject),
            (5, TcpMessageType::ServerSync),
            (6, TcpMessageType::ChannelRemove),
            (7, TcpMessageType::ChannelState),
            (8, TcpMessageType::UserRemove),
            (9, TcpMessageType::UserState),
            (10, TcpMessageType::BanList),
            (11, TcpMessageType::TextMessage),
            (12, TcpMessageType::PermissionDenied),
            (13, TcpMessageType::Acl),
            (14, TcpMessageType::QueryUsers),
            (15, TcpMessageType::CryptSetup),
            (16, TcpMessageType::ContextActionModify),
            (17, TcpMessageType::ContextAction),
            (18, TcpMessageType::UserList),
            (19, TcpMessageType::VoiceTarget),
            (20, TcpMessageType::PermissionQuery),
            (21, TcpMessageType::CodecVersion),
            (22, TcpMessageType::UserStats),
            (23, TcpMessageType::RequestBlob),
            (24, TcpMessageType::ServerConfig),
            (25, TcpMessageType::SuggestConfig),
            (26, TcpMessageType::PluginDataTransmission),
            (100, TcpMessageType::PchatMessage),
            (101, TcpMessageType::PchatFetch),
            (102, TcpMessageType::PchatFetchResponse),
            (103, TcpMessageType::PchatMessageDeliver),
            (104, TcpMessageType::PchatKeyAnnounce),
            (105, TcpMessageType::PchatKeyExchange),
            (106, TcpMessageType::PchatKeyRequest),
            (107, TcpMessageType::PchatAck),
            (108, TcpMessageType::PchatEpochCountersig),
            (109, TcpMessageType::PchatKeyHolderReport),
            (110, TcpMessageType::PchatKeyHoldersQuery),
            (111, TcpMessageType::PchatKeyHoldersList),
            (112, TcpMessageType::PchatKeyChallenge),
            (113, TcpMessageType::PchatKeyChallengeResponse),
            (114, TcpMessageType::PchatKeyChallengeResult),
            (115, TcpMessageType::PchatDeleteMessages),
            (116, TcpMessageType::PchatOfflineQueueDrain),
            (117, TcpMessageType::PchatReaction),
            (118, TcpMessageType::PchatReactionDeliver),
            (119, TcpMessageType::PchatReactionFetchResponse),
            (120, TcpMessageType::WebRtcSignal),
            (121, TcpMessageType::PchatSenderKeyDistribution),
            (128, TcpMessageType::PchatPin),
            (129, TcpMessageType::PchatPinDeliver),
            (130, TcpMessageType::PchatPinFetchResponse),
            (154, TcpMessageType::FancyAccountSettings),
            (155, TcpMessageType::FancyAccountSettingsUpdate),
            (156, TcpMessageType::FancyAccountAck),
        ];

        for (id, expected_type) in &expected {
            let result = TcpMessageType::try_from(*id).unwrap();
            assert_eq!(result, *expected_type, "mismatch for type id {id}");
        }
    }

    #[test]
    fn tcp_message_type_roundtrip() {
        // Core protocol IDs (contiguous 0..=26)
        for id in 0..=26u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // Pchat IDs (100..=108)
        for id in 100..=108u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // Key-holder IDs (109..=111)
        for id in 109..=111u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // Key-challenge IDs (112..=115)
        for id in 112..=115u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // Offline queue ID (116)
        {
            let msg_type = TcpMessageType::try_from(116u16).unwrap();
            assert_eq!(msg_type as u16, 116);
        }
        // Reaction IDs (117..=119)
        for id in 117..=119u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // WebRtcSignal ID (120)
        {
            let msg_type = TcpMessageType::try_from(120u16).unwrap();
            assert_eq!(msg_type as u16, 120);
        }
        // PchatSenderKeyDistribution ID (121)
        {
            let msg_type = TcpMessageType::try_from(121u16).unwrap();
            assert_eq!(msg_type as u16, 121);
        }
        // FancyPushRegister (122) .. FancyReadReceiptDeliver (127)
        for id in 122..=127u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // PchatPin (128) .. PchatPinFetchResponse (130)
        for id in 128..=130u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // FancyTypingIndicator (131) .. FancyDrawStroke (135)
        for id in 131..=135u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
        // FancyOnboardingConfig (136) .. FancyOnboardingResponseDeliver (140)
        for id in 136..=140u16 {
            let msg_type = TcpMessageType::try_from(id).unwrap();
            assert_eq!(msg_type as u16, id);
        }
    }

    #[test]
    fn tcp_message_type_invalid_returns_error() {
        assert!(TcpMessageType::try_from(27u16).is_err());
        assert!(TcpMessageType::try_from(99u16).is_err());
        assert!(TcpMessageType::try_from(141u16).is_err());
        assert!(TcpMessageType::try_from(142u16).is_err());
        assert!(TcpMessageType::try_from(143u16).is_err());
        assert!(TcpMessageType::try_from(169u16).is_err());
        assert!(TcpMessageType::try_from(199u16).is_err());
        assert!(TcpMessageType::try_from(202u16).is_err());
        assert!(TcpMessageType::try_from(u16::MAX).is_err());
    }

    #[test]
    fn control_message_variants_are_constructable() {
        // Verify each variant can be constructed via Default
        let _ = ControlMessage::Version(mumble_tcp::Version::default());
        let _ = ControlMessage::Ping(mumble_tcp::Ping::default());
        let _ = ControlMessage::ServerSync(mumble_tcp::ServerSync::default());
        let _ = ControlMessage::UserState(mumble_tcp::UserState::default());
        let _ = ControlMessage::ChannelState(mumble_tcp::ChannelState::default());
        let _ = ControlMessage::TextMessage(mumble_tcp::TextMessage {
            message: "test".into(),
            ..Default::default()
        });
        let _ = ControlMessage::UdpTunnel(vec![1, 2, 3]);
    }

    #[test]
    fn udp_message_audio_variant() {
        let audio = mumble_udp::Audio {
            sender_session: 1,
            frame_number: 42,
            opus_data: vec![0xDE, 0xAD],
            ..Default::default()
        };
        let msg = UdpMessage::Audio(audio);
        match msg {
            UdpMessage::Audio(a) => {
                assert_eq!(a.sender_session, 1);
                assert_eq!(a.frame_number, 42);
            }
            _ => panic!("expected Audio variant"),
        }
    }

    #[test]
    fn udp_message_ping_variant() {
        let ping = mumble_udp::Ping {
            timestamp: 99,
            ..Default::default()
        };
        let msg = UdpMessage::Ping(ping);
        match msg {
            UdpMessage::Ping(p) => assert_eq!(p.timestamp, 99),
            _ => panic!("expected Ping variant"),
        }
    }

    #[test]
    fn server_message_wraps_control() {
        let ping = ControlMessage::Ping(mumble_tcp::Ping::default());
        let msg = ServerMessage::Control(ping);
        match msg {
            ServerMessage::Control(ControlMessage::Ping(_)) => {}
            _ => panic!("expected Control(Ping)"),
        }
    }

    #[test]
    fn server_message_wraps_udp() {
        let udp_ping = UdpMessage::Ping(mumble_udp::Ping::default());
        let msg = ServerMessage::Udp(udp_ping);
        match msg {
            ServerMessage::Udp(UdpMessage::Ping(_)) => {}
            _ => panic!("expected Udp(Ping)"),
        }
    }

    #[test]
    fn a_service_outer_type_only_ever_carries_the_canon() {
        // What replaced `every_fancy_message_has_a_service_home`, which asserted
        // totality over the proto2 service mapping that M3 deleted.
        //
        // The surviving property is the one that matters, and it is the D1
        // invariant stated as code: a frame goes out under a service outer type
        // **only** when `canon` produced it. Anything else with a service type
        // would be a shape no epoch-1 peer can read - which is what the proto2
        // envelopes were, framed under exactly these numbers.
        use crate::transport::codec::encode;

        // Carried by the canon: a service type, and the payload is canon.
        let carried = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
            channel_id: Some(4),
            actor: None,
        });
        let framed = encode(&carried).expect("encodes");
        let outer = u16::from_be_bytes([framed[0], framed[1]]);
        assert!(outer >= FANCY_SERVICE_TYPE_MIN, "expected a service type");
        assert!(
            crate::canon::from_canon(outer, &framed[6..])
                .expect("canon payload")
                .is_some(),
            "a service-typed frame must be readable as the canon"
        );

        // Not carried: it must not acquire a service type on the way out. The
        // codec above turns these into a relay before they reach `encode`; what
        // is asserted here is that `encode` itself invents no framing for one.
        // Untranslated today; the sample is here for that property alone.
        // `WebRtcSignal` stood here until the canon grew a home for it.
        let uncarried = ControlMessage::FancyWatchSync(mumble_tcp::FancyWatchSync {
            session_id: Some("sess-4".into()),
            ..Default::default()
        });
        assert!(crate::canon::to_canon(&uncarried).is_none(), "premise");
        assert!(
            encode(&uncarried).is_err(),
            "an untranslated Fancy message must be refused, not given a framing              that no peer reads"
        );
    }
}
