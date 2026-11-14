//! Where this view keeps its files.

use std::path::PathBuf;

/// The directory name this view uses under the platform's data directory.
///
/// Its own, not the Tauri application's: both keep identities and message
/// keys there, and two programs writing one such directory is how a key gets
/// lost.
const APP_DIR: &str = "fancy-mumble-native";

/// The directory the platform gave ([`choose`]), where the environment
/// names none: an Android app's files directory.
static CHOSEN: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

/// Keeps the view's files in `dir` (the first choice holds).
pub(crate) fn choose(dir: PathBuf) {
    let _ = CHOSEN.set(dir);
}

/// The data directory: `FANCY_GPUI_DATA_DIR` if set, else the one the
/// platform gave ([`choose`]), else the platform's place for application data.
pub(crate) fn data_dir() -> PathBuf {
    if std::env::var_os("FANCY_GPUI_DATA_DIR").is_none()
        && let Some(dir) = CHOSEN.get()
    {
        return dir.join(APP_DIR);
    }
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    data_dir_from(&env, cfg!(target_os = "macos"), cfg!(target_os = "windows"))
}

/// The directory name the web client uses under the same place: its
/// application identifier.
const WEB_CLIENT_DIR: &str = "com.fancymumble.app";

/// The data directory of the web client on this computer, if it has one:
/// where what it holds can be brought over from.
///
/// `FANCY_GPUI_IMPORT_FROM` names another directory to read. A run whose
/// own directory was chosen by `FANCY_GPUI_DATA_DIR` is a test or a look
/// at something, and is not offered the user's real data unless told to.
pub(crate) fn other_install() -> Option<PathBuf> {
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    let dir = other_install_from(&env, cfg!(target_os = "macos"), cfg!(target_os = "windows"))?;
    dir.is_dir().then_some(dir)
}

/// [`other_install`], with the environment and the platform passed in,
/// and without looking whether the directory is there.
fn other_install_from(
    env: &dyn Fn(&str) -> Option<std::ffi::OsString>,
    macos: bool,
    windows: bool,
) -> Option<PathBuf> {
    if let Some(chosen) = env("FANCY_GPUI_IMPORT_FROM") {
        return Some(PathBuf::from(chosen));
    }
    if env("FANCY_GPUI_DATA_DIR").is_some() {
        return None;
    }
    data_dir_from(env, macos, windows)
        .parent()
        .map(|base| base.join(WEB_CLIENT_DIR))
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
    fn the_web_client_is_looked_for_beside_this_one_unless_this_run_is_a_test() {
        let windows = [("APPDATA", "C:/Users/a/AppData/Roaming")];
        assert_eq!(
            other_install_from(&env(&windows), false, true),
            Some(PathBuf::from(
                "C:/Users/a/AppData/Roaming/com.fancymumble.app"
            ))
        );
        let home = [("HOME", "/home/a")];
        assert_eq!(
            other_install_from(&env(&home), false, false),
            Some(PathBuf::from("/home/a/.local/share/com.fancymumble.app"))
        );
        // A run with a directory of its own is not shown the user's data,
        let scratch = [("FANCY_GPUI_DATA_DIR", "/tmp/x"), ("HOME", "/home/a")];
        assert_eq!(other_install_from(&env(&scratch), false, false), None);
        // unless it is told where to read.
        let told = [
            ("FANCY_GPUI_DATA_DIR", "/tmp/x"),
            ("FANCY_GPUI_IMPORT_FROM", "/tmp/other"),
        ];
        assert_eq!(
            other_install_from(&env(&told), false, false),
            Some(PathBuf::from("/tmp/other"))
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
