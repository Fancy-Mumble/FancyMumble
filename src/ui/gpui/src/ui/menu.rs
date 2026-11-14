//! The menus behind a right click on a user or a channel, and the small
//! dialog some of their entries need an answer from.

use gpui::{
    Context, Entity, IntoElement, ParentElement, Pixels, Point, SharedString, Styled, Subscription,
    Window, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Button, Dialog, Emphasis, MenuItem, Sheet, Tone, frame_radius, icon};
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, label};
use crate::engine::{
    Action, Channel, ChannelId, Connection, Conversation, Listing, Message, Session, Subject, User,
    WhisperTarget,
};
use crate::rights::{Right, Rights};
use crate::theme::Theme;
use crate::words::t;

/// The loudness steps a user can be played at, with what each is called.
const VOLUMES: &[(f32, &str)] = &[
    (0.0, "Mute here"),
    (0.5, "Volume 50%"),
    (1.0, "Volume 100%"),
    (1.5, "Volume 150%"),
];

/// What choosing a menu entry does.
#[derive(Debug, Clone, PartialEq)]
pub(super) enum Command {
    /// Ask the engine for something.
    Do(Action),
    /// Put a conversation on screen.
    Open(Conversation),
    /// Move into a channel.
    Join(ChannelId),
    /// Play a user at a loudness, here.
    Volume(Session, f32),
    /// Show what there is to read about a user or a channel.
    About(Subject),
    /// Needs an answer first.
    Ask(Question),
    /// Choose a picture file for the local user.
    PickAvatar,
    /// Choose one for the head of their card.
    PickBanner,
    /// Put a message in the composer as it was typed, to be changed.
    Edit {
        id: SharedString,
        html: SharedString,
    },
    /// Put text on the clipboard.
    Copy(SharedString),
    /// Answer the message at this place in the conversation.
    Reply(usize),
    /// Choose an emoji from the picker, to react to a message with.
    MoreReactions { channel: ChannelId, id: String },
    /// Leave the server of a session.
    Leave(SharedString),
    /// Open the permissions of a channel.
    Permissions(ChannelId),
    /// Whisper to somebody, or shout into a channel, with the whisper key.
    Whisper(WhisperTarget, SharedString),
    /// Open the administrator's panel on one of its lists.
    Admin(Listing),
    /// Open one of the view's own panels.
    Panel(Panel),
    /// Choose an emoji to put in the message being written.
    Emoji,
    /// Keep whoever is on this session as a friend, or stop.
    Friend(Session, bool),
    /// Leave channels with nobody in them out of the column, or list all.
    HideEmpty(bool),
    /// Start picking messages, with the one at this place picked.
    Select(usize),
    /// Start recording what is heard to a file, or stop.
    Record(bool),
    /// Mark the saved server at this address a favourite, or not.
    Favourite(SharedString, bool),
    /// Choose a channel to move somebody, or everybody somewhere, into.
    MoveTo(super::mover::Moved),
    /// Open the form a channel is made in, for one inside this channel.
    NewChannel(ChannelId),
    /// Put the server of a session on screen.
    Switch(SharedString),
    /// Change how the server at this address is saved.
    EditServer(SharedString),
    /// Open the share picker on its cameras.
    ShareCamera,
    /// Open the settings on what the user may look after first.
    Administer,
    /// Leave the server on screen, once asked.
    LeaveServer,
}

/// The panels the local user's own menu opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Panel {
    Settings,
    /// The messages waiting to be sent later.
    Later,
}

/// A question an entry puts before it can act.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Question {
    KickReason(Session),
    BanReason(Session),
    /// Whether to delete everything the server keeps of a channel,
    PurgeChannel(ChannelId),
    /// or what one user said in it.
    PurgeSender(ChannelId, Session),
    RenameChannel(ChannelId),
    DeleteChannel(ChannelId),
    JoinPassword(ChannelId),
    Comment,
    /// What a registered account is to be called.
    RenameRegistered(u32),
    /// The group a new rule of a channel's permissions is for.
    AclGroup(ChannelId),
    /// What is said about a channel, and the password it is entered with.
    DescribeChannel(ChannelId),
    ChannelPassword(ChannelId),
    /// A poll for a channel: one answer each, or several.
    NewPoll(ChannelId),
    NewPollSeveral(ChannelId),
    /// When the server is to send what is in the composer to a channel.
    SendLater(ChannelId),
    /// Whether to leave the server: a press beside the others on the rail
    /// is easily one that was not meant.
    Leave,
    /// Whether to give whoever is on this session an account here.
    Register(Session),
    /// Whether to take this account away, with what the server keeps for it.
    Deregister(u32),
}

impl Question {
    /// The dialog's title, the placeholder of its field (or `None` for a
    /// question that only wants a yes), and what the button says.
    fn wording(self) -> (&'static str, Option<&'static str>, &'static str) {
        match self {
            Self::KickReason(_) => ("Kick", Some("Reason, if you want to give one"), "Kick"),
            Self::BanReason(_) => ("Ban", Some("Reason, if you want to give one"), "Ban"),
            Self::PurgeChannel(_) => (
                "Delete every message kept of this channel, for everyone?",
                None,
                "Delete all",
            ),
            Self::PurgeSender(..) => (
                "Delete every message of theirs kept of this channel, for everyone?",
                None,
                "Delete theirs",
            ),
            Self::RenameChannel(_) => ("Rename channel", Some("Name"), "Rename"),
            Self::DeleteChannel(_) => ("Delete this channel and everything in it?", None, "Delete"),
            Self::JoinPassword(_) => ("Join with a password", Some("Password"), "Join"),
            Self::Comment => ("Your comment", Some("What others read about you"), "Save"),
            Self::RenameRegistered(_) => ("Rename this account", Some("Name"), "Rename"),
            Self::AclGroup(_) => (
                "A rule for which group?",
                Some("all, auth, in, sub, admin, or a group of this channel"),
                "Add",
            ),
            Self::DescribeChannel(_) => (
                "About this channel",
                Some("What it is for (Shift+Enter for a new line)"),
                "Save",
            ),
            Self::ChannelPassword(_) => (
                "Channel password",
                Some("Leave empty to let anybody in"),
                "Set",
            ),
            Self::Leave => ("Leave this server?", None, "Leave"),
            Self::Register(_) => (
                "Give them an account on this server? Their name is then theirs alone here.",
                None,
                "Register",
            ),
            Self::Deregister(_) => (
                "Take their account away? What the server keeps for it goes with it.",
                None,
                "Deregister",
            ),
            Self::SendLater(_) => (
                "Send what is written, later",
                Some("When: 18:30, or in 15m, 2h, 1d"),
                "Send later",
            ),
            Self::NewPoll(_) => (
                "New poll: choose one",
                Some("The question, then an answer on each line (Shift+Enter)"),
                "Ask",
            ),
            Self::NewPollSeveral(_) => (
                "New poll: choose any",
                Some("The question, then an answer on each line (Shift+Enter)"),
                "Ask",
            ),
        }
    }

    /// Whether the answer runs over several lines.
    fn takes_lines(self) -> bool {
        matches!(
            self,
            Self::NewPoll(_) | Self::NewPollSeveral(_) | Self::DescribeChannel(_)
        )
    }

    /// Whether the button is drawn as destructive.
    fn destructive(self) -> bool {
        matches!(
            self,
            Self::KickReason(_)
                | Self::BanReason(_)
                | Self::DeleteChannel(_)
                | Self::PurgeChannel(_)
                | Self::PurgeSender(..)
                | Self::Deregister(_)
        )
    }

    /// The action `answer` amounts to, or `None` when it is no answer: a
    /// channel needs a name.
    pub(super) fn answered(self, answer: &str) -> Option<Action> {
        let text = answer.trim().to_owned();
        Some(match self {
            Self::KickReason(session) => Action::Kick {
                session,
                reason: text,
            },
            Self::BanReason(session) => Action::Ban {
                session,
                reason: text,
            },
            Self::RenameChannel(channel) => Action::RenameChannel {
                channel,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            Self::DeleteChannel(channel) => Action::DeleteChannel { channel },
            Self::PurgeChannel(channel) => Action::Purge { channel, by: None },
            Self::Register(session) => Action::Register { session },
            Self::Deregister(id) => Action::Unregister { id },
            Self::PurgeSender(channel, session) => Action::Purge {
                channel,
                by: Some(session),
            },
            Self::JoinPassword(channel) => Action::JoinWithPassword {
                channel,
                password: answer.to_owned(),
            },
            Self::Comment => Action::SetComment(text),
            Self::RenameRegistered(id) => Action::RenameRegistered {
                id,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            // Answered into the permissions panel, not to the server.
            Self::AclGroup(_) | Self::SendLater(_) | Self::Leave => return None,
            Self::DescribeChannel(channel) => Action::DescribeChannel { channel, text },
            Self::ChannelPassword(channel) => Action::SetChannelPassword {
                channel,
                password: answer.to_owned(),
            },
            Self::NewPoll(channel) | Self::NewPollSeveral(channel) => {
                // The first line asks; each line after it is an answer,
                // and a poll with fewer than two is not one.
                let mut lines = answer
                    .lines()
                    .map(str::trim)
                    .filter(|line| !line.is_empty())
                    .map(str::to_owned);
                let question = lines.next()?;
                let options: Vec<String> = lines.collect();
                if options.len() < 2 {
                    return None;
                }
                Action::CreatePoll {
                    channel,
                    question,
                    options,
                    multiple: matches!(self, Self::NewPollSeveral(_)),
                }
            }
        })
    }
}

/// One entry of a menu.
#[derive(Debug, Clone, PartialEq)]
pub(super) struct Item {
    pub name: SharedString,
    pub command: Command,
    /// Drawn in the destructive colour.
    pub danger: bool,
    /// Drawn with a tick: the state it would set is the one in force.
    pub ticked: bool,
    /// The glyph it leads with, in the sheet over the dock.
    pub icon: Option<&'static str>,
    /// A line under its name, saying what it does.
    pub hint: Option<SharedString>,
    /// A switch at its end, showing the state it changes, in place of a
    /// tick.
    pub switch: Option<bool>,
    /// A chevron at its end: it opens somewhere else.
    pub chevron: bool,
    /// A rule above it, between it and the cluster before.
    pub rule: bool,
    /// What the tests call it, where its name is not that.
    pub selector: Option<SharedString>,
}

impl Item {
    fn new(name: &str, command: Command) -> Self {
        Self {
            name: name.to_owned().into(),
            command,
            danger: false,
            ticked: false,
            icon: None,
            hint: None,
            switch: None,
            chevron: false,
            rule: false,
            selector: None,
        }
    }

    fn icon(mut self, glyph: &'static str) -> Self {
        self.icon = Some(glyph);
        self
    }

    fn hint(mut self, hint: SharedString) -> Self {
        self.hint = Some(hint);
        self
    }

    fn switch(mut self, on: bool) -> Self {
        self.switch = Some(on);
        self
    }

    fn chevron(mut self) -> Self {
        self.chevron = true;
        self
    }

    fn rule(mut self, rule: bool) -> Self {
        self.rule = rule;
        self
    }

    fn selector(mut self, selector: &str) -> Self {
        self.selector = Some(selector.to_owned().into());
        self
    }

    fn danger(mut self) -> Self {
        self.danger = true;
        self
    }

    fn ticked(mut self, ticked: bool) -> Self {
        self.ticked = ticked;
        self
    }
}

/// An open menu.
#[derive(Debug)]
pub(super) struct Menu {
    /// Where the pointer was.
    pub at: Point<Pixels>,
    pub items: Vec<Item>,
    /// Entries drawn side by side above the others: the quick reactions.
    /// Counted after `items` by [`Shell::choose`].
    pub quick: Vec<Item>,
    /// A head over the entries: a name, and a line under it.
    pub head: Option<(SharedString, SharedString)>,
    /// Where the menu is a sheet grown out of something: as wide as it, and
    /// standing on its top edge, as the web UI's sheet over the dock does.
    pub over: Option<gpui::Bounds<Pixels>>,
}

/// The emoji a message's menu offers at a click.
pub(super) const QUICK_REACTIONS: &[&str] = &["👍", "❤️", "😂", "😮", "😢", "🎉"];

/// The entries for a right click on `message` in `channel`: the quick
/// reactions, and the rest.
///
/// `fancy` is whether the server can change messages at all; on one that
/// cannot, a message can only be copied. `kept` is whether the channel's
/// messages are stored: only a stored message can be deleted for everyone.
pub(super) fn message_items(
    message: &Message,
    index: usize,
    channel: Option<ChannelId>,
    fancy: bool,
    kept: bool,
    moderates: bool,
) -> (Vec<Item>, Vec<Item>) {
    let mut items = vec![Item::new("Copy text", Command::Copy(message.body.clone()))];
    // A reply names a message by its id, which only a Fancy server gives.
    if fancy && message.id.is_some() {
        items.insert(0, Item::new("Reply", Command::Reply(index)));
    }
    let (Some(channel), Some(id), true) = (channel, message.id.as_ref(), fancy) else {
        return (items, Vec::new());
    };
    let quick: Vec<Item> = QUICK_REACTIONS
        .iter()
        .map(|emoji| {
            let own = message
                .reactions
                .iter()
                .any(|reaction| reaction.own && reaction.emoji.as_ref() == *emoji);
            Item::new(
                emoji,
                Command::Do(Action::React {
                    channel,
                    id: id.to_string(),
                    emoji: (*emoji).to_owned(),
                    add: !own,
                }),
            )
            .ticked(own)
        })
        // The last of them opens the picker, for the rest.
        .chain([Item::new(
            "…",
            Command::MoreReactions {
                channel,
                id: id.to_string(),
            },
        )])
        .collect();
    if kept {
        items.push(Item::new(
            if message.pinned { "Unpin" } else { "Pin" },
            Command::Do(Action::Pin {
                channel,
                id: id.to_string(),
                pinned: !message.pinned,
            }),
        ));
    }
    if moderates {
        // The way to more than one at a time: to delete them together.
        items.push(Item::new("Select…", Command::Select(index)));
    }
    if message.own {
        items.push(Item::new(
            "Edit",
            Command::Edit {
                id: id.clone(),
                html: message.html.clone(),
            },
        ));
    }
    // One's own is one's own to take back wherever it landed; anybody
    // else's takes the right to.
    if message.own || moderates {
        items.push(
            Item::new(
                "Delete",
                Command::Do(Action::DeleteMessage {
                    channel,
                    id: id.to_string(),
                }),
            )
            .danger(),
        );
    }
    (items, quick)
}

impl Shell {
    /// Open the menu of what can be done with, or to, the user `session`,
    /// at `at`. It is the same menu wherever somebody is right-clicked: the
    /// channel list, the member panel, beside a message.
    pub(super) fn open_user_menu(
        &mut self,
        session: Session,
        at: Point<Pixels>,
        cx: &mut Context<Self>,
    ) {
        let Some(user) = self.snapshot.users.iter().find(|u| u.session == session) else {
            return;
        };
        let mut items = user_items(
            user,
            self.snapshot.own_session,
            self.snapshot.current_channel,
            self.volumes.get(&session).copied().unwrap_or(1.0),
            self.whisper_target(),
            user.hash.as_ref().is_some_and(|hash| self.is_friend(hash)),
            Over::of(user, &self.snapshot.channels),
        );
        let open = match self.open {
            Some(Conversation::Channel(id)) => self.snapshot.channels.iter().find(|c| c.id == id),
            _ => None,
        };
        if self.snapshot.own_session != Some(session) {
            items.extend(purge_item(user, open));
        }
        self.open_menu(at, items, cx);
    }
}

/// The entries for a right click on `user`.
///
/// `own` is the local user's session, `own_channel` the channel they are
/// in, and `volume` how loud `user` is played here.
pub(super) fn user_items(
    user: &User,
    own: Option<Session>,
    own_channel: Option<ChannelId>,
    volume: f32,
    whispered_to: Option<WhisperTarget>,
    friend: bool,
    over: Over,
) -> Vec<Item> {
    let session = user.session;
    if own == Some(session) {
        let mut items = vec![
            Item::new("Set comment…", Command::Ask(Question::Comment)),
            Item::new("Change picture…", Command::PickAvatar),
            Item::new("Remove picture", Command::Do(Action::SetAvatar(Vec::new()))),
            Item::new("Change banner…", Command::PickBanner),
            Item::new("Remove banner", Command::Do(Action::SetBanner(Vec::new()))),
        ];
        // Where the server lets people register themselves, and they have not.
        if user.account.is_none() && over.root.has(Right::SELF_REGISTER) {
            items.push(Item::new(
                "Register on this server",
                Command::Do(Action::Register { session }),
            ));
        }
        return items;
    }
    let mut items = vec![
        Item::new("Message", Command::Open(Conversation::Direct(session))),
        // What the server knows of them; their card is a click on them.
        Item::new("User information", Command::About(Subject::User(session))),
        Item::new(
            "Whisper with the whisper key",
            Command::Whisper(WhisperTarget::User(session), user.name.clone()),
        )
        .ticked(whispered_to == Some(WhisperTarget::User(session))),
    ];
    // Where they are, for whoever is somewhere else.
    if own_channel.is_some_and(|channel| channel != user.channel) {
        items.push(Item::new("Join their channel", Command::Join(user.channel)));
    }
    // Somebody with a certificate can be found again on any server.
    if user.hash.is_some() {
        items.push(if friend {
            Item::new("Remove from friends", Command::Friend(session, false))
        } else {
            Item::new("Add to friends", Command::Friend(session, true))
        });
    }
    items.extend(VOLUMES.iter().map(|(level, name)| {
        Item::new(name, Command::Volume(session, *level)).ticked((volume - level).abs() < 0.01)
    }));
    items.extend(moderation(user, own_channel, over));
    items
}

/// What the server lets the local user do to somebody else: nothing it
/// would refuse is offered. Muting and moving are decided by the channel
/// they are in, the rest by the root.
fn moderation(user: &User, own_channel: Option<ChannelId>, over: Over) -> Vec<Item> {
    let session = user.session;
    let mut items = Vec::new();
    let elsewhere = own_channel.filter(|channel| *channel != user.channel);
    if let Some(channel) = elsewhere.filter(|_| over.there.has(Right::MOVE)) {
        items.push(Item::new(
            "Move to my channel",
            Command::Do(Action::MoveUser { session, channel }),
        ));
    }
    if over.there.has(Right::MOVE) {
        items.push(Item::new(
            "Move to…",
            Command::MoveTo(super::mover::Moved::User(session)),
        ));
    }
    if over.there.has(Right::MUTE_DEAFEN) {
        items.extend(voice_moderation(user));
    }
    // An account is given, or taken away with everything the server keeps
    // for it: asked about first either way. The first account is the
    // server's own, and is not anybody's to take away.
    match user.account {
        None if over.root.has(Right::REGISTER) => {
            items.push(Item::new(
                "Register…",
                Command::Ask(Question::Register(session)),
            ));
        }
        Some(account) if over.root.has(Right::REGISTER) && account != 0 => {
            items.push(
                Item::new("Deregister…", Command::Ask(Question::Deregister(account))).danger(),
            );
        }
        _ => {}
    }
    if over.root.has(Right::RESET_CONTENT) {
        items.push(Item::new(
            "Reset their comment",
            Command::Do(Action::ResetComment { session }),
        ));
        items.push(Item::new(
            "Remove their picture",
            Command::Do(Action::RemovePicture { session }),
        ));
    }
    if over.root.has(Right::KICK) {
        items.push(Item::new("Kick…", Command::Ask(Question::KickReason(session))).danger());
    }
    if over.root.has(Right::BAN) {
        items.push(Item::new("Ban…", Command::Ask(Question::BanReason(session))).danger());
    }
    items
}

/// Raising somebody over the others, and muting or deafening them for
/// everybody.
fn voice_moderation(user: &User) -> [Item; 3] {
    let session = user.session;
    [
        Item::new(
            "Priority speaker",
            Command::Do(Action::PrioritySpeaker {
                session,
                priority: !user.priority,
            }),
        )
        .ticked(user.priority),
        // What the server did, the server can undo. Somebody who muted
        // themselves is not unmuted by anybody else.
        Item::new(
            if user.server_muted {
                "Unmute for everyone"
            } else {
                "Mute for everyone"
            },
            Command::Do(Action::ServerMute {
                session,
                muted: !user.server_muted,
            }),
        ),
        Item::new(
            if user.server_deafened {
                "Undeafen for everyone"
            } else {
                "Deafen for everyone"
            },
            Command::Do(Action::ServerDeafen {
                session,
                deafened: !user.server_deafened,
            }),
        ),
    ]
}

/// What the server lets the local user do to somebody: by the channel
/// they are in, and by the root for what is the whole server's.
#[derive(Debug, Clone, Copy)]
pub(super) struct Over {
    /// In the channel they are in.
    pub(super) there: Rights,
    /// At the root.
    pub(super) root: Rights,
}

impl Over {
    /// What the local user may do to `user`, by what `channels` say.
    pub(super) fn of(user: &User, channels: &[Channel]) -> Self {
        let rights = |wanted: &dyn Fn(&Channel) -> bool| {
            channels
                .iter()
                .find(|channel| wanted(channel))
                .map(|channel| channel.rights)
                .unwrap_or_default()
        };
        Self {
            there: rights(&|channel| channel.id == user.channel),
            root: rights(&|channel| channel.parent.is_none()),
        }
    }
}

/// The entries for a right click on `channel`. `fancy` is whether the
/// server can keep a channel's messages.
pub(super) fn channel_items(
    channel: &Channel,
    own_channel: Option<ChannelId>,
    fancy: bool,
    whispered_to: Option<WhisperTarget>,
) -> Vec<Item> {
    let id = channel.id;
    let mut items = vec![Item::new("Open", Command::Open(Conversation::Channel(id)))];
    let rights = channel.rights;
    if own_channel != Some(id) {
        items.push(Item::new("Join", Command::Join(id)));
        // A room marked as behind a password asks for it by itself.
        if !channel.restricted {
            items.push(Item::new(
                "Join with a password…",
                Command::Ask(Question::JoinPassword(id)),
            ));
        }
    }
    if own_channel != Some(id) {
        items.push(
            Item::new(
                "Listen without joining",
                Command::Do(Action::ToggleListen { channel: id }),
            )
            .ticked(channel.listening),
        );
    }
    items.push(
        Item::new(
            "Shout here with the whisper key",
            Command::Whisper(
                WhisperTarget::Channel(id),
                format!("#{}", channel.name).into(),
            ),
        )
        .ticked(whispered_to == Some(WhisperTarget::Channel(id))),
    );
    items.push(Item::new(
        "About this channel",
        Command::About(Subject::Channel(id)),
    ));
    // One form makes a channel of any kind; what it offers follows what
    // may be made here.
    if rights.has(Right::MAKE_CHANNEL) || rights.has(Right::MAKE_TEMPORARY) {
        items.push(Item::new("New channel inside…", Command::NewChannel(id)));
    }
    // Everybody in the user's own channel can be brought along.
    if let Some(from) = own_channel.filter(|own| *own != id && rights.has(Right::MOVE)) {
        items.push(Item::new(
            "Move everyone with me here",
            Command::Do(Action::MoveEveryone { from, to: id }),
        ));
    }
    if fancy {
        items.push(Item::new(
            "New poll: choose one…",
            Command::Ask(Question::NewPoll(id)),
        ));
        items.push(Item::new(
            "New poll: choose any…",
            Command::Ask(Question::NewPollSeveral(id)),
        ));
    }
    if rights.has(Right::MOVE) {
        items.push(Item::new(
            "Move everyone in here to…",
            Command::MoveTo(super::mover::Moved::Everyone(id)),
        ));
    }
    items.extend(administration(channel));
    items
}

/// The entries that change `channel` itself, for whoever the server lets.
fn administration(channel: &Channel) -> Vec<Item> {
    let id = channel.id;
    let mut items = Vec::new();
    // Offered until the server has said otherwise, as the web UI does: a
    // refusal then explains itself, where a missing entry would not.
    if channel.rights.may(Right::WRITE) {
        items.extend([
            Item::new("Rename…", Command::Ask(Question::RenameChannel(id))),
            Item::new("Describe…", Command::Ask(Question::DescribeChannel(id))),
            Item::new(
                "Set a password…",
                Command::Ask(Question::ChannelPassword(id)),
            ),
            Item::new("Permissions…", Command::Permissions(id)),
        ]);
    }
    if channel.moderated() {
        items.push(
            Item::new(
                "Delete all messages…",
                Command::Ask(Question::PurgeChannel(id)),
            )
            .danger(),
        );
    }
    // The root cannot be deleted; a server would only refuse.
    if channel.parent.is_some() && channel.rights.has(Right::WRITE) {
        items.push(Item::new("Delete…", Command::Ask(Question::DeleteChannel(id))).danger());
    }
    items
}

/// The entries for a right click on a server's tile on the rail.
/// `showing` is what the user may do at its root, if it is the server on
/// screen: the lists are offered to whoever may read them. `saved` is its
/// address and whether it is a favourite, if it is a saved server.
pub(super) fn session_items(
    id: &SharedString,
    showing: Option<Rights>,
    saved: Option<(&SharedString, bool)>,
) -> Vec<Item> {
    let mut items = Vec::new();
    if showing.is_none() {
        items.push(Item::new("Switch to", Command::Switch(id.clone())));
    }
    if let Some(root) = showing {
        items.push(Item::new(
            "Server information",
            Command::About(Subject::Server),
        ));
        if root.has(Right::BAN) {
            items.push(Item::new("Bans…", Command::Admin(Listing::Bans)));
        }
        if root.has(Right::REGISTER) {
            items.push(Item::new(
                "Registered users…",
                Command::Admin(Listing::Registered),
            ));
        }
    }
    // What is known of it as a saved server, where it is one.
    if let Some((key, favorite)) = saved {
        items.extend([
            Item::new("Favourite", Command::Favourite(key.clone(), !favorite)).ticked(favorite),
            Item::new(
                "Copy address",
                Command::Copy(format!("mumble://{key}").into()),
            ),
            Item::new("Edit…", Command::EditServer(key.clone())),
        ]);
    }
    items.push(Item::new("Disconnect", Command::Leave(id.clone())).danger());
    items
}

/// For a moderator: delete what `user` said in the channel on screen, where
/// the server keeps that channel's messages and knows the user by a
/// certificate.
pub(super) fn purge_item(user: &User, open: Option<&Channel>) -> Option<Item> {
    let channel = open.filter(|channel| channel.moderated() && user.hash.is_some())?;
    Some(
        Item::new(
            "Delete their messages here…",
            Command::Ask(Question::PurgeSender(channel.id, user.session)),
        )
        .danger(),
    )
}

/// The entries for a right click on a saved server: whether it is a
/// favourite, and its address to hand to somebody.
pub(super) fn saved_server_items(key: &str, host: &str, port: u16, favorite: bool) -> Vec<Item> {
    vec![
        Item::new(
            "Favourite",
            Command::Favourite(key.to_owned().into(), !favorite),
        )
        .ticked(favorite),
        Item::new(
            "Copy address",
            Command::Copy(format!("mumble://{host}:{port}").into()),
        ),
    ]
}

impl Shell {
    /// The sheet over the user's own dock, as the web UI's `VoiceDock` has
    /// it: the server's head; the camera; the column's filter, the settings
    /// and what the user may look after; recording; and the way off the
    /// server.
    pub(super) fn own_sheet(&self) -> (Vec<Item>, (SharedString, SharedString)) {
        let connected = self.snapshot.connection == Connection::Connected;
        let in_channel = connected && self.snapshot.current_channel.is_some();
        let hidden = self.chrome.hide_empty;
        let recording = self.engine.is_recording();
        let mut items = Vec::new();
        // Only where there is a channel to show it in.
        if in_channel {
            items.push(Item::new(&t!("Share your camera"), Command::ShareCamera).icon("webcam"));
        }
        items.push(
            Item::new(&t!("Hide empty channels"), Command::HideEmpty(!hidden))
                .icon("user-x")
                .hint(t!("Channels you can't post in stay collapsed"))
                .switch(hidden)
                .rule(in_channel),
        );
        items.push(
            Item::new(&t!("Settings"), Command::Panel(Panel::Settings))
                .icon("settings")
                .chevron(),
        );
        if self.may_administer() {
            items.push(
                Item::new(&t!("Server admin"), Command::Administer)
                    .icon("shield")
                    .chevron(),
            );
        }
        // The web UI offers it in developer mode; here it is always there,
        // where the web UI puts it.
        let record = if recording {
            Item::new(&t!("Recording"), Command::Record(false)).danger()
        } else {
            Item::new(&t!("Record audio"), Command::Record(true))
        };
        items.push(record.icon("circle-dot").selector("menu-record"));
        if connected {
            items.push(
                Item::new(&t!("Leave server"), Command::LeaveServer)
                    .icon("log-out")
                    .danger()
                    .rule(true),
            );
        }
        let server = self
            .snapshot
            .sessions
            .iter()
            .find(|session| session.active)
            .map(|session| session.name.clone())
            .unwrap_or_default();
        (items, (server, t!("Server & app options")))
    }

    /// Open the sheet over the user's own dock.
    pub(super) fn open_own_sheet(&mut self, cx: &mut Context<Self>) {
        let Some(over) = self.chrome.dock.get() else {
            return;
        };
        let (items, head) = self.own_sheet();
        self.menu = Some(Menu {
            at: over.origin,
            items,
            quick: Vec::new(),
            head: Some(head),
            over: Some(over),
        });
        cx.notify();
    }
}

/// What else there is to put in a message, beside the composer's paperclip:
/// an emoji anywhere, a poll in a channel.
pub(super) fn compose_items(open: Option<Conversation>, fancy: bool) -> Vec<Item> {
    let mut items = vec![Item::new("Emoji…", Command::Emoji)];
    // Only a server that keeps messages can hold one back.
    if let (Some(Conversation::Channel(channel)), true) = (open, fancy) {
        items.push(Item::new(
            "Send later…",
            Command::Ask(Question::SendLater(channel)),
        ));
        items.push(Item::new("Messages waiting…", Command::Panel(Panel::Later)));
    }
    if let Some(Conversation::Channel(channel)) = open {
        items.push(Item::new("Poll…", Command::Ask(Question::NewPoll(channel))));
        items.push(Item::new(
            "Poll with several answers…",
            Command::Ask(Question::NewPollSeveral(channel)),
        ));
    }
    items
}

/// The dialog a [`Question`] is put in.
pub(super) struct Prompt {
    question: Question,
    /// The field, for a question that wants more than a yes.
    input: Option<Entity<TextInput>>,
    /// What whoever answers ought to know first.
    pub(super) caution: Option<SharedString>,
    _subscription: Option<Subscription>,
}

impl Prompt {
    /// What is in the dialog's field, if it has one.
    #[cfg(test)]
    pub(super) fn field_text(&self, cx: &gpui::App) -> Option<String> {
        self.input
            .as_ref()
            .map(|input| input.read(cx).text().to_owned())
    }
}

/// The largest picture file this will read, before it is scaled down.
const MAX_PICTURE_FILE: u64 = 20 * 1024 * 1024;
impl Shell {
    pub(super) fn open_menu(
        &mut self,
        at: Point<Pixels>,
        items: Vec<Item>,
        cx: &mut Context<Self>,
    ) {
        self.menu = Some(Menu {
            at,
            items,
            quick: Vec::new(),
            head: None,
            over: None,
        });
        cx.notify();
    }

    /// Open the menu of the message at `index` of the open conversation.
    /// The menu of the channel `id`, at `at`.
    pub(super) fn open_channel_menu(
        &mut self,
        id: ChannelId,
        at: Point<Pixels>,
        cx: &mut Context<Self>,
    ) {
        let Some(channel) = self.snapshot.channels.iter().find(|c| c.id == id) else {
            return;
        };
        let mut items = channel_items(
            channel,
            self.snapshot.current_channel,
            self.snapshot.fancy,
            self.whisper_target(),
        );
        // About the list, not this channel, and so the last of them: where
        // the web UI's channel menu has it too.
        let hidden = self.chrome.hide_empty;
        items.push(Item::new("Hide empty channels", Command::HideEmpty(!hidden)).ticked(hidden));
        self.open_menu(at, items, cx);
    }

    pub(super) fn open_message_menu(
        &mut self,
        at: Point<Pixels>,
        index: usize,
        cx: &mut Context<Self>,
    ) {
        let Some((items, quick)) = self.message_entries(index) else {
            return;
        };
        self.menu = Some(Menu {
            at,
            items,
            quick,
            head: None,
            over: None,
        });
        cx.notify();
    }

    /// What may be done to the message at `index` of the open
    /// conversation: the entries of its menu, and the quick reactions.
    pub(super) fn message_entries(&self, index: usize) -> Option<(Vec<Item>, Vec<Item>)> {
        let message = self.messages.get(index)?;
        let channel = match self.open {
            Some(Conversation::Channel(channel)) => Some(channel),
            _ => None,
        };
        let known = channel.and_then(|id| self.snapshot.channels.iter().find(|c| c.id == id));
        let kept = known.is_some_and(|channel| channel.history);
        let moderates = known.is_some_and(Channel::moderated);
        Some(message_items(
            message,
            index,
            channel,
            self.snapshot.fancy,
            kept,
            moderates,
        ))
    }

    /// The description asked for when its editor opened has arrived: put
    /// it in the field, unless something was typed there meanwhile.
    pub(super) fn fill_description(
        &mut self,
        subject: Subject,
        html: Option<&str>,
        cx: &mut Context<Self>,
    ) {
        let Some(prompt) = self.prompt.as_ref().filter(|prompt| {
            matches!(prompt.question, Question::DescribeChannel(id) if Subject::Channel(id) == subject)
        }) else {
            return;
        };
        let (Some(input), Some(html)) = (prompt.input.as_ref(), html) else {
            return;
        };
        input.update(cx, |input, cx| {
            if input.text().is_empty() {
                input.set_text(crate::rich::Rich::parse(html).text);
                cx.notify();
            }
        });
    }

    /// Do what the menu entry `index` says, and close the menu.
    pub(super) fn choose(&mut self, index: usize, window: &mut Window, cx: &mut Context<Self>) {
        let Some(item) = self.menu.take().and_then(|mut menu| {
            // The quick entries are counted on from the others.
            let listed = menu.items.len();
            if index < listed {
                Some(menu.items.swap_remove(index))
            } else {
                (index - listed < menu.quick.len()).then(|| menu.quick.swap_remove(index - listed))
            }
        }) else {
            return;
        };
        self.run(item.command, window, cx);
    }

    /// Do what `command` says: a menu's entry, or a button that stands for
    /// one.
    pub(super) fn run(&mut self, command: Command, window: &mut Window, cx: &mut Context<Self>) {
        match command {
            Command::Do(action) => self.engine.act(action),
            Command::Open(conversation) => self.open_conversation(conversation, cx),
            Command::Join(channel) => {
                let _ = self.enter(channel, window, cx);
            }
            Command::Volume(session, volume) => self.set_volume(session, volume, cx),
            Command::About(subject) => {
                self.show_about(subject, cx);
                if let Some(info) = self.info.as_mut() {
                    info.sheet = true;
                }
            }
            Command::Ask(question) => self.ask(question, window, cx),
            Command::PickAvatar => self.pick_avatar(cx),
            Command::PickBanner => self.pick_banner(cx),
            Command::Edit { id, html } => {
                // As it was typed, marks and all: starting from the bare
                // words would send it back without its emphasis.
                // One held without its pictures is changed as it is whole.
                let whole = self
                    .open
                    .filter(|_| crate::away::is_light(&html))
                    .and_then(|open| self.engine.whole(open, &id));
                let typed = self.engine.source(whole.as_deref().unwrap_or(&html));
                self.start_editing(id, &typed, window, cx);
            }
            Command::Leave(session) => self.engine.leave_session(&session),
            Command::Permissions(channel) => self.open_acl(channel, cx),
            Command::Whisper(target, name) => self.toggle_whisper_target(target, name, cx),
            Command::Admin(listing) => self.open_admin(listing, cx),
            Command::Friend(session, keep) => self.set_friend(session, keep, cx),
            Command::Favourite(key, favorite) => self.set_favourite(&key, favorite, cx),
            Command::MoveTo(moved) => self.ask_where_to_move(moved, window, cx),
            Command::NewChannel(parent) => self.open_channel_form(parent, window, cx),
            Command::Switch(session) => {
                self.adding_server = false;
                self.engine.activate_session(&session);
            }
            Command::ShareCamera => {
                self.open_share_picker(cx);
                if let Some(picker) = self.stage.picker.as_mut() {
                    picker.tab = crate::share::SourceKind::Device;
                }
            }
            Command::Administer => self.administer(cx),
            Command::LeaveServer => self.ask_to_leave(window, cx),
            Command::EditServer(key) => {
                let saved = self
                    .servers
                    .iter()
                    .find(|server| format!("{}:{}", server.host, server.port) == key.as_ref())
                    .cloned();
                if saved.is_some() {
                    self.open_editor(saved, None, window, cx);
                }
            }
            Command::Select(index) => self.start_picking(index, cx),
            Command::Record(start) => self.record(start, cx),
            Command::HideEmpty(hide) => self.set_hide_empty(hide, cx),
            Command::Emoji => self.open_emoji(super::emoji::For::Composer, Some(window), cx),
            Command::Panel(Panel::Later) => self.open_later(cx),
            Command::Panel(Panel::Settings) => self.open_settings(cx),
            Command::Reply(index) => self.start_replying(index, window, cx),
            Command::MoreReactions { channel, id } => {
                let purpose = super::emoji::For::Reaction { channel, id };
                self.open_emoji(purpose, Some(window), cx);
            }
            Command::Copy(text) => {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()));
                self.toast("Copied", super::toasts::Kind::Told, cx);
            }
        }
        cx.notify();
    }

    /// Ask what the registered account `id` is to be called.
    pub(super) fn ask_to_rename_registered(
        &mut self,
        id: u32,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ask(Question::RenameRegistered(id), window, cx);
    }

    /// Ask for the password of `channel`, to move into it.
    pub(super) fn ask_join_password(
        &mut self,
        channel: ChannelId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ask(Question::JoinPassword(channel), window, cx);
    }

    /// Ask whether to leave the server.
    pub(super) fn ask_to_leave(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        // Unless the user asked not to be asked (Settings, Advanced).
        if !self.panels.settings.disconnect_warning {
            self.engine.disconnect();
            return;
        }
        self.ask(Question::Leave, window, cx);
    }

    /// Ask which group a new rule of `channel`'s permissions is for.
    pub(super) fn ask_for_acl_group(
        &mut self,
        channel: ChannelId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.ask(Question::AclGroup(channel), window, cx);
    }

    /// Open the dialog for `question`.
    fn ask(&mut self, question: Question, window: &mut Window, cx: &mut Context<Self>) {
        let (_, placeholder, _) = question.wording();
        let input = placeholder.map(|placeholder| {
            let input = cx.new(|cx| {
                let mut input = TextInput::new(placeholder, cx);
                if matches!(
                    question,
                    Question::JoinPassword(_) | Question::ChannelPassword(_)
                ) {
                    input = input.obscured();
                }
                if question.takes_lines() {
                    input = input.multiline();
                }
                // A rename starts from the name there is.
                if let Question::RenameChannel(id) = question
                    && let Some(channel) = self.snapshot.channels.iter().find(|c| c.id == id)
                {
                    input.set_text(channel.name.to_string());
                }
                input
            });
            window.focus(&input.focus_handle(cx), cx);
            // A description starts from the one there is, which has to be
            // asked for: it is not sent with the tree.
            if let Question::DescribeChannel(id) = question {
                self.engine.about(Subject::Channel(id));
            }
            input
        });
        let subscription = input.as_ref().map(|input| {
            cx.subscribe(input, |shell, _, event, cx| match event {
                InputEvent::Submitted(_) => shell.answer_prompt(cx),
                InputEvent::Cancelled => shell.close_prompt(cx),
                InputEvent::Changed
                | InputEvent::Tabbed { .. }
                | InputEvent::PastedPicture(_)
                | InputEvent::Pick(_) => {}
            })
        });
        self.prompt = Some(Prompt {
            caution: self.caution_for(&question),
            question,
            input,
            _subscription: subscription,
        });
        cx.notify();
    }

    /// What whoever answers `question` ought to know first: a message that
    /// waits to be sent waits with the server as it was written, also
    /// where what is said is sealed from the server.
    fn caution_for(&self, question: &Question) -> Option<SharedString> {
        let Question::SendLater(channel) = question else {
            return None;
        };
        let known = self.snapshot.channels.iter().find(|c| c.id == *channel)?;
        (known.encrypted || known.signal).then(|| {
            "Messages here are sealed from the server. One that waits to be sent is not:              the server keeps it as written until then."
                .into()
        })
    }

    pub(super) fn close_prompt(&mut self, cx: &mut Context<Self>) {
        self.prompt = None;
        cx.notify();
    }

    /// Act on the dialog's answer. An answer that is none (a channel with
    /// no name) leaves the dialog open.
    pub(super) fn answer_prompt(&mut self, cx: &mut Context<Self>) {
        let Some(prompt) = &self.prompt else { return };
        let answer = prompt
            .input
            .as_ref()
            .map(|input| input.read(cx).text().to_owned())
            .unwrap_or_default();
        if matches!(prompt.question, Question::AclGroup(_)) {
            self.prompt = None;
            self.add_acl_rule(&answer, cx);
        } else if let Question::SendLater(channel) = prompt.question {
            // An answer that names no time leaves the question open.
            if self.send_later(channel, &answer, cx) {
                self.prompt = None;
            }
        } else if matches!(prompt.question, Question::Leave) {
            self.prompt = None;
            self.engine.disconnect();
        } else if let Some(action) = prompt.question.answered(&answer) {
            self.engine.act(action);
            self.prompt = None;
        }
        cx.notify();
    }

    /// Let the user choose a picture file, and make it their avatar.
    fn pick_avatar(&mut self, cx: &mut Context<Self>) {
        self.pick_picture(cx, crate::picture::avatar, |shell, avatar, _| {
            shell.engine.act(Action::SetAvatar(avatar));
        });
    }

    /// Let the user choose a picture file, and put it behind every
    /// conversation.
    pub(super) fn pick_wall(&mut self, cx: &mut Context<Self>) {
        self.pick_picture(cx, crate::picture::wallpaper, |shell, wall, cx| {
            shell.set_wall(Some(wall), cx);
        });
    }

    /// Let the user choose a picture file, and put it across the head of
    /// their card.
    fn pick_banner(&mut self, cx: &mut Context<Self>) {
        self.pick_picture(cx, crate::picture::banner, |shell, banner, _| {
            shell.engine.act(Action::SetBanner(banner));
        });
    }

    /// Choose a file to send to the open conversation. A picture goes in
    /// the message itself, which every server and client takes; anything
    /// else is shared as a file, where the server keeps files.
    pub(super) fn pick_file_to_send(&mut self, cx: &mut Context<Self>) {
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: true,
            prompt: Some("Choose files to send".into()),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else {
                return;
            };
            // They wait above the composer, and go out with the message.
            let _ = shell.update(cx, |shell, cx| shell.stage_files(paths, cx));
        })
        .detach();
    }

    /// Start recording what is heard, into a folder the user chooses, or
    /// stop the recording that is running.
    fn record(&mut self, start: bool, cx: &mut Context<Self>) {
        if !start {
            self.engine.record(None);
            return;
        }
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: false,
            directories: true,
            multiple: false,
            prompt: Some("Choose a folder to record into".into()),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(mut folders))) = chosen.await else {
                return;
            };
            let Some(folder) = folders.pop() else { return };
            let _ = shell.update(cx, |shell, _| shell.engine.record(Some(folder)));
        })
        .detach();
    }

    /// Send the files at `paths` to the open conversation, in order: each
    /// picture in a message of its own, anything else shared as a file.
    pub(super) fn send_files(&mut self, paths: Vec<std::path::PathBuf>, cx: &mut Context<Self>) {
        let Some(conversation) = self.open else {
            return;
        };
        cx.spawn(async move |shell, cx| {
            for path in paths {
                // Only a picture is read here, and off the view's thread;
                // a file is read by whoever uploads it, a piece at a time.
                let read = path.clone();
                let picture = cx
                    .background_executor()
                    .spawn(async move { crate::picture::at(&read) })
                    .await;
                let sent = shell.update(cx, |shell, _| match picture {
                    Some(picture) => shell.engine.send_picture(conversation, picture),
                    None => shell.engine.send_file(conversation, path),
                });
                if sent.is_err() {
                    return;
                }
            }
        })
        .detach();
    }

    /// Ask where to, and save the shared file kept under `key` there.
    pub(super) fn save_attachment(
        &mut self,
        key: SharedString,
        name: &str,
        cx: &mut Context<Self>,
    ) {
        let home = std::env::var_os("HOME").map_or_else(std::env::temp_dir, Into::into);
        let chosen = cx.prompt_for_new_path(&home, Some(name));
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(to))) = chosen.await else {
                return;
            };
            let _ = shell.update(cx, |shell, _| shell.engine.save_file(key, to));
        })
        .detach();
    }

    /// Ask for a picture file, read it and put it through `prepare` on
    /// another thread, and hand what comes out to `then`.
    pub(super) fn pick_picture(
        &mut self,
        cx: &mut Context<Self>,
        prepare: fn(&[u8]) -> Result<Vec<u8>, String>,
        then: fn(&mut Self, Vec<u8>, &mut Context<Self>),
    ) {
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose a picture".into()),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else {
                return;
            };
            let Some(path) = paths.into_iter().next() else {
                return;
            };
            // Reading and scaling a picture is work for another thread.
            let made = cx
                .background_executor()
                .spawn(async move {
                    let size = std::fs::metadata(&path).map_err(|e| e.to_string())?.len();
                    if size > MAX_PICTURE_FILE {
                        return Err("That picture file is too large.".to_owned());
                    }
                    prepare(&std::fs::read(&path).map_err(|e| e.to_string())?)
                })
                .await;
            let _ = shell.update(cx, |shell, cx| {
                match made {
                    Ok(picture) => then(shell, picture, cx),
                    Err(problem) => shell.notice = Some(problem.into()),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

/// The entries drawn side by side above a menu's others: the reactions at
/// a click. They are counted on from the others by [`Shell::choose`].
fn quick_row(menu: &Menu, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    const QUICK: f32 = 34.0;
    let hover = theme.c.hover;
    let listed = menu.items.len();
    div()
        .flex()
        .justify_between()
        .pb(px(6.0))
        .children(menu.quick.iter().enumerate().map(|(at, item)| {
            let tag = item.name.clone();
            div()
                .id(("menu-quick", at))
                .debug_selector(move || format!("react-{tag}"))
                .size(px(QUICK))
                .flex()
                .items_center()
                .justify_center()
                .rounded(theme.skin.radius_md)
                .cursor_pointer()
                .text_size(px(18.0))
                .when(item.ticked, |tile| tile.bg(theme.c.accent_soft))
                .hover(move |style| style.bg(hover))
                .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| {
                    cx.stop_propagation();
                })
                .on_click(cx.listener(move |shell, _, window, cx| {
                    shell.choose(listed + at, window, cx);
                }))
                .child(item.name.clone())
        }))
}

/// The open menu, over a backdrop that closes it.
pub(super) fn render_menu(
    menu: &Menu,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> gpui::AnyElement {
    if let Some(over) = menu.over {
        return render_sheet(menu, over, theme, cx).into_any_element();
    }
    const WIDTH: f32 = 220.0;
    const ROW: f32 = 30.0;
    const QUICK: f32 = 34.0;
    let viewport = window.viewport_size();
    let quick_height = if menu.quick.is_empty() {
        0.0
    } else {
        QUICK + 6.0
    };
    let height = px(menu.items.len() as f32 * ROW + 16.0 + quick_height);
    // Kept on screen: a menu opened near an edge opens back from it.
    let left = menu.at.x.min(viewport.width - px(WIDTH + 8.0)).max(px(4.0));
    let top = menu
        .at
        .y
        .min(viewport.height - height - px(8.0))
        .max(px(4.0));
    backdrop(cx)
        .child(
            Sheet::new("menu")
                .holds(super::kit::Hold::Arrows)
                .absolute()
                .left(left)
                .top(top)
                .w(px(WIDTH))
                .flex()
                .flex_col()
                .p(px(6.0))
                .when(!menu.quick.is_empty(), |list| {
                    list.child(quick_row(menu, theme, cx))
                })
                .children(menu.items.iter().enumerate().map(|(index, item)| {
                    MenuItem::new(("menu-item", index), item.name.clone())
                        .selector(selector_of(item))
                        .height(ROW)
                        .danger(item.danger)
                        .ticked(item.ticked)
                        .on_click(cx.listener(move |shell, _, window, cx| {
                            shell.choose(index, window, cx);
                        }))
                })),
        )
        .into_any_element()
}

/// What the tests call an entry: `menu-<name>`, unless it says otherwise.
fn selector_of(item: &Item) -> SharedString {
    item.selector
        .clone()
        .unwrap_or_else(|| format!("menu-{}", item.name).into())
}

/// The backdrop that puts a menu away when pressed.
fn backdrop(cx: &mut Context<Shell>) -> gpui::Stateful<gpui::Div> {
    div()
        .id("menu-backdrop")
        .debug_selector(|| "menu-backdrop".to_owned())
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .on_mouse_down(
            gpui::MouseButton::Left,
            cx.listener(|shell, _, _, cx| {
                shell.menu = None;
                cx.notify();
            }),
        )
}

/// A menu that is a sheet grown out of `over`: as wide as it, standing 4px
/// above its top edge, with its head and its clusters, as the web UI's
/// sheet over the dock is drawn.
fn render_sheet(
    menu: &Menu,
    over: gpui::Bounds<Pixels>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let head = menu
        .head
        .clone()
        .map(|(name, caption)| sheet_head(name, caption, theme));
    let rule = || div().my(px(6.0)).h(px(1.0)).flex_none().bg(theme.c.line);
    let mut rows: Vec<gpui::AnyElement> = Vec::new();
    if let Some(head) = head {
        rows.push(head.into_any_element());
        rows.push(rule().into_any_element());
    }
    for (index, item) in menu.items.iter().enumerate() {
        if item.rule {
            rows.push(rule().into_any_element());
        }
        let ink = if item.danger {
            theme.c.bad
        } else {
            theme.c.muted
        };
        let row = MenuItem::new(("menu-item", index), item.name.clone())
            .selector(selector_of(item))
            .roomy()
            .danger(item.danger)
            .when_some(item.icon, |row, glyph| row.lead(icon(glyph, 15.0, ink)))
            .when_some(item.hint.clone(), MenuItem::hint)
            .when_some(item.switch, |row, on| {
                row.trail(super::kit::Switch::new(on))
            })
            .when(item.chevron, |row| {
                row.trail(
                    div()
                        .flex()
                        .pl(px(8.0))
                        .child(icon("chevron-right", 14.0, theme.c.dim)),
                )
            })
            .on_click(cx.listener(move |shell, _, window, cx| {
                shell.choose(index, window, cx);
            }));
        rows.push(row.into_any_element());
    }
    // Placed in the window's own measure, as the dock was measured: the
    // backdrop starts inside the window's frame.
    backdrop(cx).child(
        gpui::anchored()
            .anchor(gpui::Corner::BottomLeft)
            .position(gpui::point(over.left(), over.top() - px(4.0)))
            .child(
                div()
                    .debug_selector(|| "menu-sheet".to_owned())
                    .w(over.size.width)
                    .child(
                        Sheet::new("menu")
                            .holds(super::kit::Hold::Arrows)
                            .w_full()
                            .flex()
                            .flex_col()
                            .p(px(6.0))
                            .children(rows),
                    ),
            ),
    )
}

/// The head of the sheet over the dock: the server's letter on a tile, its
/// name, and what the sheet is.
fn sheet_head(
    name: SharedString,
    caption: SharedString,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let letter: String = name
        .trim()
        .chars()
        .take(1)
        .flat_map(char::to_uppercase)
        .collect();
    div()
        .debug_selector(|| "menu-head".to_owned())
        .flex()
        .items_center()
        .gap(px(10.0))
        .pt(px(6.0))
        .px(px(12.0))
        .pb(px(8.0))
        .child(
            div()
                .flex_none()
                .size(px(32.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.accent_soft)
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(13.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.accent)
                .child(letter),
        )
        .child(
            div()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(1.0))
                .child(
                    div()
                        .truncate()
                        .text_size(px(13.5))
                        .line_height(px(16.875))
                        .font_weight(EMPHASIS)
                        .child(name),
                )
                .child(
                    div()
                        .truncate()
                        .text_size(px(11.0))
                        .line_height(px(14.85))
                        .text_color(theme.c.muted)
                        .child(caption),
                ),
        )
}

/// What an info card says: the text once it has come, or that it is on
/// its way, or that there is none.
pub(super) fn info_body(info: &super::Info, theme: &Theme) -> gpui::AnyElement {
    match &info.body {
        None => div()
            .text_color(theme.c.muted)
            .child("Fetching…")
            .into_any_element(),
        Some(body) if body.is_empty() => div()
            .text_color(theme.c.muted)
            .child("Nothing has been written here.")
            .into_any_element(),
        Some(body) => super::conversation::body_text(
            body,
            super::conversation::Place::aside(usize::MAX - 1),
            theme.c.accent_text,
            theme,
        )
        .into_any_element(),
    }
}

/// The open dialog, over a veil.
pub(super) fn render_prompt(
    prompt: &Prompt,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let (title, _, confirm) = prompt.question.wording();
    Dialog::new("prompt")
        .w(px(400.0))
        .gap(px(14.0))
        .p(px(22.0))
        .title(label(title, theme))
        .when_some(prompt.input.clone(), |dialog, input| {
            dialog.child(
                div()
                    .min_h(px(38.0))
                    .when(prompt.question.takes_lines(), |field| {
                        field.min_h(px(120.0)).items_start().py(px(10.0))
                    })
                    .flex()
                    .when(!prompt.question.takes_lines(), Styled::items_center)
                    .px(px(12.0))
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.input)
                    .border_1()
                    .border_color(theme.c.line2)
                    .child(input),
            )
        })
        .when_some(prompt.caution.clone(), |dialog, caution| {
            dialog.child(
                div()
                    .text_size(px(12.5))
                    .text_color(theme.c.warn)
                    .child(caution),
            )
        })
        .child(
            div()
                .flex()
                .items_center()
                .justify_end()
                .gap(px(8.0))
                .child(
                    Button::new("prompt-cancel", "Cancel")
                        .on_click(cx.listener(|shell, _, _, cx| shell.close_prompt(cx))),
                )
                .child(
                    Button::new("prompt-ok", confirm)
                        .emphasis(Emphasis::Contained)
                        .tone(if prompt.question.destructive() {
                            Tone::Danger
                        } else {
                            Tone::Accent
                        })
                        .on_click(cx.listener(|shell, _, _, cx| shell.answer_prompt(cx))),
                ),
        )
}

/// The card with a user's comment or a channel's description.
/// The head of a person's card: their banner, their face across its lower
/// edge, their name as their profile sets it, and what they say of
/// themselves in a line. Somebody with no profile has the theme's banner
/// and their name as it is.
pub(super) fn profile_head(
    shell: &Shell,
    info: &super::Info,
    user: &User,
    theme: &Theme,
) -> impl IntoElement + use<> {
    /// The face on a card, and the frame that sets it off from the banner.
    const FACE: f32 = 56.0;
    const FRAME: f32 = 3.0;
    let profile = info.profile.as_ref();
    let line: Vec<&str> = profile
        .into_iter()
        .flat_map(|profile| [profile.pronouns.as_deref(), profile.status.as_deref()])
        .flatten()
        .collect();
    let name_color = profile
        .and_then(|profile| profile.name_color)
        .or_else(|| shell.role_color(user))
        .unwrap_or(theme.c.text);
    div()
        .debug_selector(|| "profile-head".to_owned())
        .flex()
        .flex_col()
        .child(
            div()
                .h(px(84.0))
                .rounded(theme.skin.radius_md)
                .overflow_hidden()
                .bg(profile
                    .and_then(|profile| profile.banner_color)
                    .unwrap_or(theme.c.accent_soft))
                .when_some(info.banner.clone(), |banner, picture| {
                    banner.child(
                        gpui::img(crate::pictures::shown(
                            &picture,
                            crate::pictures::Fit::Banner,
                        ))
                        .size_full()
                        .object_fit(gpui::ObjectFit::Cover),
                    )
                }),
        )
        .child(
            div()
                .mt(px(-30.0))
                .ml(px(14.0))
                .p(px(FRAME))
                .w(px(FACE + 2.0 * FRAME))
                .rounded(frame_radius(FACE, FRAME, theme))
                .bg(theme.c.bg0)
                .child(
                    Avatar::new(&user.name)
                        .picture(user.avatar.as_ref())
                        .size(FACE),
                ),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_size(px(18.0))
                .font_weight(if profile.is_some_and(|profile| !profile.name_bold) {
                    gpui::FontWeight::MEDIUM
                } else {
                    gpui::FontWeight::BOLD
                })
                .when(profile.is_some_and(|profile| profile.name_italic), |name| {
                    name.italic()
                })
                .text_color(name_color)
                .child(user.name.clone()),
        )
        .when(!line.is_empty(), |head| {
            head.child(
                div()
                    .debug_selector(|| "profile-line".to_owned())
                    .text_size(px(12.5))
                    .text_color(theme.c.muted)
                    .child(line.join(" · ")),
            )
        })
        .when_some(
            profile.and_then(|profile| profile.contact.clone()),
            |head, contact| {
                head.child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme.c.dim)
                        .child(contact),
                )
            },
        )
}

pub(super) fn render_info(
    shell: &Shell,
    info: &super::Info,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let body = match &info.page {
        Some(page) => super::pages::about(info.subject, page, theme, cx),
        None => info_body(info, theme),
    };
    // A person gets a card's head; anything else, its name.
    let person = match info.subject {
        Subject::User(session) => shell.snapshot.users.iter().find(|u| u.session == session),
        _ => None,
    };
    Dialog::new("info")
        .w(px(460.0))
        .max_h(px(560.0))
        .gap(px(14.0))
        .p(px(22.0))
        .map(|card| match person {
            Some(user) => card.child(profile_head(shell, info, user, theme)),
            None => match super::livery::server_head(shell, info.subject, theme) {
                Some(head) => card.child(head),
                None => card.title(info.title.clone()),
            },
        })
        .when(!info.facts.is_empty(), |card| {
            card.child(
                super::facts::rows(&shell.shown_facts(&info.facts), theme)
                    .debug_selector(|| "info-facts".to_owned()),
            )
        })
        .child(
            div()
                .id("info-body")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(14.0))
                .text_size(px(13.5))
                .children(super::facts::devices(&shell.shown_devices(&info.devices), theme))
                .child(body),
        )
        .child(
            div().flex().justify_end().child(
                div()
                    .id("info-close")
                    .debug_selector(|| "info-close".to_owned())
                    .h(px(36.0))
                    .px(px(18.0))
                    .flex()
                    .items_center()
                    .rounded(theme.skin.radius_md)
                    .cursor_pointer()
                    .text_color(theme.c.muted)
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.info = None;
                        cx.notify();
                    }))
                    .child(label("Close", theme)),
            ),
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn user(session: Session, channel: ChannelId) -> User {
        User {
            session,
            name: "Rin".into(),
            channel,
            muted: false,
            deafened: false,
            server_muted: false,
            server_deafened: false,
            avatar: None,
            unread: 0,
            priority: false,
            account: None,
            hash: None,
        }
    }

    /// Somebody the server lets do everything.
    const ALL: Over = Over {
        there: Rights::ALL,
        root: Rights::ALL,
    };

    fn names(items: &[Item]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_ref()).collect()
    }

    #[test]
    fn somebody_else_gets_message_volume_and_moderation() {
        let items = user_items(&user(3, 1), Some(1), Some(1), 1.0, None, false, ALL);
        assert_eq!(
            names(&items),
            [
                "Message",
                "User information",
                "Whisper with the whisper key",
                "Mute here",
                "Volume 50%",
                "Volume 100%",
                "Volume 150%",
                "Move to…",
                "Priority speaker",
                "Mute for everyone",
                "Deafen for everyone",
                "Register…",
                "Reset their comment",
                "Remove their picture",
                "Kick…",
                "Ban…",
            ]
        );
        let ticked: Vec<_> = items
            .iter()
            .filter(|item| item.ticked)
            .map(|item| item.name.as_ref())
            .collect();
        assert_eq!(ticked, ["Volume 100%"], "the loudness in force is ticked");
        assert!(items.iter().filter(|item| item.danger).count() == 2);
    }

    #[test]
    fn a_user_elsewhere_can_be_moved_here_and_a_muted_one_unmuted() {
        let mut elsewhere = user(3, 2);
        elsewhere.muted = true;
        // Muted by themselves: theirs to lift, and nobody else's.
        let items = user_items(&elsewhere, Some(1), Some(1), 0.0, None, false, ALL);
        assert!(names(&items).contains(&"Mute for everyone"));
        elsewhere.server_muted = true;
        let items = user_items(&elsewhere, Some(1), Some(1), 0.0, None, false, ALL);
        assert!(names(&items).contains(&"Move to my channel"));
        assert!(names(&items).contains(&"Unmute for everyone"));
        let ticked: Vec<_> = items
            .iter()
            .filter(|item| item.ticked)
            .map(|item| item.name.as_ref())
            .collect();
        assert_eq!(ticked, ["Mute here"]);
    }

    #[test]
    fn what_the_server_would_refuse_is_not_offered() {
        // Nothing granted, anywhere: nobody to moderate, nothing to manage.
        let none = Over {
            there: Rights::only(&[]),
            root: Rights::only(&[]),
        };
        let items = user_items(&user(3, 2), Some(1), Some(1), 1.0, None, false, none);
        assert_eq!(
            names(&items),
            [
                "Message",
                "User information",
                "Whisper with the whisper key",
                "Join their channel",
                "Mute here",
                "Volume 50%",
                "Volume 100%",
                "Volume 150%",
            ]
        );
        // Each right brings what it is for, and only that: moving and
        // muting by the channel they are in, the rest by the root.
        let some = Over {
            there: Rights::only(&[Right::MOVE]),
            root: Rights::only(&[Right::KICK]),
        };
        let items = user_items(&user(3, 2), Some(1), Some(1), 1.0, None, false, some);
        let offered = names(&items);
        assert!(offered.contains(&"Move to my channel") && offered.contains(&"Kick…"));
        assert!(!offered.contains(&"Ban…") && !offered.contains(&"Mute for everyone"));
        // Somebody registered is not offered registering again.
        let mut registered = user(3, 1);
        registered.account = Some(7);
        let items = user_items(&registered, Some(1), Some(1), 1.0, None, false, ALL);
        assert!(!names(&items).contains(&"Register…"));
        assert!(names(&items).contains(&"Deregister…"), "taken away instead");
        // The server's own account is nobody's to take away.
        registered.account = Some(0);
        let items = user_items(&registered, Some(1), Some(1), 1.0, None, false, ALL);
        assert!(!names(&items).contains(&"Deregister…"));
        // Oneself: registering is offered where the server lets people.
        let items = user_items(&user(1, 1), Some(1), Some(1), 1.0, None, false, none);
        assert!(!names(&items).contains(&"Register on this server"));
    }

    #[test]
    fn a_channel_offers_what_its_rights_allow() {
        let channel = |rights, restricted| Channel {
            id: 2,
            parent: Some(0),
            name: "x".into(),
            position: 0,
            unread: 0,
            history: true,
            encrypted: false,
            listening: false,
            signal: false,
            rights,
            restricted,
            temporary: false,
            max_users: 0,
        };
        let reader = channel_items(&channel(Rights::only(&[]), false), Some(1), true, None);
        assert_eq!(
            names(&reader),
            [
                "Open",
                "Join",
                "Join with a password…",
                "Listen without joining",
                "Shout here with the whisper key",
                "About this channel",
                "New poll: choose one…",
                "New poll: choose any…",
            ]
        );
        // Until the server has answered, changing the channel is offered,
        // as the web UI offers it; making and deleting are not.
        let unknown = channel_items(&channel(Rights::default(), false), Some(1), false, None);
        let offered = names(&unknown);
        assert!(offered.contains(&"Rename…") && offered.contains(&"Permissions…"));
        assert!(!offered.contains(&"Delete…") && !offered.contains(&"New channel inside…"));
        // Somebody who may only make temporary channels is offered those.
        let guest = Rights::only(&[Right::MAKE_TEMPORARY]);
        let offered = channel_items(&channel(guest, false), Some(1), true, None);
        let offered = names(&offered);
        assert!(offered.contains(&"New channel inside…"));
        // A moderator of what is said: all of it, or one sender's.
        let moderator = channel(Rights::only(&[Right::DELETE_MESSAGE]), false);
        assert!(
            names(&channel_items(&moderator, Some(1), true, None))
                .contains(&"Delete all messages…")
        );
        let mut known = user(3, 2);
        known.hash = Some("abc".into());
        assert!(purge_item(&known, Some(&moderator)).is_some());
        assert!(purge_item(&known, Some(&channel(Rights::only(&[]), false))).is_none());
        // A room behind a password asks for it on a plain join.
        let locked = channel_items(&channel(Rights::ALL, true), Some(1), false, None);
        assert!(!names(&locked).contains(&"Join with a password…"));
        // The server's lists, for whoever may read them.
        let listed = |root| {
            let items = session_items(&"s".into(), Some(root), None);
            names(&items)
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            listed(Rights::only(&[])),
            ["Server information", "Disconnect"]
        );
        assert_eq!(
            listed(Rights::only(&[Right::BAN])),
            ["Server information", "Bans…", "Disconnect"]
        );
        // A server on the rail that is not the one on screen is switched
        // to; a saved one can be starred, handed on and changed.
        let key = SharedString::from("kumo.jp:64738");
        let other = session_items(&"s".into(), None, Some((&key, true)));
        assert_eq!(
            names(&other),
            [
                "Switch to",
                "Favourite",
                "Copy address",
                "Edit…",
                "Disconnect"
            ]
        );
        assert!(other[1].ticked);
        assert_eq!(
            other[2].command,
            Command::Copy("mumble://kumo.jp:64738".into())
        );
    }

    #[test]
    fn oneself_gets_the_profile_entries_only() {
        let items = user_items(&user(1, 1), Some(1), Some(1), 1.0, None, false, ALL);
        assert_eq!(
            names(&items),
            [
                "Set comment…",
                "Change picture…",
                "Remove picture",
                "Change banner…",
                "Remove banner",
                "Register on this server"
            ]
        );
    }

    #[test]
    fn the_root_cannot_be_deleted_and_the_current_channel_not_joined() {
        let channel = |id, parent| Channel {
            id,
            parent,
            name: "x".into(),
            position: 0,
            unread: 0,
            history: false,
            encrypted: false,
            listening: false,
            rights: Rights::ALL,
            restricted: false,
            signal: false,
            temporary: false,
            max_users: 0,
        };
        assert_eq!(
            names(&channel_items(&channel(0, None), Some(1), false, None)),
            [
                "Open",
                "Join",
                "Join with a password…",
                "Listen without joining",
                "Shout here with the whisper key",
                "About this channel",
                "New channel inside…",
                "Move everyone with me here",
                "Move everyone in here to…",
                "Rename…",
                "Describe…",
                "Set a password…",
                "Permissions…",
            ]
        );
        assert_eq!(
            names(&channel_items(&channel(1, Some(0)), Some(1), false, None)),
            [
                "Open",
                "Shout here with the whisper key",
                "About this channel",
                "New channel inside…",
                "Move everyone in here to…",
                "Rename…",
                "Describe…",
                "Set a password…",
                "Permissions…",
                "Delete…"
            ]
        );
    }

    #[test]
    fn an_answer_becomes_its_action_and_a_nameless_channel_is_no_answer() {
        assert_eq!(
            Question::KickReason(3).answered("  spam "),
            Some(Action::Kick {
                session: 3,
                reason: "spam".to_owned()
            })
        );
        assert_eq!(
            Question::KickReason(3).answered(""),
            Some(Action::Kick {
                session: 3,
                reason: String::new()
            }),
            "a reason is optional"
        );
        assert_eq!(
            Question::NewPollSeveral(1).answered("Tea?\n\n Yes \nNo\n"),
            Some(Action::CreatePoll {
                channel: 1,
                question: "Tea?".to_owned(),
                options: vec!["Yes".to_owned(), "No".to_owned()],
                multiple: true,
            })
        );
        assert_eq!(
            Question::NewPoll(1).answered("Tea?\nYes"),
            None,
            "one answer is no poll"
        );
        assert_eq!(
            Question::DeleteChannel(2).answered(""),
            Some(Action::DeleteChannel { channel: 2 })
        );
    }
}
