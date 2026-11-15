//! Persist window geometry whenever it changes, not only on a clean exit.
//!
//! `tauri-plugin-window-state` keeps a live cache of every tracked window's
//! geometry but only writes it to disk on `RunEvent::Exit`. Anything that ends
//! the process without one - the `tauri dev` watcher killing the app to
//! relaunch it after a Rust change, a crash, a `kill` - drops every move and
//! resize made since the last graceful shutdown, so the next launch restores
//! whatever geometry the window happened to have the last time the app was
//! closed properly.
//!
//! Debouncing a `save_window_state` behind the window's own `Moved` / `Resized`
//! events fixes that at the source: the drag settles, the state hits disk, and
//! how the process dies stops mattering.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use tauri::{Manager, WindowEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

/// Windows whose geometry must not be tracked: the updater has a fixed size
/// set in `updater/window.rs`, and both overlays are positioned over whatever
/// they are following.
pub(crate) const DENYLIST: [&str; 3] = [
    crate::updater::UPDATER_WINDOW_LABEL,
    crate::commands::draw_overlay::DRAW_OVERLAY_LABEL,
    crate::commands::game_overlay::GAME_OVERLAY_LABEL,
];

/// Restore size/position/maximised state, but never visibility - the updater
/// module decides whether the main window should appear on launch.
pub(crate) fn state_flags() -> StateFlags {
    StateFlags::all() & !StateFlags::VISIBLE
}

/// How long the geometry has to hold still before it is written. Long enough
/// that a resize drag writes once instead of once per frame, short enough that
/// a rebuild triggered right after a move still catches it.
const DEBOUNCE: Duration = Duration::from_millis(500);

/// Bumped by every scheduled save; a task whose value has been superseded by a
/// later event returns without writing.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Schedule a debounced save when `event` changed a tracked window's geometry.
///
/// Call from the app-wide `on_window_event` hook.
pub(crate) fn on_window_event(window: &tauri::Window, event: &WindowEvent) {
    if !matches!(event, WindowEvent::Moved(_) | WindowEvent::Resized(_)) {
        return;
    }
    if DENYLIST.contains(&window.label()) {
        return;
    }
    // A hidden window reports the geometry it will have once mapped, not the
    // one the user chose: GTK answers (0, 0) for an unmapped toplevel, which
    // would overwrite a good position with the origin. The main window is
    // hidden for the whole restore-and-updater-check phase of startup, and
    // again whenever it is minimised to the tray.
    if !window.is_visible().unwrap_or(false) {
        return;
    }
    schedule_save(window.app_handle().clone());
}

fn schedule_save(app: tauri::AppHandle) {
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    drop(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(DEBOUNCE).await;
        if GENERATION.load(Ordering::SeqCst) != generation {
            // Superseded: a later event owns the write.
            return;
        }
        if let Err(e) = app.save_window_state(state_flags()) {
            tracing::warn!("Failed to persist window state: {e}");
        }
    }));
}
