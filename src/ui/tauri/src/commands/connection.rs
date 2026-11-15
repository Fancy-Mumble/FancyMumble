//! Connection lifecycle commands.

use crate::state::{AppState, ConnectionStatus, Credentials};

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
    if !label
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
    {
        return Err("certificate label may only contain letters, digits, '.', '_' and '-'".into());
    }
    Ok(())
}

/// Reject an invite code that could not be one Starling minted.
///
/// It becomes an access token, and the token list is the client's proof of
/// channel passwords too: a "code" smuggling a comma or a second token in is
/// refused here rather than sent. Starling's own codes are twelve lower-case
/// letters and digits; the bound is looser so a future length still passes.
fn validate_invite(invite: Option<&str>) -> Result<(), String> {
    let Some(code) = invite else { return Ok(()) };
    if code.is_empty() || code.len() > 64 || !code.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("that invite code is not valid".into());
    }
    Ok(())
}

#[tauri::command]
#[allow(
    clippy::too_many_arguments,
    reason = "Tauri command mirrors the connect dialog's fields one to one"
)]
pub(crate) async fn connect(
    state: tauri::State<'_, AppState>,
    host: String,
    port: u16,
    username: String,
    cert_label: Option<String>,
    password: Option<String>,
    totp: Option<String>,
    invite: Option<String>,
) -> Result<(), String> {
    validate_cert_label(cert_label.as_deref())?;
    // An empty string from a form is "no invite", not an invalid one.
    let invite = invite.filter(|code| !code.trim().is_empty());
    validate_invite(invite.as_deref())?;
    state
        .connect(
            host,
            port,
            username,
            cert_label,
            Credentials {
                password,
                totp,
                invite,
            },
        )
        .await
}

#[tauri::command]
pub(crate) async fn disconnect(state: tauri::State<'_, AppState>) -> Result<(), String> {
    state.disconnect().await
}

#[tauri::command]
pub(crate) fn get_status(state: tauri::State<'_, AppState>) -> ConnectionStatus {
    state.status()
}
