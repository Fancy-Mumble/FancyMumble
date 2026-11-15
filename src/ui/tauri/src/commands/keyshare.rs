//! Persistent-chat custodian and key-share/key-takeover commands.

use crate::state::{self, AppState};

/// Confirm the initial custodian list for a channel (TOFU, Section 5.7).
#[tauri::command]
pub(crate) fn confirm_custodians(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<(), String> {
    let __session = state.inner.snapshot();
    let mut shared = __session.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut pchat) = shared.pchat_ctx.pchat {
        pchat.key_manager.confirm_custodian_list(channel_id);
    }
    Ok(())
}

/// Accept a pending custodian list change for a channel (Section 5.7).
#[tauri::command]
pub(crate) fn accept_custodian_changes(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<(), String> {
    let __session = state.inner.snapshot();
    let mut shared = __session.lock().map_err(|e| e.to_string())?;
    if let Some(ref mut pchat) = shared.pchat_ctx.pchat {
        pchat.key_manager.accept_custodian_update(channel_id);
    }
    Ok(())
}

/// Approve a pending key-share request: actually send the encrypted
/// channel key to the peer that triggered the consent banner.
#[tauri::command]
pub(crate) async fn approve_key_share(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    peer_cert_hash: String,
) -> Result<(), String> {
    state.approve_key_share(channel_id, peer_cert_hash).await
}

/// Dismiss a pending key-share request without sending the key.
#[tauri::command]
pub(crate) fn dismiss_key_share(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    peer_cert_hash: String,
) -> Result<(), String> {
    state.dismiss_key_share(channel_id, &peer_cert_hash)
}

/// Ask the server for the list of key holders for a channel.
#[tauri::command]
pub(crate) async fn query_key_holders(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<(), String> {
    let handle = {
        let __session = state.inner.snapshot();
        let shared = __session.lock().map_err(|e| e.to_string())?;
        shared.conn.client_handle.clone().ok_or("not connected")?
    };
    let query = mumble_protocol::proto::mumble_tcp::PchatKeyHoldersQuery {
        channel_id: Some(channel_id),
    };
    handle
        .send(mumble_protocol::command::SendPchatKeyHoldersQuery { query })
        .await
        .map_err(|e| format!("send failed: {e}"))
}

/// Return the cached key holders for a channel (from the last server response).
#[tauri::command]
pub(crate) fn get_key_holders(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Vec<state::types::KeyHolderEntry> {
    let __session = state.inner.snapshot();
    let shared = __session
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    shared
        .pchat_ctx
        .key_holders
        .get(&channel_id)
        .cloned()
        .unwrap_or_default()
}

/// Request a key-ownership takeover for a channel (requires `KeyOwner` permission).
///
/// `mode` must be `"full_wipe"` (delete messages + key takeover) or
/// `"key_only"` (key takeover without deleting messages).
///
/// On success the server responds with an updated `PchatKeyHoldersList`.
/// On failure the server sends `PermissionDenied`.
#[tauri::command]
pub(crate) async fn key_takeover(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    mode: String,
) -> Result<(), String> {
    use mumble_protocol::proto::mumble_tcp::pchat_key_holder_report::KeyTakeoverMode;
    let takeover_mode = match mode.as_str() {
        "full_wipe" => KeyTakeoverMode::FullWipe,
        "key_only" => KeyTakeoverMode::KeyOnly,
        _ => return Err(format!("invalid takeover mode: {mode}")),
    };
    state::pchat::send_key_takeover(&state.inner.snapshot(), channel_id, takeover_mode);
    Ok(())
}
