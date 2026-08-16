//! Mumble TCP packet framing: encode and decode the `[type:u16][length:u32][payload]` wire format.

use bytes::{Buf, BufMut, BytesMut};
use prost::Message;
use tracing::debug;

use crate::error::{Error, Result};
use crate::message::{ControlMessage, TcpMessageType};
use crate::proto::mumble_tcp;

/// Maximum allowed payload size (8 MiB, generous upper bound).
const MAX_PAYLOAD_SIZE: u32 = 8 * 1024 * 1024;

/// Header size: 2 bytes type + 4 bytes length.
pub const HEADER_SIZE: usize = 6;

/// The resume sequence, when a connection has negotiated one.
pub const SEQ_SIZE: usize = 8;

/// A compressed batch of whole frames. Not a service - see Starling's
/// `types::COMPRESSED_BATCH`.
pub const COMPRESSED_BATCH: u16 = 1900;

/// The most one batch may expand to.
///
/// The expanded size is chosen by whoever sent the batch, so a few kilobytes
/// can claim to be gigabytes. Bounded for the same reason the frame length is,
/// and only a peer we asked can send one at all.
const MAX_BATCH_BYTES: usize = 16 * 1024 * 1024;

/// Encode a [`ControlMessage`] into a framed byte buffer ready for the wire.
///
/// Fancy messages go out under their service's outer type with the message
/// nested in that service's envelope (wire epoch 1); upstream messages stay
/// flat. The flat Fancy numbering still exists, but only inside a
/// `PluginDataTransmission` relay - see [`serialize_control_message`].
pub fn encode(msg: &ControlMessage) -> Result<Vec<u8>> {
    // The canon, or flat. There is no third framing: the proto2 envelopes that
    // used to sit between them are gone (M3), and with them the way an
    // untranslated Fancy message could be framed under a canon outer type in a
    // shape no peer reads.
    //
    // A Fancy message reaching here untranslated has already been turned into a
    // `PluginDataTransmission` by the codec above, which is an upstream type and
    // serialises flat.
    let (type_id, payload) = match crate::canon::to_canon(msg) {
        Some(framed) => framed,
        None if msg.is_fancy_extension() => {
            // A Fancy message with no canon form must have been turned into a
            // relay by the codec above (`NativeCodec`/`LegacyCodec`) before
            // reaching here. If one arrives raw, the only framing left is its
            // epoch-0 flat id - which lives in the burned 100-999 range and
            // routes nowhere on either kind of peer.
            //
            // Refused rather than framed. Emitting it would put a frame on the
            // wire that no peer can act on and nothing would report; this way
            // the caller that skipped the codec finds out.
            return Err(Error::InvalidState(format!(
                "Fancy message type {} has no canon form and was not relayed; \
                 framing it flat would use the burned 100-999 range",
                msg.type_id()
            )));
        }
        None => serialize_control_message(msg)?,
    };
    let len = payload.len() as u32;

    let mut buf = Vec::with_capacity(HEADER_SIZE + payload.len());
    buf.put_u16(type_id);
    buf.put_u32(len);
    buf.extend_from_slice(&payload);
    Ok(buf)
}

/// Try to decode one complete frame from `buf`.
///
/// Returns `Ok(Some(msg))` if a full frame was available (consumed from `buf`),
/// `Ok(None)` if more data is needed, or `Err` on protocol errors.
pub fn decode(buf: &mut BytesMut) -> Result<Option<ControlMessage>> {
    decode_with(buf, &mut Framing::default())
}

/// How this connection's frames are shaped, and how far it has got.
///
/// A frame carries a sequence number only once the peer has negotiated resume
/// and been acknowledged (`PROTOCOL-REDESIGN.md` §5, S2). Until then the layout
/// is exactly murmur's, which is what a stock client reads - so this defaults
/// to off and nothing changes for anyone who never asked.
#[derive(Debug, Default, Clone, Copy)]
pub struct Framing {
    /// Whether inbound frames carry `seq` between `len` and the payload.
    pub sequenced: bool,
    /// The highest sequence seen. What a reconnect resumes from.
    pub last_seq: u64,
    /// Set when a sequence arrived out of step with the last one.
    ///
    /// The server does not announce a failed replay: a gap in the numbers *is*
    /// the announcement, and it covers every cause rather than the one the
    /// server happened to know about. A client that sees this re-syncs.
    pub gap: bool,
}

/// [`decode`], threading the per-connection framing state.
pub fn decode_with(buf: &mut BytesMut, framing: &mut Framing) -> Result<Option<ControlMessage>> {
    if buf.len() < HEADER_SIZE {
        return Ok(None);
    }

    let msg_type = u16::from_be_bytes([buf[0], buf[1]]);
    let payload_len = u32::from_be_bytes([buf[2], buf[3], buf[4], buf[5]]);

    if payload_len > MAX_PAYLOAD_SIZE {
        return Err(Error::InvalidState(format!(
            "payload too large: {payload_len} bytes"
        )));
    }

    let total = HEADER_SIZE + payload_len as usize;
    if buf.len() < total {
        return Ok(None);
    }

    buf.advance(HEADER_SIZE);
    let mut payload = buf.split_to(payload_len as usize);

    // `len` covers the sequence as well as the payload, so the frame is already
    // whole; this only takes the eight bytes off the front of it.
    if framing.sequenced {
        if payload.len() < SEQ_SIZE {
            return Err(Error::InvalidState(
                "a sequenced frame shorter than its sequence".to_owned(),
            ));
        }
        let seq = u64::from_be_bytes([
            payload[0], payload[1], payload[2], payload[3], payload[4], payload[5], payload[6],
            payload[7],
        ]);
        payload.advance(SEQ_SIZE);
        // A replay re-sends frames under the numbers they were written with, so
        // a resumed stream legitimately repeats or steps forward - what it must
        // not do is skip, which means the ring could not reach back far enough.
        if seq > framing.last_seq + 1 && framing.last_seq != 0 {
            framing.gap = true;
        }
        framing.last_seq = framing.last_seq.max(seq);
    }

    // A compressed batch is unwrapped before anything is routed: what comes out
    // is ordinary frames, which the caller reads with this same function. It is
    // handled here rather than in the service table because it is a property of
    // the connection and not a destination on it.
    //
    // The frames are put back at the *front* of the buffer, so they are read
    // next and in order - appending would deliver them after whatever else had
    // already arrived, which reorders a stream whose ordering is the one thing
    // the gateway guarantees.
    if msg_type == COMPRESSED_BATCH {
        let expanded = zstd::stream::decode_all(payload.as_ref()).map_err(|_| {
            Error::InvalidState("undecodable compressed batch".to_owned())
        })?;
        if expanded.len() > MAX_BATCH_BYTES {
            return Err(Error::InvalidState(format!(
                "compressed batch expands to {} bytes",
                expanded.len()
            )));
        }
        let mut rest = std::mem::take(buf);
        buf.extend_from_slice(&expanded);
        buf.unsplit(std::mem::take(&mut rest));
        return decode_with(buf, framing);
    }

    // Every Fancy message on the epoch-1 wire arrives under a service outer
    // type, and the canon is the only thing that reads one.
    //
    // There is deliberately no second attempt. Until M3 this fell through to
    // the proto2 envelopes when the canon did not recognise a payload - which
    // meant a canon frame at a service the canon does not *cover* (server-config
    // at 1013, say) was decoded as proto2, and where the wire types happened to
    // coincide it produced a message that looked valid and was not. That is D1
    // inbound. Skipping is the only honest answer, and costs nothing: an
    // unreadable member of a service is exactly what the envelope design says
    // may be ignored.
    if msg_type >= crate::message::FANCY_SERVICE_TYPE_MIN {
        let decoded = crate::canon::from_canon(msg_type, &payload).unwrap_or_else(|e| {
            debug!(
                msg_type,
                len = payload.len(),
                error = %e,
                "undecodable canon payload; skipping the frame"
            );
            None
        });
        if decoded.is_none() {
            // A service this build does not translate, or an arm added by a
            // newer peer. The frame is consumed and skipped rather than fatal;
            // `recv` loops, so `None` just reads on.
            debug!(msg_type, len = payload.len(), "skipping unknown service message");
        }
        return Ok(decoded);
    }

    let msg = deserialize_control_message(msg_type, &payload)?;
    Ok(Some(msg))
}

// -- Serialization helpers ------------------------------------------

/// Serialize a message flat: its own type ID and a bare payload.
///
/// This is *not* the epoch-1 wire framing. It is what the `PluginData` relay
/// needs - it tags the tunnelled message with this ID and vanilla Mumble
/// forwards the blob untouched - so this function keeps the epoch-0 numbering
/// on purpose. [`encode`] is the one that frames for the wire.
#[allow(
    clippy::too_many_lines,
    reason = "one match arm per ControlMessage variant, mechanically; splitting it adds \
              indirection without reducing what a reader has to check"
)]
pub(crate) fn serialize_control_message(msg: &ControlMessage) -> Result<(u16, Vec<u8>)> {
    use ControlMessage::*;

    let type_id = msg.type_id();
    let payload = match msg {
        Version(m) => m.encode_to_vec(),
        Authenticate(m) => m.encode_to_vec(),
        Ping(m) => m.encode_to_vec(),
        Reject(m) => m.encode_to_vec(),
        ServerSync(m) => m.encode_to_vec(),
        ChannelRemove(m) => m.encode_to_vec(),
        ChannelState(m) => m.encode_to_vec(),
        UserRemove(m) => m.encode_to_vec(),
        UserState(m) => m.encode_to_vec(),
        BanList(m) => m.encode_to_vec(),
        TextMessage(m) => m.encode_to_vec(),
        PermissionDenied(m) => m.encode_to_vec(),
        Acl(m) => m.encode_to_vec(),
        QueryUsers(m) => m.encode_to_vec(),
        CryptSetup(m) => m.encode_to_vec(),
        ContextActionModify(m) => m.encode_to_vec(),
        ContextAction(m) => m.encode_to_vec(),
        UserList(m) => m.encode_to_vec(),
        VoiceTarget(m) => m.encode_to_vec(),
        PermissionQuery(m) => m.encode_to_vec(),
        CodecVersion(m) => m.encode_to_vec(),
        UserStats(m) => m.encode_to_vec(),
        RequestBlob(m) => m.encode_to_vec(),
        ServerConfig(m) => m.encode_to_vec(),
        SuggestConfig(m) => m.encode_to_vec(),
        PluginDataTransmission(m) => m.encode_to_vec(),
        PchatMessage(m) => m.encode_to_vec(),
        PchatFetch(m) => m.encode_to_vec(),
        PchatFetchResponse(m) => m.encode_to_vec(),
        PchatMessageDeliver(m) => m.encode_to_vec(),
        PchatKeyAnnounce(m) => m.encode_to_vec(),
        PchatKeyExchange(m) => m.encode_to_vec(),
        PchatKeyRequest(m) => m.encode_to_vec(),
        PchatAck(m) => m.encode_to_vec(),
        PchatEpochCountersig(m) => m.encode_to_vec(),
        PchatKeyHolderReport(m) => m.encode_to_vec(),
        PchatKeyHoldersQuery(m) => m.encode_to_vec(),
        PchatKeyHoldersList(m) => m.encode_to_vec(),
        PchatKeyChallenge(m) => m.encode_to_vec(),
        PchatKeyChallengeResponse(m) => m.encode_to_vec(),
        PchatKeyChallengeResult(m) => m.encode_to_vec(),
        PchatDeleteMessages(m) => m.encode_to_vec(),
        PchatOfflineQueueDrain(m) => m.encode_to_vec(),
        PchatReaction(m) => m.encode_to_vec(),
        PchatReactionDeliver(m) => m.encode_to_vec(),
        PchatReactionFetchResponse(m) => m.encode_to_vec(),
        WebRtcSignal(m) => m.encode_to_vec(),
        PchatSenderKeyDistribution(m) => m.encode_to_vec(),
        FancyPushRegister(m) => m.encode_to_vec(),
        FancyPushUpdate(m) => m.encode_to_vec(),
        FancyCustomReactionsConfig(m) => m.encode_to_vec(),
        FancySubscribePush(m) => m.encode_to_vec(),
        FancyReadReceipt(m) => m.encode_to_vec(),
        FancyReadReceiptDeliver(m) => m.encode_to_vec(),
        PchatPin(m) => m.encode_to_vec(),
        PchatPinDeliver(m) => m.encode_to_vec(),
        PchatPinFetchResponse(m) => m.encode_to_vec(),
        FancyTypingIndicator(m) => m.encode_to_vec(),
        FancyLinkPreviewRequest(m) => m.encode_to_vec(),
        FancyLinkPreviewResponse(m) => m.encode_to_vec(),
        FancyWatchSync(m) => m.encode_to_vec(),
        FancyDrawStroke(m) => m.encode_to_vec(),
        FancyOnboardingConfig(m) => m.encode_to_vec(),
        FancyOnboardingConfigUpdate(m) => m.encode_to_vec(),
        FancyOnboardingResponse(m) => m.encode_to_vec(),
        FancyOnboardingResponseQuery(m) => m.encode_to_vec(),
        FancyOnboardingResponseDeliver(m) => m.encode_to_vec(),
        FancyPoll(m) => m.encode_to_vec(),
        FancyPollVote(m) => m.encode_to_vec(),
        FancyPluginAdminListRequest(m) => m.encode_to_vec(),
        FancyPluginAdminList(m) => m.encode_to_vec(),
        FancyPluginAdminSetEnabled(m) => m.encode_to_vec(),
        FancyPluginAdminInstall(m) => m.encode_to_vec(),
        FancyPluginAdminUninstall(m) => m.encode_to_vec(),
        FancyPluginAdminAck(m) => m.encode_to_vec(),
        FancyServerSettings(m) => m.encode_to_vec(),
        FancyServerSettingsUpdate(m) => m.encode_to_vec(),
        FancyAccountSettings(m) => m.encode_to_vec(),
        FancyAccountSettingsUpdate(m) => m.encode_to_vec(),
        FancyAccountAck(m) => m.encode_to_vec(),
        FancyForumPost(m) => m.encode_to_vec(),
        FancyForumFetch(m) => m.encode_to_vec(),
        FancyForumFetchResponse(m) => m.encode_to_vec(),
        FancyForumDelete(m) => m.encode_to_vec(),
        FancyScheduledMessage(m) => m.encode_to_vec(),
        FancyScheduledMessageList(m) => m.encode_to_vec(),
        FancyScheduledMessageListResponse(m) => m.encode_to_vec(),
        FancyScheduledMessageCancel(m) => m.encode_to_vec(),
        FancyScheduledMessageAck(m) => m.encode_to_vec(),
        FancyAuditQuery(m) => m.encode_to_vec(),
        FancyAuditResponse(m) => m.encode_to_vec(),
        FancyAuditEvent(m) => m.encode_to_vec(),
        FancyAuditConfig(m) => m.encode_to_vec(),
        FancyAuditConfigUpdate(m) => m.encode_to_vec(),
        PluginMessage(m) => m.encode_to_vec(),
        PluginRegistry(m) => m.encode_to_vec(),
        UdpTunnel(data) => data.clone(),
    };

    Ok((type_id, payload))
}

#[allow(
    clippy::too_many_lines,
    reason = "one match arm per TcpMessageType variant, mechanically; splitting it adds \
              indirection without reducing what a reader has to check"
)]
pub(crate) fn deserialize_control_message(type_id: u16, payload: &[u8]) -> Result<ControlMessage> {
    let msg_type = TcpMessageType::try_from(type_id)?;
    use TcpMessageType::*;

    let msg = match msg_type {
        Version => ControlMessage::Version(mumble_tcp::Version::decode(payload)?),
        UdpTunnel => ControlMessage::UdpTunnel(payload.to_vec()),
        Authenticate => ControlMessage::Authenticate(mumble_tcp::Authenticate::decode(payload)?),
        Ping => ControlMessage::Ping(mumble_tcp::Ping::decode(payload)?),
        Reject => ControlMessage::Reject(mumble_tcp::Reject::decode(payload)?),
        ServerSync => ControlMessage::ServerSync(mumble_tcp::ServerSync::decode(payload)?),
        ChannelRemove => ControlMessage::ChannelRemove(mumble_tcp::ChannelRemove::decode(payload)?),
        ChannelState => ControlMessage::ChannelState(mumble_tcp::ChannelState::decode(payload)?),
        UserRemove => ControlMessage::UserRemove(mumble_tcp::UserRemove::decode(payload)?),
        UserState => ControlMessage::UserState(mumble_tcp::UserState::decode(payload)?),
        BanList => ControlMessage::BanList(mumble_tcp::BanList::decode(payload)?),
        TextMessage => ControlMessage::TextMessage(mumble_tcp::TextMessage::decode(payload)?),
        PermissionDenied => ControlMessage::PermissionDenied(mumble_tcp::PermissionDenied::decode(payload)?),
        Acl => ControlMessage::Acl(mumble_tcp::Acl::decode(payload)?),
        QueryUsers => ControlMessage::QueryUsers(mumble_tcp::QueryUsers::decode(payload)?),
        CryptSetup => ControlMessage::CryptSetup(mumble_tcp::CryptSetup::decode(payload)?),
        ContextActionModify => ControlMessage::ContextActionModify(mumble_tcp::ContextActionModify::decode(payload)?),
        ContextAction => ControlMessage::ContextAction(mumble_tcp::ContextAction::decode(payload)?),
        UserList => ControlMessage::UserList(mumble_tcp::UserList::decode(payload)?),
        VoiceTarget => ControlMessage::VoiceTarget(mumble_tcp::VoiceTarget::decode(payload)?),
        PermissionQuery => ControlMessage::PermissionQuery(mumble_tcp::PermissionQuery::decode(payload)?),
        CodecVersion => ControlMessage::CodecVersion(mumble_tcp::CodecVersion::decode(payload)?),
        UserStats => ControlMessage::UserStats(mumble_tcp::UserStats::decode(payload)?),
        RequestBlob => ControlMessage::RequestBlob(mumble_tcp::RequestBlob::decode(payload)?),
        ServerConfig => ControlMessage::ServerConfig(mumble_tcp::ServerConfig::decode(payload)?),
        SuggestConfig => ControlMessage::SuggestConfig(mumble_tcp::SuggestConfig::decode(payload)?),
        PluginDataTransmission => ControlMessage::PluginDataTransmission(mumble_tcp::PluginDataTransmission::decode(payload)?),
        PchatMessage => ControlMessage::PchatMessage(mumble_tcp::PchatMessage::decode(payload)?),
        PchatFetch => ControlMessage::PchatFetch(mumble_tcp::PchatFetch::decode(payload)?),
        PchatFetchResponse => ControlMessage::PchatFetchResponse(mumble_tcp::PchatFetchResponse::decode(payload)?),
        PchatMessageDeliver => ControlMessage::PchatMessageDeliver(mumble_tcp::PchatMessageDeliver::decode(payload)?),
        PchatKeyAnnounce => ControlMessage::PchatKeyAnnounce(mumble_tcp::PchatKeyAnnounce::decode(payload)?),
        PchatKeyExchange => ControlMessage::PchatKeyExchange(mumble_tcp::PchatKeyExchange::decode(payload)?),
        PchatKeyRequest => ControlMessage::PchatKeyRequest(mumble_tcp::PchatKeyRequest::decode(payload)?),
        PchatAck => ControlMessage::PchatAck(mumble_tcp::PchatAck::decode(payload)?),
        PchatEpochCountersig => ControlMessage::PchatEpochCountersig(mumble_tcp::PchatEpochCountersig::decode(payload)?),
        PchatKeyHolderReport => ControlMessage::PchatKeyHolderReport(mumble_tcp::PchatKeyHolderReport::decode(payload)?),
        PchatKeyHoldersQuery => ControlMessage::PchatKeyHoldersQuery(mumble_tcp::PchatKeyHoldersQuery::decode(payload)?),
        PchatKeyHoldersList => ControlMessage::PchatKeyHoldersList(mumble_tcp::PchatKeyHoldersList::decode(payload)?),
        PchatKeyChallenge => ControlMessage::PchatKeyChallenge(mumble_tcp::PchatKeyChallenge::decode(payload)?),
        PchatKeyChallengeResponse => ControlMessage::PchatKeyChallengeResponse(mumble_tcp::PchatKeyChallengeResponse::decode(payload)?),
        PchatKeyChallengeResult => ControlMessage::PchatKeyChallengeResult(mumble_tcp::PchatKeyChallengeResult::decode(payload)?),
        PchatDeleteMessages => ControlMessage::PchatDeleteMessages(mumble_tcp::PchatDeleteMessages::decode(payload)?),
        PchatOfflineQueueDrain => ControlMessage::PchatOfflineQueueDrain(mumble_tcp::PchatOfflineQueueDrain::decode(payload)?),
        PchatReaction => ControlMessage::PchatReaction(mumble_tcp::PchatReaction::decode(payload)?),
        PchatReactionDeliver => ControlMessage::PchatReactionDeliver(mumble_tcp::PchatReactionDeliver::decode(payload)?),
        PchatReactionFetchResponse => ControlMessage::PchatReactionFetchResponse(mumble_tcp::PchatReactionFetchResponse::decode(payload)?),
        WebRtcSignal => ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal::decode(payload)?),
        PchatSenderKeyDistribution => ControlMessage::PchatSenderKeyDistribution(mumble_tcp::PchatSenderKeyDistribution::decode(payload)?),
        FancyPushRegister => ControlMessage::FancyPushRegister(mumble_tcp::FancyPushRegister::decode(payload)?),
        FancyPushUpdate => ControlMessage::FancyPushUpdate(mumble_tcp::FancyPushUpdate::decode(payload)?),
        FancyCustomReactionsConfig => ControlMessage::FancyCustomReactionsConfig(mumble_tcp::FancyCustomReactionsConfig::decode(payload)?),
        FancySubscribePush => ControlMessage::FancySubscribePush(mumble_tcp::FancySubscribePush::decode(payload)?),
        FancyReadReceipt => ControlMessage::FancyReadReceipt(mumble_tcp::FancyReadReceipt::decode(payload)?),
        FancyReadReceiptDeliver => ControlMessage::FancyReadReceiptDeliver(mumble_tcp::FancyReadReceiptDeliver::decode(payload)?),
        PchatPin => ControlMessage::PchatPin(mumble_tcp::PchatPin::decode(payload)?),
        PchatPinDeliver => ControlMessage::PchatPinDeliver(mumble_tcp::PchatPinDeliver::decode(payload)?),
        PchatPinFetchResponse => ControlMessage::PchatPinFetchResponse(mumble_tcp::PchatPinFetchResponse::decode(payload)?),
        FancyTypingIndicator => ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator::decode(payload)?),
        FancyLinkPreviewRequest => ControlMessage::FancyLinkPreviewRequest(mumble_tcp::FancyLinkPreviewRequest::decode(payload)?),
        FancyLinkPreviewResponse => ControlMessage::FancyLinkPreviewResponse(mumble_tcp::FancyLinkPreviewResponse::decode(payload)?),
        FancyWatchSync => ControlMessage::FancyWatchSync(mumble_tcp::FancyWatchSync::decode(payload)?),
        FancyDrawStroke => ControlMessage::FancyDrawStroke(mumble_tcp::FancyDrawStroke::decode(payload)?),
        FancyOnboardingConfig => ControlMessage::FancyOnboardingConfig(mumble_tcp::FancyOnboardingConfig::decode(payload)?),
        FancyOnboardingConfigUpdate => ControlMessage::FancyOnboardingConfigUpdate(mumble_tcp::FancyOnboardingConfigUpdate::decode(payload)?),
        FancyOnboardingResponse => ControlMessage::FancyOnboardingResponse(mumble_tcp::FancyOnboardingResponse::decode(payload)?),
        FancyOnboardingResponseQuery => ControlMessage::FancyOnboardingResponseQuery(mumble_tcp::FancyOnboardingResponseQuery::decode(payload)?),
        FancyOnboardingResponseDeliver => ControlMessage::FancyOnboardingResponseDeliver(mumble_tcp::FancyOnboardingResponseDeliver::decode(payload)?),
        FancyPoll => ControlMessage::FancyPoll(mumble_tcp::FancyPoll::decode(payload)?),
        FancyPollVote => ControlMessage::FancyPollVote(mumble_tcp::FancyPollVote::decode(payload)?),
        FancyPluginAdminListRequest => ControlMessage::FancyPluginAdminListRequest(mumble_tcp::FancyPluginAdminListRequest::decode(payload)?),
        FancyPluginAdminList => ControlMessage::FancyPluginAdminList(mumble_tcp::FancyPluginAdminList::decode(payload)?),
        FancyPluginAdminSetEnabled => ControlMessage::FancyPluginAdminSetEnabled(mumble_tcp::FancyPluginAdminSetEnabled::decode(payload)?),
        FancyPluginAdminInstall => ControlMessage::FancyPluginAdminInstall(mumble_tcp::FancyPluginAdminInstall::decode(payload)?),
        FancyPluginAdminUninstall => ControlMessage::FancyPluginAdminUninstall(mumble_tcp::FancyPluginAdminUninstall::decode(payload)?),
        FancyPluginAdminAck => ControlMessage::FancyPluginAdminAck(mumble_tcp::FancyPluginAdminAck::decode(payload)?),
        FancyServerSettings => ControlMessage::FancyServerSettings(mumble_tcp::FancyServerSettings::decode(payload)?),
        FancyServerSettingsUpdate => ControlMessage::FancyServerSettingsUpdate(mumble_tcp::FancyServerSettingsUpdate::decode(payload)?),
        FancyAccountSettings => ControlMessage::FancyAccountSettings(mumble_tcp::FancyAccountSettings::decode(payload)?),
        FancyAccountSettingsUpdate => ControlMessage::FancyAccountSettingsUpdate(mumble_tcp::FancyAccountSettingsUpdate::decode(payload)?),
        FancyAccountAck => ControlMessage::FancyAccountAck(mumble_tcp::FancyAccountAck::decode(payload)?),
        FancyForumPost => ControlMessage::FancyForumPost(mumble_tcp::FancyForumPost::decode(payload)?),
        FancyForumFetch => ControlMessage::FancyForumFetch(mumble_tcp::FancyForumFetch::decode(payload)?),
        FancyForumFetchResponse => ControlMessage::FancyForumFetchResponse(mumble_tcp::FancyForumFetchResponse::decode(payload)?),
        FancyForumDelete => ControlMessage::FancyForumDelete(mumble_tcp::FancyForumDelete::decode(payload)?),
        FancyScheduledMessage => ControlMessage::FancyScheduledMessage(mumble_tcp::FancyScheduledMessage::decode(payload)?),
        FancyScheduledMessageList => ControlMessage::FancyScheduledMessageList(mumble_tcp::FancyScheduledMessageList::decode(payload)?),
        FancyScheduledMessageListResponse => ControlMessage::FancyScheduledMessageListResponse(mumble_tcp::FancyScheduledMessageListResponse::decode(payload)?),
        FancyScheduledMessageCancel => ControlMessage::FancyScheduledMessageCancel(mumble_tcp::FancyScheduledMessageCancel::decode(payload)?),
        FancyScheduledMessageAck => ControlMessage::FancyScheduledMessageAck(mumble_tcp::FancyScheduledMessageAck::decode(payload)?),
        FancyAuditQuery => ControlMessage::FancyAuditQuery(mumble_tcp::FancyAuditQuery::decode(payload)?),
        FancyAuditResponse => ControlMessage::FancyAuditResponse(mumble_tcp::FancyAuditResponse::decode(payload)?),
        FancyAuditEvent => ControlMessage::FancyAuditEvent(mumble_tcp::FancyAuditEvent::decode(payload)?),
        FancyAuditConfig => ControlMessage::FancyAuditConfig(mumble_tcp::FancyAuditConfig::decode(payload)?),
        FancyAuditConfigUpdate => ControlMessage::FancyAuditConfigUpdate(mumble_tcp::FancyAuditConfigUpdate::decode(payload)?),
        PluginMessage => ControlMessage::PluginMessage(mumble_tcp::PluginMessage::decode(payload)?),
        PluginRegistry => ControlMessage::PluginRegistry(mumble_tcp::PluginRegistry::decode(payload)?),
    };
    Ok(msg)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    #![allow(deprecated, reason = "tests exercise the legacy PluginDataTransmission wire fields")]
    use super::*;

    /// Build a sequenced frame exactly as the gateway's `codec::header` does:
    /// `type ‖ len ‖ seq ‖ payload`, with `len` covering the sequence too.
    ///
    /// Written out by hand rather than shared, because the two ends encode this
    /// independently - a helper both sides imported would agree with itself
    /// while disagreeing with the wire.
    fn sequenced_frame(type_id: u16, seq: u64, payload: &[u8]) -> BytesMut {
        let mut buf = BytesMut::new();
        buf.put_u16(type_id);
        buf.put_u32((payload.len() + SEQ_SIZE) as u32);
        buf.put_u64(seq);
        buf.extend_from_slice(payload);
        buf
    }

    #[test]
    fn a_compressed_batch_yields_every_frame_it_held_in_order() {
        // Built the way the gateway builds one - whole frames concatenated and
        // zstd'd - rather than through a shared helper, because the two ends
        // implement this independently and a helper would agree with itself.
        let first = encode(&ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(1),
            ..Default::default()
        }))
        .expect("encodes");
        let second = encode(&ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(2),
            ..Default::default()
        }))
        .expect("encodes");

        let mut joined = first.clone();
        joined.extend_from_slice(&second);
        let compressed = zstd::stream::encode_all(joined.as_slice(), 1).expect("compresses");

        let mut buf = BytesMut::new();
        buf.put_u16(COMPRESSED_BATCH);
        buf.put_u32(compressed.len() as u32);
        buf.extend_from_slice(&compressed);
        // Something already behind the batch, to prove ordering is preserved.
        let third = encode(&ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(3),
            ..Default::default()
        }))
        .expect("encodes");
        buf.extend_from_slice(&third);

        let mut framing = Framing::default();
        let mut seen = Vec::new();
        while let Some(msg) = decode_with(&mut buf, &mut framing).expect("decodes") {
            match msg {
                ControlMessage::Ping(ping) => seen.push(ping.timestamp.unwrap_or_default()),
                other => panic!("unexpected {other:?}"),
            }
        }
        assert_eq!(
            seen,
            vec![1, 2, 3],
            "a batch must deliver its frames in order and before what followed it"
        );
    }

    #[test]
    fn a_batch_that_is_not_zstd_is_refused_rather_than_guessed_at() {
        let mut buf = BytesMut::new();
        buf.put_u16(COMPRESSED_BATCH);
        buf.put_u32(4);
        buf.extend_from_slice(b"junk");
        assert!(decode_with(&mut buf, &mut Framing::default()).is_err());
    }

    #[test]
    fn a_sequenced_frame_yields_its_message_and_its_number() {
        let ping = mumble_tcp::Ping {
            timestamp: Some(42),
            ..Default::default()
        };
        let mut buf = sequenced_frame(3, 900, &Message::encode_to_vec(&ping));
        let mut framing = Framing {
            sequenced: true,
            ..Framing::default()
        };

        let decoded = decode_with(&mut buf, &mut framing)
            .expect("decodes")
            .expect("complete");
        assert!(matches!(decoded, ControlMessage::Ping(_)));
        assert_eq!(framing.last_seq, 900, "the number is what a resume asks from");
        assert!(!framing.gap);
        assert!(buf.is_empty(), "the whole frame was consumed");
    }

    #[test]
    fn a_skipped_sequence_is_noticed() {
        // The server does not announce a replay it could not satisfy - the gap
        // in the numbers is the announcement, and it covers every cause rather
        // than the one the server happened to know about.
        let mut framing = Framing {
            sequenced: true,
            last_seq: 10,
            ..Framing::default()
        };
        let ping = Message::encode_to_vec(&mumble_tcp::Ping::default());

        let mut next = sequenced_frame(3, 11, &ping);
        let _ = decode_with(&mut next, &mut framing).expect("decodes");
        assert!(!framing.gap, "the very next number is not a gap");

        let mut jumped = sequenced_frame(3, 47, &ping);
        let _ = decode_with(&mut jumped, &mut framing).expect("decodes");
        assert!(framing.gap, "a skip means the ring could not reach back");
    }

    #[test]
    fn a_replayed_frame_is_not_mistaken_for_a_gap() {
        // A replay re-sends frames under the numbers they were written with, so
        // a resumed stream repeats. Treating a repeat as a gap would make every
        // successful resume look like a failed one.
        let mut framing = Framing {
            sequenced: true,
            last_seq: 20,
            ..Framing::default()
        };
        let ping = Message::encode_to_vec(&mumble_tcp::Ping::default());
        let mut replayed = sequenced_frame(3, 15, &ping);
        let _ = decode_with(&mut replayed, &mut framing).expect("decodes");
        assert!(!framing.gap);
        assert_eq!(framing.last_seq, 20, "a replay does not rewind the mark");
    }

    #[test]
    fn an_unsequenced_connection_reads_exactly_what_murmur_sends() {
        // The compatibility half: nothing changes for a peer that never asked,
        // and a stock Mumble client never asks.
        let msg = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(7),
            ..Default::default()
        });
        let encoded = encode(&msg).expect("encodes");
        let mut buf = BytesMut::from(&encoded[..]);
        let mut framing = Framing::default();
        let decoded = decode_with(&mut buf, &mut framing)
            .expect("decodes")
            .expect("complete");
        assert!(matches!(decoded, ControlMessage::Ping(_)));
        assert_eq!(framing.last_seq, 0);
    }

    // These replaced six tests that each asserted a pchat key message was framed
    // under 1006. That framing came from the proto2 envelope mapping M3 deleted,
    // and those messages have no canon form: the canon's key ladder is
    // announce/request/deliver/holder, and the challenge trio was dropped from
    // the design entirely (`PROTOCOL-REDESIGN.md` §6).

    /// Every Fancy type this build has no canon form for.
    ///
    /// Each had a `roundtrip_*` test asserting it survived `encode`/`decode` -
    /// true when the proto2 envelopes framed them under a service outer type,
    /// and meaningless now that M3 deleted those. They reach a peer through the
    /// `PluginData` relay instead, which `fancy_codec`'s round-trip tests cover;
    /// what matters here is that the wire codec refuses to invent a framing.
    fn untranslated_samples() -> Vec<ControlMessage> {
        vec![
            ControlMessage::PchatKeyChallenge(mumble_tcp::PchatKeyChallenge {
                channel_id: Some(1),
                challenge: Some(vec![0; 32]),
            }),
            ControlMessage::PchatAck(mumble_tcp::PchatAck {
                channel_id: Some(1),
                ..Default::default()
            }),
            ControlMessage::FancyOnboardingConfig(mumble_tcp::FancyOnboardingConfig {
                version: Some(1),
                ..Default::default()
            }),
            // Untranslated *today*, and here purely for that property - not a
            // claim that it should stay so.
            ControlMessage::FancyWatchSync(mumble_tcp::FancyWatchSync {
                session_id: Some("sess-1".into()),
                ..Default::default()
            }),
        ]
    }

    #[test]
    fn nothing_untranslated_is_framed_in_the_burned_range() {
        // The burned 100-999 outer types route nowhere on any peer: an epoch-1
        // server has no handler, and a stock Mumble client ignores them. Framing
        // one is strictly worse than refusing, because it looks like a send.
        for msg in untranslated_samples() {
            assert!(
                crate::canon::to_canon(&msg).is_none(),
                "sample must have no canon form"
            );
            assert!(
                encode(&msg).is_err(),
                "type {} must be refused, not framed flat",
                msg.type_id()
            );
        }
    }

    #[test]
    fn a_key_message_with_no_canon_form_is_refused_rather_than_framed_flat() {
        // Refused because the only framing left would be its epoch-0 flat id,
        // which is in the burned 100-999 range and routes nowhere on any peer.
        // These reach the wire through the relay instead, which the codec above
        // arranges - so a raw one here means somebody skipped it.
        let msg = ControlMessage::PchatKeyChallenge(mumble_tcp::PchatKeyChallenge {
            channel_id: Some(1),
            challenge: Some(vec![0; 32]),
        });
        assert!(
            encode(&msg).is_err(),
            "framing a Fancy message in the burned range must fail loudly"
        );
    }

    #[test]
    fn roundtrip_ping() -> Result<()> {
        let ping = mumble_tcp::Ping {
            timestamp: Some(42),
            ..Default::default()
        };
        let msg = ControlMessage::Ping(ping);
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?
            .ok_or(Error::InvalidState(
                "expected complete frame".into(),
            ))?;

        match decoded {
            ControlMessage::Ping(p) => assert_eq!(p.timestamp, Some(42)),
            other => panic!("unexpected message: {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn partial_frame_returns_none() -> Result<()> {
        let mut buf = BytesMut::from(&[0u8; 4][..]);
        assert!(decode(&mut buf)?.is_none());
        Ok(())
    }

    #[test]
    fn roundtrip_version() -> Result<()> {
        let version = mumble_tcp::Version {
            version_v2: Some(0x0001_0005_0000_0000),
            release: Some("Test 1.5.0".into()),
            os: Some("Windows".into()),
            os_version: Some("10".into()),
            ..Default::default()
        };
        let msg = ControlMessage::Version(version);
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::Version(v) => {
                assert_eq!(v.release.as_deref(), Some("Test 1.5.0"));
                assert_eq!(v.os.as_deref(), Some("Windows"));
            }
            other => panic!("expected Version, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_text_message() -> Result<()> {
        let msg = ControlMessage::TextMessage(mumble_tcp::TextMessage {
            message: "Hello, world!".into(),
            channel_id: vec![0],
            ..Default::default()
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::TextMessage(tm) => {
                assert_eq!(tm.message, "Hello, world!");
                assert_eq!(tm.channel_id, vec![0]);
            }
            other => panic!("expected TextMessage, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_user_state() -> Result<()> {
        let msg = ControlMessage::UserState(mumble_tcp::UserState {
            session: Some(42),
            name: Some("TestUser".into()),
            channel_id: Some(0),
            self_mute: Some(true),
            ..Default::default()
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::UserState(us) => {
                assert_eq!(us.session, Some(42));
                assert_eq!(us.name.as_deref(), Some("TestUser"));
                assert_eq!(us.self_mute, Some(true));
            }
            other => panic!("expected UserState, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_server_sync() -> Result<()> {
        let msg = ControlMessage::ServerSync(mumble_tcp::ServerSync {
            session: Some(7),
            max_bandwidth: Some(72000),
            welcome_text: Some("Welcome!".into()),
            ..Default::default()
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::ServerSync(ss) => {
                assert_eq!(ss.session, Some(7));
                assert_eq!(ss.max_bandwidth, Some(72000));
                assert_eq!(ss.welcome_text.as_deref(), Some("Welcome!"));
            }
            other => panic!("expected ServerSync, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_channel_state() -> Result<()> {
        let msg = ControlMessage::ChannelState(mumble_tcp::ChannelState {
            channel_id: Some(1),
            name: Some("Lobby".into()),
            parent: Some(0),
            temporary: Some(true),
            ..Default::default()
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::ChannelState(cs) => {
                assert_eq!(cs.channel_id, Some(1));
                assert_eq!(cs.name.as_deref(), Some("Lobby"));
                assert_eq!(cs.parent, Some(0));
                assert!(cs.temporary.unwrap());
            }
            other => panic!("expected ChannelState, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_udp_tunnel() -> Result<()> {
        let data = vec![0xDE, 0xAD, 0xBE, 0xEF];
        let msg = ControlMessage::UdpTunnel(data.clone());
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::UdpTunnel(d) => assert_eq!(d, data),
            other => panic!("expected UdpTunnel, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_reject() -> Result<()> {
        let msg = ControlMessage::Reject(mumble_tcp::Reject {
            r#type: Some(mumble_tcp::reject::RejectType::WrongUserPw as i32),
            reason: Some("Bad password".into()),
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::Reject(r) => {
                assert_eq!(
                    r.r#type,
                    Some(mumble_tcp::reject::RejectType::WrongUserPw as i32)
                );
                assert_eq!(r.reason.as_deref(), Some("Bad password"));
            }
            other => panic!("expected Reject, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn empty_buffer_returns_none() -> Result<()> {
        let mut buf = BytesMut::new();
        assert!(decode(&mut buf)?.is_none());
        Ok(())
    }

    #[test]
    fn header_only_no_payload_returns_none() -> Result<()> {
        // Header says payload is 100 bytes but buffer only has the header
        let mut buf = BytesMut::new();
        buf.put_u16(3); // Ping type
        buf.put_u32(100); // payload_len = 100
        // No payload bytes
        assert!(decode(&mut buf)?.is_none());
        Ok(())
    }

    #[test]
    fn payload_too_large_returns_error() {
        let mut buf = BytesMut::new();
        buf.put_u16(3); // Ping type
        buf.put_u32(MAX_PAYLOAD_SIZE + 1); // exceeds limit
        let result = decode(&mut buf);
        assert!(result.is_err());
    }

    #[test]
    fn multiple_frames_in_buffer() -> Result<()> {
        let msg1 = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(1),
            ..Default::default()
        });
        let msg2 = ControlMessage::Ping(mumble_tcp::Ping {
            timestamp: Some(2),
            ..Default::default()
        });

        let enc1 = encode(&msg1)?;
        let enc2 = encode(&msg2)?;

        let mut buf = BytesMut::new();
        buf.extend_from_slice(&enc1);
        buf.extend_from_slice(&enc2);

        let decoded1 = decode(&mut buf)?.unwrap();
        let decoded2 = decode(&mut buf)?.unwrap();
        assert!(decode(&mut buf)?.is_none()); // no more

        match decoded1 {
            ControlMessage::Ping(p) => assert_eq!(p.timestamp, Some(1)),
            _ => panic!("expected Ping"),
        }
        match decoded2 {
            ControlMessage::Ping(p) => assert_eq!(p.timestamp, Some(2)),
            _ => panic!("expected Ping"),
        }
        Ok(())
    }

    #[test]
    fn encode_header_format() -> Result<()> {
        let msg = ControlMessage::Ping(mumble_tcp::Ping::default());
        let encoded = encode(&msg)?;

        // First 2 bytes = type ID (Ping = 3)
        assert_eq!(encoded[0], 0);
        assert_eq!(encoded[1], 3);

        // Next 4 bytes = payload length
        let payload_len =
            u32::from_be_bytes([encoded[2], encoded[3], encoded[4], encoded[5]]);
        assert_eq!(payload_len as usize, encoded.len() - HEADER_SIZE);
        Ok(())
    }

    #[test]
    fn roundtrip_server_config() -> Result<()> {
        let msg = ControlMessage::ServerConfig(mumble_tcp::ServerConfig {
            max_bandwidth: Some(128000),
            message_length: Some(5000),
            image_message_length: Some(131072),
            allow_html: Some(true),
            ..Default::default()
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();
        match decoded {
            ControlMessage::ServerConfig(sc) => {
                assert_eq!(sc.max_bandwidth, Some(128000));
                assert_eq!(sc.image_message_length, Some(131072));
            }
            other => panic!("expected ServerConfig, got {other:?}"),
        }
        Ok(())
    }

    // -- PluginDataTransmission codec tests ------------------------

    #[test]
    fn roundtrip_plugin_data_transmission() -> Result<()> {
        let msg = ControlMessage::PluginDataTransmission(mumble_tcp::PluginDataTransmission {
            sender_session: Some(42),
            receiver_sessions: vec![10, 20, 30],
            data: Some(b"hello plugin".to_vec()),
            data_id: Some("fancy-poll".into()),
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::PluginDataTransmission(pd) => {
                assert_eq!(pd.sender_session, Some(42));
                assert_eq!(pd.receiver_sessions, vec![10, 20, 30]);
                assert_eq!(pd.data.as_deref(), Some(b"hello plugin".as_slice()));
                assert_eq!(pd.data_id.as_deref(), Some("fancy-poll"));
            }
            other => panic!("expected PluginDataTransmission, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_plugin_data_empty_receivers() -> Result<()> {
        let msg = ControlMessage::PluginDataTransmission(mumble_tcp::PluginDataTransmission {
            sender_session: None,
            receiver_sessions: vec![],
            data: Some(b"{}".to_vec()),
            data_id: Some("fancy-poll".into()),
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::PluginDataTransmission(pd) => {
                assert!(pd.sender_session.is_none());
                assert!(pd.receiver_sessions.is_empty());
            }
            other => panic!("expected PluginDataTransmission, got {other:?}"),
        }
        Ok(())
    }

    #[test]
    fn roundtrip_plugin_data_large_json_payload() -> Result<()> {
        let json = r#"{"type":"poll","id":"550e8400-e29b-41d4-a716-446655440000","question":"What is your favourite language?","options":["Rust","TypeScript","Python","Go"],"multiple":false,"creator":42,"creatorName":"Alice","createdAt":"2025-01-01T00:00:00Z"}"#;
        let msg = ControlMessage::PluginDataTransmission(mumble_tcp::PluginDataTransmission {
            sender_session: Some(42),
            receiver_sessions: vec![10],
            data: Some(json.as_bytes().to_vec()),
            data_id: Some("fancy-poll".into()),
        });
        let encoded = encode(&msg)?;
        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::PluginDataTransmission(pd) => {
                let payload = std::str::from_utf8(pd.data.as_deref().unwrap()).unwrap();
                assert_eq!(payload, json);
            }
            other => panic!("expected PluginDataTransmission, got {other:?}"),
        }
        Ok(())
    }

    // -- PchatKeyHolder* codec tests ----------------------------------

    // -- PchatKeyChallenge* codec tests -------------------------------

    #[test]
    fn roundtrip_fancy_typing_indicator() -> Result<()> {
        let msg = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
            actor: Some(7),
            channel_id: Some(42),
        });
        let encoded = encode(&msg)?;

        let type_id = u16::from_be_bytes([encoded[0], encoded[1]]);
        assert_eq!(type_id, 1015, "FancyTypingIndicator is framed under the social service (1015)");

        let mut buf = BytesMut::from(&encoded[..]);
        let decoded = decode(&mut buf)?.unwrap();

        match decoded {
            ControlMessage::FancyTypingIndicator(m) => {
                assert_eq!(m.actor, Some(7));
                assert_eq!(m.channel_id, Some(42));
            }
            other => panic!("expected FancyTypingIndicator, got {other:?}"),
        }
        Ok(())
    }
}
