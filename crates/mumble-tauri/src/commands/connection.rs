//! Connection lifecycle commands.

use crate::state::{AppState, ConnectionStatus};

/// Reject certificate labels that could escape the identity directory.
///
/// The label is used as a path component for on-disk identity/seed storage, so
/// only a conservative charset and bounded length are allowed: no path
/// separators (so the label is always a single component) and no `.`/`..`
/// (which would resolve to the current/parent directory).
fn validate_cert_label(label: Option<&str>) -> Result<(), String> {
    let Some(label) = label else { return Ok(()) };
    if label.is_empty() || label.len() > 64 {
        return Err("certificate label must be 1-64 characters".into());
    }
    if label == "." || label == ".." {
        return Err("invalid certificate label".into());
    }
    if !label.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-')) {
        return Err("certificate label may only contain letters, digits, '.', '_' and '-'".into());
    }
    Ok(())
}

#[tauri::command]
pub(crate) async fn connect(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    cert_label: Option<String>,
    password: Option<String>,
) -> Result<(), String> {
    validate_cert_label(cert_label.as_deref())?;
    state.connect(host, port, username, cert_label, password).await
}

#[tauri::command]
pub(crate) async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.disconnect().await
}

#[tauri::command]
pub(crate) fn get_status(state: tauri::State<'_, AppState>) -> ConnectionStatus {
    state.status()
}
