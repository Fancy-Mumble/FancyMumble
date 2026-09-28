//! Multi-server session commands.

use crate::state::{AppState, HashLookup, ServerId, SessionMeta, UserHashMatch};

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
/// certificate hash.  Used to resolve cross-server user shortcuts and saved
/// friends when the bound user has a stable certificate identity.
///
/// One certificate can be used by more than one account, so a caller that knows
/// which registered account it saved (`user_id`) and which session it saved it
/// on (`server_id`) should pass both: on that server the account decides, and a
/// stranger holding the same certificate is not returned.  Callers that only
/// ever knew a hash (user shortcuts) may omit them and get the old
/// certificate-only search.
#[tauri::command]
pub(crate) fn find_user_by_hash(
    state: tauri::State<'_, AppState>,
    user_hash: String,
    user_id: Option<u32>,
    server_id: Option<ServerId>,
) -> Option<UserHashMatch> {
    state.registry.find_user_by_hash(HashLookup {
        user_hash: &user_hash,
        user_id,
        origin: server_id,
    })
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
