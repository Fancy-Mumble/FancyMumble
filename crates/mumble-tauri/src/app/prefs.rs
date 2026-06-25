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

    let Ok(config_dir) = app.path().app_config_dir() else {
        return;
    };
    let path = config_dir.join("preferences.json");
    let Ok(bytes) = std::fs::read(&path) else {
        tracing::debug!("hydrate_persisted_prefs: no preferences at {}", path.display());
        return;
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        tracing::warn!("hydrate_persisted_prefs: preferences.json is not valid JSON");
        return;
    };

    if let Some(audio) = json.get("audioSettings") {
        match serde_json::from_value::<state::types::AudioSettings>(audio.clone()) {
            Ok(settings) => {
                tracing::info!("hydrate_persisted_prefs: applying saved audio settings");
                let _ = state.set_audio_settings(settings);
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
                .map(|b| if b { "debug".to_string() } else { "info".to_string() })
        });
    if let Some(level) = log_level {
        if logging::set_log_level(&level).is_ok() {
            tracing::info!("hydrate_persisted_prefs: log level = {level}");
        }
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
    if bool_pref("logToFile").unwrap_or(false) {
        if let Err(e) = logging::set_file_logging(true) {
            tracing::warn!("hydrate_persisted_prefs: enable file logging failed: {e}");
        }
    }
}
