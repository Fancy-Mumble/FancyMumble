//! The desktop entry that gives the window its icon on Wayland.
//!
//! A Wayland compositor has no window icon to read: it looks up the desktop
//! entry named after the window's application id and draws that entry's
//! icon, and without one GNOME shows a generic one. An installed package
//! ships the entry; a build run from where it was built has none, so the
//! view writes its own into the user's data directory (`$XDG_DATA_HOME`):
//! the entry, and the icon it names under `icons/hicolor`.
//!
//! An entry the view did not write is never touched: one in a system data
//! directory is a package's, and one in the user's without [`MARK`] is the
//! user's own.

use std::path::{Path, PathBuf};

use crate::assets::APP_ICON;

/// The key that tells an entry this view wrote from any other.
const MARK: &str = "X-Fancy-Native=true";

/// Writes the entry and its icon if this computer has no entry for `app_id`
/// yet, or rewrites the one the view wrote when the program moved. A
/// failure is reported and does nothing else: the window opens all the same.
pub(crate) fn ensure(app_id: &str) {
    if std::env::var_os("FANCY_GPUI_DESKTOP_ENTRY").is_some_and(|value| value == "off") {
        return;
    }
    let env = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    let Some(home) = data_home(&env) else {
        return;
    };
    let name = format!("{app_id}.desktop");
    if system_dirs(&env).iter().any(|dir| dir.join("applications").join(&name).exists()) {
        return;
    }
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => {
            eprintln!("the desktop entry is not written: {error}");
            return;
        }
    };
    let entry_path = home.join("applications").join(&name);
    let existing = std::fs::read_to_string(&entry_path).ok();
    if existing.as_deref().is_some_and(|text| !text.lines().any(|line| line == MARK)) {
        return;
    }
    let icon_path = home.join(format!("icons/hicolor/128x128/apps/{app_id}.png"));
    let entry = entry(app_id, &exe);
    for (path, contents) in [(&icon_path, APP_ICON), (&entry_path, entry.as_bytes())] {
        if let Err(error) = write_if_changed(path, contents) {
            eprintln!("the desktop entry is not written: {}: {error}", path.display());
            return;
        }
    }
}

/// `$XDG_DATA_HOME`, else `~/.local/share`.
fn data_home(env: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> Option<PathBuf> {
    env("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| env("HOME").map(|home| PathBuf::from(home).join(".local/share")))
}

/// `$XDG_DATA_DIRS`, else what the specification says it defaults to.
fn system_dirs(env: &dyn Fn(&str) -> Option<std::ffi::OsString>) -> Vec<PathBuf> {
    let dirs = env("XDG_DATA_DIRS").unwrap_or_else(|| "/usr/local/share:/usr/share".into());
    std::env::split_paths(&dirs).filter(|dir| dir.is_absolute()).collect()
}

/// The entry's text.
fn entry(app_id: &str, exe: &Path) -> String {
    format!(
        "[Desktop Entry]\n\
         Type=Application\n\
         Name=Fancy Mumble\n\
         GenericName=Mumble Client\n\
         Comment=Mumble voice chat, drawn natively\n\
         Exec={exec}\n\
         Icon={app_id}\n\
         Terminal=false\n\
         StartupWMClass={app_id}\n\
         Categories=Network;Chat;AudioVideo;\n\
         {MARK}\n",
        exec = quoted(&exe.to_string_lossy()),
    )
}

/// An `Exec` argument, quoted as the desktop entry specification asks.
fn quoted(arg: &str) -> String {
    let mut out = String::with_capacity(arg.len() + 2);
    out.push('"');
    for c in arg.chars() {
        match c {
            '"' | '`' | '$' | '\\' => out.push_str(&format!("\\\\{c}")),
            '%' => out.push_str("%%"),
            _ => out.push(c),
        }
    }
    out.push('"');
    out
}

fn write_if_changed(path: &Path, contents: &[u8]) -> std::io::Result<()> {
    if std::fs::read(path).is_ok_and(|old| old == contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temporary = path.with_extension("tmp");
    std::fs::write(&temporary, contents)?;
    std::fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_path_is_quoted_and_escaped() {
        assert_eq!(quoted("/opt/fancy mumble/bin"), "\"/opt/fancy mumble/bin\"");
        // The string escape and then the entry's own: `\$` is written `\\$`.
        assert_eq!(quoted("/a$b"), "\"/a\\\\$b\"");
        assert_eq!(quoted("/100%"), "\"/100%%\"");
    }

    #[test]
    fn the_entry_names_the_icon_after_the_app_id_and_carries_the_mark() {
        let text = entry("fancy-mumble", Path::new("/usr/bin/fancy-gpui"));
        assert!(text.lines().any(|line| line == "Icon=fancy-mumble"));
        assert!(text.lines().any(|line| line == "Exec=\"/usr/bin/fancy-gpui\""));
        assert!(text.lines().any(|line| line == MARK));
    }

    #[test]
    fn the_data_home_falls_back_to_the_home_directory() {
        let env = |name: &str| (name == "HOME").then(|| "/home/u".into());
        assert_eq!(data_home(&env), Some(PathBuf::from("/home/u/.local/share")));
        let env = |name: &str| (name == "XDG_DATA_DIRS").then(|| "relative:/usr/share".into());
        assert_eq!(system_dirs(&env), vec![PathBuf::from("/usr/share")]);
    }
}
