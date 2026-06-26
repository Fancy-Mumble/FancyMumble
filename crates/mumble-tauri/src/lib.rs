//! Tauri application entry point.
//!
//! All `#[tauri::command]` handlers live in the [`commands`] submodule
//! (registered in [`commands::registry`]); application bootstrap (logging,
//! plugins, state hydration, the deep-link handler) lives in [`app`]. This file
//! wires those together and runs the event loop.
//!
// All public command functions receive `tauri::State` by value, which is
// required by the `#[tauri::command]` macro - suppress the lint crate-wide.
#![allow(clippy::needless_pass_by_value, reason = "tauri::command requires State<T> to be taken by value")]
// This is an application crate; pub items inside private modules are
// intentional (proc-macro visibility, Tauri command system, internal APIs).
#![allow(unreachable_pub, reason = "application crate: pub items in private modules are intentional for Tauri command system")]

// --- Global allocator -------------------------------------------------
//
// The Windows system heap holds onto the startup high-water mark (~280 MB
// of transient allocations from loading the embedded frontend, spinning up
// WebView2, and building the TLS root store) for the whole process
// lifetime, even at idle while disconnected. mimalloc returns freed pages
// to the OS, which collapses idle RSS to the genuinely-live working set.
//
// When the `dhat-heap` profiling feature is on, dhat's allocator takes the
// slot instead so we can attribute live/peak heap to allocation sites.
#[cfg(all(not(target_os = "android"), not(feature = "dhat-heap")))]
#[global_allocator]
static GLOBAL: mimalloc::MiMalloc = mimalloc::MiMalloc;

#[cfg(feature = "dhat-heap")]
#[global_allocator]
static ALLOC: dhat::Alloc = dhat::Alloc;

// Holds the dhat profiler for the program's lifetime. Tauri's `.run()` never
// returns (the platform event loop calls `std::process::exit`), so a local
// guard in `run()` would never drop and dhat would never write its output.
// We instead drop this explicitly in the `RunEvent::Exit` handler.
#[cfg(feature = "dhat-heap")]
static DHAT_PROFILER: std::sync::Mutex<Option<dhat::Profiler>> = std::sync::Mutex::new(None);

// With `dhat-heap` on, dhat owns the allocator slot, so mimalloc is linked
// but unused on desktop. Acknowledge it to keep `unused_crate_dependencies`
// quiet without dropping the dependency declaration.
#[cfg(all(not(target_os = "android"), feature = "dhat-heap"))]
use mimalloc as _;

mod app;
mod audio;
pub(crate) mod commands;
pub(crate) mod logging;
pub mod platform;
mod state;
#[cfg(not(target_os = "android"))]
mod updater;

use state::AppState;
use tauri::Manager;

/// Resolve the application data directory used for certificates, identities,
/// pchat seeds and signal state.
///
/// Honours the `FANCY_E2E_DATA_DIR` env override so each e2e test client gets an
/// isolated identity root. Tauri's `app_data_dir()` resolves via the OS
/// known-folder API (which ignores env overrides on Windows), so per-instance
/// isolation for the e2e suite requires this explicit hook. Production runs
/// (no env var set) behave exactly as before.
pub(crate) fn e2e_data_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Ok(dir) = std::env::var("FANCY_E2E_DATA_DIR") {
        if !dir.trim().is_empty() {
            return Ok(std::path::PathBuf::from(dir));
        }
    }
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Entry point for the Tauri application.
///
/// Initialises the TLS crypto provider, sets up logging, registers all Tauri
/// commands ([`commands::registry`]), and starts the application event loop.
#[allow(clippy::expect_used, reason = "Tauri builder failure during startup is unrecoverable")]
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Start heap profiling. Dropped in the `RunEvent::Exit` handler (see
    // below), which writes `dhat-heap.json` to the working dir. View it at
    // https://nnethercote.github.io/dh_view/dh_view.html.
    #[cfg(feature = "dhat-heap")]
    if let Ok(mut guard) = DHAT_PROFILER.lock() {
        *guard = Some(dhat::Profiler::new_heap());
    }

    let _ = rustls::crypto::ring::default_provider().install_default();

    app::configure_runtime_env();

    if platform::try_single_instance() {
        return;
    }

    platform::init();
    logging::init();
    platform::check_dependencies();

    // When run via plain `cargo run` (not `cargo tauri dev`), start the Vite
    // dev server so it is available for the webview and torn down on exit.
    #[cfg(all(dev, not(target_os = "android")))]
    app::dev_server::start();

    let builder = app::builder::create_base_builder();
    let builder = commands::registry::register(builder);

    builder
        .manage(AppState::new())
        .setup(move |app| {
            app::init_app_state(app);
            platform::setup(app.handle().clone());
            app::setup_deep_link_handler(app.handle().clone());
            #[cfg(not(target_os = "android"))]
            if let Err(e) = platform::desktop::tray::setup_tray(app) {
                tracing::warn!("Failed to create system tray icon: {e}");
            }
            #[cfg(not(target_os = "android"))]
            {
                // Force-hide the main window: the window-state plugin may
                // have just shown it after restoring saved geometry.
                if let Some(win) = app.get_webview_window(updater::MAIN_WINDOW_LABEL) {
                    let _ = win.hide();
                }
                updater::init(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(focused) = event {
                if let Some(state) = window.try_state::<AppState>() {
                    if let Ok(mut s) = state.inner.snapshot().lock() {
                        s.prefs.app_focused = *focused;
                    }
                }
            }
            #[cfg(target_os = "windows")]
            app::webview::update_webview_memory_target(window, event);
            #[cfg(not(target_os = "android"))]
            if matches!(event, tauri::WindowEvent::Destroyed)
                && window.label() == updater::UPDATER_WINDOW_LABEL
            {
                updater::show_main_window(&window.app_handle().clone());
            }
            // Stream popout cleanup: when one of our `popout-stream-*`
            // windows is destroyed (any cause), tell the main window so
            // it can restore the in-chat viewer / watch banner.
            #[cfg(not(target_os = "android"))]
            if matches!(event, tauri::WindowEvent::Destroyed)
                && window.label().starts_with("popout-stream-")
            {
                use tauri::{Emitter, Manager};
                if let Some(state) = window.try_state::<AppState>() {
                    let session = state
                        .popout_stream_sessions
                        .lock()
                        .ok()
                        .and_then(|mut m| m.remove(window.label()));
                    if let Some(session) = session {
                        let _ = window.app_handle().emit(
                            "stream-popout-state",
                            serde_json::json!({ "session": session, "opened": false }),
                        );
                    }
                }
            }
            // Translation popout cleanup: if the popout had the in-window
            // element picker enabled when it was destroyed (Alt+F4, tray
            // kill, ...) the main window never received a stop event and
            // its outlines would stay on screen.  Emit one here so the
            // overlay tears itself down.
            #[cfg(not(target_os = "android"))]
            if matches!(event, tauri::WindowEvent::Destroyed)
                && window.label() == "popout-translation"
            {
                use tauri::Emitter;
                let _ = window.app_handle().emit("translation-picker:stop", ());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                // Flush the dhat heap profile before the process exits.
                #[cfg(feature = "dhat-heap")]
                if let Ok(mut guard) = DHAT_PROFILER.lock() {
                    drop(guard.take());
                }
                // Tear down the Vite dev server if we started it.
                #[cfg(all(dev, not(target_os = "android")))]
                app::dev_server::stop();
                if let Some(state) = app.try_state::<AppState>() {
                    state.shutdown_offload_store();
                }
                platform::teardown();
            }
        });
}
