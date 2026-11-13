//! What this view asks of an engine, and what an engine tells it.
//!
//! The view never names a concrete engine: it holds an [`Engine`] and reads
//! from it when an [`EngineEvent`] says something changed. That mirrors how
//! the real engine talks to a view (its `CoreEvent`s are notifications, and
//! the view reads the state it mirrors again), so [`crate::real::RealEngine`],
//! which puts the real engine behind this trait, is a mapping and not a
//! translation layer. [`crate::demo::DemoEngine`] is a server that exists
//! only in memory, for tests and for looking at the view.

use gpui::SharedString;

/// A channel's id on its server.
pub(crate) type ChannelId = u32;
/// A connected user's session id.
pub(crate) type Session = u32;

/// Where the connection to the server stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Connection {
    /// Not connected.
    Disconnected,
    /// A connection attempt is under way.
    Connecting,
    /// Connected and synchronised.
    Connected,
}

/// One saved way onto a server: an address and who to arrive as.
///
/// Several may share an address; together they are that server's identities.
#[derive(Debug, Clone)]
pub(crate) struct SavedServer {
    /// Stable id of this record.
    pub id: SharedString,
    /// What the user calls the server; the host until they name it.
    pub label: SharedString,
    pub host: SharedString,
    pub port: u16,
    pub username: SharedString,
    /// The certificate this identity presents, if it has one.
    pub certificate: Option<SharedString>,
    /// Whether the server is pinned as a favourite.
    pub favorite: bool,
}

/// What a server answered when asked, without connecting, whether it is up.
#[derive(Debug, Clone)]
pub(crate) struct ServerPing {
    pub users: u32,
    pub max_users: u32,
    pub latency_ms: u32,
    /// The server's version, as it reports it.
    pub version: SharedString,
}

/// The local voice state.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Voice {
    /// Voice is off: nothing is captured and nothing is heard.
    Off,
    /// Hearing and transmitting.
    On,
    /// Hearing, with the microphone muted.
    Muted,
}

/// A microphone or a speaker the system offers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AudioDevice {
    pub name: SharedString,
    /// Whether it is the system's default.
    pub is_default: bool,
}

/// The audio devices the system offers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct AudioDevices {
    pub inputs: Vec<AudioDevice>,
    pub outputs: Vec<AudioDevice>,
}

/// The chosen microphone and speaker, by name; `None` is the system's
/// default.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ChosenDevices {
    pub input: Option<SharedString>,
    pub output: Option<SharedString>,
}

/// One channel of the server's tree.
#[derive(Debug, Clone)]
pub(crate) struct Channel {
    pub id: ChannelId,
    /// `None` for the root.
    pub parent: Option<ChannelId>,
    pub name: SharedString,
    /// Where the channel sorts among its siblings; ties go by name.
    pub position: i32,
}

/// One connected user.
#[derive(Debug, Clone)]
pub(crate) struct User {
    pub session: Session,
    pub name: SharedString,
    /// The channel the user is in.
    pub channel: ChannelId,
    /// Muted, by themselves or by the server.
    pub muted: bool,
    /// Deafened, by themselves or by the server.
    pub deafened: bool,
    /// The user's picture, once it has been fetched.
    pub avatar: Option<std::sync::Arc<gpui::Image>>,
}

/// One chat message, as the conversation shows it.
#[derive(Debug, Clone)]
pub(crate) struct Message {
    /// Who sent it; `None` once that user has left.
    pub sender: Option<Session>,
    pub sender_name: SharedString,
    /// The message as plain text.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "drawn from `html`; kept for what wants words only"
        )
    )]
    pub body: SharedString,
    /// The message as it was sent: HTML.
    pub html: SharedString,
    /// When it was sent, in Unix epoch milliseconds, where the server said.
    pub sent_at_ms: Option<u64>,
    /// Whether the local user sent it.
    pub own: bool,
}

/// The server as it stands: everything the shell mirrors.
#[derive(Debug, Clone)]
pub(crate) struct Snapshot {
    pub connection: Connection,
    /// The local user's session, once connected.
    pub own_session: Option<Session>,
    /// The channel the local user is in.
    pub current_channel: Option<ChannelId>,
    pub channels: Vec<Channel>,
    pub users: Vec<User>,
    /// The local voice state.
    pub voice: Voice,
    /// Whether the local user is deafened.
    pub deafened: bool,
}

impl Snapshot {
    /// What there is to show when not on a server.
    pub(crate) fn disconnected() -> Self {
        Self {
            connection: Connection::Disconnected,
            own_session: None,
            current_channel: None,
            channels: Vec::new(),
            users: Vec::new(),
            voice: Voice::Off,
            deafened: false,
        }
    }
}

/// Something happened in the engine. Each names what to read again.
///
/// Named after the engine's own events so the adapter is one `match`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EngineEvent {
    /// Channels, users or the connection changed: take a new [`Snapshot`].
    StateChanged,
    /// The local user is now in another channel.
    CurrentChannelChanged,
    /// A user started or stopped talking.
    UserTalking { session: Session, talking: bool },
    /// A channel received, changed or lost a message.
    NewMessage { channel: ChannelId },
    /// The saved servers, or what is known of whether they are up, changed.
    ServersChanged,
    /// Something the user should be told: a refused connection, a failed
    /// command. `None` clears what was said before.
    Notice(Option<SharedString>),
}

/// An engine, as this view sees one.
///
/// Reads are cheap copies of what the engine already holds; commands return
/// at once and report their effect through [`EngineEvent`]s.
pub(crate) trait Engine: Send + Sync + 'static {
    /// The stream of events. Called once, by the shell.
    fn events(&self) -> async_channel::Receiver<EngineEvent>;

    /// The server as it stands now.
    fn snapshot(&self) -> Snapshot;

    /// Every saved identity, in the order the user keeps them.
    fn saved_servers(&self) -> Vec<SavedServer>;

    /// The latest answer from the server at `host:port`, or `None` while it
    /// has not answered (or is down).
    fn ping(&self, host: &str, port: u16) -> Option<ServerPing>;

    /// Ask every saved server again whether it is up. The answers arrive
    /// later, each announced by [`EngineEvent::ServersChanged`].
    fn refresh_pings(&self);

    /// Save `server`: a new record, or a replacement for the one with its id.
    fn save_server(&self, server: SavedServer);

    /// Forget the saved identity `id`.
    fn remove_server(&self, id: &str);

    /// Connect as the saved identity `id`, with the server's password if it
    /// wants one.
    fn connect(&self, id: &str, password: Option<String>);

    /// Leave the server.
    fn disconnect(&self);

    /// The messages of `channel`, oldest first.
    fn messages(&self, channel: ChannelId) -> Vec<Message>;

    /// Move the local user into `channel`.
    fn join_channel(&self, channel: ChannelId);

    /// Send `body` to `channel`.
    fn send_message(&self, channel: ChannelId, body: String);

    /// The microphone button: turns voice on when it is off, mutes or
    /// unmutes when it is on.
    fn toggle_microphone(&self);

    /// Deafen or undeafen the local user.
    fn toggle_deafen(&self);

    /// The microphones and speakers the system offers. Blocking: call it
    /// off the view's thread.
    fn audio_devices(&self) -> AudioDevices;

    /// The devices in use.
    fn chosen_devices(&self) -> ChosenDevices;

    /// Use these devices from now on.
    fn choose_devices(&self, devices: ChosenDevices);

    /// The application is closing: write out what is held only in memory.
    fn shutdown(&self) {}
}
