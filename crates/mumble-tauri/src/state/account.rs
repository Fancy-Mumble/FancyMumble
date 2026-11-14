//! Self-service account settings methods on `AppState`.
//!
//! - `get_account_settings` snapshots the cached account state for the active
//!   session (populated by `FancyAccountSettings` responses).
//! - `update_account_settings` sends one account operation to the server
//!   (query, set/clear password, rename, set email, unregister, TOTP
//!   enrolment).  Results arrive as `account-ack` / `account-settings` events.

use mumble_protocol::command;
use mumble_protocol::proto::mumble_tcp::fancy_account_settings_update::Action;

use super::AppState;
use super::types::AccountSettings;

impl AppState {
    /// Snapshot the cached own-account settings, if any.
    pub fn get_account_settings(&self) -> Option<AccountSettings> {
        let snapshot = self.inner.snapshot();
        let guard = snapshot.lock().ok()?;
        guard.account_settings.clone()
    }

    /// Send one self-service account operation to the server.
    ///
    /// `action` is the `snake_case` name of a
    /// `FancyAccountSettingsUpdate.Action` variant; `value` carries the
    /// action-specific payload (password, new name, email, TOTP code), and
    /// `current_password` the account's existing password, which the server
    /// requires for every action that changes anything. `device_id` names the
    /// device a device action acts on, and `device_secret` is the secret a
    /// device being linked will log in with.
    pub async fn update_account_settings(
        &self,
        action: String,
        value: Option<String>,
        current_password: Option<String>,
        device_id: Option<String>,
        device_secret: Option<String>,
    ) -> Result<(), String> {
        let action = match action.as_str() {
            "query" => Action::Query,
            "set_password" => Action::SetPassword,
            "clear_password" => Action::ClearPassword,
            "rename" => Action::Rename,
            "set_email" => Action::SetEmail,
            "unregister" => Action::Unregister,
            "totp_begin" => Action::TotpBegin,
            "totp_verify" => Action::TotpVerify,
            "totp_disable" => Action::TotpDisable,
            "rename_device" => Action::RenameDevice,
            "remove_device" => Action::RemoveDevice,
            "add_device" => Action::AddDevice,
            other => return Err(format!("unknown account action: {other}")),
        };

        let handle = {
            let session = self.inner.snapshot();
            let state = session.lock().map_err(|e| e.to_string())?;
            state.conn.client_handle.clone()
        };
        let handle = handle.ok_or("Not connected")?;

        handle
            .send(command::SendFancyAccountSettingsUpdate {
                action,
                value,
                current_password,
                device_id,
                device_secret,
            })
            .await
            .map_err(|e| format!("Failed to send account update: {e}"))?;
        Ok(())
    }
}
