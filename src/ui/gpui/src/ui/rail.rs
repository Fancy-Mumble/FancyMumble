//! The server rail down the window's leading edge.

use gpui::{Context, IntoElement, ParentElement, Styled, div, prelude::*, px};

use super::Shell;
use super::widgets::icon;
use crate::theme::Theme;

pub(super) fn render(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let hover = theme.c.hover;
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
        // The connected server. One for now: the demo has one.
        .child(
            div()
                .size(px(40.0))
                .rounded(theme.skin.radius_rail)
                .bg(theme.c.rail_tile)
                .flex()
                .items_center()
                .justify_center()
                .child(icon("users", 20.0, theme.c.accent_on_rail)),
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
