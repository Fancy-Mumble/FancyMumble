//! The parts the Account page is built of besides the kit's: a field in
//! its box, a field under its label (the web UI's `TextRow`), a button
//! that is off until it may be pressed, a quiet line under a control, and
//! what a change said on its row.

use gpui::{
    App, ClickEvent, Div, Entity, ParentElement, SharedString, Styled, Window, div,
    prelude::*, px,
};

use super::super::super::kit::{Banner, Button, Field, Note};
use super::super::super::text_input::TextInput;
use super::{AccountPage, refusal};
use crate::theme::Theme;
use crate::words::t;

/// `field` in the box a settings page draws a text field in, tagged
/// `selector` for the tests.
pub(in crate::ui::settings) fn boxed(field: &Entity<TextInput>, selector: &'static str, theme: &Theme) -> Div {
    div()
        .debug_selector(move || selector.to_owned())
        .flex_1()
        .min_w_0()
        .h(px(36.0))
        .px(px(13.0))
        .flex()
        .items_center()
        .rounded(theme.skin.radius_md)
        .bg(theme.c.input)
        .border_1()
        .border_color(theme.c.line2)
        .text_size(px(12.5))
        .child(field.clone())
}

/// `field` under `label`, with room below as the web UI's `TextRow`.
pub(super) fn row(
    label: SharedString,
    field: &Entity<TextInput>,
    selector: &'static str,
    theme: &Theme,
) -> Div {
    div()
        .mb(px(14.0))
        .child(Field::new(label, boxed(field, selector, theme)))
}

/// `button`, worked by `act` while `on`; while not, drawn and left as the
/// web UI's disabled button.
pub(super) fn gated(
    button: Button,
    on: bool,
    act: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Div {
    div()
        .flex_none()
        .child(if on { button.on_click(act) } else { button.disabled(true) })
}

/// A line of what a control is for, in the muted ink, at the web UI's
/// small size.
pub(super) fn note(words: impl Into<SharedString>, theme: &Theme) -> Div {
    div()
        .text_size(px(11.5))
        .text_color(theme.c.muted)
        .child(words.into())
}

/// What the change named `id` came to, on its row: why it was refused, or
/// that it was saved; nothing while neither.
pub(super) fn said(page: &AccountPage, id: u32) -> Option<Banner> {
    match &page.refused {
        Some((refused, code)) if *refused == id => Some(Banner::new(Note::Danger).child(refusal(code))),
        _ => (page.done == Some(id)).then(|| Banner::new(Note::Ok).child(t!("Saved."))),
    }
}
