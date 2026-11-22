//! A list beside the detail of what is chosen in it, as most pages of the
//! administration lay out what they look after: the web UI's `SplitView`,
//! `ListRow` and `DetailPlaceholder` (`nebula/components/admin/controls.tsx`).
//!
//! The two sides scroll apart: the list is often long and the detail
//! short, and one scroller would mean scrolling to the end of a long list to
//! reach the form for its first entry.
//!
//! ```ignore
//! SplitView::new("bans", rows, detail)
//! ListRow::new(("ban", at), title).subtitle(about).selected(true).on_click(...)
//! ```

use gpui::{
    AnyElement, App, ClickEvent, ElementId, IntoElement, ParentElement, RenderOnce, SharedString,
    Styled, Window, div, prelude::*, px,
};

use super::Reachable;
use super::edges::{Edge, edged};
use crate::theme::ActiveTheme;
use crate::ui::widgets::EMPHASIS;

/// What a click on a row does.
type OnClick = Box<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// How wide the list is.
const LIST_WIDTH: f32 = 300.0;
/// How tall either side may grow before it scrolls: the web UI's 62 % of
/// the window, taken of the window the settings are drawn in.
const MOST: f32 = 0.62;
/// How tall the detail is at least, when it says nothing is chosen.
const PLACEHOLDER_HEIGHT: f32 = 180.0;

/// The list and the detail, side by side.
#[derive(IntoElement)]
pub(crate) struct SplitView {
    id: &'static str,
    list: Vec<AnyElement>,
    detail: AnyElement,
}

impl SplitView {
    /// `list`'s rows in the card on the left, `detail` beside it. `id`
    /// names the two scrollers `<id>-list` and `<id>-detail`.
    pub(crate) fn new(id: &'static str, list: Vec<AnyElement>, detail: impl IntoElement) -> Self {
        Self {
            id,
            list,
            detail: detail.into_any_element(),
        }
    }
}

impl RenderOnce for SplitView {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let most = window.viewport_size().height * MOST;
        let list = SharedString::from(format!("{}-list", self.id));
        let detail = SharedString::from(format!("{}-detail", self.id));
        div()
            .flex()
            .gap(px(12.0))
            .min_h_0()
            .child(super::ScrollArea::div(
                ElementId::Name(list.clone()),
                div()
                    .id(ElementId::Name(list))
                    .flex_none()
                    .w(px(LIST_WIDTH))
                    .max_h(most)
                    .overflow_y_scroll()
                    .p(px(6.0))
                    .rounded(theme.skin.radius_lg)
                    .bg(theme.c.card)
                    .map(|list| edged(list, Edge::All, theme.skin.line_width))
                    .border_color(theme.c.line)
                    .children(self.list),
            ))
            .child(super::ScrollArea::div(
                ElementId::Name(detail.clone()),
                div()
                    .id(ElementId::Name(detail))
                    .flex_1()
                    .min_w_0()
                    .max_h(most)
                    .overflow_y_scroll()
                    .child(self.detail),
            ))
    }
}

/// One row of the list: what it is, a line about it, washed in the accent
/// while it is the one chosen.
#[derive(IntoElement)]
pub(crate) struct ListRow {
    id: ElementId,
    selector: SharedString,
    title: SharedString,
    subtitle: Option<SharedString>,
    selected: bool,
    on_click: Option<OnClick>,
}

impl ListRow {
    /// The row at `at` of the list `id`, named `<id>-<at>` for the tests.
    pub(crate) fn new(id: &'static str, at: usize, title: impl Into<SharedString>) -> Self {
        Self {
            id: (id, at).into(),
            selector: format!("{id}-{at}").into(),
            title: title.into(),
            subtitle: None,
            selected: false,
            on_click: None,
        }
    }

    #[must_use]
    pub(crate) fn subtitle(mut self, subtitle: impl Into<SharedString>) -> Self {
        self.subtitle = Some(subtitle.into());
        self
    }

    #[must_use]
    pub(crate) fn selected(mut self, selected: bool) -> Self {
        self.selected = selected;
        self
    }

    #[must_use]
    pub(crate) fn on_click(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_click = Some(Box::new(handler));
        self
    }
}

impl RenderOnce for ListRow {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hover = theme.c.hover;
        let selector = self.selector;
        let row = div()
            .id(self.id.clone())
            .debug_selector(move || selector.to_string())
            .w_full()
            .px(px(11.0))
            .py(px(8.0))
            .rounded(theme.skin.radius_md)
            .map(|row| edged(row, Edge::All, theme.skin.line_width))
            .cursor_pointer()
            .map(|row| {
                if self.selected {
                    row.bg(theme.c.accent_soft)
                        .border_color(theme.c.accent_line)
                } else {
                    row.border_color(gpui::transparent_black())
                        .hover(move |style| style.bg(hover))
                }
            })
            .when_some(self.on_click, |row, handler| row.on_click(handler))
            .child(
                div()
                    .truncate()
                    .text_size(px(12.5))
                    .line_height(px(19.375))
                    .font_weight(if self.selected {
                        EMPHASIS
                    } else {
                        gpui::FontWeight::MEDIUM
                    })
                    .child(self.title),
            )
            .children(self.subtitle.map(|subtitle| {
                div()
                    .truncate()
                    .text_size(px(11.0))
                    .line_height(px(17.05))
                    .text_color(theme.c.muted)
                    .child(subtitle)
            }));
        Reachable::new(self.id, row)
    }
}

/// What the detail says while nothing in the list is chosen, in a dashed
/// outline as tall as the list beside it.
#[derive(IntoElement)]
pub(crate) struct Placeholder {
    says: SharedString,
}

impl Placeholder {
    pub(crate) fn new(says: impl Into<SharedString>) -> Self {
        Self { says: says.into() }
    }
}

impl RenderOnce for Placeholder {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .size_full()
            .min_h(px(PLACEHOLDER_HEIGHT))
            .flex()
            .items_center()
            .justify_center()
            .rounded(theme.skin.radius_lg)
            .border_1()
            .border_dashed()
            .border_color(theme.c.line2)
            .text_size(px(12.0))
            .text_color(theme.c.muted)
            .child(self.says)
    }
}
