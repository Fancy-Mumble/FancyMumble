//! The Identities page: the certificates this client holds, one card
//! each, to export or delete (asked again in place before it goes), and
//! the way to bring one in from a file.
//!
//! Under them, as in the web UI, a new identity made by name, and the
//! recovery phrase (`recovery.rs`).

use gpui::{Context, Div, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::Shell;
use super::super::kit::{Button, Card, Emphasis, Empty, PageTitle, Size, Tone};
use super::super::widgets::EMPHASIS;
use crate::theme::Theme;
use crate::words::t;

impl Shell {
    /// The certificate the server on show was connected with, if any.
    fn connected_certificate(&self) -> Option<SharedString> {
        let active = self.active_session.as_ref()?;
        self.servers
            .iter()
            .find(|server| server.id == *active)?
            .certificate
            .clone()
    }

    /// Ask before deleting `label`, or stop asking.
    fn arm_delete(&mut self, label: Option<SharedString>, cx: &mut Context<Self>) {
        self.panels.certs.doomed = label;
        cx.notify();
    }
}

/// The page.
pub(super) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let held = &shell.panels.certs.held;
    let connected = shell.connected_certificate();
    let list = if held.is_empty() {
        div().child(Empty::new(t!("No identities yet. Import one below.")))
    } else {
        div().flex().flex_col().gap(px(8.0)).children(
            held.iter()
                .enumerate()
                .map(|(at, label)| card(shell, at, label, connected.as_ref(), theme, cx)),
        )
    };
    div()
        .child(PageTitle::new(t!("Identities")).hint(t!(
            "Identities are TLS client certificates used to authenticate with Mumble servers. Each identity is unique to you and persists across sessions."
        )))
        .child(list)
        .children(super::recovery::create(shell, theme, cx))
        .child(
            div().mt(px(14.0)).flex().child(
                Button::new("identity-import", t!("Import identity..."))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.import_certificate(cx))),
            ),
        )
        .children(super::recovery::render(shell, theme, cx))
}

/// One identity: its name, whether it is the one in use, and what can be
/// done with it.
fn card(
    shell: &Shell,
    at: usize,
    label: &SharedString,
    connected: Option<&SharedString>,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> impl IntoElement + use<> {
    let in_use = connected == Some(label);
    let doomed = shell.panels.certs.doomed.as_ref() == Some(label);
    let named = div()
        .flex_1()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(8.0))
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child(label.clone()),
        )
        .when(in_use, |named| {
            named.child(
                div()
                    .flex_none()
                    .px(px(7.0))
                    .py(px(2.0))
                    .rounded(theme.skin.radius_pill)
                    .bg(theme.c.accent_soft)
                    .text_size(px(10.0))
                    .font_weight(EMPHASIS)
                    .text_color(theme.c.accent)
                    .child(t!("connected")),
            )
        });
    let (first, second) = (label.clone(), label.clone());
    let actions = if doomed {
        div()
            .flex()
            .gap(px(6.0))
            .child(
                Button::new("identity-confirm", t!("Confirm"))
                    .selector(format!("identity-confirm-{at}"))
                    .emphasis(Emphasis::Contained)
                    .tone(Tone::Danger)
                    .size(Size::Compact)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.delete_certificate(&first, cx);
                    })),
            )
            .child(
                Button::new("identity-cancel", t!("Cancel"))
                    .selector(format!("identity-cancel-{at}"))
                    .size(Size::Compact)
                    .on_click(cx.listener(|shell, _, _, cx| shell.arm_delete(None, cx))),
            )
    } else {
        div()
            .flex()
            .gap(px(6.0))
            .child(
                Button::new("identity-export", t!("Export"))
                    .selector(format!("identity-export-{at}"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.export_certificate(&first, cx);
                    })),
            )
            .child(
                Button::new("identity-delete", t!("Delete"))
                    .selector(format!("identity-delete-{at}"))
                    .size(Size::Compact)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.arm_delete(Some(second.clone()), cx);
                    })),
            )
    };
    // Under an id of its own, so that the buttons of one card are not
    // taken for those of another.
    div().id(("identity", at)).child(
        Card::new()
            .lit(in_use)
            .flex()
            .items_center()
            .gap(px(12.0))
            .child(named)
            .child(div().flex_none().child(actions)),
    )
}
