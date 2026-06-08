//! Channel listing, navigation, listening, unread counts and channel CRUD.

use std::collections::HashMap;

use crate::state::{AppState, ChannelEntry, UserEntry};

#[tauri::command]
pub(crate) fn get_channels(state: tauri::State<'_, AppState>) -> Vec<ChannelEntry> {
    state.channels()
}

#[tauri::command]
pub(crate) fn get_users(state: tauri::State<'_, AppState>) -> Vec<UserEntry> {
    state.users()
}

/// Return the avatar bytes for a single user.  The frontend calls this
/// lazily after `get_users` (which returns only `texture_size`).  When the
/// avatar exists but has not been loaded yet, this requests the blob from the
/// server and waits for it - so avatars are fetched only on first view rather
/// than eagerly for every connected user.
#[tauri::command]
pub(crate) async fn get_user_texture(
    state: tauri::State<'_, AppState>,
    session: u32,
) -> Result<Option<Vec<u8>>, ()> {
    Ok(state.user_texture_or_fetch(session).await)
}

/// Return the avatar bytes for a registered (offline) user by `user_id`.
/// The bulk `user-list` event delivers only `texture_size`; the frontend
/// calls this lazily for users it actually renders, so registered avatars
/// are never shipped en masse (which spiked the heap during emit).
#[tauri::command]
pub(crate) fn get_registered_user_texture(
    state: tauri::State<'_, AppState>,
    user_id: u32,
) -> Option<Vec<u8>> {
    state.registered_user_texture(user_id)
}

/// Return the comment/bio text for a single user.  Like `get_user_texture`,
/// the bio is fetched (and held) only when first viewed rather than eagerly for
/// every connected user.  The frontend calls this after `get_users` (which
/// returns only `comment_size`).
#[tauri::command]
pub(crate) async fn get_user_comment(
    state: tauri::State<'_, AppState>,
    session: u32,
) -> Result<Option<String>, ()> {
    Ok(state.user_comment_or_fetch(session).await)
}

/// Return the description text for a single channel.  The frontend calls
/// this lazily after `get_channels` (which returns only `description_size`).
#[tauri::command]
pub(crate) fn get_channel_description(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Option<String> {
    state.channel_description(channel_id)
}

#[tauri::command]
pub(crate) async fn select_channel(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<(), String> {
    state.select_channel(channel_id).await
}

#[tauri::command]
pub(crate) async fn join_channel(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    password: Option<String>,
) -> Result<(), String> {
    state.join_channel(channel_id, password).await
}

#[tauri::command]
pub(crate) fn get_current_channel(state: tauri::State<'_, AppState>) -> Option<u32> {
    state.current_channel()
}

#[tauri::command]
pub(crate) async fn toggle_listen(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<bool, String> {
    state.toggle_listen(channel_id).await
}

#[tauri::command]
pub(crate) fn get_listened_channels(state: tauri::State<'_, AppState>) -> Vec<u32> {
    state.listened_channels()
}

#[tauri::command]
pub(crate) fn get_push_subscribed_channels(state: tauri::State<'_, AppState>) -> Vec<u32> {
    state.push_subscribed_channels()
}

#[tauri::command]
pub(crate) fn get_unread_counts(state: tauri::State<'_, AppState>) -> HashMap<u32, u32> {
    state.unread_counts()
}

#[tauri::command]
pub(crate) fn mark_channel_read(state: tauri::State<'_, AppState>, channel_id: u32) {
    state.mark_read(channel_id);
}

/// Update a channel on the server.
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri command mirrors the full channel update parameter surface")]
pub(crate) async fn update_channel(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    name: Option<String>,
    description: Option<String>,
    position: Option<i32>,
    temporary: Option<bool>,
    max_users: Option<u32>,
    pchat_protocol: Option<String>,
    pchat_max_history: Option<u32>,
    pchat_retention_days: Option<u32>,
    password: Option<String>,
) -> Result<(), String> {
    state
        .update_channel(
            channel_id,
            name,
            description,
            position,
            temporary,
            max_users,
            pchat_protocol,
            pchat_max_history,
            pchat_retention_days,
            password,
        )
        .await
}

/// Delete a channel on the server.
#[tauri::command]
pub(crate) async fn delete_channel(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
) -> Result<(), String> {
    state.delete_channel(channel_id).await
}

/// Create a new sub-channel on the server.
#[tauri::command]
#[allow(clippy::too_many_arguments, reason = "Tauri command mirrors the full channel creation parameter surface")]
pub(crate) async fn create_channel(
    state: tauri::State<'_, AppState>,
    parent_id: u32,
    name: String,
    description: Option<String>,
    position: Option<i32>,
    temporary: Option<bool>,
    max_users: Option<u32>,
    pchat_protocol: Option<String>,
    pchat_max_history: Option<u32>,
    pchat_retention_days: Option<u32>,
    password: Option<String>,
) -> Result<(), String> {
    state
        .create_channel(
            parent_id,
            name,
            description,
            position,
            temporary,
            max_users,
            pchat_protocol,
            pchat_max_history,
            pchat_retention_days,
            password,
        )
        .await
}
