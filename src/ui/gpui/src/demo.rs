//! An engine with nothing behind it: a small server that exists only in
//! memory, so the view can be drawn, driven and measured on its own.

pub(crate) mod livery;
mod account;
mod directory;
mod onboarding;
mod gifs;
mod file_wire;
mod link_cards;
mod profiles;
mod register;
mod shares;
mod voice;
mod uploads;

use std::sync::Mutex;

use crate::engine::{
    Acl, AclGroup, AclRule, Attachment, KeyRequest, Poll, PollOption, WhisperTarget,
};
use crate::engine::{
    Action, AudioDevice, AudioDevices, Ban, CertificateTask, Channel, ChannelId, ChosenDevices,
    Connection, Conversation, Engine, EngineEvent, Found, Listing, Message, Preview, Reaction,
    Registered, Role, SavedServer, Scheduled, ServerPing, Session, SessionEntry, Snapshot, Subject,
    User, Voice, VoiceSettings, Window,
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
    /// The made-up recorder and player of voice messages, and what the
    /// server allows of them.
    voice: crate::voice::made_up::Studio,
    /// Screen sharing with the test pattern, and what it would have sent.
    media: std::sync::Arc<crate::share::made_up::MadeUp>,
    /// The made-up GIF service, if the server has one, and what was sent.
    gifs: gifs::Gifs,
    /// What went on the wire for each share of files.
    wire: file_wire::Wire,
    /// Whether a message to an encrypted channel would also go out plain.
    dual_path: std::sync::atomic::AtomicBool,
    /// The local user's account, as the server keeps it.
    account: Mutex<account::Desk>,
    /// What the server asks new members, and what Alex answered.
    questions: Mutex<onboarding::Questions>,
    /// People on other servers, for a test: the session they are on, theirs
    /// there, and their certificate's hash; and the session last turned to.
    elsewhere: Mutex<Elsewhere>,
    /// Files sent to go up, where a test moves them along by hand.
    #[cfg(test)]
    uploads: Mutex<uploads::Uploads>,
}

impl State {
    /// The server said the local user's account is now called `name`, or
    /// is gone.
    fn account_said(&mut self, name: Option<String>, registered: bool) {
        let Some(own) = self.users.iter_mut().find(|user| user.session == OWN) else {
            return;
        };
        if let Some(name) = name {
            own.name = name.into();
        }
        if !registered {
            own.account = None;
        }
    }

    /// Count one more message of `conversation` unread (`more` of 1), or
    /// all of them read (`more` of 0).
    fn count_unread(&mut self, conversation: Conversation, more: u32) {
        let unread = match conversation {
            Conversation::Channel(id) => self
                .channels
                .iter_mut()
                .find(|channel| channel.id == id)
                .map(|channel| &mut channel.unread),
            Conversation::Direct(session) => self
                .users
                .iter_mut()
                .find(|user| user.session == session)
                .map(|user| &mut user.unread),
        };
        if let Some(unread) = unread {
            *unread = if more == 0 { 0 } else { *unread + more };
        }
    }
}

/// People on other servers the demo pretends to be on, for a test: the
/// session they are on, theirs there and their certificate's hash; and the
/// session last turned to.
#[derive(Debug, Default)]
pub(crate) struct Elsewhere {
    pub people: Vec<(String, u32, String)>,
    pub turned_to: Option<String>,
    /// What each whisper slot was registered with, and the slot whose key
    /// is held.
    pub slots: std::collections::BTreeMap<u8, mumble_tauri_lib::engine_api::whisper::WhisperReach>,
    pub whispering: Option<u8>,
}

#[derive(Debug)]
struct State {
    connected: bool,
    /// The picture across the head of somebody's card, where they have one.
    banners: std::collections::HashMap<Session, Vec<u8>>,
    /// What there is to bring over from the web client, in a test.
    carry: Option<crate::engine::CarryOver>,
    /// The attempt to get a lost connection back that is waited for.
    retry: Option<crate::engine::Retry>,
    /// Whether this is the server without anything of Fancy Mumble's.
    plain: bool,
    /// The server's welcome message, as HTML.
    welcome: gpui::SharedString,
    voice: Voice,
    deafened: bool,
    servers: Vec<SavedServer>,
    certificates: Vec<gpui::SharedString>,
    devices: ChosenDevices,
    voice_settings: VoiceSettings,
    /// How the noise suppressor was last tuned.
    tuning: std::collections::BTreeMap<String, f32>,
    /// How the voice packets fared: none until a test says.
    stats: Option<crate::sound_check::Stats>,
    /// Every action asked for, in order: the demo's record of what a server
    /// would have been sent.
    actions: Vec<Action>,
    current_channel: ChannelId,
    channels: Vec<Channel>,
    users: Vec<User>,
    /// Every message with the conversation it belongs to, oldest first.
    messages: Vec<(Conversation, Message)>,
    /// How often the local user was said to be writing.
    typed: u32,
    /// How often the server was read whole.
    snapshots: u32,
    /// The message the view last said it had read up to.
    read_up_to: Option<gpui::SharedString>,
    /// The conversation the view has on screen: what is said anywhere else
    /// counts as unread until it is opened.
    opened: Option<Conversation>,
    polls: Vec<Poll>,
    /// Who the whisper key speaks to, whether it is held, and how often
    /// a whisper has started.
    whisper: (Option<WhisperTarget>, bool, u32),
    /// Who is asking for the lounge's key.
    key_requests: Vec<KeyRequest>,
    /// What the local user has asked to have sent later.
    scheduled: Vec<Scheduled>,
    /// Who is banned.
    bans: Vec<Ban>,
    /// The second-factor code the last connect came with.
    code: Option<String>,
    /// Where what is heard is being recorded to, while it is.
    recording: Option<std::path::PathBuf>,
    /// The shared files the view asked to have saved, and where to.
    saved: Vec<(gpui::SharedString, std::path::PathBuf)>,
    /// What was shared: what was said with it, the files, and how.
    shared: Vec<(String, Vec<std::path::PathBuf>, crate::engine::ShareAs)>,
    /// The pictures among what was shared, by what they are kept under.
    kept: std::collections::HashMap<gpui::SharedString, Vec<u8>>,
    /// What the servers say of their liveries.
    liveries: livery::Liveries,
    /// The made-up members beyond the seed's people, and what was asked
    /// of them.
    directory: directory::Directory,
    /// What its administrator changed in its register and its roles.
    register: register::Register,
    /// What people say about themselves, and the files kept for that.
    profiles: profiles::Profiles,
    /// The changes the local user made to their profile, in order, each
    /// merged over what it said before.
    own_profile: Vec<serde_json::Map<String, serde_json::Value>>,
}

/// The accounts the demo's server has registered: everybody of `users` who
/// has one, and two who are not here, one of them never seen.
fn registered_of(users: &[User]) -> Vec<Registered> {
    // As a server writes it: the date and the time of day, in UTC.
    let ago = |days: i64| -> gpui::SharedString {
        let at = chrono::Utc::now() - chrono::Duration::days(days);
        at.format("%Y-%m-%dT%H:%M:%SZ").to_string().into()
    };
    let here = users.iter().filter_map(|user| {
        Some(Registered {
            id: user.account?,
            name: user.name.clone(),
            last_seen: Some(ago(0)),
            last_channel: Some(user.channel),
            picture: false,
        })
    });
    let away = [
        Registered {
            id: 120,
            name: "Wren".into(),
            last_seen: Some(ago(12)),
            last_channel: Some(1),
            picture: false,
        },
        Registered {
            id: 121,
            name: "Otto".into(),
            last_seen: None,
            last_channel: None,
            picture: false,
        },
    ];
    here.chain(away).collect()
}

impl State {
    /// Every account the server has registered: the seed's, and the
    /// made-up members it was filled with.
    fn registered(&mut self) -> Vec<Registered> {
        let mut all = registered_of(&self.users);
        all.extend_from_slice(self.directory.accounts());
        self.register.over(all)
    }

    /// The roles the server has to begin with: Rin moderates, in the
    /// colour the server gave the role, besides the made-up members' roles.
    /// None on the plain server.
    fn seeded_roles(&self) -> Vec<Role> {
        if self.plain {
            return Vec::new();
        }
        let mut roles = vec![Role {
            name: "moderators".into(),
            color: Some(gpui::rgb(0xe0_9a4b).into()),
            members: vec![103],
        }];
        roles.extend(self.directory.roles().to_vec());
        roles
    }

    /// The roles as they are now: as seeded, or as last written.
    fn roles(&self) -> Vec<Role> {
        self.register.roles(self.seeded_roles())
    }
}

/// Who the demo's server has banned to begin with: one person for good,
/// and a network for a while.
fn seeded_bans() -> Vec<Ban> {
    vec![
        Ban {
            address: "203.0.113.7".into(),
            mask: 32,
            name: "Mallory".into(),
            hash: gpui::SharedString::default(),
            reason: "spam".into(),
            start: "2026-01-02".into(),
            duration_secs: 0,
        },
        Ban {
            address: "198.51.100.0".into(),
            mask: 24,
            name: gpui::SharedString::default(),
            hash: gpui::SharedString::default(),
            reason: gpui::SharedString::default(),
            start: "2026-02-03".into(),
            duration_secs: 7200,
        },
    ]
}

impl DemoEngine {
    /// Connected to a demo server with a handful of people in one channel.
    pub(crate) fn new() -> Self {
        Self::starting(true)
    }

    /// A server with nothing of Fancy Mumble's on it: two channels, the same
    /// people, what they said as plain text, no welcome. What the web UI
    /// shows of the same server is the reference this view is measured
    /// against.
    pub(crate) fn plain() -> Self {
        let demo = Self::starting(true);
        demo.with_state(|state| {
            state.plain = true;
            state.channels.retain(|channel| channel.id <= LOUNGE);
            for channel in &mut state.channels {
                channel.history = false;
            }
            for user in &mut state.users {
                user.muted = false;
            }
            for (_, message) in &mut state.messages {
                message.html = message.body.clone();
                message.reactions.clear();
            }
        });
        demo
    }

    /// The same server, not yet connected to: what a launch looks like.
    pub(crate) fn disconnected() -> Self {
        Self::starting(false)
    }

    fn starting(connected: bool) -> Self {
        let (events, inbox) = async_channel::unbounded();
        let mut state = State {
            connected,
            ..State::seeded()
        };
        link_cards::put(&mut state.messages);
        Self {
            state: Mutex::new(state),
            // The pattern moves in the demo, and stands still in a test.
            media: std::sync::Arc::new(crate::share::made_up::MadeUp::new(
                events.clone(),
                !cfg!(test),
            )),
            events,
            inbox,
            voice: crate::voice::made_up::Studio::default(),
            gifs: gifs::Gifs::from_environment(),
            wire: file_wire::Wire::default(),
            dual_path: std::sync::atomic::AtomicBool::new(true),
            account: Mutex::new(account::Desk::seeded("Alex")),
            questions: Mutex::new(onboarding::Questions::seeded()),
            elsewhere: Mutex::new(Elsewhere::default()),
            #[cfg(test)]
            uploads: Mutex::default(),
        }
    }

    /// Whether a message to an encrypted channel would also go out plain.
    #[cfg(test)]
    pub(crate) fn dual_path(&self) -> bool {
        self.dual_path.load(std::sync::atomic::Ordering::Relaxed)
    }

    /// The made-up screen sharing: what it was asked to send.
    #[cfg(test)]
    pub(crate) fn made_up(&self) -> &crate::share::made_up::MadeUp {
        &self.media
    }

    /// The second-factor code the last connect came with.
    #[cfg(test)]
    pub(crate) fn code(&self) -> Option<String> {
        self.with_state(|state| state.code.clone())
    }

    /// Have `session` start or stop talking.
    pub(crate) fn talk(&self, session: Session, talking: bool) {
        self.tell(EngineEvent::UserTalking { session, talking });
    }

    /// Have `name` ask for the lounge's key.
    #[cfg(test)]
    pub(crate) fn ask_for_key(&self, hash: &str, name: &str) {
        self.with_state(|state| {
            state.key_requests.push(KeyRequest {
                hash: hash.to_owned().into(),
                name: name.to_owned().into(),
            });
        });
        self.tell(EngineEvent::KeyRequests { channel: LOUNGE });
    }

    /// Who the whisper key speaks to, whether it is held, and how often
    /// a whisper has started.
    #[cfg(test)]
    pub(crate) fn whisper_state(&self) -> (Option<WhisperTarget>, bool, u32) {
        self.with_state(|state| state.whisper)
    }

    /// The shared files the view asked to have saved, and where to.
    #[cfg(test)]
    pub(crate) fn saved(&self) -> Vec<(gpui::SharedString, std::path::PathBuf)> {
        self.with_state(|state| state.saved.clone())
    }

    /// The message the view last said it had read up to.
    #[cfg(test)]
    pub(crate) fn read_up_to_id(&self) -> Option<gpui::SharedString> {
        self.with_state(|state| state.read_up_to.clone())
    }

    /// How often the server was read whole.
    #[cfg(test)]
    pub(crate) fn snapshots(&self) -> u32 {
        self.with_state(|state| state.snapshots)
    }

    /// How often the view said the local user was writing.
    #[cfg(test)]
    pub(crate) fn typed(&self) -> u32 {
        self.with_state(|state| state.typed)
    }

    /// Have somebody else say `body`, which is HTML as a message is, in
    /// `conversation`.
    pub(crate) fn say_as(
        &self,
        session: Session,
        name: &str,
        conversation: Conversation,
        body: &str,
    ) {
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .and_then(|(_, last)| last.sent_at_ms)
                .map_or(FIRST_MESSAGE_MS, |last| last + MINUTE_MS);
            state.messages.push((
                conversation,
                Message {
                    sender: Some(session),
                    sender_name: name.to_owned().into(),
                    html: body.to_owned().into(),
                    body: crate::rich::Rich::parse(body).text.into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: false,
                    id: Some(format!("demo-said-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: Vec::new(),
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
            // Said where nobody is looking: unread until it is looked at.
            if state.opened != Some(conversation) {
                state.count_unread(conversation, 1);
            }
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }

    /// Have Rin show the pictures in `folder` in the lounge, in the order of
    /// their names: each file a message of its own, and the files of each
    /// folder inside together in one. For looking at real pictures, which
    /// are larger than anything an environment variable holds.
    pub(crate) fn show_pictures(&self, folder: &std::path::Path) {
        for entry in sorted(folder) {
            let files = if entry.is_dir() {
                sorted(&entry)
            } else {
                vec![entry]
            };
            let html: String = files
                .iter()
                .filter_map(|file| std::fs::read(file).ok())
                .filter_map(|file| crate::picture::message_html(&file, 0).ok())
                .collect();
            if !html.is_empty() {
                self.say_as(3, "Rin", Conversation::Channel(1), &html);
            }
        }
    }

    /// Give the people here faces and banners made from the pictures in
    /// `folder`, one after another in the order of their names: for
    /// looking at real pictures where faces and banners are drawn.
    pub(crate) fn give_faces(&self, folder: &std::path::Path) {
        let files: Vec<Vec<u8>> = sorted(folder)
            .into_iter()
            .filter(|path| path.is_file())
            .filter_map(|path| std::fs::read(path).ok())
            .collect();
        if files.is_empty() {
            return;
        }
        self.with_state(|state| {
            let sessions: Vec<Session> = state.users.iter().map(|user| user.session).collect();
            for (nth, session) in sessions.into_iter().enumerate() {
                // As a client would send them: scaled for the purpose.
                let face = files.get(nth % files.len());
                let over = files.get((nth + 1) % files.len());
                let face = face
                    .and_then(|file| crate::picture::avatar(file).ok())
                    .and_then(crate::picture::picture)
                    .map(std::sync::Arc::new);
                if let Some(user) = state.users.iter_mut().find(|user| user.session == session) {
                    user.avatar = face;
                }
                if let Some(banner) = over.and_then(|file| crate::picture::banner(file).ok()) {
                    let _ = state.banners.insert(session, banner);
                }
            }
        });
        self.tell(EngineEvent::StateChanged);
    }

    /// What was shared so far: what was said with it, the files, and how.
    #[cfg(test)]
    pub(crate) fn shares(&self) -> Vec<(String, Vec<std::path::PathBuf>, crate::engine::ShareAs)> {
        self.with_state(|state| state.shared.clone())
    }

    /// Say something happened, as a server would.
    #[cfg(test)]
    pub(crate) fn emit(&self, event: EngineEvent) {
        self.tell(event);
    }

    /// Change what the server says of the channel `id`, and say that it did.
    #[cfg(test)]
    pub(crate) fn alter_channel(&self, id: ChannelId, change: impl FnOnce(&mut Channel)) {
        self.with_state(|state| {
            if let Some(channel) = state.channels.iter_mut().find(|known| known.id == id) {
                change(channel);
            }
        });
        self.tell(EngineEvent::StateChanged);
    }

    /// Register `count` made-up members who are not here, every
    /// `pictured`th with a picture, under made-up roles: a server with a
    /// long list of members.
    pub(crate) fn fill_directory(&self, count: usize, pictured: usize) {
        self.with_state(|state| state.directory.fill(count, pictured));
        self.tell(EngineEvent::StateChanged);
    }

    /// Refuse to list the accounts to the member list from now on, as a
    /// server does to a guest.
    #[cfg(test)]
    pub(crate) fn refuse_directory(&self) {
        self.with_state(|state| state.directory.refuses = true);
    }

    /// How often the member list asked for the accounts, whose pictures it
    /// asked for, and how often it let go of them.
    #[cfg(test)]
    pub(crate) fn directory_asked(&self) -> (u32, Vec<u32>, u32) {
        self.with_state(|state| {
            let directory = &state.directory;
            (
                directory.asked,
                directory.pictures_asked.clone(),
                directory.put_away,
            )
        })
    }

    /// Lose the connection, as a server going away does: it is tried
    /// again after `pause`.
    #[cfg(test)]
    pub(crate) fn lose_connection(&self, pause: std::time::Duration) {
        self.with_state(|state| {
            state.connected = false;
            state.retry = Some(crate::engine::Retry {
                attempt: 1,
                at: std::time::Instant::now() + pause,
            });
        });
        self.tell(EngineEvent::StateChanged);
        self.tell(EngineEvent::CurrentChannelChanged);
    }

    /// Have there be this much to bring over from the web client.
    #[cfg(test)]
    pub(crate) fn offer_carry(&self, servers: usize, certificates: usize) {
        self.with_state(|state| {
            state.carry = Some(crate::engine::CarryOver {
                servers,
                certificates,
            });
        });
        self.tell(EngineEvent::ServersChanged);
    }

    /// Every action asked of the demo so far.
    #[cfg(test)]
    pub(crate) fn actions(&self) -> Vec<Action> {
        self.with_state(|state| state.actions.clone())
    }

    /// Turn the user away as a server does that wants something typed.
    #[cfg(test)]
    pub(crate) fn refuse(&self, wanted: crate::engine::Wanted, words: &str) {
        self.tell(EngineEvent::Wanted(wanted));
        self.notify(Some(words));
    }

    /// Tell the user something, as a refused connection would.
    #[cfg(test)]
    pub(crate) fn notify(&self, notice: Option<&str>) {
        self.tell(EngineEvent::Notice(
            notice.map(|text| text.to_owned().into()),
        ));
    }

    /// Have the server send `html` as its welcome from now on.
    #[cfg(test)]
    pub(crate) fn set_welcome(&self, html: &str) {
        self.with_state(|state| state.welcome = html.to_owned().into());
        self.tell(EngineEvent::StateChanged);
    }

    /// People on other servers, for a test, and the session last turned to.
    pub(crate) fn elsewhere(&self) -> std::sync::MutexGuard<'_, Elsewhere> {
        self.elsewhere
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The questions and the answers kept.
    pub(crate) fn questions(&self) -> std::sync::MutexGuard<'_, onboarding::Questions> {
        self.questions
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// The account desk.
    fn desk(&self) -> std::sync::MutexGuard<'_, account::Desk> {
        self.account
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    /// Tell what the server said of the account; where its name changed or
    /// it is gone, the local user is renamed or unregistered too, as a
    /// server says of them.
    fn account_changed(&self, news: Vec<crate::engine::AccountNews>) {
        for news in news {
            if let crate::engine::AccountNews::Settings(account) = &news {
                let (name, registered) = (account.name.clone(), account.registered);
                self.with_state(|state| state.account_said(name, registered));
                self.tell(EngineEvent::StateChanged);
            }
            self.tell(EngineEvent::Account(news));
        }
    }

    fn with_state<R>(&self, f: impl FnOnce(&mut State) -> R) -> R {
        let mut state = self
            .state
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        f(&mut state)
    }

    /// What the servers say of their liveries, for a test to read or change.
    #[cfg(test)]
    pub(crate) fn liveries<R>(&self, f: impl FnOnce(&mut livery::Liveries) -> R) -> R {
        self.with_state(|state| f(&mut state.liveries))
    }

    /// Answer the probe of `key` that was held back, as the server would.
    #[cfg(test)]
    pub(crate) fn answer_probe(&self, key: &str) {
        let livery = self.with_state(|state| state.liveries.held(key));
        self.tell(EngineEvent::LiveryProbed {
            key: key.to_owned().into(),
            livery,
        });
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
            Action::ServerMute { .. }
            | Action::ServerDeafen { .. }
            | Action::MoveUser { .. }
            | Action::RemovePicture { .. }
            | Action::SetAvatar(_)
            | Action::PatchProfile(_)
            | Action::SetBanner(_) => self.apply_to_people(action),
            Action::MakeChannel(new) => self.make_channel(new),
            Action::MoveEveryone { from, to } => {
                for user in self.users.iter_mut().filter(|user| user.channel == *from) {
                    user.channel = *to;
                }
            }
            Action::Purge { channel, by } => {
                let room = Conversation::Channel(*channel);
                self.messages.retain(|(place, message)| {
                    *place != room || by.is_some_and(|by| message.sender != Some(by))
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
            Action::EditMessage { .. }
            | Action::DeleteMessage { .. }
            | Action::DeleteMessages { .. }
            | Action::Pin { .. }
            | Action::React { .. }
            | Action::CreatePoll { .. }
            | Action::Vote { .. }
            | Action::ToggleListen { .. }
            | Action::PrioritySpeaker { .. } => self.apply_further(action),
            Action::AnswerKeyRequest { hash, .. } => {
                self.key_requests
                    .retain(|asking| asking.hash.as_ref() != hash);
            }
            Action::SendLater {
                channel,
                body,
                at_ms,
            } => {
                self.scheduled.push(Scheduled {
                    // No two actions have the same place in the record.
                    id: format!("later-{}", self.actions.len()).into(),
                    channels: vec![*channel],
                    html: body.clone().into(),
                    at_ms: *at_ms,
                });
            }
            Action::CancelScheduled(id) => self.scheduled.retain(|waiting| waiting.id != *id),
            Action::SetBans(bans) => self.bans.clone_from(bans),
            Action::RenameRegistered { .. } | Action::Unregister { .. } | Action::SetAcl(_) => {
                self.register.apply(action);
            }
            Action::SetUserVolume { .. }
            | Action::ResetComment { .. }
            | Action::DescribeChannel { .. }
            | Action::SetChannelPassword { .. }
            | Action::Register { .. }
            | Action::SetComment(_) => {}
        }
    }

    /// The part of [`Self::apply`] that changes somebody: their mute, deafness,
    /// channel or picture, and the local user's own profile and banner.
    fn apply_to_people(&mut self, action: &Action) {
        match action {
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
            Action::RemovePicture { session } => {
                if let Some(user) = self.users.iter_mut().find(|user| user.session == *session) {
                    user.avatar = None;
                }
            }
            Action::SetAvatar(face) => {
                let face = crate::picture::picture(face.clone()).map(std::sync::Arc::new);
                if let Some(own) = self.users.iter_mut().find(|user| user.session == OWN) {
                    own.avatar = face;
                }
            }
            Action::PatchProfile(change) => self.own_profile.push(change.clone()),
            Action::SetBanner(banner) => {
                let _ = if banner.is_empty() {
                    self.banners.remove(&OWN)
                } else {
                    self.banners.insert(OWN, banner.clone())
                };
            }
            _ => {}
        }
    }

    /// The rest of [`Self::apply`]: messages, polls, and what is set on a
    /// channel or a user for the local user alone.
    /// A new channel under `parent`, with the next id.
    /// Make the channel the form for one describes.
    fn make_channel(&mut self, new: &crate::engine::NewChannel) {
        use crate::engine::Kept;
        self.add_channel(
            new.parent,
            &new.name,
            new.kept != Kept::No,
            matches!(new.kept, Kept::Sealed | Kept::Signal),
        );
        if let Some(made) = self.channels.last_mut() {
            made.position = new.position.unwrap_or(0);
            made.restricted = !new.password.is_empty();
            made.signal = new.kept == Kept::Signal;
            made.temporary = new.temporary;
            made.max_users = new.most.unwrap_or(0);
        }
    }

    fn add_channel(&mut self, parent: ChannelId, name: &str, history: bool, encrypted: bool) {
        let id = self
            .channels
            .iter()
            .map(|known| known.id)
            .max()
            .unwrap_or(0)
            + 1;
        self.channels.push(Channel {
            id,
            parent: Some(parent),
            name: name.to_owned().into(),
            position: 0,
            unread: 0,
            history,
            encrypted,
            listening: false,
            rights: crate::rights::Rights::ALL,
            restricted: false,
            signal: false,
            temporary: false,
            max_users: 0,
        });
    }

    fn apply_further(&mut self, action: &Action) {
        match action {
            Action::EditMessage { id, text, .. } => {
                if let Some(message) = self.message(id) {
                    message.html = text.replace('&', "&amp;").replace('<', "&lt;").into();
                    message.body = text.clone().into();
                    message.edited = true;
                }
            }
            Action::DeleteMessages { ids, .. } => {
                self.messages.retain(|(_, message)| {
                    message
                        .id
                        .as_ref()
                        .is_none_or(|known| !ids.iter().any(|id| id == known.as_ref()))
                });
            }
            Action::DeleteMessage { id, .. } => {
                self.messages.retain(|(_, message)| {
                    message
                        .id
                        .as_ref()
                        .is_none_or(|known| known.as_ref() != id.as_str())
                });
            }
            Action::Pin { id, pinned, .. } => {
                if let Some(message) = self.message(id) {
                    message.pinned = *pinned;
                }
            }
            Action::ToggleListen { channel } => {
                if let Some(found) = self.channels.iter_mut().find(|known| known.id == *channel) {
                    found.listening = !found.listening;
                }
            }
            Action::PrioritySpeaker { session, priority } => {
                if let Some(user) = self.users.iter_mut().find(|user| user.session == *session) {
                    user.priority = *priority;
                }
            }
            Action::React { id, emoji, add, .. } => {
                if let Some(message) = self.message(id) {
                    react(&mut message.reactions, emoji, *add);
                }
            }
            Action::CreatePoll {
                question,
                options,
                multiple,
                ..
            } => self.ask(question, options, *multiple),
            Action::Vote { poll, selected, .. } => {
                if let Some(held) = self.polls.iter_mut().find(|held| held.id.as_ref() == poll) {
                    cast(held, selected);
                }
            }
            _ => {}
        }
    }

    /// Put a poll to the lounge, as the local user.
    fn ask(&mut self, question: &str, options: &[String], multiple: bool) {
        let at_ms = self
            .messages
            .last()
            .and_then(|(_, last)| last.sent_at_ms)
            .map_or(FIRST_MESSAGE_MS, |last| last + MINUTE_MS);
        self.polls.push(Poll {
            id: format!("poll-{}", self.polls.len()).into(),
            question: question.to_owned().into(),
            options: options
                .iter()
                .map(|text| PollOption {
                    text: text.clone().into(),
                    votes: 0,
                    own: false,
                })
                .collect(),
            multiple,
            by: "Alex".into(),
            at_ms,
        });
    }

    fn message(&mut self, id: &str) -> Option<&mut Message> {
        self.messages
            .iter_mut()
            .map(|(_, message)| message)
            .find(|message| {
                message
                    .id
                    .as_ref()
                    .is_some_and(|known| known.as_ref() == id)
            })
    }

    fn seeded() -> Self {
        let user = |session, name: &str| User {
            session,
            name: name.to_owned().into(),
            channel: LOUNGE,
            muted: session == OWN,
            deafened: false,
            server_muted: false,
            server_deafened: false,
            avatar: None,
            unread: 0,
            priority: false,
            // Everybody but Scout has registered.
            account: (session != 4).then_some(session + 100),
            hash: Some(format!("h{session}").into()),
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
                    id: Some(format!("demo-{minute}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: Vec::new(),
                    reply_to: None,
                    reactions: Vec::new(),
                },
            )
        };
        Self {
            connected: true,
            banners: std::collections::HashMap::new(),
            plain: false,
            welcome: welcome_html().into(),
            voice: Voice::Off,
            deafened: false,
            devices: ChosenDevices::default(),
            actions: Vec::new(),
            voice_settings: seeded_voice(),
            tuning: std::collections::BTreeMap::new(),
            stats: None,
            servers: seeded_servers(),
            retry: None,
            carry: None,
            current_channel: LOUNGE,
            channels: seeded_channels(),
            users: vec![
                user(OWN, "Alex"),
                user(2, "Flora"),
                user(3, "Rin"),
                user(4, "Scout"),
                user(5, "Torque"),
            ],
            typed: 0,
            snapshots: 0,
            read_up_to: None,
            opened: None,
            polls: Vec::new(),
            whisper: (None, false, 0),
            key_requests: Vec::new(),
            scheduled: Vec::new(),
            bans: seeded_bans(),
            recording: None,
            code: None,
            saved: Vec::new(),
            shared: Vec::new(),
            kept: std::collections::HashMap::new(),
            liveries: livery::Liveries::seeded(),
            directory: directory::Directory::default(),
            register: register::Register::default(),
            profiles: profiles::Profiles::seeded(),
            own_profile: Vec::new(),
            certificates: vec!["alex".into(), "work".into()],
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
                reacted_to(said(4, 4, "Scout", "Scout says hello from our walk!")),
            ],
        }
    }
}

/// How the demo's microphone starts out set.
/// What `folder` holds, in the order of the names.
fn sorted(folder: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut held: Vec<_> = std::fs::read_dir(folder)
        .into_iter()
        .flatten()
        .flatten()
        .map(|entry| entry.path())
        .collect();
    held.sort();
    held
}

fn seeded_voice() -> VoiceSettings {
    VoiceSettings {
        push_to_talk: false,
        threshold: 0.01,
        noise_suppression: true,
        automatic_gain: true,
        input_volume: 1.0,
        output_volume: 1.0,
        bitrate_bps: 72_000,
        voice_over_tcp: false,
        ..VoiceSettings::default()
    }
}

/// The demo server's channels: a root, the lounge that keeps what is said,
/// and two more. `FANCY_GPUI_DEMO_ROOM` names the lounge otherwise, as the
/// web preview's `?room=` does: a way to look at a drawn theme's wordmark.
fn seeded_channels() -> Vec<Channel> {
    let lounge = std::env::var("FANCY_GPUI_DEMO_ROOM").unwrap_or_else(|_| "lounge".to_owned());
    let channel = |id, parent, name: &str| Channel {
        id,
        parent,
        name: name.to_owned().into(),
        position: 0,
        unread: 0,
        history: false,
        encrypted: false,
        listening: false,
        rights: crate::rights::Rights::ALL,
        restricted: false,
        signal: false,
        temporary: false,
        max_users: 0,
    };
    vec![
        channel(0, None, "Root"),
        Channel {
            history: true,
            ..channel(LOUNGE, Some(0), &lounge)
        },
        channel(2, Some(0), "studio"),
        channel(3, Some(0), "afk"),
    ]
}

/// The identities the demo starts with saved.
fn seeded_servers() -> Vec<SavedServer> {
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

/// The local user answers `poll` with the options at `selected`, in place
/// of what they answered before.
fn cast(poll: &mut Poll, selected: &[u32]) {
    for (option, place) in poll.options.iter_mut().zip(0_u32..) {
        let chosen = selected.contains(&place);
        if chosen && !option.own {
            option.votes += 1;
        } else if !chosen && option.own {
            option.votes -= 1;
        }
        option.own = chosen;
    }
}

/// Something to look at: a message people reacted to.
fn reacted_to((room, mut message): (Conversation, Message)) -> (Conversation, Message) {
    message.reactions = vec![
        Reaction {
            emoji: "👍".into(),
            count: 2,
            own: true,
        },
        Reaction {
            emoji: "🎉".into(),
            count: 1,
            own: false,
        },
    ];
    (room, message)
}

/// The local user puts `emoji` on a message, or takes theirs off.
fn react(reactions: &mut Vec<Reaction>, emoji: &str, add: bool) {
    let at = reactions.iter().position(|known| known.emoji == emoji);
    match (at, add) {
        (Some(at), true) if !reactions[at].own => {
            reactions[at].count += 1;
            reactions[at].own = true;
        }
        (None, true) => reactions.push(Reaction {
            emoji: emoji.to_owned().into(),
            count: 1,
            own: true,
        }),
        (Some(at), false) if reactions[at].own => {
            reactions[at].count -= 1;
            reactions[at].own = false;
            if reactions[at].count == 0 {
                let _ = reactions.remove(at);
            }
        }
        _ => {}
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

/// The made-up recovery phrase every demo identity has.
const DEMO_PHRASE: &str = "abandon ability able about above absent absorb abstract absurd abuse access accident account accuse achieve acid acoustic acquire across act action actor actress actual";

impl Engine for DemoEngine {
    fn events(&self) -> async_channel::Receiver<EngineEvent> {
        self.inbox.clone()
    }

    fn media(&self) -> std::sync::Arc<dyn crate::share::Media> {
        self.media.clone()
    }

    fn snapshot(&self) -> Snapshot {
        self.with_state(|state| {
            state.snapshots += 1;
            if !state.connected {
                return Snapshot {
                    retry: state.retry,
                    ..Snapshot::disconnected()
                };
            }
            Snapshot {
                connection: Connection::Connected,
                own_session: Some(OWN),
                current_channel: Some(state.current_channel),
                channels: state.channels.clone(),
                users: state.users.clone(),
                voice: state.voice,
                deafened: state.deafened,
                welcome: (!state.plain).then(|| state.welcome.clone()),
                sessions: vec![SessionEntry {
                    id: "demo".into(),
                    name: session_name().into(),
                    key: "magical.rocks:64738".into(),
                    active: true,
                    connecting: false,
                }],
                fancy: !state.plain,
                retry: None,
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

    fn key_requests(&self, channel: ChannelId) -> Vec<KeyRequest> {
        if channel != LOUNGE {
            return Vec::new();
        }
        self.with_state(|state| state.key_requests.clone())
    }

    fn polls(&self, conversation: Conversation) -> Vec<Poll> {
        if conversation != Conversation::Channel(LOUNGE) {
            return Vec::new();
        }
        self.with_state(|state| state.polls.clone())
    }

    fn read_up_to(&self, _conversation: Conversation, id: gpui::SharedString) {
        self.with_state(|state| state.read_up_to = Some(id));
    }

    fn search_messages(&self, query: &str) -> Vec<Found> {
        let wanted = query.to_lowercase();
        self.with_state(|state| {
            let held = |conversation: Conversation| {
                state
                    .messages
                    .iter()
                    .filter(move |(of, _)| *of == conversation)
            };
            state
                .messages
                .iter()
                .filter(|(_, message)| message.body.to_lowercase().contains(&wanted))
                .map(|(conversation, message)| Found {
                    text: message.body.clone(),
                    about: format!("{} · in the demo", message.sender_name).into(),
                    conversation: *conversation,
                    at: message.id.clone().and_then(|id| {
                        let place = held(*conversation)
                            .position(|(_, other)| other.id.as_ref() == Some(&id))?;
                        Some((id, held(*conversation).count() - place))
                    }),
                })
                .collect()
        })
    }

    fn previews(&self, urls: Vec<gpui::SharedString>) {
        self.tell(EngineEvent::Previews(
            urls.into_iter()
                .map(|url| {
                    link_cards::preview(&url).unwrap_or_else(|| Preview {
                        title: Some("A walk by the river".into()),
                        description: Some("Photos from the towpath, taken on Sunday.".into()),
                        site: Some("example.org".into()),
                        url,
                        ..Preview::default()
                    })
                })
                .collect(),
        ));
    }

    fn request_acl(&self, channel: ChannelId) {
        // The root's rules as they were last written, once they were.
        let written = (channel == 0)
            .then(|| self.with_state(|state| state.register.root().cloned()))
            .flatten();
        if let Some(root) = written {
            self.tell(EngineEvent::Acl(root));
            return;
        }
        let rule = |group: &str, inherited, grant, deny| AclRule {
            here: true,
            subs: true,
            inherited,
            user: None,
            group: Some(group.to_owned().into()),
            grant,
            deny,
        };
        let mut rules = vec![
            rule("all", true, 0x2 | 0x4 | 0x8 | 0x200, 0),
            rule("auth", false, 0x40, 0),
        ];
        // The root keeps the server's roles, as groups.
        let mut groups = if channel == 0 {
            register::groups(&self.roles())
        } else {
            Vec::new()
        };
        // The lounge has moderators: Rin, by the parent's say.
        if channel == LOUNGE {
            rules.push(rule("moderators", false, 0x1_0000, 0));
            groups.push(AclGroup {
                inherited: vec![103],
                from_parent: true,
                ..AclGroup::new("moderators")
            });
        }
        self.tell(EngineEvent::Acl(Acl {
            channel,
            inherit: true,
            groups,
            rules,
        }));
    }

    fn roles(&self) -> Vec<Role> {
        self.with_state(|state| state.roles())
    }

    fn signal_available(&self) -> bool {
        true
    }

    fn is_recording(&self) -> bool {
        self.with_state(|state| state.recording.is_some())
    }

    fn record(&self, directory: Option<std::path::PathBuf>) {
        self.with_state(|state| state.recording = directory);
        self.tell(EngineEvent::StateChanged);
    }

    fn request_scheduled(&self) {
        let waiting = self.with_state(|state| state.scheduled.clone());
        self.tell(EngineEvent::Scheduled(waiting));
    }

    fn list(&self, listing: Listing) {
        self.tell(match listing {
            Listing::Bans => EngineEvent::Bans(self.with_state(|state| state.bans.clone())),
            Listing::Registered => EngineEvent::Registered(self.with_state(State::registered)),
        });
    }

    fn directory(&self) {
        let refused = self.with_state(|state| {
            state.directory.asked += 1;
            state.directory.refuses
        });
        if refused {
            self.tell(EngineEvent::DirectoryRefused);
        } else {
            self.list(Listing::Registered);
        }
    }

    fn account_picture(&self, account: u32) -> Option<std::sync::Arc<gpui::Image>> {
        self.with_state(|state| state.directory.picture(account))
            .and_then(crate::picture::picture)
            .map(std::sync::Arc::new)
    }

    fn put_directory_away(&self) {
        self.with_state(|state| state.directory.put_away());
    }

    fn certificates(&self) -> Vec<gpui::SharedString> {
        self.with_state(|state| state.certificates.clone())
    }

    fn recovery_phrase(&self, label: &str) -> Result<String, String> {
        let held = self.with_state(|state| state.certificates.iter().any(|known| known.as_ref() == label));
        if !held {
            return Err(format!("There is no identity called {label}."));
        }
        // Made up, and the same every time: twenty-four words.
        Ok(DEMO_PHRASE.to_owned())
    }

    fn restore_phrase(&self, label: &str, phrase: &str) -> Result<(), String> {
        if phrase.split_whitespace().count() != 24 {
            return Err("That is not a recovery phrase of 24 words.".to_owned());
        }
        let _ = label;
        Ok(())
    }

    fn manage_certificate(&self, task: CertificateTask) {
        self.with_state(|state| match task {
            CertificateTask::Delete(label) => {
                state.certificates.retain(|held| held.as_ref() != label);
            }
            CertificateTask::Create(label) => {
                if !state.certificates.iter().any(|held| held.as_ref() == label) {
                    state.certificates.push(label.into());
                    state.certificates.sort();
                }
            }
            CertificateTask::Import(from) => {
                let label = from
                    .file_stem()
                    .map(|stem| stem.to_string_lossy().into_owned())
                    .unwrap_or_default();
                state.certificates.push(label.into());
                state.certificates.sort();
            }
            CertificateTask::Export { .. } => {}
        });
        self.tell(EngineEvent::CertificatesChanged);
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

    fn pinged(&self, host: &str, port: u16) -> Option<crate::livery::Pinged> {
        let up = self.ping(host, port).is_some();
        self.with_state(|state| state.liveries.pinged(&format!("{host}:{port}"), up))
    }

    fn live_livery(&self, key: &str) -> Option<std::sync::Arc<crate::livery::Livery>> {
        self.with_state(|state| {
            let (at, livery) = state.liveries.live.as_ref().filter(|_| state.connected)?;
            (at == key).then(|| std::sync::Arc::clone(livery))
        })
    }

    fn probe_livery(&self, host: &str, port: u16) {
        let key = format!("{host}:{port}");
        let answer = self.with_state(|state| {
            state.liveries.probes.push(key.clone());
            state
                .liveries
                .answering
                .then(|| state.liveries.held(&key))
        });
        if let Some(livery) = answer {
            self.tell(EngineEvent::LiveryProbed {
                key: key.into(),
                livery,
            });
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

    fn connect_with_code(&self, id: &str, password: Option<String>, code: Option<String>) {
        self.with_state(|state| state.code = code.filter(|code| !code.is_empty()));
        self.connect(id, password);
    }

    fn disconnect(&self) {
        let left = self.with_state(|state| {
            let waited = state.retry.take().is_some();
            std::mem::replace(&mut state.connected, false) || waited
        });
        if left {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::CurrentChannelChanged);
        }
    }

    fn carry_over(&self) -> Option<crate::engine::CarryOver> {
        self.with_state(|state| state.carry)
    }

    fn carry_now(&self) {
        // The demo brings a server of the name it was told there were.
        let brought = self.with_state(|state| {
            let carry = state.carry.take()?;
            for nth in 0..carry.servers {
                state.servers.push(SavedServer {
                    id: format!("carried-{nth}").into(),
                    label: format!("Brought over {}", nth + 1).into(),
                    host: format!("carried{nth}.example").into(),
                    port: 64738,
                    username: "Alex".into(),
                    certificate: None,
                    favorite: false,
                });
            }
            Some(carry)
        });
        if let Some(carry) = brought {
            self.tell(EngineEvent::ServersChanged);
            self.tell(EngineEvent::Done(
                format!("Brought over {} servers.", carry.servers).into(),
            ));
        }
    }

    fn set_reconnecting(&self, _: bool) {}

    fn set_dual_path(&self, sending: bool) {
        self.dual_path.store(sending, std::sync::atomic::Ordering::Relaxed);
    }

    fn account_offered(&self) -> bool {
        self.with_state(|state| state.connected && !state.plain)
    }

    fn account(&self) -> Option<crate::engine::AccountSettings> {
        Some(self.desk().account())
    }

    fn update_account(&self, action: crate::engine::AccountAction, password: Option<String>) {
        let news = self.desk().answer(action, password.as_deref());
        self.account_changed(news);
    }

    fn offer_account(&self, _: Option<String>) {
        let link = self.desk().offer();
        let account = self.desk().account();
        self.tell(EngineEvent::Account(crate::engine::AccountNews::Link(Ok(link))));
        self.tell(EngineEvent::Account(crate::engine::AccountNews::Settings(account)));
    }

    fn onboarding_offered(&self) -> bool {
        self.with_state(|state| state.connected && !state.plain)
    }

    fn onboarding_config(&self) -> Option<crate::engine::OnboardingConfig> {
        Some(self.questions().config.clone())
    }

    fn onboarding_response(&self) -> Option<crate::engine::OnboardingResponse> {
        self.questions().response.clone()
    }

    fn request_onboarding_response(&self) {
        let kept = self.questions().response.clone();
        self.tell(EngineEvent::Onboarding(
            crate::engine::OnboardingNews::Response(kept),
        ));
    }

    fn submit_onboarding(&self, response: crate::engine::OnboardingResponse) {
        self.questions().response = Some(response);
    }

    fn server_plugins(&self) -> Vec<crate::engine::ServerPlugin> {
        if !self.onboarding_offered() {
            return Vec::new();
        }
        let plugin = |name: &str, version: &str, description: &str, asks: &[&str]| {
            crate::engine::ServerPlugin {
                name: name.to_owned(),
                version: version.to_owned(),
                description: Some(description.to_owned()),
                capabilities: asks.iter().map(|capability| (*capability).to_owned()).collect(),
            }
        };
        vec![
            plugin(
                "fancy-live-doc",
                "1.4.0",
                "Shared notes everybody in a channel writes at once.",
                &["slash_commands", "settings_panel"],
            ),
            plugin("dice-roller", "0.3.1", "Rolls dice for the table.", &[]),
        ]
    }

    fn signal_bridge(&self) -> Option<crate::engine::SignalBridge> {
        Some(crate::engine::SignalBridge {
            installed: false,
            addon: false,
            version: "0.1.0",
        })
    }

    fn withdraw_offer(&self, device: String) {
        self.desk().withdraw(&device);
        let account = self.desk().account();
        self.tell(EngineEvent::Account(crate::engine::AccountNews::Settings(account)));
    }

    fn retry_now(&self) {
        // The demo's server is always there to come back to.
        let waited = self.with_state(|state| {
            let waited = state.retry.take().is_some();
            state.connected |= waited;
            waited
        });
        if waited {
            self.tell(EngineEvent::StateChanged);
            self.tell(EngineEvent::CurrentChannelChanged);
        }
    }

    fn window(&self, conversation: Conversation, limit: usize) -> Window {
        self.with_state(|state| {
            let held = state.messages.iter().filter(|(of, _)| *of == conversation);
            let skipped = held.clone().count().saturating_sub(limit);
            Window {
                messages: held
                    .skip(skipped)
                    .map(|(_, message)| message.clone())
                    .collect(),
                earlier: skipped > 0,
            }
        })
    }

    fn load_earlier(&self, _conversation: Conversation, _before: Option<gpui::SharedString>) {}

    fn pins(&self, conversation: Conversation) -> Vec<crate::engine::Pin> {
        self.with_state(|state| {
            let held: Vec<&Message> = state
                .messages
                .iter()
                .filter(|(of, _)| *of == conversation)
                .map(|(_, message)| message)
                .collect();
            let mut pins: Vec<_> = held
                .iter()
                .enumerate()
                .filter(|(_, message)| message.pinned)
                .filter_map(|(at, message)| {
                    Some(crate::engine::Pin {
                        id: message.id.clone()?,
                        by: Some("Alex".into()),
                        at_ms: message.sent_at_ms,
                        said: Some(crate::engine::Pinned {
                            sender_name: message.sender_name.clone(),
                            text: message.body.clone(),
                            sent_at_ms: message.sent_at_ms,
                            from_newest: held.len() - at,
                        }),
                    })
                })
                .collect();
            pins.reverse();
            pins
        })
    }

    fn message_count(&self, conversation: Conversation) -> usize {
        self.with_state(|state| {
            state
                .messages
                .iter()
                .filter(|(of, _)| *of == conversation)
                .count()
        })
    }

    fn open(&self, conversation: Conversation) {
        self.with_state(|state| {
            state.opened = Some(conversation);
            state.count_unread(conversation, 0);
        });
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
                    id: Some(format!("demo-sent-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: Vec::new(),
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }

    fn send_reply(&self, conversation: Conversation, to: gpui::SharedString, body: String) {
        self.send_message(conversation, body);
        self.with_state(|state| {
            if let Some((_, sent)) = state.messages.last_mut() {
                sent.reply_to = Some(to);
            }
        });
    }

    fn send_gif(
        &self,
        conversation: Conversation,
        url: gpui::SharedString,
        reply_to: Option<gpui::SharedString>,
    ) {
        self.send_gif_now(conversation, &url, reply_to);
    }

    fn gif_service(&self) -> Option<crate::gif::Service> {
        self.gifs.service()
    }

    fn send_picture(&self, conversation: Conversation, file: Vec<u8>) {
        match crate::picture::message_html(&file, 0) {
            Ok(html) => {
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
                            html: html.into(),
                            body: "sent an image".into(),
                            sent_at_ms: Some(sent_at_ms),
                            own: true,
                            id: Some(format!("demo-sent-{sent_at_ms}").into()),
                            edited: false,
                            failed: false,
                            pinned: false,
                            files: Vec::new(),
                            reply_to: None,
                            reactions: Vec::new(),
                        },
                    ));
                });
                self.tell(EngineEvent::NewMessage { conversation });
            }
            Err(problem) => self.tell(EngineEvent::Notice(Some(problem.into()))),
        }
    }

    fn send_pictures(&self, conversation: Conversation, files: Vec<Vec<u8>>) {
        self.send_pictures_now(conversation, &files);
    }

    fn send_file(&self, conversation: Conversation, path: std::path::PathBuf) {
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_default();
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
                    html: gpui::SharedString::default(),
                    body: "sent a file".into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: true,
                    id: Some(format!("demo-sent-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: vec![Attachment {
                        key: Some(format!("demo/{name}").into()),
                        name: name.into(),
                        size: Some(1_536),
                        ..Attachment::default()
                    }],
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }

    fn share(
        &self,
        conversation: Conversation,
        text: String,
        files: Vec<std::path::PathBuf>,
        how: crate::engine::ShareAs,
    ) {
        use crate::engine::{OpenTo, Reach};
        let open_to = match how.reach {
            Reach::Here => OpenTo::Here,
            Reach::Link => OpenTo::Link,
            Reach::Password(_) => OpenTo::Password,
        };
        self.wire
            .said(&text, &files, open_to != OpenTo::Password);
        let lasts = how.lasts.secs();
        self.with_state(|state| {
            let attached: Vec<Attachment> = files
                .iter()
                .map(|path| {
                    let name = path
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_default();
                    let key = gpui::SharedString::from(format!("demo/{name}"));
                    let file = std::fs::read(path).unwrap_or_default();
                    let pixels = crate::picture::dimensions(&file);
                    let size = Some(file.len() as u64);
                    if pixels.is_some() {
                        let _ = state.kept.insert(key.clone(), file);
                    }
                    Attachment {
                        name: name.into(),
                        size,
                        url: (open_to != OpenTo::Here)
                            .then(|| format!("https://files.example/s/{key}").into()),
                        key: Some(key),
                        open_to,
                        stand_in: None,
                        pixels,
                        voice: None,
                        expires_at: (lasts > 0).then(|| {
                            std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .map_or(0, |since| since.as_secs())
                                + lasts
                        }),
                    }
                })
                .collect();
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
                    html: demo_markup(&text).into(),
                    body: text.clone().into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: true,
                    id: Some(format!("demo-sent-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: attached,
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
            state.shared.push((text, files, how));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }

    fn share_tracked(
        &self,
        conversation: Conversation,
        text: String,
        files: Vec<(gpui::SharedString, std::path::PathBuf)>,
        how: crate::engine::ShareAs,
    ) {
        self.share_made_up(conversation, text, files, how);
    }

    fn cancel_upload(&self, id: gpui::SharedString) {
        self.cancel_made_up(&id);
    }

    fn fetch_shared(&self, key: gpui::SharedString) {
        self.wire.asked(&key);
        let picture = self
            .with_state(|state| {
                (state.kept.get(&key))
                    .or_else(|| state.profiles.file(&key))
                    .cloned()
            })
            .and_then(crate::picture::picture)
            .map(std::sync::Arc::new);
        self.tell(EngineEvent::Shared { key, picture });
    }

    fn save_about(&self, save: crate::profile::Save) {
        let saved = self.with_state(|state| state.profiles.save(&save));
        self.tell(EngineEvent::AboutSaved(saved.map_err(Into::into)));
    }

    fn fetch_page(&self, page: mumble_tauri_lib::engine_api::about::PageRef) {
        let fetched = self.with_state(|state| state.profiles.page(&page));
        self.tell(EngineEvent::ProfilePage {
            key: page.key.into(),
            page: fetched.map(std::sync::Arc::new).map_err(Into::into),
        });
    }

    fn voice_support(&self) -> Option<crate::voice::Support> {
        self.voice.support()
    }

    fn recorder(&self) -> Box<dyn crate::voice::Recorder> {
        Box::new(self.voice.recorder())
    }

    fn voice_player(&self) -> Box<dyn crate::voice::Player> {
        Box::new(self.voice.player())
    }

    fn send_voice(&self, conversation: Conversation, clip: crate::voice::Clip) {
        self.say_voice(conversation, &clip);
    }

    fn save_file(&self, key: gpui::SharedString, to: std::path::PathBuf) {
        self.with_state(|state| state.saved.push((key, to)));
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

    fn turn_voice_off(&self) {
        self.with_state(|state| {
            state.voice = Voice::Off;
            state.deafened = false;
            if let Some(own) = state.users.iter_mut().find(|user| user.session == OWN) {
                own.muted = true;
                own.deafened = false;
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

    fn typing(&self, _conversation: Conversation) {
        self.with_state(|state| state.typed += 1);
    }

    fn typed(&self, text: &str) -> Vec<(std::ops::Range<usize>, crate::engine::Setting)> {
        // Read as the real engine reads it: a second reading here would be
        // a second dialect, and this one needs no engine running.
        crate::real::typed(text)
    }

    fn source(&self, html: &str) -> String {
        crate::real::source(html)
    }

    fn activate_session(&self, id: &str) {
        self.elsewhere().turned_to = Some(id.to_owned());
    }

    fn register_whisper(
        &self,
        slot: u8,
        reach: Option<mumble_tauri_lib::engine_api::whisper::WhisperReach>,
    ) {
        let slots = &mut self.elsewhere().slots;
        match reach {
            Some(reach) => drop(slots.insert(slot, reach)),
            None => drop(slots.remove(&slot)),
        }
    }

    fn whisper_slot(
        &self,
        slot: u8,
        reach: Option<mumble_tauri_lib::engine_api::whisper::WhisperReach>,
    ) {
        self.elsewhere().whispering = reach.map(|_| slot);
    }

    fn find_user(&self, hash: Option<&str>, name: &str, session: Option<&str>) -> Option<(gpui::SharedString, u32)> {
        if let Some(hash) = hash
            && let Some((on, user, _)) = self.elsewhere().people.iter().find(|(_, _, held)| held.as_str() == hash)
        {
            return Some((on.clone().into(), *user));
        }
        self.with_state(|state| {
            state
                .users
                .iter()
                .find(|user| match hash {
                    Some(hash) => user.hash.as_ref().map(AsRef::as_ref) == Some(hash),
                    None => session == Some("demo") && user.name.as_ref() == name,
                })
                .map(|user| ("demo".into(), user.session))
        })
    }

    fn leave_session(&self, _id: &str) {
        self.disconnect();
    }

    fn set_focused(&self, _focused: bool) {}

    fn act(&self, action: Action) {
        let about_messages = matches!(
            action,
            Action::EditMessage { .. }
                | Action::DeleteMessage { .. }
                | Action::DeleteMessages { .. }
                | Action::React { .. }
                | Action::Pin { .. }
                | Action::CreatePoll { .. }
                | Action::Vote { .. }
        );
        let scheduling = matches!(
            action,
            Action::SendLater { .. } | Action::CancelScheduled(_)
        );
        // A ban list from somebody the root does not let ban is refused,
        // with words, as a server refuses it; the list stays as it was.
        let refused = matches!(action, Action::SetBans(_))
            && !self.with_state(|state| {
                let root = state.channels.iter().find(|channel| channel.parent.is_none());
                root.is_some_and(|root| root.rights.has(crate::rights::Right::BAN))
            });
        self.with_state(|state| {
            if !refused {
                state.apply(&action);
            }
            state.actions.push(action);
        });
        if refused {
            self.tell(EngineEvent::Notice(Some(
                "Permission denied: you may not change the ban list.".into(),
            )));
        }
        if scheduling {
            self.tell(EngineEvent::ScheduleTaken);
        }
        self.tell(EngineEvent::StateChanged);
        if about_messages {
            self.tell(EngineEvent::NewMessage {
                conversation: Conversation::Channel(LOUNGE),
            });
        }
    }

    fn about(&self, subject: Subject) {
        // Those whose profiles are kept apart, and what the local user saved.
        if let Subject::User(session) = subject
            && let Some(written) = self.with_state(|state| {
                let banner = state.banners.get(&session);
                let written = state.profiles.comment_of(session, banner)?;
                if session != OWN {
                    return Some(written);
                }
                Some(state.own_profile.iter().fold(written, |written, change| {
                    let profile = crate::profile_fields::patched(&written, change);
                    crate::profile_fields::rewritten(&written, &profile)
                }))
            })
        {
            self.tell(EngineEvent::About {
                subject,
                html: Some(written.into()),
            });
            return;
        }
        let html = match subject {
            Subject::User(3) => Some(concat!(
                r##"<!--FANCY:{"v":1,"status":"Sketching","pronouns":"she/her","##,
                r##""banner":{"color":"#7a4e9a"},"nameStyle":{"color":"#e09a4b","bold":true}}-->"##,
                "\nDraws <i>characters</i>."
            )),
            // Torque: a banner in two colours, a name in a face and a colour
            // of its own, a status that carries markup, and a row switched off.
            Subject::User(5) => Some(concat!(
                r##"<!--FANCY:{"v":1,"status":"On the <b>coast road</b>","contact":"torque@example.org","##,
                r##""banner":{"color":"linear-gradient(135deg, #0f4c5c, #e36414)"},"##,
                r##""nameStyle":{"color":"#101828","font":"serif","bold":false},"##,
                r##""sections":{"stats":false}}-->"##,
                "
Drives, mostly."
            )),
            Subject::Channel(LOUNGE) => Some("Where everybody starts."),
            Subject::Server => Some(welcome_html()),
            _ => None,
        };
        // Whoever was given a banner has it in the profile they carry.
        let pictured = match subject {
            Subject::User(session) => self.with_state(|state| {
                let banner = state.banners.get(&session)?;
                let held = html.unwrap_or_default();
                let profile = crate::profile::with_banner(held, banner);
                let words = held.split_once("-->").map_or(held, |(_, words)| words);
                Some(format!("<!--FANCY:{profile}-->{words}"))
            }),
            _ => None,
        };
        let html: Option<gpui::SharedString> = pictured.map(Into::into).or(html.map(Into::into));
        if subject == Subject::Server {
            self.tell(EngineEvent::Facts {
                subject,
                facts: vec![("Address".into(), "magical.rocks:64738".into())],
                devices: Vec::new(),
            });
        }
        self.tell(EngineEvent::About { subject, html });
    }

    fn voice_settings(&self) -> VoiceSettings {
        self.with_state(|state| state.voice_settings)
    }

    fn tune_denoiser(&self, knobs: std::collections::BTreeMap<String, f32>) {
        self.with_state(|state| state.tuning = knobs);
    }

    fn sound_check(&self) -> Box<dyn crate::sound_check::SoundCheck> {
        Box::new(crate::sound_check::made_up::MadeUpCheck::new(
            self.voice.clone(),
        ))
    }

    fn voice_stats(&self) -> Option<crate::sound_check::Stats> {
        self.with_state(|state| state.stats)
    }

    fn set_voice_settings(&self, settings: VoiceSettings) {
        self.with_state(|state| state.voice_settings = settings);
    }

    fn set_whisper_target(&self, target: Option<WhisperTarget>) {
        self.with_state(|state| state.whisper.0 = target);
    }

    fn whisper(&self, held: bool) {
        let whispering = self.with_state(|state| {
            state.whisper.1 = held && state.whisper.0.is_some();
            state.whisper.2 += u32::from(state.whisper.1);
            state.whisper.1
        });
        self.tell(EngineEvent::Whispering(whispering));
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

/// The name the demo's server is shown by: `magical.rocks`, or what
/// `FANCY_GPUI_DEMO_NAME` says, for pictures nobody can take for a real
/// server's.
fn session_name() -> &'static str {
    static NAME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    NAME.get_or_init(|| {
        std::env::var("FANCY_GPUI_DEMO_NAME").unwrap_or_else(|_| "magical.rocks".to_owned())
    })
}

/// The demo server's welcome: a designed page like the ones the web
/// client's welcome designer makes, or the file `FANCY_GPUI_DEMO_WELCOME`
/// names, to look at another.
fn welcome_html() -> &'static str {
    static WELCOME: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    WELCOME.get_or_init(|| {
        std::env::var_os("FANCY_GPUI_DEMO_WELCOME")
            .and_then(|path| std::fs::read_to_string(path).ok())
            .unwrap_or_else(|| include_str!("page/samples/banner.html").to_owned())
    })
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
