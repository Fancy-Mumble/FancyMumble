//! The conversation: the channel's header, its messages and the composer.

use std::ops::Range;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use gpui::{
    AnyElement, Context, Focusable, HighlightStyle, Hsla, InteractiveText, IntoElement,
    ParentElement, SharedString, Styled, StyledText, Window, div, list, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Button, Corner, IconButton, Nearest, Paper, Size, Tone, Variant};
use super::widgets::{Clock, EMPHASIS, Zone, icon, label};
use crate::engine::{Action, Attachment, Conversation, Message, OpenTo, Poll, PollOption};
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
    /// The rule above the first message that had not been read when the
    /// conversation was opened.
    Unread,
}

/// Put the rule that marks where reading left off above the message at
/// `first` of `rows`, if there is one and it is among them.
pub(super) fn place_unread(rows: &mut Vec<Row>, first: Option<usize>) {
    let at = first.and_then(|first| {
        rows.iter()
            .position(|row| matches!(row, Row::Message(index) if *index == first))
    });
    if let Some(at) = at {
        rows.insert(at, Row::Unread);
    }
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
        // Beyond yesterday, the date as the reader chose to have dates
        // written.
        _ => chrono::DateTime::from_timestamp(day.saturating_mul(86_400), 0)
            .map(|date| {
                crate::formats::current()
                    .date
                    .day(date.date_naive(), crate::words::spoken())
            })
            .unwrap_or_default(),
    }
}

/// How wide the column of messages grows: the web UI's
/// `CHAT_COLUMN_MAX_WIDTH`.
const COLUMN_MOST: f32 = 1360.0;

/// What an empty conversation says, in the middle of where its messages
/// would be: an empty pane reads as one that failed to load.
fn nothing_said(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .debug_selector(|| "nothing-said".to_owned())
        .absolute()
        .inset_0()
        .flex()
        .items_center()
        .justify_center()
        .text_size(px(13.0))
        .text_color(theme.c.dim)
        .child("No messages yet.")
}

/// How long somebody may pause and still be in the same run of messages.
/// An hour, as the web UI has it: long enough for the pauses a conversation
/// has in it, short enough that coming back the next morning starts anew.
const RUN_WINDOW_MS: u64 = 60 * 60 * 1000;

/// Whether `message` carries on the run `previous` is in: the same person,
/// on the same side, without too long a pause. A run is drawn as one block,
/// with its name, picture and time said once.
pub(super) fn carries_on(previous: &Message, message: &Message) -> bool {
    let same = previous.sender == message.sender
        && previous.sender_name == message.sender_name
        && previous.own == message.own;
    let soon = match (previous.sent_at_ms, message.sent_at_ms) {
        (Some(before), Some(now)) => now
            .checked_sub(before)
            .is_some_and(|gap| gap < RUN_WINDOW_MS),
        // Nothing to measure a pause by.
        _ => true,
    };
    same && soon
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
        // What the theme lays over the gradient: dots, rings, the name.
        .children(super::kit::conversation_ground(theme, &conversation_name(shell)))
        .children(wall(shell, theme))
        // Files dragged in from outside are sent to whoever is on screen.
        .on_drop(cx.listener(|shell, dropped: &gpui::ExternalPaths, _, cx| {
            shell.stage_files(dropped.paths().to_vec(), cx);
        }))
        .child(header(shell, theme, cx))
        // The shares in the channel the user is in, when anybody shares.
        .children(super::stage::render(shell, window, cx))
        .child(
            // The conversation, and beside it who is in it, if asked.
            div()
                .flex_1()
                .min_h_0()
                .flex()
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .h_full()
                        .flex()
                        .flex_col()
                        .child(
                            div()
                                .flex_1()
                                .min_h_0()
                                .relative()
                                // On a wide window the column stops growing
                                // and stands in the middle: a line of text
                                // from one edge of a screen to the other is
                                // not read, it is followed with a finger.
                                .flex()
                                .justify_center()
                                .child(
                                    list(
                                        shell.rows.clone(),
                                        cx.processor(|shell, row: usize, _, cx| {
                                            shell.render_row(row, cx)
                                        }),
                                    )
                                    .w_full()
                                    .max_w(px(COLUMN_MOST))
                                    .h_full()
                                    // What is said, in the size chosen for
                                    // it; names and times keep their own.
                                    .text_size(px(shell
                                        .panels
                                        .settings
                                        .format
                                        .text_px())),
                                )
                                .when(shell.row_model.is_empty(), |river| {
                                    river.child(nothing_said(theme))
                                })
                                .children(arrivals_pill(shell.below.get(), theme, cx))
                                .children(super::pins::render(shell, theme, cx))
                                .children(super::mention::render(shell, theme, cx)),
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
                        .when_some(shell.chrome.picked.as_ref(), |column, picked| {
                            column.child(picking_strip(picked.len(), theme, cx))
                        })
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
                .when(
                    matches!(shell.open, Some(Conversation::Channel(_)))
                        && shell.panels.members.open,
                    |body| body.child(super::members::render(shell, theme, cx)),
                ),
        )
}

/// The name of the conversation being read: the channel's, or whoever a
/// direct message is with.
fn conversation_name(shell: &Shell) -> SharedString {
    match shell.open {
        Some(Conversation::Channel(id)) => shell
            .snapshot
            .channels
            .iter()
            .find(|channel| channel.id == id)
            .map(|channel| channel.name.clone()),
        Some(Conversation::Direct(session)) => shell
            .snapshot
            .users
            .iter()
            .find(|user| user.session == session)
            .map(|user| user.name.clone()),
        None => None,
    }
    .unwrap_or_default()
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
        // A theme with no band hangs the window's controls over this
        // corner, and the header's row starts below them.
        .pr(px(26.0))
        .when(!theme.skin.band, |header| header.pt(px(24.0)))
        .bg(theme.c.header)
        .border_b_1()
        .border_color(theme.c.line)
        .child(
            super::kit::header_mark(theme)
                .unwrap_or_else(|| icon(glyph, 15.0, theme.c.dim).into_any_element()),
        )
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
                    .on_click(cx.listener(move |shell, _, window, cx| {
                        shell.enter_to_talk(channel, window, cx);
                    }))
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
        .child(super::kit::subtitle(about, theme))
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
    let pinned = shell.pins_open;
    // A theme may stand each of these on a plate of its own, taller.
    let plates = theme.skin.marks.header_plates;
    let stand = |button: IconButton| if plates { button.plated().size(38.0) } else { button };
    let (count_ink, side) = if plates { (theme.c.accent_text, 38.0) } else { (theme.c.muted, 28.0) };
    div()
        .flex()
        .items_center()
        .gap(px(if plates { 0.0 } else { 3.0 }))
        .when_some(people, |tools, people| {
            tools.child(
                div()
                    .id("people")
                    .debug_selector(|| "people".to_owned())
                    .rounded(theme.skin.radius_md)
                    .cursor_pointer()
                    .when(shell.panels.members.open && !plates, |button| {
                        button.bg(theme.c.accent_soft)
                    })
                    .when(plates, |button| {
                        let finish = super::kit::Finish::new(theme.c.card2, Some(theme.c.tile));
                        let kind = crate::theme::Kind::Plate;
                        super::kit::shaped(button, kind, finish, px(0.0), theme)
                    })
                    .on_click(cx.listener(|shell, _, _, cx| shell.toggle_members(cx)))
                    .h(px(side))
                    .pl(px(9.0))
                    .pr(px(8.0))
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .child(icon("users", 14.0, count_ink))
                    .child(
                        div()
                            .font_weight(EMPHASIS)
                            .text_size(px(11.5))
                            .text_color(count_ink)
                            .child(SharedString::from(people.to_string())),
                    ),
            )
        })
        .child(
            stand(IconButton::new("find", "search"))
                .tip_with_chosen_key("Search", shell.key_caption(crate::store::Bound::OpenQuickSearch))
                .on_click(cx.listener(|shell, _, window, cx| shell.focus_search(window, cx))),
        )
        .child(
            // How many are pinned rides beside the pin once there are any.
            div()
                .flex()
                .items_center()
                .child(
                    stand(IconButton::new("pins", "pin"))
                        .tip("Pinned messages")
                        .tone(if pinned { Tone::Accent } else { Tone::Muted })
                        .variant(if pinned {
                            Variant::Soft
                        } else {
                            Variant::Ghost
                        })
                        .on_click(cx.listener(|shell, _, _, cx| shell.toggle_pins(cx))),
                )
                .when(!shell.pins.is_empty(), |pins| {
                    pins.child(
                        div()
                            .debug_selector(|| "pin-count".to_owned())
                            .pl(px(3.0))
                            .pr(px(4.0))
                            .font_weight(EMPHASIS)
                            .text_size(px(11.5))
                            .text_color(theme.c.muted)
                            .child(SharedString::from(shell.pins.len().to_string())),
                    )
                }),
        )
        .child(
            stand(IconButton::new("conversation-menu", "ellipsis-vertical"))
                .tip("More")
                .on_click(cx.listener(
                    move |shell, event: &gpui::ClickEvent, _, cx| match channel {
                        Some(channel) => shell.open_channel_menu(channel, event.position(), cx),
                        None => {
                            let items = super::menu::session_items(
                                &SharedString::default(),
                                Some(shell.root_rights()),
                                None,
                            );
                            shell.open_menu(event.position(), items, cx);
                        }
                    },
                )),
        )
}

/// The pill over the foot of the conversation that says messages arrived
/// below while the reader was further up. They are not carried down to an
/// arrival, so without it the message is simply not there until they
/// scroll; a click goes to it.
fn arrivals_pill(
    arrived: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<impl IntoElement + use<>> {
    if arrived == 0 {
        return None;
    }
    let says = if arrived == 1 {
        SharedString::from("1 new message")
    } else {
        format!("{arrived} new messages").into()
    };
    Some(
        div()
            .absolute()
            .left_0()
            .right_0()
            .bottom(px(12.0))
            .flex()
            .justify_center()
            .child(
                div()
                    .id("new-messages")
                    .debug_selector(|| "new-messages".to_owned())
                    .px(px(12.0))
                    .py(px(4.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.accent)
                    .text_size(px(12.0))
                    .text_color(theme.c.on_accent)
                    .cursor_pointer()
                    .on_click(cx.listener(|shell, _, _, cx| shell.jump_to_latest(cx)))
                    .child(says),
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

/// While messages are being picked: how many are, and what to do with
/// them.
fn picking_strip(count: usize, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    div()
        .debug_selector(|| "picking".to_owned())
        .flex_none()
        .mx(px(10.0))
        .pl(px(20.0))
        .pr(px(6.0))
        .flex()
        .items_center()
        .gap(px(4.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.accent_soft)
        .text_size(px(12.0))
        .child(div().flex_1().child(format!(
            "{count} picked. Click a message to pick it or let it go."
        )))
        .child(
            Button::new("delete-picked", "Delete")
                .size(Size::Small)
                .tone(Tone::Danger)
                .on_click(cx.listener(|shell, _, _, cx| shell.delete_picked(cx))),
        )
        .child(
            Button::new("stop-picking", "Cancel")
                .size(Size::Small)
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.chrome.picked = None;
                    cx.notify();
                })),
        )
}

impl Shell {
    /// Start picking messages, with the one at `index` picked.
    pub(super) fn start_picking(&mut self, index: usize, cx: &mut Context<Self>) {
        self.chrome.picked = Some(Vec::new());
        self.pick(index, cx);
    }

    /// Pick the message at `index`, or let it go if it is picked. One
    /// with no id cannot be named to the server, and is not picked.
    fn pick(&mut self, index: usize, cx: &mut Context<Self>) {
        let Some(id) = self
            .messages
            .get(index)
            .and_then(|message| message.id.clone())
        else {
            return;
        };
        if let Some(picked) = self.chrome.picked.as_mut() {
            match picked.iter().position(|held| *held == id) {
                Some(at) => drop(picked.remove(at)),
                None => picked.push(id),
            }
        }
        cx.notify();
    }

    /// Delete the picked messages for everyone, in one request.
    fn delete_picked(&mut self, cx: &mut Context<Self>) {
        let picked = self.chrome.picked.take().unwrap_or_default();
        if let (Some(Conversation::Channel(channel)), false) = (self.open, picked.is_empty()) {
            self.engine.act(Action::DeleteMessages {
                channel,
                ids: picked.iter().map(ToString::to_string).collect(),
            });
        }
        cx.notify();
    }
}

/// The composer, as the web UI's `Composer`: what waits to go out and what
/// is going up, in trays above the row that writes the message. On most
/// themes one panel holds it all, the trays at its top; a theme that plates
/// the composer (`marks.composer_plates`) stands the trays on plates of
/// their own and the row as three: the ways to attach, the field with how
/// to break a line in it, and a worded Send.
fn composer(shell: &Shell, window: &Window, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let theme = crate::theme::ActiveTheme::get(cx);
    let plates = theme.skin.marks.composer_plates;
    let text = shell.composer.read(cx).text().to_owned();
    // Nothing goes while a file is still going up, as the web UI's.
    let uploading = shell.uploading();
    let armed = !uploading && (shell.has_staged() || !text.trim().is_empty());
    let focused = shell.composer.focus_handle(cx).is_focused(window);
    let trays: Vec<AnyElement> = super::staged::render(shell, &theme, cx)
        .into_iter()
        .chain(super::uploads::render(shell, &theme, cx))
        .collect();
    let tools_height = if plates { 56.0 - 2.0 * f32::from(theme.skin.line_width) } else { 32.0 };
    // On a plate, the tools fill it corner to corner, square; the chevron
    // is drawn back onto the clip's leaning edge.
    let tools = div()
        .flex_none()
        .flex()
        .items_center()
        .gap(px(if plates { 0.0 } else { 3.0 }))
        .child(
            // On a server that takes no files it still sends pictures, in
            // the message itself.
            IconButton::new("attach", "paperclip")
                .dims(if plates { 40.0 } else { 28.0 }, tools_height)
                .glyph_size(16.0)
                .tip(crate::words::t!("Attach files"))
                .faded(!shell.snapshot.fancy)
                .on_click(cx.listener(|shell, _, _, cx| shell.pick_file_to_send(cx))),
        )
        .child(
            div().when(plates, |chevron| chevron.ml(px(-10.0))).child(
                IconButton::new("compose-more", "chevron-down")
                    .dims(if plates { 34.0 } else { 16.0 }, tools_height)
                    .glyph_size(10.0)
                    .tip(crate::words::t!("More ways to attach"))
                    .corner(Corner::Small)
                    .on_click(cx.listener(|shell, event: &gpui::ClickEvent, _, cx| {
                        let items = super::menu::compose_items(shell.open, shell.snapshot.fancy);
                        shell.open_menu(event.position(), items, cx);
                    })),
            ),
        );
    // The GIF chip leads the field, as in the web client; while a voice
    // message is recorded, its strip is the field.
    let gif = super::gifs::chip(shell, cx);
    let field = shell
        .voice_take_bar(cx)
        .unwrap_or_else(|| shell.composer.clone().into_any_element());
    let waiting_tip = uploading.then(|| crate::words::t!("Waiting for the upload to finish"));
    // No voice message is offered while a file goes up: Send stands, unlit.
    let voice = if uploading { None } else { shell.voice_button(armed, cx) };
    let send = voice.map(IntoElement::into_any_element).unwrap_or_else(|| {
        let says = waiting_tip.clone().unwrap_or_else(|| crate::words::t!("Send"));
        if plates {
            super::kit::SendPlate::new("send", crate::words::t!("Send"))
                .ready(armed)
                .tip_with_key(says, "Enter")
                .on_click(cx.listener(|shell, _, _, cx| shell.send_composed(cx)))
                .into_any_element()
        } else {
            IconButton::new("send", "send")
                .tip_with_key(says, "Enter")
                .size(32.0)
                .corner(Corner::Pill)
                .variant(if armed { Variant::Solid } else { Variant::Filled })
                .tone(Tone::Dim)
                .on_click(cx.listener(|shell, _, _, cx| shell.send_composed(cx)))
                .into_any_element()
        }
    });
    // The same gutter the conversation keeps for its scrollbar.
    let column = div().flex_none().p(px(10.0)).pr(px(19.0)).flex().flex_col();
    if !plates {
        return column.child(
            Paper::field()
                .lit(focused)
                .flex()
                .flex_col()
                .children(trays)
                .child(
                    div()
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
                        .child(tools)
                        .children(gif)
                        .child(field)
                        .child(send),
                ),
        );
    }
    // The hint says how to break a line for as long as the draft is the one
    // line it is about; back once the field is empty.
    let hint = (!text.contains('\n')).then(|| {
        div()
            .debug_selector(|| "composer-hint".to_owned())
            .flex_none()
            .whitespace_nowrap()
            .text_size(px(10.0))
            .font_weight(gpui::FontWeight::BOLD)
            .letter_spacing(0.14)
            .text_color(theme.c.muted)
            .child(SharedString::from(
                crate::words::t!("Shift+Enter = newline").to_uppercase(),
            ))
    });
    let (card, edge) = (theme.c.card, theme.c.accent_line);
    let edge = if focused { theme.c.accent } else { edge };
    column.children(trays).child(
        div()
            .min_h(px(56.0))
            .flex()
            .items_center()
            // The plates overlap three of the ten pixels their edges lean,
            // so a slit of window is left between each two.
            .child(
                div()
                    .debug_selector(|| "composer-tools".to_owned())
                    .flex_none()
                    .child(
                        Paper::control(card, theme.c.accent_line)
                            .h(px(56.0))
                            .p(theme.skin.line_width)
                            .flex()
                            .items_center()
                            .child(tools),
                    ),
            )
            .child(
                div()
                    .debug_selector(|| "composer-field".to_owned())
                    .ml(px(-3.0))
                    .flex_1()
                    .min_w_0()
                    .min_h(px(56.0))
                    .flex()
                    .child(
                        Paper::control(card, edge)
                            .flex_1()
                            .min_w_0()
                            .max_h(px(180.0))
                            .px(px(16.0))
                            .py(px(16.0))
                            .flex()
                            .items_center()
                            .gap(px(9.0))
                            .text_size(px(14.0))
                            .line_height(px(19.6))
                            .children(gif)
                            .child(div().flex_1().min_w_0().child(field))
                            .children(hint),
                    ),
            )
            .child(div().ml(px(-3.0)).child(send)),
    )
}

impl Shell {
    /// One row of the conversation. Called only for rows near the viewport.
    /// The frame the message `index` is drawn in at `row`, `gap` under
    /// what is above it: what a press, a click and the pointer resting on
    /// it do, its pill of actions, and how it is marked: picked, just gone
    /// to, or naming the reader (`named`).
    fn framed(
        &self,
        (row, index): (usize, usize),
        gap: gpui::Pixels,
        named: bool,
        theme: &Theme,
        cx: &mut Context<Self>,
    ) -> gpui::Stateful<gpui::Div> {
        let message = self.messages.get(index);
        let own = message.is_some_and(|message| message.own);
        let id = message.and_then(|message| message.id.as_ref());
        let picking = self.chrome.picked.is_some();
        // Said to the reader by somebody else: marked down its leading edge.
        let mentioned = named && !own;
        // Just gone to, from a pin or what it answers: it stands out.
        let flashed = id.is_some() && id == self.seen.flashed.as_ref();
        let picked =
            id.is_some_and(|id| self.chrome.picked.iter().flatten().any(|held| held == id));
        // The pill hangs from the side the message is on; on the other
        // side's it clears the picture column.
        let look = self.panels.settings.look;
        let hung = if own && look.carded() {
            (true, px(19.0), gap)
        } else if look.dense() {
            (false, px(10.0), gap)
        } else {
            (false, px(10.0 + 38.0 + 12.0), gap)
        };
        row_frame()
            .id(("message", row))
            .debug_selector(move || format!("message-{index}"))
            .relative()
            .on_hover(cx.listener(move |shell, over: &bool, _, cx| {
                shell.hover_message(index, *over, cx);
            }))
            .children(self.action_pill(index, hung, theme, cx))
            .pt(gap)
            // While messages are being picked, a click picks or lets go.
            .when(picking, |frame| {
                frame
                    .cursor_pointer()
                    .on_click(cx.listener(move |shell, _, _, cx| shell.pick(index, cx)))
            })
            .when(picked || flashed, |frame| frame.bg(theme.c.accent_soft))
            .when(mentioned, |frame| {
                frame
                    .bg(theme.c.accent_soft)
                    .border_l_2()
                    .border_color(theme.c.accent)
                    .rounded(theme.skin.radius_sm)
                    // Nothing to see: what a test finds the mark by.
                    .child(div().debug_selector(move || format!("mentioned-{index}")))
            })
            .on_mouse_down(
                gpui::MouseButton::Right,
                cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                    shell.open_message_menu(event.position, index, cx);
                }),
            )
    }

    /// How the message at `row` is set: the size of its text, who shows
    /// its pictures larger, and the clock its time is read on.
    pub(super) fn setting_of<'a>(
        &self,
        row: usize,
        viewer: &'a gpui::WeakEntity<Self>,
    ) -> (Place<'a>, Clock) {
        let format = self.panels.settings.format;
        let at = Place {
            row,
            viewer: Some(viewer),
            text: format.text_px(),
            look: self.panels.settings.look,
        };
        // On the local clock or on UTC, counted in the hours chosen, or in
        // those the system or the language counts in.
        let clock = Clock {
            zone: if format.convert_to_local_time {
                self.zone
            } else {
                Zone::Utc
            },
            hours: format
                .hours
                .in_force(crate::formats::system_uses_24h(), crate::words::spoken()),
        };
        (at, clock)
    }

    /// Where the message drawn at `row` stands in its run: whether it
    /// carries one on, and whether it is the run's last, under which the
    /// run's time stands. A new day starts a new run, since a rule sits
    /// between the two.
    fn place_in_run(&self, row: usize, message: &Message) -> (bool, bool) {
        let beside = |at: Option<usize>| match at.and_then(|at| self.row_model.get(at)) {
            Some(Row::Message(other)) => self.messages.get(*other),
            _ => None,
        };
        let continues =
            beside(row.checked_sub(1)).is_some_and(|previous| carries_on(previous, message));
        let ends = !beside(Some(row + 1)).is_some_and(|next| carries_on(message, next));
        (continues, ends)
    }

    fn render_row(&mut self, row: usize, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let index = match self.row_model.get(row) {
            Some(Row::Day(name)) => {
                return row_frame().child(day_rule(name, &theme)).into_any_element();
            }
            Some(Row::Unread) => return row_frame().child(unread_rule(&theme)).into_any_element(),
            Some(Row::Earlier) => return Self::earlier_row(&theme, cx),
            Some(Row::Poll(at)) => return self.poll_row(*at, &theme, cx),
            Some(Row::Message(index)) => *index,
            None => return div().into_any_element(),
        };
        let body = self.drawn_body_soon(index, cx);
        // A message that is its link and nothing else is the link's poster.
        let body = if self.link_is_the_message(&body) {
            Arc::new(body.without_words())
        } else {
            body
        };
        // Said to the reader: marked down its leading edge.
        let named = body.names(self.snapshot.own_session);
        let Some(message) = self.messages.get(index) else {
            return div().into_any_element();
        };
        // A run is one person talking: the name and picture are said once.
        // A new day starts a new run, since a rule sits between the two.
        let (continues, ends) = self.place_in_run(row, message);
        // A dense list closes the rows up, as the web UI's does.
        let look = self.panels.settings.look;
        let gap = match (look.dense(), continues) {
            (true, true) => px(2.0),
            (true, false) => px(12.0),
            (false, true) => theme.skin.message_run_gap,
            (false, false) => theme.skin.message_gap,
        };
        // Under the bubble: what lies behind its link, then its reactions.
        let viewer = cx.weak_entity();
        let (at, clock) = self.setting_of(row, &viewer);
        let quoted = self.quoted(index, &theme, cx);
        let under: Vec<AnyElement> = self
            .file_cards(index, &theme, cx)
            .into_iter()
            .chain(self.link_embeds(index, &theme, cx))
            .chain(self.web_pictures(index, &theme, cx))
            .chain(self.reaction_chips(index, &theme, cx))
            .collect();
        let message = &self.messages[index];
        // The user's own on the right only where every message is a
        // bubble; otherwise in the one river with everybody else's.
        let right = message.own && look.carded();
        let body = if right {
            let (seen, by) = self.seen_marks(index);
            let foot = Foot {
                ends,
                seen,
                by: &by,
            };
            own_message(message, &body, at, under, foot, clock, &theme).into_any_element()
        } else {
            {
                let picture = message.sender.and_then(|session| {
                    self.snapshot
                        .users
                        .iter()
                        .find(|user| user.session == session)
                        .and_then(|user| user.avatar.clone())
                });
                let marks = message
                    .own
                    .then(|| own_marks(message, self.seen_marks(index).0, &theme));
                their_message(
                    message,
                    &body,
                    at,
                    picture.as_ref(),
                    (continues, self.sender_color(message.sender), marks),
                    under,
                    clock,
                    &theme,
                )
                .into_any_element()
            }
        };
        let pinned = look
            .always_show_message_actions
            .then(|| self.pinned_actions(index, right, &theme, cx))
            .flatten();
        self.framed((row, index), gap, named, &theme, cx)
            .children(quoted)
            .child(body)
            .children(pinned)
            .into_any_element()
    }

    /// What message `index` is a reply to, in a line above it: who said
    /// it and how it starts, or that it is further back than is shown.
    fn quoted(&self, index: usize, theme: &Theme, cx: &mut Context<Self>) -> Option<AnyElement> {
        let message = self.messages.get(index)?;
        let to = message.reply_to.as_ref()?;
        let answered = to.clone();
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
                    let look = self.panels.settings.look;
                    if message.own && look.carded() {
                        line.justify_end()
                    } else if look.dense() {
                        line
                    } else {
                        line.pl(px(50.0))
                    }
                })
                .pb(px(3.0))
                .child(
                    div()
                        .id(("quoted", index))
                        .max_w(px(420.0))
                        // A click goes to what it answers, where that is
                        // among the messages shown.
                        .cursor_pointer()
                        .on_click(cx.listener(move |shell, _, _, cx| {
                            let _ = shell.jump_to(&answered, None, cx);
                        }))
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
    pictures: Vec<Shown>,
    /// Who it names.
    mentions: super::mention::Mentions,
    /// Whether what it hides has been asked for: a click on a spoiler
    /// shows the message's spoilers, for as long as the message is held.
    revealed: Arc<AtomicBool>,
    /// Whether this is all of it, or what stands in for it while it is
    /// read on another thread: its words and the room of its pictures, if
    /// they are known.
    whole: bool,
    /// The read under way, for a stand-in: let go of with it.
    reading: Option<gpui::Task<()>>,
}

/// The picture the user put behind the conversation, covering it, under
/// as much of the window's own colour as they asked for: what is written
/// over it has to stay readable.
fn wall(shell: &Shell, theme: &Theme) -> Option<super::kit::Wall> {
    let picture = shell.chrome.wall.as_ref()?;
    let mut wash = theme.c.canvas_b;
    wash.a = shell.chrome.wall_wash.clamp(0.0, 1.0);
    let (x, y) = shell
        .chrome
        .walls
        .current()
        .map_or((0.5, 0.5), |current| (current.focus_x, current.focus_y));
    Some(
        super::kit::Wall::new(Arc::clone(picture))
            .focus(x, y)
            .blur(shell.chrome.wall_blur)
            .dim(shell.chrome.wall_dim)
            .wash(wash),
    )
}

/// How many read bodies are held before those far from the one just read
/// are let go of, and how near to it the ones kept are.
const BODIES_MOST: usize = 160;
const BODIES_NEAR: usize = 64;
/// How much the read bodies may hold between them in pictures as they were
/// sent, in bytes. What is drawn of a picture is a smaller copy kept
/// elsewhere; this is what opening one large, saving it or copying it
/// reads from.
const PICTURES_MOST: usize = 8 << 20;
/// How long a message may be and still be read while its row is drawn:
/// one longer carries pictures, and reading them waits on another thread.
const READ_AT_ONCE: usize = 64 * 1024;

/// A picture of a message, and the room it is given.
#[derive(Debug)]
struct Shown {
    image: Arc<gpui::Image>,
    /// How large its file says it is.
    natural: Option<(u32, u32)>,
    /// How large it is drawn, where its file says how large it is. Known
    /// before it is decoded, which happens after the row is first laid out:
    /// a row that grew only then would push its picture out of view.
    size: Option<gpui::Size<gpui::Pixels>>,
    /// Whether it stands in for a picture still being read: nothing is
    /// drawn in its room, and it is not opened.
    waiting: bool,
}

impl Shown {
    /// The most room a picture in a conversation is given.
    const MOST: (f32, f32) = (420.0, 320.0);

    fn read(bytes: Vec<u8>) -> Option<Self> {
        let natural = crate::picture::dimensions(&bytes);
        let size = natural.map(|natural| {
            let (width, height) = crate::picture::fitted(natural, Self::MOST);
            gpui::size(px(width), px(height))
        });
        let image = Arc::new(crate::picture::picture(bytes)?);
        Some(Self {
            image,
            natural,
            size,
            waiting: false,
        })
    }

    /// What holds its room while it is read again: nothing to see, at the
    /// size it was.
    fn stand_in(&self) -> Self {
        static BLANK: std::sync::OnceLock<Arc<gpui::Image>> = std::sync::OnceLock::new();
        let blank = BLANK.get_or_init(|| {
            let mut png = Vec::new();
            let _ = image::RgbaImage::new(1, 1)
                .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png);
            Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Png, png))
        });
        Self {
            image: Arc::clone(blank),
            natural: self.natural,
            size: self.size,
            waiting: true,
        }
    }

    /// What is drawn of it in a conversation: a copy no larger than it is
    /// seen there, and for one that cannot be read, saying so in `ink`.
    fn drawn(&self, ink: Hsla) -> gpui::Img {
        use gpui::StyledImage as _;
        let natural = self.natural;
        gpui::img(crate::pictures::shown(
            &self.image,
            crate::pictures::Fit::Tile,
        ))
        .with_fallback(move || {
            let says = match natural {
                Some((width, height)) => format!("{width} × {height} · cannot be shown here"),
                None => "This picture cannot be shown here".to_owned(),
            };
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(12.0))
                .text_color(ink)
                .child(says)
                .into_any_element()
        })
    }
}

impl DrawnBody {
    /// Read `html`.
    pub(super) fn read(html: &str) -> Self {
        let mut rich = Rich::parse(html);
        let pictures = std::mem::take(&mut rich.images)
            .into_iter()
            .filter_map(Shown::read)
            .collect();
        Self {
            rich,
            pictures,
            mentions: super::mention::Mentions::read(html),
            revealed: Arc::default(),
            whole: true,
            reading: None,
        }
    }

    /// Whether this is all of it, not what stands in for it.
    #[cfg(test)]
    pub(super) fn is_whole(&self) -> bool {
        self.whole
    }

    /// The room each of its pictures takes, where it is known.
    #[cfg(test)]
    pub(super) fn picture_sizes(&self) -> Vec<Option<gpui::Size<gpui::Pixels>>> {
        self.pictures.iter().map(|picture| picture.size).collect()
    }

    /// What stands in for this body while it is read again: its words, and
    /// its pictures' room with nothing in it.
    pub(super) fn stand_in(&self) -> Self {
        Self {
            rich: self.rich.clone(),
            pictures: self.pictures.iter().map(Shown::stand_in).collect(),
            mentions: self.mentions.clone(),
            revealed: Arc::clone(&self.revealed),
            whole: false,
            reading: None,
        }
    }

    /// This stand-in, while `reading` reads the whole of it.
    fn while_reading(&self, reading: gpui::Task<()>) -> Self {
        Self {
            reading: Some(reading),
            ..self.stand_in()
        }
    }

    /// Words already read, with no pictures and naming nobody: what
    /// somebody wrote about themselves, for the sheet of their facts.
    pub(super) fn of_words(rich: Rich) -> Self {
        Self {
            rich,
            pictures: Vec::new(),
            mentions: super::mention::Mentions::default(),
            revealed: Arc::default(),
            whole: true,
            reading: None,
        }
    }

    /// What its pictures weigh as they were sent, in bytes.
    fn weight(&self) -> usize {
        self.pictures
            .iter()
            .map(|picture| picture.image.bytes().len())
            .sum()
    }

    /// Its pictures, in the order they stand in it.
    pub(super) fn pictures(&self) -> impl Iterator<Item = &Arc<gpui::Image>> {
        self.pictures
            .iter()
            .filter(|picture| !picture.waiting)
            .map(|picture| &picture.image)
    }

    /// Whether it names `own`, or everybody.
    pub(super) fn names(&self, own: Option<crate::engine::Session>) -> bool {
        self.mentions.names(own)
    }

    /// Whether it is drawn on a plate: anything but pictures alone, which
    /// are the message themselves. A photograph on a padded, edged plate is
    /// a photograph in a frame. A line break around a picture is not words.
    /// Links whose words were left out (`without_words`) are their poster.
    fn has_plate(&self) -> bool {
        !self.rich.text.trim().is_empty()
            || (self.pictures.is_empty()
                && self.rich.web_pictures.is_empty()
                && self.rich.links.is_empty())
    }

    /// The pictures it names by their web addresses, in order.
    pub(super) fn web_pictures(&self) -> &[String] {
        &self.rich.web_pictures
    }

    /// The address of the first link in it.
    pub(super) fn first_link(&self) -> Option<SharedString> {
        self.rich
            .links
            .first()
            .map(|(_, address)| SharedString::from(address.clone()))
    }

    /// Whether what it hides has been asked for.
    #[cfg(test)]
    pub(super) fn shows_hidden(&self) -> bool {
        self.revealed.load(Ordering::Relaxed)
    }

    /// Whether there is nothing in it to show.
    pub(super) fn is_empty(&self) -> bool {
        self.rich.text.is_empty() && self.pictures.is_empty() && self.rich.web_pictures.is_empty()
    }

    /// Whether it is links and nothing else: the web's `isOnlyLinks`.
    pub(super) fn only_links(&self) -> bool {
        if self.rich.links.is_empty() || !self.pictures.is_empty() {
            return false;
        }
        let mut rest = self.rich.text.clone();
        // Last first, so the earlier ranges still point where they did.
        for (range, _) in self.rich.links.iter().rev() {
            if rest.get(range.clone()).is_some() {
                rest.replace_range(range.clone(), "");
            }
        }
        rest.trim().is_empty() && self.rich.web_pictures.is_empty()
    }

    /// The same body with its words left out and its links kept: a message
    /// that is its link, drawn as the link's poster (`link_card`).
    pub(super) fn without_words(&self) -> Self {
        Self {
            rich: Rich {
                links: self.rich.links.clone(),
                ..Rich::default()
            },
            pictures: Vec::new(),
            mentions: self.mentions.clone(),
            revealed: Arc::clone(&self.revealed),
            whole: self.whole,
            reading: None,
        }
    }
}

impl Shell {
    /// Whether somebody has read the local user's message at `index`,
    /// which earns it a second tick, and by whom: named under the newest
    /// such message only.
    fn seen_marks(&self, index: usize) -> (bool, Vec<SharedString>) {
        // Not saying what you read is not being told what others did, as
        // the web UI's switch says (Settings, Privacy).
        if self.panels.settings.privacy.hide_reading {
            return (false, Vec::new());
        }
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

    /// What the conversation on screen holds, in a line: how many messages
    /// and how long they are as held, what the read bodies hold in pictures
    /// as they were sent, and what is kept of pictures as they are drawn.
    /// For the log, where memory is being looked into.
    pub(crate) fn holds(&self, cx: &mut gpui::App) -> String {
        let said: usize = self.messages.iter().map(|message| message.html.len()).sum();
        let sent: usize = self.bodies.values().map(|body| body.weight()).sum();
        format!(
            "{} messages of {} bytes; {} bodies holding {} bytes of pictures; {} bytes of pictures as drawn",
            self.messages.len(),
            said,
            self.bodies.len(),
            sent,
            crate::pictures::kept_bytes(cx),
        )
    }

    /// What `message` says in full: itself, or for one held without its
    /// pictures, what is read back of it.
    pub(super) fn whole<'a>(&self, message: &'a Message) -> Option<std::borrow::Cow<'a, str>> {
        if !crate::away::is_light(&message.html) {
            return Some(message.html.as_ref().into());
        }
        let id = message.id.as_ref()?;
        self.engine.whole(self.open?, id).map(Into::into)
    }

    /// Let go of the bodies farthest from the one at `near`, until the
    /// pictures the rest hold as they were sent fit [`PICTURES_MOST`]: a
    /// row scrolled back to reads its message again.
    fn let_go_of_far_pictures(&mut self, near: usize) {
        let mut held: Vec<(usize, usize)> = self
            .bodies
            .iter()
            .map(|(index, body)| (*index, body.weight()))
            .filter(|(_, weight)| *weight > 0)
            .collect();
        let mut all: usize = held.iter().map(|(_, weight)| weight).sum();
        // Farthest first; the one just read is never let go of.
        held.sort_by_key(|(index, _)| std::cmp::Reverse(index.abs_diff(near)));
        for (index, weight) in held {
            if all <= PICTURES_MOST || index == near {
                break;
            }
            // What stands in keeps the row's room, so nothing moves when
            // it is scrolled back to and read again.
            if let Some(body) = self.bodies.get_mut(&index) {
                *body = Arc::new(body.stand_in());
            }
            all -= weight;
        }
    }

    /// The body of message `index`, read from its HTML the first time it is
    /// drawn. Only rows near the viewport are ever asked for.
    pub(super) fn drawn_body(&mut self, index: usize) -> Arc<DrawnBody> {
        if let Some(drawn) = self.bodies.get(&index).filter(|drawn| drawn.whole) {
            return Arc::clone(drawn);
        }
        // A message held without its pictures is read back whole for as
        // long as it is drawn.
        let whole = self
            .messages
            .get(index)
            .and_then(|message| self.whole(message));
        let drawn = Arc::new(DrawnBody::read(whole.as_deref().unwrap_or_default()));
        self.took_body(index, drawn)
    }

    /// The body of message `index` as [`Self::drawn_body`] gives it, but one
    /// heavy with pictures is read on another thread: the row draws what
    /// stands in for it until it is back, then is laid out again. Read
    /// once, however often the row is drawn meanwhile; a row let go of
    /// before then lets the read go with it.
    pub(super) fn drawn_body_soon(
        &mut self,
        index: usize,
        cx: &mut Context<Self>,
    ) -> Arc<DrawnBody> {
        let known = self.bodies.get(&index).cloned();
        if let Some(known) = &known
            && (known.whole || known.reading.is_some())
        {
            return Arc::clone(known);
        }
        let Some(message) = self.messages.get(index) else {
            return self.drawn_body(index);
        };
        let light = crate::away::is_light(&message.html);
        if !light && message.html.len() <= READ_AT_ONCE {
            return self.drawn_body(index);
        }
        // Its words stand in at once where nothing was kept of it: a light
        // message's are a quick read; a heavy one's wait with the rest.
        let stand_in = known.map_or_else(
            || {
                if light {
                    DrawnBody::read(&message.html).stand_in()
                } else {
                    DrawnBody::of_words(Rich::default()).stand_in()
                }
            },
            |known| known.stand_in(),
        );
        let html = message.html.clone();
        let asked = (light.then_some(()).and(self.open), message.id.clone());
        let engine = Arc::clone(&self.engine);
        let read = cx.background_executor().spawn(async move {
            let whole = match asked {
                (Some(open), Some(id)) => engine.whole(open, &id).unwrap_or_default(),
                _ => html.to_string(),
            };
            DrawnBody::read(&whole)
        });
        let length = message.html.len();
        let reading = cx.spawn(async move |shell, cx| {
            let drawn = read.await;
            let _ = shell.update(cx, |shell, cx| shell.body_read(index, length, drawn, cx));
        });
        let waiting = Arc::new(stand_in.while_reading(reading));
        let _ = self.bodies.insert(index, Arc::clone(&waiting));
        waiting
    }

    /// The body of message `index`, `length` long when it was asked for, is
    /// read: kept, and its row laid out again, if it is still waited for.
    fn body_read(
        &mut self,
        index: usize,
        length: usize,
        drawn: DrawnBody,
        cx: &mut Context<Self>,
    ) {
        let same = self
            .messages
            .get(index)
            .is_some_and(|message| message.html.len() == length);
        let waited = self
            .bodies
            .get(&index)
            .is_some_and(|known| known.reading.is_some());
        if !(same && waited) {
            return;
        }
        let _ = self.took_body(index, Arc::new(drawn));
        let row = self
            .row_model
            .iter()
            .position(|row| matches!(row, Row::Message(at) if *at == index));
        if let Some(row) = row {
            self.rows.splice(row..row + 1, 1);
        }
        cx.notify();
    }

    /// Keep `drawn` as the body of message `index`, and let go of what is
    /// too far from it to keep.
    fn took_body(&mut self, index: usize, drawn: Arc<DrawnBody>) -> Arc<DrawnBody> {
        self.fetch_shared_pictures(index);
        let _ = self.bodies.insert(index, Arc::clone(&drawn));
        // A body holds its message's pictures as they were sent. Those far
        // from what is being read are let go of, and read again if the
        // conversation is scrolled back to them.
        if self.bodies.len() > BODIES_MOST {
            self.bodies
                .retain(|held, _| held.abs_diff(index) <= BODIES_NEAR);
        }
        self.let_go_of_far_pictures(index);
        // The first time a message with a link is drawn, the server is
        // asked what lies behind it; a message never scrolled to costs
        // nothing.
        if self.snapshot.fancy
            && let Some(url) = drawn.first_link()
            && !self.previews.contains_key(&url)
            && !self.panels.settings.privacy.leave_links
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
        // Two pictures or more are one album, and the other files keep
        // their cards under it (`AttachmentGallery`).
        let pictures: Vec<(usize, &Attachment)> = message
            .files
            .iter()
            .enumerate()
            .filter(|(_, file)| super::album::tileable(file))
            .collect();
        let album = (pictures.len() >= 2).then(|| self.album(index, &pictures, theme, cx));
        let in_album = |at: usize| album.is_some() && pictures.iter().any(|(of, _)| *of == at);
        let cards: Vec<AnyElement> = message
            .files
            .iter()
            .enumerate()
            .filter(|(at, _)| !in_album(*at))
            .map(|(at, file)| {
                // A voice message is drawn as one.
                if let Some(note) = &file.voice {
                    return self.voice_card((index, at), file, note, cx);
                }
                // As the web client draws a shared file: one that has
                // expired says so; a picture, once fetched, is the card.
                let now = super::shared_picture::now_secs();
                if super::shared_picture::expired(file, now) {
                    return self.expired_card(file, (index, at), theme);
                }
                if let Some(picture) = file
                    .shown_from()
                    .and_then(|from| self.panels.shared.get(from)?.clone())
                {
                    return self.picture_card(file, &picture, (index, at), theme, cx);
                }
                let (key, url, name) = (file.key.clone(), file.url.clone(), file.name.clone());
                let sealed = file.open_to == OpenTo::Password;
                // Sealed, it is opened where its password is asked for.
                let key = key.filter(|_| !sealed);
                let glyph = if sealed { "lock" } else { "file" };
                // Size, reach and when it goes (`FileFacts`); a public
                // link says so after them.
                let mut facts = super::shared_picture::facts(file, now);
                if file.open_to == OpenTo::Link {
                    facts.push(crate::words::t!("Public link"));
                }
                let said = (!facts.is_empty()).then(|| {
                    facts.iter().map(SharedString::as_ref).collect::<Vec<_>>().join(" · ")
                });
                let card = div()
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
                    .child(icon(glyph, 18.0, theme.c.muted))
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
                            .when_some(said, |text, said| {
                                text.child(
                                    div()
                                        .text_size(px(11.0))
                                        .text_color(theme.c.muted)
                                        .child(SharedString::from(said)),
                                )
                            }),
                    )
                    .child(icon("download", 14.0, theme.c.muted));
                card.into_any_element()
            })
            .collect();
        album.into_iter().chain(cards).collect()
    }

    /// Ask for the pictures the message `index` shares as files, each
    /// once: by the small copy that stands in for it, where it has one.
    fn fetch_shared_pictures(&mut self, index: usize) {
        let wanted: Vec<SharedString> = self
            .messages
            .get(index)
            .into_iter()
            .flat_map(|message| &message.files)
            .filter_map(Attachment::shown_from)
            .filter(|from| !self.panels.shared.contains_key(*from))
            .cloned()
            .collect();
        for from in wanted {
            let _ = self.panels.shared.insert(from.clone(), None);
            self.engine.fetch_shared(from);
        }
    }
}

/// The colours text is set apart in.
#[derive(Clone, Copy)]
struct Inks {
    /// Links, and whoever is named.
    link: Hsla,
    /// What code stands on.
    code_ground: Hsla,
    /// What hidden text is covered with, while it is hidden.
    veil: Option<Hsla>,
}

/// How each stretch of `rich` is drawn: its emphasis, its links, and what
/// it hides under a veil. The stretches come out in order and never
/// overlap, which is what the text element requires.
fn highlights(rich: &Rich, inks: Inks) -> Vec<(Range<usize>, HighlightStyle)> {
    let (link_ink, code_ground) = (inks.link, inks.code_ground);
    let mut cuts: Vec<usize> = rich
        .spans
        .iter()
        .map(|(range, _)| range)
        .chain(rich.links.iter().map(|(range, _)| range))
        .chain(&rich.spoilers)
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
            let veil = inks.veil.filter(|_| rich.spoilers.iter().any(inside));
            if let Some(veil) = veil {
                // Ink and ground the same: there, and not to be read.
                return Some((
                    range,
                    HighlightStyle {
                        color: Some(veil),
                        background_color: Some(veil),
                        ..HighlightStyle::default()
                    },
                ));
            }
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
                    // ground code stands on. A colour the writer chose
                    // comes before either.
                    color: style
                        .color
                        .map(|[r, g, b]| gpui::rgb(u32::from_be_bytes([0, r, g, b])).into())
                        .or((link || style.mention).then_some(link_ink)),
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
    div()
        .flex()
        .flex_col()
        .gap(px(8.0))
        .children(words(&body.rich, at, Some(&body.revealed), link_ink, theme))
        .children(body_pictures(body, at, theme))
}

/// Text as it was read and as it is laid out, if there is any: running
/// text with its links live, and what is set apart from it (see `prose`).
pub(super) fn words(
    rich: &Rich,
    at: Place<'_>,
    revealed: Option<&Arc<AtomicBool>>,
    link_ink: Hsla,
    theme: &Theme,
) -> Option<AnyElement> {
    let setting = super::prose::Setting {
        at,
        revealed,
        link_ink,
        theme,
    };
    super::prose::prose(rich, setting)
}

/// One piece of text, named `id`, with its links live. What it hides is
/// hidden until `revealed` says otherwise, which a click on it makes it
/// say; with nothing to say so, it stays hidden.
pub(super) fn words_as(
    id: impl Into<gpui::ElementId>,
    rich: &Rich,
    (revealed, viewer): (Option<&Arc<AtomicBool>>, Option<&gpui::WeakEntity<Shell>>),
    link_ink: Hsla,
    theme: &Theme,
) -> Option<InteractiveText> {
    if rich.text.is_empty() {
        return None;
    }
    let shown = revealed.is_some_and(|revealed| revealed.load(Ordering::Relaxed));
    let inks = Inks {
        link: link_ink,
        code_ground: theme.c.card2,
        // Hidden text is a bar of its own ink: the same colour under it.
        veil: (!shown).then_some(theme.c.muted),
    };
    let text = StyledText::new(rich.text.clone()).with_highlights(highlights(rich, inks));
    // While something is hidden a click on it shows it, and is not yet a
    // click on a link inside it: those ranges come first.
    let hidden = if shown { &[][..] } else { &rich.spoilers[..] };
    let (links, addresses): (Vec<_>, Vec<_>) = rich.links.iter().cloned().unzip();
    let ranges = hidden.iter().cloned().chain(links).collect();
    let (hides, revealed, viewer) = (hidden.len(), revealed.cloned(), viewer.cloned());
    let leads: Vec<(Range<usize>, SharedString)> = rich
        .links
        .iter()
        .map(|(range, to)| (range.clone(), to.clone().into()))
        .collect();
    let text = InteractiveText::new(id, text).tooltip(move |at, window, cx| {
        // Where it leads, in full: what is printed may be shorter.
        let (_, to) = leads.iter().find(|(range, _)| range.contains(&at))?;
        Some(super::kit::keyed_tip(to.clone(), None::<&str>)(window, cx))
    });
    Some(text.on_click(ranges, move |clicked, window, cx| {
        if clicked < hides {
            if let Some(revealed) = &revealed {
                revealed.store(true, Ordering::Relaxed);
                window.refresh();
            }
        } else if let Some(address) = addresses.get(clicked - hides) {
            let address = SharedString::from(address.clone());
            // Asked about first, where there is somebody to ask.
            match &viewer {
                Some(viewer) => {
                    let _ = viewer.update(cx, |shell, cx| shell.follow_link(address, cx));
                }
                None => cx.open_url(&address),
            }
        }
    }))
}

/// How wide a block of several pictures is, and the gap between its
/// tiles: the web UI's.
const TILES_WIDE: f32 = 460.0;
const TILE_GAP: f32 = 3.0;

/// The size of tile `nth` of `count` sharing a block. Two side by side
/// keep a landscape shape; three are two squares over one that spans the
/// block; from four up they are squares, two to a row.
fn tile_size(count: usize, nth: usize) -> (f32, f32) {
    let half = (TILES_WIDE - TILE_GAP) / 2.0;
    match (count, nth) {
        (2, _) => (half, half * 2.0 / 3.0),
        (3, 2) => (TILES_WIDE, TILES_WIDE / 2.0),
        _ => (half, half),
    }
}

/// One picture of a message, drawn by `drawn` in a box that takes the
/// click that looks at it larger, where there is somewhere to.
fn picture_tile(
    picture: &Shown,
    nth: usize,
    at: Place<'_>,
    theme: &Theme,
    drawn: impl FnOnce(gpui::Img) -> gpui::Img,
) -> gpui::Stateful<gpui::Div> {
    let shown = Arc::clone(&picture.image);
    let viewer = at.viewer.cloned().filter(|_| !picture.waiting);
    div()
        .id(("picture", at.row.wrapping_mul(8).wrapping_add(nth)))
        .debug_selector(move || format!("picture-{}-{nth}", at.row))
        .flex_none()
        .when_some(viewer, |tile, viewer| {
            tile.cursor_pointer().on_click(move |_, _, cx| {
                let _ = viewer.update(cx, |shell, cx| {
                    shell.lightbox = Some(Arc::clone(&shown));
                    cx.notify();
                });
            })
        })
        .child(drawn(picture.drawn(theme.c.muted)))
}

/// A message's pictures. One hangs at its own shape, in the room its file
/// says it takes. Several are one rounded block of tiles, each filled by
/// its picture.
fn body_pictures(body: &DrawnBody, at: Place<'_>, theme: &Theme) -> Vec<AnyElement> {
    let (most_wide, most_tall) = Shown::MOST;
    let count = body.pictures.len();
    if let [picture] = &body.pictures[..] {
        let corner = theme.skin.radius_md;
        let tile = picture_tile(picture, 0, at, theme, |drawn| {
            let drawn = drawn.rounded(corner).object_fit(gpui::ObjectFit::Contain);
            match picture.size {
                Some(size) => drawn.w(size.width).h(size.height),
                // A file that does not say: whatever it turns out to be.
                None => drawn.max_w(px(most_wide)).max_h(px(most_tall)),
            }
        });
        return vec![tile.into_any_element()];
    }
    if count == 0 {
        return Vec::new();
    }
    let tiles = body.pictures.iter().enumerate().map(|(nth, picture)| {
        let (width, height) = tile_size(count, nth);
        let natural = picture.natural;
        picture_tile(picture, nth, at, theme, |drawn| match natural {
            // Laid over the tile at its own shape, large enough to cover
            // it, and centred: the tile cuts off what hangs over. An image
            // keeps its shape whatever size it is told to be, so it is
            // told one that has it.
            Some(natural) => {
                let (wide, tall) = crate::picture::covering(natural, (width, height));
                drawn
                    .absolute()
                    .left(px((width - wide) / 2.0))
                    .top(px((height - tall) / 2.0))
                    .w(px(wide))
                    .h(px(tall))
            }
            // A file that does not say how large it is: as it comes.
            None => drawn.size_full().object_fit(gpui::ObjectFit::Cover),
        })
        .relative()
        .w(px(width))
        .h(px(height))
        .overflow_hidden()
    });
    // The block is the rounded thing, not the tiles: rounding each would
    // leave a gap of background in every corner between them.
    vec![
        div()
            .debug_selector(move || format!("pictures-{}", at.row))
            .flex_none()
            .w(px(TILES_WIDE))
            .flex()
            .flex_wrap()
            .gap(px(TILE_GAP))
            .rounded(theme.skin.radius_lg)
            .overflow_hidden()
            .children(tiles)
            .into_any_element(),
    ]
}

/// A message's body as a conversation draws it: its words on `plate`, and
/// its pictures under that, on nothing. One that `shares` files and says
/// nothing has no plate: its files are what it says.
fn body_plates(
    body: &DrawnBody,
    shares: bool,
    at: Place<'_>,
    plate: Paper,
    link_ink: Hsla,
    theme: &Theme,
) -> Vec<AnyElement> {
    let plated = if shares {
        !body.rich.text.trim().is_empty()
    } else {
        body.has_plate()
    };
    let words = plated
        .then(|| plate.children(words(&body.rich, at, Some(&body.revealed), link_ink, theme)));
    words
        .into_iter()
        .map(IntoElement::into_any_element)
        .chain(body_pictures(body, at, theme))
        .collect()
}

/// Where a body is drawn: the row it is in, which names its parts, and the
/// shell a click on one of its pictures opens the picture in, if any.
#[derive(Clone, Copy)]
pub(super) struct Place<'a> {
    pub row: usize,
    pub viewer: Option<&'a gpui::WeakEntity<Shell>>,
    /// The size its running text is set in: what a heading is larger than.
    pub text: f32,
    /// How messages are drawn.
    pub look: crate::store::Look,
}

impl Place<'_> {
    /// A body shown outside the conversation: a card, the welcome.
    pub(super) const fn aside(row: usize) -> Self {
        Self {
            row,
            viewer: None,
            text: 14.0,
            look: crate::store::Look {
                bubble_style: crate::store::BubbleStyle::Bubbles,
                compact_mode: false,
                always_show_message_actions: false,
                channel_viewer_style: crate::store::ChannelViewer::Flat,
            },
        }
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
fn day_rule(name: &SharedString, theme: &Theme) -> AnyElement {
    if let Some(plate) = super::kit::day_plate(name, theme) {
        return plate;
    }
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
        .into_any_element()
}

/// The rule above the first message that had not been read: a hairline
/// either side of one word, in the colour of what wants attention.
fn unread_rule(theme: &Theme) -> impl IntoElement + use<> {
    let rule = || div().flex_1().h(theme.skin.line_width).bg(theme.c.line);
    div()
        .debug_selector(|| "unread-rule".to_owned())
        .w_full()
        .pt(px(14.0))
        .flex()
        .items_center()
        .gap(px(12.0))
        .child(rule())
        .child(
            div()
                .text_size(px(10.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.bad)
                .child("NEW"),
        )
        .child(rule())
}

/// A message's plate, of `fill` on a ground of `edge`: the large corner
/// all round but the one nearest its sender. Its words are set `text`
/// pixels high.
fn bubble(fill: Hsla, edge: Hsla, own: bool, text: f32) -> Paper {
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
        .text_size(px(text))
        // The web UI's 1.55, which at fourteen pixels is 21.7.
        .line_height(px(text * 1.55))
}

/// The face beside what somebody said. While they are still here, a click
/// on it opens their card.
fn face(
    message: &Message,
    picture: Option<&Arc<gpui::Image>>,
    at: Place<'_>,
) -> impl IntoElement + use<> {
    let face = div()
        .id(("face", at.row))
        .debug_selector(move || format!("face-{}", at.row));
    leads_to_sender(face, message, at).child(
        Avatar::new(&message.sender_name)
            .picture(picture)
            .size(38.0),
    )
}

/// Have a click on `part` of a message keep its sender's card, and a right
/// click open their menu, while they are still here. Somebody who has left
/// has no card to keep and nothing to be done to: neither is offered.
fn leads_to_sender(
    part: gpui::Stateful<gpui::Div>,
    message: &Message,
    at: Place<'_>,
) -> gpui::Stateful<gpui::Div> {
    let Some((session, viewer)) = message.sender.zip(at.viewer.cloned()) else {
        return part;
    };
    let menu = viewer.clone();
    part.cursor_pointer()
        .on_click(move |event: &gpui::ClickEvent, _, cx| {
            let _ = viewer.update(cx, |shell, cx| {
                if shell.snapshot.users.iter().any(|u| u.session == session) {
                    shell.pin_card(session, Some(event.position()), cx);
                }
            });
        })
        .on_mouse_down(
            gpui::MouseButton::Right,
            move |event: &gpui::MouseDownEvent, _, cx| {
                let _ = menu.update(cx, |shell, cx| {
                    shell.open_user_menu(session, event.position, cx);
                });
                // Not also the menu of the message beside it.
                cx.stop_propagation();
            },
        )
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
    (continues, name_color, marks): (bool, Option<Hsla>, Option<AnyElement>),
    under: Vec<AnyElement>,
    clock: Clock,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let time = SharedString::from(clock.read(message.sent_at_ms));
    let look = at.look;
    // Every message on a plate, or the one river with none.
    let plate = if look.carded() {
        bubble(theme.c.card, theme.c.line, false, at.text)
    } else {
        river(at.text)
    };
    let header = (!continues)
        .then(|| sender_line(message, at, (name_color, marks), time.clone(), theme));
    let plates = body_plates(
        body,
        !message.files.is_empty(),
        at,
        plate,
        theme.c.accent_text,
        theme,
    );
    let said = div()
        .flex()
        .flex_col()
        .items_start()
        .gap(px(2.0))
        .map(|column| match header {
            Some(header) if look.inline_name() => column.child(
                header.child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .flex()
                        .flex_col()
                        .items_start()
                        .children(plates),
                ),
            ),
            Some(header) => column.child(header).children(plates),
            None => column.children(plates),
        })
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
        .children(under);
    div()
        .flex()
        .items_start()
        .gap(px(if look.dense() { 8.0 } else { 12.0 }))
        // A dense list has no column of faces: the width was the face's,
        // not an indent.
        .when(!look.dense(), |row| {
            row.child(
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
                        column.child(face(message, picture, at)).child(
                            div()
                                .text_size(px(9.0))
                                .line_height(px(10.8))
                                .text_color(theme.c.dim)
                                .child(time.clone()),
                        )
                    }),
            )
        })
        .child(said.flex_1().min_w_0())
}

/// Who said a message and when, over what they said; in the compact style
/// the time and the name run into it instead.
fn sender_line(
    message: &Message,
    at: Place<'_>,
    (name_color, marks): (Option<Hsla>, Option<AnyElement>),
    time: SharedString,
    theme: &Theme,
) -> gpui::Div {
    let name = leads_to_sender(
        div()
            .id(("sender", at.row))
            .debug_selector(move || format!("sender-{}", at.row)),
        message,
        at,
    )
    .pt(px(1.0))
    .mb(px(-1.0))
    .font_weight(EMPHASIS)
    .text_size(px(13.0))
    .line_height(px(20.15))
    // In their role's colour, if it has one.
    .when_some(name_color, Styled::text_color)
    .child(message.sender_name.clone());
    let stamp = stamp(time, theme).mt(px(5.0));
    if at.look.inline_name() {
        div()
            .flex()
            .items_start()
            .gap(px(6.0))
            .child(stamp)
            .child(name)
            .children(marks)
    } else {
        div()
            .flex()
            .items_start()
            .gap(px(8.0))
            .child(name)
            // On the name's baseline.
            .child(stamp)
            .children(marks)
    }
}

/// A message's words with no plate under them, for the styles that draw
/// one river: the same size and lines as on a plate.
fn river(text: f32) -> Paper {
    Paper::plate(gpui::transparent_black(), gpui::transparent_black())
        .max_w(px(620.0))
        .text_size(px(text))
        .line_height(px(text * 1.55))
}

/// What is said of the user's own message beside their name, where it is
/// not drawn on the right with its foot under it: whether it was read, or
/// that it was not sent.
fn own_marks(message: &Message, seen: bool, theme: &Theme) -> AnyElement {
    let mark = if message.failed {
        div()
            .flex()
            .items_center()
            .gap(px(4.0))
            .text_size(px(10.5))
            .text_color(theme.c.bad)
            .child("not sent")
    } else if seen {
        div().child(icon("check-check", 13.0, theme.c.accent_text))
    } else {
        div().child(icon("check", 13.0, theme.c.dim))
    };
    mark.debug_selector(|| "own-marks".to_owned())
        .mt(px(4.0))
        .into_any_element()
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
    foot: Foot<'_>,
    clock: Clock,
    theme: &Theme,
) -> impl IntoElement + use<> {
    let Foot { ends, seen, by } = foot;
    // The time belongs to the run, and stands under its last message. What
    // is said of one message alone stands under that one.
    let marked = message.pinned || message.edited || message.failed;
    // On a filled bubble the accent is the ground, so a link there is drawn
    // in the bubble's own ink.
    let link_ink = match theme.skin.bubble_own {
        Fill::Solid => theme.c.on_accent,
        Fill::Wash => theme.c.accent_text,
    };
    let plate = match theme.skin.bubble_own {
        Fill::Solid => {
            bubble(theme.c.accent, theme.c.accent, true, at.text).text_color(theme.c.on_accent)
        }
        Fill::Wash => bubble(theme.c.accent_soft, theme.c.accent_line, true, at.text),
    };
    div()
        .flex()
        .flex_col()
        .items_end()
        .gap(px(4.0))
        .children(body_plates(
            body,
            !message.files.is_empty(),
            at,
            plate,
            link_ink,
            theme,
        ))
        .children(under)
        .when(ends || marked, |column| {
            column.child(
                stamp(SharedString::default(), theme)
                    .debug_selector(|| "own-foot".to_owned())
                    .flex()
                    .items_center()
                    .gap(px(8.0))
                    .when(message.pinned, |line| {
                        line.child(icon("pin", 11.0, theme.c.accent_text))
                    })
                    .when(message.edited, |line| line.child("edited"))
                    .when(ends, |line| {
                        line.child(SharedString::from(clock.read(message.sent_at_ms)))
                    })
                    .map(|line| {
                        if message.failed {
                            line.child(div().text_color(theme.c.bad).child("not sent"))
                        } else if !ends {
                            line
                        } else if seen {
                            line.child(icon("check-check", 13.0, theme.c.accent_text))
                        } else {
                            line.child(icon("check", 13.0, theme.c.dim))
                        }
                    }),
            )
        })
        .when_some(seen_line(by), |column, line| {
            column.child(
                div()
                    .debug_selector(|| "seen-by".to_owned())
                    .text_size(px(11.0))
                    .text_color(theme.c.dim)
                    .child(line),
            )
        })
}

/// What stands under one of the local user's own messages.
#[derive(Clone, Copy)]
struct Foot<'a> {
    /// Whether it is the last of its run: where the time and tick stand.
    ends: bool,
    /// Whether somebody has read it.
    seen: bool,
    /// Who has, named under the newest message that was read.
    by: &'a [SharedString],
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
        let inks = |veil| Inks {
            link: ink,
            code_ground: gpui::blue(),
            veil,
        };
        // "a bold link" with the last five characters also a link.
        let rich = Rich::parse(r#"a <b>bold <a href="https://x.example">link</a></b>!"#);
        assert_eq!(rich.text, "a bold link!");
        let drawn = highlights(&rich, inks(None));
        let ranges: Vec<_> = drawn.iter().map(|(range, _)| range.clone()).collect();
        assert_eq!(ranges, [2..7, 7..11], "in order, not overlapping");
        assert!(drawn[0].1.font_weight.is_some() && drawn[0].1.color.is_none());
        assert!(drawn[1].1.font_weight.is_some(), "the link is still bold");
        assert_eq!(drawn[1].1.color, Some(ink));
        assert!(drawn[1].1.underline.is_some());
        assert!(highlights(&Rich::parse("plain"), inks(None)).is_empty());
    }

    #[test]
    fn what_is_hidden_is_a_bar_of_one_colour_until_it_is_shown() {
        let veil = gpui::green();
        let inks = |veil| Inks {
            link: gpui::red(),
            code_ground: gpui::blue(),
            veil,
        };
        let rich = Rich::parse(r#"it was <span class="spoiler">the <b>butler</b></span>"#);
        let hidden = highlights(&rich, inks(Some(veil)));
        assert!(!hidden.is_empty());
        for (range, style) in &hidden {
            assert!(range.start >= 7, "only what is hidden");
            assert_eq!(
                (style.color, style.background_color),
                (Some(veil), Some(veil))
            );
            assert!(style.font_weight.is_none(), "nothing of it shows through");
        }
        // Shown: set as it is, with nothing over it.
        let shown = highlights(&rich, inks(None));
        assert_eq!(shown.len(), 1, "the bold word and no more");
        assert!(shown[0].1.font_weight.is_some() && shown[0].1.background_color.is_none());
    }

    #[test]
    fn several_pictures_share_a_block_two_to_a_row() {
        let half = (TILES_WIDE - TILE_GAP) / 2.0;
        // Two: a pair of landscapes.
        assert_eq!(tile_size(2, 0), (half, half * 2.0 / 3.0));
        // Three: two squares over one that spans the block.
        assert_eq!(tile_size(3, 1), (half, half));
        assert_eq!(tile_size(3, 2), (TILES_WIDE, TILES_WIDE / 2.0));
        // From four up: squares.
        assert_eq!(tile_size(4, 3), (half, half));
        assert_eq!(tile_size(7, 6), (half, half));
        // Two to a row fill the block exactly.
        assert!((half * 2.0 + TILE_GAP - TILES_WIDE).abs() < f32::EPSILON);
    }

    #[test]
    fn a_run_is_one_person_without_an_hours_pause() {
        const MINUTE: u64 = 60_000;
        let first = at(Some(0));
        assert!(carries_on(&first, &at(Some(59 * MINUTE))));
        assert!(!carries_on(&first, &at(Some(60 * MINUTE))), "an hour on");
        // With no times there is no pause to measure.
        assert!(carries_on(&at(None), &at(None)));
        assert!(carries_on(&first, &at(None)));
        // Out of order is not a run; neither is somebody else.
        assert!(!carries_on(&at(Some(5 * MINUTE)), &first));
        let mut other = at(Some(MINUTE));
        other.sender = Some(9);
        assert!(!carries_on(&first, &other));
        let mut own = at(Some(MINUTE));
        own.own = !first.own;
        assert!(!carries_on(&first, &own));
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
        // The rule that marks where reading left off goes above its
        // message, under the day's rule; a message not among the rows gets none.
        let mut marked = rows(&messages, 3_000, Zone::Fixed(0));
        let before = marked.len();
        place_unread(&mut marked, Some(1));
        let at = marked.iter().position(|row| *row == Row::Unread);
        assert_eq!(at.map(|at| &marked[at + 1]), Some(&Row::Message(1)));
        place_unread(&mut marked, Some(99));
        place_unread(&mut marked, None);
        assert_eq!(marked.len(), before + 1);
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
