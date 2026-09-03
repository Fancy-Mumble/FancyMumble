//! The overlay window itself: how it is built, where it goes, and how it is
//! shown and hidden.
//!
//! The flags are the whole safety argument, so they are listed here rather
//! than scattered:
//!
//! - `always_on_top` puts it over a borderless game (`WS_EX_TOPMOST`).
//! - `focusable(false)` maps to `WS_EX_NOACTIVATE`, so clicking near it or
//!   showing it can never pull keyboard focus out of the game.
//! - `set_ignore_cursor_events(true)` maps to `WS_EX_TRANSPARENT |
//!   WS_EX_LAYERED`, so the mouse passes straight through.
//! - `skip_taskbar` and `decorations(false)` keep it out of Alt-Tab and off
//!   the taskbar.
//! - `set_excluded_from_capture` keeps it out of the user's own stream.
//!
//! The one thing deliberately *not* copied from the drawing overlay is its
//! placement: that window covers the captured monitor, and a topmost,
//! layered, transparent window the size of the game's client area is the
//! exact shape anti-cheat overlay scanners look for. This one is a widget in
//! a corner and is hidden outright when it has nothing to say.

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

use super::{OverlayCorner, DEFAULT_HEIGHT, DEFAULT_WIDTH};
use crate::platform::window::WindowExt;

/// Stable label for the (single) game-overlay window.
pub(crate) const GAME_OVERLAY_LABEL: &str = "game-overlay";

/// Gap between the widget and the edges of the monitor, in logical pixels.
const MARGIN: f64 = 16.0;

/// Get the overlay window, creating it if it does not exist yet.
///
/// Created **visible**, which looks wrong for a window that spends most of its
/// life hidden. It is not: a transparent `WebView2` window created hidden and
/// shown later comes back blank on this stack - the same failure the main
/// window hits when it is restored from the taskbar. So the window is born
/// visible, paints once, and only then starts being hidden (see the watcher's
/// `ready` gate). It costs nothing while it does: the page renders nothing
/// until there is something to say, so an empty transparent window is
/// invisible either way.
pub(super) fn ensure(app: &AppHandle, hide_from_capture: bool) -> Result<WebviewWindow, String> {
    if let Some(existing) = app.get_webview_window(GAME_OVERLAY_LABEL) {
        return Ok(existing);
    }

    let window = tauri::WebviewWindowBuilder::new(
        app,
        GAME_OVERLAY_LABEL,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("")
    .inner_size(DEFAULT_WIDTH, DEFAULT_HEIGHT)
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focusable(false)
    .visible_on_all_workspaces(true)
    .build()
    .map_err(|e: tauri::Error| e.to_string())?;

    if let Err(e) = window.set_ignore_cursor_events(true) {
        tracing::warn!("game-overlay: set_ignore_cursor_events failed: {e}");
    }
    if hide_from_capture {
        if let Err(e) = window.set_excluded_from_capture(true) {
            tracing::info!("game-overlay: capture exclusion not applied: {e}");
        }
    }
    crate::platform::strip_system_chrome(&window);

    tracing::info!("game-overlay: window created");
    Ok(window)
}

/// Put the widget in its corner of `monitor`, at the size the page asked for.
///
/// Physical pixels throughout: the builder's coordinates are logical, and
/// guessing which monitor's scale factor applies is exactly the mistake the
/// drawing overlay's placement comment warns about.
pub(super) fn place(
    window: &WebviewWindow,
    corner: OverlayCorner,
    monitor: fancy_gamedetect::Rect,
    logical_size: (f64, f64),
) {
    let scale = window.scale_factor().unwrap_or(1.0);
    let to_physical = |value: f64| (value * scale).round() as i32;

    let width = to_physical(logical_size.0).max(1);
    let height = to_physical(logical_size.1).max(1);
    let margin = to_physical(MARGIN);

    let x = match corner {
        OverlayCorner::TopLeft | OverlayCorner::BottomLeft => monitor.x + margin,
        OverlayCorner::TopRight | OverlayCorner::BottomRight => {
            monitor.x + monitor.w - width - margin
        }
    };
    let y = match corner {
        OverlayCorner::TopLeft | OverlayCorner::TopRight => monitor.y + margin,
        OverlayCorner::BottomLeft | OverlayCorner::BottomRight => {
            monitor.y + monitor.h - height - margin
        }
    };

    // Only move it when it is actually wrong. Called every tick, so an
    // unconditional set_position would fight anything else that touches the
    // window and would repaint it twice a second for no reason.
    // Compared against the *inner* size because that is what `set_size` sets;
    // measuring the outer one and setting the inner is a mismatch that either
    // thrashes the window every tick or never corrects it at all.
    let size = PhysicalSize::new(width as u32, height as u32);
    if window.inner_size().is_ok_and(|actual| actual != size) {
        let _ = window.set_size(size);
    }
    let position = PhysicalPosition::new(x, y);
    if window
        .outer_position()
        .is_ok_and(|actual| actual != position)
    {
        let _ = window.set_position(position);
    }
}

/// Show the overlay without letting it steal focus.
pub(super) fn show(window: &WebviewWindow) {
    if let Err(e) = window.show() {
        tracing::warn!("game-overlay: show failed: {e}");
    }
    // `always_on_top` is set at build time, but a game that re-asserts its own
    // topmost z-order can end up above us; re-asserting on each transition is
    // cheap and is what every overlay of this kind does.
    let _ = window.set_always_on_top(true);
}

/// Hide the overlay.
///
/// A real hide, not transparency: a window DWM is not compositing is a window
/// that cannot cost the game its independent flip path, and a hidden window is
/// not enumerated as a visible topmost layered window either.
pub(super) fn hide(window: &WebviewWindow) {
    if let Err(e) = window.hide() {
        tracing::warn!("game-overlay: hide failed: {e}");
    }
}

/// Whether the window exists and is actually on screen right now.
///
/// The diagnostics panel asks the window itself rather than the policy: a
/// panel that reports what the watcher *intended* cannot tell "showing" from
/// "tried to show and the window was never built".
pub(super) fn actual_state(app: &AppHandle) -> (bool, bool) {
    match app.get_webview_window(GAME_OVERLAY_LABEL) {
        Some(win) => (true, win.is_visible().unwrap_or(false)),
        None => (false, false),
    }
}

/// Destroy the overlay window, freeing its webview process.
pub(super) fn close(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(GAME_OVERLAY_LABEL) {
        let _ = window.close();
        tracing::info!("game-overlay: window closed");
    }
}
