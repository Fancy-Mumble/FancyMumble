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
    theme_path_from(|key| std::env::var_os(key))
}

fn theme_path_from(env: impl Fn(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    if let Some(p) = env("FANCYMUMBLE_THEME_CSS") {
        return Some(PathBuf::from(p));
    }
    let state = env("XDG_STATE_HOME")
        .map(PathBuf::from)
        .or_else(|| env("HOME").map(|h| PathBuf::from(h).join(".local/state")))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;

    fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |key| pairs.iter().find(|(k, _)| *k == key).map(|(_, v)| OsString::from(v))
    }

    #[test]
    fn explicit_override_wins() {
        let path = theme_path_from(env(&[
            ("FANCYMUMBLE_THEME_CSS", "/tmp/x.css"),
            ("XDG_STATE_HOME", "/state"),
        ]));
        assert_eq!(path, Some(PathBuf::from("/tmp/x.css")));
    }

    #[test]
    fn defaults_to_the_omarchy_state_directory() {
        let expected = "omarchy/current/theme/fancymumble.css";
        assert_eq!(
            theme_path_from(env(&[("XDG_STATE_HOME", "/state")])),
            Some(PathBuf::from("/state").join(expected))
        );
        assert_eq!(
            theme_path_from(env(&[("HOME", "/home/u")])),
            Some(PathBuf::from("/home/u/.local/state").join(expected))
        );
        assert_eq!(theme_path_from(env(&[])), None);
    }

    #[test]
    fn reads_the_file_only_when_it_exists() {
        let dir = std::env::temp_dir().join(format!("fancymumble-user-theme-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("theme.css");
        let _ = std::fs::remove_file(&file);

        assert_eq!(std::fs::read_to_string(&file).ok(), None);
        std::fs::write(&file, "[data-theme=\"omarchy\"] {}").unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "[data-theme=\"omarchy\"] {}");
        assert!(std::fs::metadata(&file).and_then(|m| m.modified()).is_ok());

        std::fs::remove_dir_all(&dir).unwrap();
    }
}
