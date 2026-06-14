//! Multi-server session commands.

use crate::state::{AppState, ServerId, SessionMeta, UserHashMatch};

#[tauri::command]
pub(crate) fn list_servers(state: tauri::State<'_, AppState>) -> Vec<SessionMeta> {
    state.registry.list_meta()
}

#[tauri::command]
pub(crate) fn get_active_server(state: tauri::State<'_, AppState>) -> Option<ServerId> {
    state.registry.active_id()
}

#[tauri::command]
pub(crate) async fn set_active_server(
    state: tauri::State<'_, AppState>,
    server_id: ServerId,
) -> Result<(), String> {
    state.switch_active_with_voice(server_id).await
}

/// Find a user across every currently-connected session by their TLS
/// certificate hash.  Used to resolve cross-server user shortcuts when
/// the bound user has a stable certificate identity.
#[tauri::command]
pub(crate) fn find_user_by_hash(
    state: tauri::State<'_, AppState>,
    user_hash: String,
) -> Option<UserHashMatch> {
    state.registry.find_user_by_hash(&user_hash)
}

/// Look up a user on a specific connected server by display name.
/// Fallback resolver for anonymous users that do not have a certificate
/// hash and therefore can only be addressed within a single server.
#[tauri::command]
pub(crate) fn find_user_in_server(
    state: tauri::State<'_, AppState>,
    server_id: ServerId,
    user_name: String,
) -> Option<UserHashMatch> {
    state.registry.find_user_in_server(server_id, &user_name)
}

/// Disconnect a specific session by id.  Operates only on that
/// session's connection / state - does not touch the active session's
/// `inner` pointer or its audio pipeline (unless `server_id` itself
/// is the active session).
#[tauri::command]
pub(crate) async fn disconnect_server(
    state: tauri::State<'_, AppState>,
    server_id: ServerId,
) -> Result<(), String> {
    state.disconnect_session(server_id).await
}
