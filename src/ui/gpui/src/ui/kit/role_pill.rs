//! A role, drawn as the pill it is wherever one is named: a dot and the
//! name, in the colour the server gave the role. The web UI's `RoleChip`.

use gpui::{
    App, Hsla, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, px,
};

use crate::theme::ActiveTheme;

/// A role's pill.
///
/// ```ignore
/// RolePill::new(role.name.clone(), role.color)
/// ```
#[derive(IntoElement)]
pub(crate) struct RolePill {
    name: SharedString,
    color: Option<Hsla>,
}

impl RolePill {
    /// The pill of the role `name`, in `color` where the server gave it
    /// one; a role without is drawn neutral, never in a made-up colour.
    pub(crate) fn new(name: impl Into<SharedString>, color: Option<Hsla>) -> Self {
        Self {
            name: name.into(),
            color,
        }
    }
}

impl RenderOnce for RolePill {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        // Mixed, not used raw: a role's colour at full strength on a card
        // is a slab.
        let (ink, ground, edge) = match self.color {
            Some(color) => (color, Hsla { a: 0.18, ..color }, Hsla { a: 0.5, ..color }),
            None => (theme.c.text, theme.c.card2, gpui::transparent_black()),
        };
        // The web's small step: 11px words, 6px across and 1px down.
        div()
            .flex_none()
            .min_w_0()
            .overflow_hidden()
            .flex()
            .items_center()
            .gap(px(5.0))
            .px(px(6.0))
            .py(px(1.0))
            .rounded(theme.skin.radius_pill)
            .bg(ground)
            .border_1()
            .border_color(edge)
            .text_size(px(11.0))
            .line_height(px(13.2))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(ink)
            .child(div().flex_none().size(px(6.0)).rounded_full().bg(ink))
            .child(div().min_w_0().truncate().child(self.name))
    }
}
