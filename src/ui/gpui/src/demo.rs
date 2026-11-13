//! An engine with nothing behind it: a small server that exists only in
//! memory, so the view can be drawn, driven and measured on its own.

use std::sync::Mutex;

use crate::engine::{
    Action, AudioDevice, AudioDevices, Channel, ChannelId, ChosenDevices, Connection, Conversation,
    Engine, EngineEvent, Message, SavedServer, ServerPing, Session, SessionEntry, Snapshot,
    Subject, User, Voice, VoiceSettings,
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
    voice: Voice,
    deafened: bool,
    servers: Vec<SavedServer>,
    devices: ChosenDevices,
    voice_settings: VoiceSettings,
    /// Every action asked for, in order: the demo's record of what a server
    /// would have been sent.
    actions: Vec<Action>,
    current_channel: ChannelId,
    channels: Vec<Channel>,
    users: Vec<User>,
    /// Every message with the conversation it belongs to, oldest first.
    messages: Vec<(Conversation, Message)>,
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

    /// Every action asked of the demo so far.
    #[cfg(test)]
    pub(crate) fn actions(&self) -> Vec<Action> {
        self.with_state(|state| state.actions.clone())
    }

    /// Tell the user something, as a refused connection would.
    #[cfg(test)]
    pub(crate) fn notify(&self, notice: Option<&str>) {
        self.tell(EngineEvent::Notice(
            notice.map(|text| text.to_owned().into()),
        ));
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
    /// What a server would do about `action`, for the ones that show.
    fn apply(&mut self, action: &Action) {
        match action {
            Action::Kick { session, .. } | Action::Ban { session, .. } => {
                self.users.retain(|user| user.session != *session);
            }
            Action::ServerMute { session, muted } => {
                if let Some(user) = self.users.iter_mut().find(|user| user.session == *session) {
                    user.muted = *muted;
                }
            }
            Action::ServerDeafen { session, deafened } => {
                if let Some(user) = self.users.iter_mut().find(|user| user.session == *session) {
                    user.deafened = *deafened;
                }
            }
            Action::MoveUser { session, channel } => {
                if let Some(user) = self.users.iter_mut().find(|user| user.session == *session) {
                    user.channel = *channel;
                }
            }
            Action::CreateChannel { parent, name } => {
                let id = self
                    .channels
                    .iter()
                    .map(|channel| channel.id)
                    .max()
                    .unwrap_or(0)
                    + 1;
                self.channels.push(Channel {
                    id,
                    parent: Some(*parent),
                    name: name.clone().into(),
                    position: 0,
                    unread: 0,
                });
            }
            Action::RenameChannel { channel, name } => {
                if let Some(found) = self.channels.iter_mut().find(|known| known.id == *channel) {
                    found.name = name.clone().into();
                }
            }
            Action::DeleteChannel { channel } => {
                self.channels.retain(|known| known.id != *channel);
            }
            Action::JoinWithPassword { channel, .. } => {
                self.current_channel = *channel;
                if let Some(own) = self.users.iter_mut().find(|user| user.session == OWN) {
                    own.channel = *channel;
                }
            }
            Action::SetUserVolume { .. }
            | Action::Register { .. }
            | Action::SetComment(_)
            | Action::SetAvatar(_) => {}
        }
    }

    fn seeded() -> Self {
        let channel = |id, parent, name: &str| Channel {
            id,
            parent,
            name: name.to_owned().into(),
            position: 0,
            unread: 0,
        };
        let user = |session, name: &str| User {
            session,
            name: name.to_owned().into(),
            channel: LOUNGE,
            muted: session == OWN,
            deafened: false,
            avatar: None,
            unread: 0,
        };
        let said = |minute: u64, session: Session, name: &str, body: &str| {
            (
                Conversation::Channel(LOUNGE),
                Message {
                    sender: Some(session),
                    sender_name: name.to_owned().into(),
                    body: body.to_owned().into(),
                    html: demo_markup(body).into(),
                    sent_at_ms: Some(FIRST_MESSAGE_MS + minute * MINUTE_MS),
                    own: session == OWN,
                },
            )
        };
        let saved = |id: &str, host: &str, username: &str, favorite| SavedServer {
            id: id.to_owned().into(),
            label: host.to_owned().into(),
            host: host.to_owned().into(),
            port: 64738,
            username: username.to_owned().into(),
            certificate: None,
            favorite,
        };
        Self {
            connected: true,
            voice: Voice::Off,
            deafened: false,
            devices: ChosenDevices::default(),
            actions: Vec::new(),
            voice_settings: VoiceSettings {
                push_to_talk: false,
                threshold: 0.01,
                noise_suppression: true,
                automatic_gain: true,
            },
            servers: vec![
                saved("magical-alex", "magical.rocks", "Alex", true),
                saved("magical-work", "magical.rocks", "Alex (work)", true),
                saved("kumo", "kumo.jp", "Alex", false),
                saved("local", "localhost", "Alex", false),
            ],
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

/// The demo's messages with a little markup on them, so emphasis, code and
/// links have something to be looked at on.
fn demo_markup(body: &str) -> String {
    body.replace("new character design", "<b>new character</b> design")
        .replace("beautiful", "<i>beautiful</i>")
        .replace("dahlias", "<code>dahlias</code>")
        .replace(
            "our walk",
            r#"<a href="https://example.org/walk">our walk</a>"#,
        )
}

impl Engine for DemoEngine {
    fn events(&self) -> async_channel::Receiver<EngineEvent> {
        self.inbox.clone()
    }

    fn snapshot(&self) -> Snapshot {
        self.with_state(|state| {
            if !state.connected {
                return Snapshot::disconnected();
            }
            Snapshot {
                connection: Connection::Connected,
                own_session: Some(OWN),
                current_channel: Some(state.current_channel),
                channels: state.channels.clone(),
                users: state.users.clone(),
                voice: state.voice,
                deafened: state.deafened,
                welcome: Some("Welcome to the <b>demo</b> server.".into()),
                sessions: vec![SessionEntry {
                    id: "demo".into(),
                    name: "magical.rocks".into(),
                    active: true,
                }],
            }
        })
    }

    fn saved_servers(&self) -> Vec<SavedServer> {
        self.with_state(|state| state.servers.clone())
    }

    fn refresh_pings(&self) {
        // The demo's answers never change; say so anyway, as a real engine
        // would once its servers have replied.
        self.tell(EngineEvent::ServersChanged);
    }

    fn save_server(&self, server: SavedServer) {
        self.with_state(|state| {
            match state.servers.iter_mut().find(|saved| saved.id == server.id) {
                Some(existing) => *existing = server,
                None => state.servers.push(server),
            }
        });
        self.tell(EngineEvent::ServersChanged);
    }

    fn remove_server(&self, id: &str) {
        let removed = self.with_state(|state| {
            let before = state.servers.len();
            state.servers.retain(|saved| saved.id != id);
            state.servers.len() != before
        });
        if removed {
            self.tell(EngineEvent::ServersChanged);
        }
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

    fn connect(&self, id: &str, _password: Option<String>) {
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

    fn messages(&self, conversation: Conversation) -> Vec<Message> {
        self.with_state(|state| {
            state
                .messages
                .iter()
                .filter(|(of, _)| *of == conversation)
                .map(|(_, message)| message.clone())
                .collect()
        })
    }

    fn open(&self, _conversation: Conversation) {}

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

    fn send_message(&self, conversation: Conversation, body: String) {
        let body = body.trim().to_owned();
        if body.is_empty() {
            return;
        }
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .and_then(|(_, last)| last.sent_at_ms)
                .map_or(FIRST_MESSAGE_MS, |last| last + MINUTE_MS);
            state.messages.push((
                conversation,
                Message {
                    sender: Some(OWN),
                    sender_name: "Alex".into(),
                    html: body
                        .replace('&', "&amp;")
                        .replace('<', "&lt;")
                        .replace('\n', "<br>")
                        .into(),
                    body: body.into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: true,
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }

    fn toggle_microphone(&self) {
        self.with_state(|state| {
            state.voice = match state.voice {
                Voice::Off | Voice::Muted => Voice::On,
                Voice::On => Voice::Muted,
            };
            // Unmuting undeafens, as it does on a real server.
            if state.voice == Voice::On {
                state.deafened = false;
            }
            let (muted, deafened) = (state.voice != Voice::On, state.deafened);
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.muted = muted;
                own.deafened = deafened;
            }
        });
        self.tell(EngineEvent::StateChanged);
    }

    fn toggle_deafen(&self) {
        self.with_state(|state| {
            state.deafened = !state.deafened;
            // Deafening mutes, as it does on a real server.
            if state.deafened && state.voice == Voice::On {
                state.voice = Voice::Muted;
            }
            let (muted, deafened) = (state.voice != Voice::On, state.deafened);
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.muted = muted;
                own.deafened = deafened;
            }
        });
        self.tell(EngineEvent::StateChanged);
    }

    fn audio_devices(&self) -> AudioDevices {
        let device = |name: &str, is_default| AudioDevice {
            name: name.to_owned().into(),
            is_default,
        };
        AudioDevices {
            inputs: vec![
                device("Built-in Microphone", true),
                device("USB Headset", false),
            ],
            outputs: vec![
                device("Built-in Speakers", true),
                device("USB Headset", false),
            ],
        }
    }

    fn chosen_devices(&self) -> ChosenDevices {
        self.with_state(|state| state.devices.clone())
    }

    fn choose_devices(&self, devices: ChosenDevices) {
        self.with_state(|state| state.devices = devices);
    }

    fn activate_session(&self, _id: &str) {}

    fn set_focused(&self, _focused: bool) {}

    fn act(&self, action: Action) {
        self.with_state(|state| {
            state.apply(&action);
            state.actions.push(action);
        });
        self.tell(EngineEvent::StateChanged);
    }

    fn about(&self, subject: Subject) {
        let html = match subject {
            Subject::User(3) => Some("Draws <i>characters</i>."),
            Subject::Channel(LOUNGE) => Some("Where everybody starts."),
            _ => None,
        };
        self.tell(EngineEvent::About {
            subject,
            html: html.map(Into::into),
        });
    }

    fn voice_settings(&self) -> VoiceSettings {
        self.with_state(|state| state.voice_settings)
    }

    fn set_voice_settings(&self, settings: VoiceSettings) {
        self.with_state(|state| state.voice_settings = settings);
    }

    fn push_to_talk(&self, held: bool) {
        // Held is "transmitting": the demo shows it as voice on, and as the
        // local user talking.
        let changed = self.with_state(|state| {
            let voice = if held { Voice::On } else { Voice::Muted };
            let changed = state.voice != voice;
            state.voice = voice;
            changed
        });
        if changed {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::UserTalking {
                session: OWN,
                talking: held,
            });
        }
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
        let lounge = Conversation::Channel(LOUNGE);
        let studio = Conversation::Channel(2);
        let before = engine.messages(lounge).len();
        engine.send_message(studio, "  hello studio  ".to_owned());
        engine.send_message(studio, "   ".to_owned());
        assert_eq!(engine.messages(lounge).len(), before);
        let direct = Conversation::Direct(3);
        engine.send_message(direct, "psst".to_owned());
        assert_eq!(
            engine.messages(direct).len(),
            1,
            "a direct message is its own conversation"
        );
        let studio = engine.messages(studio);
        assert_eq!(studio.len(), 1);
        assert_eq!(studio[0].body.as_ref(), "hello studio");
        assert!(studio[0].own);
        assert_eq!(
            drain(&engine),
            [
                EngineEvent::NewMessage {
                    conversation: Conversation::Channel(2)
                },
                EngineEvent::NewMessage {
                    conversation: Conversation::Direct(3)
                }
            ]
        );
    }

    #[test]
    fn a_launch_is_disconnected_until_a_saved_identity_connects() {
        let engine = DemoEngine::disconnected();
        let snapshot = engine.snapshot();
        assert_eq!(snapshot.connection, Connection::Disconnected);
        assert!(snapshot.channels.is_empty() && snapshot.own_session.is_none());

        engine.connect("no-such-identity", None);
        assert_eq!(engine.snapshot().connection, Connection::Disconnected);
        assert!(drain(&engine).is_empty());

        engine.connect("kumo", None);
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
    fn the_microphone_button_turns_voice_on_then_mutes_and_deafen_mutes() {
        let engine = DemoEngine::new();
        assert_eq!(engine.snapshot().voice, Voice::Off);
        engine.toggle_microphone();
        assert_eq!(engine.snapshot().voice, Voice::On);
        engine.toggle_microphone();
        assert_eq!(engine.snapshot().voice, Voice::Muted);
        engine.toggle_microphone();
        engine.toggle_deafen();
        let snapshot = engine.snapshot();
        assert!(snapshot.deafened);
        assert_eq!(snapshot.voice, Voice::Muted, "deafening mutes");
        engine.toggle_microphone();
        let snapshot = engine.snapshot();
        assert!(!snapshot.deafened, "unmuting undeafens");
        assert_eq!(snapshot.voice, Voice::On);
    }

    #[test]
    fn a_saved_server_is_added_replaced_and_removed() {
        let engine = DemoEngine::new();
        let before = engine.saved_servers().len();
        let mut server = engine.saved_servers()[0].clone();
        server.id = "new".into();
        server.host = "new.example".into();
        engine.save_server(server.clone());
        assert_eq!(engine.saved_servers().len(), before + 1);
        server.username = "Renamed".into();
        engine.save_server(server);
        let saved = engine.saved_servers();
        assert_eq!(saved.len(), before + 1, "the same id replaces");
        assert_eq!(saved[before].username.as_ref(), "Renamed");
        engine.remove_server("new");
        engine.remove_server("new");
        assert_eq!(engine.saved_servers().len(), before);
        assert_eq!(
            drain(&engine),
            [
                EngineEvent::ServersChanged,
                EngineEvent::ServersChanged,
                EngineEvent::ServersChanged
            ]
        );
    }
}
