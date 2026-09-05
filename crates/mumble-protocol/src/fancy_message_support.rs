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

        /// Every message declared here, with its policy, by variant name.
        ///
        /// Generated from the same table so the two cannot disagree. Only the
        /// coverage test below reads it; it needs the *names*, because what it
        /// checks is which of them `canon.rs` mentions.
        #[cfg(test)]
        const DECLARED: &[(&str, FallbackPolicy)] = &[
            $((stringify!($variant), FallbackPolicy::$fallback),)*
        ];
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
    FancyServerSettingsQuery       => ServerOnly,

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
        let msg = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator::default());
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::PluginData);
    }

    #[test]
    fn pchat_message_is_server_only() {
        let msg = ControlMessage::PchatMessage(mumble_tcp::PchatMessage::default());
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
        let msg = ControlMessage::FancyDrawStroke(mumble_tcp::FancyDrawStroke::default());
        let support = message_support(&msg).unwrap();
        assert_eq!(support.fallback, FallbackPolicy::ServerOnly);
    }

    #[test]
    fn every_onboarding_message_is_server_only() {
        // Relaying these client-to-client would be meaningless: the answers
        // are stored and the flow is served by the server itself.
        let cases: [ControlMessage; 5] = [
            ControlMessage::FancyOnboardingConfig(mumble_tcp::FancyOnboardingConfig::default()),
            ControlMessage::FancyOnboardingConfigUpdate(
                mumble_tcp::FancyOnboardingConfigUpdate::default(),
            ),
            ControlMessage::FancyOnboardingResponse(mumble_tcp::FancyOnboardingResponse::default()),
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

    /// Messages that a Fancy server must process and that the canon carries in
    /// neither direction.
    ///
    /// Each of these is a dead surface on an epoch-1 connection: `to_canon`
    /// gives the codec no framing for it, so [`crate::fancy_codec::NativeCodec`]
    /// hands it to the legacy codec, which drops every `ServerOnly` message with
    /// nothing but a `debug!` line. The feature above it does nothing and says
    /// nothing - the account page sat on "loading" for exactly this reason,
    /// until `FancyAccountSettingsUpdate` came off this list.
    ///
    /// **This list may only ever get shorter.** Adding to it is how a feature
    /// ships broken and silent; the test below refuses a new entry by refusing
    /// anything not already here.
    const UNCARRIED: &[&str] = &[
        // The persistent-chat key ladder past the parts the canon models: the
        // challenge round trip, the epoch countersignature, and the fetch and
        // delete verbs.
        "PchatAck",
        "PchatEpochCountersig",
        "PchatKeyHoldersList",
        "PchatKeyChallenge",
        "PchatKeyChallengeResponse",
        "PchatKeyChallengeResult",
        "PchatDeleteMessages",
        "PchatOfflineQueueDrain",
        "PchatReactionFetchResponse",
        "FancyCustomReactionsConfig",
        // Pinned messages, whole.
        "PchatPin",
        "PchatPinDeliver",
        "PchatPinFetchResponse",
        // Onboarding, whole.
        "FancyOnboardingConfig",
        "FancyOnboardingConfigUpdate",
        "FancyOnboardingResponse",
        "FancyOnboardingResponseQuery",
        "FancyOnboardingResponseDeliver",
        // Plugins: the client-side registry and the whole admin surface.
        "PluginMessage",
        "PluginRegistry",
        "FancyPluginAdminListRequest",
        "FancyPluginAdminList",
        "FancyPluginAdminSetEnabled",
        "FancyPluginAdminInstall",
        "FancyPluginAdminUninstall",
        "FancyPluginAdminAck",
        // The audit *tail*; queries and their answers are carried.
        "FancyAuditEvent",
        // The forum, whole.
        "FancyForumPost",
        "FancyForumFetch",
        "FancyForumFetchResponse",
        "FancyForumDelete",
    ];

    /// Read `canon.rs` and answer which variants it names in each direction.
    ///
    /// Source text rather than behaviour, because the alternative is
    /// constructing one of every `ControlMessage` and calling `to_canon` on it,
    /// which is the same list written twice - and the copy that rots is the one
    /// nothing forces you to update.
    fn canon_mentions(variant: &str) -> (bool, bool) {
        const CANON: &str = include_str!("canon.rs");
        let (out, rest) = CANON
            .split_once("pub fn to_canon")
            .expect("canon.rs declares to_canon");
        let _ = out;
        let (to_canon, after) = rest
            .split_once("pub fn from_canon")
            .expect("canon.rs declares from_canon");
        let from_canon = after.split("#[cfg(test)]").next().unwrap_or(after);
        let needle = format!("ControlMessage::{variant}(");
        (to_canon.contains(&needle), from_canon.contains(&needle))
    }

    #[test]
    fn no_new_fancy_feature_ships_silently_dropped() {
        let mut uncovered: Vec<&str> = Vec::new();
        for (variant, fallback) in DECLARED {
            if *fallback != FallbackPolicy::ServerOnly {
                continue;
            }
            let (sends, receives) = canon_mentions(variant);
            if !sends && !receives {
                uncovered.push(variant);
            }
        }
        let new: Vec<&&str> = uncovered
            .iter()
            .filter(|variant| !UNCARRIED.contains(variant))
            .collect();
        assert!(
            new.is_empty(),
            "these server-processed messages have no canon form in either \
             direction, so the codec drops them and the feature above them does \
             nothing at all: {new:?}. Give each an arm in canon.rs."
        );
    }

    #[test]
    fn the_uncarried_list_does_not_outlive_what_is_on_it() {
        // A name left here after its canon arm landed is a name that stops the
        // test above from noticing the next regression in that service.
        let stale: Vec<&&str> = UNCARRIED
            .iter()
            .filter(|variant| {
                let (sends, receives) = canon_mentions(variant);
                sends || receives
            })
            .collect();
        assert!(
            stale.is_empty(),
            "these are carried by the canon now and must come off UNCARRIED: {stale:?}"
        );
    }
}
