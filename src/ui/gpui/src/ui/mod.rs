//! The shell: one window laid out as the web UI's default design lays it
//! out - a band across the top, the server rail, the channel column and the
//! conversation.

mod about;
mod about_editor;
mod about_view;
pub(crate) mod accounts;
mod acl;
mod acl_people;
mod actions;
mod admin;
pub(crate) mod aside;
mod ban_editor;
mod band;
mod band_tabs;
mod card;
mod certificates;
mod channel_form;
mod connect;
mod conversation;
mod devices;
mod embeds;
mod emoji;
mod facts;
mod format_bar;
mod frame;
mod friends;
mod gifs;
mod global_keys;
mod hover_card;
pub(crate) mod keys;
mod kit;
mod later;
mod lightbox;
mod links;
mod livery;
mod loudness;
mod marking;
mod members;
mod mention;
mod menu;
mod mover;
mod picker;
mod pins;
mod playing;
pub(crate) mod placed;
mod pages;
mod prose;
mod rail;
mod video_card;
mod reconnect;
mod server_editor;
mod settings;
mod sidebar;
mod sounds;
mod speaker;
mod stage;
mod staged;
#[cfg(test)]
mod tests_share;
#[cfg(test)]
mod tests_share_windows;
#[cfg(test)]
mod tests_share_feeds;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_connect;
#[cfg(test)]
mod tests_embeds;
#[cfg(test)]
mod tests_player;
#[cfg(test)]
mod tests_format_bar;
#[cfg(test)]
mod tests_keyboard;
#[cfg(test)]
mod tests_livery;
#[cfg(test)]
mod tests_tray;
#[cfg(test)]
mod tests_dock;
#[cfg(test)]
mod tests_settings;
#[cfg(test)]
mod tests_themes;
#[cfg(test)]
mod tests_settings_profile;
#[cfg(test)]
mod tests_words;
#[cfg(test)]
mod tests_profile;
mod profile_page;
#[cfg(test)]
mod tests_page;
#[cfg(test)]
mod tests_members;
#[cfg(test)]
mod tests_user_devices;
#[cfg(test)]
mod tests_voice_message;
#[cfg(test)]
mod tests_voice_settings;
#[cfg(test)]
mod tests_gif;
#[cfg(test)]
mod tests_settings_real;
pub(crate) mod text_input;
mod toasts;
mod tray;
mod voice_messages;
mod welcome;
mod widgets;
mod zoom;

use std::collections::HashSet;
use std::sync::Arc;

use gpui::{
    Context, Entity, IntoElement, ListAlignment, ListOffset, ListState, ParentElement, Render,
    Styled, Subscription, Task, Window, div, prelude::*, px, relative,
};

use crate::engine::WhisperTarget;
use crate::engine::{
    Action, AudioDevices, ChannelId, ChosenDevices, Connection, Conversation, Engine, EngineEvent,
    Found, KeyRequest, Message, Poll, Preview, Reader, SavedServer, Session, Snapshot, Subject,
    User, Voice, VoiceSettings,
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
    /// A channel's description or the server's welcome, read as a page;
    /// `None` for a user, and while it is being read.
    page: Option<Arc<crate::page::Page>>,
    /// What else is known, as names and values.
    facts: Vec<(gpui::SharedString, gpui::SharedString)>,
    /// For a user on several devices, told to an administrator: what is
    /// known of each. Empty for anybody else.
    devices: Vec<crate::engine::DeviceFacts>,
    /// For a user: the profile their comment carries, if it carries one,
    /// and its banner's picture. Held while the card is open and no longer.
    profile: Option<crate::profile::Profile>,
    /// The family their name is set in, where their profile names a face.
    name_family: Option<gpui::SharedString>,
    banner: Option<Arc<gpui::Image>>,
    /// For a user: what they wrote about themselves, as their card shows it.
    written: card::Written,
    /// Where the pointer rested to ask for it, for a card that floats
    /// beside the pointer while it stays; `None` for one that is kept.
    hover: Option<gpui::Point<gpui::Pixels>>,
    /// Where a card that is kept was asked for, to stand beside; `None`
    /// rests it at the window's top right.
    anchor: Option<gpui::Point<gpui::Pixels>>,
    /// For a user: the sheet of what the server knows of them, asked for
    /// from their menu, and not their card.
    sheet: bool,
}

/// A size in bytes as a person says it: `812 B`, `1.5 KB`, `3.2 MB`.
pub(crate) fn size_in_words(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["KB", "MB", "GB", "TB"];
    if bytes < 1024 {
        return format!("{bytes} B");
    }
    #[allow(
        clippy::cast_precision_loss,
        reason = "said to one decimal; nobody shares a file of 2^53 bytes"
    )]
    let mut size = bytes as f64 / 1024.0;
    let mut unit = 0;
    while size >= 1024.0 && unit + 1 < UNITS.len() {
        size /= 1024.0;
        unit += 1;
    }
    // The decimal mark as the reader chose to have numbers written.
    let size = crate::formats::current()
        .number
        .write(size, 1, crate::words::spoken());
    format!("{size} {}", UNITS[unit])
}

/// A key that does something for as long as it is held.
#[derive(Default)]
struct HeldKey {
    /// The key, as GPUI names it.
    key: Option<gpui::SharedString>,
    /// Whether the next key pressed becomes the key.
    choosing: bool,
    /// Whether the key is down.
    held: bool,
}

/// Whispering: speaking to one user or one channel while a key is held.
#[derive(Default)]
struct Whisper {
    /// Who the key speaks to, and what they are called.
    target: Option<(WhisperTarget, gpui::SharedString)>,
    /// The key, as GPUI names it.
    key: Option<gpui::SharedString>,
    /// Whether the next key pressed becomes the key.
    choosing_key: bool,
    /// Whether the key is down.
    held: bool,
    /// Whether the engine says a whisper is going out.
    active: bool,
}

/// The panels that open over the window, each with what it holds while
/// it is open.
#[derive(Default)]
struct Panels {
    /// The files waiting to go out with the next message.
    staged: Option<staged::Staged>,
    /// The shared pictures fetched to be shown, by what the server keeps
    /// them under; `None` while one is on its way, or is no picture.
    shared: std::collections::HashMap<gpui::SharedString, Option<Arc<gpui::Image>>>,
    /// A channel's permissions.
    acl: Option<acl::Panel>,
    /// The administrator's lists.
    admin: Option<admin::Admin>,
    /// The certificates.
    certs: certificates::Panel,
    /// The messages waiting to be sent later.
    later: Option<later::Panel>,
    /// The friends kept, and their list.
    friends: friends::Friends,
    /// The view's own settings, and their page.
    settings: settings::Settings,
    /// Who is in the channel on screen, and the server's roles.
    members: members::Panel,
    /// The links let through without asking, and the one asked about.
    links: links::Guard,
    /// Where somebody is being moved to, while that is being chosen.
    mover: Option<mover::Mover>,
    /// The form a channel is being made in.
    channel_form: Option<channel_form::ChannelForm>,
    /// How the picture opened large is being looked at.
    looking: zoom::View,
    /// Whether a picture was open the last time the window was drawn: what
    /// was read of it for that is let go of once none is.
    looked_large: bool,
    /// The emoji picker: what narrows it, and what was used last.
    emoji: emoji::Picker,
    /// The names offered while one is being typed after an `@`.
    mention: Option<mention::Offer>,
    /// What links show from the web, as far as the reader let it in.
    embeds: embeds::Embeds,
    /// GIFs: the user's key, the servers' own addresses, the browser.
    gifs: gifs::Gifs,
    /// Somebody's full profile, and the local user's about being edited.
    profiles: profile_page::Profiles,
}

impl Panels {
    /// All closed, with what was `stored` remembered.
    fn keeping(stored: &Settings) -> Self {
        Self {
            friends: friends::Friends {
                open: false,
                kept: stored.friends.clone(),
            },
            settings: settings::Settings {
                privacy: stored.privacy,
                sounds: stored.sounds.clone(),
                format: stored.format,
                global_keys: stored.global_keys,
                display_name: stored.display_name.clone(),
                stay_disconnected: stored.stay_disconnected,
                look: stored.look,
                shortcuts: stored.shortcuts.clone(),
                notifications: stored.enable_notifications.0,
                welcome_display: stored.welcome_message_display,
                welcome_seen: stored.welcome_seen.clone(),
                dual_path: stored.enable_dual_path,
                logs: stored.logs.clone(),
                disconnect_warning: stored.show_disconnect_warning.0,
                streamer: stored.streamer_mode,
                server_switcher: stored.server_switcher,
                user_mode: stored.user_mode,
                voice: settings::VoicePage::remembering(
                    stored.gate_calibrated_for.clone(),
                    stored.denoiser_knobs.clone(),
                ),
                ..settings::Settings::default()
            },
            links: links::Guard::trusting(stored.trusted_hosts.clone()),
            emoji: emoji::Picker::remembering(stored.recent_emoji.clone()),
            gifs: gifs::Gifs::keeping(stored.klipy_key.clone()),
            members: members::Panel::remembering(stored),
            ..Self::default()
        }
    }
}

/// What the pointer is resting on, of what shows something for it.
#[derive(Debug, Default)]
struct Pointed {
    /// Somebody, in a list: whose card is shown once it has rested.
    user: Option<Session>,
    /// A message: which has its pill of actions up.
    pill: actions::Hovered,
}

/// How the window's own furniture is set.
#[derive(Default)]
struct Chrome {
    /// Whether the rail shows the servers' names beside their tiles.
    rail_wide: bool,
    /// The saved identity to connect as at every launch, if there is one.
    auto_connect: Option<gpui::SharedString>,
    /// Whether channels with nobody in or under them are left out of the
    /// column.
    hide_empty: bool,
    /// The messages picked, by id, while several are being picked to be
    /// deleted together.
    picked: Option<Vec<gpui::SharedString>>,
    /// Where the window is, as last noted.
    placed: Option<crate::store::Placed>,
    /// The picture behind a conversation, where one was chosen, and how
    /// far it is washed out with the window's colour.
    wall: Option<Arc<gpui::Image>>,
    wall_wash: f32,
    /// How far it is blurred, in pixels.
    wall_blur: u8,
    /// How far it is darkened, from not at all to black.
    wall_dim: f32,
    /// The pictures kept to put there, and which is.
    walls: crate::store::Backgrounds,
    /// Whether light or dark is the system's to choose, and follows it.
    follows_system: bool,
    /// Whether the countdown to a retry is being kept moving.
    retry_watched: bool,
    /// Whether the column of channels is put away, to give the
    /// conversation the room.
    column_hidden: bool,
    /// What the web client on this computer holds that this one does not,
    /// while that is on offer.
    carry: Option<crate::engine::CarryOver>,
    /// Whether the offer was declined: it is made once.
    carry_declined: bool,
    /// What is being said at the foot of the window, in passing.
    toasts: toasts::Toasts,
    /// The voice keys bound with the system, while the user has asked for
    /// them to work from other programs.
    hotkeys: Option<crate::hotkeys::Hotkeys>,
    /// The keys last said to be taken by another program: said once, not
    /// at every change of something else.
    told_of_keys: Vec<String>,
    /// The icon in the system's tray, where there is one.
    tray: Option<crate::tray::Tray>,
    /// The windows open beside this one, and where each was left.
    asides: aside::Asides,
    /// Where the user's own dock was last drawn: the sheet over it grows
    /// out of it.
    dock: std::rc::Rc<std::cell::Cell<Option<gpui::Bounds<gpui::Pixels>>>>,
}

impl Chrome {
    /// As it starts, with the identity remembered for connecting at launch.
    fn remembering(stored: &Settings, store: Option<&Store>) -> Self {
        let walls = store.map_or_else(
            || stored.chat_backgrounds.clone(),
            |store| store.backgrounds(&stored.chat_backgrounds),
        );
        Self {
            rail_wide: false,
            auto_connect: stored.auto_connect.clone().map(Into::into),
            hide_empty: stored.hide_empty,
            picked: None,
            placed: stored.window,
            follows_system: stored.mode.as_deref() == Some(crate::theme::SYSTEM),
            retry_watched: false,
            column_hidden: false,
            carry: None,
            carry_declined: stored.carry_declined,
            wall: store
                .zip(walls.current())
                .and_then(|(store, current)| store.chat_background(&current.file))
                .and_then(crate::picture::picture)
                .map(Arc::new),
            wall_wash: stored.wall_wash.unwrap_or(settings::WALL_WASH),
            wall_blur: stored.wall_blur.unwrap_or(0),
            wall_dim: stored.chat_bg_dim.unwrap_or(settings::WALL_DIM),
            walls,
            toasts: toasts::Toasts::default(),
            hotkeys: None,
            told_of_keys: Vec::new(),
            tray: None,
            asides: aside::Asides::remembering(stored.asides.clone()),
            dock: std::rc::Rc::default(),
        }
    }
}

/// Who has read how far in the open channel.
#[derive(Default)]
pub(super) struct Seen {
    /// How far each of the others has read.
    readers: Vec<Reader>,
    /// The newest message any of them has read, as a place in `messages`.
    pub(super) until: Option<usize>,
    /// The message the local user last said they had read up to.
    said: Option<gpui::SharedString>,
    /// The first message that had not been read when the conversation was
    /// opened, by its id and when it was sent: where the rule goes that
    /// marks where reading left off, for as long as the conversation is open.
    unread_from: Option<(Option<gpui::SharedString>, Option<u64>)>,
    /// The message just gone to, which stands out for a moment.
    pub(super) flashed: Option<gpui::SharedString>,
}

impl Seen {
    /// Note that the last `unread` of `messages` had not been read.
    fn leave_off(&mut self, messages: &[Message], unread: usize) {
        self.unread_from = messages
            .len()
            .checked_sub(unread)
            .filter(|_| unread > 0)
            .and_then(|at| messages.get(at))
            .map(|first| (first.id.clone(), first.sent_at_ms));
    }

    /// Where among `messages` the first that had not been read is now.
    fn left_off(&self, messages: &[Message]) -> Option<usize> {
        let (id, sent) = self.unread_from.as_ref()?;
        messages
            .iter()
            .position(|message| message.id == *id && message.sent_at_ms == *sent)
    }
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
    /// Who has read how far in the open channel.
    seen: Seen,
    /// Who is asking for the open channel's key.
    key_requests: Vec<KeyRequest>,
    /// The polls put to the open channel, oldest first.
    polls: Vec<Poll>,
    /// The messages that match what is in the search field.
    found: Vec<Found>,
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
    /// How many messages the open conversation holds, shown or not.
    held: usize,
    /// Everything pinned in the open conversation, the pin put on last
    /// first: also what is further back than the messages shown.
    pins: Vec<crate::engine::Pin>,
    /// Whether the reader is at the newest message: set by their own
    /// scrolling, and what decides whether an arrival moves them.
    at_tail: std::rc::Rc<std::cell::Cell<bool>>,
    /// How many messages arrived below a reader who was further up: what
    /// tells them one did, since they are not carried down to it. Reaching
    /// the newest message again clears it.
    below: std::rc::Rc<std::cell::Cell<usize>>,
    /// The conversation's rows: only the visible ones are laid out.
    rows: ListState,
    /// The bodies of the messages drawn so far, by message index.
    bodies: std::collections::HashMap<usize, Arc<conversation::DrawnBody>>,
    /// What lies behind the links of the messages drawn: `None` while the
    /// server is being asked, or when it found nothing.
    previews: std::collections::HashMap<gpui::SharedString, Option<Arc<Preview>>>,
    /// What each row is: a message, or the rule that starts a day.
    row_model: Vec<conversation::Row>,
    /// The clock message times are read on.
    zone: widgets::Zone,
    /// Who is talking right now.
    talking: HashSet<Session>,
    /// What was last seen of the server: what a sound is played against.
    watch: sounds::Watch,
    composer: Entity<TextInput>,
    /// The line on somebody's card that writes to them.
    card_line: Entity<TextInput>,
    /// Whether the list of what is pinned is showing.
    pins_open: bool,
    /// The message being answered: its id, and what the strip above the
    /// composer says of it.
    replying: Option<(gpui::SharedString, gpui::SharedString)>,
    /// The message being changed, while the composer holds its text.
    editing: Option<gpui::SharedString>,
    /// Who was last seen writing in the open channel, and when.
    typing: std::collections::HashMap<Session, std::time::Instant>,
    search: Entity<TextInput>,
    /// The saved identities, as last read from the engine.
    servers: Vec<SavedServer>,
    /// The `host:port` whose landing page is showing, once one was picked.
    selected_server: Option<String>,
    /// The livery of the server whose landing page is showing.
    livery: crate::livery::Landing,
    /// The identity picked to connect as, once one was.
    selected_identity: Option<gpui::SharedString>,
    server_search: Entity<TextInput>,
    /// The server's password, for the connect about to be made.
    secrets: connect::Secrets,
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
    /// The devices the system offers, once they have been asked for.
    devices: Option<AudioDevices>,
    /// The devices in use.
    chosen_devices: ChosenDevices,
    /// The card showing a user's comment or a channel's description.
    info: Option<Info>,
    /// What the pointer is resting on.
    pointed: Pointed,
    /// The server's welcome message, read once per message.
    welcome: welcome::Welcome,
    /// Whether the welcome message was dismissed on this connection.
    welcome_dismissed: bool,
    /// The session the conversation on screen belongs to.
    active_session: Option<gpui::SharedString>,
    /// Whether the connect screen is showing over a connection, to add
    /// another server.
    adding_server: bool,
    /// The unread count the window's title was last set for.
    titled_unread: u32,
    /// What an emoji picked from the picker is for, while it is open.
    emoji_for: Option<emoji::For>,
    /// The picture being looked at large, while one is.
    lightbox: Option<Arc<gpui::Image>>,
    /// The panels that open over the window.
    panels: Panels,
    chrome: Chrome,
    /// Who is whispered to, with which key.
    whisper: Whisper,
    /// The menu a right click opened, while it is open.
    menu: Option<menu::Menu>,
    /// The dialog a menu entry asked a question in, while it is open.
    prompt: Option<menu::Prompt>,
    /// How loud each user is played here, where that is not as sent.
    volumes: loudness::Loudness,
    /// What was being written in each conversation other than the open
    /// one, to be found again on coming back.
    drafts: std::collections::HashMap<Conversation, String>,
    /// How the microphone is used.
    voice_settings: VoiceSettings,
    /// The push-to-talk key and what it is doing.
    ptt: HeldKey,
    /// The window's own focus: where keys go when no field has them, so
    /// push to talk works without clicking into anything.
    focus: gpui::FocusHandle,
    /// The voice message being recorded, and the one playing.
    voice: voice_messages::VoiceMessages,
    /// Screen sharing: the shares in the channel, one's own, drawing.
    stage: stage::Stage,
    _events: Task<()>,
    _subscriptions: Vec<Subscription>,
}

/// The list the conversation's rows are laid out in, and the flag it keeps
/// of whether the reader is at the newest message: their own scrolling
/// sets it.
fn conversation_list() -> (
    ListState,
    std::rc::Rc<std::cell::Cell<bool>>,
    std::rc::Rc<std::cell::Cell<usize>>,
) {
    let at_tail = std::rc::Rc::new(std::cell::Cell::new(true));
    let below = std::rc::Rc::new(std::cell::Cell::new(0));
    let rows = ListState::new(0, ListAlignment::Top, px(OVERDRAW));
    rows.set_scroll_handler({
        let (at_tail, below) = (std::rc::Rc::clone(&at_tail), std::rc::Rc::clone(&below));
        move |scrolled, _, _| {
            let at_end = scrolled.visible_range.end >= scrolled.count;
            at_tail.set(at_end);
            // Back at the newest message: what arrived has been seen.
            if at_end {
                below.set(0);
            }
        }
    });
    (rows, at_tail, below)
}

/// The composer: as many lines as are typed, pictures taken from the
/// clipboard, and what is typed set the way `engine` will send it.
fn composer(engine: &Arc<dyn Engine>, cx: &mut Context<Shell>) -> Entity<TextInput> {
    let engine = Arc::clone(engine);
    let reads_marks: text_input::ReadsMarks =
        std::rc::Rc::new(move |text: &str| engine.typed(text));
    let composer = cx.new(|cx| {
        TextInput::new("", cx)
            .multiline()
            .taking_pictures()
            .setting_marks(reads_marks)
    });
    // Over a selection, the bar of marks; its emoji goes where typing does.
    let shell = cx.weak_entity();
    format_bar::FormatBar::attach(
        &composer,
        move |window, cx| {
            let _ = shell.update(cx, |shell, cx| {
                shell.open_emoji(emoji::For::Composer, Some(window), cx);
            });
        },
        cx,
    );
    composer
}

impl Shell {
    /// A shell showing whatever `engine` is connected to, remembering the
    /// chosen theme in `store`.
    /// The line on somebody's card that writes to them, and the hearing of
    /// what is entered on it.
    fn card_line(cx: &mut Context<Self>) -> (Entity<TextInput>, Subscription) {
        let line = cx.new(|cx| TextInput::new("Message", cx));
        let said = cx.subscribe(&line, |shell, line, event, cx| {
            shell.on_card_line(&line, event, cx);
        });
        (line, said)
    }

    /// What the shell keeps an eye on of its window: where it is, and
    /// whether the user is looking at it.
    fn watch_window(window: &mut Window, cx: &mut Context<Self>) -> Vec<Subscription> {
        vec![
            cx.observe_window_bounds(window, |shell, window, cx| shell.window_moved(window, cx)),
            cx.observe_window_appearance(window, |shell, window, cx| {
                shell.follow_system(window, cx);
            }),
            // The engine counts messages unread, and notifies, by whether
            // the user is looking.
            cx.observe_window_activation(window, |shell, window, cx| {
                shell.engine.set_focused(window.is_window_active());
                shell.retitle(window);
                // Nobody is looking: what is not in use can go.
                if !window.is_window_active() {
                    crate::trim::soon(cx);
                }
                cx.notify();
            }),
        ]
    }

    /// Read the engine for the first time: the server it is on already,
    /// if it is on one, is the one on screen and not one just arrived at.
    fn begin(&mut self, cx: &mut Context<Self>) {
        self.take_snapshot();
        self.active_session = self
            .snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.id.clone());
        self.engine
            .set_reconnecting(!self.panels.settings.stay_disconnected);
        self.rebind_global_keys(cx);
        self.follow_current_channel(None);
        self.begin_welcome(cx);
        self.look_for_carry();
        self.reload_messages(cx);
    }

    /// See what the web client on this computer holds that this one does
    /// not, unless bringing it over was already declined.
    fn look_for_carry(&mut self) {
        self.chrome.carry = (!self.chrome.carry_declined)
            .then(|| self.engine.carry_over())
            .flatten();
    }

    /// Bring the web client's servers and certificates over.
    pub(super) fn carry_now(&mut self, cx: &mut Context<Self>) {
        self.engine.carry_now();
        self.chrome.carry = None;
        cx.notify();
    }

    /// Leave the web client's servers where they are, and do not ask again.
    pub(super) fn decline_carry(&mut self, cx: &mut Context<Self>) {
        self.chrome.carry = None;
        self.chrome.carry_declined = true;
        self.remember_settings(cx);
        cx.notify();
    }

    /// What the shell does when its own fields are written in: the
    /// composer, the channel search, the server search and the password.
    fn watch_fields(
        [composer, search, server_search, password]: [&Entity<TextInput>; 4],
        cx: &mut Context<Self>,
    ) -> [Subscription; 4] {
        [
            cx.subscribe(composer, Self::on_composer),
            cx.subscribe(search, |shell, _, _, cx| shell.narrow_column(cx)),
            cx.subscribe(server_search, |_, _, _, cx| cx.notify()),
            // Enter in the password field connects.
            cx.subscribe(password, |shell, _, event, cx| {
                if matches!(event, InputEvent::Submitted(_)) {
                    shell.connect_selected(cx);
                }
            }),
        ]
    }

    pub(crate) fn new(
        engine: Arc<dyn Engine>,
        store: Option<Store>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        let (rows, at_tail, below) = conversation_list();
        let composer = composer(&engine, cx);
        let search = cx.new(|cx| TextInput::new("Search channels", cx));
        let server_search = cx.new(|cx| TextInput::new("Search servers", cx));
        let password = cx.new(|cx| TextInput::new("Password", cx).obscured());
        let (card_line, card_line_said) = Self::card_line(cx);
        let mut subscriptions = Self::watch_window(window, cx);
        subscriptions.push(card_line_said);
        subscriptions.extend(Self::watch_fields(
            [&composer, &search, &server_search, &password],
            cx,
        ));
        // Asked here, and whenever the list changes or is returned to.
        engine.refresh_pings();
        let events = Self::listen(engine.events(), cx);
        let stored = store.as_ref().map(Store::settings).unwrap_or_default();
        let chrome = Chrome::remembering(&stored, store.as_ref());
        settings::apply_kept(&stored, engine.as_ref(), cx);
        let mut shell = Self {
            snapshot: Snapshot::disconnected(),
            wanted: String::new(),
            tree: Vec::new(),
            seen: Seen::default(),
            key_requests: Vec::new(),
            polls: Vec::new(),
            found: Vec::new(),
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
            pins: Vec::new(),
            rows,
            at_tail,
            below,
            bodies: std::collections::HashMap::new(),
            previews: std::collections::HashMap::new(),
            row_model: Vec::new(),
            zone: widgets::Zone::Local,
            talking: HashSet::new(),
            watch: sounds::Watch::default(),
            composer,
            card_line,
            pins_open: false,
            replying: None,
            editing: None,
            typing: std::collections::HashMap::new(),
            search,
            selected_server: None,
            livery: crate::livery::Landing::default(),
            selected_identity: None,
            server_search,
            secrets: connect::Secrets::new(password, cx),
            editor: None,
            notice: None,
            store,
            picker_open: false,
            devices_open: false,
            devices: None,
            chosen_devices: engine.chosen_devices(),
            info: None,
            pointed: Pointed::default(),
            welcome: welcome::Welcome::default(),
            welcome_dismissed: false,
            active_session: None,
            adding_server: false,
            titled_unread: 0,
            emoji_for: None,
            lightbox: None,
            panels: Panels::keeping(&stored),
            chrome,
            whisper: Whisper {
                key: stored.whisper_key.map(Into::into),
                ..Whisper::default()
            },
            menu: None,
            prompt: None,
            volumes: loudness::Loudness::remembering(stored.volumes),
            drafts: std::collections::HashMap::new(),
            voice_settings: engine.voice_settings(),
            ptt: HeldKey {
                key: stored.push_to_talk_key.map(Into::into),
                ..HeldKey::default()
            },
            focus: cx.focus_handle(),
            voice: voice_messages::VoiceMessages::default(),
            stage: stage::Stage::new(engine.media(), window, cx),
            engine,
            _events: events,
            _subscriptions: subscriptions,
        };
        shell.begin(cx);
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
        // The shares follow who is where, once a burst is applied.
        self.follow_shares(cx);
        self.mirror_tray();
        cx.notify();
    }

    fn apply(&mut self, event: EngineEvent, cx: &mut Context<Self>) {
        match event {
            EngineEvent::StateChanged => self.state_changed(cx),
            EngineEvent::About { subject, html } => self.take_about(subject, html, cx),
            EngineEvent::Facts {
                subject,
                facts,
                devices,
            } => self.take_facts(subject, facts, devices),
            EngineEvent::ServersChanged => {
                self.servers = self.engine.saved_servers();
                self.look_for_carry();
            }
            EngineEvent::Whispering(active) => self.whisper.active = active,
            EngineEvent::KeyRequests { channel } => {
                if self.open == Some(Conversation::Channel(channel)) {
                    self.key_requests = self.engine.key_requests(channel);
                }
            }
            EngineEvent::Readers { channel, readers } => {
                if self.open == Some(Conversation::Channel(channel)) {
                    self.seen.readers = readers;
                    self.note_seen();
                    self.stick_to_tail();
                }
            }
            EngineEvent::Shared { key, picture } => {
                if !self.took_profile_picture(&key, picture.as_ref()) {
                    let _ = self.panels.shared.insert(key, picture);
                }
            }
            EngineEvent::AboutSaved(saved) => self.about_saved(saved, cx),
            EngineEvent::ProfilePage { key, page } => self.page_arrived(&key, page),
            EngineEvent::Previews(previews) => self.take_previews(previews),
            EngineEvent::Acl(acl) => self.take_acl(acl),
            EngineEvent::Bans(bans) => self.take_bans(bans, cx),
            EngineEvent::Registered(users) => self.take_accounts(users, cx),
            EngineEvent::DirectoryRefused => self.directory_refused(),
            EngineEvent::Scheduled(waiting) => self.take_scheduled(waiting),
            EngineEvent::ScheduleTaken => self.schedule_taken(),
            EngineEvent::CertificatesChanged => {
                self.panels.certs.held = self.engine.certificates();
                self.panels.certs.doomed = None;
            }
            EngineEvent::Notice(notice) => self.notice = notice,
            EngineEvent::Wanted(wanted) => self.secrets.asked(wanted, cx),
            EngineEvent::Done(says) => self.toast(says, toasts::Kind::Done, cx),
            EngineEvent::Typing { channel, session } => self.saw_typing(channel, session, cx),
            EngineEvent::LiveryProbed { key, livery } => self.livery_probed(&key, livery, cx),
            EngineEvent::LiveryChanged => self.liveries_changed(cx),
            EngineEvent::CurrentChannelChanged => {
                self.take_snapshot();
                self.follow_current_channel(self.was_in);
                self.reload_messages(cx);
            }
            EngineEvent::Share(heard) => self.hear_share(heard, cx),
            EngineEvent::UserTalking { session, talking } => self.user_talking(session, talking),
            EngineEvent::NewMessage { conversation } => self.new_message(conversation, cx),
        }
    }

    /// Channels, users or the connection changed: read the server again, and
    /// follow what that changed.
    fn state_changed(&mut self, cx: &mut Context<Self>) {
        let was = self.snapshot.connection;
        self.take_snapshot();
        // A new connection has a welcome of its own to show.
        if was != Connection::Connected && self.snapshot.connection == Connection::Connected {
            self.welcome_dismissed = false;
            // On the server: what was typed to get there is let go of.
            self.secrets.forget(cx);
        }
        self.read_welcome(cx);
        self.hear_changes();
        self.watch_retry(cx);
        self.drop_gone_whisper_target(cx);
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
        if was == Connection::Connected && self.snapshot.connection == Connection::Disconnected {
            self.engine.refresh_pings();
        }
    }

    /// What a server found behind links has come.
    fn take_previews(&mut self, previews: Vec<Preview>) {
        for preview in previews {
            let _ = self
                .previews
                .insert(preview.url.clone(), Some(Arc::new(preview)));
        }
        self.stick_to_tail();
    }

    /// `session` started or stopped talking.
    fn user_talking(&mut self, session: Session, talking: bool) {
        if talking && Some(session) != self.snapshot.own_session {
            self.hear(crate::sounds::Event::Talking);
        }
        let _ = if talking {
            self.talking.insert(session)
        } else {
            self.talking.remove(&session)
        };
    }

    /// `conversation` received, changed or lost a message.
    fn new_message(&mut self, conversation: Conversation, cx: &mut Context<Self>) {
        self.hear_message(conversation);
        if self.open == Some(conversation) {
            // On screen, so read: it must not also count as unread.
            self.engine.open(conversation);
            self.reload_messages(cx);
        } else {
            self.take_snapshot();
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

    /// What the server told of a user's connection, and of each of their
    /// devices, for the information view open on them; dropped otherwise.
    fn take_facts(
        &mut self,
        subject: Subject,
        facts: Vec<(gpui::SharedString, gpui::SharedString)>,
        devices: Vec<crate::engine::DeviceFacts>,
    ) {
        if let Some(info) = self.info.as_mut().filter(|info| info.subject == subject) {
            info.facts = facts;
            info.devices = devices;
        }
    }

    /// Show what there is to read about `subject`, fetching it.
    /// What there is to read about a subject arrived: fill the dialog
    /// that describes it, and the card that is open on it.
    fn take_about(
        &mut self,
        subject: Subject,
        html: Option<gpui::SharedString>,
        cx: &mut Context<Self>,
    ) {
        self.fill_description(subject, html.as_ref().map(AsRef::as_ref), cx);
        self.hear_own_profile(subject, html.as_ref().map(AsRef::as_ref), cx);
        self.take_own_comment(subject, html.as_ref().map(AsRef::as_ref), cx);
        let Some(info) = self.info.as_mut().filter(|info| info.subject == subject) else {
            return;
        };
        let html = html.unwrap_or_default();
        if !matches!(subject, Subject::User(_)) {
            // A description or a welcome is a page, drawn as the web client
            // draws one.
            info.body = Some(Arc::new(conversation::DrawnBody::read("")));
            self.read_page(html, cx, move |shell, page, _| {
                if let Some(info) = shell.info.as_mut().filter(|info| info.subject == subject) {
                    info.page = Some(page);
                }
            });
            return;
        }
        // What somebody wrote about themselves: its pictures are not read.
        card::read_comment(info, &html);
        if matches!(subject, Subject::User(_)) {
            info.profile = crate::profile::Profile::of(&html);
            // Asked of the system once, when the profile is read.
            info.name_family = info
                .profile
                .as_ref()
                .and_then(|profile| profile.name_face)
                .map(|face| crate::theme::family(face.stack(), cx));
            info.banner = info
                .profile
                .as_mut()
                .and_then(|profile| profile.banner_picture.take())
                .and_then(crate::picture::picture)
                .map(Arc::new);
        }
    }

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
        // A channel's facts are in hand; anybody else's are asked for.
        let facts = match subject {
            Subject::Channel(id) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map(|channel| {
                    about::channel_facts(channel, &self.snapshot.channels, &self.snapshot.users)
                }),
            _ => None,
        };
        self.info = Some(Info {
            subject,
            title: title.unwrap_or_default(),
            body: None,
            page: None,
            facts: facts.unwrap_or_default(),
            devices: Vec::new(),
            profile: None,
            name_family: None,
            banner: None,
            written: card::Written::default(),
            hover: None,
            anchor: None,
            sheet: false,
        });
        if let Subject::User(_) = subject {
            let line = self
                .info
                .as_ref()
                .map(|info| format!("Message @{}", info.title));
            self.card_line.update(cx, |field, _| {
                field.clear();
                field.set_placeholder(line.unwrap_or_default());
            });
        }
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

    /// Work out the newest message somebody else has read.
    fn note_seen(&mut self) {
        self.seen.until = self
            .seen
            .readers
            .iter()
            .filter_map(|reader| self.place_of(&reader.read_up_to))
            .max();
    }

    /// Where the message `id` is among those shown.
    fn place_of(&self, id: &gpui::SharedString) -> Option<usize> {
        self.messages
            .iter()
            .rposition(|message| message.id.as_ref() == Some(id))
    }

    /// The names of those who have read the message at `index`.
    pub(super) fn seen_by(&self, index: usize) -> Vec<gpui::SharedString> {
        self.seen
            .readers
            .iter()
            .filter(|reader| {
                self.place_of(&reader.read_up_to)
                    .is_some_and(|at| at >= index)
            })
            .map(|reader| reader.name.clone())
            .collect()
    }

    /// Tell the others how far the local user has read: once for each
    /// newest message, and only one somebody else wrote.
    fn say_read(&mut self) {
        let (Some(conversation), Some(newest)) = (self.open, self.messages.last()) else {
            return;
        };
        let Some(id) = newest.id.clone().filter(|_| !newest.own) else {
            return;
        };
        // Noted either way, so switching the telling back on does not
        // announce everything read in the meantime at once.
        if self.seen.said.as_ref() != Some(&id) {
            self.seen.said = Some(id.clone());
            if !self.panels.settings.privacy.hide_reading {
                self.engine.read_up_to(conversation, id);
            }
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

    /// How many messages of `conversation` the server state last read
    /// counts as unread.
    fn unread_in(&self, conversation: Conversation) -> usize {
        let unread = match conversation {
            Conversation::Channel(id) => self
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id)
                .map(|channel| channel.unread),
            Conversation::Direct(session) => self
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map(|user| user.unread),
        };
        unread.unwrap_or(0) as usize
    }

    /// What the server lets the local user do at its root: what is the
    /// whole server's to grant.
    pub(super) fn root_rights(&self) -> crate::rights::Rights {
        self.snapshot
            .channels
            .iter()
            .find(|channel| channel.parent.is_none())
            .map(|channel| channel.rights)
            .unwrap_or_default()
    }

    /// Move into `channel` and read it, asking for its password first
    /// where it wants one: a plain join there is refused without a word,
    /// which reads as a click ignored. Says whether the user is on their
    /// way in, not waiting to be asked.
    pub(super) fn enter(
        &mut self,
        channel: ChannelId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> bool {
        let restricted = self
            .snapshot
            .channels
            .iter()
            .any(|known| known.id == channel && known.restricted);
        if restricted && self.snapshot.current_channel != Some(channel) {
            self.ask_join_password(channel, window, cx);
            return false;
        }
        self.engine.join_channel(channel);
        self.open_conversation(Conversation::Channel(channel), cx);
        true
    }

    /// Move into `channel` to talk: voice comes on with it, where it was
    /// off. Moving alone leaves somebody who never turned voice on in the
    /// room and hearing nothing. Behind a password, voice waits until they
    /// are in.
    pub(super) fn enter_to_talk(
        &mut self,
        channel: ChannelId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        if self.enter(channel, window, cx) && self.snapshot.voice == Voice::Off {
            self.engine.toggle_microphone();
        }
    }

    /// Put the column of channels away, or bring it back.
    pub(super) fn toggle_column(&mut self, cx: &mut Context<Self>) {
        self.chrome.column_hidden = !self.chrome.column_hidden;
        cx.notify();
    }

    /// Go to the newest message, from wherever the reader was.
    pub(super) fn jump_to_latest(&mut self, cx: &mut Context<Self>) {
        self.at_tail.set(true);
        self.below.set(0);
        self.stick_to_tail();
        cx.notify();
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
            self.chrome.picked = None;
            self.pins_open = false;
            self.typing.clear();
            self.swap_draft(conversation, cx);
            self.open = Some(conversation);
            self.engine.open(conversation);
            self.reload_messages(cx);
            // The one on screen is listed even when it is empty.
            if self.chrome.hide_empty {
                self.lay_out_column();
            }
            self.list_members();
        }
        cx.notify();
    }

    /// Put what is being written aside for the conversation it was written
    /// in, and take up what was left unsent in `next`.
    fn swap_draft(&mut self, next: Conversation, cx: &mut Context<Self>) {
        let written = self.composer.read(cx).text().to_owned();
        if let Some(leaving) = self.open {
            if written.trim().is_empty() {
                let _ = self.drafts.remove(&leaving);
            } else {
                let _ = self.drafts.insert(leaving, written);
            }
        }
        let draft = self.drafts.remove(&next).unwrap_or_default();
        self.composer.update(cx, |composer, cx| {
            composer.set_text(draft);
            cx.notify();
        });
    }

    /// Read the open conversation's messages again and lay the rows out
    /// afresh.
    fn reload_messages(&mut self, cx: &mut Context<Self>) {
        // Another conversation starts from its newest page again.
        let same_conversation = self.shown == self.open;
        // What the conversation held unread, before opening it reads it.
        let unread = self.open.map_or(0, |open| self.unread_in(open));
        if !same_conversation {
            self.shown = self.open;
            self.window = PAGE;
            self.key_requests = match self.open {
                Some(Conversation::Channel(channel)) => self.engine.key_requests(channel),
                _ => Vec::new(),
            };
            self.seen.readers.clear();
            self.seen.said = None;
            self.leave_voice_messages();
        }
        let window = self
            .open
            .map(|conversation| self.engine.window(conversation, self.window))
            .unwrap_or_default();
        let messages = window.messages;
        self.earlier = window.earlier;
        self.held = self
            .open
            .map_or(0, |conversation| self.engine.message_count(conversation));
        // Everything pinned here, not only what is among these messages.
        self.pins = self
            .open
            .map(|conversation| self.engine.pins(conversation))
            .unwrap_or_default();
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
        let arrived = messages.len().saturating_sub(self.messages.len()).max(1);
        self.messages = messages;
        if !same_conversation {
            self.seen.leave_off(&self.messages, unread);
        }
        self.note_seen();
        self.say_read();
        // A short conversation starts under the header, as the web UI draws
        // it; a long one opens on its newest message.
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_or(0, |since| {
                u64::try_from(since.as_millis()).unwrap_or(u64::MAX)
            });
        let rows_before = self.row_model.len();
        self.row_model = conversation::rows(&self.messages, now_ms, self.zone);
        let polls = self
            .open
            .map(|conversation| self.engine.polls(conversation))
            .unwrap_or_default();
        // A vote changes a poll's row without adding one: that is a change
        // to rows that are otherwise the same.
        let kept = kept && polls == self.polls;
        self.polls = polls;
        conversation::place_polls(&mut self.row_model, &self.messages, &self.polls);
        conversation::place_unread(&mut self.row_model, self.seen.left_off(&self.messages));
        if self.earlier {
            self.row_model.insert(0, conversation::Row::Earlier);
        }
        let rows = self.row_model.len();
        // The reader is taken to the newest message when they were on it
        // already, when the conversation is another one, and when what
        // arrived is their own.
        let follows = !same_conversation
            || self.at_tail.get()
            || (!same_newest && self.messages.last().is_some_and(|message| message.own));
        if follows {
            self.below.set(0);
        } else if !same_newest {
            // Not carried down to it: told that it is there.
            self.below.set(self.below.get() + arrived);
        }
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
                    && !self.panels.settings.privacy.hide_writing
                {
                    self.engine.typing(conversation);
                }
                self.offer_mentions(cx);
            }
            InputEvent::Pick(pick) => self.pick_mention(*pick, cx),
            InputEvent::Cancelled => self.stop_editing(cx),
            InputEvent::PastedPicture(picture) => {
                if let Some(conversation) = self.open {
                    self.engine.send_picture(conversation, picture.clone());
                }
            }
            InputEvent::Tabbed { .. } => self.complete_mention(cx),
        }
    }

    /// Enter on a card's line: say it to whoever the card is of, and go to
    /// the conversation with them, where it is seen to land.
    fn on_card_line(
        &mut self,
        line: &Entity<TextInput>,
        event: &InputEvent,
        cx: &mut Context<Self>,
    ) {
        let InputEvent::Submitted(text) = event else {
            return;
        };
        let Some(Subject::User(session)) = self.info.as_ref().map(|info| info.subject) else {
            return;
        };
        if text.trim().is_empty() {
            return;
        }
        let to = Conversation::Direct(session);
        self.engine.send_message(to, text.clone());
        line.update(cx, |field, _| field.clear());
        self.info = None;
        self.open_conversation(to, cx);
    }

    /// Tab in the composer: finish the `@name` being typed at its end
    /// with the first of those here whose name starts that way.
    fn complete_mention(&mut self, cx: &mut Context<Self>) {
        let text = self.composer.read(cx).text().to_owned();
        let Some(at) = text.rfind('@') else {
            return;
        };
        let begun = &text[at + 1..];
        let starts_word = text[..at]
            .chars()
            .next_back()
            .is_none_or(char::is_whitespace);
        if !starts_word || begun.contains(char::is_whitespace) {
            return;
        }
        let begun = begun.to_lowercase();
        let mut names: Vec<&gpui::SharedString> = self
            .snapshot
            .users
            .iter()
            .filter(|user| Some(user.session) != self.snapshot.own_session)
            .map(|user| &user.name)
            .filter(|name| name.to_lowercase().starts_with(&begun))
            .collect();
        names.sort();
        let Some(name) = names.first() else {
            return;
        };
        let completed = format!("{}@{name} ", &text[..at]);
        self.composer.update(cx, |composer, cx| {
            composer.set_text(completed);
            cx.notify();
        });
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

    /// Answer the message at `index`: what is sent next names it.
    pub(super) fn start_replying(
        &mut self,
        index: usize,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let Some((id, said)) = self
            .messages
            .get(index)
            .and_then(|message| Some((message.id.clone()?, conversation::said_by(message))))
        else {
            return;
        };
        // Answering is not correcting: what was being changed is let go.
        self.stop_editing(cx);
        self.replying = Some((id, said));
        self.composer.read(cx).focus(window);
        cx.notify();
    }

    /// Leave the message being changed as it was, or the one being
    /// answered unanswered.
    pub(super) fn stop_editing(&mut self, cx: &mut Context<Self>) {
        if self.replying.take().is_some() {
            cx.notify();
        }
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
        // Not saying when you write is not being told when others do: the
        // switch is one bargain, as the web UI has it.
        if self.panels.settings.privacy.hide_writing {
            return Vec::new();
        }
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
        // What waits above the composer goes out with what is typed, or
        // by itself.
        if self.has_staged() && self.editing.is_none() {
            if self.send_staged(body, cx) {
                self.replying = None;
                self.composer.update(cx, |composer, cx| {
                    composer.clear();
                    cx.notify();
                });
            }
            return;
        }
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
            (_, Some(conversation)) => match self.replying.take() {
                Some((to, _)) => self.engine.send_reply(conversation, to, body),
                None => self.engine.send_message(conversation, body),
            },
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

    /// Start with something open: `picker`, `devices`, `certificates`,
    /// `permissions`, `bans`, `channel` or `editor`. For
    /// looking at them where nothing can click.
    pub(crate) fn open_for_inspection(
        &mut self,
        what: &str,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        match what {
            "picker" => self.toggle_picker(cx),
            "welcome" => self.show_welcome_again(cx),
            "devices" => self.toggle_devices(cx),
            "certificates" => self.toggle_certificates(cx),
            "members" => self.toggle_members(cx),
            "settings" => self.open_settings(cx),
            // `settings:voice` and the like: on that page.
            page if page.starts_with("settings:") => {
                self.open_settings_at(&page["settings:".len()..], cx);
            }
            "bans" => self.open_admin(crate::engine::Listing::Bans, cx),
            "channel" => {
                if let Some(channel) = self.snapshot.current_channel {
                    self.open_channel_form(channel, window, cx);
                }
            }
            // The first user who is not the local one.
            "profile" => {
                let other = self.snapshot.users.iter().map(|user| user.session);
                if let Some(session) = other
                    .filter(|s| Some(*s) != self.snapshot.own_session)
                    .nth(1)
                {
                    self.pin_card(session, None, cx);
                }
            }
            "emoji" => self.open_emoji(emoji::For::Composer, None, cx),
            "permissions" => {
                if let Some(channel) = self.snapshot.current_channel {
                    self.open_acl(channel, cx);
                }
            }
            "editor" => self.open_editor(None, None, window, cx),
            // `share:popout` and the like: see `stage::inspect`.
            share if share.starts_with("share:") => {
                self.open_share_for_inspection(&share["share:".len()..], cx);
            }
            _ => {}
        }
    }

    /// Escape: close whatever is open on top of the window.
    pub(crate) fn dismiss(&mut self, cx: &mut Context<Self>) {
        if self.shrink_video(cx) || self.dismiss_stage(cx) {
            return;
        }
        // The smallest thing open goes first: a list over what is written.
        if self.panels.mention.is_some() {
            self.pick_mention(mention::Pick::Leave, cx);
            return;
        }
        if self.lightbox.take().is_some()
            || self.emoji_for.take().is_some()
            || self.close_gifs(cx)
            || self.menu.take().is_some()
            || self.prompt.take().is_some()
            || self.info.take().is_some()
        {
            cx.notify();
            return;
        }
        if self.editing.is_some() || self.replying.is_some() {
            self.stop_editing(cx);
            return;
        }
        if self.chrome.picked.take().is_some() {
            cx.notify();
            return;
        }
        if self.panels.mover.take().is_some()
            || self.panels.channel_form.take().is_some()
            || std::mem::take(&mut self.pins_open)
        {
            cx.notify();
            return;
        }
        // A form open in the administrator's panel goes before the panel.
        if self.close_ban_editor(cx) {
            return;
        }
        if self.panels.admin.take().is_some()
            || self.panels.acl.take().is_some()
            || self.panels.later.take().is_some()
            || std::mem::take(&mut self.panels.friends.open)
            || std::mem::take(&mut self.panels.settings.open)
        {
            cx.notify();
            return;
        }
        if self.editor.take().is_none() {
            self.picker_open = false;
            self.devices_open = false;
            self.panels.certs.open = false;
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
        self.take_roles();
        self.volumes
            .meet(&self.snapshot.users, self.engine.as_ref());
    }

    /// Work out the channel column's rows: each listed channel, and under
    /// it the people in it. The reader stays where they had scrolled to.
    fn lay_out_column(&mut self) {
        let column: Vec<sidebar::Row> = self
            .listed(&self.wanted)
            .into_iter()
            .flat_map(|(at, depth)| {
                // Who is where is the point of the tree: every channel
                // with people in it lists them, by name under it or as
                // faces on its own row.
                let peopled = self.occupant_count(self.snapshot.channels[at].id) > 0
                    && self.panels.settings.look.channel_viewer_style.drawn()
                        == crate::store::ChannelViewer::Flat;
                std::iter::once(sidebar::Row::Channel { at, depth })
                    .chain(peopled.then_some(sidebar::Row::People { at, depth }))
            })
            // Under the channels, the messages that matched.
            .chain(
                (!self.found.is_empty())
                    .then_some(sidebar::Row::FoundHeading)
                    .into_iter()
                    .chain((0..self.found.len()).map(sidebar::Row::Found)),
            )
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
        self.found.clear();
        self.lay_out_column();
        cx.notify();
        // A letter matches everything; the messages are searched from two.
        if self.wanted.chars().count() < 2 {
            return;
        }
        // Off the view's thread, and only the answer to what is still in
        // the field is taken: typing does not wait on the search.
        let (engine, wanted) = (Arc::clone(&self.engine), self.wanted.clone());
        cx.spawn(async move |shell, cx| {
            let query = wanted.clone();
            let found = cx
                .background_executor()
                .spawn(async move { engine.search_messages(&query) })
                .await;
            let _ = shell.update(cx, |shell, cx| {
                if shell.wanted == wanted {
                    shell.found = found;
                    shell.lay_out_column();
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// The channels the column lists, as places in the snapshot with how
    /// deep each sits: the whole tree in order, or - flat - those whose
    /// name contains `wanted`.
    fn listed(&self, wanted: &str) -> Vec<(usize, usize)> {
        if wanted.is_empty() && self.chrome.hide_empty {
            let peopled = self.peopled();
            return self
                .tree
                .iter()
                .copied()
                .filter(|(at, _)| peopled.contains(&self.snapshot.channels[*at].id))
                .collect();
        }
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

    /// The channels worth listing when the empty ones are hidden: those
    /// with somebody in them, everything above those, and the one on
    /// screen.
    fn peopled(&self) -> HashSet<ChannelId> {
        let parents: std::collections::HashMap<ChannelId, Option<ChannelId>> = self
            .snapshot
            .channels
            .iter()
            .map(|channel| (channel.id, channel.parent))
            .collect();
        let open = match self.open {
            Some(Conversation::Channel(id)) => Some(id),
            _ => None,
        };
        let mut kept = HashSet::new();
        for start in self
            .snapshot
            .users
            .iter()
            .map(|user| user.channel)
            .chain(open)
        {
            let mut at = Some(start);
            // Up to the root, stopping where an earlier walk already went.
            while let Some(id) = at.filter(|id| kept.insert(*id)) {
                at = parents.get(&id).copied().flatten();
            }
        }
        kept
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

    /// Flip between the light and dark drawing of the current theme. A
    /// choice made by hand is no longer the system's.
    pub(crate) fn toggle_mode(&mut self, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        self.chrome.follows_system = false;
        self.set_theme(&theme.id, theme.mode.toggled(), cx);
    }

    /// Whether light or dark is the system's to choose.
    pub(super) fn follows_system(&self) -> bool {
        self.chrome.follows_system
    }

    /// Go to the next of dark, light and whichever the system is in.
    pub(super) fn next_mode(&mut self, window: &Window, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        if self.chrome.follows_system {
            self.chrome.follows_system = false;
            self.set_theme(&theme.id, Mode::Dark, cx);
        } else if theme.mode == Mode::Dark {
            self.set_theme(&theme.id, Mode::Light, cx);
        } else {
            self.chrome.follows_system = true;
            self.set_theme(&theme.id, Mode::of(window.appearance()), cx);
        }
    }

    /// The system went light or dark: so does the theme, if that is the
    /// system's to choose.
    fn follow_system(&mut self, window: &Window, cx: &mut Context<Self>) {
        let theme = ActiveTheme::get(cx);
        let mode = Mode::of(window.appearance());
        if self.chrome.follows_system && theme.mode != mode {
            ActiveTheme::set(&theme.id, mode, cx);
            cx.notify();
        }
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
        // While a picture is open the arrows go from picture to picture.
        if self.lightbox.is_some() && self.lightbox_key(key, cx) {
            cx.stop_propagation();
            return;
        }
        // A key being chosen on the Shortcuts page, or the voice priority
        // key.
        if self.hear_chosen_key(&event.keystroke, cx) {
            cx.stop_propagation();
            return;
        }
        if self.ptt.choosing {
            self.ptt.choosing = false;
            // Escape keeps the key there was.
            if key != "escape" {
                self.ptt.key = Some(key.to_owned().into());
                self.rebind_global_keys(cx);
                self.remember_settings(cx);
            }
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.whisper.choosing_key {
            self.whisper.choosing_key = false;
            if key != "escape" {
                self.whisper.key = Some(key.to_owned().into());
                self.rebind_global_keys(cx);
                self.remember_settings(cx);
            }
            cx.stop_propagation();
            cx.notify();
            return;
        }
        if self.is_whisper_key(key) {
            if !std::mem::replace(&mut self.whisper.held, true) {
                self.engine.whisper(true);
            }
            cx.stop_propagation();
            return;
        }
        if self.is_ptt_key(key) {
            // Held keys repeat; only the first press is a press.
            if !std::mem::replace(&mut self.ptt.held, true) {
                self.engine.push_to_talk(true);
            }
            cx.stop_propagation();
        }
    }

    /// Who the whisper key speaks to.
    pub(super) fn whisper_target(&self) -> Option<WhisperTarget> {
        self.whisper.target.as_ref().map(|(target, _)| *target)
    }

    /// Whether `key` is the whisper key and there is somebody to whisper
    /// to.
    fn is_whisper_key(&self, key: &str) -> bool {
        self.whisper.target.is_some()
            && self.snapshot.connection == Connection::Connected
            && self
                .whisper
                .key
                .as_ref()
                .is_some_and(|chosen| chosen.as_ref() == key)
    }

    /// Whisper to `target`, called `name`, when the whisper key is held;
    /// chosen a second time, to nobody again.
    pub(super) fn toggle_whisper_target(
        &mut self,
        target: WhisperTarget,
        name: gpui::SharedString,
        cx: &mut Context<Self>,
    ) {
        let chosen = self.whisper.target.as_ref().map(|(chosen, _)| *chosen) != Some(target);
        self.set_whisper_target(chosen.then_some((target, name)), cx);
    }

    fn set_whisper_target(
        &mut self,
        target: Option<(WhisperTarget, gpui::SharedString)>,
        cx: &mut Context<Self>,
    ) {
        // A whisper under way ends with the target it was for.
        if std::mem::take(&mut self.whisper.held) {
            self.engine.whisper(false);
        }
        self.engine
            .set_whisper_target(target.as_ref().map(|(target, _)| *target));
        self.whisper.target = target;
        cx.notify();
    }

    /// Somebody who left, or a channel that went, is whispered to no
    /// longer: the session number may be somebody else's tomorrow.
    fn drop_gone_whisper_target(&mut self, cx: &mut Context<Self>) {
        let gone = match self.whisper.target.as_ref().map(|(target, _)| *target) {
            Some(WhisperTarget::User(session)) => !self
                .snapshot
                .users
                .iter()
                .any(|user| user.session == session),
            Some(WhisperTarget::Channel(channel)) => !self
                .snapshot
                .channels
                .iter()
                .any(|known| known.id == channel),
            None => false,
        };
        if gone {
            self.set_whisper_target(None, cx);
        }
    }

    fn on_key_up(&mut self, event: &gpui::KeyUpEvent, _: &mut Window, cx: &mut Context<Self>) {
        if self.release_chosen_key(&event.keystroke) {
            cx.stop_propagation();
            return;
        }
        let key = event.keystroke.key.as_str();
        if self
            .whisper
            .key
            .as_ref()
            .is_some_and(|chosen| chosen.as_ref() == key)
            && std::mem::take(&mut self.whisper.held)
        {
            self.engine.whisper(false);
            cx.stop_propagation();
            return;
        }
        if self.is_ptt_key(event.keystroke.key.as_str()) && std::mem::take(&mut self.ptt.held) {
            self.engine.push_to_talk(false);
            cx.stop_propagation();
        }
    }

    /// Whether `key` is the push-to-talk key and push to talk is on.
    fn is_ptt_key(&self, key: &str) -> bool {
        self.voice_settings.push_to_talk
            && self.snapshot.connection == Connection::Connected
            && self
                .ptt
                .key
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
                _ if self.chrome.follows_system => crate::theme::SYSTEM.to_owned(),
                Mode::Light => "light".to_owned(),
                Mode::Dark => "dark".to_owned(),
            }),
            input_device: name(&self.chosen_devices.input),
            output_device: name(&self.chosen_devices.output),
            voice: Some(self.voice_settings),
            push_to_talk_key: name(&self.ptt.key),
            whisper_key: name(&self.whisper.key),
            auto_connect: name(&self.chrome.auto_connect),
            friends: self.panels.friends.kept.clone(),
            hide_empty: self.chrome.hide_empty,
            hide_offline: !self.panels.members.show_offline,
            privacy: self.panels.settings.privacy,
            sounds: self.panels.settings.sounds.clone(),
            wall_wash: Some(self.chrome.wall_wash)
                .filter(|wash| (wash - settings::WALL_WASH).abs() > f32::EPSILON),
            wall_blur: Some(self.chrome.wall_blur).filter(|blur| *blur > 0),
            window: self.chrome.placed,
            asides: self.chrome.asides.places().clone(),
            format: self.panels.settings.format,
            trusted_hosts: self.panels.links.trusted.clone(),
            recent_emoji: self.panels.emoji.recent.clone(),
            klipy_key: self.panels.gifs.kept_key(),
            display_name: self.panels.settings.display_name.clone(),
            global_keys: self.panels.settings.global_keys,
            stay_disconnected: self.panels.settings.stay_disconnected,
            carry_declined: self.chrome.carry_declined,
            volumes: self.volumes.kept().clone(),
            language: crate::words::spoken(),
            gate_calibrated_for: self.panels.settings.voice.calibrated_for.clone(),
            denoiser_knobs: self.panels.settings.voice.knobs.clone(),
            look: self.panels.settings.look,
            server_switcher: self.panels.settings.server_switcher,
            user_mode: self.panels.settings.user_mode,
            chat_backgrounds: self.chrome.walls.clone(),
            chat_bg_dim: Some(self.chrome.wall_dim)
                .filter(|dim| (dim - settings::WALL_DIM).abs() > f32::EPSILON),
            shortcuts: self.panels.settings.shortcuts.clone(),
            enable_notifications: crate::store::Enabled(self.panels.settings.notifications),
            welcome_message_display: self.panels.settings.welcome_display,
            welcome_seen: self.panels.settings.welcome_seen.clone(),
            enable_dual_path: self.panels.settings.dual_path,
            logs: self.panels.settings.logs.clone(),
            show_disconnect_warning: crate::store::Enabled(self.panels.settings.disconnect_warning),
            streamer_mode: self.panels.settings.streamer,
        };
        if let Err(error) = store.save_settings(&settings) {
            self.notice = Some(format!("The settings could not be remembered: {error}").into());
        }
    }
}

impl Render for Shell {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        self.livery_before_drawing(cx);
        let theme = ActiveTheme::get(cx);
        // Only when it changes: setting a title is a round trip to the
        // window system.
        let unread = self.unread_total();
        if std::mem::replace(&mut self.titled_unread, unread) != unread {
            self.retitle(window);
        }
        let open = self.lightbox.is_some();
        if std::mem::replace(&mut self.panels.looked_large, open) && !open {
            crate::pictures::close_large(window, cx);
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
            .child(kit::backdrop(&theme.c.window, theme.c.bg0, px(0.0)))
            .when(theme.skin.band, |shell| {
                shell.child(band::render(self, &theme, window, cx))
            })
            .child(self.render_body(&theme, window, cx))
            .children(self.video_layer(cx))
            .children(stage::overlays(self, window, cx))
            .children(reconnect::banner(self, &theme, cx))
            .children(mover::render(self, &theme, cx))
            .children(welcome::render(self, &theme, window, cx))
            .children(links::render(self, &theme, cx))
            .children(toasts::render(self, &theme, cx))
            .when(!theme.skin.band, |shell| {
                shell.child(band::corner_controls(&theme, window))
            })
            .map(|shell| self.with_panels(shell, &theme, window, cx))
            .children(frame::resize_grips(window))
    }
}

impl Shell {
    /// The window's body under the band: the settings, the connect screen,
    /// or the server with its rail, channels and conversation.
    fn render_body(
        &self,
        theme: &crate::theme::Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        div().flex_1().min_h_0().flex().map(|body| {
            if self.panels.settings.open {
                // The settings take the window's body while they are
                // open; the band above stays what it was.
                body.child(settings::render(self, theme, cx))
            } else if self.shows_connect_screen() {
                // Not on a server, or adding one: the saved ones, and
                // the way onto one. The rail stays while there are
                // servers to go back to.
                body.when(!self.snapshot.sessions.is_empty() && self.rail_drawn(theme), |body| {
                    body.child(rail::render(self, theme, cx))
                })
                .child(connect::server_column(self, theme, cx))
                .child(connect::landing(self, theme, cx))
            } else {
                body.when(self.rail_drawn(theme), |body| body.child(rail::render(self, theme, cx)))
                    .when(!self.chrome.column_hidden, |body| {
                        body.child(sidebar::render(self, theme, cx))
                    })
                    .child(conversation::render(self, theme, window, cx))
            }
        })
    }

    /// Whether the rail is drawn: the servers are listed there, unless the
    /// user lists them only in the band, which a theme without a band
    /// cannot carry.
    pub(super) fn rail_drawn(&self, theme: &crate::theme::Theme) -> bool {
        self.panels.settings.server_switcher.rail() || !theme.skin.band
    }

    /// What floats over the window: the panels, dialogs, menus and cards
    /// that are open.
    fn with_panels(
        &self,
        shell: gpui::Div,
        theme: &crate::theme::Theme,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> gpui::Div {
        shell
            .when(self.picker_open, |shell| {
                shell.child(picker::render(self, theme, cx))
            })
            .when(self.devices_open, |shell| {
                shell.child(devices::render(self, theme, cx))
            })
            .when_some(self.panels.acl.as_ref(), |shell, panel| {
                shell.child(acl::render(self, panel, theme, cx))
            })
            .when_some(self.panels.admin.as_ref(), |shell, admin| {
                shell.child(admin::render(admin, theme, cx))
            })
            .when_some(self.panels.channel_form.as_ref(), |shell, form| {
                shell.child(channel_form::render(form, theme, cx))
            })
            .when_some(self.panels.later.as_ref(), |shell, panel| {
                shell.child(later::render(self, panel, theme, cx))
            })
            .when(self.panels.friends.open, |shell| {
                shell.child(friends::render(self, theme, cx))
            })
            .when(self.panels.certs.open, |shell| {
                shell.child(certificates::render(self, theme, cx))
            })
            .when_some(self.editor.as_ref(), |shell, editor| {
                shell.child(server_editor::render(editor, theme, cx))
            })
            .when(self.emoji_for.is_some(), |shell| {
                shell.child(emoji::render(self, theme, cx))
            })
            .children(gifs::render(self, theme, window, cx))
            .children(profile_page::render(self, theme, cx))
            // On the Profile page of the settings the editor is drawn in
            // the page, not over it.
            .children(
                (!self.about_on_settings_page())
                    .then(|| about_editor::render(self, theme, cx))
                    .flatten(),
            )
            .when_some(self.lightbox.as_ref(), |shell, picture| {
                shell.child(lightbox::render(self, picture, theme, window, cx))
            })
            .when_some(self.menu.as_ref(), |shell, menu| {
                shell.child(menu::render_menu(menu, theme, window, cx))
            })
            .when_some(self.prompt.as_ref(), |shell, prompt| {
                shell.child(menu::render_prompt(prompt, theme, cx))
            })
            .when_some(self.info.as_ref(), |shell, info| match info.subject {
                // Somebody's card is the same card rested on or kept; it is
                // put away when they leave.
                Subject::User(_) if !info.sheet => {
                    shell.children(card::render(self, info, theme, window, cx))
                }
                _ => shell.child(menu::render_info(self, info, theme, cx)),
            })
    }
}
