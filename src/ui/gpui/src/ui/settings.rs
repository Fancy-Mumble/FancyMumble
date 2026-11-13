//! The view's own settings: what it tells others about the user, and what
//! it asks of servers on the user's behalf.

use gpui::{Context, IntoElement, ParentElement, Styled, div, px};

use super::Shell;
use super::kit::{Button, Dialog, SwitchRow};
use super::widgets::EMPHASIS;
use crate::store::Privacy;
use crate::theme::Theme;

/// The settings, and whether their dialog is showing.
#[derive(Default)]
pub(super) struct Settings {
    pub open: bool,
    pub privacy: Privacy,
}

/// One of the things that can be kept to oneself.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Kept {
    Writing,
    Reading,
    Links,
}

impl Shell {
    /// Keep something to oneself, or stop.
    fn toggle_kept(&mut self, what: Kept, cx: &mut Context<Self>) {
        let privacy = &mut self.panels.settings.privacy;
        match what {
            Kept::Writing => privacy.hide_writing = !privacy.hide_writing,
            Kept::Reading => privacy.hide_reading = !privacy.hide_reading,
            Kept::Links => privacy.leave_links = !privacy.leave_links,
        }
        self.remember_settings(cx);
        cx.notify();
    }
}

/// The dialog, over a veil.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> impl IntoElement {
    let privacy = &shell.panels.settings.privacy;
    let row = |id, label: &'static str, on: bool, what: Kept| {
        SwitchRow::new(id, label, on)
            .on_click(cx.listener(move |shell, _, _, cx| shell.toggle_kept(what, cx)))
    };
    Dialog::new("settings")
        .title("Settings")
        .w(px(440.0))
        .gap(px(10.0))
        .p(px(22.0))
        .child(
            div()
                .pt(px(4.0))
                .text_size(px(11.0))
                .font_weight(EMPHASIS)
                .text_color(theme.c.muted)
                .child("PRIVACY"),
        )
        .child(row(
            "tell-writing",
            "Tell others when I am writing",
            !privacy.hide_writing,
            Kept::Writing,
        ))
        .child(row(
            "tell-reading",
            "Tell others what I have read",
            !privacy.hide_reading,
            Kept::Reading,
        ))
        .child(row(
            "look-behind-links",
            "Ask the server what lies behind a link",
            !privacy.leave_links,
            Kept::Links,
        ))
        .child(div().pt(px(6.0)).flex().justify_end().child(
            Button::new("settings-close", "Close").on_click(cx.listener(|shell, _, _, cx| {
                shell.panels.settings.open = false;
                cx.notify();
            })),
        ))
}
