//! The round mark in the middle of a video's still, which plays it.

use gpui::{App, IntoElement, ParentElement, RenderOnce, Styled, Window, div, px};

use super::icon;

/// A play mark, filling what it is in and centred there.
#[derive(Debug, Default, IntoElement)]
pub(crate) struct PlayMark;

impl RenderOnce for PlayMark {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        div()
            .absolute()
            .size_full()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .size(px(56.0))
                    .rounded_full()
                    .bg(gpui::black().opacity(0.6))
                    .flex()
                    .items_center()
                    .justify_center()
                    .child(icon("play", 24.0, gpui::white())),
            )
    }
}
