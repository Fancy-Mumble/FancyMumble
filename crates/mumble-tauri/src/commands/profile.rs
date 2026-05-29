//! Own profile updates and typed Fancy Mumble plugin commands.
//!
//! Note: `PluginDataTransmission` is permanently forbidden in Fancy
//! Mumble.  The legacy `send_plugin_data` command now refuses to
//! transmit and returns an explanatory error.  All new client-to-server
//! data must use a typed protobuf message defined in `Mumble.proto`
//! (e.g. `FancyPoll`, `FancyPollVote`) with its own `#[tauri::command]`
//! handler, or be wrapped in a `PluginMessage` envelope (wire ID 200)
//! routed via `send_plugin_message`.

use crate::state::AppState;

/// Set the user comment on the connected server (`FancyMumble` profile + bio).
#[tauri::command]
pub(crate) async fn set_user_comment(
    state: tauri::State<'_, AppState>,
    comment: String,
) -> Result<(), String> {
    state.set_user_comment(comment).await
}

/// Set the user avatar texture on the connected server (raw image bytes).
///
/// Accepts a JSON array of `u8` values from the frontend.
#[tauri::command]
pub(crate) async fn set_user_texture(
    state: tauri::State<'_, AppState>,
    texture: Vec<u8>,
) -> Result<(), String> {
    state.set_user_texture(texture).await
}

/// Return the local user's session ID assigned by the server.
#[tauri::command]
pub(crate) fn get_own_session(state: tauri::State<'_, AppState>) -> Option<u32> {
    state.get_own_session()
}

/// BRICKED.  `PluginDataTransmission` is forbidden in Fancy Mumble.
///
/// This command is retained only so legacy UI code that still calls it
/// fails loudly with an actionable error instead of silently dropping
/// messages.  Any feature that needs to send data must use a native
/// typed protobuf message instead.
#[tauri::command]
pub(crate) fn send_plugin_data(
    _receiver_sessions: Vec<u32>,
    _data: Vec<u8>,
    data_id: String,
) -> Result<(), String> {
    tracing::error!(
        data_id = %data_id,
        "send_plugin_data is BRICKED: PluginDataTransmission is forbidden in Fancy Mumble"
    );
    Err(format!(
        "PluginDataTransmission is forbidden in Fancy Mumble (attempted dataId={data_id:?}). \
         Replace this call with a typed protobuf message (e.g. FancyPoll/FancyPollVote) or \
         wrap it in a `PluginMessage` envelope (wire ID 200) via `send_plugin_message`. \
         For brand-new payloads add a typed message to proto/Mumble.proto with a stable wire ID."
    ))
}

/// Send a generic plugin envelope to the server.  The server routes
/// the message to the plugin identified by `pluginName`; payload
/// bytes are opaque to the protocol (plugins choose encoding, typically
/// JSON).  Replies arrive on the `plugin-message` Tauri event.
#[tauri::command]
pub(crate) async fn send_plugin_message(
    state: tauri::State<'_, AppState>,
    plugin_name: String,
    payload_type: String,
    payload: Vec<u8>,
    target_sessions: Vec<u32>,
    channel_id: Option<u32>,
) -> Result<(), String> {
    state
        .send_plugin_message(plugin_name, payload_type, payload, target_sessions, channel_id)
        .await
}

/// Announce a new poll in a channel.  The server stamps the creator
/// session and relays to every other Fancy client in the channel.
#[tauri::command]
pub(crate) async fn send_fancy_poll(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    poll_id: String,
    question: String,
    options: Vec<String>,
    multiple: bool,
    created_at: String,
) -> Result<(), String> {
    state
        .send_fancy_poll(channel_id, poll_id, question, options, multiple, created_at)
        .await
}

/// Cast a vote on an existing poll.
#[tauri::command]
pub(crate) async fn send_fancy_poll_vote(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    poll_id: String,
    selected: Vec<u32>,
) -> Result<(), String> {
    state
        .send_fancy_poll_vote(channel_id, poll_id, selected)
        .await
}
