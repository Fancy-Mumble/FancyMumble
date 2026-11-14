//! The local user's own account on the server, as this view hears of it:
//! how it stands, how each change asked of it went, and the link that
//! offers it to a new device.

pub(crate) use mumble_tauri_lib::engine_api::account::{
    AccountAck, AccountAction, AccountDevice, AccountSettings, DeviceLink,
};

/// What the server said of the account, or of offering it to a new device.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum AccountNews {
    /// How it stands now.
    Settings(AccountSettings),
    /// How one change went.
    Ack(AccountAck),
    /// The link for a new device, or why there is none.
    Link(Result<DeviceLink, String>),
}

impl AccountNews {
    /// A change that never reached the server, said as the server says a
    /// refusal: on the row of the change, with `reason` as its code.
    pub(crate) fn not_sent(action: &AccountAction, reason: String) -> Self {
        Self::Ack(AccountAck {
            action: action.id(),
            ok: false,
            error: Some(reason),
            totp_secret: None,
            totp_uri: None,
        })
    }
}
