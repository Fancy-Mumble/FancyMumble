//! Self-service account settings Tauri commands.

use crate::state::types::AccountSettings;
use crate::state::AppState;

/// Read the cached own-account snapshot (or `None` if the server has not
/// answered an account query yet - e.g. unregistered, or a legacy server).
#[tauri::command]
pub(crate) fn get_account_settings(state: tauri::State<'_, AppState>) -> Option<AccountSettings> {
    state.get_account_settings()
}

/// Send one self-service account operation (`query` / `set_password` /
/// `clear_password` / `rename` / `set_email` / `unregister` / `totp_begin` /
/// `totp_verify` / `totp_disable`).  Results arrive as `account-ack` and
/// `account-settings` events.
#[tauri::command]
pub(crate) async fn update_account_settings(
    state: tauri::State<'_, AppState>,
    action: String,
    value: Option<String>,
    current_password: Option<String>,
) -> Result<(), String> {
    state
        .update_account_settings(action, value, current_password)
        .await
}
