//! Trait-based message handler dispatch.
//!
//! Each `ControlMessage` variant is handled by a dedicated file that
//! implements `HandleMessage` for the corresponding protobuf struct.
//! This keeps each handler focused and testable in isolation.

mod account;
mod acl;
pub(super) mod audit;
mod ban_list;
mod channel_remove;
mod channel_state;
mod codec_version;
pub(super) mod custom_reactions_config;
pub(super) mod draw_stroke;
pub(super) mod files;
pub(super) mod forum;
pub(super) mod gifs;
pub(super) mod invites;
pub(crate) mod link_preview;
pub(super) mod livery;
pub(super) mod records;
pub(crate) use livery::{LiverySnapshot, data_uri, to_snapshot};
mod onboarding;
pub(super) mod operator_ticket;
mod pchat;
mod permission_denied;
mod permission_query;
mod ping;
pub(super) mod plugin_admin;
mod plugin_data;
pub(super) mod plugin_message;
pub(super) mod poll;
pub(super) mod read_receipt;
mod reject;
pub(super) mod scheduled_message;
mod server_config;
mod server_settings;
mod server_sync;
mod text_message;
pub(super) mod typing_indicator;
mod user_list;
mod user_remove;
pub(crate) mod user_state;
mod user_stats;
pub(super) mod version;
pub(super) mod watch_sync;
mod webrtc_signal;

#[cfg(test)]
mod tests;

use std::sync::{Arc, Mutex};

use mumble_protocol::message::ControlMessage;

use super::SharedState;
use super::core_event::CoreEvent;

/// Abstraction over frontend event emission.
///
/// In production this wraps a `Host`; in tests it records
/// emitted events for assertion.
pub(crate) trait EventEmitter: Send + Sync {
    /// Tell the view that `event` happened.
    fn emit_event(&self, event: CoreEvent);

    /// Flash the taskbar / request user attention (desktop-only, no-op elsewhere).
    fn request_user_attention(&self);

    /// Send a native OS notification (e.g. Android notification when backgrounded).
    fn send_notification(&self, title: &str, body: &str);

    /// Whether a native media peer took this WebRTC signal for itself, so
    /// the view must not be told about it. Must never block.
    fn claim_webrtc_signal(
        &self,
        _sender_session: Option<u32>,
        _signal_type: i32,
        _payload: &str,
    ) -> bool {
        false
    }

    /// Send a notification with the sender's avatar as the large icon.
    ///
    /// `channel_id` is passed to the notification intent on Android so
    /// tapping the notification navigates to the correct channel.
    /// The default implementation ignores the icon and `channel_id`.
    fn send_notification_with_icon(
        &self,
        title: &str,
        body: &str,
        _icon: Option<&[u8]>,
        _channel_id: Option<u32>,
    ) {
        self.send_notification(title, body);
    }
}

/// Context passed to each message handler.
pub(crate) struct HandlerContext {
    pub shared: Arc<Mutex<SharedState>>,
    pub emitter: Box<dyn EventEmitter>,
}

impl HandlerContext {
    /// Tell the view that `event` happened.
    pub fn send(&self, event: CoreEvent) {
        self.emitter.emit_event(event);
    }

    /// Whether a native media peer took this WebRTC signal for itself.
    pub fn claim_webrtc_signal(
        &self,
        sender_session: Option<u32>,
        signal_type: i32,
        payload: &str,
    ) -> bool {
        self.emitter
            .claim_webrtc_signal(sender_session, signal_type, payload)
    }

    /// Flash the taskbar / request user attention.
    pub fn request_user_attention(&self) {
        self.emitter.request_user_attention();
    }

    /// Send a notification with an optional sender avatar icon.
    ///
    /// On Android, `channel_id` is forwarded to the notification intent
    /// so tapping the notification opens the correct channel.
    pub fn send_notification_with_icon(
        &self,
        title: &str,
        body: &str,
        icon: Option<&[u8]>,
        channel_id: Option<u32>,
    ) {
        let enabled = self
            .shared
            .lock()
            .map(|s| s.prefs.notifications_enabled)
            .unwrap_or(true);
        if enabled {
            self.emitter
                .send_notification_with_icon(title, body, icon, channel_id);
        }
    }
}

/// Trait for handling a specific control message type.
pub(crate) trait HandleMessage {
    fn handle(&self, ctx: &HandlerContext);
}

/// Dispatch a `ControlMessage` to the appropriate handler.
pub(crate) fn dispatch(msg: &ControlMessage, ctx: &HandlerContext) {
    match msg {
        ControlMessage::Ping(m) => m.handle(ctx),
        ControlMessage::Version(m) => m.handle(ctx),
        ControlMessage::ServerSync(m) => m.handle(ctx),
        ControlMessage::UserState(m) => m.handle(ctx),
        ControlMessage::UserRemove(m) => m.handle(ctx),
        ControlMessage::ChannelState(m) => m.handle(ctx),
        ControlMessage::ChannelRemove(m) => m.handle(ctx),
        ControlMessage::TextMessage(m) => m.handle(ctx),
        ControlMessage::Reject(m) => m.handle(ctx),
        ControlMessage::ServerConfig(m) => m.handle(ctx),
        ControlMessage::PermissionDenied(m) => m.handle(ctx),
        ControlMessage::PluginDataTransmission(m) => m.handle(ctx),
        ControlMessage::PermissionQuery(m) => m.handle(ctx),
        ControlMessage::CodecVersion(m) => m.handle(ctx),
        ControlMessage::UserStats(m) => m.handle(ctx),
        ControlMessage::PchatMessageDeliver(m) => m.handle(ctx),
        ControlMessage::PchatFetchResponse(m) => m.handle(ctx),
        ControlMessage::PchatKeyAnnounce(m) => m.handle(ctx),
        ControlMessage::PchatKeyExchange(m) => m.handle(ctx),
        ControlMessage::PchatKeyRequest(m) => m.handle(ctx),
        ControlMessage::PchatAck(m) => m.handle(ctx),
        ControlMessage::PchatKeyHolderReport(m) => m.handle(ctx),
        ControlMessage::PchatKeyHoldersQuery(m) => m.handle(ctx),
        ControlMessage::PchatKeyHoldersList(m) => m.handle(ctx),
        ControlMessage::PchatKeyChallenge(m) => m.handle(ctx),
        ControlMessage::PchatKeyChallengeResult(m) => m.handle(ctx),
        ControlMessage::PchatDeleteMessages(m) => m.handle(ctx),
        ControlMessage::PchatOfflineQueueDrain(m) => m.handle(ctx),
        ControlMessage::PchatSenderKeyDistribution(m) => m.handle(ctx),
        ControlMessage::PchatReactionDeliver(m) => m.handle(ctx),
        ControlMessage::PchatReactionFetchResponse(m) => m.handle(ctx),
        ControlMessage::PchatPinDeliver(m) => m.handle(ctx),
        ControlMessage::PchatPinFetchResponse(m) => m.handle(ctx),
        ControlMessage::FancyFileGrant(m) => m.handle(ctx),
        ControlMessage::FancyEmotes(m) => m.handle(ctx),
        ControlMessage::FancyAccountRecord(m) => m.handle(ctx),
        ControlMessage::FancyAccountRecordKeys(m) => m.handle(ctx),
        ControlMessage::FancyFileShare(m) => m.handle(ctx),
        ControlMessage::FancyFileListing(m) => m.handle(ctx),
        ControlMessage::FancyFileRefused(m) => m.handle(ctx),
        ControlMessage::FancyFileManaged(m) => m.handle(ctx),
        ControlMessage::FancyVoiceSupport(m) => m.handle(ctx),
        ControlMessage::WebRtcSignal(m) => m.handle(ctx),
        ControlMessage::FancyCustomReactionsConfig(m) => m.handle(ctx),
        ControlMessage::FancyReadReceiptDeliver(m) => m.handle(ctx),
        ControlMessage::FancyTypingIndicator(m) => m.handle(ctx),
        ControlMessage::FancyLinkPreviewResponse(m) => m.handle(ctx),
        ControlMessage::FancyGifPage(m) => m.handle(ctx),
        ControlMessage::FancyGifRefused(m) => m.handle(ctx),
        ControlMessage::FancyGifSupport(m) => m.handle(ctx),
        ControlMessage::FancyInvites(m) => m.handle(ctx),
        ControlMessage::FancyWatchSync(m) => m.handle(ctx),
        ControlMessage::FancyDrawStroke(m) => m.handle(ctx),
        ControlMessage::FancyOnboardingConfig(m) => m.handle(ctx),
        ControlMessage::FancyOnboardingResponseDeliver(m) => m.handle(ctx),
        ControlMessage::FancyServerSettings(m) => m.handle(ctx),
        ControlMessage::FancyAccountSettings(m) => m.handle(ctx),
        ControlMessage::FancyAccountAck(m) => m.handle(ctx),
        ControlMessage::FancyAuditResponse(m) => m.handle(ctx),
        ControlMessage::FancyAuditEvent(m) => m.handle(ctx),
        ControlMessage::FancyAuditConfig(m) => m.handle(ctx),
        ControlMessage::FancyAuditSnapshot(m) => m.handle(ctx),
        ControlMessage::FancyServerLivery(m) => m.handle(ctx),
        ControlMessage::FancyOperatorTicketReply(m) => m.handle(ctx),
        ControlMessage::FancyPluginAdminList(m) => m.handle(ctx),
        ControlMessage::FancyPluginAdminAck(m) => m.handle(ctx),
        ControlMessage::PluginMessage(m) => m.handle(ctx),
        ControlMessage::PluginRegistry(m) => m.handle(ctx),
        ControlMessage::FancyPoll(m) => m.handle(ctx),
        ControlMessage::FancyPollVote(m) => m.handle(ctx),
        ControlMessage::FancyForumPost(m) => m.handle(ctx),
        ControlMessage::FancyForumFetchResponse(m) => m.handle(ctx),
        ControlMessage::FancyScheduledMessageListResponse(m) => m.handle(ctx),
        ControlMessage::FancyScheduledMessageAck(m) => m.handle(ctx),
        ControlMessage::BanList(m) => m.handle(ctx),
        ControlMessage::UserList(m) => m.handle(ctx),
        ControlMessage::Acl(m) => m.handle(ctx),
        _ => {}
    }
}
