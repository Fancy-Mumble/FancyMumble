//! Self-contained Tauri auto-updater integration.
//!
//! Everything related to checking for, downloading and installing
//! application updates lives in this module. The rest of the app only
//! interacts with it through:
//!
//! * [`register_plugins`] - call once when building the [`tauri::Builder`].
//! * [`commands`] - re-exported `#[tauri::command]` handlers to register.
//! * [`spawn_startup_check`] - kicks off a background update check on launch
//!   and opens the branded bootstrapper window when an update is available.
//!
//! The branded bootstrapper UI lives in `ui/src/updater/` and is loaded
//! into a dedicated [`tauri::WebviewWindow`] with the label
//! [`UPDATER_WINDOW_LABEL`].
//!
//! Updates come from one of two channels - see the `channel` module for how
//! they are ordered against each other. Stable is the default, and is all a
//! client ever sees unless the user opts into betas.

#![cfg(not(target_os = "android"))]

#[cfg(feature = "self-updater")]
pub(crate) mod channel;
#[cfg(feature = "self-updater")]
pub(crate) mod commands;
#[cfg(feature = "self-updater")]
mod manager;
mod window;

#[cfg(feature = "self-updater")]
pub(crate) use manager::UpdaterState;
pub(crate) use window::{MAIN_WINDOW_LABEL, UPDATER_WINDOW_LABEL, show_main_window};

#[cfg(feature = "self-updater")]
use tauri::Manager;
use tauri::Wry;

/// Register the `updater` and `process` Tauri plugins on the builder.
///
/// `process` is needed so the bootstrapper UI can call `relaunch()`
/// after a successful update on macOS / Linux (Windows relaunches
/// automatically as part of the installer flow). Both go away together
/// when `self-updater` is off - `process` has no other consumer.
pub(crate) fn register_plugins(builder: tauri::Builder<Wry>) -> tauri::Builder<Wry> {
    #[cfg(not(feature = "self-updater"))]
    {
        builder
    }
    #[cfg(feature = "self-updater")]
    {
        builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
    }
}

/// Install the shared [`UpdaterState`] and kick off the background
/// check-on-startup task. Safe to call once from the main `setup` hook.
///
/// The main window starts hidden (`visible: false` in `tauri.conf.json`) so
/// its first frame is a loaded page rather than an empty web view: it is
/// revealed when its page has loaded ([`reveal_main_window_once`], called
/// from the builder's page-load hook), or after [`REVEAL_FALLBACK`] if that
/// never comes. It no longer waits for the update check, which goes to
/// GitHub and held the window back for up to six seconds on a slow network.
pub(crate) fn init(app: &tauri::AppHandle) {
    spawn_reveal_fallback(app.clone());
    #[cfg(feature = "self-updater")]
    {
        let _ = app.manage(UpdaterState::default());
        load_persisted_prefs(app);
        // A test instance (`FANCY_E2E_DATA_DIR`) is a build under test, not
        // an install to bring up to date.
        if crate::app::isolation::Isolation::from_env().is_none() {
            spawn_startup_check(app.clone());
        }
    }
}

/// How long the main window waits for its page before it is shown anyway, so
/// a page that never finishes loading still leaves the app on screen.
const REVEAL_FALLBACK: std::time::Duration = std::time::Duration::from_secs(3);

/// Whether the main window has been revealed at start-up. Set once: a later
/// page load (a reload of the web view, say) must not pop a window the user
/// has since hidden in the tray.
static STARTUP_REVEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Whether this is the first call, for the one start-up reveal.
fn first_reveal(flag: &std::sync::atomic::AtomicBool) -> bool {
    !flag.swap(true, std::sync::atomic::Ordering::SeqCst)
}

/// Show the main window, the first time this is called and never again.
pub(crate) fn reveal_main_window_once(app: &tauri::AppHandle) {
    if first_reveal(&STARTUP_REVEALED) {
        show_main_window(app);
    }
}

fn spawn_reveal_fallback(app: tauri::AppHandle) {
    drop(tauri::async_runtime::spawn(async move {
        tokio::time::sleep(REVEAL_FALLBACK).await;
        reveal_main_window_once(&app);
    }));
}

/// Read `preferences.json` (written by `@tauri-apps/plugin-store`) and
/// hydrate the [`UpdaterState`] before the startup check runs. This
/// avoids a race where the JS in the main webview hasn't yet pushed
/// the user's preferences via the `updater_set_*` commands by the time
/// `spawn_startup_check` decides whether to auto-install.
#[cfg(feature = "self-updater")]
fn load_persisted_prefs(app: &tauri::AppHandle) {
    let Some(state) = app.try_state::<UpdaterState>() else {
        return;
    };
    let Some((path, bytes)) = crate::app::prefs::read_preferences_file(app) else {
        return;
    };
    let Ok(json) = serde_json::from_slice::<serde_json::Value>(&bytes) else {
        tracing::warn!("Updater: {} is not valid JSON", path.display());
        return;
    };
    let prefs = json.get("preferences").unwrap_or(&json);
    if let Some(b) = prefs
        .get("autoUpdateOnStartup")
        .and_then(serde_json::Value::as_bool)
    {
        state.set_auto_install(b);
        tracing::info!("Updater: auto-install on startup = {b}");
    }
    if let Some(v) = prefs.get("skippedUpdateVersion").and_then(|v| v.as_str()) {
        state.set_skipped_version(Some(v.to_string()));
    }
    if let Some(b) = prefs
        .get("betaUpdates")
        .and_then(serde_json::Value::as_bool)
    {
        state.set_beta_channel(b);
        tracing::info!("Updater: beta channel = {b}");
    }
}

/// Spawn an async task that checks for updates shortly after launch.
///
/// The main window does not wait for it (see [`init`]). If an update is
/// available and not skipped, the branded bootstrapper window opens over the
/// main one and takes the focus, and with auto-install on it starts
/// installing at once; that window is the update's state on screen, and the
/// app behind it is replaced when the installer runs, as it was when it
/// waited hidden. Otherwise nothing more happens.
#[cfg(feature = "self-updater")]
fn spawn_startup_check(app: tauri::AppHandle) {
    drop(tauri::async_runtime::spawn(async move {
        // Tiny delay so the main webview has a chance to register its
        // `updater_set_auto_install` and `updater_set_skipped_version`
        // preferences before we open the window (they are also read from
        // the preferences file in `load_persisted_prefs`).
        tokio::time::sleep(std::time::Duration::from_millis(300)).await;
        // Bound the update check: it hits GitHub over HTTPS, and on a slow,
        // captive or offline network `updater.check()` can hang indefinitely.
        const STARTUP_CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(6);
        match tokio::time::timeout(STARTUP_CHECK_TIMEOUT, commands::run_check(&app)).await {
            Ok(Ok(true)) => {
                let auto = app
                    .try_state::<UpdaterState>()
                    .map(|s| s.auto_install())
                    .unwrap_or(false);
                if let Err(e) = window::open_updater_window(&app, auto) {
                    tracing::warn!("Failed to open updater window: {e}");
                }
            }
            Ok(Ok(false)) => tracing::debug!("Updater: no update available"),
            Ok(Err(e)) => tracing::info!("Updater: startup check failed: {e}"),
            Err(_) => tracing::warn!(
                "Updater: startup check timed out after {}s",
                STARTUP_CHECK_TIMEOUT.as_secs()
            ),
        }
    }));
}

/// The builder's page-load hook: the main window is shown once its page has
/// loaded, so its first frame is the app rather than an empty web view.
pub(crate) fn on_page_load(
    webview: &tauri::Webview,
    payload: &tauri::webview::PageLoadPayload<'_>,
) {
    use tauri::Manager;
    if payload.event() == tauri::webview::PageLoadEvent::Finished
        && webview.label() == MAIN_WINDOW_LABEL
    {
        reveal_main_window_once(webview.app_handle());
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_start_up_reveal_happens_once() {
        let flag = std::sync::atomic::AtomicBool::new(false);
        assert!(super::first_reveal(&flag));
        assert!(!super::first_reveal(&flag));
        assert!(!super::first_reveal(&flag));
    }
}
