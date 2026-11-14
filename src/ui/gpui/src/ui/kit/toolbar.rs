//! A toolbar: a row of tools on a floating surface, each an icon that says
//! what it does when rested on and shows whether it is on, set apart in
//! groups by upright hairlines.
//!
//! A press anywhere on a toolbar leaves the keyboard where it was: a bar of
//! tools floats over what they act on, and taking the keyboard from it would
//! take its selection too.

use gpui::{
    AnyElement, App, ClickEvent, IntoElement, ParentElement, Pixels, Point, RenderOnce,
    SharedString, Size, Styled, Window, div, point, prelude::*, px,
};

use super::{Corner, IconButton, Sheet, Tone, Variant};
use crate::theme::ActiveTheme;

type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// The least room left between something floating and the window's edge.
const EDGE: f32 = 8.0;

/// A row of tools on a floating surface. Fill it like a `div`.
///
/// ```ignore
/// Toolbar::new("format-bar")
///     .child(ToolButton::new("bold", "bold", "Bold").key("Ctrl+B").on(true))
///     .child(Divider::upright(16.0).inset(5.0))
/// ```
#[derive(IntoElement)]
pub(crate) struct Toolbar {
    id: &'static str,
    children: Vec<AnyElement>,
}

impl Toolbar {
    /// `id` also names it for the tests.
    pub(crate) fn new(id: &'static str) -> Self {
        Self {
            id,
            children: Vec::new(),
        }
    }

    /// Where a toolbar `size` big stands to float over something: centred
    /// on `middle`, its foot at `foot`, and kept inside a window `room` big.
    pub(crate) fn stand(
        middle: Pixels,
        foot: Pixels,
        size: Size<Pixels>,
        room: Size<Pixels>,
    ) -> Point<Pixels> {
        let edge = px(EDGE);
        let furthest = (room.width - size.width - edge).max(edge);
        let left = (middle - size.width / 2.0).min(furthest).max(edge);
        let top = (foot - size.height).max(edge);
        point(left, top)
    }
}

impl ParentElement for Toolbar {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl RenderOnce for Toolbar {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let id = self.id;
        div()
            .debug_selector(move || id.to_owned())
            // Before anything on it hears the press: whatever takes focus
            // on a press does not, unless it asks for it itself.
            .capture_any_mouse_down(|_, window, _| window.prevent_default())
            .child(
                Sheet::new(id)
                    .flex()
                    .items_center()
                    .gap(px(2.0))
                    .px(px(6.0))
                    .py(px(5.0))
                    .children(self.children),
            )
    }
}

/// A tool on a toolbar: an icon, what it does in a word or two and the key
/// that does the same, and whether what it does is on.
#[derive(IntoElement)]
pub(crate) struct ToolButton {
    id: &'static str,
    glyph: &'static str,
    says: SharedString,
    key: Option<SharedString>,
    on: bool,
    on_click: Option<OnClick>,
}

impl ToolButton {
    /// A tool showing the bundled icon `glyph`, saying `says` when rested
    /// on. `id` also names it for the tests.
    pub(crate) fn new(
        id: &'static str,
        glyph: &'static str,
        says: impl Into<SharedString>,
    ) -> Self {
        Self {
            id,
            glyph,
            says: says.into(),
            key: None,
            on: false,
            on_click: None,
        }
    }

    /// The key that does the same, named beside what it says.
    pub(crate) fn key(mut self, key: impl Into<SharedString>) -> Self {
        self.key = Some(key.into());
        self
    }

    /// Drawn pressed: what it does is on for what it acts on.
    pub(crate) fn on(mut self, on: bool) -> Self {
        self.on = on;
        self
    }

    pub(crate) fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for ToolButton {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let button = IconButton::new(self.id, self.glyph)
            .size(26.0)
            .glyph_size(15.0)
            .corner(Corner::Small)
            .when(self.on, |button| {
                button.variant(Variant::Soft).tone(Tone::Accent)
            });
        let button = match self.key {
            Some(key) => button.tip_with_key(self.says, key),
            None => button.tip(self.says),
        };
        match self.on_click {
            Some(handler) => button.on_click(handler),
            None => button,
        }
    }
}

/// The upright hairline that sets one group of a row apart from the next.
#[derive(IntoElement)]
pub(crate) struct Divider {
    height: f32,
    inset: f32,
}

impl Divider {
    /// A hairline `height` pixels tall.
    pub(crate) fn upright(height: f32) -> Self {
        Self { height, inset: 0.0 }
    }

    /// Room on either side of it, in pixels, beyond the row's own gap.
    pub(crate) fn inset(mut self, side: f32) -> Self {
        self.inset = side;
        self
    }
}

impl RenderOnce for Divider {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .flex_none()
            .w(px(1.0))
            .h(px(self.height))
            .mx(px(self.inset))
            .bg(theme.c.line2)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::size;

    #[test]
    fn a_toolbar_stands_centred_over_its_place_and_inside_the_window() {
        let bar = size(px(200.0), px(36.0));
        let room = size(px(1000.0), px(700.0));
        let at = |middle: f32, foot: f32| Toolbar::stand(px(middle), px(foot), bar, room);
        assert_eq!(
            at(500.0, 400.0),
            point(px(400.0), px(364.0)),
            "centred, foot on the line"
        );
        assert_eq!(at(20.0, 400.0).x, px(EDGE), "not off the leading edge");
        assert_eq!(
            at(990.0, 400.0).x,
            px(1000.0 - 200.0 - EDGE),
            "nor off the trailing one"
        );
        assert_eq!(at(500.0, 10.0).y, px(EDGE), "nor off the top");
        // A window narrower than the bar: its leading edge shows.
        let narrow = Toolbar::stand(px(50.0), px(400.0), bar, size(px(150.0), px(700.0)));
        assert_eq!(narrow.x, px(EDGE));
    }
}
