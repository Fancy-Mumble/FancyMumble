//! A field that takes marks, boxed as the web UI's `RichTextField`: a strip
//! of buttons over it, each setting what is selected in the field apart, and
//! under them the field.
//!
//! ```ignore
//! MarkedField::new("status", field)
//!     .tool(Mark::Bold, "bold", t!("Bold"))
//!     .tool(Mark::Italic, "italic", t!("Italic"))
//! ```

use gpui::{
    App, Entity, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, px,
};

use super::{Corner, IconButton};
use super::super::marking::Mark;
use super::super::text_input::TextInput;
use crate::theme::ActiveTheme;

/// How tall the strip of buttons is, its rule under it included.
const STRIP: f32 = 33.0;

/// The field and its strip.
#[derive(IntoElement)]
pub(crate) struct MarkedField {
    id: &'static str,
    field: Entity<TextInput>,
    tools: Vec<(Mark, &'static str, SharedString)>,
}

impl MarkedField {
    /// `field` under an empty strip; `id` names the buttons `<id>-<n>`.
    pub(crate) fn new(id: &'static str, field: Entity<TextInput>) -> Self {
        Self {
            id,
            field,
            tools: Vec::new(),
        }
    }

    /// A button that sets the selection apart with `mark`, drawn as `glyph`
    /// and named `says`.
    pub(crate) fn tool(mut self, mark: Mark, glyph: &'static str, says: SharedString) -> Self {
        self.tools.push((mark, glyph, says));
        self
    }
}

impl RenderOnce for MarkedField {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let field = self.field;
        let buttons: Vec<_> = self
            .tools
            .into_iter()
            .enumerate()
            .map(|(at, (mark, glyph, says))| {
                let field = field.clone();
                IconButton::at(self.id, at, glyph)
                    .dims(26.0, 24.0)
                    .glyph_size(13.0)
                    .corner(Corner::Small)
                    .tip(says)
                    .on_click(move |_, _, cx| {
                        field.update(cx, |field, cx| field.toggle_mark(mark, cx));
                    })
            })
            .collect();
        div()
            .w_full()
            .flex()
            .flex_col()
            .rounded(theme.skin.radius_md)
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line2)
            .overflow_hidden()
            .child(
                div()
                    .h(px(STRIP))
                    .px(px(6.0))
                    .flex()
                    .items_center()
                    .gap(px(2.0))
                    .border_b_1()
                    .border_color(theme.c.line)
                    .children(buttons),
            )
            .child(
                div()
                    .px(px(13.0))
                    .py(px(8.0))
                    .text_size(px(12.5))
                    .line_height(px(19.375))
                    .child(field),
            )
    }
}
