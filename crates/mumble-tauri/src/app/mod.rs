//! Application bootstrap.
//!
//! The wiring `run()` (in `lib.rs`) performs at startup - runtime-env tuning,
//! the plugin builder, state hydration, the deep-link handler and (desktop)
//! `WebView2` memory management - lives here so the crate-root entry point stays
//! focused on the event loop. Command registration is in [`crate::commands::registry`].

pub(crate) mod builder;
pub(crate) mod prefs;

#[cfg(not(target_os = "android"))]
pub(crate) mod window_state;

#[cfg(all(dev, not(target_os = "android")))]
pub(crate) mod dev_server;

#[cfg(target_os = "windows")]
pub(crate) mod webview;

#[cfg(target_os = "linux")]
pub(crate) mod webview_linux;

use tauri::Manager;

use crate::state::AppState;

/// Configure environment variables that influence the Tokio runtime that Tauri
/// spawns. Must be called before any Tokio code runs.
///
/// **Tokio** (`TOKIO_WORKER_THREADS`): Tauri's default worker count = logical
/// CPUs. Mumble I/O is light (one TCP + one UDP socket, occasional file I/O);
/// 4 workers is plenty, and each thread reserves ~2 MB of stack address space.
///
/// We deliberately do NOT pass `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` flags:
/// `--in-process-gpu` saved ~40 MB private memory but cost ~7% sustained idle
/// CPU (the in-process compositor never goes fully idle) - the defaults win.
pub(crate) fn configure_runtime_env() {
    set_env_if_unset("TOKIO_WORKER_THREADS", "4");
    // mimalloc: return decommitted pages to the OS promptly (100 ms after they
    // go idle) instead of holding the high-water mark.
    #[cfg(all(not(target_os = "android"), not(feature = "dhat-heap")))]
    {
        set_env_if_unset("MIMALLOC_PURGE_DELAY", "100");
    }
}

fn set_env_if_unset(key: &str, value: &str) {
    if std::env::var_os(key).is_none() {
        std::env::set_var(key, value);
    }
}

/// Wire the managed `AppState` to the running app: record the app handle, open
/// the offload store, and hydrate persisted preferences.
pub(crate) fn init_app_state(app: &mut tauri::App) {
    let state = app.state::<AppState>();
    state.set_app_handle(app.handle().clone());
    if let Err(e) = state.init_offload_store() {
        tracing::warn!("Failed to initialise offload store: {e}");
    }
    prefs::hydrate_persisted_prefs(app.handle(), &state);
}

/// Forward incoming `fancy://` URLs to the frontend as a `deep-link-open`
/// event. The frontend parses the URL and routes accordingly (e.g.
/// `fancy://marketplace/plugin/<id>` opens the plugin detail page). Also
/// focuses the main window so the user sees the result.
pub(crate) fn setup_deep_link_handler(handle: tauri::AppHandle) {
    use tauri_plugin_deep_link::DeepLinkExt;

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    match handle.deep_link().register("fancy") {
        Ok(()) => tracing::info!("deep-link: registered fancy:// scheme"),
        Err(e) => tracing::warn!("deep-link: failed to register fancy:// scheme: {e}"),
    }

    let dispatch_handle = handle.clone();
    let _registration = handle.deep_link().on_open_url(move |event| {
        let urls: Vec<String> = event.urls().iter().map(ToString::to_string).collect();
        if urls.is_empty() {
            return;
        }
        tracing::info!("deep-link: received {} url(s): {:?}", urls.len(), urls);
        #[cfg(not(target_os = "android"))]
        if let Some(win) = dispatch_handle.get_webview_window("main") {
            let _ = win.show();
            let _ = win.unminimize();
            let _ = win.set_focus();
        }
        use tauri::Emitter;
        for url in urls {
            let _ = dispatch_handle.emit("deep-link-open", url);
        }
    });
}

#[cfg(test)]
mod tests {
    /// Every window named by a capability must be granted `store:default` by
    /// one of them.
    ///
    /// Every window - main, popouts, overlays, updater - boots through
    /// `UiRoot`, which reads the chosen UI pack out of the preferences store
    /// before it renders anything. A window no capability grants the store
    /// gets its `plugin:store|load` denied by the ACL, the design never
    /// resolves, and the window paints an empty page with no error on screen.
    /// That is how the drawing overlay and the image popout were both blank;
    /// the failure is silent, so it is guarded here.
    #[test]
    fn every_window_is_granted_the_preferences_store() {
        let capabilities = load_capabilities();
        let mut ungranted = Vec::new();

        for (path, windows, _) in &capabilities {
            for window in windows {
                let granted = capabilities
                    .iter()
                    .filter(|(_, _, store)| *store)
                    .any(|(_, patterns, _)| patterns.iter().any(|p| covers(p, window)));
                if !granted {
                    ungranted.push(format!("{window} (in {})", path.display()));
                }
            }
        }

        assert!(
            ungranted.is_empty(),
            "windows no capability grants a `store:` permission - they boot through UiRoot, \
             which cannot read the UI pack out of preferences and so renders nothing at all:\n{}",
            ungranted.join("\n")
        );
    }

    /// Path, window patterns and whether the capability grants the store, for
    /// every `*.json` under `capabilities/` - including the subdirectories
    /// Tauri also reads (e.g. `self-updater/`).
    fn load_capabilities() -> Vec<(std::path::PathBuf, Vec<String>, bool)> {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("capabilities");
        json_files(&dir)
            .into_iter()
            .map(|path| {
                let json: serde_json::Value =
                    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
                let strings = |key: &str| {
                    json[key]
                        .as_array()
                        .map(|values| {
                            values
                                .iter()
                                .filter_map(serde_json::Value::as_str)
                                .map(str::to_owned)
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                };
                let grants_store = strings("permissions")
                    .iter()
                    .any(|p| p.starts_with("store:"));
                (path, strings("windows"), grants_store)
            })
            .collect()
    }

    /// Whether capability window pattern `pattern` applies to every window the
    /// pattern `window` can name. Tauri's globs only ever end in `*` here.
    fn covers(pattern: &str, window: &str) -> bool {
        match pattern.strip_suffix('*') {
            Some(prefix) => window.starts_with(prefix),
            None => pattern == window,
        }
    }

    fn json_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                out.extend(json_files(&path));
            } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                out.push(path);
            }
        }
        out
    }
}
