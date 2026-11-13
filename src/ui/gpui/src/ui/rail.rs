//! The server rail down the window's leading edge: one tile for each server
//! the engine is on, a way to add another, and the way off the one showing.

use gpui::{Context, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::Shell;
use super::connect::{initials, tile_color};
use super::widgets::{EMPHASIS, icon};
use crate::theme::Theme;

pub(super) fn render(
    shell: &Shell,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
    let tiles: Vec<_> = shell
        .snapshot
        .sessions
        .iter()
        .map(|session| {
            // The active tile is marked only while its server is showing:
            // with the connect screen up, none of them is "where you are".
            let showing = session.active && !shell.adding_server;
            let id = session.id.clone();
            let tag = session.name.clone();
            div()
                .id(SharedString::from(format!("session-{}", session.id)))
                .debug_selector(move || format!("session-{tag}"))
                .flex_none()
                .size(px(40.0))
                .rounded(theme.skin.radius_rail)
                .p(px(3.0))
                .cursor_pointer()
                .when(showing, |tile| tile.bg(theme.c.accent_on_rail))
                .on_click(cx.listener(move |shell, _, _, cx| {
                    shell.adding_server = false;
                    shell.engine.activate_session(&id);
                    cx.notify();
                }))
                .child(
                    div()
                        .size_full()
                        .rounded(theme.skin.radius_rail)
                        .bg(tile_color(&session.name))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_size(px(12.0))
                        .font_weight(EMPHASIS)
                        .text_color(gpui::white())
                        .child(initials(&session.name)),
                )
        })
        .collect();
    div()
        .flex_none()
        .w(theme.skin.rail_width)
        .h_full()
        .flex()
        .flex_col()
        .items_center()
        .gap(px(8.0))
        .py(px(12.0))
        .bg(theme.c.rail)
        .border_r_1()
        .border_color(theme.c.rail_line)
        .children(tiles)
        .child(
            div()
                .id("add-session")
                .debug_selector(|| "add-session".to_owned())
                .flex_none()
                .size(px(34.0))
                .rounded(theme.skin.radius_rail)
                .border_1()
                .border_dashed()
                .border_color(theme.c.rail_line)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .when(shell.adding_server, |tile| tile.bg(theme.c.rail_tile))
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, _, cx| {
                    shell.adding_server = !shell.adding_server;
                    shell.engine.refresh_pings();
                    cx.notify();
                }))
                .child(icon("plus", 15.0, theme.c.muted)),
        )
        .child(div().flex_1())
        .child(
            div()
                .id("leave")
                .debug_selector(|| "leave".to_owned())
                .size(px(30.0))
                .rounded(theme.skin.radius_sm)
                .flex()
                .items_center()
                .justify_center()
                .cursor_pointer()
                .hover(move |style| style.bg(hover))
                .on_click(cx.listener(|shell, _, _, _| shell.engine.disconnect()))
                .child(icon("log-out", 16.0, theme.c.bad)),
        )
}
