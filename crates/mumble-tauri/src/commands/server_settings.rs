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

/// Admin path: send changed settings to the server to apply at runtime.
#[tauri::command]
pub(crate) async fn save_server_settings(
    state: tauri::State<'_, AppState>,
    changed: Vec<ServerSetting>,
) -> Result<(), String> {
    state.save_server_settings(changed).await
}
