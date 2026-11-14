//! A row that shows a choice as it stands, and opens under itself to
//! change it: the web UI's `ExpandableRow`.
//!
//! Only one is open at a time, so a page of them reads as a summary of
//! every choice; the open one's panel continues the row, inside the same
//! edge.

use std::rc::Rc;

use gpui::{
    AnyElement, App, ClickEvent, IntoElement, ParentElement, RenderOnce, SharedString, Styled,
    Window, div, prelude::*, px,
};

use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;
use crate::ui::widgets::EMPHASIS;
use crate::words::t;

type OnToggle = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// A row with a glimpse of the choice, its name, the choice in words, and
/// the button that opens it; open, what changes it, under it.
///
/// ```ignore
/// Expandable::new("theme", swatch, "Theme", "Dark", open).on_toggle(...).child(picker)
/// ```
#[derive(IntoElement)]
pub(crate) struct Expandable {
    id: &'static str,
    preview: AnyElement,
    title: SharedString,
    value: SharedString,
    open: bool,
    on_toggle: Option<OnToggle>,
    body: Vec<AnyElement>,
}

impl Expandable {
    /// `id` names its button for the tests.
    pub(crate) fn new(
        id: &'static str,
        preview: impl IntoElement,
        title: impl Into<SharedString>,
        value: impl Into<SharedString>,
        open: bool,
    ) -> Self {
        Self {
            id,
            preview: preview.into_any_element(),
            title: title.into(),
            value: value.into(),
            open,
            on_toggle: None,
            body: Vec::new(),
        }
    }

    pub(crate) fn on_toggle(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_toggle = Some(Rc::new(handler));
        self
    }
}

impl ParentElement for Expandable {
    fn extend(&mut self, elements: impl IntoIterator<Item = AnyElement>) {
        self.body.extend(elements);
    }
}

impl RenderOnce for Expandable {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let (open, id, hover) = (self.open, self.id, theme.c.hover);
        let large = theme.skin.radius_lg;
        let button = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .flex_none()
            .px(px(15.0))
            .py(px(7.0))
            .rounded(theme.skin.radius_pill)
            .bg(theme.c.card2)
            .text_size(px(11.5))
            .font_weight(EMPHASIS)
            .cursor_pointer()
            .hover(move |style| style.bg(hover))
            .when_some(self.on_toggle, |button, handler| {
                button.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .child(if open { t!("Done") } else { t!("Change") });
        let ring = Ring {
            corner: theme.skin.radius_pill,
            ink: theme.c.accent,
        };
        let button = TabStop::new(id, window, cx).wrap(button, ring, window);
        let head = div()
            .mt(px(10.0))
            .px(px(14.0))
            .py(px(12.0))
            .flex()
            .items_center()
            .gap(px(12.0))
            .bg(theme.c.card)
            .border_1()
            .border_color(theme.c.line)
            .map(|head| {
                if open {
                    head.border_b_0().rounded_t(large)
                } else {
                    head.rounded(large)
                }
            })
            .child(div().flex_none().flex().items_center().child(self.preview))
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
                    .child(
                        div()
                            .text_size(px(11.0))
                            .text_color(theme.c.muted)
                            .truncate()
                            .child(self.value),
                    ),
            )
            .child(button);
        div().child(head).when(open, |row| {
            row.child(
                div()
                    .px(px(16.0))
                    .pt(px(16.0))
                    .pb(px(14.0))
                    .bg(theme.c.card)
                    .border_1()
                    .border_t_0()
                    .border_color(theme.c.line)
                    .rounded_b(large)
                    .children(self.body),
            )
        })
    }
}
