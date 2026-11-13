//! The shell: one window laid out as the web UI's default design lays it
//! out - a band across the top, the server rail, the channel column and the
//! conversation.

mod admin;
mod band;
mod certificates;
mod connect;
mod conversation;
mod devices;
mod frame;
mod menu;
mod picker;
mod rail;
mod server_editor;
mod sidebar;
#[cfg(test)]
mod tests;
pub(crate) mod text_input;
mod widgets;

use std::collections::HashSet;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ListAlignment, ListOffset, ListState, ParentElement, Render,
    Styled, Subscription, Task, Window, div, prelude::*, px, relative,
};

use crate::engine::{
    Action, AudioDevices, ChannelId, ChosenDevices, Connection, Conversation, Engine, EngineEvent,
    Message, Preview, SavedServer, Session, Snapshot, Subject, User, VoiceSettings,
};
use crate::store::{Settings, Store};
use crate::theme::{ActiveTheme, Catalog, Mode};
use text_input::{InputEvent, TextInput};

/// How far past the visible rows the conversation lays messages out, so a
/// short scroll does not wait on layout.
const OVERDRAW: f32 = 400.0;

/// How many messages a conversation opens with, and how many more each
/// step back through its history adds.
const PAGE: usize = 100;

/// How long somebody is shown as writing after they last said so. A
/// client says so every few seconds while it goes on.
const TYPING_LASTS: std::time::Duration = std::time::Duration::from_secs(6);

/// The window's title: the application's name, led by how many messages
/// wait unread when any do.
pub(super) fn window_title(unread: u32) -> String {
    match unread {
        0 => "Fancy Mumble".to_owned(),
        count => format!("({count}) Fancy Mumble"),
    }
}

/// What there is to read about a user or a channel, on a card.
pub(super) struct Info {
    subject: Subject,
    title: gpui::SharedString,
    /// The text, once it has arrived; `None` while it is being fetched.
    body: Option<Arc<conversation::DrawnBody>>,
    /// What else is known, as names and values.
    facts: Vec<(gpui::SharedString, gpui::SharedString)>,
}

/// The application's one window.
pub(crate) struct Shell {
    engine: Arc<dyn Engine>,
    /// The server as last read from the engine.
    snapshot: Snapshot,
    /// What is in the channel column's search field, trimmed and in lower
    /// case.
    wanted: String,
    /// What the channel column is drawn from, worked out when the snapshot
    /// is taken rather than on every frame: the channels in tree order,
    /// each as its place in the snapshot and how deep it sits, and who is
    /// in each channel, by name, as places among the snapshot's users.
    tree: Vec<(usize, usize)>,
    people: std::collections::HashMap<ChannelId, Vec<usize>>,
    /// The channel column's rows, and the list that lays out only those
    /// in view: a server with thousands of channels costs what is on
    /// screen.
    column: Vec<sidebar::Row>,
    column_list: ListState,
    /// The conversation on screen: a channel, or one other user.
    open: Option<Conversation>,
    /// The channel the local user was in when the conversation last
    /// followed them. Kept apart from the snapshot, which may already show
    /// the new channel by the time the move itself is announced.
    was_in: Option<ChannelId>,
    /// The open conversation's messages, oldest first.
    messages: Vec<Message>,
    /// The conversation `messages` was read from, how many of its newest
    /// messages are asked for, and whether it has older ones.
    shown: Option<Conversation>,
    window: usize,
    earlier: bool,
    /// How many messages the open conversation holds, shown or not, and
    /// how many of them are pinned.
    held: usize,
    pins: usize,
    /// Whether the reader is at the newest message: set by their own
    /// scrolling, and what decides whether an arrival moves them.
    at_tail: std::rc::Rc<std::cell::Cell<bool>>,
    /// The conversation's rows: only the visible ones are laid out.
    rows: ListState,
    /// The bodies of the messages drawn so far, by message index.
    bodies: std::collections::HashMap<usize, Arc<conversation::DrawnBody>>,
    /// What lies behind the links of the messages drawn: `None` while the
    /// server is being asked, or when it found nothing.
    previews: std::collections::HashMap<gpui::SharedString, Option<Arc<Preview>>>,
    /// What each row is: a message, or the rule that starts a day.
    row_model: Vec<conversation::Row>,
    /// How far east of UTC the local clock is, as of the last reload.
    utc_offset: i64,
    /// Who is talking right now.
    talking: HashSet<Session>,
    composer: Entity<TextInput>,
    /// Whether the conversation shows only its pinned messages.
    only_pinned: bool,
    /// The message being changed, while the composer holds its text.
    editing: Option<gpui::SharedString>,
    /// Who was last seen writing in the open channel, and when.
    typing: std::collections::HashMap<Session, std::time::Instant>,
    search: Entity<TextInput>,
    /// The saved identities, as last read from the engine.
    servers: Vec<SavedServer>,
    /// The `host:port` whose landing page is showing, once one was picked.
    selected_server: Option<String>,
    /// The identity picked to connect as, once one was.
    selected_identity: Option<gpui::SharedString>,
    server_search: Entity<TextInput>,
    /// The server's password, for the connect about to be made.
    password: Entity<TextInput>,
    /// The add/edit dialog, while it is open.
    editor: Option<server_editor::ServerEditor>,
    /// What the engine last had to tell the user.
    notice: Option<gpui::SharedString>,
    /// Where the chosen theme is remembered; `None` remembers nothing.
    store: Option<Store>,
    /// Whether the theme picker is showing.
    picker_open: bool,
    /// Whether the audio device panel is showing.
    devices_open: bool,
    /// The administrator's panel, while it is open.
    admin: Option<admin::Admin>,
    /// Whether the certificates panel is showing, what it lists, and the
    /// certificate a first click on delete has armed.
    certificates_open: bool,
    certificates: Vec<gpui::SharedString>,
    doomed_certificate: Option<gpui::SharedString>,
    /// The devices the system offers, once they have been asked for.
    devices: Option<AudioDevices>,
    /// The devices in use.
    chosen_devices: ChosenDevices,
    /// The card showing a user's comment or a channel's description.
    info: Option<Info>,
    /// The server's welcome message as drawn, and the HTML it was read
    /// from, so it is read once per message rather than once per frame.
    welcome: Option<(gpui::SharedString, Arc<conversation::DrawnBody>)>,
    /// Whether the welcome message was dismissed on this connection.
    welcome_dismissed: bool,
    /// The session the conversation on screen belongs to.
    active_session: Option<gpui::SharedString>,
    /// Whether the connect screen is showing over a connection, to add
    /// another server.
    adding_server: bool,
    /// The unread count the window's title was last set for.
    titled_unread: u32,
    /// The menu a right click opened, while it is open.
    menu: Option<menu::Menu>,
    /// The dialog a menu entry asked a question in, while it is open.
    prompt: Option<menu::Prompt>,
    /// How loud each user is played here, where that is not as sent.
    volumes: std::collections::HashMap<Session, f32>,
    /// How the microphone is used.
    voice_settings: VoiceSettings,
    /// The push-to-talk key, as GPUI names it.
    ptt_key: Option<gpui::SharedString>,
    /// Whether the next key pressed becomes the push-to-talk key.
    choosing_ptt_key: bool,
    /// Whether the push-to-talk key is down.
    ptt_held: bool,
    /// The window's own focus: where keys go when no field has them, so
    /// push to talk works without clicking into anything.
    focus: gpui::FocusHandle,
    _events: Task<()>,
    _subscriptions: Vec<Subscription>,
}

impl Shell {
    /// A shell showing whatever `engine` is connected to, remembering the
    /// chosen theme in `store`.
    pub(crate) fn new(
        engine: Arc<dyn Engine>,
        store: Option<Store>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let at_tail = std::rc::Rc::new(std::cell::Cell::new(true));
        let rows = ListState::new(0, ListAlignment::Top, px(OVERDRAW));
        rows.set_scroll_handler({
            let at_tail = std::rc::Rc::clone(&at_tail);
            move |scrolled, _, _| at_tail.set(scrolled.visible_range.end >= scrolled.count)
        });
        let composer = cx.new(|cx| TextInput::new("", cx).multiline().taking_pictures());
        let search = cx.new(|cx| TextInput::new("Search channels", cx));
        let server_search = cx.new(|cx| TextInput::new("Search servers", cx));
        let password = cx.new(|cx| TextInput::new("Server password, if it has one", cx).obscured());
        let subscriptions = vec![
            // The engine counts messages unread, and notifies, by whether
            // the user is looking.
            cx.observe_window_activation(window, |shell, window, cx| {
                shell.engine.set_focused(window.is_window_active());
                shell.retitle(window);
                cx.notify();
            }),
            cx.subscribe(&composer, Self::on_composer),
            // A search narrows its list as it is typed.
            cx.subscribe(&search, |shell, _, _, cx| shell.narrow_column(cx)),
            cx.subscribe(&server_search, |_, _, _, cx| cx.notify()),
            // Enter in the password field connects.
            cx.subscribe(&password, |shell, _, event, cx| {
                if matches!(event, InputEvent::Submitted(_)) {
                    shell.connect_selected(cx);
                }
            }),
        ];
        // Whether the saved servers are up is asked once, here, and again
        // whenever the list changes or the view returns to it.
        engine.refresh_pings();
        let events = Self::listen(engine.events(), cx);
        let ptt_key = store
            .as_ref()
            .and_then(|store| store.settings().push_to_talk_key)
            .map(Into::into);
        let mut shell = Self {
            snapshot: Snapshot::disconnected(),
            wanted: String::new(),
            tree: Vec::new(),
            column: Vec::new(),
            column_list: ListState::new(0, ListAlignment::Top, px(OVERDRAW)),
            people: std::collections::HashMap::new(),
            servers: engine.saved_servers(),
            open: None,
            was_in: None,
            messages: Vec::new(),
            shown: None,
            window: PAGE,
            earlier: false,
            held: 0,
            pins: 0,
            rows,
            at_tail,
            bodies: std::collections::HashMap::new(),
            previews: std::collections::HashMap::new(),
            row_model: Vec::new(),
            utc_offset: 0,
            talking: HashSet::new(),
            composer,
            only_pinned: false,
            editing: None,
            typing: std::collections::HashMap::new(),
            search,
            selected_server: None,
            selected_identity: None,
            server_search,
            password,
            editor: None,
            notice: None,
            store,
            picker_open: false,
            devices_open: false,
            admin: None,
            certificates_open: false,
            certificates: Vec::new(),
            doomed_certificate: None,
            devices: None,
            chosen_devices: engine.chosen_devices(),
            info: None,
            welcome: None,
            welcome_dismissed: false,
            active_session: None,
            adding_server: false,
            titled_unread: 0,
            menu: None,
            prompt: None,
            volumes: std::collections::HashMap::new(),
            voice_settings: engine.voice_settings(),
            ptt_key,
            choosing_ptt_key: false,
            ptt_held: false,
            focus: cx.focus_handle(),
            engine,
            _events: events,
            _subscriptions: subscriptions,
        };
        shell.take_snapshot();
        shell.follow_current_channel(None);
        shell.read_welcome();
        shell.reload_messages(cx);
        shell
    }

    /// Apply the engine's events as they arrive.
    ///
    /// Everything already waiting is applied before the one repaint: a server
    /// that sends a burst of state changes costs one frame, not one each.
    fn listen(inbox: async_channel::Receiver<EngineEvent>, cx: &mut Context<Self>) -> Task<()> {
        cx.spawn(async move |shell, cx| {
            while let Ok(first) = inbox.recv().await {
                let applied = shell.update(cx, |shell, cx| shell.apply_waiting(first, &inbox, cx));
                if applied.is_err() {
                    break;
                }
            }
        })
    }

    /// Apply `first` and everything queued behind it, then repaint once.
    fn apply_waiting(
        &mut self,
        first: EngineEvent,
        inbox: &async_channel::Receiver<EngineEvent>,
        cx: &mut Context<Self>,
    ) {
        // "Read the server again" said ten times over is read once: a
        // server sending a user's every change, or its whole tree at a
        // connect, would otherwise cost a full copy of it each time. So is
        // the same conversation's "read the messages again".
        let mut stale = false;
        let mut reread: Option<Conversation> = None;
        let mut waiting =
            std::iter::once(first).chain(std::iter::from_fn(|| inbox.try_recv().ok()));
        for event in &mut waiting {
            match event {
                EngineEvent::StateChanged => stale = true,
                EngineEvent::NewMessage { conversation } if reread == Some(conversation) => {}
                other => {
                    if std::mem::take(&mut stale) {
                        self.apply(EngineEvent::StateChanged, cx);
                    }
                    reread = match other {
                        EngineEvent::NewMessage { conversation } => Some(conversation),
                        _ => None,
                    };
                    self.apply(other, cx);
                }
            }
        }
        if stale {
            self.apply(EngineEvent::StateChanged, cx);
        }
        cx.notify();
    }

    fn apply(&mut self, event: EngineEvent, cx: &mut Context<Self>) {
        match event {
            EngineEvent::StateChanged => {
                let was = self.snapshot.connection;
                self.take_snapshot();
                // A new connection has a welcome of its own to show.
                if was != Connection::Connected && self.snapshot.connection == Connection::Connected
                {
                    self.welcome_dismissed = false;
                }
                self.read_welcome();
                self.follow_active_session(cx);
                self.drop_closed_conversation(cx);
                // A message deleted by somebody else is announced only as
                // a change of state.
                if let Some(open) = self.open
                    && self.engine.message_count(open) != self.held
                {
                    self.reload_messages(cx);
                }
                // Back on the server list: what it says about each server is
                // as old as the visit just ended.
                if was == Connection::Connected
                    && self.snapshot.connection == Connection::Disconnected
                {
                    self.engine.refresh_pings();
                }
            }
            EngineEvent::About { subject, html } => {
                if let Some(info) = self.info.as_mut().filter(|info| info.subject == subject) {
                    let html = html.unwrap_or_default();
                    info.body = Some(Arc::new(conversation::DrawnBody::read(&html)));
                }
            }
            EngineEvent::Facts { subject, facts } => {
                if let Some(info) = self.info.as_mut().filter(|info| info.subject == subject) {
                    info.facts = facts;
                }
            }
            EngineEvent::ServersChanged => self.servers = self.engine.saved_servers(),
            EngineEvent::Previews(previews) => {
                for preview in previews {
                    let _ = self
                        .previews
                        .insert(preview.url.clone(), Some(Arc::new(preview)));
                }
                self.stick_to_tail();
            }
            EngineEvent::Bans(bans) => {
                if let Some(admin) = self.admin.as_mut() {
                    admin.bans = Some(bans);
                    self.refilter_admin(cx);
                }
            }
            EngineEvent::Registered(users) => {
                if let Some(admin) = self.admin.as_mut() {
                    admin.registered = Some(users);
                    self.refilter_admin(cx);
                }
            }
            EngineEvent::CertificatesChanged => {
                self.certificates = self.engine.certificates();
                self.doomed_certificate = None;
            }
            EngineEvent::Notice(notice) => self.notice = notice,
            EngineEvent::Typing { channel, session } => self.saw_typing(channel, session, cx),
            EngineEvent::CurrentChannelChanged => {
                self.take_snapshot();
                self.follow_current_channel(self.was_in);
                self.reload_messages(cx);
            }
            EngineEvent::UserTalking { session, talking } => {
                let _ = if talking {
                    self.talking.insert(session)
                } else {
                    self.talking.remove(&session)
                };
            }
            EngineEvent::NewMessage { conversation } => {
                if self.open == Some(conversation) {
                    // On screen, so read: it must not also count as unread.
                    self.engine.open(conversation);
                    self.reload_messages(cx);
                } else {
                    self.take_snapshot();
                }
            }
        }
    }

    /// The active server changed: what was on screen belonged to the other
    /// one. Start again from the channel the user is in here.
    fn follow_active_session(&mut self, cx: &mut Context<Self>) {
        let active = self
            .snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.id.clone());
        if active == self.active_session {
            return;
        }
        self.active_session = active;
        self.previews.clear();
        // Arrived somewhere: the connect screen has done what it was for.
        self.adding_server = false;
        self.open = None;
        self.talking.clear();
        self.welcome_dismissed = false;
        self.follow_current_channel(None);
        self.reload_messages(cx);
    }

    /// Whether the connect screen is what the window shows: not on a
    /// server, or adding another.
    fn shows_connect_screen(&self) -> bool {
        self.adding_server || self.snapshot.connection != Connection::Connected
    }

    /// How many messages wait unread, across channels and people.
    fn unread_total(&self) -> u32 {
        let channels: u32 = self
            .snapshot
            .channels
            .iter()
            .map(|channel| channel.unread)
            .sum();
        let directs: u32 = self.snapshot.users.iter().map(|user| user.unread).sum();
        channels + directs
    }

    /// Put the unread count in the window's title, where a task bar shows it.
    fn retitle(&self, window: &mut Window) {
        window.set_window_title(&window_title(self.unread_total()));
    }

    /// Read the server's welcome message, if it is not the one already read.
    fn read_welcome(&mut self) {
        let Some(html) = self.snapshot.welcome.clone() else {
            self.welcome = None;
            return;
        };
        if self.welcome.as_ref().is_none_or(|(read, _)| *read != html) {
            let drawn = Arc::new(conversation::DrawnBody::read(&html));
            self.welcome = Some((html, drawn));
        }
    }

    /// The welcome message, while it is to be shown: not dismissed, with
    /// something in it, and over the channel the user is in.
    fn welcome_to_show(&self) -> Option<Arc<conversation::DrawnBody>> {
        let in_own_channel = self.open.is_some()
            && self.open == self.snapshot.current_channel.map(Conversation::Channel);
        self.welcome
            .as_ref()
            .filter(|(_, drawn)| !self.welcome_dismissed && in_own_channel && !drawn.is_empty())
            .map(|(_, drawn)| Arc::clone(drawn))
    }

    /// Show what there is to read about `subject`, fetching it.
    pub(super) fn show_about(&mut self, subject: Subject, cx: &mut Context<Self>) {
        let title = match subject {
            Subject::User(session) => self
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map(|user| user.name.clone()),
            Subject::Channel(id) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map(|channel| channel.name.clone()),
            Subject::Server => self
                .snapshot
                .sessions
                .iter()
                .find(|session| session.active)
                .map(|session| session.name.clone()),
        };
        self.info = Some(Info {
            subject,
            title: title.unwrap_or_default(),
            body: None,
            facts: Vec::new(),
        });
        self.engine.about(subject);
        cx.notify();
    }

    /// After the local user moved: the channel conversation follows them,
    /// unless they had opened something else to read.
    fn follow_current_channel(&mut self, before: Option<ChannelId>) {
        let followed = match self.open {
            None => true,
            Some(Conversation::Channel(open)) => Some(open) == before,
            Some(Conversation::Direct(_)) => false,
        };
        if followed || self.snapshot.connection != Connection::Connected {
            self.open = self.snapshot.current_channel.map(Conversation::Channel);
        }
        self.was_in = self.snapshot.current_channel;
    }

    /// The open conversation is with a channel or a user that is gone: fall
    /// back to the channel the local user is in.
    fn drop_closed_conversation(&mut self, cx: &mut Context<Self>) {
        let there = match self.open {
            Some(Conversation::Channel(id)) => self.snapshot.channels.iter().any(|c| c.id == id),
            Some(Conversation::Direct(session)) => self
                .snapshot
                .users
                .iter()
                .any(|user| user.session == session),
            None => self.snapshot.current_channel.is_none(),
        };
        if !there {
            self.open = self.snapshot.current_channel.map(Conversation::Channel);
            self.reload_messages(cx);
        }
    }

    /// Keep the newest message in view if that is where the reader was:
    /// what is under it may have grown, by a reaction or a link's card.
    fn stick_to_tail(&self) {
        if self.at_tail.get() {
            self.rows.scroll_to(ListOffset {
                item_ix: self.row_model.len(),
                offset_in_item: px(0.0),
            });
        }
    }

    /// Show a page more of the open conversation's history, asking the
    /// server for it where the engine does not hold it.
    pub(super) fn show_earlier(&mut self, cx: &mut Context<Self>) {
        let Some(conversation) = self.open else {
            return;
        };
        self.window += PAGE;
        // Going back through the history is leaving the newest message.
        self.at_tail.set(false);
        if self.window > self.held {
            let oldest = self.messages.first().and_then(|message| message.id.clone());
            self.engine.load_earlier(conversation, oldest);
        }
        self.reload_messages(cx);
        cx.notify();
    }

    /// Put `conversation` on screen.
    pub(super) fn open_conversation(&mut self, conversation: Conversation, cx: &mut Context<Self>) {
        if self.open != Some(conversation) {
            // What was being written and corrected belonged to the other.
            self.stop_editing(cx);
            self.only_pinned = false;
            self.typing.clear();
            self.open = Some(conversation);
            self.engine.open(conversation);
            self.reload_messages(cx);
        }
        cx.notify();
    }

    /// Read the open conversation's messages again and lay the rows out
    /// afresh.
    fn reload_messages(&mut self, cx: &mut Context<Self>) {
        // Another conversation starts from its newest page again.
        let same_conversation = self.shown == self.open;
        if !same_conversation {
            self.shown = self.open;
            self.window = PAGE;
        }
        let window = self
            .open
            .map(|conversation| self.engine.window(conversation, self.window))
            .unwrap_or_default();
        let mut messages = window.messages;
        self.earlier = window.earlier;
        self.held = self
            .open
            .map_or(0, |conversation| self.engine.message_count(conversation));
        self.pins = messages.iter().filter(|message| message.pinned).count();
        // The last pin taken off ends the view that showed only pins.
        self.only_pinned &= self.pins > 0;
        if self.only_pinned {
            messages.retain(|message| message.pinned);
        }
        // A message drawn before is kept as drawn while it is still the same
        // message; an edit, a deletion or another channel starts over.
        let kept = same_conversation
            && self
                .messages
                .iter()
                .zip(&messages)
                .all(|(before, now)| before.html == now.html);
        if !kept || messages.len() < self.messages.len() {
            self.bodies.clear();
        }
        // Whether the newest message is the one that was the newest: if
        // not, something arrived, and the reader is taken to it.
        let newest = |messages: &[Message]| {
            messages
                .last()
                .map(|message| (message.id.clone(), message.sent_at_ms, message.html.len()))
        };
        let same_newest = same_conversation && newest(&self.messages) == newest(&messages);
        self.messages = messages;
        // A short conversation starts under the header, as the web UI draws
        // it; a long one opens on its newest message.
        self.utc_offset = widgets::local_utc_offset();
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
            });
        let rows_before = self.row_model.len();
        self.row_model = conversation::rows(&self.messages, now_ms, self.utc_offset);
        if self.earlier && !self.only_pinned {
            self.row_model.insert(0, conversation::Row::Earlier);
        }
        let rows = self.row_model.len();
        // The reader is taken to the newest message when they were on it
        // already, when the conversation is another one, and when what
        // arrived is their own.
        let follows = !same_conversation
            || self.at_tail.get()
            || (!same_newest && self.messages.last().is_some_and(|message| message.own));
        if rows == rows_before && kept {
            // The same rows with something on them changed, a reaction
            // say: they stay where the reader has them.
        } else if same_newest || !follows {
            // Rows came or went above (earlier messages were loaded, one
            // was deleted), or arrived below while the reader was further
            // up: they stay on what they were reading.
            let top = self.rows.logical_scroll_top();
            let above = if same_newest {
                rows.saturating_sub(rows_before)
            } else {
                0
            };
            self.rows.reset(rows);
            self.rows.scroll_to(ListOffset {
                item_ix: top.item_ix + above,
                offset_in_item: top.offset_in_item,
            });
        } else {
            self.rows.reset(rows);
            self.at_tail.set(true);
            self.stick_to_tail();
        }
        let placeholder = self
            .open_title()
            .map(|title| format!("Message {title}"))
            .unwrap_or_default();
        self.composer
            .update(cx, |composer, _| composer.set_placeholder(placeholder));
    }

    fn on_composer(&mut self, _: Entity<TextInput>, event: &InputEvent, cx: &mut Context<Self>) {
        match event {
            InputEvent::Submitted(_) => self.send_composed(cx),
            InputEvent::Changed => {
                // Writing something new, not correcting something sent.
                if let Some(conversation) = self.open.filter(|_| self.editing.is_none())
                    && !self.composer.read(cx).text().is_empty()
                {
                    self.engine.typing(conversation);
                }
            }
            InputEvent::Cancelled => self.stop_editing(cx),
            InputEvent::PastedPicture(picture) => {
                if let Some(conversation) = self.open {
                    self.engine.send_picture(conversation, picture.clone());
                }
            }
            InputEvent::Tabbed { .. } => {}
        }
    }

    /// Put the message `id` in the composer, to be changed and sent again.
    pub(super) fn start_editing(
        &mut self,
        id: gpui::SharedString,
        text: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.editing = Some(id);
        self.composer.update(cx, |composer, cx| {
            composer.set_text(text);
            composer.focus(window);
            cx.notify();
        });
    }

    /// Leave the message being changed as it was.
    pub(super) fn stop_editing(&mut self, cx: &mut Context<Self>) {
        if self.editing.take().is_some() {
            self.composer.update(cx, |composer, cx| {
                composer.clear();
                cx.notify();
            });
            cx.notify();
        }
    }

    /// The names of those writing in the open channel right now, the local
    /// user aside.
    pub(super) fn writers(&self) -> Vec<gpui::SharedString> {
        let mut names: Vec<_> = self
            .snapshot
            .users
            .iter()
            .filter(|user| {
                Some(user.session) != self.snapshot.own_session
                    && self
                        .typing
                        .get(&user.session)
                        .is_some_and(|seen| seen.elapsed() < TYPING_LASTS)
            })
            .map(|user| user.name.clone())
            .collect();
        names.sort();
        names
    }

    /// `session` is writing in `channel`: say so while it lasts.
    fn saw_typing(&mut self, channel: ChannelId, session: Session, cx: &mut Context<Self>) {
        if self.open != Some(Conversation::Channel(channel)) {
            return;
        }
        let _ = self.typing.insert(session, std::time::Instant::now());
        // Nothing says they stopped: look again once it would have lapsed.
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(TYPING_LASTS).await;
            let _ = shell.update(cx, |shell, cx| {
                shell.typing.retain(|_, seen| seen.elapsed() < TYPING_LASTS);
                cx.notify();
            });
        })
        .detach();
    }

    /// Send what is in the composer to the open conversation, and empty it.
    pub(super) fn send_composed(&mut self, cx: &mut Context<Self>) {
        let body = self.composer.read(cx).text().to_owned();
        if body.trim().is_empty() {
            return;
        }
        match (self.editing.take(), self.open) {
            (Some(id), Some(Conversation::Channel(channel))) => {
                self.engine.act(Action::EditMessage {
                    channel,
                    id: id.to_string(),
                    text: body,
                });
            }
            (_, Some(conversation)) => self.engine.send_message(conversation, body),
            (_, None) => {}
        }
        self.composer.update(cx, |composer, cx| {
            composer.clear();
            cx.notify();
        });
    }

    /// Give the keyboard to the search field of whichever list is showing.
    pub(crate) fn focus_search(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let search = if self.shows_connect_screen() {
            &self.server_search
        } else {
            &self.search
        };
        search.read(cx).focus(window);
        cx.notify();
    }

    /// Start with something open: `picker`, `devices`, `certificates` or `editor`. For
    /// looking at them where nothing can click.
    pub(crate) fn open_for_inspection(
        &mut self,
        what: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match what {
            "picker" => self.toggle_picker(cx),
            "devices" => self.toggle_devices(cx),
            "certificates" => self.toggle_certificates(cx),
            "editor" => self.open_editor(None, None, window, cx),
            _ => {}
        }
    }

    /// Escape: close whatever is open on top of the window.
    pub(crate) fn dismiss(&mut self, cx: &mut Context<Self>) {
        if self.menu.take().is_some() || self.prompt.take().is_some() || self.info.take().is_some()
        {
            cx.notify();
            return;
        }
        if self.editing.is_some() {
            self.stop_editing(cx);
            return;
        }
        if self.admin.take().is_some() {
            cx.notify();
            return;
        }
        if self.editor.take().is_none() {
            self.picker_open = false;
            self.devices_open = false;
            self.certificates_open = false;
        }
        cx.notify();
    }

    /// What the open conversation is called: `#channel` or `@user`.
    fn open_title(&self) -> Option<String> {
        match self.open? {
            Conversation::Channel(id) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map(|channel| format!("#{}", channel.name)),
            Conversation::Direct(session) => self
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map(|user| format!("@{}", user.name)),
        }
    }

    /// Read the server from the engine again, and work out what the
    /// channel column draws from it.
    fn take_snapshot(&mut self) {
        self.snapshot = self.engine.snapshot();
        self.tree = sidebar::tree_order(&self.snapshot.channels);
        self.people.clear();
        for (at, user) in self.snapshot.users.iter().enumerate() {
            self.people.entry(user.channel).or_default().push(at);
        }
        let users = &self.snapshot.users;
        for people in self.people.values_mut() {
            people.sort_by_cached_key(|at| users[*at].name.to_lowercase());
        }
        self.lay_out_column();
    }

    /// Work out the channel column's rows: each listed channel, and under
    /// it the people in it. The reader stays where they had scrolled to.
    fn lay_out_column(&mut self) {
        let column: Vec<sidebar::Row> = self
            .listed(&self.wanted)
            .into_iter()
            .flat_map(|(at, depth)| {
                // Who is where is the point of the tree: every channel
                // with people in it lists them.
                let peopled = self.occupant_count(self.snapshot.channels[at].id) > 0;
                std::iter::once(sidebar::Row::Channel { at, depth })
                    .chain(peopled.then_some(sidebar::Row::People { at, depth }))
            })
            .collect();
        if column.len() != self.column.len() {
            let top = self.column_list.logical_scroll_top();
            self.column_list.reset(column.len());
            self.column_list.scroll_to(top);
        }
        self.column = column;
    }

    /// The search field of the channel column changed.
    fn narrow_column(&mut self, cx: &mut Context<Self>) {
        self.wanted = self.search.read(cx).text().trim().to_lowercase();
        self.lay_out_column();
        cx.notify();
    }

    /// The channels the column lists, as places in the snapshot with how
    /// deep each sits: the whole tree in order, or - flat - those whose
    /// name contains `wanted`.
    fn listed(&self, wanted: &str) -> Vec<(usize, usize)> {
        if wanted.is_empty() {
            return self.tree.clone();
        }
        self.snapshot
            .channels
            .iter()
            .enumerate()
            .filter(|(_, channel)| channel.name.to_lowercase().contains(wanted))
            .map(|(at, _)| (at, 0))
            .collect()
    }

    /// The channels the column lists, each with how deep it sits.
    #[cfg(test)]
    fn listed_channels(&self, _cx: &gpui::App) -> Vec<(&crate::engine::Channel, usize)> {
        self.listed(&self.wanted)
            .into_iter()
            .map(|(at, depth)| (&self.snapshot.channels[at], depth))
            .collect()
    }

    /// The users in `channel`, by name.
    fn occupants(&self, channel: ChannelId) -> impl Iterator<Item = &User> {
        self.people
            .get(&channel)
            .into_iter()
            .flatten()
            .filter_map(|at| self.snapshot.users.get(*at))
    }

    /// How many users are in `channel`.
    fn occupant_count(&self, channel: ChannelId) -> usize {
        self.people.get(&channel).map_or(0, Vec::len)
    }

    fn own_user(&self) -> Option<&User> {
        let own = self.snapshot.own_session?;
        self.snapshot.users.iter().find(|user| user.session == own)
    }

    fn toggle_picker(&mut self, cx: &mut Context<Self>) {
        self.picker_open = !self.picker_open;
        cx.notify();
    }

    /// Move to the theme after the current one, keeping the mode.
    pub(crate) fn next_theme(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        if let Some(next) = Catalog::get().next_id(&theme.id) {
            self.set_theme(next, theme.mode, cx);
        }
    }

    /// Flip between the light and dark drawing of the current theme.
    pub(crate) fn toggle_mode(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        self.set_theme(&theme.id, theme.mode.toggled(), cx);
    }

    /// Switch to `id` in `mode`, and remember the choice.
    pub(super) fn set_theme(&mut self, id: &str, mode: Mode, cx: &mut Context<Self>) {
        ActiveTheme::set(id, mode, cx);
        self.remember_settings(cx);
    }

    /// A key went down anywhere in the window: the push-to-talk key, or the
    /// key that is to become it.
    fn on_key_down(&mut self, event: &gpui::KeyDownEvent, _: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if self.choosing_ptt_key {
            self.choosing_ptt_key = false;
            // Escape keeps the key there was.
            if key != "escape" {
                self.ptt_key = Some(key.to_owned().into());
                self.remember_settings(cx);
            }
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.is_ptt_key(key) {
            // Held keys repeat; only the first press is a press.
            if !std::mem::replace(&mut self.ptt_held, true) {
                self.engine.push_to_talk(true);
            }
            cx.stop_propagation();
        }
    }

    fn on_key_up(&mut self, event: &gpui::KeyUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.is_ptt_key(event.keystroke.key.as_str()) && std::mem::take(&mut self.ptt_held) {
            self.engine.push_to_talk(false);
            cx.stop_propagation();
        }
    }

    /// Whether `key` is the push-to-talk key and push to talk is on.
    fn is_ptt_key(&self, key: &str) -> bool {
        self.voice_settings.push_to_talk
            && self.snapshot.connection == Connection::Connected
            && self
                .ptt_key
                .as_ref()
                .is_some_and(|chosen| chosen.as_ref() == key)
    }

    /// Write the view's settings out: the theme and the audio devices.
    fn remember_settings(&mut self, cx: &mut Context<Self>) {
        let Some(store) = &self.store else { return };
        let theme = ActiveTheme::get(cx);
        let name = |device: &Option<gpui::SharedString>| device.as_ref().map(ToString::to_string);
        let settings = Settings {
            theme: Some(theme.id.to_string()),
            mode: Some(match theme.mode {
                Mode::Light => "light".to_owned(),
                Mode::Dark => "dark".to_owned(),
            }),
            input_device: name(&self.chosen_devices.input),
            output_device: name(&self.chosen_devices.output),
            voice: Some(self.voice_settings),
            push_to_talk_key: name(&self.ptt_key),
        };
        if let Err(error) = store.save_settings(&settings) {
            self.notice = Some(format!("The settings could not be remembered: {error}").into());
        }
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        // Only when it changes: setting a title is a round trip to the
        // window system.
        let unread = self.unread_total();
        if std::mem::replace(&mut self.titled_unread, unread) != unread {
            self.retitle(window);
        }
        div()
            .size_full()
            .relative()
            .track_focus(&self.focus)
            // Before any field sees the key: push to talk works while typing.
            .capture_key_down(cx.listener(Self::on_key_down))
            .capture_key_up(cx.listener(Self::on_key_up))
            .flex()
            .flex_col()
            .bg(theme.c.bg0)
            .text_color(theme.c.text)
            .font_family(theme.skin.font.clone())
            .font_weight(theme.skin.weight)
            .text_size(px(14.0))
            .line_height(relative(1.4))
            .when_some(theme.c.window_line, |shell, line| {
                shell.border_1().border_color(line)
            })
            .when(theme.skin.band, |shell| {
                shell.child(band::render(&theme, window, cx))
            })
            .child(div().flex_1().min_h_0().flex().map(|body| {
                if self.shows_connect_screen() {
                    // Not on a server, or adding one: the saved ones, and
                    // the way onto one. The rail stays while there are
                    // servers to go back to.
                    body.when(!self.snapshot.sessions.is_empty(), |body| {
                        body.child(rail::render(self, &theme, cx))
                    })
                    .child(connect::server_column(self, &theme, cx))
                    .child(connect::landing(self, &theme, cx))
                } else {
                    body.child(rail::render(self, &theme, cx))
                        .child(sidebar::render(self, &theme, cx))
                        .child(conversation::render(self, &theme, cx))
                }
            }))
            .when(!theme.skin.band, |shell| {
                shell.child(band::corner_controls(&theme, window, cx))
            })
            .when(self.picker_open, |shell| {
                shell.child(picker::render(&theme, cx))
            })
            .when(self.devices_open, |shell| {
                shell.child(devices::render(self, &theme, cx))
            })
            .when_some(self.admin.as_ref(), |shell, admin| {
                shell.child(admin::render(admin, &theme, cx))
            })
            .when(self.certificates_open, |shell| {
                shell.child(certificates::render(self, &theme, cx))
            })
            .when_some(self.editor.as_ref(), |shell, editor| {
                shell.child(server_editor::render(editor, &theme, cx))
            })
            .when_some(self.menu.as_ref(), |shell, menu| {
                shell.child(menu::render_menu(menu, &theme, window, cx))
            })
            .when_some(self.prompt.as_ref(), |shell, prompt| {
                shell.child(menu::render_prompt(prompt, &theme, cx))
            })
            .when_some(self.info.as_ref(), |shell, info| {
                shell.child(menu::render_info(info, &theme, cx))
            })
            .children(frame::resize_grips(window))
    }
}
