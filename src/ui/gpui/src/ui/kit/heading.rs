//! The words that head a page of settings and the groups on it: a page's
//! title, a group's title, the label over a control, and the label with
//! the value beside it over a bar.
//!
//! Measured on the web UI's `controls.tsx`, where they are `PageTitle`,
//! `GroupTitle`, `Field` and `ValueHeader`. Text on a settings page stands
//! at the web UI's line height, a little over one and a half.

use gpui::{
    AnyElement, App, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
    prelude::*, px, relative,
};

use crate::theme::ActiveTheme;
use crate::ui::widgets::{EMPHASIS, label};

/// How tall a line of text on a settings page is, against its size.
pub(crate) const LINE: f32 = 1.55;

/// The title of a page of settings, a line of what it is for under it if
/// it needs one, and whatever switches the whole page beside it.
#[derive(IntoElement)]
pub(crate) struct PageTitle {
    title: SharedString,
    hint: Option<SharedString>,
    action: Option<AnyElement>,
}

impl PageTitle {
    pub(crate) fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            hint: None,
            action: None,
        }
    }

    /// One line of what the page is for.
    pub(crate) fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// What switches the page as a whole, at the title's end.
    pub(crate) fn action(mut self, action: impl IntoElement) -> Self {
        self.action = Some(action.into_any_element());
        self
    }
}

impl RenderOnce for PageTitle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .mb(px(18.0))
            .flex()
            .items_start()
            .gap(px(16.0))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .debug_selector(|| "page-title".to_owned())
                            .text_size(px(20.0))
                            .font_weight(EMPHASIS)
                            .child(label(&self.title, &theme)),
                    )
                    .children(self.hint.map(|hint| {
                        div()
                            .mt(px(4.0))
                            .text_size(px(12.0))
                            .text_color(theme.c.muted)
                            .child(hint)
                    })),
            )
            .children(self.action.map(|action| div().flex_none().child(action)))
    }
}

/// A heading between the groups of one page, with a line of what the
/// group is for under it if it needs one.
#[derive(IntoElement)]
pub(crate) struct GroupTitle {
    title: SharedString,
    hint: Option<SharedString>,
    wide: bool,
    lit: bool,
}

impl GroupTitle {
    pub(crate) fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            hint: None,
            wide: false,
            lit: false,
        }
    }

    /// Lit for a moment: where the search sent the reader.
    pub(crate) fn lit(mut self, lit: bool) -> Self {
        self.lit = lit;
        self
    }

    pub(crate) fn hint(mut self, hint: impl Into<SharedString>) -> Self {
        self.hint = Some(hint.into());
        self
    }

    /// Twice the room above it: where one chapter of a long page ends and
    /// the next begins.
    pub(crate) fn wide(mut self) -> Self {
        self.wide = true;
        self
    }
}

impl RenderOnce for GroupTitle {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let hinted = self.hint.is_some();
        div()
            .mt(px(if self.wide { 52.0 } else { 26.0 }))
            .child(super::lit::lit(
                div()
                    .mb(px(if hinted { 3.0 } else { 10.0 }))
                    .text_size(px(13.0))
                    .font_weight(EMPHASIS)
                    .child(label(&self.title, &theme)),
                self.lit,
                cx,
            ))
            .children(self.hint.map(|hint| {
                div()
                    .mb(px(12.0))
                    .text_size(px(11.5))
                    .text_color(theme.c.muted)
                    .child(hint)
            }))
    }
}

/// A control with what it sets written over it: the web UI labels above,
/// never beside.
#[derive(IntoElement)]
pub(crate) struct Field {
    label: SharedString,
    control: AnyElement,
    lit: bool,
}

impl Field {
    pub(crate) fn new(label: impl Into<SharedString>, control: impl IntoElement) -> Self {
        Self {
            label: label.into(),
            control: control.into_any_element(),
            lit: false,
        }
    }

    /// Lit for a moment: where the search sent the reader.
    pub(crate) fn lit(mut self, lit: bool) -> Self {
        self.lit = lit;
        self
    }
}

impl RenderOnce for Field {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .child(super::lit::lit(
                div()
                    .mb(px(7.0))
                    .text_size(px(12.0))
                    .font_weight(EMPHASIS)
                    .child(label(&self.label, &theme)),
                self.lit,
                cx,
            ))
            .child(self.control)
    }
}

/// What a bar or a row of choices sets, and where it stands, on one line
/// over it.
#[derive(IntoElement)]
pub(crate) struct ValueHeader {
    label: SharedString,
    value: SharedString,
}

impl ValueHeader {
    pub(crate) fn new(label: impl Into<SharedString>, value: impl Into<SharedString>) -> Self {
        Self {
            label: label.into(),
            value: value.into(),
        }
    }
}

impl RenderOnce for ValueHeader {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .mb(px(3.0))
            .flex()
            .justify_between()
            .gap(px(16.0))
            .text_size(px(11.0))
            .line_height(relative(LINE))
            .text_color(theme.c.muted)
            .child(div().min_w_0().child(self.label))
            .child(
                div()
                    .flex_none()
                    .text_color(theme.c.text)
                    .font_weight(gpui::FontWeight::MEDIUM)
                    .child(self.value),
            )
    }
}
