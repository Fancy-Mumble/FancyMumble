//! The channel column: search, the channel tree with who is in the current
//! channel, and the local user's own tile.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Badge, IconButton, Kbd, Paper, Tone, Variant};
use super::widgets::{EMPHASIS, icon, label};
use crate::engine::{Channel, Connection, Conversation, User, Voice};
use crate::theme::{Fill, Kind, Theme};

/// `channels` in the order a tree lists them - each parent, then its
/// children by position and then by name - as `(index, depth)`.
///
/// A channel whose parent is not in the list is shown at the top rather than
/// lost, and a loop (which no server should send) is walked once.
pub(super) fn tree_order(channels: &[Channel]) -> Vec<(usize, usize)> {
    use std::collections::{HashMap, HashSet};
    // Each channel under its parent, once: a tree of thousands is walked
    // in a pass, not searched through for every channel in it.
    let known: HashSet<u32> = channels.iter().map(|channel| channel.id).collect();
    let mut children: HashMap<Option<u32>, Vec<usize>> = HashMap::new();
    for (at, channel) in channels.iter().enumerate() {
        // Roots: no parent, one this list does not have, or itself.
        let parent = channel
            .parent
            .filter(|of| known.contains(of) && *of != channel.id);
        children.entry(parent).or_default().push(at);
    }
    for siblings in children.values_mut() {
        siblings
            .sort_by_cached_key(|&at| (channels[at].position, channels[at].name.to_lowercase()));
    }
    let children_of = |parent: Option<u32>| children.get(&parent).map_or(&[][..], Vec::as_slice);
    let mut ordered = Vec::with_capacity(channels.len());
    let mut seen = vec![false; channels.len()];
    // Depth first, with the stack reversed so siblings come out in order.
    let mut stack: Vec<(usize, usize)> =
        children_of(None).iter().rev().map(|&at| (at, 0)).collect();
    while let Some((at, depth)) = stack.pop() {
        if std::mem::replace(&mut seen[at], true) {
            continue;
        }
        ordered.push((at, depth));
        stack.extend(
            children_of(Some(channels[at].id))
                .iter()
                .rev()
                .map(|&child| (child, depth + 1)),
        );
    }
    // What a loop of parents left unreached is listed all the same.
    ordered.extend(
        (0..channels.len())
            .filter(|&at| !seen[at])
            .map(|at| (at, 0)),
    );
    ordered
}

/// How far each level of the channel tree steps in.
const INDENT: f32 = 12.0;
/// One line of a row's text: 12.5px at the web UI's leading.
const LINE: f32 = 19.375;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    // A theme that heads the column with the server's name on a plate
    // gives its search more room, and heads the channels with a count.
    let server = server_name(shell);
    let plated = theme.skin.marks.column_plate;
    div()
        .flex_none()
        .w(theme.skin.column_width)
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .children(
            server
                .as_ref()
                .and_then(|name| super::kit::name_plate(name, theme)),
        )
        .child(
            div()
                .flex_none()
                .map(|around| {
                    if plated {
                        around.px(px(18.0)).pt(px(16.0)).pb(px(10.0))
                    } else {
                        around.p(px(12.0)).pb(px(6.0))
                    }
                })
                .child(search_box(shell, theme)),
        )
        .children(server.as_ref().and_then(|name| {
            super::kit::section_heading(name, Some(shell.snapshot.channels.len()), theme)
        }))
        .child(
            gpui::list(
                shell.column_list.clone(),
                cx.processor(|shell, row: usize, _, cx| shell.render_column_row(row, cx)),
            )
            .flex_1()
            .min_h_0()
            .py(px(8.0)),
        )
        .child(
            div()
                .flex_none()
                // A drawn skin stands the dock further off the edges.
                .p(px(theme.skin.marks.dock_bank.map_or(10.0, |bank| bank.margin)))
                .child(user_tile(shell, theme, cx)),
        )
}

/// The name of the server on screen: what its operator calls it, else
/// what it was saved as.
fn server_name(shell: &Shell) -> Option<SharedString> {
    let session = shell
        .snapshot
        .sessions
        .iter()
        .find(|session| session.active)?;
    Some(
        shell
            .session_livery(&session.key)
            .and_then(|livery| livery.name.clone())
            .unwrap_or_else(|| session.name.clone()),
    )
}

fn search_box(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    let finish = super::kit::Finish::new(theme.c.input, Some(theme.c.line2));
    div()
        .h(px(47.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(14.0))
        .map(|field| super::kit::shaped(field, Kind::Plate, finish, theme.skin.radius_lg, theme))
        .text_size(px(12.5))
        .child(icon("search", 12.0, theme.c.dim).mt(px(-1.0)))
        .child(shell.search.clone())
        .child(Kbd::new("Ctrl+F"))
}

/// One row of the channel column.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Row {
    /// The channel at this place in the snapshot, this deep in the tree.
    Channel { at: usize, depth: usize },
    /// The people in that channel, on a card under it.
    People { at: usize, depth: usize },
    /// The line above the messages that matched the search.
    FoundHeading,
    /// The matching message at this place among those found.
    Found(usize),
}

impl Shell {
    /// One row of the channel column. Called only for rows in view.
    pub(super) fn render_column_row(&mut self, row: usize, cx: &mut Context<Self>) -> AnyElement {
        let theme = crate::theme::ActiveTheme::get(cx);
        let (at, depth, people) = match self.column.get(row) {
            Some(Row::Channel { at, depth }) => (*at, *depth, false),
            Some(Row::People { at, depth }) => (*at, *depth, true),
            Some(Row::FoundHeading) => {
                return div()
                    .w_full()
                    .px(px(24.0))
                    .pt(px(10.0))
                    .pb(px(6.0))
                    .text_size(px(11.0))
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.muted)
                    .child(label("Messages", &theme))
                    .into_any_element();
            }
            Some(Row::Found(at)) => return self.found_row(*at, &theme, cx),
            None => return div().into_any_element(),
        };
        let Some(channel) = self.snapshot.channels.get(at) else {
            return div().into_any_element();
        };
        let drawn = if people {
            occupant_list(self, channel, depth, &theme, cx)
        } else {
            let open = self.open == Some(Conversation::Channel(channel.id));
            channel_row(self, channel, depth, open, &theme, cx)
        };
        // The gap between rows, which a list does not put there itself; a
        // channel and the people under it are one card, with none.
        let gap = if !people && self.occupant_count(channel.id) > 0 {
            0.0
        } else {
            2.0
        };
        div()
            .w_full()
            .px(px(10.0))
            .pb(px(gap))
            .child(drawn)
            .into_any_element()
    }

    /// A message that matched the search: what it says, and who said it
    /// where. A click opens the conversation it is in.
    fn found_row(&self, at: usize, theme: &Theme, cx: &mut Context<Self>) -> AnyElement {
        let Some(found) = self.found.get(at) else {
            return div().into_any_element();
        };
        let hover = theme.c.hover;
        let (conversation, said_at) = (found.conversation, found.at.clone());
        div()
            .w_full()
            .px(px(10.0))
            .pb(px(2.0))
            .child(
                div()
                    .id(("found", at))
                    .debug_selector(move || format!("found-{at}"))
                    .flex()
                    .flex_col()
                    .gap(px(2.0))
                    .px(px(14.0))
                    .py(px(6.0))
                    .rounded(theme.skin.radius_md)
                    .cursor_pointer()
                    .hover(move |style| style.bg(hover))
                    // To where it was said, and to it there.
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.open_conversation(conversation, cx);
                        if let Some((id, back)) = &said_at {
                            let _ = shell.jump_to(id, Some(*back), cx);
                        }
                    }))
                    .child(
                        div()
                            .text_size(px(13.0))
                            .line_clamp(2)
                            .child(found.text.clone()),
                    )
                    .child(
                        div()
                            .truncate()
                            .text_size(px(11.0))
                            .text_color(theme.c.muted)
                            .child(found.about.clone()),
                    ),
            )
            .into_any_element()
    }
}

fn channel_row(
    shell: &Shell,
    channel: &Channel,
    depth: usize,
    current: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let occupants = shell.occupant_count(channel.id);
    // Its people as faces on its own row, where that is how they are shown.
    let stacked = occupants > 0
        && shell.panels.settings.look.channel_viewer_style.drawn()
            == crate::store::ChannelViewer::Modern;
    // A channel with people in it is the head of the card that lists them,
    // unless the theme stands every row on a plate of its own.
    let carded = occupants > 0 && !theme.skin.marks.plated_rows && !stacked;
    let finish = super::kit::row_finish(current, theme);
    let solid = current && theme.skin.selection == Fill::Solid;
    let (ink, hash) = if solid {
        (theme.c.on_accent, theme.c.on_accent)
    } else if current {
        (theme.c.text, theme.c.accent_text)
    } else if theme.skin.marks.plated_rows {
        // A row on a card of its own reads in the text's ink.
        (theme.c.text, theme.c.dim)
    } else {
        (theme.c.muted, theme.c.dim)
    };
    let hover = theme.c.hover;
    let id = channel.id;
    let clear = gpui::transparent_black();
    let row = div()
        .id(("channel", id as usize))
        .debug_selector(|| format!("channel-{id}"))
        .flex()
        .items_center()
        .gap(px(8.2))
        .cursor_pointer()
        .text_size(px(12.5))
        .line_height(px(LINE))
        .text_color(ink)
        // A carded row gives two pixels each way to the card's own edge; a
        // row on a plate of its own is as tall as the web UI's cards.
        .map(|row| match (theme.skin.marks.plated_rows, carded) {
            (true, _) => row.px(px(16.0)).min_h(px(49.0)),
            // 37.4 in the web UI, which a browser draws as 38 whole pixels.
            (false, true) => row.px(px(10.0)).h(px(38.0)),
            (false, false) => row.px(px(12.0)).py(px(10.0)),
        })
        .map(|row| match (finish, theme.skin.cuts.of(Kind::Row)) {
            // A row the theme cuts: the plate and its bar under what it says.
            (Some(finish), Some(cut)) => {
                // The same clear border as any row, so the cut moves nothing.
                let row = row.border_1().border_color(clear);
                super::kit::cut_into(row, cut, finish, theme.skin.line_width)
                    .when(current, |row| row.children(super::kit::selection_bar(theme)))
            }
            _ => row
                .rounded(theme.skin.radius_md)
                .when(carded, |row| row.rounded_b(px(0.0)))
                .border_1()
                .border_color(clear)
                .map(|row| match (current, solid) {
                    (true, true) => row.bg(theme.c.accent),
                    (true, false) => row
                        .bg(theme.c.accent_soft)
                        .border_color(theme.c.accent_line),
                    _ => row.hover(move |style| style.bg(hover)),
                })
                .when(current && theme.skin.selection_bar.is_some(), |row| {
                    row.relative().children(super::kit::selection_bar(theme))
                }),
        })
        .when(current, |row| row.font_weight(EMPHASIS))
        .on_mouse_down(
            gpui::MouseButton::Right,
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                shell.open_channel_menu(id, event.position, cx);
            }),
        )
        // A click reads the channel; a double click moves into it.
        .on_click(
            cx.listener(move |shell, event: &gpui::ClickEvent, window, cx| {
                if event.click_count() >= 2 {
                    let _ = shell.enter(id, window, cx);
                } else {
                    shell.open_conversation(Conversation::Channel(id), cx);
                }
            }),
        )
        .child(channel_glyph(channel, hash, theme))
        .children(channel_name(shell, channel, stacked, theme))
        .children(row_marks(
            channel, occupants, current, solid, hash, theme, cx,
        ));
    let indent = px(INDENT * depth as f32);
    if carded {
        // The top of the card; the people under it are its bottom.
        div()
            .ml(indent)
            .rounded_t(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_b_0()
            .border_color(theme.c.line)
            .child(row)
            .into_any_element()
    } else {
        div().ml(indent).child(row).into_any_element()
    }
}

/// A channel's name on its row, and where its people are shown as faces,
/// the faces after it.
fn channel_name(
    shell: &Shell,
    channel: &Channel,
    stacked: bool,
    theme: &Theme,
) -> Vec<AnyElement> {
    let name = div()
        .when(!stacked, Styled::flex_1)
        .min_w_0()
        .truncate()
        .child(label(&channel.name, theme))
        .into_any_element();
    if !stacked {
        return vec![name];
    }
    vec![
        name,
        stacked_faces(shell, channel.id).into_any_element(),
        div().flex_1().into_any_element(),
    ]
}

/// The people in channel `id` as faces, for the row the channel is on.
fn stacked_faces(shell: &Shell, id: crate::engine::ChannelId) -> super::kit::FaceStack {
    let faces = shell
        .occupants(id)
        .map(|user| super::kit::Face {
            name: user.name.clone(),
            picture: user.avatar.clone(),
            talking: shell.talking.contains(&user.session),
        })
        .collect();
    super::kit::FaceStack::new(format!("faces-{id}"), faces)
}

/// What stands before a channel's name: a lock on one behind a password,
/// in the colour of a warning, and otherwise the mark of a channel in `ink`.
fn channel_glyph(channel: &Channel, ink: gpui::Hsla, theme: &Theme) -> AnyElement {
    if channel.restricted {
        let id = channel.id;
        return div()
            .debug_selector(move || format!("locked-{id}"))
            .flex_none()
            .child(icon("lock", 12.0, theme.c.warn))
            .into_any_element();
    }
    div()
        .flex_none()
        .text_size(px(13.0))
        .line_height(px(13.0))
        .font_weight(theme.skin.weight)
        .text_color(ink)
        .child("#")
        .into_any_element()
}

/// The mark on a channel whose history is kept sealed, saying which way:
/// with the archive's one key in the accent, the Signal way in the tone of
/// what is well.
fn sealed_badge(channel: &Channel, theme: &Theme) -> Option<AnyElement> {
    if !channel.encrypted {
        return None;
    }
    let (says, tells, ink) = if channel.signal {
        ("SIGNAL", "Signal Protocol encryption", theme.c.ok)
    } else {
        ("FANCY", "Fancy E2EE (full archive)", theme.c.accent)
    };
    let (ground, edge) = if channel.signal {
        (gpui::Hsla { a: 0.14, ..ink }, gpui::Hsla { a: 0.33, ..ink })
    } else {
        (theme.c.accent_soft, theme.c.accent_line)
    };
    let id = channel.id;
    Some(
        div()
            .id(("sealed", id as usize))
            .debug_selector(move || format!("sealed-{id}"))
            .flex_none()
            .px(px(5.0))
            .py(px(1.0))
            .rounded(theme.skin.radius_sm)
            .text_size(px(9.5))
            .font_weight(EMPHASIS)
            .text_color(ink)
            .bg(ground)
            .border_1()
            .border_color(edge)
            .tooltip(super::kit::keyed_tip(tells, None::<&str>))
            .child(says)
            .into_any_element(),
    )
}

/// What rides at a channel row's trailing end: that it is listened to, how
/// much waits unread, how many are in it.
fn row_marks(
    channel: &Channel,
    occupants: usize,
    current: bool,
    solid: bool,
    hash: gpui::Hsla,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Vec<AnyElement> {
    let id = channel.id;
    let mut marks = Vec::new();
    if channel.listening {
        marks.push(
            div()
                .debug_selector(move || format!("listening-{id}"))
                .child(icon("ear", 12.0, hash))
                .into_any_element(),
        );
    }
    marks.extend(sealed_badge(channel, theme));
    if channel.unread > 0 && !current {
        marks.push(Badge::new(channel.unread).into_any_element());
    }
    if occupants > 0 && channel.parent.is_some() {
        let voice = if solid { theme.c.on_accent } else { theme.c.ok };
        marks.push(
            div()
                .id(("join", id as usize))
                .debug_selector(move || format!("join-{id}"))
                .flex()
                .items_center()
                .gap(px(4.2))
                .font_weight(theme.skin.weight)
                .text_size(px(10.5))
                .line_height(px(16.275))
                .text_color(voice)
                // How many are talking in there is the way in: a click on
                // it joins them, where one on the row only reads.
                .cursor_pointer()
                .tooltip(super::kit::keyed_tip("Join voice", None::<&str>))
                .on_click(cx.listener(move |shell, _, window, cx| {
                    cx.stop_propagation();
                    let _ = shell.enter(id, window, cx);
                }))
                .child(icon("volume-2", 10.0, voice))
                .child(SharedString::from(occupants.to_string()))
                .into_any_element(),
        );
    }
    marks
}

/// Who is in a channel: the bottom of the card its row is the top of.
fn occupant_list(
    shell: &Shell,
    channel: &Channel,
    depth: usize,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    div()
        .flex_none()
        .ml(px(INDENT * depth as f32))
        .flex()
        .flex_col()
        .gap(px(1.0))
        .px(px(8.0))
        .pb(px(8.0))
        // Where every row is a plate of its own, the people stand under it
        // on no card.
        .when(!theme.skin.marks.plated_rows, |list| {
            list.rounded_b(theme.skin.radius_md)
                .bg(theme.c.card)
                .border_1()
                .border_t_0()
                .border_color(theme.c.line)
        })
        .when(theme.skin.marks.plated_rows, |list| list.pt(px(4.0)))
        .children(
            shell
                .occupants(channel.id)
                .map(|user| occupant_row(shell, user, theme, cx)),
        )
        .into_any_element()
}

fn occupant_row(
    shell: &Shell,
    user: &User,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let own = shell.snapshot.own_session == Some(user.session);
    let talking = shell.talking.contains(&user.session);
    let session = user.session;
    let open = shell.open == Some(Conversation::Direct(session));
    let hover = theme.c.hover;
    div()
        .id(("user", session as usize))
        .debug_selector(move || format!("user-{session}"))
        .h(px(30.0))
        .flex()
        .items_center()
        .gap(px(9.0))
        .px(px(8.0))
        .rounded(theme.skin.radius_md)
        .text_size(px(12.5))
        .line_height(px(LINE))
        .on_mouse_down(
            gpui::MouseButton::Right,
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                shell.open_user_menu(session, event.position, cx);
            }),
        )
        // The pointer resting here brings up their card.
        .on_hover(cx.listener(move |shell, over: &bool, window, cx| {
            shell.hover_user(session, *over, window, cx);
        }))
        .when(open, |row| row.bg(theme.c.accent_soft))
        // A click keeps their card, the user's own too; the card is where
        // to write to them.
        .cursor_pointer()
        .when(!open, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |shell, event: &gpui::ClickEvent, _, cx| {
            shell.pin_card(session, Some(event.position()), cx);
        }))
        .child(
            Avatar::new(&user.name)
                .picture(user.avatar.as_ref())
                .size(20.0)
                .talking(talking),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_color(shell.role_color(user).unwrap_or(if own {
                    theme.c.muted
                } else {
                    theme.c.text
                }))
                .child(user.name.clone()),
        )
        // Beside the name: they qualify whoever is being read. On the
        // user's own row too, where the server's mute is news.
        .children(super::speaker::priority_mark(user, theme))
        .children(super::speaker::voice_marks(user, theme))
        .children(shell.live_badge(session))
        .when(own, |row| {
            row.child(
                div()
                    .mt(px(-1.0))
                    .text_size(px(9.5))
                    .line_height(px(14.725))
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .text_color(theme.c.dim)
                    .child("you"),
            )
        })
        .when(user.unread > 0, |row| row.child(Badge::new(user.unread)))
}

/// The local user's tile: who they are, and the voice controls.
/// What the user tile says under the name: what the voice is doing, and,
/// when a whisper target is chosen and not being whispered to, who it is.
fn voice_status(shell: &Shell, deafened: bool) -> (SharedString, Option<SharedString>) {
    let status: SharedString = match (shell.snapshot.connection, deafened, shell.snapshot.voice) {
        (Connection::Disconnected, ..) => "Not connected".into(),
        (Connection::Connecting, ..) => "Connecting…".into(),
        // A whisper is heard by its target and nobody else, whatever the
        // microphone is otherwise doing: that is what is said, while it is.
        (Connection::Connected, ..) if shell.whisper.active => match &shell.whisper.target {
            Some((_, name)) => format!("Whispering to {name}").into(),
            None => "Whispering".into(),
        },
        (Connection::Connected, ..) if shell.engine.is_recording() => "Recording".into(),
        (Connection::Connected, true, _) => "Deafened".into(),
        (Connection::Connected, false, Voice::Off) => "Voice off".into(),
        (Connection::Connected, false, Voice::Muted) => "Muted".into(),
        (Connection::Connected, false, Voice::On) => "Voice on".into(),
    };
    let whisper_to = shell
        .whisper
        .target
        .as_ref()
        .filter(|_| !shell.whisper.active)
        .map(|(_, name)| SharedString::from(format!("Whisper key: {name}")));
    (status, whisper_to)
}

/// What the voice is doing, under the user's name. Voice off is said
/// aloud where the theme gives such a state a voice of its own.
fn status_line(shell: &Shell, status: SharedString, theme: &Theme) -> gpui::Div {
    let line = div()
        .debug_selector(|| "voice-status".to_owned())
        .truncate()
        .text_size(px(10.5))
        .line_height(px(14.175))
        .text_color(theme.c.muted);
    let off = shell.snapshot.voice == Voice::Off && !shell.whisper.active;
    let tag = super::kit::Role::Tag;
    if off && tag.voice(theme).caps {
        line.text_size(px(10.0))
            .text_color(theme.c.bad)
            .child(super::kit::voiced(&status, tag, 10.0, theme))
    } else {
        line.child(status)
    }
}

fn user_tile(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let own = shell.own_user();
    let name = own.map_or_else(
        || SharedString::from("Not connected"),
        |user| user.name.clone(),
    );
    // With voice off the server lists the user as deafened, because nothing
    // is heard; to the user that is "voice off", not a deafen they chose.
    let deafened = shell.snapshot.deafened && shell.snapshot.voice != Voice::Off;
    // The microphone is "off" both when voice is off and when it is muted:
    // either way nobody hears the user, which is what the red says.
    let (status, whisper_to) = voice_status(shell, deafened);
    // The pip says how the user is heard: not at all, muted, or live.
    let pip = match (shell.snapshot.voice, deafened) {
        (Voice::Off, _) => theme.c.dim,
        (_, true) | (Voice::Muted, _) => theme.c.bad,
        (Voice::On, false) => theme.c.ok,
    };
    // A drawn skin sets the dock out as a bank of switches under the name
    // and the face, the name large; any other has the switches beside the
    // face, under the name.
    let bank = theme.skin.marks.dock_bank;
    let sheet_open = shell.menu.as_ref().is_some_and(|menu| menu.over.is_some());
    let named = div()
        .flex_1()
        .min_w_0()
        .flex()
        .flex_col()
        .gap(px(1.0))
        .child(
            div()
                .truncate()
                .map(|line| match bank {
                    Some(bank) => line
                        .text_size(px(bank.name_size))
                        .line_height(px(bank.name_size * 1.15))
                        .font_weight(gpui::FontWeight(bank.name_weight)),
                    None => line
                        .text_size(px(13.0))
                        .line_height(px(14.95))
                        .font_weight(EMPHASIS),
                })
                .child(name.clone()),
        )
        .child(status_line(shell, status, theme))
        .when_some(whisper_to, |column, says| {
            column.child(
                div()
                    .debug_selector(|| "whisper-target".to_owned())
                    .truncate()
                    .text_size(px(10.5))
                    .line_height(px(14.175))
                    .text_color(theme.c.accent_text)
                    .child(says),
            )
        });
    // The overflow: the sheet of what the row has no room for, worn on
    // while it is open.
    let more = IconButton::new("own-menu", "ellipsis-vertical")
        .glyph_size(15.0)
        .variant(if sheet_open {
            Variant::Filled
        } else {
            Variant::Ghost
        })
        .tip(crate::words::t!("More"))
        .on_click(cx.listener(|shell, _, _, cx| shell.open_own_sheet(cx)));
    let top = div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(named)
        .child(more);
    let switches = voice_row(
        shell.snapshot.voice,
        deafened,
        shell.stage.sharing(),
        bank.is_some(),
        (
            shell.key_caption(crate::store::Bound::ToggleMute),
            shell.key_caption(crate::store::Bound::ToggleDeafen),
        ),
        cx,
    );
    let (pad_y, pad_x) = bank.map_or((10.0, 10.0), |bank| bank.padding);
    // Where it is drawn, for the sheet that grows out of it.
    let dock = shell.chrome.dock.clone();
    let measure = gpui::canvas(
        move |bounds, _, _| dock.set(Some(bounds)),
        |_, (), _, _| {},
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full();
    let card = match bank {
        Some(_) => Paper::raised()
            .flex()
            .flex_col()
            .gap(px(8.0))
            .py(px(pad_y))
            .px(px(pad_x))
            .child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(14.0))
                    .child(own_face(&name, own, pip, cx))
                    .child(div().flex_1().min_w_0().child(top)),
            )
            .child(switches),
        None => Paper::raised()
            .flex()
            .items_center()
            .gap(px(14.0))
            .py(px(pad_y))
            .px(px(pad_x))
            .child(own_face(&name, own, pip, cx))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .flex()
                    .flex_col()
                    .gap(px(8.0))
                    .child(top)
                    .child(switches),
            ),
    };
    div()
        .debug_selector(|| "own-dock".to_owned())
        .relative()
        .child(card)
        .child(measure)
}

/// The user's own face on their tile: a click keeps their own card, a
/// right click opens what they can change about themselves.
fn own_face(
    name: &str,
    own: Option<&User>,
    pip: gpui::Hsla,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    div()
        .id("own-face")
        .debug_selector(|| "own-face".to_owned())
        .flex_none()
        .when_some(own.map(|user| user.session), |face, session| {
            face.cursor_pointer()
                .on_click(cx.listener(move |shell, event: &gpui::ClickEvent, _, cx| {
                    shell.pin_card(session, Some(event.position()), cx);
                }))
                .on_mouse_down(
                    gpui::MouseButton::Right,
                    cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                        shell.open_user_menu(session, event.position, cx);
                    }),
                )
        })
        .child(
            Avatar::new(name)
                .picture(own.and_then(|user| user.avatar.as_ref()))
                .size(42.0)
                .status(Some(pip)),
        )
}

/// The voice controls under the user's name: the microphone, the
/// headphones, and at the far end the screen.
fn voice_row(
    voice: Voice,
    deafened: bool,
    sharing: bool,
    banked: bool,
    (mute_key, deafen_key): (Option<SharedString>, Option<SharedString>),
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let silent = voice != Voice::On;
    // On is a warning for these two, a muted microphone and stopped ears.
    let voice_button = |id, glyph, off: bool| {
        IconButton::new(id, glyph)
            .dims(30.0, 28.0)
            .glyph_size(15.0)
            .spread()
            .tone(if off { Tone::Danger } else { Tone::Muted })
            .variant(if off { Variant::Soft } else { Variant::Ghost })
    };
    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            voice_button("mute", if silent { "mic-off" } else { "mic" }, silent)
                // What a press will do, which is not the same thing twice.
                .tip_with_chosen_key(
                    match voice {
                        Voice::Off => "Turn voice on",
                        Voice::Muted => "Unmute",
                        Voice::On => "Mute",
                    },
                    mute_key,
                )
                .on_click(cx.listener(|shell, _, _, _| shell.engine.toggle_microphone())),
        )
        .child(
            voice_button(
                "deafen",
                if deafened {
                    "headphone-off"
                } else {
                    "headphones"
                },
                deafened,
            )
            .tip_with_chosen_key(
                if deafened { "Undeafen" } else { "Deafen" },
                deafen_key,
            )
            .on_click(cx.listener(|shell, _, _, _| shell.engine.toggle_deafen())),
        )
        // At the far end, unless the row is a bank of equal switches.
        .when(!banked, |row| row.child(div().flex_1()))
        .child({
            // On, a share is running, not a fault: the accent's colours.
            IconButton::new("share-screen", "screen-share")
                .dims(30.0, 28.0)
                .glyph_size(15.0)
                .spread()
                .variant(if sharing { Variant::Lit } else { Variant::Ghost })
                .tip(if sharing {
                    crate::words::t!("Stop sharing your screen")
                } else {
                    crate::words::t!("Share your screen")
                })
                .on_click(cx.listener(|shell, _, _, cx| shell.share_pressed(cx)))
        })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn channel(id: u32, parent: Option<u32>, name: &str, position: i32) -> Channel {
        Channel {
            id,
            parent,
            name: name.to_owned().into(),
            position,
            unread: 0,
            history: false,
            encrypted: false,
            listening: false,
            rights: crate::rights::Rights::ALL,
            restricted: false,
            signal: false,
            temporary: false,
            max_users: 0,
        }
    }

    /// Not a benchmark, a guard: ordering used to search the whole list
    /// for every channel in it, and a tree this size took seconds.
    #[test]
    fn a_tree_of_thousands_is_ordered_in_one_pass() {
        let channels: Vec<Channel> = (0..20_000_u32)
            .map(|id| channel(id, id.checked_sub(1).map(|above| above / 3), "c", 0))
            .collect();
        let started = std::time::Instant::now();
        let ordered = tree_order(&channels);
        let took = started.elapsed();
        assert_eq!(ordered.len(), channels.len());
        assert!(took < std::time::Duration::from_secs(1), "took {took:?}");
    }

    fn names(channels: &[Channel]) -> Vec<(String, usize)> {
        tree_order(channels)
            .into_iter()
            .map(|(at, depth)| (channels[at].name.to_string(), depth))
            .collect()
    }

    fn row(name: &str, depth: usize) -> (String, usize) {
        (name.to_owned(), depth)
    }

    #[test]
    fn children_follow_their_parent_by_position_then_name() {
        // Listed in an order nothing like the tree's.
        let channels = [
            channel(5, Some(2), "deep", 0),
            channel(3, Some(0), "beta", 0),
            channel(0, None, "Root", 0),
            channel(4, Some(0), "last", 9),
            channel(2, Some(0), "Alpha", 0),
            channel(6, Some(0), "first", -1),
        ];
        assert_eq!(
            names(&channels),
            [
                row("Root", 0),
                row("first", 1),
                row("Alpha", 1),
                row("deep", 2),
                row("beta", 1),
                row("last", 1),
            ]
        );
    }

    #[test]
    fn an_orphan_is_listed_and_a_loop_is_walked_once() {
        let orphan = [channel(0, None, "Root", 0), channel(7, Some(99), "lost", 0)];
        assert_eq!(names(&orphan), [row("lost", 0), row("Root", 0)]);

        let looped = [
            channel(0, None, "Root", 0),
            channel(1, Some(2), "a", 0),
            channel(2, Some(1), "b", 0),
            channel(3, Some(3), "self", 0),
        ];
        let listed = names(&looped);
        assert!(listed.contains(&row("Root", 0)) && listed.contains(&row("self", 0)));
        assert!(listed.len() <= looped.len(), "nothing is listed twice");
    }
}
