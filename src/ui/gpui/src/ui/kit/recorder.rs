//! A key, chosen by pressing it: the web UI's `ShortcutRecorder`.
//!
//! It only shows. Whoever owns the key is told when recording should
//! start and when the key should be cleared, and catches the next key
//! itself: a key pressed while recording belongs to the binding, not to
//! the window.

use std::rc::Rc;

use gpui::{
    App, ClickEvent, IntoElement, ParentElement, RenderOnce, SharedString, Styled, Window, div,
    prelude::*, px,
};

use super::button::IconButton;
use super::focus::{Ring, TabStop};
use crate::theme::ActiveTheme;

type OnClick = Rc<dyn Fn(&ClickEvent, &mut Window, &mut App) + 'static>;

/// What a key is for, the key or that there is none, and the way to clear
/// it.
///
/// ```ignore
/// Recorder::new("push-to-talk-key", "Push to talk", key, recording, "Not set")
///     .on_record(...).on_clear(...)
/// ```
#[derive(IntoElement)]
pub(crate) struct Recorder {
    id: &'static str,
    label: SharedString,
    key: Option<SharedString>,
    recording: bool,
    placeholder: SharedString,
    asking: SharedString,
    clear_tip: SharedString,
    on_record: Option<OnClick>,
    on_clear: Option<OnClick>,
}

impl Recorder {
    /// `id` names the key's button for the tests; its clear button is
    /// `<id>-clear`. `placeholder` is said where there is no key, `asking`
    /// while one is awaited.
    pub(crate) fn new(
        id: &'static str,
        label: impl Into<SharedString>,
        key: Option<SharedString>,
        recording: bool,
    ) -> Self {
        Self {
            id,
            label: label.into(),
            key,
            recording,
            placeholder: SharedString::default(),
            asking: SharedString::default(),
            clear_tip: SharedString::default(),
            on_record: None,
            on_clear: None,
        }
    }

    /// What the button says where there is no key, and while one is
    /// awaited; and what the clear button is called.
    pub(crate) fn words(
        mut self,
        placeholder: impl Into<SharedString>,
        asking: impl Into<SharedString>,
        clear_tip: impl Into<SharedString>,
    ) -> Self {
        self.placeholder = placeholder.into();
        self.asking = asking.into();
        self.clear_tip = clear_tip.into();
        self
    }

    pub(crate) fn on_record(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_record = Some(Rc::new(handler));
        self
    }

    pub(crate) fn on_clear(
        mut self,
        handler: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_clear = Some(Rc::new(handler));
        self
    }
}

impl RenderOnce for Recorder {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let id = self.id;
        let hover = theme.c.hover;
        let (says, set) = match (&self.key, self.recording) {
            (_, true) => (self.asking.clone(), true),
            (Some(key), false) => (key.clone(), true),
            (None, false) => (self.placeholder.clone(), false),
        };
        let key = div()
            .id(id)
            .debug_selector(move || id.to_owned())
            .flex_none()
            .w(px(168.0))
            .px(px(11.0))
            .py(px(6.0))
            .flex()
            .justify_center()
            .rounded(theme.skin.radius_md)
            .text_size(px(11.5))
            .cursor_pointer()
            .border_1()
            .map(|key| {
                if self.recording {
                    key.bg(theme.c.accent_soft)
                        .border_color(theme.c.accent_line)
                        .text_color(theme.c.text)
                } else {
                    key.bg(theme.c.card)
                        .border_color(theme.c.line2)
                        .text_color(if set { theme.c.text } else { theme.c.dim })
                        .hover(move |style| style.bg(hover))
                }
            })
            .when(set && !self.recording, |key| {
                key.font_family(theme.skin.mono.clone())
            })
            .when_some(self.on_record, |key, handler| {
                key.on_click(move |event, window, cx| handler(event, window, cx))
            })
            .child(says);
        let ring = Ring {
            corner: theme.skin.radius_md,
            ink: theme.c.accent,
        };
        let key = TabStop::new(id, window, cx).wrap(key, ring, window);
        // Kept in its place while there is nothing to clear, so the rows do
        // not shift as a key comes and goes.
        let has_key = self.key.is_some();
        let clear = IconButton::new(id, "x")
            .selector(format!("{id}-clear"))
            .size(23.0)
            .glyph_size(13.0)
            .tip(self.clear_tip)
            .when_some(self.on_clear.filter(|_| has_key), |clear, handler| {
                clear.on_click(move |event, window, cx| handler(event, window, cx))
            });
        div()
            .py(px(5.0))
            .flex()
            .items_center()
            .gap(px(10.0))
            .child(
                div()
                    .flex_1()
                    .min_w_0()
                    .truncate()
                    .text_size(px(12.5))
                    .child(self.label),
            )
            .child(key)
            .child(
                div()
                    .flex_none()
                    .when(!has_key, gpui::Styled::invisible)
                    .child(clear),
            )
    }
}
