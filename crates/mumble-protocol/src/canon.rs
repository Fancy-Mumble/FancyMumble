//! Translation between this client's message vocabulary and the epoch-1 canon.
//!
//! [`ControlMessage`] is the client's own language and stays that way: the app
//! above the codec is built on it, and making the wire format reach up into the
//! UI is how a protocol migration turns into a rewrite. So the boundary is
//! here, and it is the only place that knows both shapes.
//!
//! # Why this is not a whole-protocol mapping
//!
//! Only the services whose canon can carry the feature are translated. The rest
//! return `None` and fall back to the `PluginDataTransmission` relay, which is
//! epoch-independent and works through any Mumble server — so those features
//! keep working rather than being silently truncated. The rule is the one
//! `PROTOCOL-REDESIGN.md` M2b arrived at the hard way: **a message is only
//! translated when nothing a receiver needs is lost on the way.**
//!
//! Not translated today, and why:
//!
//! * **screenshare** — the canon models a share (`share_id`, explicit
//!   offer/answer/start/stop) where `WebRtcSignal` is one relayed blob, and it
//!   has no home for `ICE_CANDIDATE` at all *by design* (the SFU is ICE-lite;
//!   never trickle through the control plane). Mapping one onto the other is a
//!   redesign of the signalling, not a translation.
//! * **link-preview, userdata, plugins admin** — the canon does not cover these
//!   yet, deliberately: their services do not implement them, and designing a
//!   wire ahead of the code is what produced the gaps in the first place.

use prost::Message as _;

use crate::error::Result;
use crate::message::ControlMessage;
use crate::proto::fancy;
use crate::proto::mumble_tcp;

/// Outer type for social: reactions, typing, polls, drawing.
const SOCIAL: u16 = 1015;
/// Outer type for persistent chat.
const PCHAT: u16 = 1006;
/// Outer type for push notifications.
const PUSH: u16 = 1011;
/// Outer type for server-fetched link previews.
const LINK_PREVIEW: u16 = 1016;

/// Frame `msg` as the canon, or `None` when it has no faithful canon form.
///
/// `None` is not a failure: it means the caller should use the relay path. See
/// the module docs for which messages that covers and why.
#[must_use]
pub fn to_canon(msg: &ControlMessage) -> Option<(u16, Vec<u8>)> {
    use fancy::social::social_envelope::Body as Social;

    let body = match msg {
        ControlMessage::FancyTypingIndicator(typing) => Social::Typing(fancy::social::Typing {
            channel: typing.channel_id.unwrap_or_default(),
            // Carried rather than blanked. The server overwrites every actor
            // field on relay, so this changes nothing on the wire — but keeping
            // it makes the translation lossless, and a translation that drops
            // what it could have kept is one nobody can reason about.
            actor: typing.actor.unwrap_or_default(),
            // Epoch 0 had no way to say "stopped typing" — the indicator simply
            // expired. Sending `true` keeps that behaviour rather than inventing
            // a stop the client never sends.
            typing: true,
        }),
        ControlMessage::PchatReaction(reaction) => Social::Reaction(fancy::social::Reaction {
            channel: reaction.channel_id.unwrap_or_default(),
            message_id: reaction.message_id.clone().unwrap_or_default(),
            actor: 0,
            // `REACTION_REMOVE` is 1; anything else is an add.
            remove: reaction.action == Some(1),
            emoji: emoji_to_canon(reaction.emoji.as_ref()),
        }),
        ControlMessage::FancyPoll(poll) => Social::Poll(fancy::social::Poll {
            poll_id: poll.poll_id.clone().unwrap_or_default(),
            channel: poll.channel_id.unwrap_or_default(),
            question: poll.question.clone().unwrap_or_default(),
            options: poll.options.clone(),
            multiple: poll.multiple.unwrap_or_default(),
            // Epoch 0 polls never closed on their own.
            closes_at_ms: 0,
            creator: poll.creator_session.unwrap_or_default(),
        }),
        ControlMessage::FancyPollVote(vote) => Social::Vote(fancy::social::PollVote {
            poll_id: vote.poll_id.clone().unwrap_or_default(),
            options: vote.selected.clone(),
            voter: vote.voter_session.unwrap_or_default(),
        }),
        ControlMessage::FancyDrawStroke(stroke) => Social::Stroke(fancy::social::DrawStroke {
            channel: stroke.channel_id.unwrap_or_default(),
            actor: stroke.sender_session.unwrap_or_default(),
            colour: css_colour(stroke.color.unwrap_or_default()),
            // The fractional width is the resolution-independent one, so it
            // wins when present — a stroke sized in pixels of the sharer's
            // screen is the wrong thickness on every other screen.
            width: stroke.width_frac.or(stroke.width).unwrap_or_default(),
            points: stroke.points.clone(),
        }),
        ControlMessage::FancyLinkPreviewRequest(request) => {
            // Every URL in one frame. The canon takes `repeated urls` for this
            // reason: a chat message carries as many links as somebody typed,
            // and one frame per link would meter a single message against a
            // rate limiter that counts frames.
            let envelope = fancy::feature::LinkPreviewEnvelope {
                body: Some(fancy::feature::link_preview_envelope::Body::Request(
                    fancy::feature::PreviewRequest {
                        request_id: request.request_id.clone().unwrap_or_default(),
                        urls: request.urls.clone(),
                    },
                )),
            };
            return Some((LINK_PREVIEW, envelope.encode_to_vec()));
        }
        ControlMessage::FancyPushRegister(register) => {
            // The canon used to model this as an *inclusion* list, which no
            // client could fill: a user mutes two rooms out of forty. It now
            // carries the mute set, so the translation is faithful and push
            // leaves the relay.
            let envelope = fancy::feature::PushEnvelope {
                body: Some(fancy::feature::push_envelope::Body::Register(
                    fancy::feature::Register {
                        token: register.token.clone().unwrap_or_default(),
                        platform: std::env::consts::OS.to_owned(),
                        muted: register.muted_channels.clone(),
                    },
                )),
            };
            return Some((PUSH, envelope.encode_to_vec()));
        }
        ControlMessage::FancyPushUpdate(update) => {
            return Some((PUSH, subscribe(&update.muted_channels)));
        }
        ControlMessage::FancySubscribePush(subscribe_push) => {
            return Some((PUSH, subscribe(&subscribe_push.muted_channels)));
        }
        ControlMessage::PchatMessage(message) => {
            return Some((PCHAT, pchat_message_to_canon(message)));
        }
        ControlMessage::PchatFetch(fetch) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::Fetch(
                    fancy::pchat::Fetch {
                        channel: fetch.channel_id.unwrap_or_default(),
                        page: Some(fancy::wire::Cursor {
                            before_id: fetch.before_id.clone().unwrap_or_default(),
                            after_id: fetch.after_id.clone().unwrap_or_default(),
                            limit: fetch.limit.unwrap_or_default(),
                        }),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        _ => return None,
    };
    Some((
        SOCIAL,
        fancy::social::SocialEnvelope { body: Some(body) }.encode_to_vec(),
    ))
}

/// One pchat message, encoded as a canon envelope.
///
/// Everything the recipient needs to decrypt travels with it. `sender_cert` is
/// deliberately not filled: the server stamps it from the TLS connection, and a
/// value from here would be a claim rather than an identity.
fn pchat_message_to_canon(message: &mumble_tcp::PchatMessage) -> Vec<u8> {
    fancy::pchat::PchatEnvelope {
        body: Some(fancy::pchat::pchat_envelope::Body::Message(
            fancy::pchat::Message {
                message_id: message.message_id.clone().unwrap_or_default(),
                channel: message.channel_id.unwrap_or_default(),
                sender: 0,
                ciphertext: message.envelope.clone().unwrap_or_default(),
                sent_at_ms: message.timestamp.unwrap_or_default(),
                supersedes: message.replaces_id.clone().unwrap_or_default(),
                epoch: message.epoch.unwrap_or_default(),
                sender_cert: Vec::new(),
                epoch_fingerprint: message.epoch_fingerprint.clone().unwrap_or_default(),
                chain_index: message.chain_index.unwrap_or_default(),
                protocol: message.protocol.unwrap_or_default(),
            },
        )),
    }
    .encode_to_vec()
}

/// Decode a canon envelope into the client's own vocabulary.
///
/// `Ok(None)` means "not a service type this build translates", which the
/// caller skips rather than treating as an error — an unreadable member of a
/// service costs nothing to ignore, which is the whole promise of the envelope.
pub fn from_canon(type_id: u16, payload: &[u8]) -> Result<Option<ControlMessage>> {
    use fancy::social::social_envelope::Body as Social;

    match type_id {
        SOCIAL => {
            let Ok(envelope) = fancy::social::SocialEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(Social::Typing(typing)) => Some(ControlMessage::FancyTypingIndicator(
                    mumble_tcp::FancyTypingIndicator {
                        actor: session(typing.actor),
                        channel_id: Some(typing.channel),
                    },
                )),
                Some(Social::Reaction(reaction)) => {
                    Some(ControlMessage::PchatReactionDeliver(reaction_deliver(
                        &reaction,
                    )))
                }
                Some(Social::Poll(poll)) => Some(ControlMessage::FancyPoll(mumble_tcp::FancyPoll {
                    channel_id: Some(poll.channel),
                    poll_id: Some(poll.poll_id),
                    question: Some(poll.question),
                    options: poll.options,
                    multiple: Some(poll.multiple),
                    creator_session: session(poll.creator),
                    ..Default::default()
                })),
                Some(Social::Vote(vote)) => {
                    Some(ControlMessage::FancyPollVote(mumble_tcp::FancyPollVote {
                        poll_id: Some(vote.poll_id),
                        selected: vote.options,
                        voter_session: session(vote.voter),
                        ..Default::default()
                    }))
                }
                Some(Social::Stroke(stroke)) => Some(ControlMessage::FancyDrawStroke(
                    mumble_tcp::FancyDrawStroke {
                        channel_id: Some(stroke.channel),
                        sender_session: session(stroke.actor),
                        color: Some(packed_colour(&stroke.colour)),
                        width_frac: Some(stroke.width),
                        points: stroke.points,
                        ..Default::default()
                    },
                )),
                _ => None,
            })
        }
        PUSH => {
            let Ok(envelope) = fancy::feature::PushEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                // The server answers a registration; the client's own message
                // set has no ack type, so the mute set is echoed back as the
                // update it is a confirmation of.
                Some(fancy::feature::push_envelope::Body::Subscribe(subscribe)) => {
                    Some(ControlMessage::FancySubscribePush(
                        mumble_tcp::FancySubscribePush {
                            muted_channels: subscribe.muted,
                        },
                    ))
                }
                _ => None,
            })
        }
        LINK_PREVIEW => {
            let Ok(envelope) = fancy::feature::LinkPreviewEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(fancy::feature::link_preview_envelope::Body::Preview(preview)) => {
                    Some(ControlMessage::FancyLinkPreviewResponse(preview_response(
                        &preview,
                    )))
                }
                // A refusal becomes an answer with no embeds.
                //
                // `FancyLinkPreviewResponse` has no error field — epoch 0 never
                // modelled one — so the reason stays in the server's log and
                // the client gets the one thing it needs from here: the
                // correlation id, so it stops waiting. Dropped instead, it
                // spins on a preview that is never coming.
                Some(fancy::feature::link_preview_envelope::Body::Error(failed)) => {
                    tracing::debug!(reason = %failed.reason, "link preview refused by the server");
                    Some(ControlMessage::FancyLinkPreviewResponse(
                        mumble_tcp::FancyLinkPreviewResponse {
                            request_id: Some(failed.request_id),
                            embeds: Vec::new(),
                        },
                    ))
                }
                Some(fancy::feature::link_preview_envelope::Body::Request(_)) | None => None,
            })
        }
        PCHAT => {
            let Ok(envelope) = fancy::pchat::PchatEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(fancy::pchat::pchat_envelope::Body::Message(message)) => Some(
                    ControlMessage::PchatMessageDeliver(pchat_deliver(&message)),
                ),
                _ => None,
            })
        }
        _ => Ok(None),
    }
}

/// A canon reaction, as the delivery this client's UI already handles.
fn reaction_deliver(reaction: &fancy::social::Reaction) -> mumble_tcp::PchatReactionDeliver {
    use mumble_tcp::pchat_reaction_deliver::Emoji;
    mumble_tcp::PchatReactionDeliver {
        channel_id: Some(reaction.channel),
        message_id: Some(reaction.message_id.clone()),
        action: Some(i32::from(reaction.remove)),
        sender_hash: None,
        sender_name: None,
        timestamp: None,
        emoji: reaction.emoji.as_ref().and_then(|emoji| {
            Some(match emoji.kind.as_ref()? {
                fancy::wire::emoji::Kind::Unicode(grapheme) => {
                    Emoji::UnicodeEmoji(mumble_tcp::UnicodeEmoji {
                        grapheme: Some(grapheme.clone()),
                    })
                }
                fancy::wire::emoji::Kind::Shortcode(code) => {
                    Emoji::ServerEmoji(mumble_tcp::ServerEmoji {
                        shortcode: Some(code.clone().into_bytes()),
                    })
                }
            })
        }),
    }
}

/// A canon pchat message, as the delivery this client's store already handles.
fn pchat_deliver(message: &fancy::pchat::Message) -> mumble_tcp::PchatMessageDeliver {
    mumble_tcp::PchatMessageDeliver {
        message_id: Some(message.message_id.clone()),
        channel_id: Some(message.channel),
        timestamp: Some(message.sent_at_ms),
        // The durable identity, hex-encoded because that is the form the
        // client's key ladder keys on (`peer_keys`, channel originators).
        sender_hash: Some(hex(&message.sender_cert)),
        protocol: Some(message.protocol),
        envelope: Some(message.ciphertext.clone()),
        replaces_id: Some(message.supersedes.clone()),
    }
}

/// The client's emoji, as the canon's.
fn emoji_to_canon(emoji: Option<&mumble_tcp::pchat_reaction::Emoji>) -> Option<fancy::wire::Emoji> {
    use mumble_tcp::pchat_reaction::Emoji;
    let kind = match emoji? {
        Emoji::UnicodeEmoji(unicode) => {
            fancy::wire::emoji::Kind::Unicode(unicode.grapheme.clone().unwrap_or_default())
        }
        // Epoch 0 carried a shortcode as bytes; the canon says what it always
        // was, which is text.
        Emoji::ServerEmoji(server) => fancy::wire::emoji::Kind::Shortcode(
            String::from_utf8(server.shortcode.clone().unwrap_or_default()).unwrap_or_default(),
        ),
    };
    Some(fancy::wire::Emoji { kind: Some(kind) })
}

/// One canon `Preview` as the client's own response message.
///
/// The canon is deliberately smaller than the epoch-0 shape: it carries what a
/// server can honestly extract from a page — title, description, site — and not
/// the video/author/favicon/timestamp surface `Embed` has room for. Those are
/// left unset rather than invented, so a client renders what was actually read.
///
/// `image_key` is not mapped either: it names an object in the files service,
/// and nothing stores one yet (`PROTOCOL-MIGRATION.md` M2b). Putting a remote
/// URL in `Media.url` would send every viewer to fetch it, which is the network
/// probe that server-side previews exist to prevent.
fn preview_response(
    preview: &fancy::feature::Preview,
) -> mumble_tcp::FancyLinkPreviewResponse {
    mumble_tcp::FancyLinkPreviewResponse {
        request_id: Some(preview.request_id.clone()),
        embeds: vec![mumble_tcp::fancy_link_preview_response::Embed {
            url: Some(preview.url.clone()),
            title: Some(preview.title.clone()),
            description: Some(preview.description.clone()),
            site_name: Some(preview.site.clone()),
            r#type: Some("link".to_owned()),
            ..Default::default()
        }],
        ..Default::default()
    }
}

/// `0xRRGGBB` as the CSS the canon asks for.
fn css_colour(packed: u32) -> String {
    format!("#{:06x}", packed & 0x00ff_ffff)
}

/// The inverse of [`css_colour`], for a stroke arriving from the canon.
///
/// Anything unparseable becomes black rather than an error: a stroke is a
/// drawing, and refusing to render one because its colour was malformed loses
/// the shape as well as the colour.
fn packed_colour(css: &str) -> u32 {
    u32::from_str_radix(css.trim_start_matches('#'), 16).unwrap_or_default() & 0x00ff_ffff
}

/// The whole mute set, replaced rather than added to.
///
/// Both of this client's messages carry the complete list, which is what lets a
/// user say "I have un-muted that one" — an incremental API could not express
/// a removal.
fn subscribe(muted: &[u32]) -> Vec<u8> {
    fancy::feature::PushEnvelope {
        body: Some(fancy::feature::push_envelope::Body::Subscribe(
            fancy::feature::Subscribe {
                muted: muted.to_vec(),
            },
        )),
    }
    .encode_to_vec()
}

/// A session id, or `None` when the canon left it unset.
///
/// proto3 cannot tell an unset `uint32` from a zero, and this client's messages
/// can — so the zero has to be interpreted rather than passed through. Session 0
/// is not a real session, which is what makes the interpretation safe: nothing
/// is ever legitimately attributed to it.
fn session(id: u32) -> Option<u32> {
    (id != 0).then_some(id)
}

/// Lower-case hex, the form cert hashes are compared in throughout the client.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn a_typing_indicator_round_trips_through_the_canon() {
        let sent = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
            actor: None,
            channel_id: Some(4),
        });
        let (outer, payload) = to_canon(&sent).expect("typing has a canon home");
        assert_eq!(outer, SOCIAL);

        let back = from_canon(outer, &payload).unwrap().expect("decodes");
        let ControlMessage::FancyTypingIndicator(typing) = back else {
            panic!("expected a typing indicator");
        };
        assert_eq!(typing.channel_id, Some(4));
    }

    #[test]
    fn every_link_in_one_message_is_asked_for() {
        // The gap this closed: the client sent `FancyLinkPreviewRequest` flat
        // as type 132, which has no canon home, so it took the PluginData
        // relay — and Starling's link-preview service only ever decodes a
        // `LinkPreviewEnvelope` under outer type 1016. The server fetched
        // correctly and the request never arrived.
        let sent = ControlMessage::FancyLinkPreviewRequest(mumble_tcp::FancyLinkPreviewRequest {
            request_id: Some("r-1".to_owned()),
            urls: vec![
                "https://example.com/a".to_owned(),
                "https://example.org/b".to_owned(),
            ],
        });
        let (outer, payload) = to_canon(&sent).expect("link preview has a canon home");
        assert_eq!(outer, LINK_PREVIEW);

        let envelope = fancy::feature::LinkPreviewEnvelope::decode(payload.as_slice())
            .expect("the server's own decode");
        let Some(fancy::feature::link_preview_envelope::Body::Request(request)) = envelope.body
        else {
            panic!("expected a request");
        };
        assert_eq!(request.request_id, "r-1");
        assert_eq!(
            request.urls,
            vec!["https://example.com/a".to_owned(), "https://example.org/b".to_owned()],
            "a message with two links must ask about both"
        );
    }

    #[test]
    fn a_preview_comes_back_as_an_embed_and_a_refusal_as_an_empty_answer() {
        let preview = fancy::feature::LinkPreviewEnvelope {
            body: Some(fancy::feature::link_preview_envelope::Body::Preview(
                fancy::feature::Preview {
                    request_id: "r-2".to_owned(),
                    url: "https://example.com/a".to_owned(),
                    title: "Example Domain".to_owned(),
                    description: "A page".to_owned(),
                    site: "Example".to_owned(),
                    image_key: String::new(),
                },
            )),
        };
        let back = from_canon(LINK_PREVIEW, &preview.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::FancyLinkPreviewResponse(response) = back else {
            panic!("expected a preview response");
        };
        assert_eq!(response.request_id.as_deref(), Some("r-2"));
        assert_eq!(
            response.embeds.first().and_then(|e| e.title.as_deref()),
            Some("Example Domain")
        );

        // A refusal carries no embeds, and must still carry the correlation id:
        // without it the client waits for a preview that is never coming.
        let refused = fancy::feature::LinkPreviewEnvelope {
            body: Some(fancy::feature::link_preview_envelope::Body::Error(
                fancy::feature::PreviewError {
                    request_id: "r-3".to_owned(),
                    reason: "that address is inside the server's network".to_owned(),
                },
            )),
        };
        let back = from_canon(LINK_PREVIEW, &refused.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::FancyLinkPreviewResponse(response) = back else {
            panic!("expected a preview response");
        };
        assert_eq!(response.request_id.as_deref(), Some("r-3"));
        assert!(response.embeds.is_empty());
    }

    #[test]
    fn a_reaction_keeps_which_kind_of_emoji_it_was() {
        // The distinction a bare string could not carry, and the reason
        // `wire.Emoji` exists: a shortcode is resolved against the server's
        // custom set, a grapheme is rendered as-is.
        for (original, expect_shortcode) in [
            (
                mumble_tcp::pchat_reaction::Emoji::UnicodeEmoji(mumble_tcp::UnicodeEmoji {
                    grapheme: Some("\u{1f44d}".to_owned()),
                }),
                false,
            ),
            (
                mumble_tcp::pchat_reaction::Emoji::ServerEmoji(mumble_tcp::ServerEmoji {
                    shortcode: Some(b"mumble_parrot".to_vec()),
                }),
                true,
            ),
        ] {
            let sent = ControlMessage::PchatReaction(mumble_tcp::PchatReaction {
                channel_id: Some(4),
                message_id: Some("m-1".to_owned()),
                emoji: Some(original),
                action: Some(0),
                ..Default::default()
            });
            let (outer, payload) = to_canon(&sent).expect("reactions have a canon home");
            let back = from_canon(outer, &payload).unwrap().expect("decodes");
            let ControlMessage::PchatReactionDeliver(deliver) = back else {
                panic!("expected a reaction delivery");
            };
            assert_eq!(deliver.message_id.as_deref(), Some("m-1"));
            assert_eq!(
                matches!(
                    deliver.emoji,
                    Some(mumble_tcp::pchat_reaction_deliver::Emoji::ServerEmoji(_))
                ),
                expect_shortcode
            );
        }
    }

    #[test]
    fn a_pchat_message_carries_everything_needed_to_decrypt_it() {
        // The reason pchat could not be translated until the canon grew these:
        // without the fingerprint a recipient cannot tell which epoch key
        // sealed the ciphertext, and a channel that forked has two epoch 4s.
        let sent = ControlMessage::PchatMessage(mumble_tcp::PchatMessage {
            message_id: Some("m-9".to_owned()),
            channel_id: Some(4),
            envelope: Some(b"\x00\xffsealed".to_vec()),
            epoch: Some(4),
            epoch_fingerprint: Some(b"12345678".to_vec()),
            chain_index: Some(11),
            protocol: Some(1),
            ..Default::default()
        });
        let (outer, payload) = to_canon(&sent).expect("pchat has a canon home");
        assert_eq!(outer, PCHAT);

        let envelope = fancy::pchat::PchatEnvelope::decode(payload.as_slice()).unwrap();
        let Some(fancy::pchat::pchat_envelope::Body::Message(message)) = envelope.body else {
            panic!("expected a pchat message");
        };
        assert_eq!(message.ciphertext, b"\x00\xffsealed".to_vec());
        assert_eq!(message.epoch_fingerprint, b"12345678".to_vec());
        assert_eq!(message.chain_index, 11);
        assert_eq!(message.epoch, 4);
        assert!(
            message.sender_cert.is_empty(),
            "identity is the server's to stamp, never the client's to claim"
        );
    }

    #[test]
    fn a_message_with_no_faithful_canon_form_is_left_to_the_relay() {
        // Screen-share signalling: the canon models a share where this models a
        // relayed blob, and it has no home for a trickled ICE candidate at all.
        // Truncating it into the nearest canon shape would lose the candidate
        // and break the connection; the relay carries it intact.
        let signal = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            signal_type: Some(4),
            payload: Some("candidate:...".to_owned()),
            ..Default::default()
        });
        assert!(to_canon(&signal).is_none());
    }

    #[test]
    fn everything_this_encodes_can_also_be_decoded() {
        // Translation must be symmetric or messages vanish: encoded into the
        // canon on the way out, unrecognised on the way in, skipped as an arm
        // this build does not know. `message.rs` generates both directions from
        // one list to make that impossible; this module is written by hand, so
        // the property needs asserting instead.
        //
        // Caught exactly that: polls, votes and strokes were translated outbound
        // and had no inbound arm at all.
        let samples = [
            ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
                channel_id: Some(4),
                actor: None,
            }),
            ControlMessage::PchatReaction(mumble_tcp::PchatReaction {
                channel_id: Some(4),
                message_id: Some("m".to_owned()),
                ..Default::default()
            }),
            ControlMessage::FancyPoll(mumble_tcp::FancyPoll {
                channel_id: Some(4),
                poll_id: Some("p".to_owned()),
                question: Some("?".to_owned()),
                ..Default::default()
            }),
            ControlMessage::FancyPollVote(mumble_tcp::FancyPollVote {
                poll_id: Some("p".to_owned()),
                selected: vec![1],
                ..Default::default()
            }),
            ControlMessage::FancyDrawStroke(mumble_tcp::FancyDrawStroke {
                channel_id: Some(4),
                color: Some(0x00ff_8800),
                points: vec![1.0, 2.0],
                ..Default::default()
            }),
            ControlMessage::PchatMessage(mumble_tcp::PchatMessage {
                channel_id: Some(4),
                envelope: Some(b"sealed".to_vec()),
                ..Default::default()
            }),
            ControlMessage::FancySubscribePush(mumble_tcp::FancySubscribePush {
                muted_channels: vec![7],
            }),
        ];

        for sent in samples {
            let label = sent.type_id();
            let (outer, payload) = to_canon(&sent).expect("sample has a canon home");
            assert!(
                from_canon(outer, &payload)
                    .expect("a canon payload we wrote must not fail to decode")
                    .is_some(),
                "type {label} encodes into the canon but nothing decodes it back"
            );
        }
    }

    #[test]
    fn a_stroke_keeps_its_colour_across_both_conversions() {
        assert_eq!(packed_colour(&css_colour(0x00ff_8800)), 0x00ff_8800);
        // A malformed colour renders black rather than losing the stroke.
        assert_eq!(packed_colour("not-a-colour"), 0);
    }

    #[test]
    fn a_packed_colour_becomes_the_css_the_canon_asks_for() {
        assert_eq!(css_colour(0x00ff_8800), "#ff8800");
        // The high byte is not part of the colour; a stroke that let it through
        // would render as a seven-digit string nothing parses.
        assert_eq!(css_colour(0xff00_0000), "#000000");
    }
}

