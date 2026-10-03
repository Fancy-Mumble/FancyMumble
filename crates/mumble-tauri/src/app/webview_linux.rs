//! Linux-only `WebKitGTK` webview settings.
//!
//! `WebKitGTK` ships with `enable-webrtc` and `enable-media-stream` switched
//! OFF, and wry never turns them on - so Linux webviews simply had no
//! `RTCPeerConnection` / `MediaStream` constructors at all. The whole stream
//! VIEWER layer runs on those (SFU viewers for other broadcasters and the
//! broadcaster's own loopback preview): `startWatching` threw on its first
//! line, visible only in the webview console, and every own share sat in
//! "Setting up stream..." forever while the Rust broadcaster (webrtc-rs,
//! portal, NVENC) connected fine underneath.
//!
//! Applied per webview right after creation, before its first document
//! finishes loading - `WebKit` decides the constructors a window object
//! exposes per document, so flipping the settings later would need a reload.
//!
//! Caveat: the settings only surface what the `WebKit` BUILD contains. Most
//! distro builds (Ubuntu's included) compile `WebRTC` out entirely
//! (`ENABLE_WEB_RTC=OFF`; no `GstWebRTC` backend linked), in which case
//! `RTCPeerConnection` stays undefined no matter what - the frontend detects
//! that and degrades (no local preview / remote viewers, broadcast itself
//! unaffected). `enable-media-stream` does take effect there, which the
//! viewer layer needs the day the platform can do `WebRTC`.

use std::cell::Cell;
use std::time::{Duration, Instant};

/// A web process that dies again this soon after a reload is crash-looping;
/// reloading once more would only spin.
const RELOAD_BACKOFF: Duration = Duration::from_secs(30);

/// Configure every webview window that exists at setup time (the main
/// window; popouts run [`configure_webview`] individually on creation).
pub(crate) fn configure_startup_webviews(app: &tauri::App) {
    use tauri::Manager;
    for window in app.webview_windows().values() {
        configure_webview(window);
    }
}

/// Enable WebRTC (and the `MediaStream` API the viewer builds its streams
/// with) on one webview window, and reload it if its web process exits.
/// Best effort: on failure the window still works, minus stream viewing,
/// and says why in the log.
pub(crate) fn configure_webview(window: &tauri::WebviewWindow) {
    let label = window.label().to_owned();
    let result = window.with_webview(move |platform_webview| {
        use webkit2gtk::{SettingsExt, WebViewExt};
        let webview = platform_webview.inner();
        reload_when_web_process_exits(&webview, label.clone());
        let Some(settings) = webview.settings() else {
            tracing::warn!(%label, "webkit settings unavailable; WebRTC stays off");
            return;
        };
        settings.set_enable_webrtc(true);
        settings.set_enable_media_stream(true);
        // Dev builds: mirror the webview console into the terminal - webview
        // failures (e.g. in the native stream view's WebCodecs path) are
        // otherwise invisible next to the Rust logs.
        if cfg!(debug_assertions) {
            settings.set_enable_write_console_messages_to_stdout(true);
        }
        tracing::info!(%label, "webkit webview: WebRTC + MediaStream enabled");
    });
    if let Err(e) = result {
        tracing::warn!("configuring a webview failed: {e}");
    }
}

/// The windows are transparent, so a webview whose web process has gone
/// draws nothing at all: the window turns invisible while the backend (and
/// any voice session) keeps running. Reloading starts a fresh web process.
fn reload_when_web_process_exits(webview: &webkit2gtk::WebView, label: String) {
    use webkit2gtk::WebViewExt;
    let last_reload: Cell<Option<Instant>> = Cell::new(None);
    let _ = webview.connect_web_process_terminated(move |webview, reason| {
        if last_reload.get().is_some_and(|t| t.elapsed() < RELOAD_BACKOFF) {
            tracing::error!(%label, ?reason, "webkit web process exited again right after a reload; not reloading");
            return;
        }
        tracing::error!(%label, ?reason, "webkit web process exited; reloading the page");
        last_reload.set(Some(Instant::now()));
        webview.reload();
    });
}
