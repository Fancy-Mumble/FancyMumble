//! The second factor on the Account page: turned on with a code from an
//! authenticator once its secret is scanned, and off with another.
//!
//! The QR code is the whole way in for most; the setup link is for a phone
//! that cannot see this screen, and the key by hand for an app that takes
//! neither: each shown only on asking, behind the one before, as in the
//! web UI.

use gpui::{Context, Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::super::Shell;
use super::super::super::kit::{Button, Card, Emphasis, Field, Size, Tone};
use super::fields::{boxed, gated, note, said};
use super::{AccountPage, Enrolment, Fallback, ids, qr};
use crate::engine::{AccountAction, AccountSettings};
use crate::theme::Theme;
use crate::words::t;

/// The section.
pub(super) fn render(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let blocked = page.busy() || page.unproved(cx);
    let heading = super::super::heading(
        &shell.panels.settings.lit,
        t!("Two-factor authentication (2FA)"),
    );
    let body = if account.totp_enabled {
        turning_off(page, blocked, theme, cx)
    } else if let Some(enrolment) = &page.enrolment {
        enrolling(page, enrolment, blocked, theme, cx)
    } else {
        div()
            .child(note(t!(
                "Protect your account with time-based one-time passwords (TOTP). Works with Google Authenticator, Microsoft Authenticator, Authy, Aegis, 1Password and other authenticator apps."
            ), theme).mb(px(10.0)))
            .child(div().flex().child(gated(
                Button::new("account-totp-begin", t!("Set up 2FA"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact),
                !blocked,
                cx.listener(|shell, _, _, cx| shell.ask_account(AccountAction::TotpBegin, cx)),
            )))
            .children(said(page, ids::TOTP_BEGIN))
    };
    div().child(heading).child(body)
}

/// The second factor is on: a current code turns it off.
fn turning_off(page: &AccountPage, blocked: bool, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let code = AccountPage::code(&page.fields.off_code, cx);
    let whole = code.len() == 6;
    div()
        .child(note(t!(
            "2FA is enabled. On every sign-in you will be asked for a code from your authenticator app. To disable it, enter a current code."
        ), theme).mb(px(10.0)))
        .child(div().mb(px(12.0)).child(Field::new(
            t!("6-digit code"),
            div().flex().child(boxed(&page.fields.off_code, "account-totp-off-code", theme)),
        )))
        .child(div().mt(px(8.0)).flex().child(gated(
            Button::new("account-totp-disable", t!("Disable 2FA"))
                .emphasis(Emphasis::Contained)
                .tone(Tone::Danger)
                .size(Size::Compact),
            !blocked && whole,
            cx.listener(move |shell, _, _, cx| {
                shell.ask_account(AccountAction::TotpDisable(code.clone()), cx);
            }),
        )))
        .children(said(page, ids::TOTP_DISABLE))
}

/// Enrolling: the code to scan (or, from a server that sends no link, the
/// key), the field for the authenticator's code, and the ways in for
/// those who cannot scan.
fn enrolling(
    page: &AccountPage,
    enrolment: &Enrolment,
    blocked: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let code = AccountPage::code(&page.fields.code, cx);
    let whole = code.len() == 6;
    let scannable = !enrolment.uri.is_empty();
    let shown = match &enrolment.code {
        Some(picture) => div().mb(px(16.0)).flex().justify_center().child(
            div()
                .debug_selector(|| "account-totp-qr".to_owned())
                .p(px(10.0))
                .bg(gpui::white())
                .rounded(theme.skin.radius_lg)
                .child(
                    picture
                        .element()
                        .size(px(qr::SIDE))
                        .rounded(px(6.0)),
                ),
        ),
        None => copy_field(
            page,
            t!("Secret key (base32)"),
            None,
            enrolment.secret.clone(),
            "account-totp-secret",
            theme,
            cx,
        ),
    };
    let verify = gated(
        Button::new("account-totp-verify", t!("Confirm & enable"))
            .emphasis(Emphasis::Contained)
            .size(Size::Compact),
        !blocked && whole,
        cx.listener(move |shell, _, _, cx| {
            shell.ask_account(AccountAction::TotpVerify(code.clone()), cx);
        }),
    );
    let card = Card::new()
        .child(shown)
        .child(Field::new(
            t!("6-digit code"),
            div()
                .flex()
                .items_center()
                .gap(px(6.0))
                .child(boxed(&page.fields.code, "account-totp-code", theme))
                .child(verify),
        ))
        .children(said(page, ids::TOTP_VERIFY))
        .when(scannable, |card| card.child(fallbacks(page, enrolment, theme, cx)));
    div()
        .child(note(if scannable {
            t!("Scan the code with your authenticator app (Google Authenticator, Microsoft Authenticator, Authy, Aegis, 1Password, …), then confirm with the 6-digit code it shows. The code is only shown once.")
        } else {
            t!("In your authenticator app choose \"Enter key manually\" and select time-based (TOTP).")
        }, theme).mb(px(12.0)))
        .child(card)
}

/// Under the code to scan: the setup link, and under that the key, each
/// on asking.
fn fallbacks(page: &AccountPage, enrolment: &Enrolment, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let line = theme.c.line;
    let around = div()
        .mt(px(14.0))
        .pt(px(12.0))
        .border_t(theme.skin.line_width)
        .border_color(line);
    match page.fallback {
        Fallback::Code => around.child(disclosure(
            "account-totp-cant-scan",
            t!("Can't scan the code?"),
            Fallback::Link,
            theme,
            cx,
        )),
        later => around
            .child(note(t!(
                "Copy the setup link and open it on the device your authenticator app runs on - most apps register the account straight from the link."
            ), theme).mb(px(10.0)))
            .child(copy_field(
                page,
                t!("Setup link (otpauth://)"),
                None,
                enrolment.uri.clone(),
                "account-totp-uri",
                theme,
                cx,
            ))
            .child(if later == Fallback::Link {
                disclosure(
                    "account-totp-reveal",
                    t!("Link doesn't work either? Enter the key by hand"),
                    Fallback::Secret,
                    theme,
                    cx,
                )
            } else {
                copy_field(
                    page,
                    t!("Secret key (base32)"),
                    Some(t!("In your authenticator app choose \"Enter key manually\" and select time-based (TOTP).")),
                    enrolment.secret.clone(),
                    "account-totp-secret",
                    theme,
                    cx,
                )
            }),
    }
}

/// A quiet underlined link that shows the next way in.
fn disclosure(
    id: &'static str,
    words: SharedString,
    to: Fallback,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let link = div()
        .id(id)
        .debug_selector(move || id.to_owned())
        .text_size(px(11.5))
        .font_weight(gpui::FontWeight::MEDIUM)
        .text_color(theme.c.muted)
        .underline()
        .cursor_pointer()
        .on_click(cx.listener(move |shell, _, _, cx| {
            if let Some(page) = &mut shell.panels.settings.account {
                page.fallback = to;
            }
            cx.notify();
        }))
        .child(words);
    div().flex().child(super::super::super::kit::Reachable::new(id, link))
}

/// A value that is there to be copied into an authenticator: shown as
/// text that can be selected, with a button that copies it.
fn copy_field(
    page: &AccountPage,
    label: SharedString,
    hint: Option<SharedString>,
    value: SharedString,
    selector: &'static str,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let copied = value.clone();
    let said = if page.copied == Some(selector) {
        t!("Copied!")
    } else {
        t!("Copy")
    };
    let shown = div()
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
        .child(div().truncate().child(value));
    let field = div()
        .id(selector)
        .mb(px(12.0))
        .child(Field::new(
            label,
            div().flex().items_center().gap(px(6.0)).child(shown).child(
                Button::new("account-copy", said)
                    .selector(format!("{selector}-copy"))
                    .emphasis(Emphasis::Outlined)
                    .size(Size::Compact)
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        cx.write_to_clipboard(gpui::ClipboardItem::new_string(copied.to_string()));
                        shell.copied(selector, cx);
                    })),
            ),
        ))
        .children(hint.map(|hint| {
            div()
                .mt(px(6.0))
                .text_size(px(11.0))
                .text_color(theme.c.muted)
                .child(hint)
        }));
    div().child(field)
}

impl Shell {
    /// Say on its button that the value tagged `selector` was copied, for a
    /// moment and a half.
    fn copied(&mut self, selector: &'static str, cx: &mut Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.copied = Some(selector);
        }
        cx.notify();
        cx.spawn(async move |shell, cx| {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(1500))
                .await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(page) = &mut shell.panels.settings.account
                    && page.copied == Some(selector)
                {
                    page.copied = None;
                    cx.notify();
                }
            });
        })
        .detach();
    }
}
