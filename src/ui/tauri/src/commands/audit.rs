//! Audit-log Tauri commands (admin "Audit Log" panel).

use crate::state::AppState;
use crate::state::types::{AuditConfigSnapshot, AuditQueryArgs, ServerSetting};

/// Read the cached audit configuration snapshot (or `None` if the server has
/// not advertised one - e.g. no audit plugin, or the user lacks the
/// ConfigureAudit/ViewAudit grant).
#[tauri::command]
pub(crate) fn get_audit_config(state: tauri::State<'_, AppState>) -> Option<AuditConfigSnapshot> {
    state.get_audit_config()
}

/// Send an audit query.  The result arrives asynchronously as an
/// `audit-response` event; a `subscribe` query additionally opens a live
/// tail delivered as `audit-event` pushes.
#[tauri::command]
pub(crate) async fn query_audit_log(
    state: tauri::State<'_, AppState>,
    args: AuditQueryArgs,
) -> Result<(), String> {
    state.query_audit_log(args).await
}

/// Ask for the avatar or comment an `audit.profile` entry kept. The answer
/// arrives as an `audit-snapshot` event.
#[tauri::command]
pub(crate) async fn request_audit_snapshot(
    state: tauri::State<'_, AppState>,
    entry_id: String,
    query_id: String,
) -> Result<(), String> {
    state.request_audit_snapshot(entry_id, query_id).await
}

/// Audit-admin path: send changed audit configuration to the server.
#[tauri::command]
pub(crate) async fn save_audit_config(
    state: tauri::State<'_, AppState>,
    changed: Vec<ServerSetting>,
) -> Result<(), String> {
    state.save_audit_config(changed).await
}
