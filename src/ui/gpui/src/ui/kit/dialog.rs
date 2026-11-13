//! Surfaces that float over the window: a sheet, and a sheet in the middle
//! of a veil.

use gpui::{
    AnyElement, App, ClickEvent, Div, ElementId, InteractiveElement, IntoElement, MouseButton,
    ParentElement, RenderOnce, SharedString, StatefulInteractiveElement, StyleRefinement, Styled,
    Window, div, prelude::*, px,
};

use super::backdrop;
use crate::theme::ActiveTheme;
use crate::ui::widgets::EMPHASIS;

/// An opaque surface that floats over other content: a menu, a popover, the
/// body of a dialog. Style it and fill it like a `div`.
///
/// It is the window's own colour under the theme's tint - a glow of the
/// accent from its top leading corner - inside a hairline, casting the
/// theme's shadow: the web UI's floating surface.
#[derive(IntoElement)]
pub(crate) struct Sheet {
    id: ElementId,
    base: Div,
    children: Vec<AnyElement>,
    scrolls: bool,
    /// The extra-large corner of a dialog, not the large one of a menu.
    roomy: bool,
}

impl Sheet {
    pub(crate) fn new(id: &'static str) -> Self {
        Self {
            id: id.into(),
            base: div(),
            children: Vec::new(),
            scrolls: false,
            roomy: false,
        }
    }

    /// Let what does not fit be scrolled to, down the sheet.
    pub(crate) fn scrolls(mut self) -> Self {
        self.scrolls = true;
        self
    }
}

impl ParentElement for Sheet {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.children.extend(elements);
    }
}

impl Styled for Sheet {
    fn style(&mut self) -> &mut StyleRefinement {
        self.base.style()
    }
}

impl RenderOnce for Sheet {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let corner = if self.roomy {
            theme.skin.radius_xl
        } else {
            theme.skin.radius_lg
        };
        // What the backdrop is placed against: the sheet itself, which an
        // absolutely placed one already is.
        let mut base = self.base;
        if base.style().position.is_none() {
            base = base.relative();
        }
        base.id(self.id)
            .when(self.scrolls, StatefulInteractiveElement::overflow_y_scroll)
            .occlude()
            .rounded(corner)
            .bg(theme.c.bg0)
            .border_1()
            .border_color(theme.c.line2)
            .shadow(theme.c.shadow.cast())
            .child(backdrop(&theme.c.tint, theme.c.bg0, corner))
            // A press on the sheet is not a press on what it floats over.
            .on_mouse_down(MouseButton::Left, |_, _, cx| cx.stop_propagation())
            .children(self.children)
    }
}

type OnDismiss = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// A sheet in the middle of the window, over a veil that keeps clicks off
/// what is behind it. Styles and children go to the sheet: a column, with
/// the title at its head if it is given one.
///
/// ```ignore
/// Dialog::new("prompt").title("Rename").w(px(400.0)).child(field).child(actions)
/// ```
#[derive(IntoElement)]
pub(crate) struct Dialog {
    id: &'static str,
    sheet: Sheet,
    title: Option<SharedString>,
    veil: f32,
    on_dismiss: Option<OnDismiss>,
}

impl Dialog {
    /// `id` names the veil for the tests; the sheet is `<id>-sheet`.
    pub(crate) fn new(id: &'static str) -> Self {
        Self {
            id,
            sheet: Sheet::new(id),
            title: None,
            veil: 0.5,
            on_dismiss: None,
        }
    }

    /// What the dialog is, set at its head.
    pub(crate) fn title(mut self, title: impl Into<SharedString>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Let what does not fit be scrolled to, down the sheet.
    pub(crate) fn scrolls(mut self) -> Self {
        self.sheet = self.sheet.scrolls();
        self
    }

    /// How dark the veil is, from 0 to 1.
    pub(crate) fn veil(mut self, strength: f32) -> Self {
        self.veil = strength;
        self
    }

    /// What a click on the veil, outside the sheet, does.
    pub(crate) fn on_dismiss(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_dismiss = Some(Box::new(handler));
        self
    }
}

impl ParentElement for Dialog {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.sheet.extend(elements);
    }
}

impl Styled for Dialog {
    fn style(&mut self) -> &mut StyleRefinement {
        self.sheet.style()
    }
}

impl RenderOnce for Dialog {
    fn render(self, _: &mut Window, _: &mut App) -> impl IntoElement {
        let mut sheet = self.sheet.flex().flex_col();
        sheet.roomy = true;
        if let Some(title) = self.title {
            // First, whatever was added before it was given.
            sheet.children.insert(
                0,
                div()
                    .flex_none()
                    .text_size(px(16.0))
                    .font_weight(EMPHASIS)
                    .child(title)
                    .into_any_element(),
            );
        }
        div()
            .id(self.id)
            .debug_selector(|| self.id.to_owned())
            .absolute()
            .size_full()
            .top_0()
            .left_0()
            .occlude()
            .bg(gpui::hsla(0.0, 0.0, 0.0, self.veil))
            .flex()
            .items_center()
            .justify_center()
            .when_some(self.on_dismiss, |veil, handler| veil.on_click(handler))
            .child(sheet)
    }
}
