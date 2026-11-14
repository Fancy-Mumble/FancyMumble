//! The local user's own account on the server, for a view that is not the
//! web page: what the web client's `get_account_settings`,
//! `update_account_settings`, `begin_device_link` and `cancel_device_link`
//! commands do.
//!
//! Every change is a round trip. The server's answers arrive as
//! [`super::EngineEvent::Account`] (the account as it now stands) and
//! [`super::EngineEvent::AccountAck`] (how one change went, named by
//! [`AccountAction::id`]).

use mumble_protocol::proto::mumble_tcp::fancy_account_settings_update::Action;

use super::EngineHandle;

pub use crate::state::types::{AccountAck, AccountDevice, AccountSettings};

/// The oldest Fancy server that answers about accounts, 0.4.1, encoded as
/// the server announces its version (the web client's
/// `ACCOUNT_MIN_FANCY_VERSION`).
const ACCOUNT_MIN_FANCY_VERSION: u64 = (4 << 32) | (1 << 16);

/// One thing to ask of the server about the account.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AccountAction {
    /// Say how the account stands.
    Query,
    /// Sign in with this password from now on, or change it.
    SetPassword(String),
    /// Sign in by certificate alone again.
    ClearPassword,
    /// Take this name.
    Rename(String),
    /// Keep this contact address; empty keeps none.
    SetEmail(String),
    /// Delete the registration.
    Unregister,
    /// Start enrolling a second factor: the answer carries its secret.
    TotpBegin,
    /// Finish enrolling with this code from the authenticator.
    TotpVerify(String),
    /// Stop asking for a second factor; a current code proves it.
    TotpDisable(String),
    /// Call the device `device` `name`.
    RenameDevice {
        /// The device's id, as the account lists it.
        device: String,
        /// Its new name.
        name: String,
    },
    /// Sign the device with this id out, and refuse it from then on.
    RemoveDevice(String),
}

impl AccountAction {
    /// The number the server's acknowledgement names this by
    /// ([`AccountAck::action`]).
    #[must_use]
    pub fn id(&self) -> u32 {
        self.wire() as u32
    }

    fn wire(&self) -> Action {
        match self {
            Self::Query => Action::Query,
            Self::SetPassword(_) => Action::SetPassword,
            Self::ClearPassword => Action::ClearPassword,
            Self::Rename(_) => Action::Rename,
            Self::SetEmail(_) => Action::SetEmail,
            Self::Unregister => Action::Unregister,
            Self::TotpBegin => Action::TotpBegin,
            Self::TotpVerify(_) => Action::TotpVerify,
            Self::TotpDisable(_) => Action::TotpDisable,
            Self::RenameDevice { .. } => Action::RenameDevice,
            Self::RemoveDevice(_) => Action::RemoveDevice,
        }
    }

    /// The name the engine's command takes, what goes with it, and the
    /// device it is about.
    fn parts(self) -> (&'static str, Option<String>, Option<String>) {
        match self {
            Self::Query => ("query", None, None),
            Self::SetPassword(value) => ("set_password", Some(value), None),
            Self::ClearPassword => ("clear_password", None, None),
            Self::Rename(value) => ("rename", Some(value), None),
            Self::SetEmail(value) => ("set_email", Some(value), None),
            Self::Unregister => ("unregister", None, None),
            Self::TotpBegin => ("totp_begin", None, None),
            Self::TotpVerify(code) => ("totp_verify", Some(code), None),
            Self::TotpDisable(code) => ("totp_disable", Some(code), None),
            Self::RenameDevice { device, name } => ("rename_device", Some(name), Some(device)),
            Self::RemoveDevice(device) => ("remove_device", None, Some(device)),
        }
    }
}

/// The account offered to a new device: what the device already signed in
/// shows its owner, until the new one signs in or it is withdrawn.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DeviceLink {
    /// `fancy://link/<code>?server=<host:port>&user=<name>`: what the QR
    /// code says.
    pub link: String,
    /// The code alone, grouped for reading.
    pub code: String,
    /// The device the link becomes, to withdraw it.
    pub device_id: String,
}

impl EngineHandle {
    /// The account as the server last said it stands, on the server on
    /// show; `None` before it has said.
    #[must_use]
    pub fn account(&self) -> Option<AccountSettings> {
        self.state.get_account_settings()
    }

    /// Whether the server on show answers about accounts: a Fancy server
    /// of 0.4.1 or later. Others would drop the question without a word.
    #[must_use]
    pub fn account_offered(&self) -> bool {
        self.state
            .server_info()
            .fancy_version
            .is_some_and(|version| version >= ACCOUNT_MIN_FANCY_VERSION)
    }

    /// Ask `action` of the server, proved with the account's password where
    /// it has one. How it went arrives as an
    /// [`super::EngineEvent::AccountAck`], the account after it as an
    /// [`super::EngineEvent::Account`].
    ///
    /// # Errors
    ///
    /// When not connected, or it could not be sent.
    pub async fn update_account(
        &self,
        action: AccountAction,
        current_password: Option<String>,
    ) -> Result<(), String> {
        let (name, value, device) = action.parts();
        self.state
            .update_account_settings(name.to_owned(), value, current_password, device, None)
            .await
    }

    /// Offer the account to a new device: register it ahead, leave it this
    /// identity sealed, and hand back the link to show. `password` is the
    /// one this device signs in with, where it has one.
    ///
    /// # Errors
    ///
    /// When not connected, when this connection has no identity to copy,
    /// or when what the new device collects could not be stored.
    pub async fn begin_device_link(&self, password: Option<String>) -> Result<DeviceLink, String> {
        let offer = self.state.begin_device_link(password).await?;
        Ok(DeviceLink {
            link: offer.link,
            code: offer.code,
            device_id: offer.device_id,
        })
    }

    /// Withdraw a link nobody followed: the device it would have become
    /// goes with it.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn cancel_device_link(&self, device_id: String) -> Result<(), String> {
        self.state.cancel_device_link(device_id).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::core_event::CoreEvent;

    #[test]
    fn each_action_goes_out_under_the_name_and_number_the_server_knows() {
        let sent = |action: AccountAction| (action.id(), action.parts());
        assert_eq!(sent(AccountAction::Query), (0, ("query", None, None)));
        assert_eq!(
            sent(AccountAction::SetPassword("hunter22".into())),
            (1, ("set_password", Some("hunter22".into()), None))
        );
        assert_eq!(sent(AccountAction::ClearPassword), (2, ("clear_password", None, None)));
        assert_eq!(sent(AccountAction::Rename("Kim".into())).1.0, "rename");
        assert_eq!(sent(AccountAction::SetEmail(String::new())).0, 4);
        assert_eq!(sent(AccountAction::Unregister), (5, ("unregister", None, None)));
        assert_eq!(sent(AccountAction::TotpBegin), (6, ("totp_begin", None, None)));
        assert_eq!(
            sent(AccountAction::TotpVerify("123456".into())),
            (7, ("totp_verify", Some("123456".into()), None))
        );
        assert_eq!(sent(AccountAction::TotpDisable("654321".into())).0, 8);
        assert_eq!(
            sent(AccountAction::RenameDevice {
                device: "d1".into(),
                name: "Laptop".into()
            }),
            (9, ("rename_device", Some("Laptop".into()), Some("d1".into())))
        );
        assert_eq!(
            sent(AccountAction::RemoveDevice("d2".into())),
            (10, ("remove_device", None, Some("d2".into())))
        );
    }

    #[test]
    fn the_servers_answers_about_the_account_are_reported() {
        let account = AccountSettings {
            registered: true,
            name: Some("Alex".into()),
            ..AccountSettings::default()
        };
        assert_eq!(
            super::super::EngineEvent::from_core(CoreEvent::AccountSettings(account.clone())),
            Some(super::super::EngineEvent::Account(account))
        );
        let ack = AccountAck {
            action: 7,
            ok: false,
            error: Some("totp_wrong_code".into()),
            totp_secret: None,
            totp_uri: None,
        };
        assert_eq!(
            super::super::EngineEvent::from_core(CoreEvent::AccountAck(ack.clone())),
            Some(super::super::EngineEvent::AccountAck(ack))
        );
    }
}
