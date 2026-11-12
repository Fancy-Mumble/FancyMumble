//! What the engine tells its view.
//!
//! Every event crosses the engine/host seam as an [`Event`]: a [`CoreEvent`]
//! plus the session it is about. A native view matches on the enum and takes
//! the payload as the Rust value it is. A view that speaks JSON (the webview)
//! calls [`Event::into_wire`], which writes the event out under the name and
//! in the shape its frontend has always listened for.
//!
//! Not every event is typed yet. Those that are not travel as
//! [`CoreEvent::Untyped`] - a name and its JSON - so they can be moved over
//! one group at a time without the wire format changing under the frontend.

use serde::{Serialize, Serializer};
use serde_json::value::RawValue;

use super::sessions::ServerId;
use super::types::{
    CurrentChannelPayload, DisconnectedPayload, DmUnreadPayload, NewDmPayload, NewMessagePayload,
    RejectedPayload, UnreadPayload, VoiceState,
};

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
    /// An event that has not been given a variant yet: its wire name and its
    /// payload, already written out as JSON.
    Untyped {
        /// The name the frontend listens for.
        name: &'static str,
        /// The payload as JSON.
        payload: Box<RawValue>,
    },
}

impl CoreEvent {
    /// An event that has no variant yet, from its wire name and payload.
    ///
    /// # Errors
    ///
    /// When `payload` cannot be represented as JSON.
    pub(crate) fn untyped<S: Serialize>(
        name: &'static str,
        payload: S,
    ) -> Result<Self, serde_json::Error> {
        Ok(Self::Untyped {
            name,
            payload: serde_json::value::to_raw_value(&payload)?,
        })
    }

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
            Self::Untyped { name, .. } => name,
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
        )
    }
}

/// Serialises to the event's JSON payload alone, in the shape the frontend has
/// always received; the name travels separately ([`CoreEvent::name`]).
impl Serialize for CoreEvent {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Connecting => "connecting".serialize(serializer),
            Self::Connected | Self::StateChanged => ().serialize(serializer),
            Self::Disconnected(payload) => payload.serialize(serializer),
            Self::ConnectionRejected(payload) => payload.serialize(serializer),
            Self::CurrentChannelChanged(payload) => payload.serialize(serializer),
            Self::UserTalking { session, talking } => (session, talking).serialize(serializer),
            Self::VoiceStateChanged(state) => state.serialize(serializer),
            Self::NewMessage(payload) => payload.serialize(serializer),
            Self::UnreadChanged(payload) => payload.serialize(serializer),
            Self::DmUnreadChanged(payload) => payload.serialize(serializer),
            Self::NewDm(payload) => payload.serialize(serializer),
            Self::Untyped { payload, .. } => payload.serialize(serializer),
        }
    }
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
        if let CoreEvent::Untyped { payload, .. } = self.kind {
            return Ok((name, payload));
        }
        let payload = match self.server {
            Some(server) if self.kind.payload_is_object() => {
                let mut value = serde_json::to_value(&self.kind)?;
                stamp_server_id(&mut value, server.to_string());
                serde_json::value::to_raw_value(&value)?
            }
            _ => serde_json::value::to_raw_value(&self.kind)?,
        };
        Ok((name, payload))
    }
}

/// Insert (or replace) a `serverId` field into a JSON-object payload.
///
/// Replaces missing OR explicitly-null `serverId` fields.  Payloads
/// serialised from `Option<String>::None` produce `"serverId": null`,
/// which would otherwise prevent the frontend from routing the event
/// to the correct tab.
pub(crate) fn stamp_server_id(payload: &mut serde_json::Value, id: impl Into<String>) {
    if !lacks_server_id(payload) {
        return;
    }
    if let Some(obj) = payload.as_object_mut() {
        let _ = obj.insert("serverId".to_owned(), serde_json::Value::String(id.into()));
    }
}

/// Whether `payload` is an object that does not yet say which server it is
/// about. Anything else is forwarded as it is, so there is nothing to look up
/// for it.
pub(crate) fn lacks_server_id(payload: &serde_json::Value) -> bool {
    payload
        .as_object()
        .is_some_and(|obj| obj.get("serverId").is_none_or(serde_json::Value::is_null))
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use super::*;

    fn wire(server: Option<ServerId>, kind: CoreEvent) -> (&'static str, serde_json::Value) {
        let (name, payload) = Event { server, kind }.into_wire().unwrap();
        (name, serde_json::from_str(payload.get()).unwrap())
    }

    /// The frontend listens for these exact names and shapes. A typed variant
    /// must write out exactly what the untyped emit it replaced did.
    #[test]
    fn typed_events_keep_their_wire_format() {
        use serde_json::json;

        assert_eq!(
            wire(None, CoreEvent::Connecting),
            ("status-changed", json!("connecting"))
        );
        assert_eq!(
            wire(None, CoreEvent::Connected),
            ("server-connected", json!(null))
        );
        assert_eq!(
            wire(None, CoreEvent::StateChanged),
            ("state-changed", json!(null))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UserTalking {
                    session: 7,
                    talking: true
                }
            ),
            ("user-talking", json!([7, true]))
        );
        assert_eq!(
            wire(None, CoreEvent::VoiceStateChanged(VoiceState::Inactive)),
            ("voice-state-changed", json!("inactive"))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::CurrentChannelChanged(CurrentChannelPayload { channel_id: 3 })
            ),
            ("current-channel-changed", json!({ "channel_id": 3 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::NewMessage(NewMessagePayload {
                    channel_id: 3,
                    sender_session: Some(9),
                })
            ),
            (
                "new-message",
                json!({ "channel_id": 3, "sender_session": 9 })
            )
        );
        assert_eq!(
            wire(None, CoreEvent::NewDm(NewDmPayload { session: 9 })),
            ("new-dm", json!({ "session": 9 }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::UnreadChanged(UnreadPayload {
                    unreads: HashMap::from([(3, 2)]),
                })
            ),
            ("unread-changed", json!({ "unreads": { "3": 2 } }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::DmUnreadChanged(DmUnreadPayload {
                    unreads: HashMap::from([(9, 1)]),
                })
            ),
            ("dm-unread-changed", json!({ "unreads": { "9": 1 } }))
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::Disconnected(DisconnectedPayload {
                    server_id: Some("srv-1".to_owned()),
                    reason: None,
                })
            ),
            (
                "server-disconnected",
                json!({ "serverId": "srv-1", "reason": null })
            )
        );
        assert_eq!(
            wire(
                None,
                CoreEvent::ConnectionRejected(RejectedPayload {
                    server_id: None,
                    reason: "wrong password".to_owned(),
                    reject_type: Some(3),
                })
            ),
            (
                "connection-rejected",
                json!({ "serverId": null, "reason": "wrong password", "reject_type": 3 })
            )
        );
    }

    #[test]
    fn an_object_payload_is_stamped_with_its_session() {
        let server = ServerId::new();
        let (_, payload) = wire(
            Some(server),
            CoreEvent::NewMessage(NewMessagePayload {
                channel_id: 3,
                sender_session: None,
            }),
        );
        assert_eq!(payload["serverId"], serde_json::json!(server.to_string()));
        assert_eq!(payload["channel_id"], 3);

        // A payload that already names its server keeps what it says.
        let (_, payload) = wire(
            Some(server),
            CoreEvent::Disconnected(DisconnectedPayload {
                server_id: Some("other".to_owned()),
                reason: None,
            }),
        );
        assert_eq!(payload["serverId"], "other");
    }

    #[test]
    fn a_payload_that_is_not_an_object_is_left_alone() {
        let server = ServerId::new();
        assert_eq!(
            wire(Some(server), CoreEvent::StateChanged).1,
            serde_json::json!(null)
        );
        assert_eq!(
            wire(
                Some(server),
                CoreEvent::UserTalking {
                    session: 1,
                    talking: false
                }
            )
            .1,
            serde_json::json!([1, false])
        );
    }

    #[test]
    fn an_untyped_event_passes_through_unchanged() {
        let event =
            CoreEvent::untyped("server-log", serde_json::json!({ "message": "hi" })).unwrap();
        let (name, payload) = wire(Some(ServerId::new()), event);
        assert_eq!(name, "server-log");
        assert_eq!(payload, serde_json::json!({ "message": "hi" }));
    }

    #[test]
    fn stamps_missing_server_id() {
        let mut payload = serde_json::json!({ "channelId": 1 });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "srv-1");
    }

    #[test]
    fn replaces_a_null_server_id_but_keeps_a_real_one() {
        let mut payload = serde_json::json!({ "serverId": null });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "srv-1");

        let mut payload = serde_json::json!({ "serverId": "kept" });
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload["serverId"], "kept");
    }

    #[test]
    fn leaves_non_objects_untouched() {
        let mut payload = serde_json::json!(["a", "b"]);
        stamp_server_id(&mut payload, "srv-1");
        assert_eq!(payload, serde_json::json!(["a", "b"]));
    }
}
