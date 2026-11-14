//! The Account page as it is drawn: the overview, the password that
//! proves a change, the password one signs in with, the name, the contact
//! address, then the second factor (`totp.rs`), the devices
//! (`devices.rs`), and deleting the registration.

use gpui::{Context, Div, ParentElement, SharedString, Styled, div, prelude::*, px};

use super::super::super::Shell;
use super::super::super::kit::{
    Banner, Button, Card, Emphasis, Note, PageTitle, Size, Tone, rule,
};
use super::super::super::widgets::EMPHASIS;
use super::fields::{boxed, gated, note, row, said};
use super::{AccountPage, MIN_PASSWORD, ids};
use crate::engine::{AccountAction, AccountSettings};
use crate::theme::Theme;
use crate::words::t;

/// The page.
pub(in crate::ui::settings) fn render(shell: &Shell, theme: &Theme, cx: &mut Context<Shell>) -> Div {
    let title = PageTitle::new(t!("Account"));
    let Some(page) = &shell.panels.settings.account else {
        return div().child(title);
    };
    let Some(account) = &page.snapshot else {
        return loading(page, title, cx);
    };
    if !account.registered {
        return div().child(title).child(
            Banner::new(Note::Info).title(t!("No registered account")).child(t!(
                "This session is no longer linked to a registered account. Reconnect to complete the change."
            )),
        );
    }
    div()
        .child(title)
        .child(overview(account, theme))
        .children(proof(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(password(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(rename(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(email(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(super::totp::render(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(super::devices::render(shell, page, account, theme, cx))
        .child(rule(cx))
        .child(unregister(shell, page, account, theme, cx))
        .child(div().h(px(20.0)))
}

/// The page while the account has not been read: waiting, or the server
/// did not answer, with the way to ask again.
fn loading(page: &AccountPage, title: PageTitle, cx: &mut Context<Shell>) -> Div {
    match &page.unread {
        None => div().child(title.hint(t!("Loading account information…"))),
        Some(code) => div().child(title).child(
            Banner::new(Note::Warn).title(super::refusal(code)).child(
                div().mt(px(6.0)).flex().child(
                    Button::new("account-retry", t!("Retry"))
                        .emphasis(Emphasis::Outlined)
                        .size(Size::Compact)
                        .on_click(cx.listener(|shell, _, _, cx| shell.open_account(cx))),
                ),
            ),
        ),
    }
}

/// Who the account is, how it signs in, and whether it has a second
/// factor.
fn overview(account: &AccountSettings, theme: &Theme) -> Div {
    let signs_in = if account.has_password {
        t!("Sign-in: password")
    } else {
        t!("Sign-in: certificate")
    };
    let factor = if account.totp_enabled {
        t!("Two-factor authentication: on")
    } else {
        t!("Two-factor authentication: off")
    };
    let line = |words: SharedString| {
        div()
            .text_size(px(11.5))
            .text_color(theme.c.muted)
            .child(words)
    };
    let card = Card::new()
        .child(
            div()
                .mb(px(5.0))
                .text_size(px(12.5))
                .font_weight(EMPHASIS)
                .child(t!("Overview")),
        )
        .child(line(t!(
            "Registered as {{name}} (user ID {{id}})",
            name = account.name.clone().unwrap_or_default(),
            id = account.user_id.unwrap_or(0)
        )))
        .child(line(SharedString::from(format!("{signs_in} · {factor}"))));
    div()
        .debug_selector(|| "account-overview".to_owned())
        .child(card)
}

/// The account's password, typed again to prove each change: only where
/// it has one.
fn proof(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Option<Div> {
    account.has_password.then(|| {
        div()
            .child(rule(cx))
            .child(super::super::heading(&shell.panels.settings.lit, t!("Current password")).hint(t!(
                "Required for every change below. An already-connected session is exactly what a stolen one is too, so proving the password again is what keeps a hijacked session from taking the account."
            )))
            .child(div().mt(px(12.0)).child(row(
                t!("Current password"),
                &page.fields.current,
                "account-current",
                theme,
            )))
            .when(page.unproved(cx), |group| {
                group.child(note(
                    t!("Enter your current password to change anything here."),
                    theme,
                ))
            })
    })
}

/// A warning in the warn ink, under a field.
fn warning(words: SharedString, theme: &Theme) -> Div {
    div().text_size(px(11.5)).text_color(theme.c.warn).child(words)
}

/// The password one signs in with: set, changed, or taken away again.
fn password(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let typed = AccountPage::typed(&page.fields.password, cx);
    let repeated = AccountPage::typed(&page.fields.repeat, cx);
    let length = typed.chars().count();
    let valid = length >= MIN_PASSWORD && typed == repeated;
    let blocked = page.busy() || page.unproved(cx);
    let has = account.has_password;
    div()
        .child(super::super::heading(&shell.panels.settings.lit, t!("Password sign-in")).hint(if has {
            t!("Password sign-in is enabled. You must enter your password every time you connect under this name.")
        } else {
            t!("You currently sign in with this device's certificate only. Setting a password lets you sign in from any device.")
        }))
        .when(!has, |group| {
            group.child(Banner::new(Note::Warn).title(t!("A password replaces certificate-only sign-in")).child(t!(
                "As soon as a password is set, connecting with the certificate alone stops working - the password is then required on every connect. Store it safely."
            )))
        })
        .child(
            div()
                .mt(px(12.0))
                .child(row(t!("New password"), &page.fields.password, "account-password", theme))
                .child(row(t!("Repeat password"), &page.fields.repeat, "account-repeat", theme)),
        )
        .when(length > 0 && length < MIN_PASSWORD, |group| {
            group.child(warning(
                t!("The password must be at least {{min}} characters long.", min = MIN_PASSWORD),
                theme,
            ))
        })
        .when(!repeated.is_empty() && typed != repeated, |group| {
            group.child(warning(t!("The passwords do not match."), theme))
        })
        .child(div().mt(px(8.0)).flex().child(gated(
            Button::new(
                "account-password-save",
                if has { t!("Change password") } else { t!("Enable password sign-in") },
            )
            .emphasis(Emphasis::Contained)
            .size(Size::Compact),
            !blocked && valid,
            cx.listener(move |shell, _, _, cx| {
                shell.ask_account(AccountAction::SetPassword(typed.clone()), cx);
            }),
        )))
        .children(said(page, ids::SET_PASSWORD))
        .when(has, |group| group.child(clear_password(page, account, blocked, theme, cx)))
}

/// The way back to signing in by certificate alone: only from the device
/// whose certificate the account has, or it could lock its owner out.
fn clear_password(
    page: &AccountPage,
    account: &AccountSettings,
    blocked: bool,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    div()
        .mt(px(14.0))
        .child(
            note(
                if account.cert_matches_session {
                    t!("Removes the password; you will sign in with this device's certificate again.")
                } else {
                    t!("Switching back is only possible from the device whose certificate is linked to this account (otherwise you could be locked out).")
                },
                theme,
            )
            .mb(px(7.0)),
        )
        .child(div().flex().child(gated(
            Button::new("account-password-clear", t!("Switch back to certificate sign-in"))
                .emphasis(Emphasis::Outlined)
                .size(Size::Compact),
            !blocked && account.cert_matches_session,
            cx.listener(|shell, _, _, cx| shell.ask_account(AccountAction::ClearPassword, cx)),
        )))
        .children(said(page, ids::CLEAR_PASSWORD))
}

/// A field and the button that sends it, on one line.
fn inline(field: Div, button: Div) -> Div {
    div().flex().items_center().gap(px(6.0)).child(field).child(button)
}

/// Taking another name.
fn rename(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let typed = AccountPage::typed(&page.fields.name, cx).trim().to_owned();
    let changed = !typed.is_empty() && Some(&typed) != account.name.as_ref();
    let on = !(page.busy() || page.unproved(cx)) && changed;
    div()
        .child(super::super::heading(&shell.panels.settings.lit, t!("Rename account")).hint(t!(
            "Changes your registered user name on this server. Your display name updates immediately for everyone."
        )))
        .child(inline(
            boxed(&page.fields.name, "account-name", theme),
            gated(
                Button::new("account-rename", t!("Rename"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact),
                on,
                cx.listener(move |shell, _, _, cx| {
                    shell.ask_account(AccountAction::Rename(typed.clone()), cx);
                }),
            ),
        ))
        .children(said(page, ids::RENAME))
}

/// The contact address the server keeps.
fn email(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let typed = AccountPage::typed(&page.fields.email, cx);
    let changed = typed != account.email.clone().unwrap_or_default();
    let on = !(page.busy() || page.unproved(cx)) && changed;
    div()
        .child(super::super::heading(&shell.panels.settings.lit, t!("Contact email")).hint(t!(
            "Stored on the server as the account's contact address. Leave empty to remove it."
        )))
        .child(Banner::new(Note::Warn).title(t!("Handle with care")).child(t!(
            "The email doubles as an account-recovery factor: when you connect with a renewed, CA-verified certificate carrying this address, the server links it to your account. Only enter an address you own - a wrong address could let someone else claim your account."
        )))
        .child(div().mt(px(12.0)).child(inline(
            boxed(&page.fields.email, "account-email", theme),
            gated(
                Button::new("account-email-save", t!("Save email"))
                    .emphasis(Emphasis::Contained)
                    .size(Size::Compact),
                on,
                cx.listener(|shell, _, _, cx| shell.save_email(cx)),
            ),
        )))
        .children(said(page, ids::SET_EMAIL))
}

/// Deleting the registration: asked about first, and confirmed by typing
/// the account's name.
fn unregister(
    shell: &Shell,
    page: &AccountPage,
    account: &AccountSettings,
    theme: &Theme,
    cx: &mut Context<Shell>,
) -> Div {
    let name = account.name.clone().unwrap_or_default();
    let confirmed = AccountPage::typed(&page.fields.doom, cx) == name;
    let blocked = page.busy() || page.unproved(cx);
    let asking = if page.dooming {
        Card::new()
            .mt(px(12.0))
            .child(div().mb(px(9.0)).text_size(px(12.0)).child(t!(
                "Type your account name ({{name}}) to confirm:",
                name = name.clone()
            )))
            .child(div().flex().child(boxed(&page.fields.doom, "account-doom", theme)))
            .child(
                div()
                    .mt(px(10.0))
                    .flex()
                    .justify_end()
                    .gap(px(6.0))
                    .child(
                        Button::new("account-doom-cancel", t!("Cancel"))
                            .size(Size::Compact)
                            .on_click(cx.listener(|shell, _, _, cx| shell.stop_dooming(cx))),
                    )
                    .child(gated(
                        Button::new("account-doom-confirm", t!("Permanently delete registration"))
                            .emphasis(Emphasis::Contained)
                            .tone(Tone::Danger)
                            .size(Size::Compact),
                        !blocked && confirmed,
                        cx.listener(|shell, _, _, cx| shell.ask_account(AccountAction::Unregister, cx)),
                    )),
            )
            .into_any_element()
    } else {
        div()
            .mt(px(12.0))
            .flex()
            .child(gated(
                Button::new("account-doom", t!("Delete my registration…"))
                    .emphasis(Emphasis::Outlined)
                    .tone(Tone::Danger)
                    .size(Size::Compact),
                !page.busy(),
                cx.listener(|shell, _, _, cx| shell.start_dooming(cx)),
            ))
            .into_any_element()
    };
    div()
        .child(super::super::heading(&shell.panels.settings.lit, t!("Delete registration")))
        .child(Banner::new(Note::Danger).title(t!("This cannot be undone")).child(t!(
            "Deleting your registration removes your account from this server: your user ID, access permissions granted to your account, channel role assignments and your stored settings are lost. Content you posted stays. You remain connected as an unregistered guest until you reconnect."
        )))
        .child(asking)
        .children(said(page, ids::UNREGISTER))
}

impl Shell {
    /// Ask before deleting the registration.
    fn start_dooming(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.dooming = true;
        }
        cx.notify();
    }

    /// Stop asking, and forget what was typed.
    fn stop_dooming(&mut self, cx: &mut gpui::Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.dooming = false;
            let doom = page.fields.doom.clone();
            super::clear(&doom, cx);
        }
        cx.notify();
    }
}
