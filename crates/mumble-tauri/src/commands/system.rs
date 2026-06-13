//! Cross-cutting system commands: notifications, log level, badge count,
//! factory reset and clock format.

use crate::logging;
use crate::platform;
use crate::state::AppState;

/// Returns the OS-detected clock format for the "auto" time setting.
#[tauri::command]
pub(crate) fn get_system_clock_format() -> Option<&'static str> {
    platform::badge::system_clock_format()
}

/// Enable or disable native OS notifications.
#[tauri::command]
pub(crate) fn set_notifications_enabled(
    state: tauri::State<'_, AppState>,
    enabled: bool,
) -> Result<(), String> {
    state.inner.snapshot().lock().map_err(|e| e.to_string())?.prefs.notifications_enabled = enabled;
    Ok(())
}

/// Enable or disable dual-path sending for encrypted channels.
///
/// When disabled, the plain `TextMessage` body is replaced with a
/// placeholder so the server never sees the cleartext content.
#[tauri::command]
pub(crate) fn set_disable_dual_path(
    state: tauri::State<'_, AppState>,
    disabled: bool,
) -> Result<(), String> {
    state.inner.snapshot().lock().map_err(|e| e.to_string())?.prefs.disable_dual_path = disabled;
    Ok(())
}

/// Change the log level filter at runtime.
///
/// Accepts a `tracing_subscriber::EnvFilter`-compatible string such as
/// `"debug"`, `"mumble_tauri=debug,mumble_protocol=debug,info"`, or
/// `"trace"`.  Returns the filter that was actually applied.
#[tauri::command]
pub(crate) fn set_log_level(filter: String) -> Result<String, String> {
    logging::set_log_level(&filter)
}

/// Enable or disable writing logs to a file in the OS log directory.
///
/// When enabling, this opens (creating if needed) the current day's log
/// file and, if auto-zip is on, compresses any day-old log files first.
#[tauri::command]
pub(crate) fn set_log_to_file(enabled: bool) -> Result<(), String> {
    logging::set_file_logging(enabled)
}

/// Enable or disable stdout (terminal) logging in release builds.
/// No effect in dev builds, where terminal logging is always on.
#[tauri::command]
pub(crate) fn set_terminal_logging(enabled: bool) -> Result<(), String> {
    logging::set_terminal_logging(enabled);
    Ok(())
}

/// Enable or disable automatic zstd-compression of log files older than
/// a day (applied whenever file logging is (re)enabled).
#[tauri::command]
pub(crate) fn set_auto_zip_logs(enabled: bool) -> Result<(), String> {
    logging::set_auto_zip(enabled);
    Ok(())
}

/// Return the directory where log files are stored, for "open folder".
///
/// Creates the directory if it does not exist yet (file logging may
/// never have been enabled), so the caller can always open it.
#[tauri::command]
pub(crate) fn get_log_directory() -> Result<String, String> {
    logging::ensure_log_dir().map(|p| p.to_string_lossy().into_owned())
}

/// Compress and export all saved logs into a single `.log.zst` file at
/// the user-chosen destination path.
#[tauri::command]
pub(crate) fn export_logs(dest_path: String) -> Result<(), String> {
    logging::export_logs(std::path::Path::new(&dest_path))
}

/// Reset all app data to factory defaults (preferences, saved servers, certs).
#[tauri::command]
pub(crate) async fn reset_app_data(app: tauri::AppHandle) -> Result<(), String> {
    let data_dir = crate::e2e_data_dir(&app)?;
    // Remove known data files.
    for name in &["preferences.json", "servers.json", "passwords.json"] {
        let path = data_dir.join(name);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    // Remove certs directory.
    let certs = data_dir.join("certs");
    if certs.exists() {
        std::fs::remove_dir_all(&certs).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Set the taskbar badge count.
///
/// On Windows this renders a small red overlay icon with the count (the native
/// `set_badge_count` API is not supported). On Linux/macOS it delegates to
/// the native badge-count API. On Android/iOS this is a no-op.
#[tauri::command]
pub(crate) fn update_badge_count(window: tauri::Window, count: Option<u32>) -> Result<(), String> {
    platform::badge::set_badge(&window, count)
}
