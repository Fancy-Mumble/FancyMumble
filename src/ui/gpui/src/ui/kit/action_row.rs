//! A setting whose control is a button: what it is, a line of what it
//! does, and the button at the row's end. The web UI's `ActionRow`.

use gpui::{
    AnyElement, App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div, px,
    relative,
};

use crate::theme::ActiveTheme;
use crate::ui::widgets::EMPHASIS;

#[derive(IntoElement)]
pub(crate) struct ActionRow {
    title: SharedString,
    hint: Option<SharedString>,
    action: AnyElement,
}

impl ActionRow {
    pub(crate) fn new(title: impl Into<SharedString>, action: impl IntoElement) -> Self {
        Self {
            title: title.into(),
            hint: None,
            action: action.into_any_element(),
        }
    }

    pub(crate) fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }
}

impl RenderOnce for ActionRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .mb(px(14.0))
            .flex()
            .items_center()
            .gap(px(16.0))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_size(px(12.5))
                            .font_weight(EMPHASIS)
                            .child(self.title),
                    )
                    .children(self.hint.map(|hint| {
                        div()
                            .mt(px(3.0))
                            .text_size(px(11.5))
                            .line_height(relative(1.5))
                            .text_color(theme.c.muted)
                            .child(hint)
                    })),
            )
            .child(div().flex_none().child(self.action))
    }
}
