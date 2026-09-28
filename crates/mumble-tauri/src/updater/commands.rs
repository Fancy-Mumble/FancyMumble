//! Tauri commands exposed to the bootstrapper window.

use super::channel;
use super::manager::{UpdateInfo, UpdaterState};
use super::window;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

/// Per-request budget for a single manifest fetch.
///
/// The two channel checks run concurrently, so this also bounds the pair.
/// It sits under the 6 s `STARTUP_CHECK_TIMEOUT` that wraps the whole
/// startup check, leaving room for the surrounding work.
const CHECK_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Event channel for download progress, emitted to the updater window only.
const PROGRESS_EVENT: &str = "updater://progress";

#[derive(Debug, Clone, serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum ProgressEvent {
    Started { total: Option<u64> },
    Chunk { downloaded: u64, total: Option<u64> },
    Finished,
}

/// Ask one endpoint whether it has something newer than this build.
///
/// `endpoint` of `None` means the stable channel, whose URL comes from
/// `tauri.conf.json`. Signature verification is the plugin's, either way.
async fn check_endpoint(
    app: &tauri::AppHandle,
    endpoint: Option<String>,
) -> Result<Option<Update>, String> {
    let mut builder = app.updater_builder().timeout(CHECK_TIMEOUT);
    if let Some(url) = endpoint {
        let parsed = url
            .parse()
            .map_err(|e| format!("bad endpoint {url}: {e}"))?;
        builder = builder.endpoints(vec![parsed]).map_err(|e| e.to_string())?;
    }
    let updater = builder.build().map_err(|e| e.to_string())?;
    updater.check().await.map_err(|e| e.to_string())
}

/// Internal helper: perform an update check and stash the result.
///
/// Returns `true` when an update is available *and* not on the user's
/// skip list. A skipped version is treated identically to "no update".
///
/// With the beta channel on, both manifests are fetched concurrently and the
/// higher version wins - so a beta user picks up the stable release that
/// supersedes their pre-release without having to opt out first. One channel
/// failing is survivable; only a total failure is reported as an error.
pub(super) async fn run_check(app: &tauri::AppHandle) -> Result<bool, String> {
    let beta_opt_in = app
        .try_state::<UpdaterState>()
        .is_some_and(|s| s.beta_channel());

    // `None` for the beta arm means "not attempted", which is different from
    // "attempted and found nothing" - see `choose_update`.
    let (stable, beta) = tokio::join!(check_endpoint(app, None), async {
        if beta_opt_in {
            Some(check_endpoint(app, Some(channel::beta_manifest_url())).await)
        } else {
            None
        }
    });

    let Some(update) = choose_update(stable, beta, |u: &Update| u.version.as_str())? else {
        return Ok(false);
    };

    let skipped = app
        .try_state::<UpdaterState>()
        .and_then(|s| s.skipped_version());
    if skipped.as_deref() == Some(update.version.as_str()) {
        tracing::info!(
            "Updater: version {} is on the user's skip list, ignoring",
            update.version
        );
        return Ok(false);
    }
    if let Some(state) = app.try_state::<UpdaterState>() {
        state.store(update);
    }
    Ok(true)
}

/// Reduce the channel results to the update worth offering.
///
/// `beta` is `None` when the user is not opted in and that channel was never
/// asked. An error from one channel is logged and dropped as long as the
/// other answered: a beta user with an unreachable `beta.json` should still
/// be offered stable. `Err` comes back only when every channel that was
/// actually attempted failed, which is what the caller reports as a failed
/// check.
/// Generic over the update type so the arbitration can be unit-tested
/// without constructing a real [`Update`], which only the plugin can build.
fn choose_update<T>(
    stable: Result<Option<T>, String>,
    beta: Option<Result<Option<T>, String>>,
    version_of: impl Fn(&T) -> &str,
) -> Result<Option<T>, String> {
    let stable = report_channel_error("stable", stable);
    let beta = beta.map(|r| report_channel_error("beta", r));
    let errors: Vec<String> = [Some(&stable), beta.as_ref()]
        .into_iter()
        .flatten()
        .filter_map(|r| r.as_ref().err().cloned())
        .collect();
    let attempted = 1 + usize::from(beta.is_some());
    if errors.len() == attempted {
        return Err(errors.join("; "));
    }
    // Stable goes first so that it wins an exact tie.
    let candidates: Vec<T> = [Some(stable), beta]
        .into_iter()
        .flatten()
        .filter_map(|r| r.ok().flatten())
        .collect();
    let versions: Vec<&str> = candidates.iter().map(&version_of).collect();
    let Some(winner) = channel::pick_newest(&versions) else {
        return Ok(None);
    };
    if candidates.len() > 1 {
        tracing::info!(
            "Updater: candidates {versions:?}, offering {}",
            versions[winner]
        );
    }
    Ok(candidates.into_iter().nth(winner))
}

/// Log a channel that failed, passing the result through unchanged.
fn report_channel_error<T>(
    name: &str,
    result: Result<Option<T>, String>,
) -> Result<Option<T>, String> {
    if let Err(e) = &result {
        tracing::info!("Updater: {name} channel check failed: {e}");
    }
    result
}

/// Force a fresh update check from the bootstrapper UI.
#[tauri::command]
pub(crate) async fn updater_check(app: tauri::AppHandle) -> Result<Option<UpdateInfo>, String> {
    let _ = run_check(&app).await?;
    Ok(app.try_state::<UpdaterState>().and_then(|s| s.snapshot()))
}

/// Return the cached update info without triggering a new check.
#[tauri::command]
pub(crate) fn updater_pending(state: tauri::State<'_, UpdaterState>) -> Option<UpdateInfo> {
    state.snapshot()
}

/// Download and install the cached update, emitting progress events to
/// the updater window. On Windows the app exits before the installer
/// runs; on macOS / Linux the bootstrapper UI is responsible for calling
/// `relaunch()` once this command resolves.
#[tauri::command]
pub(crate) async fn updater_download_and_install(
    app: tauri::AppHandle,
    state: tauri::State<'_, UpdaterState>,
) -> Result<(), String> {
    if cfg!(debug_assertions) {
        tracing::warn!("Updater: skipping install in debug/dev build (simulating progress)");
        const FAKE_TOTAL: u64 = 1_000_000;
        const STEPS: u64 = 10;
        let total: Option<u64> = Some(FAKE_TOTAL);
        emit_progress(&app, ProgressEvent::Started { total });
        for i in 1..=STEPS {
            tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            let downloaded = FAKE_TOTAL * i / STEPS;
            emit_progress(&app, ProgressEvent::Chunk { downloaded, total });
        }
        emit_progress(&app, ProgressEvent::Finished);
        return Ok(());
    }
    let update = state
        .take()
        .ok_or_else(|| "no pending update".to_string())?;

    let mut total: Option<u64> = None;
    let mut downloaded: u64 = 0;
    let app_for_progress = app.clone();

    update
        .download_and_install(
            move |chunk_len, content_len| {
                if total.is_none() {
                    total = content_len;
                    emit_progress(&app_for_progress, ProgressEvent::Started { total });
                }
                downloaded = downloaded.saturating_add(chunk_len as u64);
                emit_progress(
                    &app_for_progress,
                    ProgressEvent::Chunk { downloaded, total },
                );
            },
            move || {},
        )
        .await
        .map_err(|e| e.to_string())?;

    emit_progress(&app, ProgressEvent::Finished);
    Ok(())
}

/// Close the updater window without installing.
#[tauri::command]
pub(crate) fn updater_dismiss(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(window::UPDATER_WINDOW_LABEL) {
        win.close().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Persist the user's auto-install preference into the in-process
/// updater state. Called by the main webview during startup.
#[tauri::command]
pub(crate) fn updater_set_auto_install(enabled: bool, state: tauri::State<'_, UpdaterState>) {
    state.set_auto_install(enabled);
}

/// Persist the user's beta-channel opt-in into the in-process updater
/// state. Called by the main webview during startup and whenever the
/// setting is toggled.
#[tauri::command]
pub(crate) fn updater_set_beta_channel(enabled: bool, state: tauri::State<'_, UpdaterState>) {
    state.set_beta_channel(enabled);
}

/// Persist the user's "skip this version" choice into the in-process
/// updater state. Pass `None` to clear it.
#[tauri::command]
pub(crate) fn updater_set_skipped_version(
    version: Option<String>,
    state: tauri::State<'_, UpdaterState>,
) {
    state.set_skipped_version(version);
}

fn emit_progress(app: &tauri::AppHandle, event: ProgressEvent) {
    if let Some(win) = app.get_webview_window(window::UPDATER_WINDOW_LABEL) {
        let _ = win.emit(PROGRESS_EVENT, event);
    }
}

#[cfg(test)]
mod tests {
    use super::choose_update;

    /// Stands in for `Update`: all the arbitration needs is a version.
    fn v(version: &str) -> Option<String> {
        Some(version.to_string())
    }

    fn choose(
        stable: Result<Option<String>, String>,
        beta: Option<Result<Option<String>, String>>,
    ) -> Result<Option<String>, String> {
        choose_update(stable, beta, |s: &String| s.as_str())
    }

    #[test]
    fn stable_only_passes_its_answer_through() {
        assert_eq!(choose(Ok(v("0.4.0")), None), Ok(v("0.4.0")));
        assert_eq!(choose(Ok(None), None), Ok(None));
    }

    #[test]
    fn a_failed_stable_check_is_an_error_when_it_was_the_only_one() {
        // Beta off: there is no second opinion, so the failure must surface
        // rather than read as "you are up to date".
        assert_eq!(choose(Err("offline".into()), None), Err("offline".into()));
    }

    #[test]
    fn the_higher_version_wins_across_channels() {
        assert_eq!(
            choose(Ok(v("0.3.0")), Some(Ok(v("0.4.0-beta.1")))),
            Ok(v("0.4.0-beta.1"))
        );
        assert_eq!(
            choose(Ok(v("0.4.0")), Some(Ok(v("0.4.0-beta.3")))),
            Ok(v("0.4.0"))
        );
    }

    #[test]
    fn one_broken_channel_does_not_sink_the_other() {
        assert_eq!(
            choose(Err("500".into()), Some(Ok(v("0.4.0-beta.1")))),
            Ok(v("0.4.0-beta.1"))
        );
        assert_eq!(
            choose(Ok(v("0.4.0")), Some(Err("404".into()))),
            Ok(v("0.4.0"))
        );
    }

    #[test]
    fn both_channels_failing_reports_both_reasons() {
        let both = choose(Err("dns".into()), Some(Err("404".into())));
        assert_eq!(both, Err("dns; 404".into()));
    }

    #[test]
    fn neither_channel_offering_anything_is_not_an_error() {
        assert_eq!(choose(Ok(None), Some(Ok(None))), Ok(None));
    }
}
