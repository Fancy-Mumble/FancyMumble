//! Where this view keeps its files.

use std::path::PathBuf;

/// The directory name this view uses under the platform's data directory.
///
/// Its own, not the Tauri application's: both keep identities and message
/// keys there, and two programs writing one such directory is how a key gets
/// lost.
const APP_DIR: &str = "fancy-mumble-native";

/// The data directory: `FANCY_GPUI_DATA_DIR` if set, else the platform's
/// place for application data.
pub(crate) fn data_dir() -> PathBuf {
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    data_dir_from(&env, cfg!(target_os = "macos"), cfg!(target_os = "windows"))
}

/// [`data_dir`], with the environment and the platform passed in.
fn data_dir_from(
    env: &dyn Fn(&str) -> Option<std::ffi::OsString>,
    macos: bool,
    windows: bool,
) -> PathBuf {
    if let Some(chosen) = env("FANCY_GPUI_DATA_DIR") {
        return PathBuf::from(chosen);
    }
    let home = || env("HOME").map(PathBuf::from).unwrap_or_default();
    let base = if windows {
        env("APPDATA").map_or_else(home, PathBuf::from)
    } else if macos {
        home().join("Library").join("Application Support")
    } else {
        env("XDG_DATA_HOME").map_or_else(|| home().join(".local").join("share"), PathBuf::from)
    };
    base.join(APP_DIR)
}

#[cfg(test)]
mod tests {
    use std::ffi::OsString;

    use super::*;

    fn env<'a>(vars: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<OsString> + 'a {
        move |name| {
            vars.iter()
                .find(|(key, _)| *key == name)
                .map(|(_, value)| OsString::from(value))
        }
    }

    #[test]
    fn an_explicit_directory_wins() {
        let vars = [("FANCY_GPUI_DATA_DIR", "/tmp/x"), ("HOME", "/home/a")];
        assert_eq!(
            data_dir_from(&env(&vars), false, false),
            PathBuf::from("/tmp/x")
        );
    }

    #[test]
    fn each_platform_gets_its_own_place() {
        let home = [("HOME", "/home/a")];
        assert_eq!(
            data_dir_from(&env(&home), false, false),
            PathBuf::from("/home/a/.local/share/fancy-mumble-native")
        );
        let xdg = [("HOME", "/home/a"), ("XDG_DATA_HOME", "/data")];
        assert_eq!(
            data_dir_from(&env(&xdg), false, false),
            PathBuf::from("/data/fancy-mumble-native")
        );
        assert_eq!(
            data_dir_from(&env(&home), true, false),
            PathBuf::from("/home/a/Library/Application Support/fancy-mumble-native")
        );
        let windows = [("APPDATA", "C:/Users/a/AppData/Roaming")];
        assert_eq!(
            data_dir_from(&env(&windows), false, true),
            PathBuf::from("C:/Users/a/AppData/Roaming/fancy-mumble-native")
        );
    }
}
