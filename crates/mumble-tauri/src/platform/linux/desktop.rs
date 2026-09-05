//! GNOME / Linux desktop integration.
//!
//! - Installs a `.desktop` file so GNOME shows the correct app name and icon.
//! - Installs the app icon into the user icon theme.
//! - Provides quick-action IPC via a Unix domain socket so `.desktop` actions
//!   (Mute, Deafen, Disconnect) can reach the running instance.

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};

use tauri::Manager;
use tracing::{info, warn};

use crate::state::AppState;

/// XDG base directory for application launchers.
const APPLICATIONS_DIR: &str = "applications";
/// The user's copy of the hicolor icon theme, where our icon is installed.
const ICON_THEME_DIR: &str = "icons/hicolor";
/// Desktop file name (must match the GTK application ID).
const DESKTOP_FILE_NAME: &str = "com.fancymumble.app.desktop";
/// Desktop file name for a build running straight out of `target/`.
///
/// A separate file, so a working copy and an installed Fancy Mumble - a
/// Flatpak, a `.deb`, the AUR package - show up as two clearly different
/// launcher entries instead of two identical ones.
const DEV_DESKTOP_FILE_NAME: &str = "com.fancymumble.app.dev.desktop";
/// Icon name (without extension) referenced by the desktop file.
const ICON_NAME: &str = "com.fancymumble.app";

/// Socket file name placed inside `$XDG_RUNTIME_DIR`.
const SOCKET_NAME: &str = "com.fancymumble.app.sock";

// -- Desktop file template ------------------------------------------------

/// Is this binary running out of a cargo build directory?
///
/// `cfg!(debug_assertions)` is the wrong test: a local `cargo build --release`
/// is still a working copy, and that is precisely the case that used to install
/// a launcher entry indistinguishable from a packaged one. The install path is
/// what actually separates them - a packaged build lives in `/usr/bin`,
/// `/app/bin` or an `AppImage` mount, never in `target/`.
fn is_dev_build(exec_path: &str) -> bool {
    exec_path.contains("/target/debug/") || exec_path.contains("/target/release/")
}


/// Render the `.desktop` file contents.
///
/// `exec_path` is substituted into the `Exec` lines so that quick actions
/// work regardless of where the binary is installed. `dev` marks the entry as
/// a working copy so it is tellable apart from an installed Fancy Mumble.
fn desktop_file_contents(exec_path: &str, dev: bool) -> String {
    let name = if dev {
        "Fancy Mumble (Dev)"
    } else {
        "Fancy Mumble"
    };
    format!(
        "\
[Desktop Entry]
Type=Application
Name={name}
GenericName=Mumble Client
Comment=Modern Mumble voice chat client
Exec={exec_path} %U
Icon={ICON_NAME}
Terminal=false
StartupWMClass=com.fancymumble.app
Categories=Network;Chat;AudioVideo;
Keywords=mumble;voip;voice;chat;
Actions=mute;deafen;disconnect;

[Desktop Action mute]
Name=Toggle Mute
Exec={exec_path} --action mute

[Desktop Action deafen]
Name=Toggle Deafen
Exec={exec_path} --action deafen

[Desktop Action disconnect]
Name=Disconnect
Exec={exec_path} --action disconnect
"
    )
}

// -- XDG helpers ----------------------------------------------------------

/// `$XDG_DATA_HOME` or `~/.local/share`.
fn xdg_data_home() -> Option<PathBuf> {
    std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .or_else(|| dirs_fallback("/.local/share"))
}

/// `$XDG_RUNTIME_DIR` or `/run/user/<uid>`.
fn xdg_runtime_dir() -> PathBuf {
    std::env::var_os("XDG_RUNTIME_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("/tmp"))
}

/// Fallback that appends `suffix` to `$HOME`.
fn dirs_fallback(suffix: &str) -> Option<PathBuf> {
    std::env::var_os("HOME").map(|h| {
        let mut p = PathBuf::from(h);
        p.push(suffix.trim_start_matches('/'));
        p
    })
}

// -- Desktop file & icon installation -------------------------------------

/// Install (or update) the `.desktop` file and the app icon.
///
/// Called once during `setup`.  Files are written to the per-user XDG
/// directories so no root privileges are required.
pub fn install_desktop_entry() {
    let Some(data_home) = xdg_data_home() else {
        warn!("Could not determine XDG_DATA_HOME; skipping desktop file install");
        return;
    };

    // Resolve the path to the running binary for Exec lines.
    let exec_path = match std::env::current_exe().and_then(std::fs::canonicalize) {
        Ok(p) => p.to_string_lossy().to_string(),
        Err(e) => {
            warn!("Could not determine executable path: {e}");
            // Fall back to bare binary name; it must be on $PATH.
            "mumble-tauri".to_string()
        }
    };

    // -- .desktop file ---------------------------------------------------
    let apps_dir = data_home.join(APPLICATIONS_DIR);
    if let Err(e) = std::fs::create_dir_all(&apps_dir) {
        warn!("Failed to create {}: {e}", apps_dir.display());
        return;
    }

    let dev = is_dev_build(&exec_path);
    let desktop_path = apps_dir.join(if dev {
        DEV_DESKTOP_FILE_NAME
    } else {
        DESKTOP_FILE_NAME
    });
    let contents = desktop_file_contents(&exec_path, dev);

    // Earlier versions wrote the plain name from a working copy too, so a
    // machine that has ever run one carries a stale entry pointing into
    // `target/` - the duplicate this split exists to remove. Only ever touches
    // the per-user copy; a packaged install owns /usr/share and is untouched.
    if dev {
        let stale = apps_dir.join(DESKTOP_FILE_NAME);
        if std::fs::read_to_string(&stale)
            .map(|c| c.contains("/target/debug/") || c.contains("/target/release/"))
            .unwrap_or(false)
        {
            match std::fs::remove_file(&stale) {
                Ok(()) => info!("Removed stale dev desktop file: {}", stale.display()),
                Err(e) => warn!("Failed to remove {}: {e}", stale.display()),
            }
        }
    }

    // Only write when changed (avoids unnecessary inotify churn).
    let needs_write = std::fs::read_to_string(&desktop_path)
        .map(|existing| existing != contents)
        .unwrap_or(true);

    if needs_write {
        match std::fs::write(&desktop_path, &contents) {
            Ok(()) => info!("Installed desktop file: {}", desktop_path.display()),
            Err(e) => warn!("Failed to write desktop file: {e}"),
        }
    }

    // -- Icon ------------------------------------------------------------
    install_shipped_icon(&data_home);
}

// -- Icon theme -----------------------------------------------------------

/// The sizes the hicolor theme declares.
///
/// A directory hicolor does not declare is not searched, so an icon dropped
/// into one is not a worse match - it is never found at all.
const HICOLOR_SIZES: &[u32] = &[16, 22, 24, 32, 36, 48, 64, 72, 96, 128, 192, 256, 512];

/// Where an icon `size` pixels on a side belongs in the user's hicolor theme.
fn icon_path(data_home: &Path, size: u32) -> PathBuf {
    data_home
        .join(ICON_THEME_DIR)
        .join(format!("{size}x{size}"))
        .join("apps")
        .join(format!("{ICON_NAME}.png"))
}

/// Every copy of our icon already sitting in the user's hicolor theme.
fn installed_icons(data_home: &Path) -> Vec<PathBuf> {
    HICOLOR_SIZES
        .iter()
        .map(|&size| icon_path(data_home, size))
        .filter(|path| path.is_file())
        .collect()
}

/// The edge length of a square PNG; `None` if it is neither square nor a PNG.
fn square_png_size(png: &[u8]) -> Option<u32> {
    let (width, height) = image::ImageReader::new(std::io::Cursor::new(png))
        .with_guessed_format()
        .ok()?
        .into_dimensions()
        .ok()?;
    (width == height).then_some(width)
}

/// Install `png` as the icon for `size`, and remove the copies at every other
/// size.
///
/// One file at a time on purpose: a leftover at a size closer to what the shell
/// asked for wins the lookup, so an old icon would outrank the new one rather
/// than sit harmlessly beside it.
fn write_icon(data_home: &Path, size: u32, png: &[u8]) {
    if !HICOLOR_SIZES.contains(&size) {
        warn!("hicolor declares no {size}x{size} directory; skipping icon install");
        return;
    }
    let dest = icon_path(data_home, size);

    // Writing identical bytes would wake every icon-theme watcher for nothing,
    // and the themed icon is rewritten on each theme change.
    if std::fs::read(&dest).is_ok_and(|existing| existing == png) {
        return;
    }

    if let Some(dir) = dest.parent() {
        if let Err(e) = std::fs::create_dir_all(dir) {
            warn!("Failed to create {}: {e}", dir.display());
            return;
        }
    }
    match std::fs::write(&dest, png) {
        Ok(()) => info!("Installed app icon: {}", dest.display()),
        Err(e) => {
            warn!("Failed to write app icon: {e}");
            return;
        }
    }

    for stale in installed_icons(data_home) {
        if stale != dest {
            match std::fs::remove_file(&stale) {
                Ok(()) => info!("Removed app icon at another size: {}", stale.display()),
                Err(e) => warn!("Failed to remove {}: {e}", stale.display()),
            }
        }
    }
}

/// Put the icon shipped with the build into the user's icon theme, unless one
/// is already installed.
///
/// "Unless" is the whole point: [`install_themed_icon`] replaces that file with
/// the mark the running theme draws, and that has to survive the next start.
/// What the shipped icon covers is the first run, and the app grid before this
/// build has ever drawn a window.
fn install_shipped_icon(data_home: &Path) {
    if !installed_icons(data_home).is_empty() {
        return;
    }
    // Embedded rather than read from the install prefix, so a dev build out of
    // `target/` gets an icon too.
    let png = include_bytes!("../../../icons/icon.png");
    let Some(size) = square_png_size(png) else {
        warn!("The icon shipped with this build is not a square PNG; skipping install");
        return;
    };
    write_icon(data_home, size, png);
}

/// Install the mark the frontend drew as the app's icon.
///
/// GNOME never shows the icon a window sets: under Wayland GTK has no way to
/// hand one to the compositor, and even on X11 the shell matches the window to
/// its `.desktop` entry by `StartupWMClass` and draws that entry's `Icon=`,
/// keeping `_NET_WM_ICON` for windows it cannot match. So the themed mark has
/// to arrive where the shell actually looks for it: the file that icon name
/// resolves to.
///
/// Which makes it the *app's* icon rather than the window's - the one thing
/// this cannot express. Several windows in different themes share one taskbar
/// icon, and it wears whichever theme drew last; so does a working copy run
/// beside an installed Fancy Mumble, which shares the icon name. Giving a dev
/// build its own name was tried and is worse: the shell keeps serving the icon
/// name it already read, so renaming leaves it resolving a name that no longer
/// exists and it falls back to a generic cog until it is restarted.
pub(crate) fn install_themed_icon(rgba: &[u8], width: u32, height: u32) -> Result<(), String> {
    use image::ImageEncoder as _;

    if width != height {
        return Err(format!("an icon of {width}x{height} is not square"));
    }
    let data_home =
        xdg_data_home().ok_or_else(|| "could not determine XDG_DATA_HOME".to_string())?;

    let mut png = Vec::new();
    image::codecs::png::PngEncoder::new(&mut png)
        .write_image(rgba, width, height, image::ExtendedColorType::Rgba8)
        .map_err(|e| format!("could not encode the icon: {e}"))?;

    write_icon(&data_home, width, &png);
    Ok(())
}

// -- GTK prgname ----------------------------------------------------------

/// Set the GTK program name and application name so that GNOME can match
/// the running window to the `.desktop` file on both X11 and Wayland.
///
/// Must be called **before** GTK is initialised (i.e. before
/// `tauri::Builder::build`).
pub fn set_gtk_identifiers() {
    // Safety: g_set_prgname / g_set_application_name are thread-safe glib
    // functions that take a NUL-terminated C string.  We call them before
    // any GTK/GLib threads are spawned.
    #[allow(
        unsafe_code,
        reason = "calling well-defined glib C API before GTK init"
    )]
    {
        use std::ffi::CString;
        extern "C" {
            fn g_set_prgname(prgname: *const std::ffi::c_char);
            fn g_set_application_name(name: *const std::ffi::c_char);
        }
        if let (Ok(prgname), Ok(appname)) = (
            CString::new("com.fancymumble.app"),
            CString::new("Fancy Mumble"),
        ) {
            // SAFETY: Both pointers are valid NUL-terminated strings whose
            // lifetime extends beyond the call.  glib copies them internally.
            unsafe {
                g_set_prgname(prgname.as_ptr());
                g_set_application_name(appname.as_ptr());
            }
        }
    }
}

// -- Quick-action IPC (Unix domain socket) --------------------------------

/// Actions that can be triggered from `.desktop` file quick-actions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum QuickAction {
    Mute,
    Deafen,
    Disconnect,
}

impl QuickAction {
    fn from_str(s: &str) -> Option<Self> {
        match s.trim() {
            "mute" => Some(Self::Mute),
            "deafen" => Some(Self::Deafen),
            "disconnect" => Some(Self::Disconnect),
            _ => None,
        }
    }
}

/// Path to the IPC socket.
fn socket_path() -> PathBuf {
    xdg_runtime_dir().join(SOCKET_NAME)
}

/// Check CLI args for `--action <name>`.
///
/// If found, send the action to the running instance via the Unix socket
/// and return `true` (the caller should exit).  Returns `false` if no
/// action arg is present.
pub fn try_send_quick_action() -> bool {
    let args: Vec<String> = std::env::args().collect();
    let Some(idx) = args.iter().position(|a| a == "--action") else {
        return false;
    };
    let Some(action_str) = args.get(idx + 1) else {
        eprintln!("--action requires a value (mute, deafen, disconnect)");
        return true;
    };

    if QuickAction::from_str(action_str).is_none() {
        eprintln!("Unknown action: {action_str}");
        return true;
    }

    let path = socket_path();
    match UnixStream::connect(&path) {
        Ok(mut stream) => {
            let _ = stream.write_all(action_str.trim().as_bytes());
            let _ = stream.shutdown(std::net::Shutdown::Both);
        }
        Err(e) => {
            eprintln!("Could not connect to running Fancy Mumble instance: {e}");
        }
    }
    true
}

/// Read a single incoming connection and dispatch the action it carries.
///
/// Returns `true` to keep listening, `false` to stop.
fn handle_incoming(app_handle: &tauri::AppHandle, stream: std::io::Result<UnixStream>) -> bool {
    let mut s = match stream {
        Ok(s) => s,
        Err(e) => {
            warn!("Quick-action listener error: {e}");
            return false;
        }
    };
    let mut buf = String::with_capacity(16);
    let action = s
        .read_to_string(&mut buf)
        .ok()
        .and_then(|_| QuickAction::from_str(&buf));
    if let Some(action) = action {
        dispatch_action(app_handle, action);
    }
    true
}

/// Start the background listener that receives quick-action commands
/// from secondary process invocations.
///
/// Spawns a dedicated OS thread (not a tokio task) so the blocking
/// `accept()` loop doesn't consume an async worker.
pub fn start_action_listener(app_handle: tauri::AppHandle) {
    let path = socket_path();

    // Remove stale socket from a previous run.
    let _ = std::fs::remove_file(&path);

    let listener = match UnixListener::bind(&path) {
        Ok(l) => l,
        Err(e) => {
            warn!("Failed to bind quick-action socket {}: {e}", path.display());
            return;
        }
    };

    info!("Quick-action listener started on {}", path.display());

    drop(
        std::thread::Builder::new()
            .name("gnome-action-listener".into())
            .spawn(move || {
                for stream in listener.incoming() {
                    if !handle_incoming(&app_handle, stream) {
                        break;
                    }
                }
            }),
    );
}

/// Execute a quick action on the running `AppState`.
fn dispatch_action(app_handle: &tauri::AppHandle, action: QuickAction) {
    let handle = app_handle.clone();

    // The state methods are async, so spawn a tokio task.
    drop(tauri::async_runtime::spawn(async move {
        let state = handle.state::<AppState>();
        let result = match action {
            QuickAction::Mute => {
                info!("Quick action: toggle mute");
                state.toggle_mute().await
            }
            QuickAction::Deafen => {
                info!("Quick action: toggle deafen");
                state.toggle_deafen().await
            }
            QuickAction::Disconnect => {
                info!("Quick action: disconnect");
                state.disconnect().await
            }
        };

        if let Err(e) = result {
            warn!("Quick action {action:?} failed: {e}");
        }

        // Bring the window to front so the user sees the effect.
        if let Some(window) = handle.get_webview_window("main") {
            let _ = window.set_focus();
        }
    }));
}

/// Clean up the IPC socket file on shutdown.
pub fn cleanup_socket() {
    let path = socket_path();
    let _ = std::fs::remove_file(&path);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quick_action_from_str_parses_valid_actions() {
        assert_eq!(QuickAction::from_str("mute"), Some(QuickAction::Mute));
        assert_eq!(QuickAction::from_str("deafen"), Some(QuickAction::Deafen));
        assert_eq!(
            QuickAction::from_str("disconnect"),
            Some(QuickAction::Disconnect)
        );
    }

    #[test]
    fn quick_action_from_str_rejects_invalid() {
        assert_eq!(QuickAction::from_str(""), None);
        assert_eq!(QuickAction::from_str("unknown"), None);
    }

    #[test]
    fn dev_build_is_detected_by_cargo_target_path() {
        assert!(is_dev_build(
            "/home/u/src/client/target/release/mumble-tauri"
        ));
        assert!(is_dev_build("/home/u/src/client/target/debug/mumble-tauri"));
        // Packaged installs, which must keep the plain entry.
        assert!(!is_dev_build("/usr/bin/mumble-tauri"));
        assert!(!is_dev_build("/app/bin/mumble-tauri"));
    }

    #[test]
    fn dev_entry_is_named_apart_from_an_installed_one() {
        let dev = desktop_file_contents("/home/u/src/client/target/release/mumble-tauri", true);
        assert!(dev.contains("Name=Fancy Mumble (Dev)"));
        let packaged = desktop_file_contents("/usr/bin/mumble-tauri", false);
        assert!(packaged.contains("Name=Fancy Mumble\n"));
        assert_ne!(DESKTOP_FILE_NAME, DEV_DESKTOP_FILE_NAME);
    }

    #[test]
    fn desktop_file_contains_required_fields() {
        let content = desktop_file_contents("/usr/bin/fancy-mumble", false);
        assert!(content.contains("Name=Fancy Mumble"));
        assert!(content.contains("Exec=/usr/bin/fancy-mumble %U"));
        assert!(content.contains("[Desktop Action mute]"));
        assert!(content.contains("[Desktop Action deafen]"));
        assert!(content.contains("[Desktop Action disconnect]"));
        assert!(content.contains("StartupWMClass=com.fancymumble.app"));
        assert!(content.contains("Icon=com.fancymumble.app"));
        assert!(content.contains("Actions=mute;deafen;disconnect;"));
    }

    #[test]
    fn the_shipped_icon_is_a_square_png() {
        // What decides which hicolor directory it is installed into, so a
        // replacement of the wrong shape must not go in silently.
        assert_eq!(
            square_png_size(include_bytes!("../../../icons/icon.png")),
            Some(128)
        );
    }

    #[test]
    fn installing_an_icon_clears_the_copies_at_other_sizes() {
        let home = tempfile::tempdir().expect("tempdir");
        let stale = icon_path(home.path(), 256);
        std::fs::create_dir_all(stale.parent().expect("parent")).expect("mkdir");
        std::fs::write(&stale, b"old").expect("write");

        write_icon(home.path(), 128, b"new");

        assert_eq!(
            std::fs::read(icon_path(home.path(), 128)).expect("read"),
            b"new"
        );
        assert!(!stale.exists(), "the 256x256 copy would outrank the new one");
    }

    #[test]
    fn an_undeclared_size_is_refused_rather_than_written_where_nothing_looks() {
        let home = tempfile::tempdir().expect("tempdir");
        write_icon(home.path(), 100, b"new");
        assert!(installed_icons(home.path()).is_empty());
    }

    #[test]
    fn the_shipped_icon_does_not_replace_a_themed_one() {
        let home = tempfile::tempdir().expect("tempdir");
        let themed = icon_path(home.path(), 128);
        std::fs::create_dir_all(themed.parent().expect("parent")).expect("mkdir");
        std::fs::write(&themed, b"themed").expect("write");

        install_shipped_icon(home.path());

        assert_eq!(std::fs::read(&themed).expect("read"), b"themed");
    }

    #[test]
    fn the_shipped_icon_is_installed_when_the_theme_has_none() {
        let home = tempfile::tempdir().expect("tempdir");
        install_shipped_icon(home.path());
        assert_eq!(
            installed_icons(home.path()),
            vec![icon_path(home.path(), 128)]
        );
    }

    #[test]
    fn a_themed_icon_that_is_not_square_is_refused() {
        assert!(install_themed_icon(&[0; 4 * 2 * 3], 2, 3).is_err());
    }

    #[test]
    fn xdg_data_home_returns_something() {
        // Should always resolve on Linux (either XDG_DATA_HOME or $HOME/.local/share).
        assert!(xdg_data_home().is_some());
    }
}
