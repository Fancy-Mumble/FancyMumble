//! Server emotes on a server that keeps its own.
//!
//! The counterparts to `add_custom_emote` / `remove_custom_emote`, which speak
//! to the file-server plugin over HTTP. These speak to the server itself, so
//! they work wherever the server is new enough and need no plugin at all.

use crate::state::AppState;
use crate::state::canon_emotes::CanonEmote;

/// This server's emotes.
///
/// An error is a server that keeps none of its own - which is the cue to fall
/// back to the plugin's set, not to show an empty picker.
#[tauri::command]
pub(crate) async fn canon_emotes(
    state: tauri::State<'_, AppState>,
) -> Result<Vec<CanonEmote>, String> {
    state.canon_emotes().await
}

/// Add or replace one emote. Needs `ManageEmotes` on the root.
#[tauri::command]
pub(crate) async fn canon_emote_add(
    state: tauri::State<'_, AppState>,
    shortcode: String,
    alias_emoji: String,
    description: String,
    file_path: String,
) -> Result<Vec<CanonEmote>, String> {
    state
        .add_canon_emote(shortcode, alias_emoji, description, file_path)
        .await
}

/// Remove one emote. Needs `ManageEmotes` on the root.
#[tauri::command]
pub(crate) async fn canon_emote_remove(
    state: tauri::State<'_, AppState>,
    shortcode: String,
) -> Result<Vec<CanonEmote>, String> {
    state.remove_canon_emote(shortcode).await
}
