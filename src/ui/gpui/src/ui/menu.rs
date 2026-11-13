//! The menus behind a right click on a user or a channel, and the small
//! dialog some of their entries need an answer from.

use gpui::{
    Context, Entity, IntoElement, ParentElement, Pixels, Point, SharedString, Styled, Subscription,
    Window, div, prelude::*, px,
};

use super::Shell;
use super::text_input::{InputEvent, TextInput};
use super::widgets::{EMPHASIS, icon, label, opaque};
use crate::engine::{Action, Channel, ChannelId, Conversation, Message, Session, Subject, User};
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
    /// Leave the server of a session.
    Leave(SharedString),
}

/// A question an entry puts before it can act.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Question {
    KickReason(Session),
    BanReason(Session),
    NewChannel(ChannelId),
    /// A channel whose messages the server keeps.
    NewChannelWithHistory(ChannelId),
    RenameChannel(ChannelId),
    DeleteChannel(ChannelId),
    JoinPassword(ChannelId),
    Comment,
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
            Self::RenameChannel(_) => ("Rename channel", Some("Name"), "Rename"),
            Self::DeleteChannel(_) => ("Delete this channel and everything in it?", None, "Delete"),
            Self::JoinPassword(_) => ("Join with a password", Some("Password"), "Join"),
            Self::Comment => ("Your comment", Some("What others read about you"), "Save"),
        }
    }

    /// Whether the button is drawn as destructive.
    fn destructive(self) -> bool {
        matches!(
            self,
            Self::KickReason(_) | Self::BanReason(_) | Self::DeleteChannel(_)
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
            },
            Self::NewChannelWithHistory(parent) => Action::CreateChannel {
                parent,
                name: Some(text).filter(|name| !name.is_empty())?,
                history: true,
            },
            Self::RenameChannel(channel) => Action::RenameChannel {
                channel,
                name: Some(text).filter(|name| !name.is_empty())?,
            },
            Self::DeleteChannel(channel) => Action::DeleteChannel { channel },
            Self::JoinPassword(channel) => Action::JoinWithPassword {
                channel,
                password: answer.to_owned(),
            },
            Self::Comment => Action::SetComment(text),
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
    channel: Option<ChannelId>,
    fancy: bool,
    kept: bool,
) -> (Vec<Item>, Vec<Item>) {
    let mut items = vec![Item::new("Copy text", Command::Copy(message.body.clone()))];
    let (Some(channel), Some(id), true) = (channel, message.id.as_ref(), fancy) else {
        return (items, Vec::new());
    };
    let quick = QUICK_REACTIONS
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
    ];
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
    items.push(Item::new(
        "About this channel",
        Command::About(Subject::Channel(id)),
    ));
    items.push(Item::new(
        "New channel inside…",
        Command::Ask(Question::NewChannel(id)),
    ));
    if fancy {
        items.push(Item::new(
            "New channel with history inside…",
            Command::Ask(Question::NewChannelWithHistory(id)),
        ));
    }
    items.push(Item::new(
        "Rename…",
        Command::Ask(Question::RenameChannel(id)),
    ));
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
    }
    items.push(Item::new("Disconnect", Command::Leave(id.clone())).danger());
    items
}

/// The dialog a [`Question`] is put in.
pub(super) struct Prompt {
    question: Question,
    /// The field, for a question that wants more than a yes.
    input: Option<Entity<TextInput>>,
    _subscription: Option<Subscription>,
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
        let (items, quick) = message_items(message, channel, self.snapshot.fancy, kept);
        self.menu = Some(Menu { at, items, quick });
        cx.notify();
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
            Command::Copy(text) => {
                cx.write_to_clipboard(gpui::ClipboardItem::new_string(text.to_string()));
            }
        }
        cx.notify();
    }

    /// Open the dialog for `question`.
    fn ask(&mut self, question: Question, window: &mut Window, cx: &mut Context<Self>) {
        let (_, placeholder, _) = question.wording();
        let input = placeholder.map(|placeholder| {
            let input = cx.new(|cx| {
                let mut input = TextInput::new(placeholder, cx);
                if matches!(question, Question::JoinPassword(_)) {
                    input = input.obscured();
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
            input
        });
        let subscription = input.as_ref().map(|input| {
            cx.subscribe(input, |shell, _, event, cx| match event {
                InputEvent::Submitted(_) => shell.answer_prompt(cx),
                InputEvent::Cancelled => shell.close_prompt(cx),
                InputEvent::Changed | InputEvent::Tabbed { .. } => {}
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
        if let Some(action) = prompt.question.answered(&answer) {
            self.engine.act(action);
            self.prompt = None;
        }
        cx.notify();
    }

    /// Let the user choose a picture file, and make it their avatar.
    fn pick_avatar(&mut self, cx: &mut Context<Self>) {
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
                    avatar_from(&std::fs::read(&path).map_err(|e| e.to_string())?)
                })
                .await;
            let _ = shell.update(cx, |shell, cx| {
                match made {
                    Ok(avatar) => shell.engine.act(Action::SetAvatar(avatar)),
                    Err(problem) => shell.notice = Some(problem.into()),
                }
                cx.notify();
            });
        })
        .detach();
    }
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
    let listed = menu.items.len();
    // Kept on screen: a menu opened near an edge opens back from it.
    let left = menu.at.x.min(viewport.width - px(WIDTH + 8.0)).max(px(4.0));
    let top = menu
        .at
        .y
        .min(viewport.height - height - px(8.0))
        .max(px(4.0));
    let hover = theme.c.hover;
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
            div()
                .absolute()
                .left(left)
                .top(top)
                .w(px(WIDTH))
                .flex()
                .flex_col()
                .p(px(6.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .when(!menu.quick.is_empty(), |list| {
                    list.child(div().flex().justify_between().pb(px(6.0)).children(
                        menu.quick.iter().enumerate().map(|(at, item)| {
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
                        }),
                    ))
                })
                .children(menu.items.iter().enumerate().map(|(index, item)| {
                    let tag = item.name.clone();
                    div()
                        .id(("menu-item", index))
                        .debug_selector(move || format!("menu-{tag}"))
                        .h(px(ROW))
                        .flex()
                        .items_center()
                        .gap(px(8.0))
                        .px(px(10.0))
                        .rounded(theme.skin.radius_md)
                        .cursor_pointer()
                        .text_size(px(13.0))
                        .when(item.danger, |row| row.text_color(theme.c.bad))
                        .hover(move |style| style.bg(hover))
                        // Not also a press on the backdrop underneath.
                        .on_mouse_down(gpui::MouseButton::Left, |_, _, cx| cx.stop_propagation())
                        .on_click(cx.listener(move |shell, _, window, cx| {
                            shell.choose(index, window, cx);
                        }))
                        .child(div().flex_1().min_w_0().truncate().child(item.name.clone()))
                        .when(item.ticked, |row| {
                            row.child(icon("check", 13.0, theme.c.accent_text))
                        })
                })),
        )
}

/// The open dialog, over a veil.
pub(super) fn render_prompt(
    prompt: &Prompt,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let (title, _, confirm) = prompt.question.wording();
    let mut veil = gpui::black();
    veil.a = 0.5;
    let hover = theme.c.hover;
    let fill = if prompt.question.destructive() {
        theme.c.bad
    } else {
        theme.c.accent
    };
    div()
        .id("prompt")
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(400.0))
                .flex()
                .flex_col()
                .gap(px(14.0))
                .p(px(22.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(EMPHASIS)
                        .child(label(title, theme)),
                )
                .when_some(prompt.input.clone(), |dialog, input| {
                    dialog.child(
                        div()
                            .h(px(38.0))
                            .flex()
                            .items_center()
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
                            div()
                                .id("prompt-cancel")
                                .debug_selector(|| "prompt-cancel".to_owned())
                                .h(px(36.0))
                                .px(px(18.0))
                                .flex()
                                .items_center()
                                .rounded(theme.skin.radius_md)
                                .cursor_pointer()
                                .text_color(theme.c.muted)
                                .hover(move |style| style.bg(hover))
                                .on_click(cx.listener(|shell, _, _, cx| shell.close_prompt(cx)))
                                .child(label("Cancel", theme)),
                        )
                        .child(
                            div()
                                .id("prompt-ok")
                                .debug_selector(|| "prompt-ok".to_owned())
                                .h(px(36.0))
                                .px(px(18.0))
                                .flex()
                                .items_center()
                                .rounded(theme.skin.radius_md)
                                .cursor_pointer()
                                .bg(fill)
                                .text_color(theme.c.on_accent)
                                .font_weight(EMPHASIS)
                                .on_click(cx.listener(|shell, _, _, cx| shell.answer_prompt(cx)))
                                .child(label(confirm, theme)),
                        ),
                ),
        )
}

/// The card with a user's comment or a channel's description.
pub(super) fn render_info(
    info: &super::Info,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut veil = gpui::black();
    veil.a = 0.5;
    let hover = theme.c.hover;
    let body = match &info.body {
        None => div()
            .text_color(theme.c.muted)
            .child("Fetching…")
            .into_any_element(),
        Some(body) if body.is_empty() => div()
            .text_color(theme.c.muted)
            .child("Nothing has been written here.")
            .into_any_element(),
        Some(body) => {
            super::conversation::body_text(body, usize::MAX - 1, theme.c.accent_text, theme)
                .into_any_element()
        }
    };
    div()
        .id("info")
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .items_center()
        .justify_center()
        .child(
            div()
                .w(px(460.0))
                .max_h(px(520.0))
                .flex()
                .flex_col()
                .gap(px(14.0))
                .p(px(22.0))
                .rounded(theme.skin.radius_lg)
                .bg(opaque(theme.c.card, theme.c.bg0))
                .border_1()
                .border_color(theme.c.line2)
                .shadow_lg()
                .child(
                    div()
                        .text_size(px(16.0))
                        .font_weight(EMPHASIS)
                        .child(info.title.clone()),
                )
                .when(!info.facts.is_empty(), |card| {
                    card.child(
                        div()
                            .debug_selector(|| "info-facts".to_owned())
                            .flex()
                            .flex_col()
                            .gap(px(4.0))
                            .text_size(px(12.5))
                            .children(info.facts.iter().map(|(name, value)| {
                                div()
                                    .flex()
                                    .gap(px(12.0))
                                    .child(
                                        div()
                                            .flex_none()
                                            .w(px(130.0))
                                            .text_color(theme.c.muted)
                                            .child(name.clone()),
                                    )
                                    .child(div().flex_1().min_w_0().child(value.clone()))
                            })),
                    )
                })
                .child(
                    div()
                        .id("info-body")
                        .flex_1()
                        .min_h_0()
                        .overflow_y_scroll()
                        .text_size(px(13.5))
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
        }
    }

    fn names(items: &[Item]) -> Vec<&str> {
        items.iter().map(|item| item.name.as_ref()).collect()
    }

    #[test]
    fn somebody_else_gets_message_volume_and_moderation() {
        let items = user_items(&user(3, 1), Some(1), Some(1), 1.0);
        assert_eq!(
            names(&items),
            [
                "Message",
                "View comment",
                "Mute here",
                "Volume 50%",
                "Volume 100%",
                "Volume 150%",
                "Priority speaker",
                "Mute for everyone",
                "Deafen for everyone",
                "Register",
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
        let items = user_items(&elsewhere, Some(1), Some(1), 0.0);
        assert!(names(&items).contains(&"Move to my channel"));
        assert!(names(&items).contains(&"Unmute for everyone"));
        assert!(items[2].ticked, "muted here");
    }

    #[test]
    fn oneself_gets_the_profile_entries_only() {
        let items = user_items(&user(1, 1), Some(1), Some(1), 1.0);
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
            listening: false,
        };
        assert_eq!(
            names(&channel_items(&channel(0, None), Some(1), false)),
            [
                "Open",
                "Join",
                "Join with a password…",
                "Listen without joining",
                "About this channel",
                "New channel inside…",
                "Rename…"
            ]
        );
        assert_eq!(
            names(&channel_items(&channel(1, Some(0)), Some(1), false)),
            [
                "Open",
                "About this channel",
                "New channel inside…",
                "Rename…",
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
            })
        );
        assert_eq!(
            Question::NewChannelWithHistory(1).answered("Notes"),
            Some(Action::CreateChannel {
                parent: 1,
                name: "Notes".to_owned(),
                history: true,
            })
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
