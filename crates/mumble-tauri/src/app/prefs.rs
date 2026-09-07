//! Hydrate the backend `AppState` from the persisted `preferences.json`.

use tauri::Manager;

use crate::logging;
use crate::state::{self, AppState};

/// Read `preferences.json` (written by `@tauri-apps/plugin-store`) and
/// hydrate the backend `AppState` with the user's persisted audio
/// settings, notification toggle, dual-path toggle and log level.
///
/// Without this step the backend stays on its built-in defaults until
/// the frontend gets around to invoking the per-setting commands, which
/// races against the user enabling voice and produces noticeably worse
/// audio (wrong VAD threshold, wrong device, wrong denoiser, etc.) for
/// the first call after launch.
pub(crate) fn hydrate_persisted_prefs(app: &tauri::AppHandle, state: &AppState) {
    // Record the log directory now that the app handle exists, so the
    // developer log tooling (file logging, export, "view folder") has a
    // target even before the user touches a setting.
    if let Ok(log_dir) = app.path().app_log_dir() {
        logging::set_log_dir(log_dir);
    }

    let Some((path, bytes)) = read_preferences_file(app) else {
        tracing::debug!("hydrate_persisted_prefs: no preferences file found");
        return;
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        tracing::warn!(
            "hydrate_persisted_prefs: {} is not valid JSON",
            path.display()
        );
        return;
    };

    if let Some(audio) = json.get("audioSettings") {
        match serde_json::from_value::<state::types::AudioSettings>(audio.clone()) {
            Ok(settings) => {
                tracing::info!("hydrate_persisted_prefs: applying saved audio settings");
                crate::audio::set_exclusive_input(settings.exclusive_input);
                // `None` means the state lock was poisoned and nothing was
                // applied, which otherwise looks exactly like a clean start
                // on defaults.
                if state.set_audio_settings(settings).is_none() {
                    tracing::warn!(
                        "hydrate_persisted_prefs: saved audio settings were not applied"
                    );
                }
            }
            Err(e) => {
                tracing::warn!("hydrate_persisted_prefs: invalid audioSettings: {e}");
            }
        }
    }

    let prefs = json.get("preferences").unwrap_or(&json);
    if let Ok(mut s) = state.inner.snapshot().lock() {
        if let Some(b) = prefs
            .get("enableNotifications")
            .and_then(serde_json::Value::as_bool)
        {
            let streamer_mode = prefs
                .get("streamerMode")
                .and_then(serde_json::Value::as_bool)
                .unwrap_or(false);
            s.prefs.notifications_enabled = b && !streamer_mode;
        }
        if let Some(b) = prefs
            .get("enableDualPath")
            .and_then(serde_json::Value::as_bool)
        {
            s.prefs.disable_dual_path = !b;
        }
    }

    let log_level = prefs
        .get("logLevel")
        .and_then(|v| v.as_str())
        .map(str::to_owned)
        .or_else(|| {
            prefs
                .get("debugLogging")
                .and_then(serde_json::Value::as_bool)
                .map(|b| {
                    if b {
                        "debug".to_string()
                    } else {
                        "info".to_string()
                    }
                })
        });
    if let Some(level) = log_level
        && logging::set_log_level(&level).is_ok()
    {
        tracing::info!("hydrate_persisted_prefs: log level = {level}");
    }

    // Developer log tooling settings. Apply terminal/auto-zip flags
    // before enabling file logging so the first rotation honours them.
    let bool_pref = |key: &str| prefs.get(key).and_then(serde_json::Value::as_bool);
    if let Some(terminal) = bool_pref("terminalLogging") {
        logging::set_terminal_logging(terminal);
    }
    if let Some(auto_zip) = bool_pref("autoZipLogs") {
        logging::set_auto_zip(auto_zip);
    }
    if bool_pref("logToFile").unwrap_or(false)
        && let Err(e) = logging::set_file_logging(true)
    {
        tracing::warn!("hydrate_persisted_prefs: enable file logging failed: {e}");
    }

    // Rich Presence has to come up at launch rather than when the settings
    // page is first opened: whoever binds Discord's IPC slot 0 first receives
    // everything, so starting late means losing the race to a Discord client
    // that started in between.
    #[cfg(not(target_os = "android"))]
    if bool_pref("enableRichPresence").unwrap_or(false) {
        start_rich_presence(
            app.clone(),
            bool_pref("richPresenceArtwork").unwrap_or(true),
        );
    }
}

/// Bring the Rich Presence listener up in the background.
///
/// Spawned rather than awaited so a slow bind cannot delay the rest of
/// startup; failures are logged and leave the feature simply off.
#[cfg(not(target_os = "android"))]
fn start_rich_presence(app: tauri::AppHandle, resolve_artwork: bool) {
    let _task = tauri::async_runtime::spawn(async move {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        match state
            .set_presence_enabled(&app, true, resolve_artwork)
            .await
        {
            Ok(status) => tracing::info!(?status, "rich presence restored from preferences"),
            Err(e) => tracing::warn!("hydrate_persisted_prefs: rich presence failed to start: {e}"),
        }
    });
}

/// Locate and read the preferences file `@tauri-apps/plugin-store` writes.
///
/// The plugin resolves a relative store path against `BaseDirectory::AppData`
/// (`tauri-plugin-store`'s `resolve_store_path`), which on Linux is
/// `~/.local/share/<identifier>` - *not* the config dir. Reading only the
/// config dir finds nothing there, so the app starts on its built-in
/// defaults however long ago the user changed a setting. The config dir
/// stays as a fallback: on Windows and macOS the two resolve to the same
/// place, and an install that somehow has the file there is still honoured.
pub(crate) fn read_preferences_file(
    app: &tauri::AppHandle,
) -> Option<(std::path::PathBuf, Vec<u8>)> {
    let candidates = [
        app.path().app_data_dir().ok(),
        app.path().app_config_dir().ok(),
    ];
    for dir in candidates.into_iter().flatten() {
        let path = dir.join("preferences.json");
        match std::fs::read(&path) {
            Ok(bytes) => return Some((path, bytes)),
            Err(e) => tracing::debug!("no preferences at {}: {e}", path.display()),
        }
    }
    None
}
