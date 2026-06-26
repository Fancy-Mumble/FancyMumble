//! Application bootstrap.
//!
//! The wiring `run()` (in `lib.rs`) performs at startup - runtime-env tuning,
//! the plugin builder, state hydration, the deep-link handler and (desktop)
//! WebView2 memory management - lives here so the crate-root entry point stays
//! focused on the event loop. Command registration is in [`crate::commands::registry`].

pub(crate) mod builder;
pub(crate) mod prefs;

#[cfg(all(dev, not(target_os = "android")))]
pub(crate) mod dev_server;

#[cfg(target_os = "windows")]
pub(crate) mod webview;

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
