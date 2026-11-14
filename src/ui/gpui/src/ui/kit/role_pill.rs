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
    step: PillStep,
}

/// How large a pill is: the web UI's three steps of `RoleChip`, each its
/// words' size and the room across and down.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum PillStep {
    /// In a table's row, beside a name.
    #[default]
    Small,
    /// In a list of roles.
    Medium,
    /// In a preview of how a role looks.
    Large,
}

impl PillStep {
    /// Its words' size, and the room across and down.
    fn measures(self) -> (f32, f32, f32) {
        match self {
            Self::Small => (11.0, 6.0, 1.0),
            Self::Medium => (12.0, 9.0, 2.5),
            Self::Large => (13.0, 12.0, 5.0),
        }
    }
}

impl RolePill {
    /// The pill of the role `name`, in `color` where the server gave it
    /// one; a role without is drawn neutral, never in a made-up colour.
    pub(crate) fn new(name: impl Into<SharedString>, color: Option<Hsla>) -> Self {
        Self {
            name: name.into(),
            color,
            step: PillStep::Small,
        }
    }

    /// Drawn a step larger than in a row.
    #[must_use]
    pub(crate) fn step(mut self, step: PillStep) -> Self {
        self.step = step;
        self
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
        let (size, across, down) = self.step.measures();
        div()
            .flex_none()
            .min_w_0()
            .overflow_hidden()
            .flex()
            .items_center()
            .gap(px(5.0))
            .px(px(across))
            .py(px(down))
            .rounded(theme.skin.radius_pill)
            .bg(ground)
            .border_1()
            .border_color(edge)
            .text_size(px(size))
            .line_height(px(size * 1.2))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .text_color(ink)
            // The dot is cornered as the pill is: square in a theme that
            // squares its pills, as the web UI's.
            .child(
                div()
                    .flex_none()
                    .size(px(size * 0.55))
                    .rounded(theme.skin.radius_pill)
                    .bg(ink),
            )
            .child(div().min_w_0().truncate().child(self.name))
    }
}
