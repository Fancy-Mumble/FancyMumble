//! The channel column: search, the channel tree with who is in the current
//! channel, and the local user's own tile.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, Badge, IconButton, Kbd, Paper, Tone, Variant};
use super::widgets::{EMPHASIS, icon, label};
use crate::engine::{Channel, Connection, Conversation, User, Voice};
use crate::theme::{Fill, Theme};

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
    div()
        .flex_none()
        .w(theme.skin.column_width)
        .h_full()
        .flex()
        .flex_col()
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .child(
            div()
                .flex_none()
                .p(px(12.0))
                .pb(px(6.0))
                .child(search_box(shell, theme)),
        )
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
                .p(px(10.0))
                .child(user_tile(shell, theme, cx)),
        )
}

fn search_box(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .h(px(47.0))
        .flex()
        .items_center()
        .gap(px(8.0))
        .px(px(14.0))
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line2)
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
        let conversation = found.conversation;
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
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.open_conversation(conversation, cx);
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
    // A channel with people in it is the head of the card that lists them.
    let carded = occupants > 0;
    let solid = current && theme.skin.selection == Fill::Solid;
    let (ink, hash) = if solid {
        (theme.c.on_accent, theme.c.on_accent)
    } else if current {
        (theme.c.text, theme.c.accent_text)
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
        // A carded row gives two pixels each way to the card's own edge.
        .px(px(if carded { 10.0 } else { 12.0 }))
        // 37.4 in the web UI, which a browser draws as 38 whole pixels.
        .when(carded, |row| row.h(px(38.0)))
        .when(!carded, |row| row.py(px(10.0)))
        .rounded(theme.skin.radius_md)
        .when(carded, |row| row.rounded_b(px(0.0)))
        .border_1()
        .border_color(clear)
        .cursor_pointer()
        .text_size(px(12.5))
        .line_height(px(LINE))
        .text_color(ink)
        .map(|row| match (current, solid) {
            (true, true) => row.bg(theme.c.accent),
            (true, false) => row
                .bg(theme.c.accent_soft)
                .border_color(theme.c.accent_line),
            _ => row.hover(move |style| style.bg(hover)),
        })
        .when(current, |row| row.font_weight(EMPHASIS))
        .on_mouse_down(
            gpui::MouseButton::Right,
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                shell.open_channel_menu(id, event.position, cx);
            }),
        )
        // A click reads the channel; a double click moves into it.
        .on_click(cx.listener(move |shell, event: &gpui::ClickEvent, _, cx| {
            if event.click_count() >= 2 {
                shell.engine.join_channel(id);
            }
            shell.open_conversation(Conversation::Channel(id), cx);
        }))
        .child(
            div()
                .flex_none()
                .text_size(px(13.0))
                .line_height(px(13.0))
                .font_weight(theme.skin.weight)
                .text_color(hash)
                .child("#"),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(label(&channel.name, theme)),
        )
        .children(row_marks(channel, occupants, current, solid, hash, theme));
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

/// What rides at a channel row's trailing end: that it is listened to, how
/// much waits unread, how many are in it.
fn row_marks(
    channel: &Channel,
    occupants: usize,
    current: bool,
    solid: bool,
    hash: gpui::Hsla,
    theme: &Theme,
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
    if channel.unread > 0 && !current {
        marks.push(Badge::new(channel.unread).into_any_element());
    }
    if occupants > 0 && channel.parent.is_some() {
        let voice = if solid { theme.c.on_accent } else { theme.c.ok };
        marks.push(
            div()
                .flex()
                .items_center()
                .gap(px(4.2))
                .font_weight(theme.skin.weight)
                .text_size(px(10.5))
                .line_height(px(16.275))
                .text_color(voice)
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
        .rounded_b(theme.skin.radius_md)
        .bg(theme.c.card)
        .border_1()
        .border_t_0()
        .border_color(theme.c.line)
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
                let Some(user) = shell.snapshot.users.iter().find(|u| u.session == session) else {
                    return;
                };
                let mut items = super::menu::user_items(
                    user,
                    shell.snapshot.own_session,
                    shell.snapshot.current_channel,
                    shell.volumes.get(&session).copied().unwrap_or(1.0),
                    shell.whisper_target(),
                    user.hash.as_ref().is_some_and(|hash| shell.is_friend(hash)),
                );
                let open = match shell.open {
                    Some(Conversation::Channel(id)) => {
                        shell.snapshot.channels.iter().find(|c| c.id == id)
                    }
                    _ => None,
                };
                if shell.snapshot.own_session != Some(session) {
                    items.extend(super::menu::purge_item(user, open));
                }
                shell.open_menu(event.position, items, cx);
            }),
        )
        .when(open, |row| row.bg(theme.c.accent_soft))
        // A click on somebody else opens the direct conversation with them.
        .when(!own, |row| {
            row.cursor_pointer()
                .when(!open, |row| row.hover(move |style| style.bg(hover)))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.open_conversation(Conversation::Direct(session), cx);
                }))
        })
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
                .text_color(if own { theme.c.muted } else { theme.c.text })
                .child(user.name.clone()),
        )
        .when(user.deafened && !own, |row| {
            row.child(icon("headphone-off", 12.0, theme.c.dim))
        })
        .when(user.muted && !user.deafened && !own, |row| {
            row.child(icon("mic-off", 12.0, theme.c.dim))
        })
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
    let silent = shell.snapshot.voice != Voice::On;
    let (status, whisper_to) = voice_status(shell, deafened);
    // The pip says how the user is heard: not at all, muted, or live.
    let pip = match (shell.snapshot.voice, deafened) {
        (Voice::Off, _) => theme.c.dim,
        (_, true) | (Voice::Muted, _) => theme.c.bad,
        (Voice::On, false) => theme.c.ok,
    };
    Paper::raised()
        .flex()
        .items_center()
        .gap(px(14.0))
        .p(px(10.0))
        .child(
            Avatar::new(&name)
                .picture(own.and_then(|user| user.avatar.as_ref()))
                .size(42.0)
                .status(Some(pip)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(8.0))
                .child(
                    div()
                        .flex()
                        .items_start()
                        .justify_between()
                        .gap(px(8.0))
                        .child(
                            div()
                                .flex_1()
                                .min_w_0()
                                .flex()
                                .flex_col()
                                .gap(px(1.0))
                                .child(
                                    div()
                                        .truncate()
                                        .text_size(px(13.0))
                                        .line_height(px(14.95))
                                        .font_weight(EMPHASIS)
                                        .child(name),
                                )
                                .child(
                                    div()
                                        .debug_selector(|| "voice-status".to_owned())
                                        .truncate()
                                        .text_size(px(10.5))
                                        .line_height(px(14.175))
                                        .text_color(theme.c.muted)
                                        .child(status),
                                )
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
                                }),
                        )
                        .child(
                            div().child(
                                IconButton::new("own-menu", "ellipsis-vertical")
                                    .glyph_size(15.0)
                                    .on_click(cx.listener(
                                        |shell, event: &gpui::ClickEvent, _, cx| {
                                            let items =
                                                super::menu::own_items(shell.chrome.hide_empty);
                                            shell.open_menu(event.position(), items, cx);
                                        },
                                    )),
                            ),
                        ),
                )
                .child(voice_row(silent, deafened, cx)),
        )
}

/// The voice controls under the user's name: the microphone, the
/// headphones, and at the far end the screen.
fn voice_row(silent: bool, deafened: bool, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let voice_button = |id, glyph, off: bool| {
        IconButton::new(id, glyph)
            .dims(30.0, 28.0)
            .glyph_size(15.0)
            .tone(if off { Tone::Danger } else { Tone::Muted })
            .variant(if off { Variant::Soft } else { Variant::Ghost })
    };
    div()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            voice_button("mute", if silent { "mic-off" } else { "mic" }, silent)
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
            .on_click(cx.listener(|shell, _, _, _| shell.engine.toggle_deafen())),
        )
        .child(div().flex_1())
        .child(
            voice_button("share-screen", "screen-share", false).on_click(cx.listener(
                |shell, _, _, cx| {
                    shell.notice = Some("Screen sharing is not in this view yet.".into());
                    cx.notify();
                },
            )),
        )
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
