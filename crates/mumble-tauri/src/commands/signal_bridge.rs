//! Signal bridge add-on commands: is the bridge there, and fetch it if not.
//!
//! The download itself lives in `state::pchat::bridge_addon`; this is the
//! part that knows about sessions and the webview.

use serde::Serialize;

/// What the UI needs to decide between "works", "install it" and "ask
/// your distribution".
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SignalBridgeStatus {
    /// A bridge library is present where the loader looks.
    installed: bool,
    /// `"addon"` when it is the downloaded add-on, `"packaged"` when it came
    /// with the app (dev build, distro package, Android), else `None`.
    source: Option<&'static str>,
    /// This build can download the add-on for this platform.
    downloadable: bool,
    /// The bridge version this client loads.
    version: &'static str,
}

#[cfg(not(target_os = "android"))]
fn status() -> SignalBridgeStatus {
    use crate::state::pchat;

    let found = pchat::find_bridge_library();
    let addon = pchat::signal_bridge_addon_dir();
    let source = found.as_ref().map(|path| {
        if addon.is_some_and(|dir| path.starts_with(dir)) {
            "addon"
        } else {
            "packaged"
        }
    });
    SignalBridgeStatus {
        installed: found.is_some(),
        source,
        downloadable: can_download(),
        version: env!("SIGNAL_BRIDGE_VERSION"),
    }
}

/// Android ships the bridge inside the APK, and `dlopen` finds it by name.
#[cfg(target_os = "android")]
fn status() -> SignalBridgeStatus {
    SignalBridgeStatus {
        installed: true,
        source: Some("packaged"),
        downloadable: false,
        version: env!("SIGNAL_BRIDGE_VERSION"),
    }
}

#[cfg(all(feature = "self-updater", not(target_os = "android")))]
fn can_download() -> bool {
    crate::state::pchat::bridge_addon::asset_name().is_some()
        && crate::state::pchat::signal_bridge_addon_dir().is_some()
}

#[cfg(all(not(feature = "self-updater"), not(target_os = "android")))]
fn can_download() -> bool {
    false
}

/// Report whether the signal bridge is available.
#[tauri::command]
pub(crate) fn signal_bridge_status() -> SignalBridgeStatus {
    status()
}

/// Download and install the signal bridge add-on, then load it into every
/// connected session so an open `SignalV1` channel works without a
/// reconnect.
#[cfg(all(feature = "self-updater", not(target_os = "android")))]
#[tauri::command]
pub(crate) async fn install_signal_bridge(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
) -> Result<SignalBridgeStatus, String> {
    use std::sync::atomic::{AtomicBool, Ordering};

    use tauri::Emitter;

    use crate::state::pchat;

    static INSTALLING: AtomicBool = AtomicBool::new(false);

    // A packaged bridge wins the search anyway; downloading would only put
    // a second copy behind it.
    if pchat::find_bridge_library().is_none() {
        if INSTALLING.swap(true, Ordering::SeqCst) {
            return Err("the signal bridge is already being installed".into());
        }
        let result = download::download(&app).await;
        INSTALLING.store(false, Ordering::SeqCst);
        result?;
    }

    for shared in state.registry.all_sessions() {
        if !pchat::retry_signal_bridge(&shared) {
            continue;
        }
        // Stand in the channel as a fresh joiner would: without our sender
        // key out, nobody can read what we send.
        let signal_channel = shared.lock().ok().and_then(|s| {
            let ch = s.current_channel?;
            let mode = s.channels.get(&ch)?.pchat_protocol?;
            (mode == mumble_protocol::persistent::PchatProtocol::SignalV1).then_some(ch)
        });
        if let Some(ch) = signal_channel {
            pchat::send_signal_distribution(&shared, ch);
            pchat::send_key_holder_report_async(&shared, ch).await;
        }
    }

    let _ = app.emit("signal-bridge-installed", ());
    Ok(status())
}

/// The download path, for builds that fetch the add-on themselves.
#[cfg(all(feature = "self-updater", not(target_os = "android")))]
mod download {
    use serde::Serialize;

    /// Download progress, emitted as `signal-bridge-download-progress`.
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct DownloadProgress {
        received: u64,
        total: Option<u64>,
    }

    pub(super) async fn download(app: &tauri::AppHandle) -> Result<(), String> {
        use tauri::Emitter;

        use crate::state::pchat;

        let dir = pchat::signal_bridge_addon_dir().ok_or("no add-on directory")?;
        let pubkey = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|u| u.get("pubkey"))
            .and_then(serde_json::Value::as_str)
            .ok_or("no updater public key to verify the download with")?
            .to_owned();

        let mut last_percent = None;
        pchat::bridge_addon::install(dir, &pubkey, |received, total| {
            // One event per percent, not per network chunk.
            let percent = total.map(|t| received * 100 / t.max(1));
            if percent.is_none() || percent != last_percent {
                last_percent = percent;
                let _ = app.emit(
                    "signal-bridge-download-progress",
                    DownloadProgress { received, total },
                );
            }
        })
        .await
        .inspect_err(|e| tracing::warn!("signal bridge add-on install failed: {e}"))?;
        tracing::info!(dir = %dir.display(), "signal bridge add-on installed");
        Ok(())
    }
}

/// Stub for builds that cannot download (Android, distro packages), so a
/// stray invoke gets a reason instead of "command not found".
#[cfg(not(all(feature = "self-updater", not(target_os = "android"))))]
#[tauri::command]
pub(crate) fn install_signal_bridge() -> Result<SignalBridgeStatus, String> {
    Err("this build does not download the signal bridge; install it with the app's package".into())
}
