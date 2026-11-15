//! Keeping a test instance off the user's own data (`FANCY_E2E_DATA_DIR`).
//!
//! With the variable set, every store the client keeps goes under that one
//! directory: the plugin-store files (saved servers, preferences, profiles),
//! identities and keys, the window geometry, the logs and the web view's own
//! data. Without it, nothing here changes anything.
//!
//! Tauri's path API cannot be pointed elsewhere on Windows (it asks the OS
//! for its known folders), so each store that goes through it is redirected
//! by name here. The web view is pointed through the environment it reads
//! before it starts: `WEBVIEW2_USER_DATA_FOLDER` on Windows, the XDG
//! directories on Linux (which also take Tauri's own paths and the desktop
//! entry with them). macOS's web view keeps its data per bundle and cannot be
//! pointed, so there a client started with the variable refuses to start.

use std::path::{Path, PathBuf};

/// Where an isolated instance keeps everything.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Isolation {
    root: PathBuf,
}

impl Isolation {
    /// The isolation the environment asks for, if it asks for one.
    pub(crate) fn from_env() -> Option<Self> {
        crate::state::host::data_dir_override().map(Self::new)
    }

    pub(crate) fn new(root: PathBuf) -> Self {
        Self { root }
    }

    /// The directory the plugin-store files live in, beside the identities;
    /// the same one the e2e harness hands the web UI.
    pub(crate) fn store_dir(&self) -> &Path {
        &self.root
    }

    /// The window-state plugin's file.
    pub(crate) fn window_state_file(&self) -> PathBuf {
        self.root.join(".window-state.json")
    }

    /// Where log files go.
    pub(crate) fn log_dir(&self) -> PathBuf {
        self.root.join("logs")
    }

    /// The environment to set before anything starts, for `os` (as
    /// [`std::env::consts::OS`] names it): what points the web view, and on
    /// Linux everything else Tauri resolves, under the root. A variable that
    /// is already set is left to whoever set it.
    pub(crate) fn process_env(&self, os: &str) -> Vec<(&'static str, PathBuf)> {
        match os {
            "windows" => vec![("WEBVIEW2_USER_DATA_FOLDER", self.root.join("webview2"))],
            "linux" => vec![
                ("XDG_DATA_HOME", self.root.join("xdg").join("data")),
                ("XDG_CONFIG_HOME", self.root.join("xdg").join("config")),
                ("XDG_CACHE_HOME", self.root.join("xdg").join("cache")),
            ],
            _ => Vec::new(),
        }
    }
}

/// Why a client on `os` cannot be isolated, if it cannot.
pub(crate) fn refusal(os: &str) -> Option<&'static str> {
    match os {
        "windows" | "linux" => None,
        _ => Some(
            "FANCY_E2E_DATA_DIR is set, but on this system the web view keeps its data \
             (local storage, cookies) where it cannot be pointed elsewhere, so a test \
             instance would share it with the real client. Refusing to start.",
        ),
    }
}

/// The directory the web UI should keep its plugin-store files in, when this
/// instance is isolated; nothing otherwise.
#[tauri::command]
pub(crate) fn isolated_store_dir() -> Option<String> {
    Isolation::from_env().map(|isolation| isolation.store_dir().to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn isolation() -> Isolation {
        Isolation::new(PathBuf::from("/tmp/e2e-7/store"))
    }

    #[test]
    fn every_store_resolves_under_the_root() {
        let isolation = isolation();
        let root = Path::new("/tmp/e2e-7/store");
        assert_eq!(isolation.store_dir(), root);
        assert!(isolation.window_state_file().starts_with(root));
        assert!(isolation.log_dir().starts_with(root));
        for os in ["windows", "linux"] {
            let env = isolation.process_env(os);
            assert!(!env.is_empty(), "{os} points its web view somewhere");
            assert!(env.iter().all(|(_, dir)| dir.starts_with(root)), "{os}: {env:?}");
        }
    }

    #[test]
    fn the_web_view_is_pointed_by_what_each_system_reads() {
        let names = |os| {
            isolation()
                .process_env(os)
                .into_iter()
                .map(|(name, _)| name)
                .collect::<Vec<_>>()
        };
        assert_eq!(names("windows"), ["WEBVIEW2_USER_DATA_FOLDER"]);
        assert!(names("linux").contains(&"XDG_DATA_HOME"));
    }

    #[test]
    fn a_system_whose_web_view_cannot_be_pointed_refuses() {
        assert_eq!(refusal("windows"), None);
        assert_eq!(refusal("linux"), None);
        assert!(refusal("macos").is_some());
    }

    #[test]
    fn the_window_state_file_is_absolute_so_the_plugin_does_not_join_it_to_its_own_dir() {
        // The plugin joins the name to the app config dir; `join` keeps an
        // absolute path as it is, which is what makes this redirect work.
        let file = isolation().window_state_file();
        assert_eq!(Path::new("/real/config").join(&file), file);
    }
}
