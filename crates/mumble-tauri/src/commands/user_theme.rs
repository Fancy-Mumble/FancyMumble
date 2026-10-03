//! Externally supplied theme overrides.
//!
//! A desktop environment (e.g. Omarchy) can drop a CSS file on disk; the
//! contents are injected into the UI and re-emitted whenever the file
//! changes, so the theme can be hot-swapped while the app is running.
//!
//! Lookup order: `$FANCYMUMBLE_THEME_CSS`, then
//! `$XDG_STATE_HOME/omarchy/current/theme/fancymumble.css`.

use std::path::PathBuf;
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter};

const EVENT_NAME: &str = "user-theme-changed";
const POLL_INTERVAL: Duration = Duration::from_millis(500);

fn theme_path() -> Option<PathBuf> {
    if let Some(p) = std::env::var_os("FANCYMUMBLE_THEME_CSS") {
        return Some(PathBuf::from(p));
    }
    let state = std::env::var_os("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".local/state")))?;
    Some(state.join("omarchy/current/theme/fancymumble.css"))
}

fn read_theme() -> Option<String> {
    std::fs::read_to_string(theme_path()?).ok()
}

fn mtime() -> Option<SystemTime> {
    std::fs::metadata(theme_path()?).and_then(|m| m.modified()).ok()
}

/// Returns the current external theme CSS, if one is present.
#[tauri::command]
pub(crate) fn get_user_theme_css() -> Option<String> {
    read_theme()
}

/// Polls the theme file and emits [`EVENT_NAME`] (payload: CSS or `null`)
/// whenever it appears, changes or disappears.  Polling the path (rather
/// than inotify on the file) survives the atomic directory swaps Omarchy
/// performs when switching themes.
pub(crate) fn spawn_watcher(app: AppHandle) {
    drop(std::thread::spawn(move || {
        let mut last = mtime();
        loop {
            std::thread::sleep(POLL_INTERVAL);
            let now = mtime();
            if now != last {
                last = now;
                let _ = app.emit(EVENT_NAME, read_theme());
            }
        }
    }));
}
