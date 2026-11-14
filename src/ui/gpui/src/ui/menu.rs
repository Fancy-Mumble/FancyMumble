//! The menus behind a right click on a user or a channel, and the small
//! dialog some of their entries need an answer from.

use gpui::{
    Context, Entity, IntoElement, ParentElement, Pixels, Point, SharedString, Styled, Subscription,
    Window, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Button, Dialog, Emphasis, MenuItem, Sheet, Tone};
use super::text_input::{InputEvent, TextInput};
use super::widgets::label;
use crate::engine::{
    Action, Channel, ChannelId, Conversation, Listing, Message, Session, Subject, User,
    WhisperTarget,
};
use crate::theme::Theme;

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
    /// Put a message's text in the composer, to be changed.
    Edit {
        id: SharedString,
        text: SharedString,
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
}

/// The panels the local user's own menu opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Panel {
    Voice,
    Themes,
    Certificates,
    Friends,
    Settings,
    /// The messages waiting to be sent later.
    Later,
}

/// A question an entry puts before it can act.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Question {
    KickReason(Session),
    BanReason(Session),
    NewChannel(ChannelId),
    /// A channel whose messages the server keeps.
    NewChannelWithHistory(ChannelId),
    /// A channel whose messages are kept sealed from the server.
    NewEncryptedChannel(ChannelId),
    /// A channel sealed the Signal way.
    NewSignalChannel(ChannelId),
    /// A channel that lasts while somebody is in it.
    NewTemporaryChannel(ChannelId),
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
}

impl Question {
    /// The dialog's title, the placeholder of its field (or `None` for a
    /// question that only wants a yes), and what the button says.
    fn wording(self) -> (&'static str, Option<&'static str>, &'static str) {
        match self {
            Self::KickReason(_) => ("Kick", Some("Reason, if you want to give one"), "Kick"),
            Self::BanReason(_) => ("Ban", Some("Reason, if you want to give one"), "Ban"),
            Self::NewChannel(_) => ("New channel", Some("Name"), "Create"),
            Self::NewChannelWithHistory(_) => (
                "New channel that keeps its messages",
                Some("Name"),
                "Create",
            ),
            Self::NewEncryptedChannel(_) => (
                "New channel that keeps its messages, encrypted",
                Some("Name"),
                "Create",
            ),
            Self::NewSignalChannel(_) => {
                ("New channel, sealed the Signal way", Some("Name"), "Create")
            }
            Self::NewTemporaryChannel(_) => (
                "New channel, gone when the last one leaves",
                Some("Name"),
                "Create",
            ),
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
            Self::NewChannel(parent) => Action::CreateChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
                history: false,
                encrypted: false,
            },
            Self::NewChannelWithHistory(parent) => Action::CreateChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
                history: true,
                encrypted: false,
            },
            Self::NewEncryptedChannel(parent) => Action::CreateChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
                history: true,
                encrypted: true,
            },
            Self::NewSignalChannel(parent) => Action::CreateSignalChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            Self::RenameChannel(channel) => Action::RenameChannel {
                channel,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            Self::DeleteChannel(channel) => Action::DeleteChannel { channel },
            Self::NewTemporaryChannel(parent) => Action::CreateTemporaryChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            Self::PurgeChannel(channel) => Action::Purge { channel, by: None },
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
            Self::AclGroup(_) | Self::SendLater(_) => return None,
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
}

impl Item {
    fn new(name: &str, command: Command) -> Self {
        Self {
            name: name.to_owned().into(),
            command,
            danger: false,
            ticked: false,
        }
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
    if kept {
        // The way to more than one at a time: to delete them together.
        items.push(Item::new("Select…", Command::Select(index)));
    }
    if message.own {
        items.push(Item::new(
            "Edit",
            Command::Edit {
                id: id.clone(),
                text: message.body.clone(),
            },
        ));
        if kept {
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
    }
    (items, quick)
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
) -> Vec<Item> {
    let session = user.session;
    if own == Some(session) {
        return vec![
            Item::new("Set comment…", Command::Ask(Question::Comment)),
            Item::new("Change picture…", Command::PickAvatar),
            Item::new("Remove picture", Command::Do(Action::SetAvatar(Vec::new()))),
            Item::new(
                "Register on this server",
                Command::Do(Action::Register { session }),
            ),
        ];
    }
    let mut items = vec![
        Item::new("Message", Command::Open(Conversation::Direct(session))),
        Item::new("View comment", Command::About(Subject::User(session))),
        Item::new(
            "Whisper with the whisper key",
            Command::Whisper(WhisperTarget::User(session), user.name.clone()),
        )
        .ticked(whispered_to == Some(WhisperTarget::User(session))),
    ];
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
    if let Some(channel) = own_channel.filter(|channel| *channel != user.channel) {
        items.push(Item::new(
            "Move to my channel",
            Command::Do(Action::MoveUser { session, channel }),
        ));
    }
    items.extend([
        Item::new(
            "Priority speaker",
            Command::Do(Action::PrioritySpeaker {
                session,
                priority: !user.priority,
            }),
        )
        .ticked(user.priority),
        Item::new(
            if user.muted {
                "Unmute for everyone"
            } else {
                "Mute for everyone"
            },
            Command::Do(Action::ServerMute {
                session,
                muted: !user.muted,
            }),
        ),
        Item::new(
            if user.deafened {
                "Undeafen for everyone"
            } else {
                "Deafen for everyone"
            },
            Command::Do(Action::ServerDeafen {
                session,
                deafened: !user.deafened,
            }),
        ),
        Item::new("Register", Command::Do(Action::Register { session })),
        Item::new(
            "Reset their comment",
            Command::Do(Action::ResetComment { session }),
        ),
        Item::new(
            "Remove their picture",
            Command::Do(Action::RemovePicture { session }),
        ),
        Item::new("Kick…", Command::Ask(Question::KickReason(session))).danger(),
        Item::new("Ban…", Command::Ask(Question::BanReason(session))).danger(),
    ]);
    items
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
    if own_channel != Some(id) {
        items.push(Item::new("Join", Command::Join(id)));
        items.push(Item::new(
            "Join with a password…",
            Command::Ask(Question::JoinPassword(id)),
        ));
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
    items.push(Item::new(
        "New channel inside…",
        Command::Ask(Question::NewChannel(id)),
    ));
    items.push(Item::new(
        "New temporary channel inside…",
        Command::Ask(Question::NewTemporaryChannel(id)),
    ));
    // Everybody in the user's own channel can be brought along.
    if let Some(from) = own_channel.filter(|own| *own != id) {
        items.push(Item::new(
            "Move everyone with me here",
            Command::Do(Action::MoveEveryone { from, to: id }),
        ));
    }
    if fancy {
        items.push(Item::new(
            "New channel with history inside…",
            Command::Ask(Question::NewChannelWithHistory(id)),
        ));
        items.push(Item::new(
            "New encrypted channel inside…",
            Command::Ask(Question::NewEncryptedChannel(id)),
        ));
        items.push(Item::new(
            "New poll: choose one…",
            Command::Ask(Question::NewPoll(id)),
        ));
        items.push(Item::new(
            "New poll: choose any…",
            Command::Ask(Question::NewPollSeveral(id)),
        ));
    }
    items.push(Item::new(
        "Rename…",
        Command::Ask(Question::RenameChannel(id)),
    ));
    items.push(Item::new(
        "Describe…",
        Command::Ask(Question::DescribeChannel(id)),
    ));
    items.push(Item::new(
        "Set a password…",
        Command::Ask(Question::ChannelPassword(id)),
    ));
    items.push(Item::new("Permissions…", Command::Permissions(id)));
    if channel.history {
        items.push(
            Item::new(
                "Delete all messages…",
                Command::Ask(Question::PurgeChannel(id)),
            )
            .danger(),
        );
    }
    // The root cannot be deleted; a server would only refuse.
    if channel.parent.is_some() {
        items.push(Item::new("Delete…", Command::Ask(Question::DeleteChannel(id))).danger());
    }
    items
}

/// The entries for a right click on a server's tile on the rail.
/// `showing` is whether it is the server on screen.
pub(super) fn session_items(id: &SharedString, showing: bool) -> Vec<Item> {
    let mut items = Vec::new();
    if showing {
        items.push(Item::new(
            "Server information",
            Command::About(Subject::Server),
        ));
        items.push(Item::new("Bans…", Command::Admin(Listing::Bans)));
        items.push(Item::new(
            "Registered users…",
            Command::Admin(Listing::Registered),
        ));
    }
    items.push(Item::new("Disconnect", Command::Leave(id.clone())).danger());
    items
}

/// For a moderator: delete what `user` said in the channel on screen, where
/// the server keeps that channel's messages and knows the user by a
/// certificate.
pub(super) fn purge_item(user: &User, open: Option<&Channel>) -> Option<Item> {
    let channel = open.filter(|channel| channel.history && user.hash.is_some())?;
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

/// The entries of the local user's own menu, on their tile: the view's
/// settings, and what there is to change about themselves.
pub(super) fn own_items(hide_empty: bool, recording: bool) -> Vec<Item> {
    vec![
        Item::new("Hide empty channels", Command::HideEmpty(!hide_empty)).ticked(hide_empty),
        Item::new("Record what is heard…", Command::Record(!recording)).ticked(recording),
        Item::new("Settings…", Command::Panel(Panel::Settings)),
        Item::new("Voice settings…", Command::Panel(Panel::Voice)),
        Item::new("Themes…", Command::Panel(Panel::Themes)),
        Item::new("Certificates…", Command::Panel(Panel::Certificates)),
        Item::new("Friends…", Command::Panel(Panel::Friends)),
        Item::new("Change picture…", Command::PickAvatar),
        Item::new("Change comment…", Command::Ask(Question::Comment)),
    ]
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
/// The side a picture is scaled to fit: what avatars are drawn at, twice
/// over, and small enough for a server's size limit on pictures.
const AVATAR_SIDE: u32 = 256;

/// An avatar made from an image file's bytes: scaled to fit
/// [`AVATAR_SIDE`] and encoded as JPEG, which keeps it under the size a
/// stock server accepts.
pub(super) fn avatar_from(file: &[u8]) -> Result<Vec<u8>, String> {
    let picture = image::load_from_memory(file)
        .map_err(|error| format!("That file is not a picture this can read: {error}"))?;
    let scaled = picture
        .resize(
            AVATAR_SIDE,
            AVATAR_SIDE,
            image::imageops::FilterType::Triangle,
        )
        .into_rgb8();
    let mut encoded = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 85)
        .encode_image(&scaled)
        .map_err(|error| format!("The picture could not be encoded: {error}"))?;
    Ok(encoded)
}

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
        // Offered beside the other encrypted kind, where the library that
        // does the sealing is installed.
        let beside = items
            .iter()
            .position(|item| item.name.as_ref() == "New encrypted channel inside…");
        if let Some(beside) = beside.filter(|_| self.engine.signal_available()) {
            items.insert(
                beside + 1,
                Item::new(
                    "New Signal-sealed channel inside…",
                    Command::Ask(Question::NewSignalChannel(id)),
                ),
            );
        }
        self.open_menu(at, items, cx);
    }

    pub(super) fn open_message_menu(
        &mut self,
        at: Point<Pixels>,
        index: usize,
        cx: &mut Context<Self>,
    ) {
        let Some(message) = self.messages.get(index) else {
            return;
        };
        let channel = match self.open {
            Some(Conversation::Channel(channel)) => Some(channel),
            _ => None,
        };
        let kept = channel.is_some_and(|id| {
            self.snapshot
                .channels
                .iter()
                .any(|known| known.id == id && known.history)
        });
        let (items, quick) = message_items(message, index, channel, self.snapshot.fancy, kept);
        self.menu = Some(Menu { at, items, quick });
        cx.notify();
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
        match item.command {
            Command::Do(action) => self.engine.act(action),
            Command::Open(conversation) => self.open_conversation(conversation, cx),
            Command::Join(channel) => {
                self.engine.join_channel(channel);
                self.open_conversation(Conversation::Channel(channel), cx);
            }
            Command::Volume(session, volume) => {
                let _ = self.volumes.insert(session, volume);
                self.engine.act(Action::SetUserVolume { session, volume });
            }
            Command::About(subject) => self.show_about(subject, cx),
            Command::Ask(question) => self.ask(question, window, cx),
            Command::PickAvatar => self.pick_avatar(cx),
            Command::Edit { id, text } => self.start_editing(id, text.as_ref(), window, cx),
            Command::Leave(session) => self.engine.leave_session(&session),
            Command::Permissions(channel) => self.open_acl(channel, cx),
            Command::Whisper(target, name) => self.toggle_whisper_target(target, name, cx),
            Command::Admin(listing) => self.open_admin(listing, cx),
            Command::Friend(session, keep) => self.set_friend(session, keep, cx),
            Command::Favourite(key, favorite) => self.set_favourite(&key, favorite, cx),
            Command::Select(index) => self.start_picking(index, cx),
            Command::Record(start) => self.record(start, cx),
            Command::HideEmpty(hide) => {
                self.chrome.hide_empty = hide;
                self.lay_out_column();
                self.remember_settings(cx);
            }
            Command::Emoji => {
                self.emoji_for = Some(super::emoji::For::Composer);
                cx.notify();
            }
            Command::Panel(Panel::Voice) => self.toggle_devices(cx),
            Command::Panel(Panel::Themes) => self.toggle_picker(cx),
            Command::Panel(Panel::Certificates) => self.toggle_certificates(cx),
            Command::Panel(Panel::Later) => self.open_later(cx),
            Command::Panel(Panel::Settings) => {
                self.panels.settings.open = true;
                cx.notify();
            }
            Command::Panel(Panel::Friends) => {
                self.panels.friends.open = true;
                cx.notify();
            }
            Command::Reply(index) => self.start_replying(index, window, cx),
            Command::MoreReactions { channel, id } => {
                self.emoji_for = Some(super::emoji::For::Reaction { channel, id });
            }
            Command::Copy(text) => {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()));
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
            input.read(cx).focus(window);
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
                InputEvent::Changed | InputEvent::Tabbed { .. } | InputEvent::PastedPicture(_) => {}
            })
        });
        self.prompt = Some(Prompt {
            question,
            input,
            _subscription: subscription,
        });
        cx.notify();
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
        } else if let Some(action) = prompt.question.answered(&answer) {
            self.engine.act(action);
            self.prompt = None;
        }
        cx.notify();
    }

    /// Let the user choose a picture file, and make it their avatar.
    fn pick_avatar(&mut self, cx: &mut Context<Self>) {
        self.pick_picture(cx, avatar_from, |shell, avatar| {
            shell.engine.act(Action::SetAvatar(avatar));
        });
    }

    /// Choose a file to send to the open conversation. A picture goes in
    /// the message itself, which every server and client takes; anything
    /// else is shared as a file, where the server keeps files.
    pub(super) fn pick_file_to_send(&mut self, cx: &mut Context<Self>) {
        let chosen = cx.prompt_for_paths(gpui::PathPromptOptions {
            files: true,
            directories: false,
            multiple: false,
            prompt: Some("Choose a file to send".into()),
        });
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(paths))) = chosen.await else {
                return;
            };
            let _ = shell.update(cx, |shell, cx| shell.send_files(paths, cx));
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
                    .spawn(async move { picture_at(&read) })
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
    fn pick_picture(
        &mut self,
        cx: &mut Context<Self>,
        prepare: fn(&[u8]) -> Result<Vec<u8>, String>,
        then: fn(&mut Self, Vec<u8>),
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
                    Ok(picture) => then(shell, picture),
                    Err(problem) => shell.notice = Some(problem.into()),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

/// The file at `path` whole, if it is a picture small enough to go in a
/// message; `None` for anything else, a file that cannot be read included.
fn picture_at(path: &std::path::Path) -> Option<Vec<u8>> {
    use std::io::Read as _;
    let mut file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > MAX_PICTURE_FILE {
        return None;
    }
    // The first bytes say what it is; the rest is read only if it is one.
    let mut bytes = vec![0; 16];
    let read = file.read(&mut bytes).ok()?;
    bytes.truncate(read);
    if !crate::picture::is_picture(&bytes) {
        return None;
    }
    let _ = file.read_to_end(&mut bytes).ok()?;
    Some(bytes)
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
) -> impl IntoElement + use<> {
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
        .child(
            Sheet::new("menu")
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
                        .selector(format!("menu-{}", item.name))
                        .height(ROW)
                        .danger(item.danger)
                        .ticked(item.ticked)
                        .on_click(cx.listener(move |shell, _, window, cx| {
                            shell.choose(index, window, cx);
                        }))
                })),
        )
}

/// What an info card says: the text once it has come, or that it is on
/// its way, or that there is none.
fn info_body(info: &super::Info, theme: &Theme) -> gpui::AnyElement {
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
fn profile_head(
    shell: &Shell,
    info: &super::Info,
    user: &User,
    theme: &Theme,
) -> impl IntoElement + use<> {
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
                        gpui::img(picture)
                            .size_full()
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                }),
        )
        .child(
            div()
                .mt(px(-30.0))
                .ml(px(14.0))
                .p(px(3.0))
                .w(px(62.0))
                .rounded_full()
                .bg(theme.c.bg0)
                .child(
                    Avatar::new(&user.name)
                        .picture(user.avatar.as_ref())
                        .size(56.0),
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
    let body = info_body(info, theme);
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
            None => card.title(info.title.clone()),
        })
        .when(!info.facts.is_empty(), |card| {
            card.child(
                super::facts::rows(&info.facts, theme).debug_selector(|| "info-facts".to_owned()),
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
                .children(super::facts::devices(&info.devices, theme))
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
            avatar: None,
            unread: 0,
            priority: false,
            account: None,
            hash: None,
        }
    }

    fn names(items: &[Item]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_ref()).collect()
    }

    #[test]
    fn somebody_else_gets_message_volume_and_moderation() {
        let items = user_items(&user(3, 1), Some(1), Some(1), 1.0, None, false);
        assert_eq!(
            names(&items),
            [
                "Message",
                "View comment",
                "Whisper with the whisper key",
                "Mute here",
                "Volume 50%",
                "Volume 100%",
                "Volume 150%",
                "Priority speaker",
                "Mute for everyone",
                "Deafen for everyone",
                "Register",
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
        let items = user_items(&elsewhere, Some(1), Some(1), 0.0, None, false);
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
    fn oneself_gets_the_profile_entries_only() {
        let items = user_items(&user(1, 1), Some(1), Some(1), 1.0, None, false);
        assert_eq!(
            names(&items),
            [
                "Set comment…",
                "Change picture…",
                "Remove picture",
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
                "New temporary channel inside…",
                "Move everyone with me here",
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
                "New temporary channel inside…",
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
        assert_eq!(Question::NewChannel(1).answered("   "), None);
        assert_eq!(
            Question::NewChannel(1).answered(" Games "),
            Some(Action::CreateChannel {
                parent: 1,
                name: "Games".to_owned(),
                history: false,
                encrypted: false,
            })
        );
        assert_eq!(
            Question::NewChannelWithHistory(1).answered("Notes"),
            Some(Action::CreateChannel {
                parent: 1,
                name: "Notes".to_owned(),
                history: true,
                encrypted: false,
            })
        );
        assert_eq!(
            Question::NewEncryptedChannel(1).answered("Secrets"),
            Some(Action::CreateChannel {
                parent: 1,
                name: "Secrets".to_owned(),
                history: true,
                encrypted: true,
            })
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

    #[test]
    fn a_picture_file_becomes_a_small_jpeg() {
        let mut png = Vec::new();
        image::ImageBuffer::from_pixel(1200, 600, image::Rgb([200u8, 40, 40]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("a png");
        let avatar = avatar_from(&png).expect("an avatar");
        assert!(avatar.starts_with(&[0xff, 0xd8, 0xff]), "a jpeg");
        let decoded = image::load_from_memory(&avatar).expect("decodes");
        assert_eq!(
            (decoded.width(), decoded.height()),
            (256, 128),
            "scaled to fit, shape kept"
        );
        assert!(avatar.len() < 64 * 1024, "well under a server's limit");
        assert!(avatar_from(b"not a picture").is_err());
    }
}
