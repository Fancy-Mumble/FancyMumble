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

/// What a conversation is with: a channel, or one other user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Conversation {
    /// Everyone in a channel.
    Channel(ChannelId),
    /// One user, directly.
    Direct(Session),
}

/// Something there is more to read about: a user's comment, a channel's
/// description.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Subject {
    User(Session),
    Channel(ChannelId),
    /// The server on screen: its welcome, and what it says of itself.
    Server,
}

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

/// How the microphone is used. Also how it is written to disk.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub(crate) struct VoiceSettings {
    /// Transmit only while the push-to-talk key is held.
    pub push_to_talk: bool,
    /// How loud the microphone must be to count as speech, 0.0 to 1.0.
    pub threshold: f32,
    pub noise_suppression: bool,
    pub automatic_gain: bool,
    /// How loud the microphone is sent: 1.0 as captured.
    #[serde(default = "as_it_is")]
    pub input_volume: f32,
    /// How loud everybody is played: 1.0 as sent.
    #[serde(default = "as_it_is")]
    pub output_volume: f32,
    /// How many bits a second voice is encoded at.
    #[serde(default = "usual_bitrate")]
    pub bitrate_bps: u32,
    /// Whether voice travels over TCP, for a network that blocks UDP.
    #[serde(default)]
    pub voice_over_tcp: bool,
}

/// A volume that changes nothing: what settings written before there was
/// one are read as.
fn as_it_is() -> f32 {
    1.0
}

/// The bitrate the engine starts with.
fn usual_bitrate() -> u32 {
    72_000
}

/// Something the user asks of the server about a user or a channel, or of
/// this client about how a user is played.
///
/// The server may refuse any of the ones addressed to it; a refusal comes
/// back as a notice.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Action {
    /// Play `session` at `volume` here: 0.0 silent, 1.0 as sent.
    SetUserVolume { session: Session, volume: f32 },
    /// Remove `session` from the server.
    Kick { session: Session, reason: String },
    /// Remove `session` and ban them from returning.
    Ban { session: Session, reason: String },
    /// Mute or unmute `session` for everyone.
    ServerMute { session: Session, muted: bool },
    /// Deafen or undeafen `session` for everyone.
    ServerDeafen { session: Session, deafened: bool },
    /// Move `session` into `channel`.
    MoveUser {
        session: Session,
        channel: ChannelId,
    },
    /// Register `session` on the server under their certificate.
    Register { session: Session },
    /// Create the channel `name` under `parent`.
    /// Create the channel `name` under `parent`; with `history` the
    /// server keeps what is said there.
    CreateChannel {
        parent: ChannelId,
        name: String,
        history: bool,
        /// Keep them sealed with a key the server does not have.
        encrypted: bool,
    },
    /// Give the key of the encrypted `channel` to the one asking for it
    /// under `hash`, or turn them down.
    AnswerKeyRequest {
        channel: ChannelId,
        hash: String,
        share: bool,
    },
    /// Rename `channel`.
    RenameChannel { channel: ChannelId, name: String },
    /// Say `text` about `channel`: its description. Empty says nothing.
    DescribeChannel { channel: ChannelId, text: String },
    /// Have `channel` entered with `password`; empty lets anybody in.
    SetChannelPassword {
        channel: ChannelId,
        password: String,
    },
    /// Delete `channel`, and everything under it.
    DeleteChannel { channel: ChannelId },
    /// Move into `channel`, presenting `password`.
    JoinWithPassword {
        channel: ChannelId,
        password: String,
    },
    /// Set the local user's comment.
    SetComment(String),
    /// Set the local user's picture, from an encoded image.
    SetAvatar(Vec<u8>),
    /// Replace the text of the local user's message `id`.
    EditMessage {
        channel: ChannelId,
        id: String,
        text: String,
    },
    /// Delete the message `id` for everyone.
    DeleteMessage { channel: ChannelId, id: String },
    /// Put a poll to `channel`.
    CreatePoll {
        channel: ChannelId,
        question: String,
        options: Vec<String>,
        multiple: bool,
    },
    /// Answer the poll `poll` of `channel` with the options at
    /// `selected`, replacing what was answered before.
    Vote {
        channel: ChannelId,
        poll: String,
        selected: Vec<u32>,
    },
    /// Replace a channel's rules with these.
    SetAcl(Acl),
    /// Replace the server's ban list with this one.
    SetBans(Vec<Ban>),
    /// Remove the registration of the account `id`.
    Unregister { id: u32 },
    /// Pin the message `id` for everyone, or take the pin off.
    Pin {
        channel: ChannelId,
        id: String,
        pinned: bool,
    },
    /// Start hearing `channel` without being in it, or stop.
    ToggleListen { channel: ChannelId },
    /// Have `session` heard over everybody else in their channel, or not.
    PrioritySpeaker { session: Session, priority: bool },
    /// Put `emoji` on the message `id`, or take the local user's off.
    React {
        channel: ChannelId,
        id: String,
        emoji: String,
        add: bool,
    },
}

/// Who may do what in a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Acl {
    pub channel: ChannelId,
    /// Whether the parent channel's rules apply here too.
    pub inherit: bool,
    /// The rules, in the order they apply: a later one over an earlier.
    pub rules: Vec<AclRule>,
}

/// One rule: for a group or one account, what is allowed and denied.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct AclRule {
    /// Whether it applies in the channel itself,
    pub here: bool,
    /// and in the channels under it.
    pub subs: bool,
    /// Whether it comes from a parent channel, and cannot be changed here.
    pub inherited: bool,
    /// The account it is for, or
    pub user: Option<u32>,
    /// the group.
    pub group: Option<SharedString>,
    /// The permissions allowed, as Mumble's bits,
    pub grant: u32,
    /// and those denied.
    pub deny: u32,
}

/// One of the lists a server's administrator looks after.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Listing {
    Bans,
    Registered,
}

/// One entry of the server's ban list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Ban {
    pub address: SharedString,
    /// How many leading bits of the address count; 32 or 128 is that one
    /// address.
    pub mask: u32,
    /// The name the banned user had; empty when the ban names nobody.
    pub name: SharedString,
    /// The banned certificate's hash, where there was one.
    pub hash: SharedString,
    pub reason: SharedString,
    /// When it started, as the server writes it.
    pub start: SharedString,
    /// How long it lasts; zero is for good.
    pub duration_secs: u32,
}

/// One account registered on the server.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Registered {
    pub id: u32,
    pub name: SharedString,
    /// When it was last on, as the server writes it.
    pub last_seen: Option<SharedString>,
    /// The channel it was last in.
    pub last_channel: Option<ChannelId>,
}

/// Something done to the certificates the client holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum CertificateTask {
    /// Delete the one with this label, keys and all.
    Delete(String),
    /// Write the one with this label, private key included, to a file.
    Export {
        label: String,
        to: std::path::PathBuf,
    },
    /// Take in one exported to this file.
    Import(std::path::PathBuf),
}

/// One of the servers the engine is on.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct SessionEntry {
    /// What names it to [`Engine::activate_session`].
    pub id: SharedString,
    /// What the user calls the server: its saved label, or its host.
    pub name: SharedString,
    /// Whether it is the one the snapshot is of.
    pub active: bool,
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
    /// Messages in it the user has not read.
    pub unread: u32,
    /// Whether the server keeps what is said here.
    pub history: bool,
    /// Whether what is kept is sealed with a key only those in the
    /// channel hold.
    pub encrypted: bool,
    /// Whether the local user hears it without being in it.
    pub listening: bool,
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
    /// Direct messages from them the user has not read.
    pub unread: u32,
    /// Heard over everybody else in their channel.
    pub priority: bool,
}

/// One chat message, as the conversation shows it.
#[derive(Debug, Clone)]
pub(crate) struct Message {
    /// Who sent it; `None` once that user has left.
    pub sender: Option<Session>,
    pub sender_name: SharedString,
    /// The message as plain text: what is copied, and what an edit starts
    /// from.
    pub body: SharedString,
    /// The message as it was sent: HTML.
    pub html: SharedString,
    /// When it was sent, in Unix epoch milliseconds, where the server said.
    pub sent_at_ms: Option<u64>,
    /// Whether the local user sent it.
    pub own: bool,
    /// What names it to an edit, a reaction or a deletion; only a Fancy
    /// server hands these out.
    pub id: Option<SharedString>,
    /// Whether it was changed after it was sent.
    pub edited: bool,
    /// Whether the server refused it.
    pub failed: bool,
    /// Whether it is pinned in its channel.
    pub pinned: bool,
    /// The files it shares.
    pub files: Vec<Attachment>,
    /// The message it is a reply to.
    pub reply_to: Option<SharedString>,
    /// The reactions on it, in the order each emoji was first used.
    pub reactions: Vec<Reaction>,
}

/// Somebody who joined an encrypted channel and asks for its key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct KeyRequest {
    /// What names them to an answer.
    pub hash: SharedString,
    pub name: SharedString,
}

/// A poll put to a channel, with how it stands.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Poll {
    /// What names it to a vote.
    pub id: SharedString,
    pub question: SharedString,
    pub options: Vec<PollOption>,
    /// Whether more than one answer may be chosen.
    pub multiple: bool,
    /// Who asked.
    pub by: SharedString,
    /// When it arrived here, in Unix epoch milliseconds: where it sits
    /// among the messages.
    pub at_ms: u64,
}

/// One answer of a poll.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct PollOption {
    pub text: SharedString,
    /// How many chose it.
    pub votes: u32,
    /// Whether the local user is one of them.
    pub own: bool,
}

/// How far somebody else has read a channel.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reader {
    pub name: SharedString,
    /// The newest message they have read.
    pub read_up_to: SharedString,
}

/// A message that matched what was typed in the search field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Found {
    /// The part of the message that matched.
    pub text: SharedString,
    /// Who said it and where, in words.
    pub about: SharedString,
    /// The conversation it is in.
    pub conversation: Conversation,
}

/// What a server found behind a link, for a card under the message.
#[derive(Debug, Clone)]
pub(crate) struct Preview {
    /// The link as it stands in the message.
    pub url: SharedString,
    pub title: Option<SharedString>,
    pub description: Option<SharedString>,
    pub site: Option<SharedString>,
    /// A small picture, fetched by the server.
    pub picture: Option<std::sync::Arc<gpui::Image>>,
}

impl PartialEq for Preview {
    /// The same card: the same words, and the very same picture.
    fn eq(&self, other: &Self) -> bool {
        self.url == other.url
            && self.title == other.title
            && self.description == other.description
            && self.site == other.site
            && match (&self.picture, &other.picture) {
                (Some(one), Some(other)) => std::sync::Arc::ptr_eq(one, other),
                (None, None) => true,
                _ => false,
            }
    }
}

impl Eq for Preview {}

/// The newest messages of a conversation.
#[derive(Debug, Clone, Default)]
pub(crate) struct Window {
    /// Oldest first.
    pub messages: Vec<Message>,
    /// Whether there are older ones than these.
    pub earlier: bool,
}

/// A file shared in a message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Attachment {
    pub name: SharedString,
    /// Its size in bytes, where the sender said.
    pub size: Option<u64>,
    /// What the server keeps it under: what [`Engine::save_file`] takes.
    pub key: Option<SharedString>,
    /// A link anybody can fetch it from, where it has one.
    pub url: Option<SharedString>,
}

/// One emoji on a message, and how many put it there.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Reaction {
    pub emoji: SharedString,
    pub count: u32,
    /// Whether the local user is one of them.
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
    /// The server's welcome message, as HTML.
    pub welcome: Option<SharedString>,
    /// Every server the engine is on; this snapshot is of the active one.
    pub sessions: Vec<SessionEntry>,
    /// Whether the server speaks the Fancy extensions: messages can be
    /// edited, reacted to and deleted, and people are seen writing.
    pub fancy: bool,
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
            welcome: None,
            sessions: Vec::new(),
            fancy: false,
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
    /// A conversation received, changed or lost a message.
    NewMessage { conversation: Conversation },
    /// The saved servers, or what is known of whether they are up, changed.
    ServersChanged,
    /// What was asked for with [`Engine::about`] has arrived: the comment or
    /// description, as HTML, or `None` if there is none.
    About {
        subject: Subject,
        html: Option<SharedString>,
    },
    /// Something the user should be told: a refused connection, a failed
    /// command. `None` clears what was said before.
    Notice(Option<SharedString>),
    /// Who is asking for the key of `channel` changed: read
    /// [`Engine::key_requests`] again.
    KeyRequests { channel: ChannelId },
    /// How far each other reader of `channel` has read.
    Readers {
        channel: ChannelId,
        readers: Vec<Reader>,
    },
    /// What lies behind links asked about with [`Engine::previews`]. A
    /// link the server found nothing behind is not among them.
    Previews(Vec<Preview>),
    /// A channel's rules, asked for with [`Engine::request_acl`].
    Acl(Acl),
    /// The server's ban list, asked for with [`Engine::list`].
    Bans(Vec<Ban>),
    /// The server's registered accounts, asked for with [`Engine::list`].
    Registered(Vec<Registered>),
    /// The certificates held changed: read [`Engine::certificates`] again.
    CertificatesChanged,
    /// What is known about `subject` besides its text, as names and
    /// values: a user's connection, a server's version.
    Facts {
        subject: Subject,
        facts: Vec<(SharedString, SharedString)>,
    },
    /// Somebody is writing in a channel. Said again while they go on;
    /// nothing says when they stop.
    Typing {
        channel: ChannelId,
        session: Session,
    },
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

    /// Who is asking for the key of the encrypted channel `channel`.
    fn key_requests(&self, channel: ChannelId) -> Vec<KeyRequest>;

    /// The polls put to `conversation` while this client was there,
    /// oldest first, with how each stands.
    fn polls(&self, conversation: Conversation) -> Vec<Poll>;

    /// The local user has read `conversation` up to the message `id`:
    /// say so to those in it, and ask how far they have read. Only a
    /// Fancy server keeps track; elsewhere this does nothing.
    fn read_up_to(&self, conversation: Conversation, id: SharedString);

    /// The messages held that match `query`, best first. Searches what
    /// the client holds, so it may be asked off the view's thread.
    fn search_messages(&self, query: &str) -> Vec<Found>;

    /// Ask what lies behind `urls`. The answers arrive as
    /// [`EngineEvent::Previews`]; a server that does not look never
    /// answers.
    fn previews(&self, urls: Vec<SharedString>);

    /// Ask the server who may do what in `channel`. The answer is an
    /// [`EngineEvent::Acl`], or a refusal said in a notice.
    fn request_acl(&self, channel: ChannelId);

    /// Ask the server for one of its administrator's lists. It arrives as
    /// an event, or is refused with a notice.
    fn list(&self, listing: Listing);

    /// The labels of the certificates held, in order.
    fn certificates(&self) -> Vec<SharedString>;

    /// Delete, export or import a certificate. How it went is said in a
    /// notice; a change in [`EngineEvent::CertificatesChanged`].
    fn manage_certificate(&self, task: CertificateTask);

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

    /// The messages of `conversation`, oldest first.
    #[cfg(test)]
    fn messages(&self, conversation: Conversation) -> Vec<Message> {
        self.window(conversation, usize::MAX).messages
    }

    /// The newest `limit` messages of `conversation`, oldest first, and
    /// whether there are older ones. What the conversation is drawn from:
    /// a long history costs what is shown of it.
    fn window(&self, conversation: Conversation, limit: usize) -> Window;

    /// Fetch messages of `conversation` older than the message `before`
    /// from the server, where it keeps any. They are announced as a
    /// [`EngineEvent::NewMessage`].
    fn load_earlier(&self, conversation: Conversation, before: Option<SharedString>);

    /// How many messages `conversation` holds. Cheap: for asking whether
    /// [`Self::messages`] is worth reading again.
    fn message_count(&self, conversation: Conversation) -> usize;

    /// The user is looking at `conversation`: mark it read, and fetch its
    /// stored history where the server keeps one.
    fn open(&self, conversation: Conversation);

    /// Move the local user into `channel`.
    fn join_channel(&self, channel: ChannelId);

    /// Send `body` to `conversation`.
    fn send_message(&self, conversation: Conversation, body: String);

    /// Send `body` to `conversation` as a reply to the message `to`.
    fn send_reply(&self, conversation: Conversation, to: SharedString, body: String);

    /// Send the picture in `file`, an encoded image, to `conversation`,
    /// scaled down as far as the server's limit on a message asks.
    fn send_picture(&self, conversation: Conversation, file: Vec<u8>);

    /// Share the file at `path` with `conversation`. A server that keeps
    /// no files says so in a notice.
    fn send_file(&self, conversation: Conversation, path: std::path::PathBuf);

    /// Fetch the shared file kept under `key` and write it to `to`. How
    /// it went is said in a notice.
    fn save_file(&self, key: SharedString, to: std::path::PathBuf);

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

    /// The local user is writing in `conversation`. Call it as often as
    /// they type: the engine says so to the server only every few seconds.
    fn typing(&self, conversation: Conversation);

    /// Make the session `id` the one the snapshot, and every command, is
    /// about.
    fn activate_session(&self, id: &str);

    /// Leave the server of the session `id`, whichever one is showing.
    fn leave_session(&self, id: &str);

    /// The window gained or lost the user's attention.
    fn set_focused(&self, focused: bool);

    /// Do `action`.
    fn act(&self, action: Action);

    /// Fetch what there is to read about `subject`; it arrives as
    /// [`EngineEvent::About`].
    fn about(&self, subject: Subject);

    /// How the microphone is used.
    fn voice_settings(&self) -> VoiceSettings;

    /// Change how the microphone is used.
    fn set_voice_settings(&self, settings: VoiceSettings);

    /// The push-to-talk key went down (`held`) or came up.
    fn push_to_talk(&self, held: bool);

    /// The application is closing: write out what is held only in memory.
    fn shutdown(&self) {}
}
