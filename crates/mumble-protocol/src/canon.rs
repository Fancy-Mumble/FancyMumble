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
//! epoch-independent and works through any Mumble server - so those features
//! keep working rather than being silently truncated. The rule is the one
//! `PROTOCOL-REDESIGN.md` M2b arrived at the hard way: **a message is only
//! translated when nothing a receiver needs is lost on the way.**
//!
//! Not translated today, and why:
//!
//! * **screenshare** - the canon models a share (`share_id`, explicit
//!   offer/answer/start/stop) where `WebRtcSignal` is one relayed blob, and it
//!   has no home for `ICE_CANDIDATE` at all *by design* (the SFU is ICE-lite;
//!   never trickle through the control plane). Mapping one onto the other is a
//!   redesign of the signalling, not a translation.
//! * **link-preview, userdata, plugins admin** - the canon does not cover these
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
/// Outer type for the operator record.
const AUDIT: u16 = 1012;
/// Outer type for chat and its history - which is where scheduled messages
/// live, because at the due time a scheduled message *is* a text message.
const TEXT: u16 = 1005;

/// The page size the server caps a query at, mirrored so the client can say
/// `has_more` from the size of the page it got back.
const AUDIT_MAX_LIMIT: u32 = 200;
/// What an audit query asks for when it names no limit.
const AUDIT_DEFAULT_LIMIT: u32 = 50;

/// Frame `msg` as the canon, or `None` when it has no faithful canon form.
///
/// `None` is not a failure: it means the caller should use the relay path. See
/// the module docs for which messages that covers and why.
#[must_use]
#[allow(
    clippy::too_many_lines,
    reason = "one match arm per translated ControlMessage variant, mechanically; splitting it \
              adds indirection without reducing what a reader has to check"
)]
pub fn to_canon(msg: &ControlMessage) -> Option<(u16, Vec<u8>)> {
    use fancy::social::social_envelope::Body as Social;

    let body = match msg {
        ControlMessage::FancyTypingIndicator(typing) => Social::Typing(fancy::social::Typing {
            channel: typing.channel_id.unwrap_or_default(),
            // Carried rather than blanked. The server overwrites every actor
            // field on relay, so this changes nothing on the wire - but keeping
            // it makes the translation lossless, and a translation that drops
            // what it could have kept is one nobody can reason about.
            actor: typing.actor.unwrap_or_default(),
            // Epoch 0 had no way to say "stopped typing" - the indicator simply
            // expired. Sending `true` keeps that behaviour rather than inventing
            // a stop the client never sends.
            typing: true,
        }),
        ControlMessage::PchatReaction(reaction) => Social::Reaction(fancy::social::Reaction {
            channel: reaction.channel_id.unwrap_or_default(),
            message_id: reaction.message_id.clone().unwrap_or_default(),
            actor: 0,
            // Both identity fields are the server's to write, so both go out
            // empty: it resolves them from the connection the frame arrived
            // on, and anything written here would be a claim it overwrites.
            actor_cert: Vec::new(),
            // `REACTION_REMOVE` is 1; anything else is an add.
            remove: reaction.action == Some(1),
            emoji: emoji_to_canon(reaction.emoji.as_ref()),
        }),
        // Only the watermark update. A query (`query = true`) asks the server
        // for stored read state, and the canon models a receipt as an event it
        // relays, not state it keeps - so a query has no canon form and stays
        // untranslated, like the audit config write below.
        ControlMessage::FancyReadReceipt(receipt) if receipt.query != Some(true) => {
            Social::Receipt(fancy::social::ReadReceipt {
                channel: receipt.channel_id.unwrap_or_default(),
                message_id: receipt.last_read_message_id.clone().unwrap_or_default(),
                // Identity and time are the server's to write, as with a
                // reaction: it resolves both from the connection the frame
                // arrived on, and anything written here is a claim it
                // overwrites.
                actor: 0,
                actor_cert: Vec::new(),
                at_ms: receipt.timestamp.unwrap_or_default(),
            })
        }
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
            // Carried, like the typing actor above: the server replaces it
            // with the poll's own channel, and a translation that drops what
            // it could have kept is one nobody can reason about.
            channel: vote.channel_id.unwrap_or_default(),
        }),
        ControlMessage::FancyDrawStroke(stroke) => Social::Stroke(fancy::social::DrawStroke {
            channel: stroke.channel_id.unwrap_or_default(),
            actor: stroke.sender_session.unwrap_or_default(),
            colour: css_colour(stroke.color.unwrap_or_default()),
            // The fractional width is the resolution-independent one, so it
            // wins when present - a stroke sized in pixels of the sharer's
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
        ControlMessage::FancyAuditQuery(query) => {
            return Some((AUDIT, audit_query_to_canon(query)));
        }
        ControlMessage::FancyAuditConfigUpdate(_) => {
            // The epoch-0 shape is a list of `Setting` rows whose schema the
            // *plugin* owned, and the canon has three typed fields. There is no
            // faithful mapping from arbitrary key/value rows onto them, and
            // guessing which key means `retention_days` is how a config write
            // silently sets the wrong thing. Reading the config is translated
            // below; writing it waits for a canon that models the same schema.
            return None;
        }
        ControlMessage::FancyScheduledMessage(request) => {
            return Some((TEXT, schedule_to_canon(request)));
        }
        ControlMessage::FancyScheduledMessageList(_) => {
            let envelope = fancy::feature::TextEnvelope {
                body: Some(fancy::feature::text_envelope::Body::Query(
                    fancy::feature::ScheduleQuery {
                        // The panel this feeds shows what is still pending, and
                        // epoch 0 never modelled asking for the finished ones -
                        // so the faithful translation is the canon's default.
                        include_finished: false,
                    },
                )),
            };
            return Some((TEXT, envelope.encode_to_vec()));
        }
        ControlMessage::FancyScheduledMessageCancel(cancel) => {
            let envelope = fancy::feature::TextEnvelope {
                body: Some(fancy::feature::text_envelope::Body::Cancel(
                    fancy::feature::ScheduleCancel {
                        schedule_id: cancel.schedule_id.clone().unwrap_or_default(),
                    },
                )),
            };
            return Some((TEXT, envelope.encode_to_vec()));
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

/// One audit query, as the canon envelope that carries it.
///
/// Three different asks arrive as one epoch-0 message, and they are three
/// separate canon bodies: `verify_chain` walks the chain, an empty query on a
/// freshly-opened tab wants the config, and everything else is a search. The
/// split is on the wire rather than in the service because a verify reads every
/// row and a search reads a page; conflating them is how a filter change turns
/// into a full-table scan.
fn audit_query_to_canon(query: &mumble_tcp::FancyAuditQuery) -> Vec<u8> {
    use fancy::feature::audit_envelope::Body;

    let query_id = query.query_id.clone().unwrap_or_default();
    let body = if query.verify_chain.unwrap_or_default() {
        Body::Verify(fancy::feature::Verify { query_id })
    } else {
        Body::Query(fancy::feature::Query {
            query_id,
            since_ms: query.since_ms.unwrap_or_default(),
            until_ms: query.until_ms.unwrap_or_default(),
            // The canon filters on one category; the epoch-0 message offers a
            // list. Taking the first is lossy only when a client sends several,
            // which the tab's filter rail cannot do - it is a single select.
            category: query.categories.first().cloned().unwrap_or_default(),
            target_account: u64::from(query.target_user_id.unwrap_or_default()),
            page: Some(fancy::wire::Cursor {
                // Keyset pagination by entry id. Epoch 0 numbers entries and
                // the canon names them, so a cursor is the id as text; empty
                // means "from the newest", which is what a first page wants.
                before_id: query
                    .before_id
                    .filter(|id| *id > 0)
                    .map_or_else(String::new, |id| id.to_string()),
                after_id: String::new(),
                limit: query
                    .limit
                    .filter(|limit| *limit > 0)
                    .unwrap_or(AUDIT_DEFAULT_LIMIT)
                    .min(AUDIT_MAX_LIMIT),
            }),
        })
    };

    fancy::feature::AuditEnvelope { body: Some(body) }.encode_to_vec()
}

/// One canon page, as the response the audit tab reads.
fn audit_response(page: &fancy::feature::Page) -> mumble_tcp::FancyAuditResponse {
    let cursor = page.page.clone().unwrap_or_default();
    mumble_tcp::FancyAuditResponse {
        query_id: Some(page.query_id.clone()),
        entries: page.records.iter().map(audit_entry).collect(),
        has_more: Some(cursor.more),
        // The canon pages by entry id as text and epoch 0 by number. Nothing
        // parses this back into an id: `before_id` is round-tripped through
        // `audit_query_to_canon`, so a non-numeric id would come back as 0 and
        // page from the top for ever. Starling's ids are UUIDv7 and do not fit
        // a u64, so the numeric cursor is left unset and the client's
        // `nextBeforeId` stays empty, which is the honest answer: this build
        // pages forward only.
        next_before_id: None,
        ..Default::default()
    }
}

/// One canon record, as the entry the results table renders.
fn audit_entry(record: &fancy::feature::AuditRecord) -> mumble_tcp::AuditEntry {
    mumble_tcp::AuditEntry {
        // Epoch 0 numbers entries; the canon names them. The table keys rows on
        // this only for React, and the id is shown from `detail_json` instead,
        // so a hash of the name is a stable key rather than a lie about order.
        id: None,
        ts: Some(record.at_ms),
        // Everything Starling records is server-authoritative; it has no plugin
        // ingest and takes no client claims, so the UI's "reported claim"
        // rendering never applies.
        source: Some("server".to_owned()),
        category: Some(record.category.clone()),
        actor_name: Some(record.actor.clone()),
        target_user_id: (record.target_account > 0)
            .then(|| u32::try_from(record.target_account).unwrap_or(u32::MAX)),
        channel_id: (record.target_channel > 0).then_some(record.target_channel),
        // The canon's `action` is the verb ("muted", "created"); epoch 0 has no
        // field for it and the tab shows `reason` beside the category, which is
        // where a reader looks for what happened.
        reason: Some(record.action.clone()),
        detail_json: Some(
            serde_json::json!({
                "id": record.id,
                "action": record.action,
                "detail": record.detail,
                "entry_hash": record.entry_hash,
            })
            .to_string(),
        ),
        entry_hash: Some(record.entry_hash.clone().into_bytes()),
        ..Default::default()
    }
}

/// The canon config, as the `Setting` rows the config half renders.
///
/// Epoch 0 let the plugin own the schema and sent typed rows for it. The canon
/// has three fields, so these are the three, described here rather than
/// invented in the UI.
fn audit_settings(config: &fancy::feature::Config) -> Vec<mumble_tcp::Setting> {
    vec![
        mumble_tcp::Setting {
            key: Some("audit.enabled".to_owned()),
            r#type: Some("bool".to_owned()),
            group: Some("audit".to_owned()),
            label: Some("Record operator actions".to_owned()),
            value: Some(config.enabled.to_string()),
            help: Some("Whether new entries are added to the chain.".to_owned()),
            options: Vec::new(),
            secret: Some(false),
        },
        mumble_tcp::Setting {
            key: Some("audit.retention_days".to_owned()),
            r#type: Some("int".to_owned()),
            group: Some("audit".to_owned()),
            label: Some("Keep entries for (days)".to_owned()),
            value: Some(config.retention_days.to_string()),
            help: Some(
                "0 keeps everything. Retention is a deletion: the chain does \
                 not re-link across a sweep, so a verify reports a break at the seam."
                    .to_owned(),
            ),
            options: Vec::new(),
            secret: Some(false),
        },
        mumble_tcp::Setting {
            key: Some("audit.categories".to_owned()),
            r#type: Some("string".to_owned()),
            group: Some("audit".to_owned()),
            label: Some("Recorded categories".to_owned()),
            value: Some(config.categories.join(",")),
            help: Some("What the server records, and what the filter offers.".to_owned()),
            options: Vec::new(),
            secret: Some(false),
        },
    ]
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
/// caller skips rather than treating as an error - an unreadable member of a
/// service costs nothing to ignore, which is the whole promise of the envelope.
#[allow(
    clippy::too_many_lines,
    reason = "one outer-type arm per translated service, each expanding into one match arm per \
              body variant, mechanically; splitting it adds indirection without reducing what a \
              reader has to check"
)]
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
                Some(Social::Receipt(receipt)) => Some(
                    ControlMessage::FancyReadReceiptDeliver(receipt_deliver(&receipt)),
                ),
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
                        // The card this vote belongs to is held per channel,
                        // so a vote that arrives without one is dropped by the
                        // handler and the tally never moves.
                        channel_id: Some(vote.channel),
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
                // `FancyLinkPreviewResponse` has no error field - epoch 0 never
                // modelled one - so the reason stays in the server's log and
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
        AUDIT => {
            use fancy::feature::audit_envelope::Body as Audit;

            let Ok(envelope) = fancy::feature::AuditEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(Audit::Page(page)) => {
                    Some(ControlMessage::FancyAuditResponse(audit_response(&page)))
                }
                Some(Audit::VerifyResult(result)) => Some(ControlMessage::FancyAuditResponse(
                    mumble_tcp::FancyAuditResponse {
                        query_id: Some(result.query_id),
                        chain_ok: Some(result.intact),
                        chain_height: Some(result.checked),
                        // Only on a break, and it names where. The card prints
                        // this verbatim, so "entry <id>" is the whole message a
                        // reader gets; an empty string here would render as
                        // "BROKEN: ?".
                        chain_error: (!result.intact)
                            .then(|| format!("chain breaks at entry {}", result.broken_at)),
                        ..Default::default()
                    },
                )),
                Some(Audit::Config(config)) => Some(ControlMessage::FancyAuditConfig(
                    mumble_tcp::FancyAuditConfig {
                        settings: audit_settings(&config),
                        // The canon has no revision; the client uses it only to
                        // drop stale snapshots, and one snapshot per query is
                        // never out of order with itself.
                        revision: Some(0),
                        // Starling has no SQL sandbox, so the editor stays
                        // hidden rather than offering a mode that is refused
                        // on use.
                        advanced_sql_available: Some(false),
                        chain_height: Some(config.chain_height),
                        sql_schema_json: None,
                    },
                )),
                // Client->server bodies, and `Event`, which needs a live tail
                // the canon does not model yet.
                _ => None,
            })
        }
        TEXT => {
            use fancy::feature::text_envelope::Body as Text;

            let Ok(envelope) = fancy::feature::TextEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(Text::List(list)) => Some(
                    ControlMessage::FancyScheduledMessageListResponse(
                        mumble_tcp::FancyScheduledMessageListResponse {
                            messages: list.messages.iter().map(scheduled_deliver).collect(),
                        },
                    ),
                ),
                Some(Text::Ack(ack)) => Some(ControlMessage::FancyScheduledMessageAck(
                    mumble_tcp::FancyScheduledMessageAck {
                        // Empty on a refusal that never stored anything, and an
                        // id that never existed is one the client must not see.
                        schedule_id: (!ack.schedule_id.is_empty()).then_some(ack.schedule_id),
                        status: Some(ack.status),
                        reason: (!ack.reason.is_empty()).then_some(ack.reason),
                    },
                )),
                // The chat surface itself still speaks upstream `TextMessage`
                // on this client; `Schedule`, `Query` and `Cancel` are
                // client->server bodies.
                _ => None,
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
                Some(fancy::pchat::pchat_envelope::Body::FetchResponse(response)) => Some(
                    ControlMessage::PchatFetchResponse(mumble_tcp::PchatFetchResponse {
                        channel_id: Some(response.channel),
                        messages: response.messages.iter().map(pchat_stored).collect(),
                        has_more: response.page.as_ref().map(|page| page.more),
                        total_stored: Some(
                            u32::try_from(response.total_stored).unwrap_or(u32::MAX),
                        ),
                    }),
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
        // Hex, because that is the form the rest of this client keys identity
        // on (`peer_keys`, channel originators, the reaction store's reactor
        // set). Absent rather than empty for a peer with no certificate, so
        // "unknown reactor" stays distinguishable from "reactor with an empty
        // hash", which every such peer would otherwise share.
        sender_hash: (!reaction.actor_cert.is_empty()).then(|| hex(&reaction.actor_cert)),
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

/// A canon read receipt, as the delivery this client's store already handles.
///
/// The epoch-0 shape is a server-aggregated list of read states; the canon
/// relays one reader's watermark at a time, so the list has one entry and the
/// receiving store merges it per reader.
fn receipt_deliver(receipt: &fancy::social::ReadReceipt) -> mumble_tcp::FancyReadReceiptDeliver {
    mumble_tcp::FancyReadReceiptDeliver {
        channel_id: Some(receipt.channel),
        read_states: vec![mumble_tcp::fancy_read_receipt_deliver::ReadState {
            // Hex for the same reason as a reaction's; absent rather than
            // empty for a peer with no certificate, so the handler can filter
            // it instead of collapsing every such peer into one reader.
            cert_hash: (!receipt.actor_cert.is_empty()).then(|| hex(&receipt.actor_cert)),
            name: None,
            last_read_message_id: Some(receipt.message_id.clone()),
            timestamp: Some(receipt.at_ms),
        }],
        query_message_id: None,
    }
}

/// A canon archive message, as the stored shape a fetch response lists.
///
/// The same translation as [`pchat_deliver`], into `PchatMessage` rather than
/// the deliver, because that is what `PchatFetchResponse` carries and what the
/// fetch-response handler decrypts - including the decryption context
/// (`epoch`, `chain_index`, `epoch_fingerprint`) the live deliver keeps inside
/// its envelope.
fn pchat_stored(message: &fancy::pchat::Message) -> mumble_tcp::PchatMessage {
    mumble_tcp::PchatMessage {
        message_id: Some(message.message_id.clone()),
        channel_id: Some(message.channel),
        timestamp: Some(message.sent_at_ms),
        sender_hash: Some(hex(&message.sender_cert)),
        protocol: Some(message.protocol),
        envelope: Some(message.ciphertext.clone()),
        epoch: Some(message.epoch),
        chain_index: Some(message.chain_index),
        epoch_fingerprint: Some(message.epoch_fingerprint.clone()),
        replaces_id: Some(message.supersedes.clone()),
    }
}

/// One scheduled message, as the text-service envelope that carries it.
fn schedule_to_canon(request: &mumble_tcp::FancyScheduledMessage) -> Vec<u8> {
    let envelope = fancy::feature::TextEnvelope {
        body: Some(fancy::feature::text_envelope::Body::Schedule(
            fancy::feature::Scheduled {
                // The id and every identity/time field are the server's to
                // write; what the client happens to know is carried anyway,
                // because a translation that drops what it could have kept is
                // one nobody can reason about.
                schedule_id: request.schedule_id.clone().unwrap_or_default(),
                channels: request.channel_id.clone(),
                trees: request.tree_id.clone(),
                body: request.message.clone().unwrap_or_default(),
                deliver_at_ms: request.deliver_at.unwrap_or_default(),
                creator: request.creator_session.unwrap_or_default(),
                // Bytes on the canon, a hex string on epoch 0. The server
                // stamps it from the connection either way, so nothing is
                // lost by not guessing at a decode.
                creator_cert: Vec::new(),
                creator_name: request.creator_name.clone().unwrap_or_default(),
                created_at_ms: request.created_at.unwrap_or_default(),
                status: request.status.unwrap_or_default(),
            },
        )),
    };
    envelope.encode_to_vec()
}

/// One canon scheduled message, as the row the client's panel renders.
fn scheduled_deliver(message: &fancy::feature::Scheduled) -> mumble_tcp::FancyScheduledMessage {
    mumble_tcp::FancyScheduledMessage {
        schedule_id: Some(message.schedule_id.clone()),
        channel_id: message.channels.clone(),
        tree_id: message.trees.clone(),
        message: Some(message.body.clone()),
        deliver_at: Some(message.deliver_at_ms),
        creator_session: session(message.creator),
        creator_hash: (!message.creator_cert.is_empty()).then(|| hex(&message.creator_cert)),
        creator_name: (!message.creator_name.is_empty())
            .then(|| message.creator_name.clone()),
        created_at: Some(message.created_at_ms),
        status: Some(message.status),
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
/// server can honestly extract from a page - title, description, site - and not
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
/// user say "I have un-muted that one" - an incremental API could not express
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
/// can - so the zero has to be interpreted rather than passed through. Session 0
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
    fn a_vote_arrives_with_the_channel_its_card_is_held_under() {
        // The handler drops a vote with no channel, so the tally never moved
        // however faithfully everything else was translated. The server writes
        // the poll's channel; this is the half that reads it.
        let sent = ControlMessage::FancyPollVote(mumble_tcp::FancyPollVote {
            poll_id: Some("p-1".to_owned()),
            channel_id: Some(4),
            selected: vec![1],
            ..Default::default()
        });
        let (outer, payload) = to_canon(&sent).expect("a vote has a canon home");
        assert_eq!(outer, SOCIAL);

        let back = from_canon(outer, &payload).unwrap().expect("decodes");
        let ControlMessage::FancyPollVote(vote) = back else {
            panic!("expected a poll vote");
        };
        assert_eq!(vote.channel_id, Some(4));
        assert_eq!(vote.selected, vec![1]);
    }

    #[test]
    fn a_relayed_reaction_names_the_reactor_by_certificate() {
        // Without it every reactor keys as the same empty hash: two people
        // reacting count once, and either removing it removes both.
        let relayed = fancy::social::SocialEnvelope {
            body: Some(fancy::social::social_envelope::Body::Reaction(
                fancy::social::Reaction {
                    channel: 4,
                    message_id: "m-1".to_owned(),
                    emoji: None,
                    actor: 7,
                    actor_cert: vec![0xab, 0xcd],
                    remove: false,
                },
            )),
        };
        let back = from_canon(SOCIAL, &relayed.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::PchatReactionDeliver(deliver) = back else {
            panic!("expected a reaction delivery");
        };
        assert_eq!(deliver.sender_hash.as_deref(), Some("abcd"));

        // And a peer that presented no certificate has no identity, which is
        // not the same as an identity that is the empty string.
        let anonymous = fancy::social::SocialEnvelope {
            body: Some(fancy::social::social_envelope::Body::Reaction(
                fancy::social::Reaction {
                    channel: 4,
                    message_id: "m-1".to_owned(),
                    ..Default::default()
                },
            )),
        };
        let back = from_canon(SOCIAL, &anonymous.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::PchatReactionDeliver(deliver) = back else {
            panic!("expected a reaction delivery");
        };
        assert_eq!(deliver.sender_hash, None);
    }

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
    fn a_read_watermark_round_trips_as_the_deliver_its_author_renders() {
        // The gap this closed: `FancyReadReceipt` had no canon home, and it is
        // marked ServerOnly - so on a canon server the codec dropped it with a
        // debug log and the author's "Read" tick never had anything to render.
        let sent = ControlMessage::FancyReadReceipt(mumble_tcp::FancyReadReceipt {
            channel_id: Some(4),
            last_read_message_id: Some("m-9".to_owned()),
            ..Default::default()
        });
        let (outer, payload) = to_canon(&sent).expect("a watermark has a canon home");
        assert_eq!(outer, SOCIAL);
        let envelope = fancy::social::SocialEnvelope::decode(payload.as_slice()).unwrap();
        let Some(fancy::social::social_envelope::Body::Receipt(receipt)) = envelope.body else {
            panic!("expected a canon receipt");
        };
        assert_eq!(receipt.channel, 4);
        assert_eq!(receipt.message_id, "m-9");
        assert_eq!(receipt.actor_cert, Vec::<u8>::new(), "identity is the server's to write");

        // What the server relays back, stamped, becomes the aggregated shape
        // the read-receipt store merges - one reader per relay, keyed by the
        // certificate in the form the client compares hashes in.
        let relayed = fancy::social::SocialEnvelope {
            body: Some(fancy::social::social_envelope::Body::Receipt(
                fancy::social::ReadReceipt {
                    channel: 4,
                    message_id: "m-9".to_owned(),
                    actor: 7,
                    at_ms: 1_000,
                    actor_cert: vec![0xab, 0xcd],
                },
            )),
        };
        let back = from_canon(SOCIAL, &relayed.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::FancyReadReceiptDeliver(deliver) = back else {
            panic!("expected a read-receipt delivery");
        };
        assert_eq!(deliver.channel_id, Some(4));
        let [state] = deliver.read_states.as_slice() else {
            panic!("one relay carries one reader");
        };
        assert_eq!(state.cert_hash.as_deref(), Some("abcd"));
        assert_eq!(state.last_read_message_id.as_deref(), Some("m-9"));
        assert_eq!(state.timestamp, Some(1_000));
    }

    #[test]
    fn a_read_state_query_stays_off_the_canon() {
        // The canon models a receipt as an event the server relays, not state
        // it stores, so a query has nothing to be translated into. Truncating
        // it into a watermark update would *write* a watermark - the one thing
        // a read-only ask must never do.
        let query = ControlMessage::FancyReadReceipt(mumble_tcp::FancyReadReceipt {
            channel_id: Some(4),
            query: Some(true),
            ..Default::default()
        });
        assert!(to_canon(&query).is_none());
    }

    #[test]
    fn a_fetched_page_comes_back_as_the_response_the_store_decrypts() {
        // The other half of history replay: `PchatFetch` was translated out,
        // the server answered, and the answer had no inbound arm - so the
        // archive was served and then skipped as an unknown service message.
        let page = fancy::pchat::PchatEnvelope {
            body: Some(fancy::pchat::pchat_envelope::Body::FetchResponse(
                fancy::pchat::FetchResponse {
                    channel: 4,
                    messages: vec![fancy::pchat::Message {
                        message_id: "m-1".to_owned(),
                        channel: 4,
                        sender: 7,
                        ciphertext: b"sealed".to_vec(),
                        sent_at_ms: 1_000,
                        supersedes: String::new(),
                        epoch: 3,
                        sender_cert: vec![0xab, 0xcd],
                        epoch_fingerprint: vec![1, 2, 3, 4, 5, 6, 7, 8],
                        chain_index: 9,
                        protocol: 4,
                    }],
                    total_stored: 12,
                    page: Some(fancy::wire::PageInfo {
                        more: true,
                        next_before_id: "m-1".to_owned(),
                    }),
                },
            )),
        };
        let back = from_canon(PCHAT, &page.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::PchatFetchResponse(response) = back else {
            panic!("expected a fetch response");
        };
        assert_eq!(response.channel_id, Some(4));
        assert_eq!(response.has_more, Some(true));
        assert_eq!(response.total_stored, Some(12));
        let [message] = response.messages.as_slice() else {
            panic!("expected the one stored message");
        };
        assert_eq!(message.message_id.as_deref(), Some("m-1"));
        assert_eq!(message.sender_hash.as_deref(), Some("abcd"));
        assert_eq!(message.envelope.as_deref(), Some(b"sealed".as_slice()));
        assert_eq!(message.epoch, Some(3));
        assert_eq!(message.chain_index, Some(9));
        assert_eq!(message.epoch_fingerprint.as_deref(), Some([1, 2, 3, 4, 5, 6, 7, 8].as_slice()));
        assert_eq!(message.protocol, Some(4));
    }

    #[test]
    fn every_link_in_one_message_is_asked_for() {
        // The gap this closed: the client sent `FancyLinkPreviewRequest` flat
        // as type 132, which has no canon home, so it took the PluginData
        // relay - and Starling's link-preview service only ever decodes a
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
            ControlMessage::FancyReadReceipt(mumble_tcp::FancyReadReceipt {
                channel_id: Some(4),
                last_read_message_id: Some("m".to_owned()),
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
    fn a_scheduled_message_goes_out_under_the_text_service() {
        // The gap this closes is the pchat_protocol lesson again: without a
        // text arm the schedule takes the PluginData relay, and Starling's
        // text service only reads a `TextEnvelope` under outer type 1005 - so
        // the panel would say "scheduled" over a frame that routed nowhere.
        let sent = ControlMessage::FancyScheduledMessage(mumble_tcp::FancyScheduledMessage {
            channel_id: vec![4],
            tree_id: vec![7],
            message: Some("stand-up in five".to_owned()),
            deliver_at: Some(1_723_200_000_000),
            ..Default::default()
        });
        let (outer, payload) = to_canon(&sent).expect("a schedule has a canon home");
        assert_eq!(outer, TEXT);

        let envelope = fancy::feature::TextEnvelope::decode(payload.as_slice())
            .expect("the server's own decode");
        let Some(fancy::feature::text_envelope::Body::Schedule(schedule)) = envelope.body else {
            panic!("expected a schedule");
        };
        assert_eq!(schedule.channels, vec![4]);
        assert_eq!(schedule.trees, vec![7]);
        assert_eq!(schedule.body, "stand-up in five");
        assert_eq!(schedule.deliver_at_ms, 1_723_200_000_000);
        assert!(schedule.schedule_id.is_empty(), "the id is the server's to assign");
    }

    #[test]
    fn a_schedule_list_comes_back_as_the_rows_the_panel_renders() {
        let list = fancy::feature::TextEnvelope {
            body: Some(fancy::feature::text_envelope::Body::List(
                fancy::feature::ScheduleList {
                    messages: vec![fancy::feature::Scheduled {
                        schedule_id: "s-1".to_owned(),
                        channels: vec![4],
                        trees: Vec::new(),
                        body: "stand-up in five".to_owned(),
                        deliver_at_ms: 1_723_200_000_000,
                        creator: 9,
                        creator_cert: vec![0xab, 0xcd],
                        creator_name: "alice".to_owned(),
                        created_at_ms: 1_723_100_000_000,
                        status: fancy::feature::ScheduleStatus::SchedulePending as i32,
                    }],
                },
            )),
        };
        let back = from_canon(TEXT, &list.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::FancyScheduledMessageListResponse(response) = back else {
            panic!("expected a schedule list");
        };
        let [row] = response.messages.as_slice() else {
            panic!("expected the one pending row");
        };
        assert_eq!(row.schedule_id.as_deref(), Some("s-1"));
        assert_eq!(row.channel_id, vec![4]);
        assert_eq!(row.message.as_deref(), Some("stand-up in five"));
        assert_eq!(row.deliver_at, Some(1_723_200_000_000));
        assert_eq!(row.creator_session, Some(9));
        assert_eq!(row.creator_hash.as_deref(), Some("abcd"));
        assert_eq!(row.creator_name.as_deref(), Some("alice"));
        assert_eq!(row.status, Some(0), "pending, in both vocabularies");
    }

    #[test]
    fn a_cancel_names_its_schedule_and_a_refusal_arrives_with_the_reason() {
        let sent = ControlMessage::FancyScheduledMessageCancel(
            mumble_tcp::FancyScheduledMessageCancel {
                schedule_id: Some("s-1".to_owned()),
            },
        );
        let (outer, payload) = to_canon(&sent).expect("a cancel has a canon home");
        assert_eq!(outer, TEXT);
        let envelope = fancy::feature::TextEnvelope::decode(payload.as_slice())
            .expect("the server's own decode");
        let Some(fancy::feature::text_envelope::Body::Cancel(cancel)) = envelope.body else {
            panic!("expected a cancel");
        };
        assert_eq!(cancel.schedule_id, "s-1");

        // A refusal never stored anything, so its ack names no id - and the
        // client must see `None` rather than an id that never existed.
        let refusal = fancy::feature::TextEnvelope {
            body: Some(fancy::feature::text_envelope::Body::Ack(
                fancy::feature::ScheduleAck {
                    schedule_id: String::new(),
                    status: fancy::feature::ScheduleStatus::ScheduleRefused as i32,
                    reason: "a scheduled message needs a target channel".to_owned(),
                },
            )),
        };
        let back = from_canon(TEXT, &refusal.encode_to_vec())
            .unwrap()
            .expect("decodes");
        let ControlMessage::FancyScheduledMessageAck(ack) = back else {
            panic!("expected an ack");
        };
        assert_eq!(ack.schedule_id, None);
        assert_eq!(ack.status, Some(3), "refused, in both vocabularies");
        assert_eq!(
            ack.reason.as_deref(),
            Some("a scheduled message needs a target channel")
        );
    }

    /// The canon body an audit query becomes.
    fn audit_body(query: mumble_tcp::FancyAuditQuery) -> fancy::feature::audit_envelope::Body {
        let (outer, payload) =
            to_canon(&ControlMessage::FancyAuditQuery(query)).expect("audit has a canon home");
        assert_eq!(outer, AUDIT);
        fancy::feature::AuditEnvelope::decode(payload.as_slice())
            .expect("our own envelope")
            .body
            .expect("a body")
    }

    #[test]
    fn an_audit_query_carries_its_filters_into_the_canon() {
        // Before this translation existed the tab's query was `ServerOnly` with
        // no canon form, so the codec refused to send it at all: against
        // Starling the Audit tab produced silence, not an error.
        let body = audit_body(mumble_tcp::FancyAuditQuery {
            query_id: Some("q-1".to_owned()),
            categories: vec!["audit.ban".to_owned()],
            target_user_id: Some(7),
            since_ms: Some(100),
            until_ms: Some(200),
            limit: Some(25),
            ..Default::default()
        });
        let fancy::feature::audit_envelope::Body::Query(query) = body else {
            panic!("a search must become a Query");
        };
        assert_eq!(query.query_id, "q-1");
        assert_eq!(query.category, "audit.ban");
        assert_eq!(query.target_account, 7);
        assert_eq!(query.since_ms, 100);
        assert_eq!(query.until_ms, 200);
        assert_eq!(query.page.expect("a cursor").limit, 25);
    }

    #[test]
    fn an_unlimited_query_asks_for_a_page_rather_than_none() {
        // proto3 cannot tell "no limit" from zero, and a zero forwarded as-is
        // is what made an unbounded query return a single row.
        let body = audit_body(mumble_tcp::FancyAuditQuery::default());
        let fancy::feature::audit_envelope::Body::Query(query) = body else {
            panic!("a search must become a Query");
        };
        assert_eq!(query.page.expect("a cursor").limit, AUDIT_DEFAULT_LIMIT);

        // And a client asking for more than the server will give is clamped
        // here rather than being silently given less than it asked for.
        let body = audit_body(mumble_tcp::FancyAuditQuery {
            limit: Some(10_000),
            ..Default::default()
        });
        let fancy::feature::audit_envelope::Body::Query(query) = body else {
            panic!("a search must become a Query");
        };
        assert_eq!(query.page.expect("a cursor").limit, AUDIT_MAX_LIMIT);
    }

    #[test]
    fn a_chain_verification_is_its_own_canon_body() {
        // Not a search with a flag on it: a verify reads every row and a search
        // reads a page, so they are separated on the wire.
        let body = audit_body(mumble_tcp::FancyAuditQuery {
            query_id: Some("v-1".to_owned()),
            verify_chain: Some(true),
            ..Default::default()
        });
        let fancy::feature::audit_envelope::Body::Verify(verify) = body else {
            panic!("verify_chain must become a Verify");
        };
        assert_eq!(verify.query_id, "v-1");
    }

    #[test]
    fn a_page_comes_back_correlated_to_the_query_that_asked_for_it() {
        // The store drops any response whose `queryId` is not the one it last
        // sent, so a page that loses the id is a page the tab never renders -
        // indistinguishable, on screen, from a server that answered nothing.
        let envelope = fancy::feature::AuditEnvelope {
            body: Some(fancy::feature::audit_envelope::Body::Page(
                fancy::feature::Page {
                    query_id: "q-9".to_owned(),
                    records: vec![fancy::feature::AuditRecord {
                        id: "0192-abc".to_owned(),
                        at_ms: 1_700_000_000_000,
                        category: "audit.ban".to_owned(),
                        action: "issued".to_owned(),
                        actor: "SuperUser".to_owned(),
                        detail: "spam".to_owned(),
                        entry_hash: "deadbeef".to_owned(),
                        target_account: 7,
                        target_channel: 3,
                    }],
                    page: Some(fancy::wire::PageInfo {
                        more: true,
                        ..Default::default()
                    }),
                },
            )),
        };

        let decoded = from_canon(AUDIT, &envelope.encode_to_vec())
            .expect("decodable")
            .expect("a page is translated");
        let ControlMessage::FancyAuditResponse(response) = decoded else {
            panic!("a Page must become a FancyAuditResponse");
        };
        assert_eq!(response.query_id.as_deref(), Some("q-9"));
        assert_eq!(response.has_more, Some(true));
        assert_eq!(response.entries.len(), 1);

        let entry = &response.entries[0];
        assert_eq!(entry.category.as_deref(), Some("audit.ban"));
        assert_eq!(entry.actor_name.as_deref(), Some("SuperUser"));
        assert_eq!(entry.target_user_id, Some(7));
        assert_eq!(entry.channel_id, Some(3));
        // The verb has to survive: the table shows it, and a row that says
        // "audit.ban" without "issued" has lost what happened.
        assert_eq!(entry.reason.as_deref(), Some("issued"));
        assert!(
            entry
                .detail_json
                .as_deref()
                .unwrap_or_default()
                .contains("spam")
        );
    }

    #[test]
    fn a_verify_result_becomes_the_chain_status_the_card_renders() {
        for (intact, checked) in [(true, 12_u64), (false, 4)] {
            let envelope = fancy::feature::AuditEnvelope {
                body: Some(fancy::feature::audit_envelope::Body::VerifyResult(
                    fancy::feature::VerifyResult {
                        intact,
                        checked,
                        broken_at: if intact { String::new() } else { "0192-x".to_owned() },
                        query_id: "v-2".to_owned(),
                    },
                )),
            };
            let decoded = from_canon(AUDIT, &envelope.encode_to_vec())
                .expect("decodable")
                .expect("a verify result is translated");
            let ControlMessage::FancyAuditResponse(response) = decoded else {
                panic!("a VerifyResult must become a FancyAuditResponse");
            };
            assert_eq!(response.query_id.as_deref(), Some("v-2"));
            assert_eq!(response.chain_ok, Some(intact));
            assert_eq!(response.chain_height, Some(checked));
            // The card prints this verbatim on a break and hides it otherwise.
            assert_eq!(response.chain_error.is_some(), !intact);
        }
    }

    #[test]
    fn a_config_carries_the_chain_height_the_card_shows_before_any_verify() {
        let envelope = fancy::feature::AuditEnvelope {
            body: Some(fancy::feature::audit_envelope::Body::Config(
                fancy::feature::Config {
                    enabled: true,
                    categories: vec!["audit.ban".to_owned(), "audit.move".to_owned()],
                    retention_days: 30,
                    chain_height: 41,
                },
            )),
        };
        let decoded = from_canon(AUDIT, &envelope.encode_to_vec())
            .expect("decodable")
            .expect("a config is translated");
        let ControlMessage::FancyAuditConfig(config) = decoded else {
            panic!("a Config must become a FancyAuditConfig");
        };
        assert_eq!(config.chain_height, Some(41));
        // Starling has no SQL sandbox; offering the editor would be offering a
        // mode every use of which is refused.
        assert_eq!(config.advanced_sql_available, Some(false));
        assert!(
            config
                .settings
                .iter()
                .any(|s| s.key.as_deref() == Some("audit.retention_days")
                    && s.value.as_deref() == Some("30"))
        );
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

