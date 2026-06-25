//! Windows-only WebView2 memory management.
//!
//! The browser process tree dwarfs the Rust backend's heap and by default holds
//! its working set while the app idles minimized or in the tray. We ask WebView2
//! to trim memory while the main window is minimized and restore it on show.

use crate::updater;

/// Window-event hook: trim `WebView2` memory while the main window is
/// minimized; restore normal behaviour when it is shown/focused again.
pub(crate) fn update_webview_memory_target(window: &tauri::Window, event: &tauri::WindowEvent) {
    if window.label() != updater::MAIN_WINDOW_LABEL {
        return;
    }
    match event {
        tauri::WindowEvent::Resized(_) => {
            let minimized = window.is_minimized().unwrap_or(false);
            set_webview_memory_target(window, minimized);
        }
        tauri::WindowEvent::Focused(true) => {
            set_webview_memory_target(window, false);
        }
        _ => {}
    }
}

/// Ask `WebView2` to trim its memory usage while the main window is
/// minimized (`low = true`) and return to normal when shown again.
///
/// `COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW` makes the renderer release
/// caches and unused pages back to the OS.
#[allow(unsafe_code, reason = "WebView2 COM calls on the controller's own event-loop thread, as required by the API")]
fn set_webview_memory_target(window: &tauri::Window, low: bool) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use tauri::Manager;

    // `Resized` fires for every step of an interactive resize; only
    // forward actual level changes to the COM layer.
    static MEMORY_TARGET_LOW: AtomicBool = AtomicBool::new(false);
    if MEMORY_TARGET_LOW.swap(low, Ordering::Relaxed) == low {
        return;
    }

    let Some(webview) = window
        .app_handle()
        .get_webview_window(updater::MAIN_WINDOW_LABEL)
    else {
        return;
    };
    let result = webview.with_webview(move |platform_webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let level = if low {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
        } else {
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
        };
        // SAFETY: the closure runs on the event-loop thread that owns the
        // controller, which is the thread WebView2 COM objects require.
        unsafe {
            let webview2 = match platform_webview.controller().CoreWebView2() {
                Ok(wv) => wv,
                Err(e) => {
                    tracing::debug!("CoreWebView2 unavailable for memory target: {e}");
                    return;
                }
            };
            // Requires WebView2 runtime >= 114 (ICoreWebView2_19); older
            // runtimes simply keep default memory behaviour.
            let Ok(webview19) = webview2.cast::<ICoreWebView2_19>() else {
                return;
            };
            if let Err(e) = webview19.SetMemoryUsageTargetLevel(level) {
                tracing::debug!("SetMemoryUsageTargetLevel failed: {e}");
            } else {
                tracing::debug!(low, "webview memory usage target updated");
            }
        }
    });
    if let Err(e) = result {
        tracing::debug!("with_webview failed for memory target: {e}");
    }
}
