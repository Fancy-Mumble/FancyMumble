//! A one-line field in the box a settings page draws it in: the web UI's
//! small `TextField`, on the input's ground inside the stronger hairline.

use gpui::{
    App, Entity, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, prelude::*,
    px,
};

use crate::theme::ActiveTheme;
use crate::ui::text_input::TextInput;

/// How tall the box is.
const HEIGHT: f32 = 36.0;

/// The box around `field`, which holds what is typed.
///
/// ```ignore
/// TextBox::new(form.address.clone())
/// ```
#[derive(IntoElement)]
pub(crate) struct TextBox {
    field: Entity<TextInput>,
    name: Option<SharedString>,
}

impl TextBox {
    pub(crate) fn new(field: Entity<TextInput>) -> Self {
        Self { field, name: None }
    }

    /// What the tests call the box: a field is otherwise named by the words
    /// it shows while empty, and many show none.
    #[must_use]
    pub(crate) fn named(mut self, name: impl Into<SharedString>) -> Self {
        self.name = Some(name.into());
        self
    }
}

impl RenderOnce for TextBox {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .when_some(self.name, |field, name| {
                field.debug_selector(move || name.to_string())
            })
            .h(px(HEIGHT))
            .px(px(13.0))
            .flex()
            .items_center()
            .rounded(theme.skin.radius_md)
            .bg(theme.c.input)
            .border_1()
            .border_color(theme.c.line2)
            .text_size(px(12.5))
            .child(div().flex_1().min_w_0().child(self.field))
    }
}
