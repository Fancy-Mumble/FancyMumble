//! An engine with nothing behind it: a small server that exists only in
//! memory, so the view can be drawn, driven and measured on its own.

use std::sync::Mutex;

use crate::engine::{
    Channel, ChannelId, Connection, Engine, EngineEvent, Message, SavedServer, ServerPing, Session,
    Snapshot, User,
};

/// The local user's session in the demo server.
const OWN: Session = 1;
/// The channel the demo opens in.
const LOUNGE: ChannelId = 1;
/// 21:37 UTC on an arbitrary day: the first message of the demo's history.
const FIRST_MESSAGE_MS: u64 = 1_760_045_820_000;
const MINUTE_MS: u64 = 60_000;

/// A server in memory.
#[derive(Debug)]
pub(crate) struct DemoEngine {
    state: Mutex<State>,
    events: async_channel::Sender<EngineEvent>,
    inbox: async_channel::Receiver<EngineEvent>,
}

#[derive(Debug)]
struct State {
    connected: bool,
    current_channel: ChannelId,
    channels: Vec<Channel>,
    users: Vec<User>,
    /// `(channel, message)`, oldest first.
    messages: Vec<(ChannelId, Message)>,
}

impl DemoEngine {
    /// Connected to a demo server with a handful of people in one channel.
    pub(crate) fn new() -> Self {
        Self::starting(true)
    }

    /// The same server, not yet connected to: what a launch looks like.
    pub(crate) fn disconnected() -> Self {
        Self::starting(false)
    }

    fn starting(connected: bool) -> Self {
        let (events, inbox) = async_channel::unbounded();
        Self {
            state: Mutex::new(State {
                connected,
                ..State::seeded()
            }),
            events,
            inbox,
        }
    }

    /// Have `session` start or stop talking.
    pub(crate) fn talk(&self, session: Session, talking: bool) {
        self.tell(EngineEvent::UserTalking { session, talking });
    }

    fn with_state<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut state)
    }

    fn tell(&self, event: EngineEvent) {
        // The receiver lives as long as the engine, so this cannot fail; if it
        // ever did there would be nobody left to tell.
        let _ = self.events.try_send(event);
    }
}

impl State {
    fn seeded() -> Self {
        let channel = |id, parent, name: &str| Channel {
            id,
            parent,
            name: name.to_owned().into(),
        };
        let user = |session, name: &str| User {
            session,
            name: name.to_owned().into(),
            channel: LOUNGE,
            self_mute: session == OWN,
            self_deaf: false,
        };
        let said = |minute: u64, session: Session, name: &str, body: &str| {
            (
                LOUNGE,
                Message {
                    sender: Some(session),
                    sender_name: name.to_owned().into(),
                    body: body.to_owned().into(),
                    sent_at_ms: FIRST_MESSAGE_MS + minute * MINUTE_MS,
                    own: session == OWN,
                },
            )
        };
        Self {
            connected: true,
            current_channel: LOUNGE,
            channels: vec![
                channel(0, None, "Root"),
                channel(LOUNGE, Some(0), "lounge"),
                channel(2, Some(0), "studio"),
                channel(3, Some(0), "afk"),
            ],
            users: vec![
                user(OWN, "Alex"),
                user(2, "Flora"),
                user(3, "Rin"),
                user(4, "Scout"),
                user(5, "Torque"),
            ],
            messages: vec![
                said(0, OWN, "Alex", "Welcome to our creative lounge!"),
                said(1, 3, "Rin", "Sketching a new character design tonight."),
                said(
                    2,
                    5,
                    "Torque",
                    "My coastal drive was beautiful. Sharing photos soon.",
                ),
                said(3, 2, "Flora", "The dahlias are blooming in the garden."),
                said(4, 4, "Scout", "Scout says hello from our walk!"),
            ],
        }
    }
}

impl Engine for DemoEngine {
    fn events(&self) -> async_channel::Receiver<EngineEvent> {
        self.inbox.clone()
    }

    fn snapshot(&self) -> Snapshot {
        self.with_state(|state| {
            if !state.connected {
                return Snapshot {
                    connection: Connection::Disconnected,
                    own_session: None,
                    current_channel: None,
                    channels: Vec::new(),
                    users: Vec::new(),
                };
            }
            Snapshot {
                connection: Connection::Connected,
                own_session: Some(OWN),
                current_channel: Some(state.current_channel),
                channels: state.channels.clone(),
                users: state.users.clone(),
            }
        })
    }

    fn saved_servers(&self) -> Vec<SavedServer> {
        let saved = |id: &str, host: &str, username: &str, favorite| SavedServer {
            id: id.to_owned().into(),
            label: host.to_owned().into(),
            host: host.to_owned().into(),
            port: 64738,
            username: username.to_owned().into(),
            certificate: None,
            favorite,
        };
        vec![
            saved("magical-alex", "magical.rocks", "Alex", true),
            saved("magical-work", "magical.rocks", "Alex (work)", true),
            saved("kumo", "kumo.jp", "Alex", false),
            saved("local", "localhost", "Alex", false),
        ]
    }

    fn ping(&self, host: &str, _port: u16) -> Option<ServerPing> {
        let answer = |users, latency_ms, version: &str| ServerPing {
            users,
            max_users: 101,
            latency_ms,
            version: version.to_owned().into(),
        };
        match host {
            "magical.rocks" => Some(answer(3, 18, "1.6.0")),
            "kumo.jp" => Some(answer(0, 62, "1.5.7")),
            // Nothing is listening on the demo's localhost.
            _ => None,
        }
    }

    fn connect(&self, id: &str) {
        let known = self.saved_servers().iter().any(|saved| saved.id == id);
        let connected = self.with_state(|state| {
            let changes = known && !state.connected;
            state.connected |= known;
            changes
        });
        if connected {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::CurrentChannelChanged);
        }
    }

    fn disconnect(&self) {
        let left = self.with_state(|state| std::mem::replace(&mut state.connected, false));
        if left {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::CurrentChannelChanged);
        }
    }

    fn messages(&self, channel: ChannelId) -> Vec<Message> {
        self.with_state(|state| {
            state
                .messages
                .iter()
                .filter(|(in_channel, _)| *in_channel == channel)
                .map(|(_, message)| message.clone())
                .collect()
        })
    }

    fn join_channel(&self, channel: ChannelId) {
        let moved = self.with_state(|state| {
            if state.current_channel == channel
                || !state.channels.iter().any(|known| known.id == channel)
            {
                return false;
            }
            state.current_channel = channel;
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.channel = channel;
            }
            true
        });
        if moved {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::CurrentChannelChanged);
        }
    }

    fn send_message(&self, channel: ChannelId, body: String) {
        let body = body.trim().to_owned();
        if body.is_empty() {
            return;
        }
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .map_or(FIRST_MESSAGE_MS, |(_, last)| last.sent_at_ms + MINUTE_MS);
            state.messages.push((
                channel,
                Message {
                    sender: Some(OWN),
                    sender_name: "Alex".into(),
                    body: body.into(),
                    sent_at_ms,
                    own: true,
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { channel });
    }

    fn set_self_mute(&self, muted: bool) {
        self.with_state(|state| {
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.self_mute = muted;
                // Unmuting undeafens, as it does on a real server.
                if !muted {
                    own.self_deaf = false;
                }
            }
        });
        self.tell(EngineEvent::StateChanged);
    }

    fn set_self_deaf(&self, deafened: bool) {
        self.with_state(|state| {
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.self_deaf = deafened;
                // Deafening mutes, as it does on a real server.
                if deafened {
                    own.self_mute = true;
                }
            }
        });
        self.tell(EngineEvent::StateChanged);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn drain(engine: &DemoEngine) -> Vec<EngineEvent> {
        let inbox = engine.events();
        std::iter::from_fn(|| inbox.try_recv().ok()).collect()
    }

    #[test]
    fn joining_a_channel_moves_the_local_user_and_says_so() {
        let engine = DemoEngine::new();
        engine.join_channel(2);
        let snapshot = engine.snapshot();
        assert_eq!(snapshot.current_channel, Some(2));
        let own = snapshot.users.iter().find(|user| user.session == OWN);
        assert_eq!(own.map(|user| user.channel), Some(2));
        assert_eq!(
            drain(&engine),
            [
                EngineEvent::StateChanged,
                EngineEvent::CurrentChannelChanged
            ]
        );
    }

    #[test]
    fn joining_the_current_or_an_unknown_channel_does_nothing() {
        let engine = DemoEngine::new();
        engine.join_channel(LOUNGE);
        engine.join_channel(99);
        assert_eq!(engine.snapshot().current_channel, Some(LOUNGE));
        assert!(drain(&engine).is_empty());
    }

    #[test]
    fn a_sent_message_lands_in_its_channel_only() {
        let engine = DemoEngine::new();
        let before = engine.messages(LOUNGE).len();
        engine.send_message(2, "  hello studio  ".to_owned());
        engine.send_message(2, "   ".to_owned());
        assert_eq!(engine.messages(LOUNGE).len(), before);
        let studio = engine.messages(2);
        assert_eq!(studio.len(), 1);
        assert_eq!(studio[0].body.as_ref(), "hello studio");
        assert!(studio[0].own);
        assert_eq!(drain(&engine), [EngineEvent::NewMessage { channel: 2 }]);
    }

    #[test]
    fn a_launch_is_disconnected_until_a_saved_identity_connects() {
        let engine = DemoEngine::disconnected();
        let snapshot = engine.snapshot();
        assert_eq!(snapshot.connection, Connection::Disconnected);
        assert!(snapshot.channels.is_empty() && snapshot.own_session.is_none());

        engine.connect("no-such-identity");
        assert_eq!(engine.snapshot().connection, Connection::Disconnected);
        assert!(drain(&engine).is_empty());

        engine.connect("kumo");
        assert_eq!(engine.snapshot().connection, Connection::Connected);
        assert_eq!(
            drain(&engine),
            [
                EngineEvent::StateChanged,
                EngineEvent::CurrentChannelChanged
            ]
        );

        engine.disconnect();
        assert_eq!(engine.snapshot().connection, Connection::Disconnected);
        engine.disconnect();
        assert_eq!(drain(&engine).len(), 2, "leaving twice says so once");
    }

    #[test]
    fn deafening_mutes_and_unmuting_undeafens() {
        let engine = DemoEngine::new();
        let own = |engine: &DemoEngine| {
            engine
                .snapshot()
                .users
                .into_iter()
                .find(|user| user.session == OWN)
                .expect("the local user")
        };
        engine.set_self_mute(false);
        assert!(!own(&engine).self_mute);
        engine.set_self_deaf(true);
        assert!(own(&engine).self_mute && own(&engine).self_deaf);
        engine.set_self_mute(false);
        assert!(!own(&engine).self_mute && !own(&engine).self_deaf);
    }
}
