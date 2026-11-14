//! What rides on a picture somebody sent: a chip of facts in its corner and
//! the buttons that come up over it.
//!
//! Whatever is behind them is somebody's photograph, so they bring their own
//! dark scrim rather than a colour of the theme, which could vanish into the
//! picture: the web client's `.frameFacts`, `.bareBtn` and the overlaid
//! reach flag, which are the same on every theme for the same reason. Their
//! corners are the theme's.

use gpui::{
    App, Div, ElementId, Hsla, IntoElement, MouseButton, ParentElement, RenderOnce, SharedString,
    Stateful, Styled, Window, div, prelude::*, px, rgba,
};

use super::focus::Reachable;
use crate::theme::ActiveTheme;

/// The scrim under a chip: `rgba(10,13,20,0.72)`.
fn chip_scrim() -> Hsla {
    rgba(0x0a0d14b8).into()
}

/// The scrim under a button, and under it while the pointer is on it:
/// `rgba(10,12,20,0.58)` and `0.78`.
fn button_scrim(hovered: bool) -> Hsla {
    if hovered {
        rgba(0x0a0c14c7).into()
    } else {
        rgba(0x0a0c1494).into()
    }
}

/// The hairline round a chip or a button: white at 14 or 16 percent.
fn hairline() -> Hsla {
    rgba(0xffffff24).into()
}

/// The ink of what is written on them.
fn ink() -> Hsla {
    rgba(0xe6e8eeff).into()
}

/// A chip of facts, `3.8 MiB · session · expires 21/11`, with whatever
/// rides the same line after the words (a reach flag).
#[derive(IntoElement)]
pub(crate) struct FactsChip {
    facts: Vec<SharedString>,
    extra: Option<gpui::AnyElement>,
}

impl FactsChip {
    pub(crate) fn new(facts: Vec<SharedString>) -> Self {
        Self { facts, extra: None }
    }

    /// Something that rides the line after the facts, if anything does.
    pub(crate) fn extra(mut self, extra: Option<gpui::AnyElement>) -> Self {
        self.extra = extra;
        self
    }
}

impl RenderOnce for FactsChip {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let mut line = div()
            .debug_selector(|| "picture-facts".to_owned())
            .flex()
            .flex_wrap()
            .items_center()
            .gap(px(4.8))
            .px(px(8.8))
            .py(px(3.2))
            .rounded(theme.skin.radius_pill)
            .border_1()
            .border_color(hairline())
            .bg(chip_scrim())
            .text_color(ink())
            .text_size(px(11.2))
            .line_height(px(16.8));
        for (at, fact) in self.facts.into_iter().enumerate() {
            if at > 0 {
                line = line.child(div().opacity(0.55).child("·"));
            }
            line = line.child(fact);
        }
        line.children(self.extra)
    }
}

/// A button over a picture: `Save`, `Open`, a flag that copies a link. A
/// stop of the keyboard's, and a press on it is its own, never the
/// picture's under it.
#[derive(IntoElement)]
pub(crate) struct OverButton {
    id: ElementId,
    control: Stateful<Div>,
}

impl OverButton {
    /// A button with id `id` that says `content` (words, an icon, or both).
    pub(crate) fn new(id: impl Into<ElementId>, content: impl IntoElement) -> Self {
        let id = id.into();
        let control = div()
            .id(id.clone())
            .flex()
            .items_center()
            .gap(px(5.0))
            .px(px(9.6))
            .py(px(4.8))
            .border_1()
            .border_color(hairline())
            .bg(button_scrim(false))
            .hover(|style| style.bg(button_scrim(true)))
            .text_color(rgba(0xffffffff))
            .text_size(px(12.0))
            .font_weight(gpui::FontWeight::SEMIBOLD)
            .cursor_pointer()
            // The picture under it opens on a click; this one is not that.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .child(content);
        Self { id, control }
    }

    /// What it does when pressed.
    pub(crate) fn on_click(
        mut self,
        handler: impl Fn(&gpui::ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.control = self.control.on_click(move |event, window, cx| {
            cx.stop_propagation();
            handler(event, window, cx);
        });
        self
    }

    /// What a test finds it by.
    pub(crate) fn named(mut self, name: String) -> Self {
        self.control = self.control.debug_selector(move || name.clone());
        self
    }

    /// What it says when the pointer rests on it.
    pub(crate) fn tip(mut self, says: impl Into<SharedString>) -> Self {
        self.control = self
            .control
            .tooltip(super::tooltip::keyed_tip(says, None::<&str>));
        self
    }
}

impl RenderOnce for OverButton {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let corner = ActiveTheme::get(cx).skin.radius_sm;
        Reachable::new(self.id, self.control.rounded(corner)).corner(corner)
    }
}
