//! Recording voice messages. The recorder itself is in
//! [`crate::state::voice_message`]; these are its three verbs and the cleanup.

use crate::state::AppState;
use crate::state::voice_message::VoiceClip;

/// Start recording. `limit_ms` is the server's ceiling, or zero for none.
///
/// Progress arrives as `voice-message-state` events: `recording` with the
/// elapsed time and input level, `limit` when the take stopped itself at the
/// ceiling, and `failed` when the microphone could not be opened.
#[tauri::command]
pub(crate) fn start_voice_message(
    state: tauri::State<'_, AppState>,
    limit_ms: Option<u32>,
) -> Result<(), String> {
    state.start_voice_message(limit_ms.unwrap_or_default())
}

/// Stop recording and hand back the clip, ready to upload.
#[tauri::command]
pub(crate) async fn finish_voice_message(
    state: tauri::State<'_, AppState>,
) -> Result<VoiceClip, String> {
    state.finish_voice_message().await
}

/// Stop recording and throw the take away.
#[tauri::command]
pub(crate) fn cancel_voice_message(state: tauri::State<'_, AppState>) {
    state.cancel_voice_message();
}

/// Delete a finished clip's temporary file, once sent or discarded.
#[tauri::command]
pub(crate) fn discard_voice_clip(
    state: tauri::State<'_, AppState>,
    path: String,
) -> Result<(), String> {
    state.discard_voice_clip(&path)
}

/// Ask the server whether it takes voice messages. The answer arrives as a
/// `voice-support` event; a server that predates voice messages never sends
/// one.
#[tauri::command]
pub(crate) async fn request_voice_support(
    state: tauri::State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    state.request_voice_support(request_id).await
}
