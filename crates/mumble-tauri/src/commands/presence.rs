//! Discord Rich Presence commands.
//!
//! Thin wrappers over [`crate::state::presence`]; see that module for what
//! the listener actually does and why it is careful around a running Discord
//! client.

use crate::state::presence::{PresenceSnapshot, PresenceStatus};
use crate::state::AppState;

/// Start or stop the Rich Presence listener.
///
/// `resolve_artwork` controls the only part that uses the network: looking up
/// application names and artwork on Discord's public CDN. With it off the
/// feature stays entirely local.
#[tauri::command]
pub(crate) async fn presence_set_enabled(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    enabled: bool,
    resolve_artwork: bool,
) -> Result<PresenceStatus, String> {
    state
        .set_presence_enabled(&app, enabled, resolve_artwork)
        .await
}

/// The current listener status and every activity being advertised.
///
/// The frontend also receives this payload as a `rich-presence-changed`
/// event; this command is for the initial read and for resyncing after a
/// frontend reload.
#[tauri::command]
pub(crate) async fn presence_snapshot(
    state: tauri::State<'_, AppState>,
) -> Result<PresenceSnapshot, String> {
    Ok(state.presence_snapshot().await)
}
