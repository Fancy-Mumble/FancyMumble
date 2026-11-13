//! The channel column: search, the channel tree with who is in the current
//! channel, and the local user's own tile.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::widgets::{EMPHASIS, avatar, icon, label};
use crate::engine::{Channel, Connection, User};
use crate::theme::{Fill, Theme};

/// How far each level of the channel tree steps in.
const INDENT: f32 = 11.0;

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
        .gap(px(12.0))
        .p(px(12.0))
        .bg(theme.c.panel)
        .border_r_1()
        .border_color(theme.c.line)
        .child(search_box(shell, theme))
        .child(
            div()
                .id("channels")
                .flex_1()
                .min_h_0()
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap(px(4.0))
                .children(channel_rows(shell, theme, cx)),
        )
        .child(user_tile(shell, theme, cx))
}

fn search_box(shell: &Shell, theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .h(px(46.0))
        .flex()
        .items_center()
        .gap(px(10.0))
        .px(px(14.0))
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line2)
        .child(icon("search", 14.0, theme.c.dim))
        .child(shell.search.clone())
        .child(
            div()
                .flex_none()
                .px(px(6.0))
                .py(px(1.0))
                .rounded(theme.skin.radius_sm)
                .bg(theme.c.card2)
                .text_size(px(10.5))
                .text_color(theme.c.muted)
                .child("Ctrl+F"),
        )
}

/// The channel tree, flattened to rows, narrowed by the search field.
fn channel_rows(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Vec<AnyElement> {
    let wanted = shell.search.read(cx).text().trim().to_lowercase();
    let mut rows = Vec::new();
    for channel in &shell.snapshot.channels {
        if !wanted.is_empty() && !channel.name.to_lowercase().contains(&wanted) {
            continue;
        }
        let current = shell.snapshot.current_channel == Some(channel.id);
        rows.push(channel_row(shell, channel, current, theme, cx));
        if current {
            rows.push(occupant_list(shell, channel, theme));
        }
    }
    rows
}

fn channel_row(
    shell: &Shell,
    channel: &Channel,
    current: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    let occupants = shell.occupants(channel.id).count();
    let depth = shell.depth(channel);
    let solid = current && theme.skin.selection == Fill::Solid;
    let (ink, hash) = if solid {
        (theme.c.on_accent, theme.c.on_accent)
    } else if current {
        (theme.c.text, theme.c.muted)
    } else {
        (theme.c.muted, theme.c.dim)
    };
    let hover = theme.c.hover;
    let id = channel.id;
    div()
        .id(("channel", id as usize))
        .flex_none()
        .h(px(36.0))
        .flex()
        .items_center()
        .gap(px(9.0))
        .px(px(14.0))
        .ml(px(INDENT * depth as f32))
        .rounded(theme.skin.radius_md)
        .cursor_pointer()
        .text_color(ink)
        .map(|row| match (current, solid) {
            (true, true) => row.bg(theme.c.accent),
            (true, false) => row
                .bg(theme.c.accent_soft)
                .border_1()
                .border_color(theme.c.accent_line),
            _ => row.hover(move |style| style.bg(hover)),
        })
        .when(current, |row| row.font_weight(EMPHASIS))
        .on_click(cx.listener(move |shell, _, _, _| shell.engine.join_channel(id)))
        .child(icon("hash", 13.0, hash))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .child(label(&channel.name, theme)),
        )
        .when(occupants > 0 && channel.parent.is_some(), |row| {
            let voice = if solid { theme.c.on_accent } else { theme.c.ok };
            row.child(
                div()
                    .flex()
                    .items_center()
                    .gap(px(5.0))
                    .text_size(px(11.5))
                    .text_color(voice)
                    .child(icon("volume-2", 11.0, voice))
                    .child(SharedString::from(occupants.to_string())),
            )
        })
        .into_any_element()
}

/// Who is in the current channel, on a card hanging under its row.
fn occupant_list(shell: &Shell, channel: &Channel, theme: &Theme) -> AnyElement {
    div()
        .flex_none()
        .ml(px(INDENT * shell.depth(channel) as f32))
        .flex()
        .flex_col()
        .py(px(4.0))
        .rounded(theme.skin.radius_md)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line)
        .children(
            shell
                .occupants(channel.id)
                .map(|user| occupant_row(shell, user, theme)),
        )
        .into_any_element()
}

fn occupant_row(shell: &Shell, user: &User, theme: &Theme) -> impl IntoElement + use<> {
    let own = shell.snapshot.own_session == Some(user.session);
    let talking = shell.talking.contains(&user.session);
    div()
        .h(px(31.0))
        .flex()
        .items_center()
        .gap(px(9.0))
        .px(px(14.0))
        .child(
            // The ring a talking user wears; always present so a row does not
            // shift by a pixel when somebody speaks.
            div()
                .flex_none()
                .rounded(super::widgets::avatar_radius(24.0, theme))
                .border_2()
                .border_color(if talking {
                    theme.c.ok
                } else {
                    gpui::transparent_black()
                })
                .child(avatar(&user.name, 20.0, theme)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .truncate()
                .text_color(if own { theme.c.muted } else { theme.c.text })
                .child(user.name.clone()),
        )
        .when(user.self_deaf, |row| {
            row.child(icon("headphone-off", 12.0, theme.c.dim))
        })
        .when(user.self_mute && !own, |row| {
            row.child(icon("mic-off", 12.0, theme.c.dim))
        })
        .when(own, |row| {
            row.child(
                div()
                    .text_size(px(10.5))
                    .text_color(theme.c.dim)
                    .child("you"),
            )
        })
}

/// The local user's tile: who they are, and the voice controls.
fn user_tile(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let (name, muted, deafened) = shell.own_user().map_or_else(
        || (SharedString::from("Not connected"), true, false),
        |user| (user.name.clone(), user.self_mute, user.self_deaf),
    );
    let status = match (shell.snapshot.connection, deafened, muted) {
        (Connection::Disconnected, ..) => "Not connected",
        (Connection::Connecting, ..) => "Connecting…",
        (Connection::Connected, true, _) => "Deafened",
        (Connection::Connected, false, true) => "Voice off",
        (Connection::Connected, false, false) => "Voice on",
    };
    div()
        .flex_none()
        .flex()
        .gap(px(12.0))
        .p(px(10.0))
        .rounded(theme.skin.radius_lg)
        .bg(theme.c.card)
        .border_1()
        .border_color(theme.c.line2)
        .child(avatar(&name, 42.0, theme))
        .child(
            div()
                .flex_1()
                .min_w_0()
                .flex()
                .flex_col()
                .gap(px(6.0))
                .child(
                    div()
                        .flex()
                        .items_center()
                        .justify_between()
                        .child(
                            div()
                                .flex()
                                .flex_col()
                                .child(div().font_weight(EMPHASIS).child(name))
                                .child(
                                    div()
                                        .text_size(px(11.5))
                                        .text_color(theme.c.muted)
                                        .child(status),
                                ),
                        )
                        .child(icon("ellipsis-vertical", 15.0, theme.c.muted)),
                )
                .child(
                    div()
                        .flex()
                        .items_center()
                        .gap(px(6.0))
                        .child(
                            voice_button(
                                "mute",
                                if muted { "mic-off" } else { "mic" },
                                muted,
                                theme,
                            )
                            .on_click(cx.listener(
                                move |shell, _, _, _| {
                                    shell.engine.set_self_mute(!muted);
                                },
                            )),
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
                                theme,
                            )
                            .on_click(cx.listener(
                                move |shell, _, _, _| {
                                    shell.engine.set_self_deaf(!deafened);
                                },
                            )),
                        )
                        .child(div().flex_1())
                        .child(icon("monitor-up", 16.0, theme.c.muted)),
                ),
        )
}

/// A voice control. `off` draws it in the destructive colour: a muted
/// microphone is the state worth noticing.
fn voice_button(
    id: &'static str,
    glyph: &'static str,
    off: bool,
    theme: &Theme,
) -> gpui::Stateful<gpui::Div> {
    let hover = theme.c.hover;
    let mut soft = theme.c.bad;
    soft.a = 0.16;
    let mut edge = theme.c.bad;
    edge.a = 0.45;
    div()
        .id(id)
        .size(px(30.0))
        .rounded(theme.skin.radius_sm)
        .flex()
        .items_center()
        .justify_center()
        .cursor_pointer()
        .map(|button| {
            if off {
                button.bg(soft).border_1().border_color(edge)
            } else {
                button.hover(move |style| style.bg(hover))
            }
        })
        .child(icon(
            glyph,
            15.0,
            if off { theme.c.bad } else { theme.c.muted },
        ))
}
