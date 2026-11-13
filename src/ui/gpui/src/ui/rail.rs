//! The server rail down the window's leading edge: a tile for each server
//! the engine is on, a way to add another, and the way off the one showing.

use gpui::{
    AnyElement, Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::Shell;
use super::kit::{Avatar, IconButton, Tone, Variant};
use crate::engine::SessionEntry;
use crate::theme::Theme;

/// Every tile, and the buttons that bracket them, are one square.
const TILE: f32 = 40.0;
/// How wide the rail is with the servers' names beside their tiles.
const WIDE: f32 = 220.0;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let wide = shell.chrome.rail_wide;
    let tiles: Vec<_> = shell
        .snapshot
        .sessions
        .iter()
        .map(|session| session_tile(shell, session, wide, theme, cx))
        .collect();
    div()
        .flex_none()
        .w(if wide {
            px(WIDE)
        } else {
            theme.skin.rail_width
        })
        .h_full()
        .flex()
        .flex_col()
        .when(!wide, Styled::items_center)
        .gap(px(8.0))
        .py(px(10.0))
        .px(px(7.5))
        .bg(theme.c.rail)
        .border_r_1()
        .border_color(theme.c.line)
        .child(
            IconButton::new(
                "rail-widen",
                if wide {
                    "chevron-left"
                } else {
                    "chevron-right"
                },
            )
            .size(TILE)
            .glyph_size(15.0)
            .settle_left()
            .tone(Tone::Rail)
            .on_click(cx.listener(|shell, _, _, cx| {
                shell.chrome.rail_wide = !shell.chrome.rail_wide;
                cx.notify();
            })),
        )
        .child(rule(theme))
        .child(
            IconButton::new("friends", "users")
                .size(TILE)
                .glyph_size(22.0)
                .variant(Variant::Tonal)
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.panels.friends.open = true;
                    cx.notify();
                })),
        )
        .child(rule(theme))
        // A pixel closer than the rest, as the web UI's list sets them.
        .child(
            div().flex().flex_col().gap(px(7.0)).children(tiles).child(
                IconButton::new("add-session", "plus")
                    .size(TILE)
                    .glyph_size(15.0)
                    .settle_left()
                    .tone(Tone::Rail)
                    .variant(if shell.adding_server {
                        Variant::Tonal
                    } else {
                        Variant::Dashed
                    })
                    .on_click(cx.listener(|shell, _, _, cx| {
                        shell.adding_server = !shell.adding_server;
                        shell.engine.refresh_pings();
                        cx.notify();
                    })),
            ),
        )
        .child(div().flex_1())
        .child(
            IconButton::new("leave", "log-out")
                .size(TILE)
                .glyph_size(15.0)
                .settle_left()
                .tone(Tone::Danger)
                .on_click(cx.listener(|shell, _, _, _| shell.engine.disconnect())),
        )
}

/// The hairline between one group of the rail and the next.
fn rule(theme: &Theme) -> impl IntoElement + use<> {
    div()
        .flex_none()
        .w(px(22.0))
        .h(px(1.0))
        .mx(px(9.0))
        .bg(theme.c.line2)
}

/// One server the engine is on: its tile, ringed while it is the one on
/// screen, with the pip that says the link is up; and its name, on a rail
/// wide enough for names.
fn session_tile(
    shell: &Shell,
    session: &SessionEntry,
    wide: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> AnyElement {
    // The active tile is marked only while its server is showing: with the
    // connect screen up, none of them is "where you are".
    let showing = session.active && !shell.adding_server;
    let id = session.id.clone();
    let tag = session.name.clone();
    let hover = theme.c.hover;
    div()
        .id(SharedString::from(format!("session-{}", session.id)))
        .debug_selector(move || format!("session-{tag}"))
        .flex_none()
        .flex()
        .items_center()
        .gap(px(10.0))
        .rounded(theme.skin.radius_rail)
        .cursor_pointer()
        .when(wide, |row| row.hover(move |style| style.bg(hover)))
        .on_click(cx.listener(move |shell, _, _, cx| {
            shell.adding_server = false;
            shell.engine.activate_session(&id);
            cx.notify();
        }))
        .on_mouse_down(gpui::MouseButton::Right, {
            let id = session.id.clone();
            cx.listener(move |shell, event: &gpui::MouseDownEvent, _, cx| {
                let items = super::menu::session_items(&id, showing);
                shell.open_menu(event.position, items, cx);
            })
        })
        .child(
            div()
                .relative()
                .flex_none()
                .size(px(TILE))
                .child(Avatar::new(&session.name).tile(&session.key).size(TILE))
                // The ring: two pixels of accent, two pixels clear of the tile.
                .when(showing, |tile| {
                    tile.child(
                        div()
                            .absolute()
                            .top(px(-4.0))
                            .left(px(-4.0))
                            .size(px(TILE + 8.0))
                            .rounded(theme.skin.radius_rail + px(4.0))
                            .border_2()
                            .border_color(theme.c.accent),
                    )
                })
                // The pip: a hole punched through the tile's corner, lit.
                .child(
                    div()
                        .absolute()
                        .right(px(-3.0))
                        .bottom(px(-3.0))
                        .size(px(13.0))
                        .rounded_full()
                        .bg(theme.c.bg0)
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(div().size(px(8.0)).rounded_full().bg(theme.c.ok)),
                ),
        )
        .when(wide, |row| {
            row.child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(12.5))
                    .text_color(if showing { theme.c.text } else { theme.c.muted })
                    .child(session.name.clone()),
            )
        })
        .into_any_element()
}
