//! The Account page, as the web UI's (`AccountSettings`, `AccountDevices`):
//! the user's own registration on the server on show, changed by asking
//! the server. The password one signs in with, the name, the contact
//! address, a second factor, the devices the account is used from, and
//! deleting the registration.
//!
//! Nothing here is kept on this computer: every control is a round trip,
//! and each says how its own last change went, on its own row, as the web
//! UI's `feedbackFor` does. A change the server does not answer within
//! eight seconds is said to have gone unanswered.
//!
//! The page is in the column only for a registered user on a server that
//! answers about accounts, as the web UI's `accountSupported`.

mod devices;
pub(super) mod fields;
mod page;
mod qr;
mod totp;

use std::time::Duration;

use gpui::{AppContext, Context, Entity, SharedString};

pub(super) use page::render;

use super::super::Shell;
use super::super::text_input::TextInput;
use crate::engine::{AccountAck, AccountAction, AccountNews, AccountSettings, DeviceLink};
use crate::words::t;

/// The numbers the server names each change by in its answer
/// ([`AccountAction::id`]).
pub(in crate::ui) mod ids {
    pub(in crate::ui) const SET_PASSWORD: u32 = 1;
    pub(in crate::ui) const CLEAR_PASSWORD: u32 = 2;
    pub(in crate::ui) const RENAME: u32 = 3;
    pub(in crate::ui) const SET_EMAIL: u32 = 4;
    pub(in crate::ui) const UNREGISTER: u32 = 5;
    pub(in crate::ui) const TOTP_BEGIN: u32 = 6;
    pub(in crate::ui) const TOTP_VERIFY: u32 = 7;
    pub(in crate::ui) const TOTP_DISABLE: u32 = 8;
    pub(in crate::ui) const RENAME_DEVICE: u32 = 9;
    pub(in crate::ui) const REMOVE_DEVICE: u32 = 10;
}

/// How long an answer is waited for before the page says none came.
const ANSWER_WITHIN: Duration = Duration::from_secs(8);

/// The shortest password the page lets one set.
pub(super) const MIN_PASSWORD: usize = 8;

/// The longest device name the server keeps.
const MAX_DEVICE_NAME: usize = 64;

/// How long an offer to a new device is shown: the server honours one for
/// ten minutes, and the page gives up just before.
const OFFER_LASTS: Duration = Duration::from_secs(570);

/// How far down the ways of enrolling the second factor the user has
/// asked to go: the code to scan, then the link, then the key by hand.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(super) enum Fallback {
    #[default]
    Code,
    Link,
    Secret,
}

/// A second factor being enrolled: what the server made for it.
pub(super) struct Enrolment {
    pub secret: SharedString,
    pub uri: SharedString,
    /// The QR code of `uri`, drawn once.
    pub code: Option<crate::ui::kit::Picture>,
}

/// The offer of the account to a new device, while it is shown.
pub(super) struct Offer {
    pub link: DeviceLink,
    pub code: Option<crate::ui::kit::Picture>,
}

/// The fields the page is typed into.
pub(super) struct Fields {
    /// The account's password, proving a change.
    pub current: Entity<TextInput>,
    pub password: Entity<TextInput>,
    pub repeat: Entity<TextInput>,
    pub name: Entity<TextInput>,
    pub email: Entity<TextInput>,
    /// The code that finishes enrolling the second factor.
    pub code: Entity<TextInput>,
    /// The code that turns it off.
    pub off_code: Entity<TextInput>,
    /// The account's name, typed to delete the registration.
    pub doom: Entity<TextInput>,
    /// A device's new name.
    pub device: Entity<TextInput>,
}

/// What the page holds while it is open.
pub(in crate::ui) struct AccountPage {
    pub(super) fields: Fields,
    /// The account as the server last said.
    pub(super) snapshot: Option<AccountSettings>,
    /// Why the account could not be read, when it could not.
    pub(super) unread: Option<SharedString>,
    /// The change waiting for its answer, by the number the server names
    /// it by.
    pub(super) pending: Option<u32>,
    /// The change that was refused last, and the server's code for why.
    pub(super) refused: Option<(u32, String)>,
    /// The change that was done last.
    pub(super) done: Option<u32>,
    pub(super) enrolment: Option<Enrolment>,
    pub(super) fallback: Fallback,
    /// The value copied a moment ago, by its selector.
    pub(super) copied: Option<&'static str>,
    /// Whether deleting the registration is being confirmed.
    pub(super) dooming: bool,
    /// The device being renamed, or asked about signing out, by its id.
    pub(super) renaming: Option<String>,
    pub(super) signing_out: Option<String>,
    pub(super) offer: Option<Offer>,
    pub(super) offering: bool,
    pub(super) offer_failed: Option<SharedString>,
    pub(super) offer_expired: bool,
    /// Bumped with each change sent, so that the wait for an older one
    /// does not time out a newer one.
    serial: u64,
}

impl AccountPage {
    fn new(cx: &mut Context<Shell>) -> Self {
        let field = |cx: &mut Context<Shell>, hint: SharedString, obscured: bool| {
            cx.new(|cx| {
                let field = TextInput::new(hint, cx);
                if obscured { field.obscured() } else { field }
            })
        };
        let fields = Fields {
            current: field(cx, SharedString::default(), true),
            password: field(
                cx,
                t!("At least {{min}} characters", min = MIN_PASSWORD),
                true,
            ),
            repeat: field(cx, SharedString::default(), true),
            name: field(cx, SharedString::default(), false),
            email: field(cx, t!("you@example.com"), false),
            code: field(cx, "123456".into(), false),
            off_code: field(cx, "123456".into(), false),
            doom: field(cx, SharedString::default(), false),
            device: field(cx, SharedString::default(), false),
        };
        Self {
            fields,
            snapshot: None,
            unread: None,
            pending: None,
            refused: None,
            done: None,
            enrolment: None,
            fallback: Fallback::Code,
            copied: None,
            dooming: false,
            renaming: None,
            signing_out: None,
            offer: None,
            offering: false,
            offer_failed: None,
            offer_expired: false,
            serial: 0,
        }
    }

    /// Whether a change is waiting for its answer.
    pub(super) fn busy(&self) -> bool {
        self.pending.is_some()
    }

    /// Whether the account wants its password typed before a change, and
    /// it is not.
    pub(super) fn unproved(&self, cx: &gpui::App) -> bool {
        self.snapshot.as_ref().is_some_and(|account| account.has_password)
            && self.fields.current.read(cx).text().is_empty()
    }

    /// What `field` holds.
    pub(super) fn typed(field: &Entity<TextInput>, cx: &gpui::App) -> String {
        field.read(cx).text().to_owned()
    }

    /// The digits of a code typed into `field`, at most six: what is not a
    /// digit is left out, as the web UI drops it while it is typed.
    pub(super) fn code(field: &Entity<TextInput>, cx: &gpui::App) -> String {
        field
            .read(cx)
            .text()
            .chars()
            .filter(char::is_ascii_digit)
            .take(6)
            .collect()
    }
}

/// Empty `field`.
fn clear(field: &Entity<TextInput>, cx: &mut Context<Shell>) {
    field.update(cx, |field, cx| {
        field.clear();
        cx.notify();
    });
}

impl Shell {
    /// Whether the Account page is offered: connected, registered, on a
    /// server that answers about accounts.
    pub(in crate::ui) fn account_offered(&self) -> bool {
        let registered = self
            .snapshot
            .own_session
            .and_then(|own| self.snapshot.users.iter().find(|user| user.session == own))
            .and_then(|own| own.account)
            .is_some_and(|account| account > 0);
        self.snapshot.connection == crate::engine::Connection::Connected
            && registered
            && self.engine.account_offered()
    }

    /// The page was turned to: make its fields, show what the engine
    /// holds, and ask the server how the account stands now.
    pub(super) fn open_account(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.account.is_none() {
            self.panels.settings.account = Some(AccountPage::new(cx));
        }
        if let Some(held) = self.engine.account() {
            self.account_arrived(held, cx);
        }
        if let Some(page) = &mut self.panels.settings.account {
            page.unread = None;
        }
        self.engine.update_account(AccountAction::Query, None);
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(ANSWER_WITHIN).await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(page) = &mut shell.panels.settings.account
                    && page.snapshot.is_none()
                {
                    page.unread = Some("timeout".into());
                    cx.notify();
                }
            });
        })
        .detach();
    }

    /// The page was left: an offer to a new device nobody took is
    /// withdrawn, as leaving the web UI's page withdraws it.
    pub(super) fn leave_account(&mut self) {
        let Some(page) = &mut self.panels.settings.account else {
            return;
        };
        if let Some(offer) = page.offer.take()
            && !linked(page.snapshot.as_ref(), &offer.link)
        {
            self.engine.withdraw_offer(offer.link.device_id);
        }
    }

    /// Ask `action` of the server, proved with the password typed where
    /// the account has one; say so if no answer comes.
    pub(super) fn ask_account(&mut self, action: AccountAction, cx: &mut Context<Self>) {
        let Some(page) = &mut self.panels.settings.account else {
            return;
        };
        let id = action.id();
        let proof = Some(AccountPage::typed(&page.fields.current, cx)).filter(|typed| !typed.is_empty());
        page.pending = Some(id);
        page.refused = None;
        page.done = None;
        page.serial += 1;
        let serial = page.serial;
        self.engine.update_account(action, proof);
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(ANSWER_WITHIN).await;
            let _ = shell.update(cx, |shell, cx| {
                if let Some(page) = &mut shell.panels.settings.account
                    && page.serial == serial
                    && page.pending == Some(id)
                {
                    page.pending = None;
                    page.refused = Some((id, "timeout".to_owned()));
                    cx.notify();
                }
            });
        })
        .detach();
        cx.notify();
    }

    /// What the server said of the account.
    pub(in crate::ui) fn account_news(&mut self, news: AccountNews, cx: &mut Context<Self>) {
        match news {
            AccountNews::Settings(account) => self.account_arrived(account, cx),
            AccountNews::Ack(ack) => self.account_answered(ack, cx),
            AccountNews::Link(link) => self.offer_arrived(link, cx),
        }
        cx.notify();
    }

    /// How the account stands now. The email field follows the server's
    /// address while what it holds is the address it showed before.
    fn account_arrived(&mut self, account: AccountSettings, cx: &mut Context<Self>) {
        let Some(page) = &mut self.panels.settings.account else {
            return;
        };
        let shown = page.snapshot.as_ref().and_then(|old| old.email.clone()).unwrap_or_default();
        if AccountPage::typed(&page.fields.email, cx) == shown {
            let email = account.email.clone().unwrap_or_default();
            page.fields.email.update(cx, |field, cx| {
                field.set_text(email);
                cx.notify();
            });
        }
        let name = account.name.clone().unwrap_or_default();
        page.fields.name.update(cx, |field, cx| {
            field.set_placeholder(name);
            cx.notify();
        });
        page.snapshot = Some(account);
        page.unread = None;
    }

    /// How one change went: said on its row, and what it typed let go of
    /// once it is done (a refused one keeps its words to be corrected).
    fn account_answered(&mut self, ack: AccountAck, cx: &mut Context<Self>) {
        let Some(page) = &mut self.panels.settings.account else {
            return;
        };
        page.pending = None;
        if !ack.ok {
            page.refused = Some((ack.action, ack.error.unwrap_or_else(|| "unknown".to_owned())));
            return;
        }
        page.refused = None;
        page.done = Some(ack.action);
        let fields = &page.fields;
        let mut emptied = vec![fields.current.clone()];
        match ack.action {
            ids::SET_PASSWORD => emptied.extend([fields.password.clone(), fields.repeat.clone()]),
            ids::RENAME => emptied.push(fields.name.clone()),
            ids::TOTP_BEGIN => {
                page.fallback = Fallback::Code;
                page.enrolment = ack.totp_secret.map(|secret| {
                    let uri = ack.totp_uri.unwrap_or_default();
                    Enrolment {
                        code: qr::picture(&uri),
                        secret: secret.into(),
                        uri: uri.into(),
                    }
                });
            }
            ids::TOTP_VERIFY => {
                page.enrolment = None;
                emptied.push(fields.code.clone());
            }
            ids::TOTP_DISABLE => {
                page.enrolment = None;
                emptied.push(fields.off_code.clone());
            }
            ids::UNREGISTER => {
                page.dooming = false;
                emptied.push(fields.doom.clone());
            }
            ids::RENAME_DEVICE | ids::REMOVE_DEVICE => {
                page.renaming = None;
                page.signing_out = None;
            }
            _ => {}
        }
        for field in &emptied {
            clear(field, cx);
        }
    }

    /// Send what is typed in the email field.
    pub(super) fn save_email(&mut self, cx: &mut Context<Self>) {
        let Some(page) = &self.panels.settings.account else {
            return;
        };
        let email = AccountPage::typed(&page.fields.email, cx).trim().to_owned();
        self.ask_account(AccountAction::SetEmail(email), cx);
    }

    /// Rename the device being renamed to what is typed.
    pub(super) fn save_device_name(&mut self, cx: &mut Context<Self>) {
        let Some(page) = &self.panels.settings.account else {
            return;
        };
        let Some(device) = page.renaming.clone() else {
            return;
        };
        let name: String = AccountPage::typed(&page.fields.device, cx)
            .trim()
            .chars()
            .take(MAX_DEVICE_NAME)
            .collect();
        self.ask_account(AccountAction::RenameDevice { device, name }, cx);
    }

    /// Offer the account to a new device.
    pub(super) fn offer_account(&mut self, cx: &mut Context<Self>) {
        if let Some(page) = &mut self.panels.settings.account {
            page.offering = true;
            page.offer_failed = None;
            page.offer_expired = false;
        }
        // This client keeps no password of the server's to pass on: the new
        // device signs in by the identity the link carries.
        self.engine.offer_account(None);
        cx.notify();
    }

    /// The link for a new device arrived, or why it did not.
    fn offer_arrived(&mut self, link: Result<DeviceLink, String>, cx: &mut Context<Self>) {
        let Some(page) = &mut self.panels.settings.account else {
            if let Ok(link) = link {
                self.engine.withdraw_offer(link.device_id);
            }
            return;
        };
        page.offering = false;
        match link {
            Ok(link) => {
                let device = link.device_id.clone();
                page.offer = Some(Offer {
                    code: qr::picture(&link.link),
                    link,
                });
                cx.spawn(async move |shell, cx| {
                    cx.background_executor().timer(OFFER_LASTS).await;
                    let _ = shell.update(cx, |shell, cx| shell.offer_ran_out(&device, cx));
                })
                .detach();
            }
            Err(reason) => page.offer_failed = Some(reason.into()),
        }
    }

    /// The offer of `device` was left open too long: withdrawn, unless the
    /// new device signed in.
    fn offer_ran_out(&mut self, device: &str, cx: &mut Context<Self>) {
        let Some(page) = &mut self.panels.settings.account else {
            return;
        };
        let Some(offer) = page.offer.take_if(|offer| offer.link.device_id == device) else {
            return;
        };
        if linked(page.snapshot.as_ref(), &offer.link) {
            page.offer = Some(offer);
            return;
        }
        page.offer_expired = true;
        self.engine.withdraw_offer(offer.link.device_id);
        cx.notify();
    }

    /// Close the offer: one the new device took stays taken, one nobody
    /// took is withdrawn.
    pub(super) fn close_offer(&mut self, cx: &mut Context<Self>) {
        self.leave_account();
        cx.notify();
    }
}

/// Whether the device `link` registered has signed in.
pub(super) fn linked(account: Option<&AccountSettings>, link: &DeviceLink) -> bool {
    account.is_some_and(|account| {
        account
            .devices
            .iter()
            .any(|device| device.id == link.device_id && device.last_seen_ms > 0)
    })
}

/// What the server's code `code` for a refusal means.
pub(super) fn refusal(code: &str) -> SharedString {
    match code {
        "not_registered" => t!("This session has no registered account (or it was already removed)."),
        "password_too_short" => t!("The password is too short."),
        "password_too_long" => t!("The password is too long."),
        "no_certificate" => {
            t!("No certificate is linked to the account - the password cannot be removed.")
        }
        "cert_mismatch" => t!("Only the device whose certificate is linked to this account can do this."),
        "invalid_name" => t!("This user name is not allowed on this server."),
        "name_taken" => t!("This name is already taken."),
        "invalid_email" => t!("This does not look like a valid email address."),
        "unregister_failed" => t!("The registration could not be deleted."),
        "totp_disabled_by_admin" => t!("The server administrator has disabled 2FA on this server."),
        "totp_not_pending" => t!("No 2FA setup is in progress - start again."),
        "totp_not_enabled" => t!("2FA is not enabled."),
        "totp_wrong_code" => {
            t!("The code is not valid. Check your authenticator app and the device clock.")
        }
        "totp_generation_failed" => t!("The server could not generate a 2FA secret."),
        "timeout" => {
            t!("The server did not respond. It may not support this yet, or the request was lost.")
        }
        other => t!("The operation failed: {{code}}", code = other),
    }
}

#[cfg(test)]
impl AccountPage {
    /// The account as the page shows it.
    pub(in crate::ui) fn snapshot(&self) -> Option<&AccountSettings> {
        self.snapshot.as_ref()
    }

    /// What the new password's field holds.
    pub(in crate::ui) fn typed_password(&self, cx: &gpui::App) -> String {
        Self::typed(&self.fields.password, cx)
    }

    /// Why the change `id` was refused, if it was the last refused.
    pub(in crate::ui) fn refusal_of(&self, id: u32) -> Option<String> {
        self.refused
            .as_ref()
            .filter(|(refused, _)| *refused == id)
            .map(|(_, code)| code.clone())
    }
}

/// The names of the account's devices, in the order the page lists them.
#[cfg(test)]
pub(in crate::ui) fn device_names(account: &AccountSettings) -> Vec<String> {
    devices::ordered(account)
        .into_iter()
        .map(|device| device.name.clone())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_numbers_the_page_reads_answers_by_are_those_the_changes_go_out_under() {
        let device = || String::new();
        assert_eq!(ids::SET_PASSWORD, AccountAction::SetPassword(device()).id());
        assert_eq!(ids::CLEAR_PASSWORD, AccountAction::ClearPassword.id());
        assert_eq!(ids::RENAME, AccountAction::Rename(device()).id());
        assert_eq!(ids::SET_EMAIL, AccountAction::SetEmail(device()).id());
        assert_eq!(ids::UNREGISTER, AccountAction::Unregister.id());
        assert_eq!(ids::TOTP_BEGIN, AccountAction::TotpBegin.id());
        assert_eq!(ids::TOTP_VERIFY, AccountAction::TotpVerify(device()).id());
        assert_eq!(ids::TOTP_DISABLE, AccountAction::TotpDisable(device()).id());
        assert_eq!(
            ids::RENAME_DEVICE,
            AccountAction::RenameDevice { device: device(), name: device() }.id()
        );
        assert_eq!(ids::REMOVE_DEVICE, AccountAction::RemoveDevice(device()).id());
    }
}
