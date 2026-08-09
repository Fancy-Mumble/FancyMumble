//! Tauri commands for the scheduled-messages feature.

use crate::state::AppState;

/// Schedule a text message for delivery to one or more channels at a future
/// time (`deliver_at`, Unix epoch milliseconds). The server acknowledges via
/// the `fancy-scheduled-message-ack` event.
#[tauri::command]
pub(crate) async fn schedule_message(
    state: tauri::State<'_, AppState>,
    channel_ids: Vec<u32>,
    tree_ids: Option<Vec<u32>>,
    message: String,
    deliver_at: u64,
) -> Result<(), String> {
    state
        .send_fancy_scheduled_message(channel_ids, tree_ids.unwrap_or_default(), message, deliver_at)
        .await
}

/// Request the caller's pending scheduled messages. Results arrive via the
/// `fancy-scheduled-message-list` event.
#[tauri::command]
pub(crate) async fn list_scheduled_messages(
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state.request_fancy_scheduled_messages().await
}

/// Cancel a pending scheduled message by id.
#[tauri::command]
pub(crate) async fn cancel_scheduled_message(
    state: tauri::State<'_, AppState>,
    schedule_id: String,
) -> Result<(), String> {
    state.cancel_fancy_scheduled_message(schedule_id).await
}
