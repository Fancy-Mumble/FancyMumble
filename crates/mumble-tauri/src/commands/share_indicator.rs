//! The "you are sharing" indicator: a thin red bar pinned to the TOP EDGE of
//! the shared screen or window itself (not the app's chrome), replacing
//! Windows' yellow capture border.
//!
//! Properties of the bar window:
//! - **Click-through** - pointer events pass to whatever is underneath.
//! - **Always-on-top** and undecorated; just a red strip.
//! - **Excluded from capture** (`WDA_EXCLUDEFROMCAPTURE`) so viewers never
//!   see it in the stream.
//! - For WINDOW shares it follows the source window (cheap `GetWindowRect`
//!   polling by HWND - the source id IS the HWND) and hides while the
//!   window is minimized. Screen shares are static.
//!
//! Opened/closed by the broadcast lifecycle in `commands::screenshare`; at
//! most one indicator exists per process (reopening replaces it).

#![allow(
    unsafe_code,
    reason = "GetMonitorInfoW/GetWindowRect/IsIconic are raw Win32 calls; \
              each validates its handle internally and every unsafe block \
              is a single such call."
)]

#[cfg(not(target_os = "android"))]
use crate::platform::window::WindowExt;
use fancy_screenshare::SourceKind;

/// Stable label of the (single) indicator window.
pub(crate) const SHARE_INDICATOR_LABEL: &str = "share-indicator";

/// Bar thickness in physical pixels.
const BAR_HEIGHT_PX: u32 = 4;

/// Poll cadence for following a shared window around the desktop.
#[cfg(target_os = "windows")]
const TRACK_INTERVAL: std::time::Duration = std::time::Duration::from_millis(300);

/// Handle of the window-follow task, so a replace/close can stop it.
fn tracker_slot() -> &'static std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>> {
    static SLOT: std::sync::OnceLock<
        std::sync::Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    > = std::sync::OnceLock::new();
    SLOT.get_or_init(|| std::sync::Mutex::new(None))
}

fn abort_tracker() {
    if let Ok(mut slot) = tracker_slot().lock() {
        if let Some(handle) = slot.take() {
            handle.abort();
        }
    }
}

/// Physical-pixel rectangle of a capture source (x, y, w, h).
#[cfg(target_os = "windows")]
fn source_rect(kind: SourceKind, id: u32) -> Option<(i32, i32, u32, u32)> {
    use windows_sys::Win32::Foundation::RECT;
    use windows_sys::Win32::Graphics::Gdi::{GetMonitorInfoW, HMONITOR, MONITORINFO};
    use windows_sys::Win32::UI::WindowsAndMessaging::{GetWindowRect, IsIconic};

    match kind {
        SourceKind::Screen => {
            // The source enumeration reports HMONITOR values as screen ids.
            let hmon = id as usize as HMONITOR;
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..unsafe { std::mem::zeroed() }
            };
            // SAFETY: GetMonitorInfoW validates the handle internally.
            if unsafe { GetMonitorInfoW(hmon, &mut info) } == 0 {
                return None;
            }
            let r = info.rcMonitor;
            Some((r.left, r.top, (r.right - r.left).max(1) as u32, (r.bottom - r.top).max(1) as u32))
        }
        SourceKind::Window => {
            // The source enumeration reports HWND values as window ids.
            let hwnd = id as usize as windows_sys::Win32::Foundation::HWND;
            // SAFETY: IsIconic/GetWindowRect validate the handle internally.
            if unsafe { IsIconic(hwnd) } != 0 {
                return None; // minimized: nothing to pin the bar to
            }
            let mut r: RECT = unsafe { std::mem::zeroed() };
            if unsafe { GetWindowRect(hwnd, &mut r) } == 0 {
                return None;
            }
            Some((r.left, r.top, (r.right - r.left).max(1) as u32, (r.bottom - r.top).max(1) as u32))
        }
    }
}

#[cfg(all(not(target_os = "android"), not(target_os = "windows")))]
fn source_rect(_kind: SourceKind, _id: u32) -> Option<(i32, i32, u32, u32)> {
    // Non-Windows: no cheap by-id rect lookup wired up yet; the indicator
    // simply does not show (the broadcast itself is unaffected).
    None
}

/// Open (or replace) the indicator bar over the given capture source.
/// Best-effort: failures are logged, never propagated - an indicator must
/// not be able to break a broadcast.
#[cfg(not(target_os = "android"))]
pub(crate) fn open(app: &tauri::AppHandle, kind: SourceKind, id: u32) {
    use tauri::Manager;

    abort_tracker();
    if let Some(existing) = app.get_webview_window(SHARE_INDICATOR_LABEL) {
        let _ = existing.close();
    }

    let Some((x, y, w, _h)) = source_rect(kind, id) else {
        tracing::info!("share-indicator: source rect unavailable; indicator skipped");
        return;
    };

    let url: tauri::Url = match "about:blank".parse() {
        Ok(u) => u,
        Err(e) => {
            tracing::warn!("share-indicator: url parse failed: {e}");
            return;
        }
    };
    let window = match tauri::WebviewWindowBuilder::new(
        app,
        SHARE_INDICATOR_LABEL,
        tauri::WebviewUrl::External(url),
    )
    .title("")
    .decorations(false)
    .shadow(false)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false)
    // Solid "sharing red"; the page is about:blank so the window's own
    // background colour is all that renders.
    .background_color(tauri::window::Color(237, 66, 69, 255))
    .build()
    {
        Ok(win) => win,
        Err(e) => {
            tracing::warn!("share-indicator: window creation failed: {e}");
            return;
        }
    };

    // Exact physical placement (builder positions are logical; setting
    // physical afterwards avoids scale-factor guesswork entirely).
    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
    let _ = window.set_size(tauri::PhysicalSize::new(w, BAR_HEIGHT_PX));

    if let Err(e) = window.set_ignore_cursor_events(true) {
        tracing::warn!("share-indicator: click-through failed: {e}");
    }
    if let Err(e) = window.set_excluded_from_capture(true) {
        // Without the exclusion the bar would show up INSIDE the stream -
        // worse than no bar. Tear it down.
        tracing::warn!("share-indicator: capture exclusion failed ({e}); removing bar");
        let _ = window.close();
        return;
    }

    spawn_window_tracker(kind, id, window);
}

/// Follow a shared WINDOW around the desktop (move/resize/minimize).
#[cfg(target_os = "windows")]
fn spawn_window_tracker(kind: SourceKind, id: u32, window: tauri::WebviewWindow) {
    if kind != SourceKind::Window {
        return; // monitors do not move
    }
    let handle = tauri::async_runtime::spawn(async move {
        let mut visible = true;
        loop {
            tokio::time::sleep(TRACK_INTERVAL).await;
            match source_rect(kind, id) {
                Some((x, y, w, _h)) => {
                    if !visible {
                        let _ = window.show();
                        visible = true;
                    }
                    let _ = window.set_position(tauri::PhysicalPosition::new(x, y));
                    let _ = window.set_size(tauri::PhysicalSize::new(w, BAR_HEIGHT_PX));
                }
                None => {
                    // Minimized or gone: hide rather than float in space.
                    if visible {
                        let _ = window.hide();
                        visible = false;
                    }
                }
            }
        }
    });
    if let Ok(mut slot) = tracker_slot().lock() {
        *slot = Some(handle);
    }
}

#[cfg(all(not(target_os = "android"), not(target_os = "windows")))]
fn spawn_window_tracker(_kind: SourceKind, _id: u32, _window: tauri::WebviewWindow) {}

/// Close the indicator bar, if any.
#[cfg(not(target_os = "android"))]
pub(crate) fn close(app: &tauri::AppHandle) {
    use tauri::Manager;

    abort_tracker();
    if let Some(existing) = app.get_webview_window(SHARE_INDICATOR_LABEL) {
        let _ = existing.close();
    }
}

#[cfg(target_os = "android")]
pub(crate) fn open(_app: &tauri::AppHandle, _kind: SourceKind, _id: u32) {}

#[cfg(target_os = "android")]
pub(crate) fn close(_app: &tauri::AppHandle) {}
