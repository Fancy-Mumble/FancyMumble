//! The tick box a menu row leads with: filled with the accent and ticked
//! when on, an empty chip when off. The web UI's `MenuCheckBox`.

use gpui::{App, IntoElement, ParentElement, RenderOnce, Styled, Window, div, prelude::*, px};

use super::icon;
use crate::theme::ActiveTheme;

/// A tick box, 15px square.
#[derive(IntoElement)]
pub(crate) struct TickBox {
    ticked: bool,
}

impl TickBox {
    pub(crate) fn new(ticked: bool) -> Self {
        Self { ticked }
    }
}

impl RenderOnce for TickBox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (ground, edge) = if self.ticked {
            (theme.c.accent, theme.c.accent)
        } else {
            (theme.c.card2, theme.c.line2)
        };
        div()
            .flex_none()
            .size(px(15.0))
            .rounded(theme.skin.radius_sm)
            .bg(ground)
            .border_1()
            .border_color(edge)
            .flex()
            .items_center()
            .justify_center()
            .when(self.ticked, |tick| {
                tick.child(icon("check", 9.0, theme.c.on_accent))
            })
    }
}
