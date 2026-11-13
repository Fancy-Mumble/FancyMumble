//! The conversation: the channel's header, its messages and the composer.

use std::ops::Range;
use std::sync::Arc;

use gpui::{
    AnyElement, Context, Focusable, HighlightStyle, Hsla, InteractiveText, IntoElement,
    ParentElement, SharedString, Styled, StyledText, Window, div, list, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Corner, IconButton, Nearest, Paper, Tone, Variant};
use super::widgets::{EMPHASIS, Zone, clock, icon, label};
use crate::engine::{Action, Conversation, Message, Poll, PollOption};
use crate::rich::Rich;
use crate::theme::{Fill, Theme};

/// How many links' cards are remembered before the lot is forgotten.
const MAX_PREVIEWS: usize = 256;

/// One row of the conversation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Row {
    /// The rule that starts a day, with what to call it.
    Day(SharedString),
    /// The message at this index.
    Message(usize),
    /// The way to the messages before the first one shown.
    Earlier,
    /// The poll at this place among the channel's.
    Poll(usize),
}

/// Put each poll among `rows` where it arrived: before the first message
/// sent after it, or at the end.
pub(super) fn place_polls(rows: &mut Vec<Row>, messages: &[Message], polls: &[Poll]) {
    if polls.is_empty() {
        return;
    }
    let mut placed = Vec::with_capacity(rows.len() + polls.len());
    let mut next = 0;
    for row in rows.drain(..) {
        if let Row::Message(index) = row {
            let sent = messages.get(index).and_then(|message| message.sent_at_ms);
            while next < polls.len() && sent.is_some_and(|sent| sent > polls[next].at_ms) {
                placed.push(Row::Poll(next));
                next += 1;
            }
        }
        placed.push(row);
    }
    placed.extend((next..polls.len()).map(Row::Poll));
    *rows = placed;
}

/// The calendar day `at_ms` falls on, counted from the epoch, on `zone`.
fn day_of(at_ms: u64, zone: Zone) -> i64 {
    zone.wall_seconds(at_ms).div_euclid(86_400)
}

/// What to call `day`, seen from `today`.
fn day_label(day: i64, today: i64) -> String {
    match today - day {
        0 => "Today".to_owned(),
        1 => "Yesterday".to_owned(),
        _ => chrono::DateTime::from_timestamp(day.saturating_mul(86_400), 0)
            .map(|date| date.format("%a, %b %-d").to_string())
            .unwrap_or_default(),
    }
}

/// `messages` as rows: each message, with a rule before the first of every
/// day. A message that carries no time belongs to the day of the one before
/// it, or to today when there is none.
pub(super) fn rows(messages: &[Message], now_ms: u64, zone: Zone) -> Vec<Row> {
    let today = day_of(now_ms, zone);
    let mut rows = Vec::with_capacity(messages.len() + 1);
    let mut current = None;
    for (index, message) in messages.iter().enumerate() {
        let day = message
            .sent_at_ms
            .map(|at| day_of(at, zone))
            .or(current)
            .unwrap_or(today);
        if current != Some(day) {
            current = Some(day);
            rows.push(Row::Day(day_label(day, today).into()));
        }
        rows.push(Row::Message(index));
    }
    rows
}

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    window: &Window,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .flex_1()
        .min_w_0()
        .h_full()
        .relative()
        .flex()
        .flex_col()
        .child(super::kit::backdrop(
            &theme.c.backdrop,
            theme.c.canvas_b,
            px(0.0),
        ))
        // Files dragged in from outside are sent to whoever is on screen.
        .on_drop(cx.listener(|shell, dropped: &gpui::ExternalPaths, _, cx| {
            shell.send_files(dropped.paths().to_vec(), cx);
        }))
        .child(header(shell, theme, cx))
        .child(
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .flex_col()
                .when_some(shell.welcome_to_show(), |column, welcome| {
                    column.child(welcome_card(&welcome, theme, cx))
                })
                .child(
                    list(
                        shell.rows.clone(),
                        cx.processor(|shell, row: usize, _, cx| shell.render_row(row, cx)),
                    )
                    .flex_1()
                    .min_h_0(),
                )
                .when_some(shell.notice.clone(), |column, notice| {
                    column.child(notice_strip(notice, theme, cx))
                })
                .when_some(writing_line(&shell.writers()), |column, line| {
                    column.child(
                        div()
                            .debug_selector(|| "writing".to_owned())
                            .flex_none()
                            .px(px(30.0))
                            .text_size(px(12.0))
                            .text_color(theme.c.muted)
                            .child(line),
                    )
                })
                .children(key_request_strips(shell, theme, cx))
                .when(shell.editing.is_some(), |column| {
                    column.child(composer_strip(
                        "pencil",
                        "Changing a message. Enter saves it.".into(),
                        theme,
                        cx,
                    ))
                })
                .when_some(shell.replying.clone(), |column, (_, said)| {
                    column.child(composer_strip("reply", said, theme, cx))
                })
                .child(composer(shell, window, cx)),
        )
}

/// The line under a channel's name: who is there, and what becomes of
/// what is said.
fn channel_words(channel: Option<&crate::engine::Channel>, people: usize) -> String {
    match channel {
        Some(channel) if channel.encrypted => {
            format!("{people} in voice · messages are kept, end-to-end encrypted")
        }
        Some(channel) if channel.history => format!("{people} in voice · messages are kept"),
        _ => format!("{people} in voice"),
    }
}

fn header(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let (glyph, name, about, people) = match shell.open {
        Some(Conversation::Channel(id)) => {
            let channel = shell
                .snapshot
                .channels
                .iter()
                .find(|channel| channel.id == id);
            let name = channel.map_or_else(SharedString::default, |channel| channel.name.clone());
            let people = shell.occupant_count(id);
            let about = channel_words(channel, people);
            ("hash", name, about, Some(people))
        }
        Some(Conversation::Direct(session)) => {
            let name = shell
                .snapshot
                .users
                .iter()
                .find(|user| user.session == session)
                .map_or_else(SharedString::default, |user| user.name.clone());
            ("at-sign", name, "Direct message".to_owned(), None)
        }
        None => ("hash", "No channel".into(), String::new(), None),
    };
    // Reading a channel the user is not in: offer the way in.
    let joinable = match shell.open {
        Some(Conversation::Channel(id)) if shell.snapshot.current_channel != Some(id) => Some(id),
        _ => None,
    };
    let open_channel = match shell.open {
        Some(Conversation::Channel(id)) => Some(id),
        _ => None,
    };
    div()
        .flex_none()
        .h(theme.skin.header_height)
        .flex()
        .items_center()
        .gap(px(6.0))
        .pl(px(26.0))
        // A theme with no band floats the window's controls over this corner.
        .pr(px(if theme.skin.band { 26.0 } else { 150.0 }))
        .bg(theme.c.header)
        .border_b_1()
        .border_color(theme.c.line)
        .child(icon(glyph, 15.0, theme.c.dim))
        .child(title(&name, about, open_channel, theme, cx))
        .child(div().flex_1())
        .when_some(joinable, |header, channel| {
            header.child(
                div()
                    .id("join")
                    .debug_selector(|| "join".to_owned())
                    .mr(px(8.0))
                    .px(px(14.0))
                    .py(px(5.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.accent)
                    .text_color(theme.c.on_accent)
                    .text_size(px(12.5))
                    .font_weight(EMPHASIS)
                    .cursor_pointer()
                    .hover(|style| style.opacity(0.9))
                    .on_click(cx.listener(move |shell, _, _, _| shell.engine.join_channel(channel)))
                    .child(label("Join", theme)),
            )
        })
        .child(header_tools(shell, people, open_channel, theme, cx))
}

/// A conversation's name over what there is to say about it. For a channel
/// the name is the way into the channel's menu.
fn title(
    name: &SharedString,
    about: String,
    open_channel: Option<crate::engine::ChannelId>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .id("conversation-title")
        .debug_selector(|| "conversation-title".to_owned())
        .min_w_0()
        .flex()
        .flex_col()
        .px(px(6.0))
        .rounded(theme.skin.radius_md)
        .when_some(open_channel, |title, channel| {
            title.cursor_pointer().on_click(cx.listener(
                move |shell, event: &gpui::ClickEvent, _, cx| {
                    shell.open_channel_menu(channel, event.position(), cx);
                },
            ))
        })
        .child(
            div()
                .flex()
                .items_center()
                .gap(px(3.0))
                .child(
                    div()
                        .truncate()
                        .pt(px(1.0))
                        .mb(px(-1.0))
                        .font_weight(EMPHASIS)
                        .text_size(px(14.0))
                        .line_height(px(21.7))
                        .child(label(name, theme)),
                )
                .when(open_channel.is_some(), |line| {
                    line.child(icon("chevron-down", 13.0, theme.c.dim))
                }),
        )
        .child(
            div()
                .text_size(px(11.0))
                .line_height(px(17.05))
                .text_color(theme.c.muted)
                .child(about),
        )
}

/// The buttons at the header's trailing end: how many are here, the search,
/// the pins, and the rest.
fn header_tools(
    shell: &Shell,
    people: Option<usize>,
    channel: Option<crate::engine::ChannelId>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let pinned = shell.only_pinned;
    div()
        .flex()
        .items_center()
        .gap(px(3.0))
        .when_some(people, |tools, people| {
            tools.child(
                div()
                    .h(px(28.0))
                    .pl(px(9.0))
                    .pr(px(8.0))
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .child(icon("users", 14.0, theme.c.muted))
                    .child(
                        div()
                            .font_weight(EMPHASIS)
                            .text_size(px(11.5))
                            .text_color(theme.c.muted)
                            .child(SharedString::from(people.to_string())),
                    ),
            )
        })
        .child(
            IconButton::new("find", "search")
                .on_click(cx.listener(|shell, _, window, cx| shell.focus_search(window, cx))),
        )
        .child(
            // How many are pinned rides beside the pin once there are any.
            div()
                .flex()
                .items_center()
                .child(
                    IconButton::new("pins", "pin")
                        .tone(if pinned { Tone::Accent } else { Tone::Muted })
                        .variant(if pinned {
                            Variant::Soft
                        } else {
                            Variant::Ghost
                        })
                        .on_click(cx.listener(|shell, _, _, cx| {
                            shell.only_pinned = !shell.only_pinned;
                            shell.reload_messages(cx);
                            cx.notify();
                        })),
                )
                .when(shell.pins > 0, |pins| {
                    pins.child(
                        div()
                            .debug_selector(|| "pin-count".to_owned())
                            .pl(px(3.0))
                            .pr(px(4.0))
                            .font_weight(EMPHASIS)
                            .text_size(px(11.5))
                            .text_color(theme.c.muted)
                            .child(SharedString::from(shell.pins.to_string())),
                    )
                }),
        )
        .child(
            IconButton::new("conversation-menu", "ellipsis-vertical").on_click(cx.listener(
                move |shell, event: &gpui::ClickEvent, _, cx| match channel {
                    Some(channel) => shell.open_channel_menu(channel, event.position(), cx),
                    None => {
                        let items = super::menu::session_items(&SharedString::default(), true);
                        shell.open_menu(event.position(), items, cx);
                    }
                },
            )),
        )
}

/// The server's welcome message, at the head of the conversation until it
/// is dismissed.
fn welcome_card(
    welcome: &DrawnBody,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div().flex_none().px(px(10.0)).pt(px(10.0)).child(
        div()
            .flex()
            .items_start()
            .gap(px(10.0))
            .px(px(14.0))
            .py(px(10.0))
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(13.0))
            .child(div().flex_1().min_w_0().child(body_text(
                welcome,
                Place::aside(usize::MAX),
                theme.c.accent_text,
                theme,
            )))
            .child(
                div()
                    .id("dismiss-welcome")
                    .debug_selector(|| "dismiss-welcome".to_owned())
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.welcome_dismissed = true;
                        cx.notify();
                    }))
                    .child(icon("x", 13.0, theme.c.muted)),
            ),
    )
}

/// What the engine had to say, above the composer, until it is dismissed.
fn notice_strip(
    notice: SharedString,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut soft = theme.c.bad;
    soft.a = 0.14;
    let mut edge = theme.c.bad;
    edge.a = 0.45;
    div().flex_none().px(px(10.0)).pt(px(8.0)).child(
        div()
            .flex()
            .items_center()
            .gap(px(10.0))
            .px(px(14.0))
            .py(px(8.0))
            .rounded(theme.skin.radius_md)
            .bg(soft)
            .border_1()
            .border_color(edge)
            .text_size(px(12.5))
            .child(div().flex_1().min_w_0().child(notice))
            .child(
                div()
                    .id("dismiss-notice")
                    .debug_selector(|| "dismiss-notice".to_owned())
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.notice = None;
                        cx.notify();
                    }))
                    .child(icon("x", 13.0, theme.c.muted)),
            ),
    )
}

/// Who is writing, in words: one name, two, or how many.
pub(super) fn writing_line(writers: &[SharedString]) -> Option<SharedString> {
    Some(
        match writers {
            [] => return None,
            [one] => format!("{one} is writing…"),
            [one, other] => format!("{one} and {other} are writing…"),
            many => format!("{} people are writing…", many.len()),
        }
        .into(),
    )
}

/// One strip for each person asking for the open channel's key: who, and
/// the two answers.
fn key_request_strips(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    let Some(Conversation::Channel(channel)) = shell.open else {
        return Vec::new();
    };
    let hover = theme.c.hover;
    shell
        .key_requests
        .iter()
        .enumerate()
        .map(|(at, asking)| {
            let answer = |share: bool, id: &'static str, says: &'static str| {
                let hash = asking.hash.to_string();
                let name = asking.name.clone();
                div()
                    .id((id, at))
                    .debug_selector(move || format!("{id}-{name}"))
                    .px(px(10.0))
                    .py(px(3.0))
                    .rounded(theme.skin.radius_pill)
                    .cursor_pointer()
                    .when(share, |button| {
                        button
                            .bg(theme.c.accent)
                            .text_color(theme.c.on_accent)
                            .font_weight(EMPHASIS)
                    })
                    .hover(move |style| {
                        if share {
                            style.opacity(0.9)
                        } else {
                            style.bg(hover)
                        }
                    })
                    .on_click(cx.listener(move |shell, _, _, _| {
                        shell.engine.act(Action::AnswerKeyRequest {
                            channel,
                            hash: hash.clone(),
                            share,
                        });
                    }))
                    .child(says)
            };
            div()
                .flex_none()
                .mx(px(10.0))
                .mb(px(4.0))
                .px(px(14.0))
                .py(px(6.0))
                .flex()
                .items_center()
                .gap(px(8.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.accent_soft)
                .text_size(px(12.0))
                .child(icon("key-round", 12.0, theme.c.accent_text))
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .truncate()
                        .child(SharedString::from(format!(
                            "{} asks for this channel's key, to read what is kept here.",
                            asking.name
                        ))),
                )
                .child(answer(false, "refuse-key", "Not now"))
                .child(answer(true, "share-key", "Share the key"))
                .into_any_element()
        })
        .collect()
}

/// A message in a line: who said it, and how it starts.
pub(super) fn said_by(message: &Message) -> SharedString {
    const SHOWN: usize = 90;
    let mut said = format!("{}: ", message.sender_name);
    let mut words = message.body.chars();
    said.extend(
        words
            .by_ref()
            .take(SHOWN)
            .map(|c| if c == '\n' { ' ' } else { c }),
    );
    if words.next().is_some() {
        said.push('…');
    }
    said.into()
}

/// Says what the composer is for just now, when it is not for a new
/// message: one being changed, one being answered. And the way out.
fn composer_strip(
    glyph: &'static str,
    says: SharedString,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    div()
        .debug_selector(move || {
            if glyph == "reply" {
                "replying"
            } else {
                "editing"
            }
            .to_owned()
        })
        .flex_none()
        .mx(px(10.0))
        .px(px(20.0))
        .py(px(6.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.accent_soft)
        .text_size(px(12.0))
        .child(icon(glyph, 12.0, theme.c.accent_text))
        .child(div().flex_1().min_w_0().truncate().child(says))
        .child(
            div()
                .id("stop-editing")
                .debug_selector(|| "stop-editing".to_owned())
                .size(px(20.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(theme.skin.radius_sm)
                .cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, _, cx| shell.stop_editing(cx)))
                .child(icon("x", 12.0, theme.c.muted)),
        )
}

fn composer(shell: &Shell, window: &Window, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let armed = !shell.composer.read(cx).text().trim().is_empty();
    let focused = shell.composer.focus_handle(cx).is_focused(window);
    // The same gutter the conversation keeps for its scrollbar.
    div().flex_none().p(px(10.0)).pr(px(19.0)).child(
        Paper::field()
            .lit(focused)
            // Grows with what is typed, up to a few lines.
            .min_h(px(54.0))
            .max_h(px(180.0))
            .overflow_hidden()
            .py(px(11.0))
            .px(px(15.0))
            .flex()
            .items_center()
            .gap(px(9.0))
            .text_size(px(14.0))
            .line_height(px(19.6))
            .child(
                div()
                    .flex_none()
                    .flex()
                    .items_center()
                    .gap(px(3.0))
                    .child(
                        // On a server that takes no files it still sends
                        // pictures, in the message itself.
                        IconButton::new("attach", "paperclip")
                            .dims(28.0, 32.0)
                            .glyph_size(16.0)
                            .faded(!shell.snapshot.fancy)
                            .on_click(cx.listener(|shell, _, _, cx| shell.pick_file_to_send(cx))),
                    )
                    .child(
                        IconButton::new("compose-more", "chevron-down")
                            .dims(16.0, 32.0)
                            .glyph_size(10.0)
                            .corner(Corner::Small)
                            .on_click(cx.listener(|shell, event: &gpui::ClickEvent, _, cx| {
                                let items =
                                    super::menu::compose_items(shell.open, shell.snapshot.fancy);
                                shell.open_menu(event.position(), items, cx);
                            })),
                    ),
            )
            .child(shell.composer.clone())
            .child(
                IconButton::new("send", "send")
                    .size(32.0)
                    .corner(Corner::Pill)
                    .variant(if armed {
                        Variant::Solid
                    } else {
                        Variant::Filled
                    })
                    .tone(Tone::Dim)
                    .on_click(cx.listener(|shell, _, _, cx| shell.send_composed(cx))),
            ),
    )
}

impl Shell {
    /// One row of the conversation. Called only for rows near the viewport.
    fn render_row(&mut self, row: usize, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let index = match self.row_model.get(row) {
            Some(Row::Day(name)) => {
                return row_frame().child(day_rule(name, &theme)).into_any_element();
            }
            Some(Row::Earlier) => return Self::earlier_row(&theme, cx),
            Some(Row::Poll(at)) => return self.poll_row(*at, &theme, cx),
            Some(Row::Message(index)) => *index,
            None => return div().into_any_element(),
        };
        let body = self.drawn_body(index);
        let Some(message) = self.messages.get(index) else {
            return div().into_any_element();
        };
        // A run is one person talking: the name and picture are said once.
        // A new day starts a new run, since a rule sits between the two.
        let continues = row
            .checked_sub(1)
            .and_then(|above| match self.row_model.get(above) {
                Some(Row::Message(previous)) => self.messages.get(*previous),
                _ => None,
            })
            .is_some_and(|previous| {
                previous.sender == message.sender
                    && previous.sender_name == message.sender_name
                    && previous.own == message.own
            });
        let gap = if continues {
            theme.skin.message_run_gap
        } else {
            theme.skin.message_gap
        };
        // Under the bubble: what lies behind its link, then its reactions.
        let viewer = cx.weak_entity();
        let at = Place {
            row,
            viewer: Some(&viewer),
        };
        let quoted = self.quoted(index, &theme);
        let under: Vec<AnyElement> = self
            .file_cards(index, &theme, cx)
            .into_iter()
            .chain(self.preview_card(index, &theme))
            .chain(self.reaction_chips(index, &theme, cx))
            .collect();
        let message = &self.messages[index];
        let body = if message.own {
            let (seen, seen_by) = self.seen_marks(index);
            own_message(message, &body, at, under, seen, &seen_by, self.zone, &theme)
                .into_any_element()
        } else {
            {
                let picture = message.sender.and_then(|session| {
                    self.snapshot
                        .users
                        .iter()
                        .find(|user| user.session == session)
                        .and_then(|user| user.avatar.clone())
                });
                their_message(
                    message,
                    &body,
                    at,
                    picture.as_ref(),
                    continues,
                    under,
                    self.zone,
                    &theme,
                )
                .into_any_element()
            }
        };
        row_frame()
            .debug_selector(move || format!("message-{index}"))
            .pt(gap)
            .on_mouse_down(
                gpui::MouseButton::Right,
                cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                    shell.open_message_menu(event.position, index, cx);
                }),
            )
            .children(quoted)
            .child(body)
            .into_any_element()
    }

    /// What message `index` is a reply to, in a line above it: who said
    /// it and how it starts, or that it is further back than is shown.
    fn quoted(&self, index: usize, theme: &Theme) -> Option<AnyElement> {
        let message = self.messages.get(index)?;
        let to = message.reply_to.as_ref()?;
        let said = self
            .place_of(to)
            .and_then(|at| self.messages.get(at))
            .map_or_else(|| SharedString::from("An earlier message"), said_by);
        Some(
            div()
                .debug_selector(move || format!("quoted-{index}"))
                .flex()
                // Over the bubble it belongs to: theirs sits past the
                // picture column, the local user's at the far edge.
                .map(|line| {
                    if message.own {
                        line.justify_end()
                    } else {
                        line.pl(px(50.0))
                    }
                })
                .pb(px(3.0))
                .child(
                    div()
                        .max_w(px(420.0))
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .pl(px(8.0))
                        .border_l_2()
                        .border_color(theme.c.accent_line)
                        .text_size(px(12.0))
                        .text_color(theme.c.muted)
                        .child(icon("reply", 11.0, theme.c.dim))
                        .child(div().min_w_0().truncate().child(said)),
                )
                .into_any_element(),
        )
    }
}

/// A message's body, read once and kept: its runs of text, and its pictures
/// as GPUI holds them.
#[derive(Debug)]
pub(super) struct DrawnBody {
    rich: Rich,
    pictures: Vec<Arc<gpui::Image>>,
}

impl DrawnBody {
    /// Read `html`.
    pub(super) fn read(html: &str) -> Self {
        let mut rich = Rich::parse(html);
        let pictures = std::mem::take(&mut rich.images)
            .into_iter()
            .filter_map(crate::picture::picture)
            .map(Arc::new)
            .collect();
        Self { rich, pictures }
    }

    /// The address of the first link in it.
    fn first_link(&self) -> Option<SharedString> {
        self.rich
            .links
            .first()
            .map(|(_, address)| SharedString::from(address.clone()))
    }

    /// Whether there is nothing in it to show.
    pub(super) fn is_empty(&self) -> bool {
        self.rich.text.is_empty() && self.pictures.is_empty()
    }
}

impl Shell {
    /// Whether somebody has read the local user's message at `index`,
    /// which earns it a second tick, and by whom: named under the newest
    /// such message only.
    fn seen_marks(&self, index: usize) -> (bool, Vec<SharedString>) {
        let read = |at: usize| self.seen.until.is_some_and(|until| at <= until);
        if !read(index) {
            return (false, Vec::new());
        }
        let newest_read = !self
            .messages
            .iter()
            .enumerate()
            .skip(index + 1)
            .any(|(at, later)| later.own && read(at));
        let by = if newest_read {
            self.seen_by(index)
        } else {
            Vec::new()
        };
        (true, by)
    }

    /// A poll: what is asked, and each answer with how many chose it. A
    /// click on an answer chooses it, or takes the choice back.
    fn poll_row(&self, at: usize, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let (Some(poll), Some(Conversation::Channel(channel))) = (self.polls.get(at), self.open)
        else {
            return div().into_any_element();
        };
        let most = poll
            .options
            .iter()
            .map(|option| option.votes)
            .max()
            .unwrap_or(0);
        let chosen: Vec<u32> = poll
            .options
            .iter()
            .zip(0_u32..)
            .filter(|(option, _)| option.own)
            .map(|(_, place)| place)
            .collect();
        let options = poll.options.iter().zip(0_u32..).map(|(option, place)| {
            // What the answer would be after a click here.
            let selected: Vec<u32> = match (poll.multiple, option.own) {
                (_, true) => chosen
                    .iter()
                    .copied()
                    .filter(|held| *held != place)
                    .collect(),
                (true, false) => chosen.iter().copied().chain([place]).collect(),
                (false, false) => vec![place],
            };
            let act = Action::Vote {
                channel,
                poll: poll.id.to_string(),
                selected,
            };
            poll_option(option, (at, place), most, theme)
                .on_click(cx.listener(move |shell, _, _, _| shell.engine.act(act.clone())))
        });
        let about = format!(
            "{} asks · choose {}",
            poll.by,
            if poll.multiple { "any" } else { "one" }
        );
        row_frame()
            .pt(theme.skin.message_gap)
            .child(
                div()
                    .max_w(px(420.0))
                    .flex()
                    .flex_col()
                    .gap(px(6.0))
                    .p(px(12.0))
                    .rounded(theme.skin.radius_lg)
                    .bg(theme.c.card)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(13.0))
                    .child(
                        div()
                            .text_size(px(14.0))
                            .font_weight(EMPHASIS)
                            .child(poll.question.clone()),
                    )
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.c.muted)
                            .child(SharedString::from(about)),
                    )
                    .children(options),
            )
            .into_any_element()
    }

    /// The way to the messages before the first one shown.
    fn earlier_row(theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let hover = theme.c.hover;
        row_frame()
            .py(px(10.0))
            .flex()
            .justify_center()
            .child(
                div()
                    .id("earlier")
                    .debug_selector(|| "earlier".to_owned())
                    .px(px(14.0))
                    .py(px(5.0))
                    .rounded(theme.skin.radius_pill)
                    .border_1()
                    .border_color(theme.c.line2)
                    .text_size(px(12.0))
                    .text_color(theme.c.muted)
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(|shell, _, _, cx| shell.show_earlier(cx)))
                    .child("Show earlier messages"),
            )
            .into_any_element()
    }

    /// The reactions on message `index`, each a chip that adds the local
    /// user's to it or takes it off; `None` when there are none.
    fn reaction_chips(
        &self,
        index: usize,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> Option<AnyElement> {
        let message = self.messages.get(index)?;
        let (Some(Conversation::Channel(channel)), Some(id)) = (self.open, message.id.as_ref())
        else {
            return None;
        };
        if message.reactions.is_empty() {
            return None;
        }
        let hover = theme.c.hover;
        Some(
            div()
                .flex()
                .flex_wrap()
                .gap(px(4.0))
                .children(message.reactions.iter().enumerate().map(|(at, reaction)| {
                    let act = Action::React {
                        channel,
                        id: id.to_string(),
                        emoji: reaction.emoji.to_string(),
                        add: !reaction.own,
                    };
                    let tag = reaction.emoji.clone();
                    div()
                        .id(("reaction", index * 64 + at))
                        .debug_selector(move || format!("chip-{index}-{tag}"))
                        .h(px(24.0))
                        .px(px(8.0))
                        .flex()
                        .items_center()
                        .gap(px(5.0))
                        .rounded(theme.skin.radius_pill)
                        .border_1()
                        .text_size(px(12.0))
                        .cursor_pointer()
                        .map(|chip| {
                            if reaction.own {
                                chip.bg(theme.c.accent_soft)
                                    .border_color(theme.c.accent_line)
                            } else {
                                chip.bg(theme.c.card).border_color(theme.c.line2)
                            }
                        })
                        .hover(move |style| style.bg(hover))
                        .on_click(cx.listener(move |shell, _, _, _| shell.engine.act(act.clone())))
                        .child(reaction.emoji.clone())
                        .child(
                            div()
                                .text_color(theme.c.muted)
                                .child(SharedString::from(reaction.count.to_string())),
                        )
                }))
                .into_any_element(),
        )
    }

    /// The body of message `index`, read from its HTML the first time it is
    /// drawn. Only rows near the viewport are ever asked for.
    fn drawn_body(&mut self, index: usize) -> Arc<DrawnBody> {
        if let Some(drawn) = self.bodies.get(&index) {
            return Arc::clone(drawn);
        }
        let html = self
            .messages
            .get(index)
            .map_or("", |message| message.html.as_ref());
        let drawn = Arc::new(DrawnBody::read(html));
        let _ = self.bodies.insert(index, Arc::clone(&drawn));
        // The first time a message with a link is drawn, the server is
        // asked what lies behind it; a message never scrolled to costs
        // nothing.
        if self.snapshot.fancy
            && let Some(url) = drawn.first_link()
            && !self.previews.contains_key(&url)
        {
            // Bounded: a long session forgets and, at worst, asks again,
            // which the engine answers from what it holds.
            if self.previews.len() >= MAX_PREVIEWS {
                self.previews.clear();
            }
            let _ = self.previews.insert(url.clone(), None);
            self.engine.previews(vec![url]);
        }
        drawn
    }

    /// A card for each file message `index` shares: its name and size. A
    /// click saves it, or opens its link where that is all there is.
    fn file_cards(&self, index: usize, theme: &Theme, cx: &mut Context<Self>) -> Vec<AnyElement> {
        let Some(message) = self.messages.get(index) else {
            return Vec::new();
        };
        let hover = theme.c.hover;
        message
            .files
            .iter()
            .enumerate()
            .map(|(at, file)| {
                let (key, url, name) = (file.key.clone(), file.url.clone(), file.name.clone());
                div()
                    .id(("file", index * 16 + at))
                    .debug_selector(move || format!("file-{index}-{at}"))
                    .max_w(px(420.0))
                    .flex()
                    .items_center()
                    .gap(px(10.0))
                    .px(px(12.0))
                    .py(px(9.0))
                    .rounded(theme.skin.radius_md)
                    .bg(theme.c.card)
                    .border_1()
                    .border_color(theme.c.line2)
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        match (key.clone(), url.as_ref()) {
                            (Some(key), _) => shell.save_attachment(key, &name, cx),
                            (None, Some(url)) => cx.open_url(url),
                            (None, None) => {}
                        }
                    }))
                    .child(icon("file", 18.0, theme.c.muted))
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .flex()
                            .flex_col()
                            .child(
                                div()
                                    .truncate()
                                    .text_size(px(13.0))
                                    .font_weight(EMPHASIS)
                                    .child(file.name.clone()),
                            )
                            .when_some(file.size, |text, size| {
                                text.child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.c.muted)
                                        .child(SharedString::from(super::size_in_words(size))),
                                )
                            }),
                    )
                    .child(icon("download", 14.0, theme.c.muted))
                    .into_any_element()
            })
            .collect()
    }

    /// The card for what lies behind the first link of message `index`,
    /// once the server has said.
    fn preview_card(&self, index: usize, theme: &Theme) -> Option<AnyElement> {
        let url = self.bodies.get(&index)?.first_link()?;
        let preview = Arc::clone(self.previews.get(&url)?.as_ref()?);
        let address = url.clone();
        let hover = theme.c.hover;
        Some(
            div()
                .id(("preview", index))
                .debug_selector(move || format!("preview-{index}"))
                .max_w(px(420.0))
                .flex()
                .gap(px(10.0))
                .p(px(10.0))
                .rounded(theme.skin.radius_md)
                .bg(theme.c.card)
                .border_1()
                .border_color(theme.c.line2)
                .cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(move |_, _, cx| cx.open_url(&address))
                .when_some(preview.picture.clone(), |card, picture| {
                    card.child(
                        gpui::img(picture)
                            .flex_none()
                            .size(px(56.0))
                            .rounded(theme.skin.radius_sm)
                            .object_fit(gpui::ObjectFit::Cover),
                    )
                })
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .gap(px(2.0))
                        .when_some(preview.site.clone(), |text, site| {
                            text.child(
                                div()
                                    .truncate()
                                    .text_size(px(11.0))
                                    .text_color(theme.c.muted)
                                    .child(site),
                            )
                        })
                        .child(
                            div()
                                .truncate()
                                .text_size(px(13.0))
                                .font_weight(EMPHASIS)
                                .text_color(theme.c.accent_text)
                                .child(preview.title.clone().unwrap_or(url)),
                        )
                        .when_some(preview.description.clone(), |text, description| {
                            text.child(
                                div()
                                    .text_size(px(12.0))
                                    .text_color(theme.c.muted)
                                    .line_clamp(2)
                                    .child(description),
                            )
                        }),
                )
                .into_any_element(),
        )
    }
}

/// How each stretch of `rich` is drawn: its emphasis, and its links in
/// `link_ink`. The stretches come out in order and never overlap, which is
/// what the text element requires.
fn highlights(
    rich: &Rich,
    link_ink: Hsla,
    code_ground: Hsla,
) -> Vec<(Range<usize>, HighlightStyle)> {
    let mut cuts: Vec<usize> = rich
        .spans
        .iter()
        .map(|(range, _)| range)
        .chain(rich.links.iter().map(|(range, _)| range))
        .flat_map(|range| [range.start, range.end])
        .collect();
    cuts.sort_unstable();
    cuts.dedup();
    cuts.windows(2)
        .filter_map(|cut| {
            let range = cut[0]..cut[1];
            let inside =
                |other: &Range<usize>| other.start <= range.start && range.end <= other.end;
            let style = rich
                .spans
                .iter()
                .find(|(span, _)| inside(span))
                .map(|(_, style)| *style);
            let link = rich.links.iter().any(|(link, _)| inside(link));
            if style.is_none() && !link {
                return None;
            }
            let style = style.unwrap_or_default();
            let line = |color| gpui::UnderlineStyle {
                thickness: px(1.0),
                color,
                wavy: false,
            };
            Some((
                range,
                HighlightStyle {
                    // Somebody named stands out as a link does, on the
                    // ground code stands on.
                    color: (link || style.mention).then_some(link_ink),
                    font_weight: (style.bold || style.mention).then_some(EMPHASIS),
                    font_style: style.italic.then_some(gpui::FontStyle::Italic),
                    background_color: (style.code || style.mention).then_some(code_ground),
                    underline: (link || style.underline).then(|| line(link.then_some(link_ink))),
                    strikethrough: style.strike.then(|| gpui::StrikethroughStyle {
                        thickness: px(1.0),
                        color: None,
                    }),
                    fade_out: None,
                },
            ))
        })
        .collect()
}

/// A message's text, with its links live, and its pictures under it.
pub(super) fn body_text(
    body: &DrawnBody,
    at: Place<'_>,
    link_ink: Hsla,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let rich = &body.rich;
    let text = StyledText::new(rich.text.clone()).with_highlights(highlights(
        rich,
        link_ink,
        theme.c.card2,
    ));
    let (ranges, addresses): (Vec<_>, Vec<_>) = rich.links.iter().cloned().unzip();
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .when(!rich.text.is_empty(), |column| {
            column.child(InteractiveText::new(("message", at.row), text).on_click(
                ranges,
                move |link, _, cx| {
                    if let Some(address) = addresses.get(link) {
                        cx.open_url(address);
                    }
                },
            ))
        })
        .children(body.pictures.iter().enumerate().map(|(nth, picture)| {
            let (shown, viewer) = (Arc::clone(picture), at.viewer.cloned());
            div()
                .id(("picture", at.row.wrapping_mul(8).wrapping_add(nth)))
                .debug_selector(move || format!("picture-{}-{nth}", at.row))
                // A click looks at it larger, where there is somewhere to.
                .when_some(viewer, |tile, viewer| {
                    tile.cursor_pointer().on_click(move |_, _, cx| {
                        let _ = viewer.update(cx, |shell, cx| {
                            shell.lightbox = Some(Arc::clone(&shown));
                            cx.notify();
                        });
                    })
                })
                .child(
                    gpui::img(Arc::clone(picture))
                        .max_w(px(420.0))
                        .max_h(px(320.0))
                        .rounded(theme.skin.radius_md)
                        .object_fit(gpui::ObjectFit::Contain),
                )
        }))
}

/// The name a picture is offered to be saved under.
fn picture_file_name(picture: &gpui::Image) -> &'static str {
    match picture.format() {
        gpui::ImageFormat::Png => "picture.png",
        gpui::ImageFormat::Jpeg => "picture.jpg",
        gpui::ImageFormat::Gif => "picture.gif",
        gpui::ImageFormat::Webp => "picture.webp",
        _ => "picture",
    }
}

impl Shell {
    /// Ask where to, and write the picture being looked at there.
    fn save_lightbox_picture(&mut self, cx: &mut Context<Self>) {
        let Some(picture) = self.lightbox.clone() else {
            return;
        };
        let home = std::env::var_os("HOME").map_or_else(std::env::temp_dir, Into::into);
        let chosen = cx.prompt_for_new_path(&home, Some(picture_file_name(&picture)));
        cx.spawn(async move |shell, cx| {
            let Ok(Ok(Some(to))) = chosen.await else {
                return;
            };
            let written = cx
                .background_executor()
                .spawn(async move {
                    std::fs::write(&to, picture.bytes())
                        .map(|()| to)
                        .map_err(|e| e.to_string())
                })
                .await;
            let _ = shell.update(cx, |shell, cx| {
                shell.notice = Some(match written {
                    Ok(to) => format!("Saved {}.", to.display()).into(),
                    Err(problem) => format!("The picture could not be saved: {problem}").into(),
                });
                cx.notify();
            });
        })
        .detach();
    }
}

/// A picture as large as the window lets it be, over a veil. A click
/// anywhere closes it.
pub(super) fn render_lightbox(
    picture: &Arc<gpui::Image>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let mut veil = gpui::black();
    veil.a = 0.85;
    div()
        .id("lightbox")
        .debug_selector(|| "lightbox".to_owned())
        .absolute()
        .size_full()
        .top_0()
        .left_0()
        .occlude()
        .bg(veil)
        .flex()
        .flex_col()
        .items_center()
        .justify_center()
        .gap(px(12.0))
        .p(px(32.0))
        .on_click(cx.listener(|shell, _, _, cx| {
            shell.lightbox = None;
            cx.notify();
        }))
        .child(
            gpui::img(Arc::clone(picture))
                .flex_1()
                .min_h_0()
                .max_w_full()
                .object_fit(gpui::ObjectFit::Contain),
        )
        .child(
            div()
                .id("save-picture")
                .debug_selector(|| "save-picture".to_owned())
                .flex_none()
                .px(px(14.0))
                .py(px(6.0))
                .rounded(theme.skin.radius_pill)
                .bg(theme.c.card)
                .border_1()
                .border_color(theme.c.line2)
                .text_size(px(12.5))
                .cursor_pointer()
                .hover(|style| style.opacity(0.85))
                .on_click(cx.listener(|shell, _, _, cx| {
                    // Saving is not closing.
                    cx.stop_propagation();
                    shell.save_lightbox_picture(cx);
                }))
                .child("Save…"),
        )
}

/// Where a body is drawn: the row it is in, which names its parts, and the
/// shell a click on one of its pictures opens the picture in, if any.
#[derive(Clone, Copy)]
pub(super) struct Place<'a> {
    pub row: usize,
    pub viewer: Option<&'a gpui::WeakEntity<Shell>>,
}

impl Place<'_> {
    /// A body shown outside the conversation: a card, the welcome.
    pub(super) const fn aside(row: usize) -> Self {
        Self { row, viewer: None }
    }
}

/// One answer of a poll: its words over a bar that says how it stands
/// against the answer most chosen, and how many chose it. `at` is the
/// poll's place and the answer's, which name the row.
fn poll_option(
    option: &PollOption,
    at: (usize, u32),
    most: u32,
    theme: &Theme,
) -> gpui::Stateful<gpui::Div> {
    let (poll, place) = at;
    #[allow(
        clippy::cast_precision_loss,
        reason = "a share of a width; a vote count is nowhere near 2^24"
    )]
    let share = if most == 0 {
        0.0
    } else {
        option.votes as f32 / most as f32
    };
    let hover = theme.c.hover;
    div()
        .id(("poll-option", poll * 64 + place as usize))
        .debug_selector(move || format!("poll-{poll}-{place}"))
        .relative()
        .h(px(30.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(10.0))
        .rounded(theme.skin.radius_md)
        .border_1()
        .border_color(if option.own {
            theme.c.accent_line
        } else {
            theme.c.line2
        })
        .overflow_hidden()
        .cursor_pointer()
        .hover(move |style| style.bg(hover))
        .child(
            div()
                .absolute()
                .top_0()
                .left_0()
                .h_full()
                .w(gpui::relative(share))
                .bg(theme.c.accent_soft),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(option.text.clone()),
        )
        .when(option.own, |row| {
            row.child(icon("check", 12.0, theme.c.accent_text))
        })
        .child(
            div()
                .text_size(px(12.0))
                .text_color(theme.c.muted)
                .child(SharedString::from(option.votes.to_string())),
        )
}

/// A conversation row: the full width of the column, inset from its edges.
fn row_frame() -> gpui::Div {
    // The trailing nine pixels are the gutter a scrollbar would take.
    div().w_full().pl(px(10.0)).pr(px(19.0))
}

/// The rule that starts a day, with the day on a pill in the middle.
fn day_rule(name: &SharedString, theme: &Theme) -> impl IntoElement + use<> {
    let rule = || div().flex_1().h(theme.skin.line_width).bg(theme.c.line);
    div()
        .w_full()
        .pt(px(26.0))
        .flex()
        .items_center()
        .gap(px(14.0))
        .child(rule())
        .child(
            div()
                .px(px(10.5))
                .py(px(3.0))
                .rounded(theme.skin.radius_lg)
                .bg(theme.c.card)
                .border_1()
                .border_color(theme.c.line)
                .text_size(px(10.5))
                .line_height(px(16.275))
                .text_color(theme.c.muted)
                .child(label(name, theme)),
        )
        .child(rule())
}

/// A message's plate, of `fill` on a ground of `edge`: the large corner
/// all round but the one nearest its sender.
fn bubble(fill: Hsla, edge: Hsla, own: bool) -> Paper {
    Paper::plate(fill, edge)
        .nearest(if own {
            Nearest::Trailing
        } else {
            Nearest::Leading
        })
        .max_w(px(620.0))
        // Fourteen and nine all round in the web UI. A browser sets the
        // line a pixel lower in its box than this text system does, and
        // measures it a fraction narrower: both are taken up here.
        .pl(px(14.0))
        .pr(px(13.0))
        .pt(px(10.0))
        .pb(px(8.0))
        .text_size(px(14.0))
        .line_height(px(21.7))
}

/// The time beside a name or under a bubble.
fn stamp(time: SharedString, theme: &Theme) -> gpui::Div {
    div()
        .text_size(px(9.5))
        .line_height(px(13.3))
        .text_color(theme.c.dim)
        .child(time)
}

#[allow(
    clippy::too_many_arguments,
    reason = "one message, and everything it is drawn from"
)]
fn their_message(
    message: &Message,
    body: &DrawnBody,
    at: Place<'_>,
    picture: Option<&Arc<gpui::Image>>,
    continues: bool,
    under: Vec<AnyElement>,
    zone: Zone,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let time = SharedString::from(clock(message.sent_at_ms, zone));
    div()
        .flex()
        .items_start()
        .gap(px(12.0))
        .child(
            // The picture column keeps its width through a run, so the
            // bubbles of one person line up.
            div()
                .flex_none()
                .w(px(38.0))
                .flex()
                .flex_col()
                .items_center()
                .gap(px(3.0))
                .when(!continues, |column| {
                    column
                        .child(
                            Avatar::new(&message.sender_name)
                                .picture(picture)
                                .size(38.0),
                        )
                        .child(
                            div()
                                .text_size(px(9.0))
                                .line_height(px(10.8))
                                .text_color(theme.c.dim)
                                .child(time.clone()),
                        )
                }),
        )
        .child(
            div()
                .flex()
                .flex_col()
                .items_start()
                .gap(px(2.0))
                .when(!continues, |column| {
                    column.child(
                        div()
                            .flex()
                            .items_start()
                            .gap(px(8.0))
                            .child(
                                div()
                                    .pt(px(1.0))
                                    .mb(px(-1.0))
                                    .font_weight(EMPHASIS)
                                    .text_size(px(13.0))
                                    .line_height(px(20.15))
                                    .child(message.sender_name.clone()),
                            )
                            // On the name's baseline.
                            .child(stamp(time, theme).mt(px(5.0))),
                    )
                })
                .child(bubble(theme.c.card, theme.c.line, false).child(body_text(
                    body,
                    at,
                    theme.c.accent_text,
                    theme,
                )))
                .when(message.edited || message.pinned, |column| {
                    column.child(
                        div()
                            .flex()
                            .items_center()
                            .gap(px(6.0))
                            .text_size(px(11.0))
                            .text_color(theme.c.dim)
                            .when(message.pinned, |line| {
                                line.child(icon("pin", 11.0, theme.c.accent_text))
                            })
                            .when(message.edited, |line| line.child("edited")),
                    )
                })
                .children(under),
        )
}

#[allow(
    clippy::too_many_arguments,
    reason = "one message, and everything it is drawn from"
)]
fn own_message(
    message: &Message,
    body: &DrawnBody,
    at: Place<'_>,
    under: Vec<AnyElement>,
    seen: bool,
    seen_by: &[SharedString],
    zone: Zone,
    theme: &Theme,
) -> impl IntoElement + use<> {
    // On a filled bubble the accent is the ground, so a link there is drawn
    // in the bubble's own ink.
    let link_ink = match theme.skin.bubble_own {
        Fill::Solid => theme.c.on_accent,
        Fill::Wash => theme.c.accent_text,
    };
    let plate = match theme.skin.bubble_own {
        Fill::Solid => bubble(theme.c.accent, theme.c.accent, true).text_color(theme.c.on_accent),
        Fill::Wash => bubble(theme.c.accent_soft, theme.c.accent_line, true),
    };
    div()
        .flex()
        .flex_col()
        .items_end()
        .gap(px(4.0))
        .child(plate.child(body_text(body, at, link_ink, theme)))
        .children(under)
        .child(
            stamp(SharedString::default(), theme)
                .flex()
                .items_center()
                .gap(px(8.0))
                .when(message.pinned, |line| {
                    line.child(icon("pin", 11.0, theme.c.accent_text))
                })
                .when(message.edited, |line| line.child("edited"))
                .child(SharedString::from(clock(message.sent_at_ms, zone)))
                .map(|line| {
                    if message.failed {
                        line.child(div().text_color(theme.c.bad).child("not sent"))
                    } else if seen {
                        line.child(icon("check-check", 13.0, theme.c.accent_text))
                    } else {
                        line.child(icon("check", 13.0, theme.c.dim))
                    }
                }),
        )
        .when_some(seen_line(seen_by), |column, line| {
            column.child(
                div()
                    .debug_selector(|| "seen-by".to_owned())
                    .text_size(px(11.0))
                    .text_color(theme.c.dim)
                    .child(line),
            )
        })
}

/// Who has read a message, in words: up to three names, then how many.
pub(super) fn seen_line(readers: &[SharedString]) -> Option<SharedString> {
    Some(
        match readers {
            [] => return None,
            [one] => format!("Seen by {one}"),
            [one, other] => format!("Seen by {one} and {other}"),
            [one, other, third] => format!("Seen by {one}, {other} and {third}"),
            [one, other, rest @ ..] => format!("Seen by {one}, {other} and {} more", rest.len()),
        }
        .into(),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY_MS: u64 = 86_400_000;

    fn at(sent_at_ms: Option<u64>) -> Message {
        Message {
            sender: Some(1),
            sender_name: "Alex".into(),
            body: "hi".into(),
            html: "hi".into(),
            sent_at_ms,
            own: true,
            id: None,
            edited: false,
            failed: false,
            pinned: false,
            files: Vec::new(),
            reply_to: None,
            reactions: Vec::new(),
        }
    }

    fn day(name: &str) -> Row {
        Row::Day(name.to_owned().into())
    }

    #[test]
    fn stretches_are_cut_where_a_span_or_a_link_starts_or_ends() {
        let ink = gpui::red();
        let ground = gpui::blue();
        // "a bold link" with the last five characters also a link.
        let rich = Rich::parse(r#"a <b>bold <a href="https://x.example">link</a></b>!"#);
        assert_eq!(rich.text, "a bold link!");
        let drawn = highlights(&rich, ink, ground);
        let ranges: Vec<_> = drawn.iter().map(|(range, _)| range.clone()).collect();
        assert_eq!(ranges, [2..7, 7..11], "in order, not overlapping");
        assert!(drawn[0].1.font_weight.is_some() && drawn[0].1.color.is_none());
        assert!(drawn[1].1.font_weight.is_some(), "the link is still bold");
        assert_eq!(drawn[1].1.color, Some(ink));
        assert!(drawn[1].1.underline.is_some());
        assert!(highlights(&Rich::parse("plain"), ink, ground).is_empty());
    }

    #[test]
    fn a_poll_sits_before_the_first_message_sent_after_it() {
        let poll = |at_ms| Poll {
            id: "p".into(),
            question: "?".into(),
            options: Vec::new(),
            multiple: false,
            by: "Rin".into(),
            at_ms,
        };
        let messages = [at(Some(1_000)), at(Some(2_000)), at(Some(3_000))];
        let mut placed = rows(&messages, 3_000, Zone::Fixed(0));
        place_polls(&mut placed, &messages, &[poll(1_500), poll(9_000)]);
        assert_eq!(
            placed[1..],
            [
                Row::Message(0),
                Row::Poll(0),
                Row::Message(1),
                Row::Message(2),
                Row::Poll(1),
            ],
            "after the day rule"
        );
        // Nothing said yet: the poll stands alone.
        let mut empty = rows(&[], 0, Zone::Fixed(0));
        place_polls(&mut empty, &[], &[poll(1)]);
        assert_eq!(empty, [Row::Poll(0)]);
    }

    #[test]
    fn those_who_have_read_are_named_up_to_three() {
        let said = |names: &[&str]| seen_line(&names_of(names)).map(|line| line.to_string());
        assert_eq!(said(&[]), None);
        assert_eq!(said(&["Rin"]).as_deref(), Some("Seen by Rin"));
        assert_eq!(
            said(&["Flora", "Rin"]).as_deref(),
            Some("Seen by Flora and Rin")
        );
        assert_eq!(
            said(&["Flora", "Rin", "Scout"]).as_deref(),
            Some("Seen by Flora, Rin and Scout")
        );
        assert_eq!(
            said(&["Flora", "Rin", "Scout", "Torque"]).as_deref(),
            Some("Seen by Flora, Rin and 2 more")
        );
    }

    fn names_of(names: &[&str]) -> Vec<SharedString> {
        names.iter().map(|name| (*name).to_owned().into()).collect()
    }

    #[test]
    fn those_writing_are_named_until_there_are_too_many() {
        let names = |names: &[&str]| -> Vec<SharedString> {
            names.iter().map(|name| (*name).to_owned().into()).collect()
        };
        assert_eq!(writing_line(&[]), None);
        assert_eq!(
            writing_line(&names(&["Rin"])).as_ref().map(AsRef::as_ref),
            Some("Rin is writing…")
        );
        assert_eq!(
            writing_line(&names(&["Flora", "Rin"]))
                .as_ref()
                .map(AsRef::as_ref),
            Some("Flora and Rin are writing…")
        );
        assert_eq!(
            writing_line(&names(&["Flora", "Rin", "Scout"]))
                .as_ref()
                .map(AsRef::as_ref),
            Some("3 people are writing…")
        );
    }

    #[test]
    fn an_empty_channel_has_no_rows() {
        assert!(rows(&[], 0, Zone::Fixed(0)).is_empty());
    }

    #[test]
    fn a_rule_starts_each_day() {
        let now = 20 * DAY_MS + 1000;
        let messages = [
            at(Some(17 * DAY_MS)),
            at(Some(19 * DAY_MS)),
            at(Some(19 * DAY_MS + 5)),
            at(Some(now)),
        ];
        assert_eq!(
            rows(&messages, now, Zone::Fixed(0)),
            [
                day("Sun, Jan 18"),
                Row::Message(0),
                day("Yesterday"),
                Row::Message(1),
                Row::Message(2),
                day("Today"),
                Row::Message(3),
            ]
        );
    }

    #[test]
    fn the_day_is_the_local_one() {
        // 23:30 UTC on day 19 is already day 20 one hour east of UTC.
        let late = 19 * DAY_MS + 23 * 3_600_000 + 30 * 60_000;
        let now = 20 * DAY_MS + 3_600_000;
        assert_eq!(
            rows(&[at(Some(late))], now, Zone::Fixed(0))[0],
            day("Yesterday")
        );
        assert_eq!(
            rows(&[at(Some(late))], now, Zone::Fixed(3600))[0],
            day("Today")
        );
    }

    #[test]
    fn a_message_without_a_time_stays_with_the_one_before_it() {
        let now = 20 * DAY_MS;
        assert_eq!(
            rows(&[at(Some(19 * DAY_MS)), at(None)], now, Zone::Fixed(0)),
            [day("Yesterday"), Row::Message(0), Row::Message(1)]
        );
        assert_eq!(
            rows(&[at(None)], now, Zone::Fixed(0)),
            [day("Today"), Row::Message(0)]
        );
    }
}
