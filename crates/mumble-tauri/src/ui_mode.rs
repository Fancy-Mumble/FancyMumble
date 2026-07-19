//! UI-mode selection: full (this Tauri app) vs. minimal (the native
//! `qt6ui` client, see `crates/qt6ui`).
//!
//! The chosen mode is persisted in a tiny `ui-mode` marker file inside the
//! app config dir so that *both* binaries can read/write it without sharing
//! the Tauri store plugin: this file is read in [`crate::run`] **before** the
//! Tauri context exists, and written by `qt6ui` when the user switches back
//! to the full interface. Contents are exactly `minimal` or `full`; a
//! missing/unreadable file means `full`.
//!
//! The marker lives next to (not inside) the Tauri store because the store
//! file is owned by the plugin's autosave and parsing it from a foreign
//! process would race those writes.

use std::path::PathBuf;
use std::process::Command;

use crate::constants::{
    APP_IDENTIFIER, ENV_E2E_DATA_DIR, ENV_QT6UI_BIN, QT6UI_BINARY_NAME, UI_MODE_MARKER_FILE,
};

/// The persisted interface mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum UiMode {
    Full,
    Minimal,
}

impl UiMode {
    fn as_str(self) -> &'static str {
        match self {
            Self::Full => "full",
            Self::Minimal => "minimal",
        }
    }

    pub(crate) fn parse(s: &str) -> Option<Self> {
        match s.trim() {
            "full" => Some(Self::Full),
            "minimal" => Some(Self::Minimal),
            _ => None,
        }
    }
}

/// Directory holding the mode marker.
///
/// Honours the `FANCY_E2E_DATA_DIR` override (same contract as
/// [`crate::e2e_data_dir`]) so e2e test instances stay isolated; otherwise
/// resolves the platform config dir for [`APP_IDENTIFIER`] the same way
/// Tauri's `app_config_dir()` does.
fn config_dir() -> Option<PathBuf> {
    if let Ok(dir) = std::env::var(ENV_E2E_DATA_DIR) {
        if !dir.trim().is_empty() {
            return Some(PathBuf::from(dir));
        }
    }
    #[cfg(target_os = "windows")]
    {
        std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(APP_IDENTIFIER))
    }
    #[cfg(target_os = "macos")]
    {
        std::env::var_os("HOME").map(|d| {
            PathBuf::from(d)
                .join("Library/Application Support")
                .join(APP_IDENTIFIER)
        })
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        std::env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|d| PathBuf::from(d).join(".config")))
            .map(|d| d.join(APP_IDENTIFIER))
    }
}

/// Read the persisted UI mode; defaults to [`UiMode::Full`] when the marker
/// is absent or unreadable.
pub(crate) fn current_mode() -> UiMode {
    config_dir()
        .and_then(|d| std::fs::read_to_string(d.join(UI_MODE_MARKER_FILE)).ok())
        .and_then(|s| UiMode::parse(&s))
        .unwrap_or(UiMode::Full)
}

/// Persist the UI mode marker (creating the config dir if needed).
pub(crate) fn set_mode(mode: UiMode) -> Result<(), String> {
    let dir = config_dir().ok_or_else(|| "could not resolve app config dir".to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(UI_MODE_MARKER_FILE), mode.as_str()).map_err(|e| e.to_string())
}

/// Locate the minimal `qt6ui` client binary.
///
/// Search order:
/// 1. `FANCY_QT6UI_BIN` env override (absolute path; used by e2e tests),
/// 2. next to the current executable (bundled installs),
/// 3. the dev layout `crates/qt6ui/target/{release,debug}` found by walking
///    up from the current executable (covers `cargo run` from the workspace,
///    whose exe sits in `target/{profile}/`).
fn find_qt6ui_binary() -> Option<PathBuf> {
    let exe_name = if cfg!(windows) {
        format!("{QT6UI_BINARY_NAME}.exe")
    } else {
        QT6UI_BINARY_NAME.to_owned()
    };

    if let Ok(p) = std::env::var(ENV_QT6UI_BIN) {
        let p = PathBuf::from(p);
        if p.is_file() {
            return Some(p);
        }
    }

    let exe_dir = std::env::current_exe().ok()?.parent()?.to_path_buf();

    let sibling = exe_dir.join(&exe_name);
    if sibling.is_file() {
        return Some(sibling);
    }

    // Dev layout: walk up towards the workspace root and probe the
    // out-of-workspace qt6ui target dir. Prefer the *newest* of the
    // release/debug builds by mtime rather than a fixed profile order:
    // in the dev loop the freshly-rebuilt profile (usually debug) must win
    // over a stale one, otherwise the launcher runs old code. (This matters
    // more now that the mumble-tauri build script skips the nested qt6ui
    // rebuild in dev - see its build.rs.)
    let mut dir = exe_dir.as_path();
    for _ in 0..4 {
        let base = dir.join("crates/qt6ui/target");
        let newest = ["release", "debug"]
            .iter()
            .map(|profile| base.join(profile).join(&exe_name))
            .filter(|p| p.is_file())
            .max_by_key(|p| p.metadata().and_then(|m| m.modified()).ok());
        if let Some(candidate) = newest {
            return Some(candidate);
        }
        dir = dir.parent()?;
    }
    None
}

/// Startup dispatch: when the persisted mode is minimal, spawn the qt6ui
/// client and return `true` (the caller should exit). Returns `false` when
/// the mode is full or the minimal binary could not be started, so the
/// user is never locked out of the app.
pub(crate) fn dispatch_if_minimal() -> bool {
    if current_mode() != UiMode::Minimal {
        return false;
    }
    match launch_minimal_client() {
        Ok(()) => {
            tracing::info!("ui-mode is 'minimal': launched qt6ui client, exiting full client");
            true
        }
        Err(e) => {
            tracing::warn!(
                "ui-mode is 'minimal' but launching qt6ui failed ({e}); continuing in full mode"
            );
            false
        }
    }
}

/// Locate the Qt kit's `bin` dir to prepend to the child's `PATH` when the
/// qt6ui binary is not windeployqt'ed (dev layout). Without this, Windows
/// resolves `Qt6*.dll` from whatever is on the ambient `PATH` - e.g. other
/// installed software shipping its own (ABI-incompatible) Qt - and the
/// child dies before `main` without any error output.
#[cfg(target_os = "windows")]
fn qt_runtime_bin(qt6ui_exe: &std::path::Path) -> Option<PathBuf> {
    // Deployed next to the binary (windeployqt / bundled): nothing to add.
    if qt6ui_exe.parent()?.join("Qt6Core.dll").is_file() {
        return None;
    }
    // Same override the qt6ui build script honours.
    if let Ok(dir) = std::env::var("QT6_MINGW_DIR") {
        let bin = std::path::Path::new(&dir).join("bin");
        if bin.join("Qt6Core.dll").is_file() {
            return Some(bin);
        }
    }
    // Probe the default install root; prefer the newest kit.
    let mut kits: Vec<PathBuf> = std::fs::read_dir("C:/Qt")
        .ok()?
        .flatten()
        .map(|e| e.path().join("mingw_64").join("bin"))
        .filter(|p| p.join("Qt6Core.dll").is_file())
        .collect();
    kits.sort();
    kits.pop()
}

#[cfg(not(target_os = "windows"))]
fn qt_runtime_bin(_qt6ui_exe: &std::path::Path) -> Option<PathBuf> {
    None // ELF/Mach-O binaries carry an rpath; no PATH surgery needed.
}

/// Spawn the minimal client. Returns the error string when the binary could
/// not be found or started (the caller then continues in full mode).
///
/// After spawning, the child is watched briefly: a loader failure (missing
/// or ABI-incompatible Qt DLLs) kills it within milliseconds and would
/// otherwise leave the user with no UI at all.
pub(crate) fn launch_minimal_client() -> Result<(), String> {
    let bin = find_qt6ui_binary().ok_or_else(|| {
        format!("qt6ui binary not found (set {ENV_QT6UI_BIN} or place qt6ui next to the app)")
    })?;

    let mut cmd = Command::new(&bin);
    if let Some(qt_bin) = qt_runtime_bin(&bin) {
        let mut path = std::ffi::OsString::from(qt_bin.as_os_str());
        path.push(";");
        path.push(std::env::var_os("PATH").unwrap_or_default());
        let _ = cmd.env("PATH", path);
        tracing::info!(
            "qt6ui: prepending Qt runtime {} to child PATH",
            qt_bin.display()
        );
    }

    // Fully detach the child from any console this process is attached to
    // (`cargo run` / `cargo tauri dev`): with inherited handles, debug
    // builds of qt6ui (console subsystem) keep the dev terminal captive
    // until the qt6ui window closes - and closing that terminal kills the
    // minimal client with it. DETACHED_PROCESS also stops Windows from
    // popping a brand-new console window for the debug child.
    let _ = cmd
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        let _ = cmd.creation_flags(DETACHED_PROCESS);
    }

    let mut child = cmd
        .spawn()
        .map_err(|e| format!("failed to start {}: {e}", bin.display()))?;

    // Fail fast when the child dies immediately so the caller can fall
    // back to the full interface instead of exiting into nothing.
    for _ in 0..6 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        match child.try_wait() {
            Ok(Some(status)) => {
                return Err(format!(
                    "{} exited immediately ({status}); likely missing/incompatible Qt runtime DLLs",
                    bin.display()
                ));
            }
            Ok(None) => {}
            Err(_) => break, // cannot poll: assume it started
        }
    }
    Ok(())
}

/// Coarse hardware capability numbers used by the first-run "weak PC"
/// prompt. `total_memory_mb == 0` means "unknown" (never treated as weak).
#[derive(Debug, serde::Serialize)]
pub(crate) struct SystemSpecs {
    pub total_memory_mb: u64,
    pub cpu_cores: u32,
}

pub(crate) fn system_specs() -> SystemSpecs {
    SystemSpecs {
        total_memory_mb: total_memory_mb(),
        cpu_cores: std::thread::available_parallelism().map_or(0, |n| n.get() as u32),
    }
}

#[cfg(target_os = "windows")]
#[allow(
    unsafe_code,
    reason = "GlobalMemoryStatusEx on a zero-initialised POD struct is a safe Windows API call"
)]
fn total_memory_mb() -> u64 {
    use windows_sys::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    // SAFETY: MEMORYSTATUSEX is plain-old-data; zeroed is a valid init and
    // GlobalMemoryStatusEx only requires dwLength to be set.
    unsafe {
        let mut status: MEMORYSTATUSEX = std::mem::zeroed();
        status.dwLength = size_of::<MEMORYSTATUSEX>() as u32;
        if GlobalMemoryStatusEx(&mut status) != 0 {
            status.ullTotalPhys / (1024 * 1024)
        } else {
            0
        }
    }
}

#[cfg(target_os = "linux")]
fn total_memory_mb() -> u64 {
    // /proc/meminfo first line: "MemTotal:       16333852 kB"
    std::fs::read_to_string("/proc/meminfo")
        .ok()
        .and_then(|s| {
            s.lines().find_map(|l| {
                l.strip_prefix("MemTotal:")?
                    .split_whitespace()
                    .next()?
                    .parse::<u64>()
                    .ok()
            })
        })
        .map_or(0, |kb| kb / 1024)
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn total_memory_mb() -> u64 {
    0 // unknown: the weak-PC prompt simply never triggers
}
