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
//! * **link-preview, userdata, plugins admin** - the canon does not cover these
//!   yet, deliberately: their services do not implement them, and designing a
//!   wire ahead of the code is what produced the gaps in the first place.
//!
//! # Screen sharing
//!
//! `WebRtcSignal` was on that list once, on the argument that the canon models
//! a share where this models a relayed blob. What made that wrong is what
//! `None` *does*: it routes the feature down the `PluginDataTransmission`
//! relay, which is client-to-client mesh, so screen sharing worked against
//! Starling while its SFU never saw a packet - and an SFU is exactly what a
//! share with more than a couple of viewers needs.
//!
//! The canon carries `WebRtcSignal` at inner tag 7 of the screenshare
//! envelope: same four fields, same numbers, same meanings.

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
/// Outer type for screen- and camera-share signalling.
const SCREENSHARE: u16 = 1008;
/// Outer type for the operator record.
const AUDIT: u16 = 1012;
/// Outer type for chat and its history - which is where scheduled messages
/// live, because at the due time a scheduled message *is* a text message.
const TEXT: u16 = 1005;
/// Outer type for accounts: the caller's own registration, and the settings
/// stored against it.
const USERDATA: u16 = 1003;
/// Outer type for runtime-mutable settings, which is where livery lives:
/// `server-config` owns the document, so its envelope carries it.
const SERVER_CONFIG: u16 = 1013;

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
            // Not `subscribe`, which is the *device* mute set. This is the
            // live-delivery subscription for this session (fork wire 125), and
            // the two were one body until Starling grew the second: a client
            // muting a channel for its phone was also silently re-registering
            // for live delivery, and the server could not tell which had been
            // asked for.
            return Some((PUSH, live_subscribe(&subscribe_push.muted_channels)));
        }
        ControlMessage::FancyAccountSettingsUpdate(update) => {
            return account_update_to_canon(update).map(|payload| (USERDATA, payload));
        }
        ControlMessage::FancyAuditQuery(query) => {
            return Some((AUDIT, audit_query_to_canon(query)));
        }
        // The screen-share signalling, reframed rather than mapped: the canon
        // carries this message itself, with the same four fields under the same
        // numbers. `sender_session` goes out empty whatever this client put
        // there - the server stamps it from the connection the frame arrived
        // on, and on this path a sender field a client fills is a client
        // signalling as somebody else, which is hijacking their broadcast.
        ControlMessage::WebRtcSignal(signal) => {
            let envelope = fancy::screenshare::ScreenshareEnvelope {
                body: Some(fancy::screenshare::screenshare_envelope::Body::Signal(
                    fancy::screenshare::WebRtcSignal {
                        target_session: signal.target_session.unwrap_or_default(),
                        sender_session: 0,
                        signal_type: signal.signal_type.unwrap_or_default(),
                        payload: signal.payload.clone().unwrap_or_default(),
                    },
                )),
            };
            return Some((SCREENSHARE, envelope.encode_to_vec()));
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
        // -- The fancy_v1 key ladder ---------------------------------------
        //
        // Every field below is load-bearing, and the reason this arm is written
        // out rather than mapped mechanically: the recipient *verifies* these.
        // An announce is refused unless its Ed25519 self-signature checks out
        // over the tuple it carries, and a delivery cannot even be opened
        // without `sender_cert` to resolve the sealer's keys. A translation
        // that dropped any of them would put a frame on the wire that looks
        // right, relays fine, and fails at the far end as a crypto error.
        //
        // Certificate hashes cross as bytes and live in this client as lowercase
        // hex, the same convention `pchat_deliver` reads them back under. The
        // hex form is what the announce signature is computed over, so the
        // round trip has to be exact - `canon-fixtures.json` is what holds that
        // to account rather than a comment.
        ControlMessage::PchatKeyAnnounce(announce) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::KeyAnnounce(
                    fancy::pchat::KeyAnnounce {
                        channel: announce.channel_id.unwrap_or_default(),
                        epoch: 0,
                        public_key: announce.identity_public.clone().unwrap_or_default(),
                        holder_cert: unhex(announce.cert_hash.as_deref().unwrap_or_default()),
                        signing_public: announce.signing_public.clone().unwrap_or_default(),
                        signature: announce.signature.clone().unwrap_or_default(),
                        tls_signature: announce.tls_signature.clone().unwrap_or_default(),
                        algorithm_version: announce.algorithm_version.unwrap_or_default(),
                        announced_at_ms: announce.timestamp.unwrap_or_default(),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        ControlMessage::PchatKeyRequest(request) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::KeyRequest(
                    fancy::pchat::KeyRequest {
                        channel: request.channel_id.unwrap_or_default(),
                        epoch: 0,
                        requester_key: request.requester_public.clone().unwrap_or_default(),
                        requester_cert: unhex(
                            request.requester_hash.as_deref().unwrap_or_default(),
                        ),
                        request_id: request.request_id.clone().unwrap_or_default(),
                        protocol: request.protocol.unwrap_or_default(),
                        relay_cap: request.relay_cap.unwrap_or_default(),
                        requested_at_ms: request.timestamp.unwrap_or_default(),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        // A key exchange is this client's name for the canon's `KeyDeliver`.
        // `recipient` is left 0 deliberately: the sender addresses an identity,
        // and the server resolves it to a live session from `recipient_cert`,
        // which is the only end that holds that map.
        ControlMessage::PchatKeyExchange(exchange) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::KeyDeliver(
                    fancy::pchat::KeyDeliver {
                        channel: exchange.channel_id.unwrap_or_default(),
                        epoch: exchange.epoch.unwrap_or_default(),
                        recipient: 0,
                        sealed_key: exchange.encrypted_key.clone().unwrap_or_default(),
                        countersignature: exchange.countersignature.clone().unwrap_or_default(),
                        recipient_cert: unhex(
                            exchange.recipient_hash.as_deref().unwrap_or_default(),
                        ),
                        sender_cert: unhex(exchange.sender_hash.as_deref().unwrap_or_default()),
                        signature: exchange.signature.clone().unwrap_or_default(),
                        request_id: exchange.request_id.clone().unwrap_or_default(),
                        epoch_fingerprint: exchange.epoch_fingerprint.clone().unwrap_or_default(),
                        parent_fingerprint: exchange.parent_fingerprint.clone().unwrap_or_default(),
                        countersigner_cert: unhex(
                            exchange.countersigner_hash.as_deref().unwrap_or_default(),
                        ),
                        algorithm_version: exchange.algorithm_version.unwrap_or_default(),
                        protocol: exchange.protocol.unwrap_or_default(),
                        delivered_at_ms: exchange.timestamp.unwrap_or_default(),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        // One holder, ourselves: this client reports what it holds, and the
        // canon's plural carries the whole set a server would have aggregated.
        ControlMessage::PchatKeyHolderReport(report) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::HolderReport(
                    fancy::pchat::HolderReport {
                        channel: report.channel_id.unwrap_or_default(),
                        epoch: 0,
                        holder_certs: vec![unhex(report.cert_hash.as_deref().unwrap_or_default())],
                        takeover_mode: report.takeover_mode.unwrap_or_default(),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        ControlMessage::PchatKeyHoldersQuery(query) => {
            let envelope = fancy::pchat::PchatEnvelope {
                body: Some(fancy::pchat::pchat_envelope::Body::HolderQuery(
                    fancy::pchat::HolderQuery {
                        channel: query.channel_id.unwrap_or_default(),
                    },
                )),
            };
            return Some((PCHAT, envelope.encode_to_vec()));
        }
        ControlMessage::FancyLiveryQuery(query) => {
            return Some((
                SERVER_CONFIG,
                fancy::domain::ServerConfigEnvelope {
                    body: Some(fancy::domain::server_config_envelope::Body::LiveryQuery(
                        query.clone(),
                    )),
                }
                .encode_to_vec(),
            ));
        }
        ControlMessage::FancyLiveryUpdate(update) => {
            return Some((
                SERVER_CONFIG,
                fancy::domain::ServerConfigEnvelope {
                    body: Some(fancy::domain::server_config_envelope::Body::LiveryUpdate(
                        update.clone(),
                    )),
                }
                .encode_to_vec(),
            ));
        }
        ControlMessage::FancyOperatorTicketRequest(request) => {
            return Some((
                SERVER_CONFIG,
                fancy::domain::ServerConfigEnvelope {
                    body: Some(fancy::domain::server_config_envelope::Body::TicketRequest(
                        request.clone(),
                    )),
                }
                .encode_to_vec(),
            ));
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

/// One self-service account action, as the canon envelope that carries it.
///
/// The two enums do not line up, and neither is wrong. Epoch 0 names the two
/// halves of enrolling a second factor separately (`TOTP_BEGIN`, then
/// `TOTP_VERIFY`); the canon has one `ENABLE_TOTP` and reads the halves off
/// whether a code came with it, which is also how the server implements it.
/// `QUERY` is not an action at all on the canon - it is its own body, because
/// asking is not a mutation and the surface that answers it needs no password.
fn account_update_to_canon(update: &mumble_tcp::FancyAccountSettingsUpdate) -> Option<Vec<u8>> {
    use fancy::domain::account_action::Kind;
    use fancy::domain::userdata_envelope::Body;
    use mumble_tcp::fancy_account_settings_update::Action;

    let value = update.value.clone().unwrap_or_default();
    let action = Action::try_from(update.action).ok()?;
    let body = match action {
        Action::Query => Body::AccountQuery(fancy::domain::AccountQuery {}),
        _ => {
            let (kind, totp) = match action {
                // Handled above; listed so a new variant fails to compile here
                // rather than silently becoming a password change.
                Action::Query => return None,
                Action::SetPassword => (Kind::SetPassword, String::new()),
                Action::ClearPassword => (Kind::ClearPassword, String::new()),
                Action::Rename => (Kind::Rename, String::new()),
                Action::SetEmail => (Kind::SetEmail, String::new()),
                Action::Unregister => (Kind::Unregister, String::new()),
                // No code yet: this is the half that asks for the secret.
                Action::TotpBegin => (Kind::EnableTotp, String::new()),
                // The same verb, now carrying the proof.
                Action::TotpVerify => (Kind::EnableTotp, value.clone()),
                Action::TotpDisable => (Kind::DisableTotp, value.clone()),
            };
            Body::Action(fancy::domain::AccountAction {
                kind: kind as i32,
                current_password: update.current_password.clone().unwrap_or_default(),
                // The TOTP verbs carry their argument in `totp`, not in
                // `value`; sending it in both would have the server read a code
                // as a new password.
                value: if totp.is_empty() { value } else { String::new() },
                totp,
            })
        }
    };
    Some(fancy::domain::UserdataEnvelope { body: Some(body) }.encode_to_vec())
}

/// The epoch-0 action an ack belongs to.
///
/// The inverse of the mapping above, and lossy in exactly one place: the canon
/// answers both halves of an enrolment with `ENABLE_TOTP`. A secret comes back
/// only from the first half, so its presence is what tells them apart - the
/// same signal the client's own store already keys the enrolment on.
fn account_ack_action(ack: &fancy::domain::AccountAck) -> u32 {
    use fancy::domain::account_action::Kind;
    use mumble_tcp::fancy_account_settings_update::Action;

    let action = match Kind::try_from(ack.kind) {
        Ok(Kind::SetPassword) => Action::SetPassword,
        Ok(Kind::ClearPassword) => Action::ClearPassword,
        Ok(Kind::SetEmail) => Action::SetEmail,
        Ok(Kind::Rename) => Action::Rename,
        Ok(Kind::DisableTotp) => Action::TotpDisable,
        Ok(Kind::Unregister) => Action::Unregister,
        Ok(Kind::EnableTotp) if !ack.totp_secret.is_empty() => Action::TotpBegin,
        Ok(Kind::EnableTotp) => Action::TotpVerify,
        // A refusal of something this client did not send - `to_canon` never
        // produces `UNSPECIFIED`. Reported against `QUERY`, the one action that
        // is always in flight when the page is open, so the user sees the
        // server's sentence instead of nothing at all.
        Ok(Kind::Unspecified) | Err(_) => Action::Query,
    };
    action as u32
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
                Some(Social::Reaction(reaction)) => Some(ControlMessage::PchatReactionDeliver(
                    reaction_deliver(&reaction),
                )),
                Some(Social::Receipt(receipt)) => Some(ControlMessage::FancyReadReceiptDeliver(
                    receipt_deliver(&receipt),
                )),
                Some(Social::Poll(poll)) => {
                    Some(ControlMessage::FancyPoll(mumble_tcp::FancyPoll {
                    channel_id: Some(poll.channel),
                    poll_id: Some(poll.poll_id),
                    question: Some(poll.question),
                    options: poll.options,
                    multiple: Some(poll.multiple),
                    creator_session: session(poll.creator),
                    ..Default::default()
                    }))
                }
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
                Some(fancy::feature::push_envelope::Body::Subscribe(subscribe)) => Some(
                    ControlMessage::FancySubscribePush(mumble_tcp::FancySubscribePush {
                            muted_channels: subscribe.muted,
                    }),
                ),
                Some(fancy::feature::push_envelope::Body::LiveSubscribe(subscribe)) => Some(
                    ControlMessage::FancySubscribePush(mumble_tcp::FancySubscribePush {
                        muted_channels: subscribe.muted,
                    }),
                ),
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
        SCREENSHARE => {
            let Ok(envelope) = fancy::screenshare::ScreenshareEnvelope::decode(payload) else {
                return Ok(None);
            };
            Ok(match envelope.body {
                Some(fancy::screenshare::screenshare_envelope::Body::Signal(signal)) => {
                    Some(ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
                        target_session: Some(signal.target_session),
                        sender_session: Some(signal.sender_session),
                        signal_type: Some(signal.signal_type),
                        payload: Some(signal.payload),
                    }))
                }
                // The share canon's own arms. This client speaks the signal
                // dialect and has no handler for them, and inventing one here
                // would be translating into a vocabulary the app above does not
                // have. `None` leaves them to the codec's unknown-arm path,
                // which is what a message from a newer peer should hit.
                _ => None,
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
        USERDATA => {
            use fancy::domain::userdata_envelope::Body;

            let envelope = fancy::domain::UserdataEnvelope::decode(payload)?;
            Ok(match envelope.body {
                Some(Body::Account(state)) => Some(ControlMessage::FancyAccountSettings(
                    mumble_tcp::FancyAccountSettings {
                        registered: Some(state.registered),
                        user_id: Some(u32::try_from(state.id).unwrap_or(u32::MAX)),
                        name: Some(state.name),
                        email: Some(state.email),
                        has_password: Some(state.has_password),
                        totp_enabled: Some(state.totp_enabled),
                        cert_hash: Some(hex(&state.cert_hash)),
                        cert_matches_session: Some(state.cert_matches_session),
                    },
                )),
                Some(Body::Ack(ack)) => Some(ControlMessage::FancyAccountAck(
                    mumble_tcp::FancyAccountAck {
                        action: account_ack_action(&ack),
                        ok: ack.ok,
                        // Epoch 0 promised a machine-readable code and the
                        // canon carries a sentence. Passing the sentence
                        // through is the honest translation: inventing a code
                        // for it would be inventing one the catalogue does not
                        // have, and the panel already falls back to showing
                        // what it was given.
                        error: (!ack.ok && !ack.detail.is_empty()).then(|| ack.detail.clone()),
                        totp_secret: (!ack.totp_secret.is_empty()).then_some(ack.totp_secret),
                        totp_uri: (!ack.totp_uri.is_empty()).then_some(ack.totp_uri),
                    },
                )),
                // The stored client settings, which this client keeps locally,
                // plus the client->server bodies.
                _ => None,
            })
        }
        SERVER_CONFIG => {
            let envelope = fancy::domain::ServerConfigEnvelope::decode(payload)?;
            Ok(match envelope.body {
                Some(fancy::domain::server_config_envelope::Body::Livery(doc)) => {
                    Some(ControlMessage::FancyServerLivery(doc))
                }
                Some(fancy::domain::server_config_envelope::Body::TicketReply(reply)) => {
                    Some(ControlMessage::FancyOperatorTicketReply(reply))
                }
                // The settings half of this envelope has no `ControlMessage`
                // yet; livery is the first thing on 1013 the client acts on.
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
                // The key ladder, relayed to us by a peer. The inverse of the
                // arms in `to_canon`, and lossless in the same way: what
                // arrives here is what the peer's key manager will verify.
                Some(fancy::pchat::pchat_envelope::Body::KeyAnnounce(announce)) => Some(
                    ControlMessage::PchatKeyAnnounce(mumble_tcp::PchatKeyAnnounce {
                        algorithm_version: Some(announce.algorithm_version),
                        identity_public: Some(announce.public_key.clone()),
                        signing_public: Some(announce.signing_public.clone()),
                        cert_hash: Some(hex(&announce.holder_cert)),
                        timestamp: Some(announce.announced_at_ms),
                        signature: Some(announce.signature.clone()),
                        tls_signature: Some(announce.tls_signature.clone()),
                        channel_id: Some(announce.channel),
                    }),
                ),
                Some(fancy::pchat::pchat_envelope::Body::KeyRequest(request)) => Some(
                    ControlMessage::PchatKeyRequest(mumble_tcp::PchatKeyRequest {
                        channel_id: Some(request.channel),
                        protocol: Some(request.protocol),
                        requester_hash: Some(hex(&request.requester_cert)),
                        requester_public: Some(request.requester_key.clone()),
                        request_id: Some(request.request_id.clone()),
                        timestamp: Some(request.requested_at_ms),
                        relay_cap: Some(request.relay_cap),
                    }),
                ),
                Some(fancy::pchat::pchat_envelope::Body::KeyDeliver(deliver)) => Some(
                    ControlMessage::PchatKeyExchange(mumble_tcp::PchatKeyExchange {
                        channel_id: Some(deliver.channel),
                        protocol: Some(deliver.protocol),
                        epoch: Some(deliver.epoch),
                        encrypted_key: Some(deliver.sealed_key.clone()),
                        sender_hash: Some(hex(&deliver.sender_cert)),
                        recipient_hash: Some(hex(&deliver.recipient_cert)),
                        request_id: Some(deliver.request_id.clone()),
                        timestamp: Some(deliver.delivered_at_ms),
                        algorithm_version: Some(deliver.algorithm_version),
                        signature: Some(deliver.signature.clone()),
                        parent_fingerprint: Some(deliver.parent_fingerprint.clone()),
                        epoch_fingerprint: Some(deliver.epoch_fingerprint.clone()),
                        countersignature: Some(deliver.countersignature.clone()),
                        countersigner_hash: Some(hex(&deliver.countersigner_cert)),
                    }),
                ),
                // One report per holder, which is the shape this client's
                // handler folds in; the canon carries the set a server would
                // have aggregated, so a multi-holder report becomes the first
                // entry and the rest arrive as their own reports.
                Some(fancy::pchat::pchat_envelope::Body::HolderReport(report)) => Some(
                    ControlMessage::PchatKeyHolderReport(mumble_tcp::PchatKeyHolderReport {
                        channel_id: Some(report.channel),
                        cert_hash: report.holder_certs.first().map(|cert| hex(cert)),
                        takeover_mode: Some(report.takeover_mode),
                    }),
                ),
                Some(fancy::pchat::pchat_envelope::Body::HolderQuery(query)) => Some(
                    ControlMessage::PchatKeyHoldersQuery(mumble_tcp::PchatKeyHoldersQuery {
                        channel_id: Some(query.channel),
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

/// The same list, asking for live delivery to *this session* rather than for
/// quiet on this device.
///
/// The client sends both after a sync and both when the user changes a mute,
/// carrying the same set; they are separate bodies because they are separate
/// questions, and the server answers them in different places.
fn live_subscribe(muted: &[u32]) -> Vec<u8> {
    fancy::feature::PushEnvelope {
        body: Some(fancy::feature::push_envelope::Body::LiveSubscribe(
            fancy::feature::LiveSubscribe {
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

/// The inverse of [`hex`], for a certificate hash on its way to the canon.
///
/// Lenient by borrowing `fancy_utils`: a malformed hash yields short bytes
/// rather than an error, and the far end refuses it on the signature it fails
/// to verify - a better failure than a frame this client declines to send for
/// a reason the user cannot see.
fn unhex(value: &str) -> Vec<u8> {
    fancy_utils::hex::hex_to_bytes(value)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn a_livery_document_comes_back_off_the_wire() {
        // Without this arm the client sends and receives nothing, silently, and
        // the symptom is a feature that looks implemented and does nothing.
        let payload = fancy::domain::ServerConfigEnvelope {
            body: Some(fancy::domain::server_config_envelope::Body::Livery(
                fancy::domain::LiveryDoc {
                    version: 3,
                    digest: vec![1, 2, 3, 4, 5, 6, 7, 8],
                    tagline: "cozy corner".to_owned(),
                    ..Default::default()
                },
            )),
        }
        .encode_to_vec();

        match from_canon(SERVER_CONFIG, &payload).expect("decodes") {
            Some(ControlMessage::FancyServerLivery(doc)) => {
                assert_eq!(doc.tagline, "cozy corner");
                assert_eq!(doc.version, 3);
                assert_eq!(doc.digest.len(), 8);
            }
            other => panic!("not a livery: {other:?}"),
        }
    }

    #[test]
    fn the_settings_half_of_1013_is_still_ignored_rather_than_mistaken_for_livery() {
        let payload = fancy::domain::ServerConfigEnvelope {
            body: Some(fancy::domain::server_config_envelope::Body::Values(
                fancy::domain::ConfigValues {
                    settings: Vec::new(),
                    version: 1,
                },
            )),
        }
        .encode_to_vec();
        assert!(from_canon(SERVER_CONFIG, &payload).expect("decodes").is_none());
    }


    /// The canon body one account action translates to.
    fn account_body(
        action: mumble_tcp::fancy_account_settings_update::Action,
        value: Option<&str>,
        password: Option<&str>,
    ) -> fancy::domain::userdata_envelope::Body {
        let (outer, payload) = to_canon(&ControlMessage::FancyAccountSettingsUpdate(
            mumble_tcp::FancyAccountSettingsUpdate {
                action: action as i32,
                value: value.map(str::to_owned),
                current_password: password.map(str::to_owned),
            },
        ))
        .expect("the account surface has a canon form");
        assert_eq!(outer, USERDATA);
        fancy::domain::UserdataEnvelope::decode(payload.as_slice())
            .expect("an envelope")
            .body
            .expect("a body")
    }

    #[test]
    fn asking_about_your_own_account_reaches_the_server() {
        // The whole bug: with no arm for this, `to_canon` answered `None`, the
        // codec dropped a `ServerOnly` message, and the account page waited for
        // an answer to a question that was never asked.
        assert!(matches!(
            account_body(
                mumble_tcp::fancy_account_settings_update::Action::Query,
                None,
                None,
            ),
            fancy::domain::userdata_envelope::Body::AccountQuery(_)
        ));
    }

    #[test]
    fn a_totp_code_travels_as_a_code_and_not_as_a_new_password() {
        // Both halves of an enrolment are one canon verb, told apart by whether
        // a code came with it. Putting the code in `value` as well would have
        // the server read it as the argument of whatever verb it decoded.
        let fancy::domain::userdata_envelope::Body::Action(begin) = account_body(
            mumble_tcp::fancy_account_settings_update::Action::TotpBegin,
            None,
            Some("correct horse"),
        ) else {
            panic!("expected an action");
        };
        assert_eq!(begin.kind, fancy::domain::account_action::Kind::EnableTotp as i32);
        assert!(begin.totp.is_empty(), "the first half carries no code");
        assert_eq!(begin.current_password, "correct horse");

        let fancy::domain::userdata_envelope::Body::Action(verify) = account_body(
            mumble_tcp::fancy_account_settings_update::Action::TotpVerify,
            Some("123456"),
            Some("correct horse"),
        ) else {
            panic!("expected an action");
        };
        assert_eq!(verify.kind, fancy::domain::account_action::Kind::EnableTotp as i32);
        assert_eq!(verify.totp, "123456");
        assert!(verify.value.is_empty(), "a code is not a password");
    }

    #[test]
    fn an_enrolment_ack_is_told_from_its_confirmation_by_the_secret_on_it() {
        // One canon verb answers both halves, and the panel keys its enrolment
        // state on the epoch-0 action, so a confirmation reported as a fresh
        // enrolment would show the user a secret they already scanned.
        let with_secret = fancy::domain::UserdataEnvelope {
            body: Some(fancy::domain::userdata_envelope::Body::Ack(
                fancy::domain::AccountAck {
                    kind: fancy::domain::account_action::Kind::EnableTotp as i32,
                    ok: true,
                    totp_secret: "JBSWY3DP".to_owned(),
                    totp_uri: "otpauth://totp/x:ada?secret=JBSWY3DP".to_owned(),
                    ..Default::default()
                },
            )),
        }
        .encode_to_vec();
        let ControlMessage::FancyAccountAck(begun) = from_canon(USERDATA, &with_secret)
            .expect("decodes")
            .expect("an ack")
        else {
            panic!("expected an ack");
        };
        assert_eq!(
            begun.action,
            mumble_tcp::fancy_account_settings_update::Action::TotpBegin as u32
        );
        assert_eq!(begun.totp_uri.as_deref(), Some("otpauth://totp/x:ada?secret=JBSWY3DP"));

        let confirmed = fancy::domain::UserdataEnvelope {
            body: Some(fancy::domain::userdata_envelope::Body::Ack(
                fancy::domain::AccountAck {
                    kind: fancy::domain::account_action::Kind::EnableTotp as i32,
                    ok: true,
                    ..Default::default()
                },
            )),
        }
        .encode_to_vec();
        let ControlMessage::FancyAccountAck(done) = from_canon(USERDATA, &confirmed)
            .expect("decodes")
            .expect("an ack")
        else {
            panic!("expected an ack");
        };
        assert_eq!(
            done.action,
            mumble_tcp::fancy_account_settings_update::Action::TotpVerify as u32
        );
        assert_eq!(done.totp_secret, None);
    }

    #[test]
    fn the_account_snapshot_arrives_with_its_certificate_in_the_form_the_client_compares() {
        // The canon carries the fingerprint as bytes and every comparison on
        // this side is against lower-case hex.
        let payload = fancy::domain::UserdataEnvelope {
            body: Some(fancy::domain::userdata_envelope::Body::Account(
                fancy::domain::AccountState {
                    registered: true,
                    id: 7,
                    name: "ada".to_owned(),
                    email: "ada@example.org".to_owned(),
                    has_password: true,
                    totp_enabled: false,
                    cert_hash: vec![0xde, 0xad, 0xbe, 0xef],
                    cert_matches_session: true,
                },
            )),
        }
        .encode_to_vec();
        let ControlMessage::FancyAccountSettings(state) = from_canon(USERDATA, &payload)
            .expect("decodes")
            .expect("a snapshot")
        else {
            panic!("expected a snapshot");
        };
        assert_eq!(state.registered, Some(true));
        assert_eq!(state.user_id, Some(7));
        assert_eq!(state.name.as_deref(), Some("ada"));
        assert_eq!(state.cert_hash.as_deref(), Some("deadbeef"));
        assert_eq!(state.cert_matches_session, Some(true));
    }

    #[test]
    fn a_livery_query_is_framed_on_the_service_that_owns_the_document() {
        let (type_id, payload) = to_canon(&ControlMessage::FancyLiveryQuery(
            fancy::domain::LiveryQuery {
                have_keys: vec!["aa".to_owned()],
            },
        ))
        .expect("livery has a canon form");
        assert_eq!(type_id, SERVER_CONFIG);

        let envelope =
            fancy::domain::ServerConfigEnvelope::decode(payload.as_slice()).expect("an envelope");
        match envelope.body {
            Some(fancy::domain::server_config_envelope::Body::LiveryQuery(query)) => {
                assert_eq!(query.have_keys, vec!["aa".to_owned()]);
            }
            other => panic!("not a livery query: {other:?}"),
        }
    }

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
        // An audit config write: the epoch-0 shape is key/value rows whose
        // schema the plugin owned, and the canon has three typed fields.
        // Guessing which key means `retention_days` is how a config write
        // silently sets the wrong thing.
        let write = ControlMessage::FancyAuditConfigUpdate(mumble_tcp::FancyAuditConfigUpdate {
            settings: Vec::new(),
        });
        assert!(to_canon(&write).is_none());
    }

    #[test]
    fn screen_share_signalling_crosses_intact_in_both_directions() {
        // The translation that decides whether the server's SFU is reachable at
        // all: with no canon form this went down the `PluginData` relay, which
        // is client-to-client mesh, and the SFU never saw a packet.
        let sent = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            target_session: Some(7),
            sender_session: Some(999),
            signal_type: Some(2),
            payload: Some("v=0 offer".to_owned()),
        });
        let (outer, payload) = to_canon(&sent).expect("screenshare has a canon home");
        assert_eq!(outer, SCREENSHARE);

        let envelope = fancy::screenshare::ScreenshareEnvelope::decode(payload.as_slice()).unwrap();
        let Some(fancy::screenshare::screenshare_envelope::Body::Signal(signal)) = envelope.body
        else {
            panic!("expected a WebRtcSignal");
        };
        assert_eq!(signal.target_session, 7);
        assert_eq!(signal.signal_type, 2);
        assert_eq!(signal.payload, "v=0 offer");
        assert_eq!(
            signal.sender_session, 0,
            "identity is the server's to stamp; on this path a sender field a \
             client fills is a client hijacking somebody else's broadcast"
        );

        let back = from_canon(outer, &payload).unwrap().expect("decodes");
        let ControlMessage::WebRtcSignal(returned) = back else {
            panic!("expected a WebRtcSignal back");
        };
        assert_eq!(returned.target_session, Some(7));
        assert_eq!(returned.signal_type, Some(2));
        assert_eq!(returned.payload.as_deref(), Some("v=0 offer"));
    }

    #[test]
    fn an_ice_candidate_still_crosses_even_though_nothing_sends_one() {
        // The half of the old objection that was about `ICE_CANDIDATE` having
        // no home. It has one now, and it matters that it does: this client
        // stopped trickling when the SFU turned out to be ICE-lite, but a peer
        // that trickles anyway must not have its signalling silently reshaped.
        let candidate = ControlMessage::WebRtcSignal(mumble_tcp::WebRtcSignal {
            signal_type: Some(4),
            payload: Some("candidate:...".to_owned()),
            ..Default::default()
        });
        let (_, payload) = to_canon(&candidate).expect("a candidate has a home");
        let back = from_canon(SCREENSHARE, &payload).unwrap().expect("decodes");
        let ControlMessage::WebRtcSignal(returned) = back else {
            panic!("expected a WebRtcSignal back");
        };
        assert_eq!(returned.signal_type, Some(4));
        assert_eq!(returned.payload.as_deref(), Some("candidate:..."));
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
    fn muting_a_device_and_subscribing_a_session_are_different_messages() {
        // They were one: both translated to `Subscribe`, so a user muting a
        // channel for their phone also re-registered for live delivery, and
        // Starling could not tell which of the two had been asked for. The
        // fork carries them as separate wire types (123 and 125) for the same
        // reason, and they are answered in different places on the server.
        let update = ControlMessage::FancyPushUpdate(mumble_tcp::FancyPushUpdate {
            muted_channels: vec![7],
        });
        let (outer, payload) = to_canon(&update).expect("push update has a canon home");
        assert_eq!(outer, PUSH);
        let envelope = fancy::feature::PushEnvelope::decode(payload.as_slice()).unwrap();
        assert!(
            matches!(
                envelope.body,
                Some(fancy::feature::push_envelope::Body::Subscribe(_))
            ),
            "a device mute update is a Subscribe"
        );

        let subscribe = ControlMessage::FancySubscribePush(mumble_tcp::FancySubscribePush {
            muted_channels: vec![7],
        });
        let (outer, payload) = to_canon(&subscribe).expect("live subscribe has a canon home");
        assert_eq!(outer, PUSH);
        let envelope = fancy::feature::PushEnvelope::decode(payload.as_slice()).unwrap();
        let Some(fancy::feature::push_envelope::Body::LiveSubscribe(live)) = envelope.body else {
            panic!("a live subscription is a LiveSubscribe");
        };
        assert_eq!(live.muted, vec![7], "and it still carries the whole set");
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

