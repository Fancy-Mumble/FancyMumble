//! What this view asks of an engine, and what an engine tells it.
//!
//! The view never names a concrete engine: it holds an [`Engine`] and reads
//! from it when an [`EngineEvent`] says something changed. That mirrors how
//! the real engine talks to a view (its `CoreEvent`s are notifications, and
//! the view reads the state it mirrors again), so the adapter that puts the
//! real engine behind this trait is a mapping, not a translation layer.
//! Until then [`crate::demo::DemoEngine`] stands in.

use gpui::SharedString;

/// A channel's id on its server.
pub(crate) type ChannelId = u32;
/// A connected user's session id.
pub(crate) type Session = u32;

/// Where the connection to the server stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Connection {
    /// Not connected.
    #[expect(dead_code, reason = "the demo engine is always connected")]
    Disconnected,
    /// A connection attempt is under way.
    #[expect(dead_code, reason = "the demo engine is always connected")]
    Connecting,
    /// Connected and synchronised.
    Connected,
}

/// One channel of the server's tree.
#[derive(Debug, Clone)]
pub(crate) struct Channel {
    pub id: ChannelId,
    /// `None` for the root.
    pub parent: Option<ChannelId>,
    pub name: SharedString,
}

/// One connected user.
#[derive(Debug, Clone)]
pub(crate) struct User {
    pub session: Session,
    pub name: SharedString,
    /// The channel the user is in.
    pub channel: ChannelId,
    pub self_mute: bool,
    pub self_deaf: bool,
}

/// One chat message, as the conversation shows it.
#[derive(Debug, Clone)]
pub(crate) struct Message {
    /// Who sent it; `None` once that user has left.
    pub sender: Option<Session>,
    pub sender_name: SharedString,
    /// The text. Rich content is not drawn yet, so this is plain.
    pub body: SharedString,
    /// When it was sent, in Unix epoch milliseconds.
    pub sent_at_ms: u64,
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
}

/// Something happened in the engine. Each names what to read again.
///
/// Named after the engine's own events so the adapter is one `match`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum EngineEvent {
    /// Channels, users or the connection changed: take a new [`Snapshot`].
    StateChanged,
    /// The local user is now in another channel.
    CurrentChannelChanged,
    /// A user started or stopped talking.
    UserTalking { session: Session, talking: bool },
    /// A channel received, changed or lost a message.
    NewMessage { channel: ChannelId },
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

    /// The messages of `channel`, oldest first.
    fn messages(&self, channel: ChannelId) -> Vec<Message>;

    /// Move the local user into `channel`.
    fn join_channel(&self, channel: ChannelId);

    /// Send `body` to `channel`.
    fn send_message(&self, channel: ChannelId, body: String);

    /// Mute or unmute the local microphone.
    fn set_self_mute(&self, muted: bool);

    /// Deafen or undeafen the local user.
    fn set_self_deaf(&self, deafened: bool);
}
