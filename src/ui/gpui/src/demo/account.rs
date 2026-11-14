//! The local user's account on the demo server, kept as a server keeps it
//! and answered as Starling answers: a change that needs the password is
//! refused without it, a short password, a name somebody has, a wrong code
//! and signing out the device one is on are refused, and everything else is
//! done, acknowledged, and the account said again.

use crate::engine::{AccountAck, AccountAction, AccountDevice, AccountNews, AccountSettings, DeviceLink};

/// The device the demo is signed in from.
const THIS_DEVICE: &str = "d-this";

/// The device a link registers ahead.
const LINKED_DEVICE: &str = "d-new";

/// The secret a second factor is enrolled with.
const SECRET: &str = "JBSWY3DPEHPK3PXP";

/// A name somebody else on the demo server is registered as.
const TAKEN: &str = "Flora";

/// When the old desktop was last seen: three days before the demo's
/// messages.
const LONG_AGO_MS: u64 = 1_700_000_000_000;

/// The account, and what the server keeps of it besides what it says.
#[derive(Debug)]
pub(crate) struct Desk {
    account: AccountSettings,
    password: Option<String>,
    /// A second factor begun and not yet confirmed.
    enrolling: bool,
}

impl Desk {
    /// Alex's account, signed in by certificate from this laptop, a phone
    /// online beside it and an old desktop not seen for a while.
    pub(crate) fn seeded(name: &str) -> Self {
        let device = |id: &str, name: &str, last_seen_ms: u64, online: bool| AccountDevice {
            id: id.to_owned(),
            name: name.to_owned(),
            added_at_ms: LONG_AGO_MS,
            last_seen_ms,
            online,
        };
        Self {
            account: AccountSettings {
                registered: true,
                user_id: Some(101),
                name: Some(name.to_owned()),
                email: None,
                has_password: false,
                totp_enabled: false,
                cert_hash: Some("h1".to_owned()),
                cert_matches_session: true,
                devices: vec![
                    device(THIS_DEVICE, "This laptop", LONG_AGO_MS, true),
                    device("d-phone", "Phone", LONG_AGO_MS, true),
                    device("d-desk", "Old desktop", LONG_AGO_MS, false),
                ],
                devices_locked: false,
                this_device: Some(THIS_DEVICE.to_owned()),
            },
            password: None,
            enrolling: false,
        }
    }

    /// How the account stands.
    pub(crate) fn account(&self) -> AccountSettings {
        self.account.clone()
    }

    /// Answer `action`, proved with `proof`: the acknowledgement, and the
    /// account after it where it changed.
    pub(crate) fn answer(&mut self, action: AccountAction, proof: Option<&str>) -> Vec<AccountNews> {
        if action == AccountAction::Query {
            return vec![AccountNews::Settings(self.account())];
        }
        let id = action.id();
        let changes = !matches!(action, AccountAction::RenameDevice { .. });
        let proved = self.password.is_none() || proof == self.password.as_deref();
        let done = if changes && !proved {
            Err("the current password is wrong".to_owned())
        } else {
            self.apply(action)
        };
        match done {
            Ok(secret) => vec![
                AccountNews::Ack(AccountAck {
                    action: id,
                    ok: true,
                    error: None,
                    totp_uri: secret.as_ref().map(|secret| {
                        format!("otpauth://totp/settings-test:Alex?secret={secret}&issuer=settings-test")
                    }),
                    totp_secret: secret,
                }),
                AccountNews::Settings(self.account()),
            ],
            Err(why) => vec![AccountNews::Ack(AccountAck {
                action: id,
                ok: false,
                error: Some(why),
                totp_secret: None,
                totp_uri: None,
            })],
        }
    }

    /// Do `action`; the secret of a second factor begun.
    fn apply(&mut self, action: AccountAction) -> Result<Option<String>, String> {
        let account = &mut self.account;
        match action {
            AccountAction::Query => {}
            AccountAction::SetPassword(password) if password.chars().count() < 8 => {
                return Err("password_too_short".to_owned());
            }
            AccountAction::SetPassword(password) => {
                self.password = Some(password);
                account.has_password = true;
            }
            AccountAction::ClearPassword => {
                self.password = None;
                account.has_password = false;
            }
            AccountAction::Rename(name) if name == TAKEN => return Err("name_taken".to_owned()),
            AccountAction::Rename(name) => account.name = Some(name),
            AccountAction::SetEmail(email) if !email.is_empty() && !email.contains('@') => {
                return Err("invalid_email".to_owned());
            }
            AccountAction::SetEmail(email) => account.email = Some(email).filter(|e| !e.is_empty()),
            AccountAction::Unregister => {
                *account = AccountSettings::default();
            }
            AccountAction::TotpBegin => {
                self.enrolling = true;
                return Ok(Some(SECRET.to_owned()));
            }
            AccountAction::TotpVerify(_) if !self.enrolling => {
                return Err("totp_not_pending".to_owned());
            }
            AccountAction::TotpVerify(code) | AccountAction::TotpDisable(code)
                if code == "000000" =>
            {
                return Err("totp_wrong_code".to_owned());
            }
            AccountAction::TotpVerify(_) => {
                self.enrolling = false;
                account.totp_enabled = true;
            }
            AccountAction::TotpDisable(_) => account.totp_enabled = false,
            AccountAction::RenameDevice { device, name } => {
                if let Some(known) = account.devices.iter_mut().find(|known| known.id == device) {
                    known.name = name;
                }
            }
            AccountAction::RemoveDevice(device) if device == THIS_DEVICE => {
                return Err("this is the device you are signed in from".to_owned());
            }
            AccountAction::RemoveDevice(device) => {
                account.devices.retain(|known| known.id != device);
                account.devices_locked = true;
            }
        }
        Ok(None)
    }

    /// Register a device ahead for a link, and the link.
    pub(crate) fn offer(&mut self) -> DeviceLink {
        self.account.devices.retain(|known| known.id != LINKED_DEVICE);
        self.account.devices.push(AccountDevice {
            id: LINKED_DEVICE.to_owned(),
            name: "New device".to_owned(),
            added_at_ms: LONG_AGO_MS,
            last_seen_ms: 0,
            online: false,
        });
        DeviceLink {
            link: "fancy://link/K7Q2M9XW4R8T3V6P?server=settings-test:64738&user=Alex".to_owned(),
            code: "K7Q2 M9XW 4R8T 3V6P".to_owned(),
            device_id: LINKED_DEVICE.to_owned(),
        }
    }

    /// Withdraw the link that would become `device`.
    pub(crate) fn withdraw(&mut self, device: &str) {
        self.account.devices.retain(|known| known.id != device);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn acked(news: &[AccountNews]) -> (bool, Option<String>) {
        match news.first() {
            Some(AccountNews::Ack(ack)) => (ack.ok, ack.error.clone()),
            other => panic!("an acknowledgement first, not {other:?}"),
        }
    }

    #[test]
    fn a_password_once_set_must_prove_every_change() {
        let mut desk = Desk::seeded("Alex");
        assert!(!acked(&desk.answer(AccountAction::SetPassword("short".into()), None)).0);
        assert!(acked(&desk.answer(AccountAction::SetPassword("long enough".into()), None)).0);
        let refused = desk.answer(AccountAction::Rename("Kim".into()), None);
        assert_eq!(acked(&refused).1.as_deref(), Some("the current password is wrong"));
        assert!(acked(&desk.answer(AccountAction::Rename("Kim".into()), Some("long enough"))).0);
        assert_eq!(desk.account().name.as_deref(), Some("Kim"));
    }
}
