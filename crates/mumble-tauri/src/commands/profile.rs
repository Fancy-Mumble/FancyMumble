//! Own profile updates and typed Fancy Mumble plugin commands.
//!
//! Note: `PluginDataTransmission` is permanently forbidden in Fancy
//! Mumble.  The legacy `send_plugin_data` command now refuses to
//! transmit and returns an explanatory error.  All new client-to-server
//! data must use a typed protobuf message defined in `Mumble.proto`
//! (see IDs 141-145) with its own `#[tauri::command]` handler below.

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
         Replace this call with a typed protobuf message: see proto/Mumble.proto IDs 141-145 \
         and the send_fancy_* Tauri commands.  If you need a new payload, add a new message \
         to proto/Mumble.proto with a stable wire ID (>= 146) and a matching Tauri command."
    ))
}

/// Ask the server's live-doc plugin to open (or re-attach to) a
/// collaborative document in a channel.  The server replies with a
/// `FancyLiveDocInvite` (emitted as the `fancy-live-doc-invite` event).
#[tauri::command]
pub(crate) async fn request_open_live_doc(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    slug: String,
    title: String,
) -> Result<(), String> {
    state
        .send_fancy_live_doc_open(channel_id, slug, title)
        .await
}

/// Announce an open live-doc to channel peers.
#[tauri::command]
pub(crate) async fn announce_live_doc(
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    slug: String,
    title: String,
) -> Result<(), String> {
    state
        .send_fancy_live_doc_announce(channel_id, slug, title)
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
