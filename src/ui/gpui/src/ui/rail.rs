//! The server rail down the window's leading edge.

use gpui::{Context, IntoElement, ParentElement, Styled, div, px};

use super::Shell;
use super::widgets::icon;
use crate::theme::Theme;

pub(super) fn render(theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement + use<> {
    let _ = cx;
    let rule = || {
        div()
            .flex_none()
            .w(px(22.0))
            .h(theme.skin.line_width)
            .bg(theme.c.rail_line)
    };
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
        .child(
            div()
                .size(px(30.0))
                .flex()
                .items_center()
                .justify_center()
                .child(icon("chevron-right", 16.0, theme.c.rail_text)),
        )
        .child(rule())
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
        .child(rule())
        .child(
            div()
                .size(px(40.0))
                .rounded(theme.skin.radius_rail)
                .border_1()
                .border_dashed()
                .border_color(theme.c.rail_line)
                .flex()
                .items_center()
                .justify_center()
                .child(icon("plus", 16.0, theme.c.rail_dim)),
        )
        .child(div().flex_1())
        .child(
            div()
                .size(px(30.0))
                .flex()
                .items_center()
                .justify_center()
                .child(icon("log-out", 16.0, theme.c.bad)),
        )
}
