//! Image popout window: borderless, transparent, always-on-top viewer.

use crate::state::AppState;

/// Metadata sent alongside an image to the popout window.
///
/// The frontend builds this payload from the originating chat message
/// so the popout can display a frosted-glass info bar with sender,
/// avatar, optional caption and timestamp.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PopoutImagePayload {
    /// Image URL or data URL to display.
    pub src: String,
    /// Display name of the user who posted the image.
    #[serde(default)]
    pub sender_name: Option<String>,
    /// Avatar image (data URL) of the sender, if available.
    #[serde(default)]
    pub sender_avatar: Option<String>,
    /// Optional caption / surrounding text from the chat message.
    #[serde(default)]
    pub caption: Option<String>,
    /// Unix epoch milliseconds when the message was sent.
    #[serde(default)]
    pub timestamp_ms: Option<i64>,
}

/// Open a borderless, always-on-top window displaying a single image.
///
/// The frontend hands us the image payload (src + display metadata),
/// we stash it under a fresh id, and a new webview window is opened
/// with label `popout-<id>`. The popout's frontend reads its own
/// window label to recover the id and calls [`take_popout_image`].
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn open_image_popout(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: PopoutImagePayload,
    width: Option<f64>,
    height: Option<f64>,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    if let Ok(mut map) = state.popout_images.lock() {
        let _ = map.insert(id.clone(), payload);
    }

    let label = format!("popout-{id}");

    let w = width.unwrap_or(720.0).clamp(160.0, 4096.0);
    let h = height.unwrap_or(480.0).clamp(120.0, 4096.0);

    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("")
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .inner_size(w, h)
    .resizable(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    Ok(())
}

/// Android stub: popout windows are a desktop-only feature.
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn open_image_popout(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _payload: PopoutImagePayload,
    _width: Option<f64>,
    _height: Option<f64>,
) -> Result<(), String> {
    Err("Image popout windows are not supported on Android".to_string())
}

/// Consume and return the image payload registered for a popout window id.
/// The id is parsed from the calling window's label (`popout-<id>`).
/// Each id is single-use; a missing/already-taken id returns `None`.
#[tauri::command]
pub(crate) fn take_popout_image(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Option<PopoutImagePayload> {
    state
        .popout_images
        .lock()
        .ok()
        .and_then(|mut m| m.remove(&id))
}

/// Metadata sent to a screen-share popout window so it can subscribe
/// to the SFU as an independent viewer.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PopoutStreamPayload {
    /// Mumble session of the broadcaster being watched.
    pub broadcaster_session: u32,
    /// Display name of the broadcaster.
    #[serde(default)]
    pub broadcaster_name: Option<String>,
    /// Avatar (data URL) of the broadcaster, if available.
    #[serde(default)]
    pub broadcaster_avatar: Option<String>,
    /// The local user's session, needed to send WebRTC signals.
    pub own_session: u32,
    /// Server connection id that owns the Mumble session.
    pub server_id: String,
    /// Mumble channel the broadcast is happening in.
    pub channel_id: u32,
}

/// Open a borderless, always-on-top window that subscribes to a remote
/// screen share as a separate WebRTC viewer.  Mirrors `open_image_popout`
/// but uses the label prefix `popout-stream-` so the frontend can
/// dispatch to a different page.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn open_stream_popout(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: PopoutStreamPayload,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let session = payload.broadcaster_session;
    if let Ok(mut map) = state.popout_streams.lock() {
        let _ = map.insert(id.clone(), payload);
    }
    let label = format!("popout-stream-{id}");
    // Remember this window so the app-level `on_window_event` handler
    // (in `lib.rs`) can emit `stream-popout-state opened:false` when the
    // OS destroys it - works for every close path (Alt+F4, X button,
    // taskbar close, programmatic close from our context menu).
    if let Ok(mut map) = state.popout_stream_sessions.lock() {
        let _ = map.insert(label.clone(), session);
    }
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("")
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .inner_size(960.0, 540.0)
    .resizable(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn open_stream_popout(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _payload: PopoutStreamPayload,
) -> Result<(), String> {
    Err("Stream popout windows are not supported on Android".to_string())
}

/// Consume and return the stream payload registered for a popout window id.
#[tauri::command]
pub(crate) fn take_popout_stream(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Option<PopoutStreamPayload> {
    state
        .popout_streams
        .lock()
        .ok()
        .and_then(|mut m| m.remove(&id))
}

/// Metadata sent to a direct-message popout window so it can subscribe to
/// the existing DM stream for a specific peer in its own webview.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct PopoutDmPayload {
    /// Saved-server id the target user belongs to.
    pub server_id: String,
    /// Best-effort display label for that server (used for the window title).
    #[serde(default)]
    pub server_label: Option<String>,
    /// Mumble session of the DM partner at the time the popout was opened.
    pub user_session: u32,
    /// Display name of the DM partner.
    pub user_name: String,
    /// TLS certificate hash of the DM partner (stable across reconnects).
    #[serde(default)]
    pub user_hash: Option<String>,
}

/// Open a borderless, always-on-top window dedicated to a single direct
/// message conversation.  Mirrors `open_image_popout` / `open_stream_popout`
/// but uses the label prefix `popout-dm-` so the frontend can dispatch to
/// the DM popout page.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn open_dm_popout(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    payload: PopoutDmPayload,
) -> Result<(), String> {
    let id = uuid::Uuid::new_v4().simple().to_string();
    let title = format!("DM - {}", payload.user_name);
    if let Ok(mut map) = state.popout_dms.lock() {
        let _ = map.insert(id.clone(), payload);
    }
    let label = format!("popout-dm-{id}");
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        &label,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title(title)
    .decorations(false)
    .shadow(false)
    .transparent(false)
    .always_on_top(true)
    .inner_size(420.0, 600.0)
    .resizable(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

/// Android stub: popout windows are a desktop-only feature.
#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn open_dm_popout(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _payload: PopoutDmPayload,
) -> Result<(), String> {
    Err("DM popout windows are not supported on Android".to_string())
}

/// Consume and return the DM payload registered for a popout window id.
#[tauri::command]
pub(crate) fn take_popout_dm(
    state: tauri::State<'_, AppState>,
    id: String,
) -> Option<PopoutDmPayload> {
    state
        .popout_dms
        .lock()
        .ok()
        .and_then(|mut m| m.remove(&id))
}

/// Open the translation helper popout window.
///
/// Single-instance: if a window with label `popout-translation` already
/// exists it is focused instead of spawning a duplicate.  The window is
/// always-on-top so contributors can inspect strings in the main window
/// while editing translations.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn open_translation_popout(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let label = "popout-translation";
    if let Some(win) = app.get_webview_window(label) {
        let _ = win.set_focus();
        return Ok(());
    }
    let _window = tauri::WebviewWindowBuilder::new(
        &app,
        label,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("Translation helper")
    .decorations(false)
    .shadow(false)
    .transparent(false)
    .always_on_top(true)
    .inner_size(820.0, 720.0)
    .min_inner_size(520.0, 480.0)
    .resizable(true)
    .skip_taskbar(false)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn open_translation_popout(_app: tauri::AppHandle) -> Result<(), String> {
    Err("Translation popout is not supported on Android".to_string())
}
