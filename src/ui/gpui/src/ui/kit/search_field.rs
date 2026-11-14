//! A field to search with: the magnifier and the words typed, on the
//! input's plate. The web UI's `SearchBox` (`nebula/components/primitives`).

use gpui::{
    App, Entity, IntoElement, ParentElement, RenderOnce, Styled, Window, div, prelude::*, px,
};

use crate::theme::{ActiveTheme, Kind};
use crate::ui::text_input::TextInput;

/// A search field around `field`, which holds what is typed.
///
/// ```ignore
/// SearchField::new(page.search.clone()).w(px(220.0))
/// ```
#[derive(IntoElement)]
pub(crate) struct SearchField {
    field: Entity<TextInput>,
    width: Option<f32>,
}

impl SearchField {
    pub(crate) fn new(field: Entity<TextInput>) -> Self {
        Self { field, width: None }
    }

    /// `width` wide, where it does not fill what it is in.
    #[must_use]
    pub(crate) fn width(mut self, width: f32) -> Self {
        self.width = Some(width);
        self
    }
}

impl RenderOnce for SearchField {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let finish = super::Finish::new(theme.c.input, Some(theme.c.line2));
        // 45 pixels inside its edge: a plate the theme cuts draws its edge
        // within that, a box around it.
        let cut = theme.skin.cuts.of(Kind::Plate).is_some();
        div()
            .flex_none()
            .when_some(self.width, |field, width| field.w(px(width)))
            .h(px(if cut { 45.0 } else { 47.0 }))
            .flex()
            .items_center()
            .gap(px(8.0))
            .px(px(14.0))
            .map(|field| super::shaped(field, Kind::Plate, finish, theme.skin.radius_lg, &theme))
            .text_size(px(12.5))
            .child(super::icon("search", 12.0, theme.c.dim).mt(px(-1.0)))
            .child(div().flex_1().min_w_0().child(self.field))
    }
}
