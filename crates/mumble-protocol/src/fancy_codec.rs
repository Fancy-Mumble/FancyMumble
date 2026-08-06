//! Codec trait for Fancy Mumble extension messages (types 100+).
//!
//! Abstracts the difference between Fancy Mumble servers (which understand
//! native extension message types) and legacy Mumble servers (which only
//! support the standard protocol). On a legacy server, client-to-client
//! Fancy messages are wrapped inside `PluginDataTransmission` for relay.

use std::fmt::Debug;

use tracing::{debug, warn};

use crate::fancy_message_support::{message_support, FallbackPolicy, MessageSupport};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;
use crate::transport::codec;

/// The Fancy wire epoch this client can speak natively.
///
/// Epoch 1 is one outer type per service with the message nested in that
/// service's envelope, and it is what [`NativeCodec`] encodes. See
/// `Version.fancy_protocol` in `Mumble.proto` for what an epoch is and why it
/// is not the product version.
///
/// Epoch 0 — the interleaved 100–999 layout — is not spoken any more. A server
/// still on it is handled as a plain Mumble server by [`speaks_epoch`], which
/// needs no compatibility code: it is the same branch a vanilla server takes.
pub const FANCY_PROTOCOL_EPOCH: u32 = 1;

/// The epoch a peer that does not announce one is speaking.
///
/// Every server built before the field existed speaks the only numbering that
/// existed when it was built. This is deliberately a literal and not
/// [`FANCY_PROTOCOL_EPOCH`]: silence means *epoch 0*, not "whatever we happen
/// to speak", and tying the two together would make a vanilla Mumble server
/// look like a peer the moment we changed epochs.
const EPOCH_WHEN_UNANNOUNCED: u32 = 0;

/// Whether this client speaks the epoch a server announced.
///
/// The point of asking is what happens when the answer is *no*. Before this
/// existed the client decided purely on `fancy_version`, so a server that had
/// renumbered the wire — announcing features it does implement, at types this
/// client would send to the wrong place — was indistinguishable from an old
/// Fancy server. It would then emit natives the peer could route nowhere and
/// they would vanish silently. A `false` here is the client choosing to be a
/// plain Mumble client instead, which always works.
#[must_use]
pub fn speaks_epoch(server_fancy_protocol: Option<u32>) -> bool {
    server_fancy_protocol.unwrap_or(EPOCH_WHEN_UNANNOUNCED) == FANCY_PROTOCOL_EPOCH
}

/// Prefix for `PluginDataTransmission.data_id` identifying a wrapped
/// Fancy extension message. Followed by the decimal `TcpMessageType` ID.
const WRAPPED_DATA_ID_PREFIX: &str = "fancy-native:";

// ---- Trait ---------------------------------------------------------

/// Codec for encoding/decoding Fancy Mumble extension messages.
///
/// Two implementations exist:
/// - [`NativeCodec`]: for a peer on our wire epoch. Sends the canon where
///   [`crate::canon`] has a faithful form and relays the rest.
/// - [`LegacyCodec`]: for everything else, which means vanilla Mumble. Relays
///   what a [`FallbackPolicy`] says can be relayed through `PluginData` and
///   refuses the rest.
pub trait FancyCodec: Send + Sync + Debug {
    /// Encode an outbound [`ControlMessage`] for the wire.
    ///
    /// Returns `Some(msg)` with the (possibly transformed) message, or
    /// `None` if the message cannot be sent on this server type (e.g. a
    /// server-processed Fancy message on a legacy server).
    fn encode(&self, msg: ControlMessage, state: &ServerState) -> Option<ControlMessage>;

    /// Decode an inbound [`ControlMessage`], potentially unwrapping a
    /// Fancy extension message that was tunnelled inside `PluginData`.
    fn decode(&self, msg: ControlMessage) -> ControlMessage;
}

/// Select the appropriate codec for a server.
///
/// The epoch is the whole question — but only about *framing*. A peer that
/// speaks our epoch agrees on what the outer types mean, which is not the same
/// as both ends having a canon form for every feature; where one is missing
/// [`NativeCodec`] relays instead, and the relay is epoch-independent. Anything
/// else, from vanilla Mumble to a Fancy server still on epoch 0, is handled as
/// a plain Mumble server:
/// [`LegacyCodec`] relays everything relayable through
/// `PluginDataTransmission`, which is epoch-independent, so the basics keep
/// working and nothing is sent to a type the peer cannot route.
///
/// `server_fancy_version` is no longer consulted here. It remains a product
/// version the UI uses to decide which features to *offer*; it is not what
/// decides how bytes are framed.
pub fn select_codec(
    server_fancy_version: Option<u64>,
    server_fancy_protocol: Option<u32>,
) -> Box<dyn FancyCodec> {
    debug!(
        raw_version = ?server_fancy_version,
        decoded = ?server_fancy_version.map(fancy_utils::version::fancy_version_decode),
        protocol = ?server_fancy_protocol,
        "select_codec called"
    );
    if !speaks_epoch(server_fancy_protocol) {
        debug!(
            protocol = ?server_fancy_protocol,
            ours = FANCY_PROTOCOL_EPOCH,
            "server speaks a Fancy wire epoch we do not; basic features only"
        );
        return Box::new(LegacyCodec);
    }

    Box::new(NativeCodec)
}

// ---- NativeCodec ---------------------------------------------------

/// Codec for a Fancy Mumble server that speaks our wire epoch.
///
/// Anything [`crate::canon`] can carry goes out as the canon, framed by
/// [`crate::transport::codec::encode`]. Anything it cannot is **relayed
/// through `PluginData`**, not passed through.
///
/// That last part is load-bearing and was briefly wrong. Passing an untranslated
/// Fancy message through sends it to `to_service_payload`, which frames the
/// *proto2* envelope under the canon's outer type — so an epoch-1 peer would
/// decode proto3 out of proto2 bytes at type 1008 and get silence or nonsense.
/// That is D1, reintroduced one service at a time as the canon's coverage
/// lagged. The relay is epoch-independent and the peer handles it, so those
/// features keep working until their canon lands.
///
/// The decode path still unwraps `fancy-native:*` `PluginData` envelopes, so a
/// message relayed by a *peer* through a vanilla server is handled even while
/// we are talking to a Fancy one.
#[derive(Debug)]
pub struct NativeCodec;

impl FancyCodec for NativeCodec {
    fn encode(&self, msg: ControlMessage, state: &ServerState) -> Option<ControlMessage> {
        if !msg.is_fancy_extension() || crate::canon::to_canon(&msg).is_some() {
            return Some(msg);
        }
        LegacyCodec.encode(msg, state)
    }

    fn decode(&self, msg: ControlMessage) -> ControlMessage {
        LegacyCodec.decode(msg)
    }
}

// ---- LegacyCodec ---------------------------------------------------

/// Legacy codec that wraps Fancy extension messages in `PluginData`.
///
/// Standard Mumble types (0-26) pass through unchanged on both paths.
/// Fancy extension types (100+) are serialized into a
/// `PluginDataTransmission` envelope on send and deserialized back on
/// receive.
#[derive(Debug)]
pub struct LegacyCodec;

// The `LegacyCodec` is the compatibility shim that tunnels Fancy extension
// messages through `PluginDataTransmission` for servers that lack native
// `PluginMessage` (wire id 200) support.  Reading/writing the deprecated
// `PluginDataTransmission` fields is inherent to that legacy path - there is no
// non-deprecated alternative short of dropping old-server support.
#[allow(
    deprecated,
    reason = "legacy fallback codec: wraps Fancy messages in PluginData for servers without native PluginMessage support"
)]
impl FancyCodec for LegacyCodec {
    fn encode(&self, msg: ControlMessage, state: &ServerState) -> Option<ControlMessage> {
        if !msg.is_fancy_extension() {
            return Some(msg);
        }

        // A server-processed message has nowhere to go on a server that will
        // not process it. This is the same set `extract_receiver_sessions`
        // would return no receivers for; asking the policy says so outright
        // rather than inferring it from an empty list.
        if let Some(MessageSupport { fallback: FallbackPolicy::ServerOnly }) = message_support(&msg)
        {
            debug!(
                type_id = msg.type_id(),
                "server-processed message on a non-Fancy server; dropping"
            );
            return None;
        }

        let receiver_sessions = extract_receiver_sessions(&msg, state);
        if receiver_sessions.is_empty() {
            warn!(
                "cannot relay Fancy message on legacy server: \
                 no receiver sessions could be determined"
            );
            return None;
        }

        let (type_id, payload) = match codec::serialize_control_message(&msg) {
            Ok(pair) => pair,
            Err(e) => {
                warn!("failed to serialize Fancy message for PluginData wrapping: {e}");
                return None;
            }
        };

        let data_id = format!("{WRAPPED_DATA_ID_PREFIX}{type_id}");

        Some(ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: None,
                receiver_sessions,
                data: Some(payload),
                data_id: Some(data_id),
            },
        ))
    }

    fn decode(&self, msg: ControlMessage) -> ControlMessage {
        let ControlMessage::PluginDataTransmission(ref pd) = msg else {
            return msg;
        };

        let Some(ref data_id) = pd.data_id else {
            return msg;
        };

        let Some(type_id_str) = data_id.strip_prefix(WRAPPED_DATA_ID_PREFIX) else {
            return msg;
        };

        let Ok(type_id) = type_id_str.parse::<u16>() else {
            warn!("invalid Fancy type ID in PluginData data_id: {data_id}");
            return msg;
        };

        let Some(ref payload) = pd.data else {
            warn!("Fancy PluginData wrapper has no data payload");
            return msg;
        };

        match codec::deserialize_control_message(type_id, payload) {
            Ok(decoded) => {
                let sender = pd.sender_session;
                patch_sender_session(decoded, sender)
            }
            Err(e) => {
                warn!(
                    "failed to decode wrapped Fancy message (type {type_id}): {e}"
                );
                msg
            }
        }
    }
}

// ---- Helpers -------------------------------------------------------

/// Transfer the `sender_session` from the `PluginData` envelope into
/// the decoded message's actor/sender field.
///
/// When a Fancy extension message is relayed via `PluginData`, the
/// Mumble server fills `PluginDataTransmission.sender_session` but
/// does not parse the inner payload. Fields like
/// `FancyTypingIndicator.actor` (normally set by the server on native
/// messages) will be `None`. This function patches them.
fn patch_sender_session(mut msg: ControlMessage, sender: Option<u32>) -> ControlMessage {
    match &mut msg {
        ControlMessage::FancyTypingIndicator(ti) if ti.actor.is_none() => {
            ti.actor = sender;
        }
        ControlMessage::FancyWatchSync(ws) if ws.actor.is_none() => {
            ws.actor = sender;
        }
        _ => {}
    }
    msg
}

/// Extract receiver session IDs from a Fancy extension message so the
/// legacy server knows whom to relay the `PluginData` to.
///
/// Returns an empty `Vec` for server-processed message types that have
/// no meaningful client-to-client relay target.
fn extract_receiver_sessions(msg: &ControlMessage, state: &ServerState) -> Vec<u32> {
    let own_session = state.own_session().unwrap_or(0);

    match msg {
        ControlMessage::WebRtcSignal(signal) => {
            let target = signal.target_session.unwrap_or(0);
            if target != 0 {
                vec![target]
            } else {
                channel_members_except_self(state, own_session)
            }
        }
        ControlMessage::PchatSenderKeyDistribution(skd) => {
            let channel_id = skd.channel_id.unwrap_or(0);
            state
                .users
                .values()
                .filter(|u| u.channel_id == channel_id && u.session != own_session)
                .map(|u| u.session)
                .collect()
        }
        ControlMessage::FancyTypingIndicator(_) => {
            channel_members_except_self(state, own_session)
        }
        ControlMessage::FancyWatchSync(_) => {
            channel_members_except_self(state, own_session)
        }
        _ => Vec::new(),
    }
}

/// All user sessions in our current channel, excluding ourselves.
fn channel_members_except_self(state: &ServerState, own_session: u32) -> Vec<u32> {
    let own_channel = state
        .users
        .get(&own_session)
        .map(|u| u.channel_id)
        .unwrap_or(0);

    state
        .users
        .values()
        .filter(|u| u.channel_id == own_channel && u.session != own_session)
        .map(|u| u.session)
        .collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    #![allow(deprecated, reason = "tests exercise the legacy PluginDataTransmission wire fields")]

    use super::*;
    use crate::proto::mumble_tcp;

    fn state_with_users() -> ServerState {
        let mut state = ServerState::new();
        state.apply_server_sync(&mumble_tcp::ServerSync {
            session: Some(1),
            ..Default::default()
        });
        // Own user in channel 0.
        state.apply_user_state(&mumble_tcp::UserState {
            session: Some(1),
            name: Some("self".into()),
            channel_id: Some(0),
            ..Default::default()
        });
        // Peer in channel 0.
        state.apply_user_state(&mumble_tcp::UserState {
            session: Some(2),
            name: Some("peer".into()),
            channel_id: Some(0),
            ..Default::default()
        });
        // Peer in channel 1 (different channel).
        state.apply_user_state(&mumble_tcp::UserState {
            session: Some(3),
            name: Some("other".into()),
            channel_id: Some(1),
            ..Default::default()
        });
        state
    }

    // ---- select_codec ------------------------------------------------

    #[test]
    fn select_codec_native_for_a_peer_on_our_epoch() {
        // Restored at M2c, when `crate::canon` gave the codec something true to
        // encode. It spent the interval asserting the opposite — deliberately,
        // because between the two commits this client announced an epoch whose
        // payloads it could not produce, and the honest answer was the relay.
        let codec = select_codec(None, Some(FANCY_PROTOCOL_EPOCH));
        assert!(format!("{codec:?}").contains("NativeCodec"));
    }

    #[test]
    fn a_version_alone_no_longer_buys_native_encoding() {
        // A Fancy server that never announces an epoch is on epoch 0, whatever
        // its product version says, and epoch 0 is not spoken any more.
        let new_version = fancy_utils::version::fancy_version_encode(9, 9, 9);
        let codec = select_codec(Some(new_version), None);
        assert!(format!("{codec:?}").contains("LegacyCodec"));
    }

    #[test]
    fn select_codec_legacy_when_no_version() {
        let codec = select_codec(None, None);
        assert!(format!("{codec:?}").contains("LegacyCodec"));
    }

    #[test]
    fn an_absent_epoch_is_the_one_that_existed_when_the_server_was_built() {
        // Silence means epoch 0 — the only numbering that existed before the
        // field did. It must not be read as "whatever we currently speak", or
        // a vanilla Mumble server would look like a peer the moment we moved
        // epochs, and we would send it natives it cannot route.
        assert!(!speaks_epoch(None));
        assert!(speaks_epoch(Some(FANCY_PROTOCOL_EPOCH)));
    }

    #[test]
    fn a_newer_epoch_drops_to_basic_features_however_new_the_server_is() {
        // The case this field exists for. The server is *newer* than us and
        // announces a full feature set, but its wire numbering is one we do not
        // speak — so every native we sent would land on nothing and vanish. A
        // plain Mumble client is the honest thing to be here.
        let future = fancy_utils::version::fancy_version_encode(9, 9, 9);
        let codec = select_codec(Some(future), Some(FANCY_PROTOCOL_EPOCH + 1));
        assert!(
            format!("{codec:?}").contains("LegacyCodec"),
            "an unknown epoch must not be answered with native encoding"
        );
        assert!(!speaks_epoch(Some(FANCY_PROTOCOL_EPOCH + 1)));
    }

    #[test]
    fn the_epoch_decides_and_the_version_does_not() {
        // The version says which features exist; the epoch says whether we
        // agree on what the numbers mean. Only the second one can decide how to
        // frame bytes, so a stale epoch loses however new the server is.
        let newer = fancy_utils::version::fancy_version_encode(9, 9, 9);
        let stale_epoch = select_codec(Some(newer), Some(FANCY_PROTOCOL_EPOCH - 1));
        assert!(format!("{stale_epoch:?}").contains("LegacyCodec"));

        // ...and a matching epoch wins with no version announced at all, which
        // is exactly what an epoch-1 server sends.
        let matching = select_codec(None, Some(FANCY_PROTOCOL_EPOCH));
        assert!(format!("{matching:?}").contains("NativeCodec"));
    }

    #[test]
    fn the_epoch_we_announce_is_the_one_we_encode() {
        // D1 was these two disagreeing: the announcement said epoch 1 while the
        // codec framed proto2 shapes under epoch-1 outer types. They are
        // asserted together, in one test, so that changing either alone fails
        // here rather than on somebody's wire.
        //
        // Asserted on the handshake `Version` itself, because this is a claim
        // made on the wire and nowhere else — a peer believes the field, not
        // our intentions about it.
        let version = crate::client::version_announcement(crate::client::MumbleVersion::default());
        assert_eq!(
            version.fancy_protocol,
            Some(FANCY_PROTOCOL_EPOCH),
            "the epoch we announce must be the one the codec encodes"
        );
        assert!(
            version.fancy_version.is_some(),
            "the product version stays: it says which features exist, and that \
             much is still true"
        );
    }

    // ---- NativeCodec -------------------------------------------------

    // The per-feature version constants that used to live here are gone with
    // the thing they fed: epoch 1 dropped the per-message `min_version` gate,
    // because both ends now ship together and a Fancy peer speaks all of it or
    // none of it (`PROTOCOL-COMPATIBILITY.md`, "What is dropped with epoch 0").

    #[test]
    fn native_codec_passthrough_standard_message() {
        let codec = NativeCodec;
        let state = ServerState::new();
        let ping = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(42),
            ..Default::default()
        });
        let encoded = codec.encode(ping.clone(), &state).unwrap();
        assert!(matches!(encoded, ControlMessage::Ping(_)));
    }

    #[test]
    fn native_codec_passthrough_fancy_message_when_the_canon_carries_it() {
        // Used to assert this of `WebRtcSignal`, which the canon does not carry
        // — so it now relays, and the passthrough claim moved to a message the
        // canon actually has: a reaction.
        let codec = NativeCodec;
        let state = ServerState::new();
        let reaction = ControlMessage::PchatReaction(mumble_tcp::PchatReaction {
            channel_id: Some(0),
            message_id: Some("m-1".into()),
            ..Default::default()
        });
        let encoded = codec.encode(reaction, &state).unwrap();
        assert!(matches!(encoded, ControlMessage::PchatReaction(_)));
    }

    #[test]
    fn a_peer_on_our_epoch_gets_the_canon_where_there_is_one_and_the_relay_elsewhere() {
        // This used to assert that *everything* went out untouched, on the
        // premise that "a peer on our epoch speaks all of it". That premise
        // died with partial canon coverage: an untranslated message passed
        // through is framed as a proto2 envelope under a canon outer type,
        // which the peer cannot read.
        let codec = NativeCodec;
        let state = state_with_users();

        // Carried by the canon: out natively.
        let typing = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
            channel_id: Some(0),
            actor: None,
        });
        assert!(matches!(
            codec.encode(typing, &state).unwrap(),
            ControlMessage::FancyTypingIndicator(_)
        ));

        // Not carried, and server-processed, so it cannot be relayed either:
        // dropped rather than sent somewhere it will be misread. The feature is
        // off until its canon lands, which is visible instead of silent.
        let server_processed = ControlMessage::PchatPin(mumble_tcp::PchatPin {
            channel_id: Some(0),
            ..Default::default()
        });
        assert!(codec.encode(server_processed, &state).is_none());
    }

    #[test]
    fn a_message_the_canon_cannot_carry_is_relayed_rather_than_framed_as_proto2() {
        // The way D1 comes back. `to_service_payload` still frames the proto2
        // envelopes under the canon's outer types, so a Fancy message that
        // `canon` does not translate must never reach it — an epoch-1 peer
        // would decode proto3 out of proto2 bytes at type 1008.
        //
        // Screen-share signalling is the case: no canon form (the SFU is
        // ICE-lite and the canon models a share, not a relayed blob), so it
        // goes through `PluginData`, which the peer relays.
        let codec = NativeCodec;
        let state = state_with_users();
        let signal = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            target_session: Some(2),
            signal_type: Some(4),
            payload: Some("candidate:...".into()),
            ..Default::default()
        });
        assert!(crate::canon::to_canon(&signal).is_none(), "premise");

        let encoded = codec.encode(signal, &state).expect("relayable");
        assert!(
            matches!(encoded, ControlMessage::PluginDataTransmission(_)),
            "an untranslated Fancy message must be relayed, not framed under a \
             canon outer type as proto2"
        );
    }

    #[test]
    fn a_message_the_canon_carries_goes_out_natively() {
        let codec = NativeCodec;
        let state = state_with_users();
        let typing = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
            channel_id: Some(0),
            actor: None,
        });
        let encoded = codec.encode(typing, &state).expect("native");
        assert!(matches!(encoded, ControlMessage::FancyTypingIndicator(_)));
    }

    #[test]
    fn native_codec_decode_passthrough() {
        let codec = NativeCodec;
        let msg = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(99),
            ..Default::default()
        });
        let decoded = codec.decode(msg);
        assert!(matches!(decoded, ControlMessage::Ping(_)));
    }

    #[test]
    fn native_codec_decode_unwraps_and_patches_sender() {
        let codec = NativeCodec;

        // actor is None in the inner payload (client never sets it).
        let original = mumble_tcp::FancyTypingIndicator {
            actor: None,
            channel_id: Some(0),
        };
        let payload = prost::Message::encode_to_vec(&original);
        let wrapped = ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: Some(2),
                receiver_sessions: vec![1],
                data: Some(payload),
                data_id: Some("fancy-native:131".into()),
            },
        );
        let decoded = codec.decode(wrapped);
        let ControlMessage::FancyTypingIndicator(ti) = decoded else {
            panic!("expected FancyTypingIndicator, got {decoded:?}");
        };
        assert_eq!(ti.actor, Some(2), "actor patched from sender_session");
        assert_eq!(ti.channel_id, Some(0));
    }

    // ---- LegacyCodec encode ------------------------------------------

    #[test]
    fn legacy_codec_passthrough_standard_message() {
        let codec = LegacyCodec;
        let state = ServerState::new();
        let ping = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(42),
            ..Default::default()
        });
        let result = codec.encode(ping, &state).unwrap();
        assert!(matches!(result, ControlMessage::Ping(_)));
    }

    #[test]
    fn legacy_codec_wraps_webrtc_signal_in_plugin_data() {
        let codec = LegacyCodec;
        let state = state_with_users();
        let signal = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            target_session: Some(2),
            signal_type: Some(0),
            payload: Some("sdp-offer".into()),
            ..Default::default()
        });

        let encoded = codec.encode(signal, &state).unwrap();
        let ControlMessage::PluginDataTransmission(pd) = &encoded else {
            panic!("expected PluginDataTransmission, got {encoded:?}");
        };

        assert_eq!(pd.data_id.as_deref(), Some("fancy-native:120"));
        assert_eq!(pd.receiver_sessions, vec![2]);
        assert!(pd.data.is_some());
    }

    #[test]
    fn legacy_codec_drops_server_only_fancy_message() {
        let codec = LegacyCodec;
        let state = state_with_users();
        let receipt = ControlMessage::FancyReadReceipt(mumble_tcp::FancyReadReceipt {
            channel_id: Some(0),
            last_read_message_id: Some("msg-1".into()),
            ..Default::default()
        });

        // No receiver sessions can be determined -> None.
        assert!(codec.encode(receipt, &state).is_none());
    }

    #[test]
    fn legacy_codec_wraps_sender_key_distribution() {
        let codec = LegacyCodec;
        let state = state_with_users();
        let skd = ControlMessage::PchatSenderKeyDistribution(
            mumble_tcp::PchatSenderKeyDistribution {
                channel_id: Some(0),
                sender_hash: None,
                distribution: Some(vec![1, 2, 3]),
            },
        );

        let encoded = codec.encode(skd, &state).unwrap();
        let ControlMessage::PluginDataTransmission(pd) = &encoded else {
            panic!("expected PluginDataTransmission");
        };

        assert_eq!(pd.data_id.as_deref(), Some("fancy-native:121"));
        assert_eq!(pd.receiver_sessions, vec![2]);
    }

    // ---- LegacyCodec decode ------------------------------------------

    #[test]
    fn legacy_codec_decode_passthrough() {
        let codec = LegacyCodec;

        // Standard message passes through.
        let ping = ControlMessage::Ping(mumble_tcp::Ping { timestamp: Some(42), ..Default::default() });
        assert!(matches!(codec.decode(ping), ControlMessage::Ping(_)));

        // Non-fancy PluginData passes through.
        let pd = ControlMessage::PluginDataTransmission(mumble_tcp::PluginDataTransmission {
            sender_session: Some(2),
            receiver_sessions: vec![1],
            data: Some(b"poll-json".to_vec()),
            data_id: Some("fancy-poll".into()),
        });
        assert!(matches!(codec.decode(pd), ControlMessage::PluginDataTransmission(_)));
    }

    #[test]
    fn legacy_codec_unwraps_fancy_native_plugin_data() {
        let codec = LegacyCodec;

        // Manually wrap a WebRtcSignal the way `encode` would.
        let original = mumble_tcp::WebRtcSignal {
            target_session: Some(2),
            signal_type: Some(0),
            payload: Some("offer".into()),
            ..Default::default()
        };
        let payload = prost::Message::encode_to_vec(&original);

        let wrapped = ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: Some(5),
                receiver_sessions: vec![1],
                data: Some(payload),
                data_id: Some("fancy-native:120".into()),
            },
        );

        let decoded = codec.decode(wrapped);
        let ControlMessage::WebRtcSignal(signal) = decoded else {
            panic!("expected WebRtcSignal, got {decoded:?}");
        };

        assert_eq!(signal.target_session, Some(2));
        assert_eq!(signal.payload.as_deref(), Some("offer"));
    }

    // ---- Round-trip ---------------------------------------------------

    #[test]
    fn legacy_codec_roundtrip_webrtc_signal() {
        let codec = LegacyCodec;
        let state = state_with_users();

        let original = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            target_session: Some(2),
            signal_type: Some(2),
            payload: Some(r#"{"sdp":"v=0..."}"#.into()),
            ..Default::default()
        });

        let encoded = codec.encode(original, &state).unwrap();
        assert!(matches!(
            encoded,
            ControlMessage::PluginDataTransmission(_)
        ));

        let decoded = codec.decode(encoded);
        let ControlMessage::WebRtcSignal(signal) = decoded else {
            panic!("expected WebRtcSignal after round-trip");
        };

        assert_eq!(signal.target_session, Some(2));
        assert_eq!(signal.signal_type, Some(2));
        assert_eq!(
            signal.payload.as_deref(),
            Some(r#"{"sdp":"v=0..."}"#)
        );
    }

    #[test]
    fn legacy_codec_roundtrip_sender_key_distribution() {
        let codec = LegacyCodec;
        let state = state_with_users();

        let original = ControlMessage::PchatSenderKeyDistribution(
            mumble_tcp::PchatSenderKeyDistribution {
                channel_id: Some(0),
                sender_hash: Some("abc123".into()),
                distribution: Some(vec![10, 20, 30]),
            },
        );

        let encoded = codec.encode(original, &state).unwrap();
        let decoded = codec.decode(encoded);

        let ControlMessage::PchatSenderKeyDistribution(skd) = decoded else {
            panic!("expected PchatSenderKeyDistribution after round-trip");
        };

        assert_eq!(skd.channel_id, Some(0));
        assert_eq!(skd.sender_hash.as_deref(), Some("abc123"));
        assert_eq!(skd.distribution, Some(vec![10, 20, 30]));
    }

    #[test]
    fn legacy_decode_ignores_invalid_or_missing_payload() {
        let codec = LegacyCodec;

        // Invalid type ID string.
        let msg = ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: Some(2),
                receiver_sessions: vec![1],
                data: Some(vec![0, 1, 2]),
                data_id: Some("fancy-native:not-a-number".into()),
            },
        );
        assert!(matches!(codec.decode(msg), ControlMessage::PluginDataTransmission(_)));

        // Missing payload.
        let msg = ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: Some(2),
                receiver_sessions: vec![1],
                data: None,
                data_id: Some("fancy-native:120".into()),
            },
        );
        assert!(matches!(codec.decode(msg), ControlMessage::PluginDataTransmission(_)));
    }

    // ---- NativeCodec fallback round-trip -----------------------------

    #[test]
    fn legacy_codec_roundtrip_typing_indicator_via_plugin_data() {
        let codec = LegacyCodec;
        let state = state_with_users();

        let original = ControlMessage::FancyTypingIndicator(
            mumble_tcp::FancyTypingIndicator {
                channel_id: Some(0),
                actor: None,
            },
        );

        let encoded = codec.encode(original, &state).unwrap();
        let ControlMessage::PluginDataTransmission(mut pd) = encoded else {
            panic!("expected PluginData fallback");
        };

        // Simulate: the server fills sender_session before relaying.
        pd.sender_session = Some(1);
        let relayed = ControlMessage::PluginDataTransmission(pd);

        let decoded = codec.decode(relayed);
        let ControlMessage::FancyTypingIndicator(ti) = decoded else {
            panic!("expected FancyTypingIndicator after round-trip, got {decoded:?}");
        };
        assert_eq!(ti.channel_id, Some(0));
        assert_eq!(ti.actor, Some(1), "actor should be patched from sender_session");
    }

    #[test]
    fn legacy_decode_patches_sender_session_into_typing_indicator() {
        let codec = LegacyCodec;
        let original = mumble_tcp::FancyTypingIndicator {
            actor: None,
            channel_id: Some(5),
        };
        let payload = prost::Message::encode_to_vec(&original);
        let wrapped = ControlMessage::PluginDataTransmission(
            mumble_tcp::PluginDataTransmission {
                sender_session: Some(7),
                receiver_sessions: vec![1],
                data: Some(payload),
                data_id: Some("fancy-native:131".into()),
            },
        );
        let decoded = codec.decode(wrapped);
        let ControlMessage::FancyTypingIndicator(ti) = decoded else {
            panic!("expected FancyTypingIndicator, got {decoded:?}");
        };
        assert_eq!(ti.actor, Some(7));
        assert_eq!(ti.channel_id, Some(5));
    }

    // ---- FancyWatchSync codec coverage ------------------------------

    #[test]
    fn legacy_codec_roundtrip_watch_sync_via_plugin_data() {
        use mumble_tcp::fancy_watch_sync::{Event, Start};

        let codec = LegacyCodec;
        let state = state_with_users();

        let original = ControlMessage::FancyWatchSync(mumble_tcp::FancyWatchSync {
            session_id: Some("sess-roundtrip".into()),
            actor: None,
            event: Some(Event::Start(Start {
                channel_id: Some(0),
                source_url: Some("https://example.com/v.mp4".into()),
                source_kind: Some(0),
                title: Some("Demo".into()),
                host_session: Some(1),
            })),
        });

        let encoded = codec.encode(original, &state).unwrap();
        let ControlMessage::PluginDataTransmission(mut pd) = encoded else {
            panic!("expected PluginData fallback for FancyWatchSync");
        };
        assert_eq!(pd.data_id.as_deref(), Some("fancy-native:134"));

        // Server fills in sender_session before relaying.
        pd.sender_session = Some(1);
        let decoded = codec.decode(ControlMessage::PluginDataTransmission(pd));
        let ControlMessage::FancyWatchSync(ws) = decoded else {
            panic!("expected FancyWatchSync after round-trip, got {decoded:?}");
        };
        assert_eq!(ws.session_id.as_deref(), Some("sess-roundtrip"));
        assert_eq!(ws.actor, Some(1), "actor should be patched from sender_session");
        assert!(matches!(ws.event, Some(Event::Start(_))));
    }

    #[test]
    fn watch_sync_takes_the_relay_until_its_canon_lands() {
        let codec = NativeCodec;
        let state = state_with_users();
        let msg = ControlMessage::FancyWatchSync(mumble_tcp::FancyWatchSync {
            session_id: Some("sess-pass".into()),
            actor: None,
            event: None,
        });
        // Watch-sync has no canon translation yet (its canon is a flat state
        // where this is a oneof of events, and `StateRequest` has no canon
        // kind), so it takes the relay — which is where it already worked.
        let encoded = codec.encode(msg, &state).unwrap();
        assert!(matches!(encoded, ControlMessage::PluginDataTransmission(_)));
    }
}
