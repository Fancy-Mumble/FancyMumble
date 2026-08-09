//! Per-message fallback policies.
//!
//! Each Fancy extension message type declares whether a `PluginData` relay is
//! a meaningful substitute when the peer cannot process it natively - which,
//! since wire epoch 1, means "the peer is not a Fancy server at all".
//!
//! The [`fancy_message_support!`] macro generates the
//! [`message_support`] lookup function from a compact declaration table.

use crate::message::ControlMessage;

/// Whether a Fancy extension message can fall back to `PluginData`
/// relay when the server does not natively understand it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FallbackPolicy {
    /// Message can be wrapped in `PluginDataTransmission` and relayed
    /// client-to-client through any Mumble server.
    PluginData,
    /// Message requires server-side processing; sending via `PluginData`
    /// would be meaningless.
    ServerOnly,
}

/// What a Fancy extension message does on a server that cannot process it.
#[derive(Debug, Clone, Copy)]
pub struct MessageSupport {
    /// What to do when the peer is not a Fancy server.
    pub fallback: FallbackPolicy,
}

/// Declares the fallback policy for each Fancy extension message type.
///
/// Each entry has the form:
///
/// ```text
/// Variant => Policy
/// ```
///
/// where *Policy* is either `PluginData` (client-to-client relay is possible)
/// or `ServerOnly` (no sensible fallback).
///
/// There is no per-message minimum server version any more: since wire epoch 1
/// a peer either speaks the epoch and therefore all of it, or is not a Fancy
/// peer at all. The version a message first appeared in is kept in the section
/// comments below, where it is history rather than a runtime gate.
macro_rules! fancy_message_support {
    ($($variant:ident => $fallback:ident),* $(,)?) => {
        /// Look up the fallback policy for a Fancy extension
        /// [`ControlMessage`].
        ///
        /// Returns `None` for standard Mumble messages (type < 100).
        pub fn message_support(msg: &ControlMessage) -> Option<MessageSupport> {
            match msg {
                $(
                    ControlMessage::$variant(_) => Some(MessageSupport {
                        fallback: FallbackPolicy::$fallback,
                    }),
                )*
                _ => None,
            }
        }
    };
}

fancy_message_support! {
    // -- Persistent chat (server-processed) -- 0.2.12 ----------------
    PchatMessage              => ServerOnly,
    PchatFetch                => ServerOnly,
    PchatFetchResponse        => ServerOnly,
    PchatMessageDeliver       => ServerOnly,
    PchatKeyAnnounce          => ServerOnly,
    PchatKeyExchange          => ServerOnly,
    PchatKeyRequest           => ServerOnly,
    PchatAck                  => ServerOnly,
    PchatEpochCountersig      => ServerOnly,
    PchatKeyHolderReport      => ServerOnly,
    PchatKeyHoldersQuery      => ServerOnly,
    PchatKeyHoldersList       => ServerOnly,
    PchatKeyChallenge         => ServerOnly,
    PchatKeyChallengeResponse => ServerOnly,
    PchatKeyChallengeResult   => ServerOnly,
    PchatDeleteMessages       => ServerOnly,
    PchatOfflineQueueDrain    => ServerOnly,
    PchatReaction             => ServerOnly,
    PchatReactionDeliver      => ServerOnly,
    PchatReactionFetchResponse => ServerOnly,

    // -- Client-to-client relay -- 0.2.12 ----------------------------
    WebRtcSignal               => PluginData,
    PchatSenderKeyDistribution => PluginData,

    // -- Push / notification / config (server-processed) -- 0.2.12 ---
    FancyPushRegister          => ServerOnly,
    FancyPushUpdate            => ServerOnly,
    FancyCustomReactionsConfig => ServerOnly,
    FancySubscribePush         => ServerOnly,
    FancyReadReceipt           => ServerOnly,
    FancyReadReceiptDeliver    => ServerOnly,

    // -- Pin messages (server-processed) -- 0.2.16 -------------------
    PchatPin                   => ServerOnly,
    PchatPinDeliver            => ServerOnly,
    PchatPinFetchResponse      => ServerOnly,

    // -- Typing indicator (client-to-client relay) -- 0.2.18 ---------
    FancyTypingIndicator       => PluginData,

    // -- Watch together (client-to-client relay) -- 0.2.20 -----------
    FancyWatchSync             => PluginData,

    // -- Screen-share drawing (server-relayed) -- 0.3.0 --------------
    FancyDrawStroke             => ServerOnly,

    // -- Onboarding workflow (server-processed) -- 0.3.1 -------------
    FancyOnboardingConfig          => ServerOnly,
    FancyOnboardingConfigUpdate    => ServerOnly,
    FancyOnboardingResponse        => ServerOnly,
    FancyOnboardingResponseQuery   => ServerOnly,
    FancyOnboardingResponseDeliver => ServerOnly,

    // -- Polls (server-relayed within a channel) -- 0.3.2 ------------
    FancyPoll                      => ServerOnly,
    FancyPollVote                  => ServerOnly,

    // -- Generic plugin envelope (server-routed) -- 0.4.0 ------------
    PluginMessage                  => ServerOnly,
    PluginRegistry                 => ServerOnly,

    // -- Plugin admin / marketplace (server-processed) -- 0.4.0 ------
    FancyPluginAdminListRequest    => ServerOnly,
    FancyPluginAdminList           => ServerOnly,
    FancyPluginAdminSetEnabled     => ServerOnly,
    FancyPluginAdminInstall        => ServerOnly,
    FancyPluginAdminUninstall      => ServerOnly,
    FancyPluginAdminAck            => ServerOnly,

    // -- Runtime server settings (server-processed) -- 0.4.x ---------
    FancyServerSettings            => ServerOnly,
    FancyServerSettingsUpdate      => ServerOnly,

    // -- Self-service account settings (server-processed) -- 0.4.1 ---
    FancyAccountSettings           => ServerOnly,
    FancyAccountSettingsUpdate     => ServerOnly,
    FancyAccountAck                => ServerOnly,

    // -- Audit log (server-processed, mumble-audit plugin) -- 0.4.2 --
    FancyAuditQuery                => ServerOnly,
    FancyAuditResponse             => ServerOnly,
    FancyAuditEvent                => ServerOnly,
    FancyAuditConfig               => ServerOnly,
    FancyAuditConfigUpdate         => ServerOnly,

    // -- Forums (server-stored message board) -- 0.4.3 ---------------
    FancyForumPost                 => ServerOnly,
    FancyForumFetch                => ServerOnly,
    FancyForumFetchResponse        => ServerOnly,
    FancyForumDelete               => ServerOnly,

    // -- Scheduled messages (server-stored and -timed) -- 0.4.3 ------
    FancyScheduledMessage          => ServerOnly,
    FancyScheduledMessageList      => ServerOnly,
    FancyScheduledMessageListResponse => ServerOnly,
    FancyScheduledMessageCancel    => ServerOnly,
    FancyScheduledMessageAck       => ServerOnly,
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

    use super::*;
    use crate::proto::mumble_tcp;


    #[test]
    fn returns_none_for_standard_messages() {
        let msg = ControlMessage::Ping(mumble_tcp::Ping::default());
        assert!(message_support(&msg).is_none());
    }

    #[test]
    fn typing_indicator_is_plugin_data_fallback() {
        let msg = ControlMessage::FancyTypingIndicator(
            mumble_tcp::FancyTypingIndicator::default(),
        );
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::PluginData);
    }

    #[test]
    fn pchat_message_is_server_only() {
        let msg = ControlMessage::PchatMessage(
            mumble_tcp::PchatMessage::default(),
        );
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::ServerOnly);
    }

    #[test]
    fn webrtc_signal_is_plugin_data_fallback() {
        let msg = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            target_session: Some(5),
            ..Default::default()
        });
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::PluginData);
    }

    #[test]
    fn draw_stroke_is_server_only() {
        let msg = ControlMessage::FancyDrawStroke(
            mumble_tcp::FancyDrawStroke::default(),
        );
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::ServerOnly);
    }

    #[test]
    fn every_onboarding_message_is_server_only() {
        // Relaying these client-to-client would be meaningless: the answers
        // are stored and the flow is served by the server itself.
        let cases: [ControlMessage; 5] = [
            ControlMessage::FancyOnboardingConfig(
                mumble_tcp::FancyOnboardingConfig::default(),
            ),
            ControlMessage::FancyOnboardingConfigUpdate(
                mumble_tcp::FancyOnboardingConfigUpdate::default(),
            ),
            ControlMessage::FancyOnboardingResponse(
                mumble_tcp::FancyOnboardingResponse::default(),
            ),
            ControlMessage::FancyOnboardingResponseQuery(
                mumble_tcp::FancyOnboardingResponseQuery::default(),
            ),
            ControlMessage::FancyOnboardingResponseDeliver(
                mumble_tcp::FancyOnboardingResponseDeliver::default(),
            ),
        ];
        for msg in &cases {
            let support = message_support(msg).unwrap();
            assert_eq!(support.fallback, FallbackPolicy::ServerOnly);
        }
    }
}
