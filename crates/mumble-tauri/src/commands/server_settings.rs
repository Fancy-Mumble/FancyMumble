//! Editable server-settings Tauri commands.

use crate::state::types::{ServerSetting, ServerSettingsSnapshot};
use crate::state::AppState;

/// Read the cached editable server-settings snapshot (or `None` if the server
/// has not advertised one - e.g. the user is not an admin, or a legacy server).
#[tauri::command]
pub(crate) fn get_server_settings(
    state: tauri::State<'_, AppState>,
) -> Option<ServerSettingsSnapshot> {
    state.get_server_settings()
}

/// Ask the server for the editable settings; the answer arrives on the
/// `server-settings` Tauri event, the same one the epoch-0 broadcast uses.
#[tauri::command]
pub(crate) async fn request_server_settings(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.request_server_settings().await
}

/// Admin path: send changed settings to the server to apply at runtime.
#[tauri::command]
pub(crate) async fn save_server_settings(
    state: tauri::State<'_, AppState>,
    changed: Vec<ServerSetting>,
) -> Result<(), String> {
    state.save_server_settings(changed).await
}
