//! Tauri commands for the per-channel forums feature.

use crate::state::AppState;

/// Create a new forum thread, reply to a thread, or edit a post.
///
/// - New thread: omit `postId`/`threadId`, provide `title`.
/// - Reply: provide `threadId` (the thread root), omit `postId`.
/// - Edit: provide `postId`.
#[tauri::command]
pub(crate) async fn send_forum_post(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    post_id: Option<String>,
    thread_id: Option<String>,
    title: Option<String>,
    body: String,
) -> Result<(), String> {
    state
        .send_fancy_forum_post(channel_id, post_id, thread_id, title, body)
        .await
}

/// Fetch forum threads for a channel (omit `threadId`) or the posts of a
/// thread (provide `threadId`). Results arrive via the `fancy-forum-fetch-response` event.
#[tauri::command]
pub(crate) async fn fetch_forum(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    thread_id: Option<String>,
    before_id: Option<String>,
    limit: Option<u32>,
) -> Result<(), String> {
    state
        .fetch_fancy_forum(channel_id, thread_id, before_id, limit)
        .await
}

/// Delete a forum post (or a whole thread when the id is a thread root).
#[tauri::command]
pub(crate) async fn delete_forum_post(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    post_id: String,
) -> Result<(), String> {
    state.delete_fancy_forum_post(channel_id, post_id).await
}
