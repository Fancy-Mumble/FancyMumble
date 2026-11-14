//! Linking a device: the Tauri commands both halves of it call.
//!
//! See `state::link` for the flow and for what the server does and does not
//! see.

use crate::state::AppState;
use crate::state::link::{LinkOffer, LinkTarget, LinkedIdentity};

/// On the device already signed in: register a new device on this account and
/// leave it the sealed identity. Returns the link and code to show.
#[tauri::command]
pub(crate) async fn begin_device_link(
    state: tauri::State<'_, AppState>,
    password: Option<String>,
) -> Result<LinkOffer, String> {
    state.begin_device_link(password).await
}

/// On the device already signed in: withdraw a link nobody completed.
#[tauri::command]
pub(crate) async fn cancel_device_link(
    state: tauri::State<'_, AppState>,
    device_id: String,
) -> Result<(), String> {
    state.cancel_device_link(device_id).await
}

/// On the new device: read a link, and log in as the device it names from
/// the next connect to its server on. Returns where to connect.
#[tauri::command]
pub(crate) fn start_device_link(
    state: tauri::State<'_, AppState>,
    link: String,
) -> Result<LinkTarget, String> {
    state.start_device_link(link)
}

/// On the new device, once connected: open the parcel and store the identity.
#[tauri::command]
pub(crate) async fn finish_device_link(
    state: tauri::State<'_, AppState>,
) -> Result<LinkedIdentity, String> {
    state.finish_device_link().await
}

/// Seal `plaintext` so only this account's devices can open it (see
/// `state::account_seal`).
#[tauri::command]
pub(crate) fn account_seal(
    state: tauri::State<'_, AppState>,
    plaintext: String,
) -> Result<String, String> {
    state.account_seal(&plaintext)
}

/// Open what `account_seal` sealed.
#[tauri::command]
pub(crate) fn account_open(
    state: tauri::State<'_, AppState>,
    sealed: String,
) -> Result<String, String> {
    state.account_open(&sealed)
}
