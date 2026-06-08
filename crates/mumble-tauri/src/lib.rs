//! Tauri application entry point.
//!
//! All `#[tauri::command]` handlers live in the [`commands`] submodule;
//! this file is responsible for wiring the application together
//! (logging, plugins, state, command registration and the event loop).
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

mod audio;
pub(crate) mod commands;
pub mod platform;
mod state;
#[cfg(not(target_os = "android"))]
mod updater;

use state::AppState;
use std::sync::OnceLock;
use tauri::Manager;
use tracing_subscriber::EnvFilter;
use tracing_subscriber::prelude::*;
use tracing_subscriber::reload;

/// Global handle for reloading the tracing filter at runtime.
pub(crate) static LOG_RELOAD_HANDLE: OnceLock<reload::Handle<EnvFilter, tracing_subscriber::Registry>> =
    OnceLock::new();

/// Manages the Vite dev server when the app is run via plain `cargo run`.
///
/// `cargo tauri dev` starts the dev server (its `beforeDevCommand`) and kills
/// it when the app exits. A plain `cargo run` of a dev build (anything without
/// the `custom-protocol` feature, e.g. profiling with `--features dhat-heap`)
/// loads the same dev URL but does NOT manage the server, leaving a stray Vite
/// holding the port. This module starts Vite on launch and tears it down on
/// exit so the dev server's lifetime follows the app. It is compiled only into
/// dev builds (`cfg(dev)`), so it is absent from production binaries.
#[cfg(all(dev, not(target_os = "android")))]
mod dev_server {
    use std::net::{SocketAddr, TcpStream};
    use std::process::Child;
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    /// The dev-server port (must match `build.devUrl` in `tauri.conf.json`).
    const DEV_PORT: u16 = 1420;

    /// Holds the spawned Vite child so [`stop`] can terminate it on exit.
    static DEV_SERVER: Mutex<Option<Child>> = Mutex::new(None);

    /// Whether something is already serving the dev URL.
    fn port_in_use() -> bool {
        let addr = SocketAddr::from(([127, 0, 0, 1], DEV_PORT));
        TcpStream::connect_timeout(&addr, Duration::from_millis(300)).is_ok()
    }

    /// Spawn the Vite dev server unless one is already running on the port
    /// (e.g. under `cargo tauri dev`, which owns its own server).
    pub(super) fn start() {
        if port_in_use() {
            tracing::info!("dev server already on :{DEV_PORT}; leaving it to its owner");
            return;
        }
        let ui_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("ui");
        // `npm` is `npm.cmd` on Windows, which is only resolvable through the
        // shell, so route the command through `cmd /C` there.
        let mut cmd = if cfg!(windows) {
            let mut c = std::process::Command::new("cmd");
            let _ = c.args(["/C", "npm", "run", "dev"]);
            c
        } else {
            let mut c = std::process::Command::new("npm");
            let _ = c.args(["run", "dev"]);
            c
        };
        let _ = cmd.current_dir(&ui_dir);
        match cmd.spawn() {
            Ok(child) => {
                tracing::info!(pid = child.id(), "started Vite dev server");
                if let Ok(mut guard) = DEV_SERVER.lock() {
                    *guard = Some(child);
                }
                wait_until_ready();
            }
            Err(e) => tracing::warn!("failed to start Vite dev server: {e}"),
        }
    }

    /// Block (briefly) until the dev server accepts connections so the webview
    /// does not load before Vite is ready (which shows `ERR_CONNECTION_REFUSED`).
    fn wait_until_ready() {
        let deadline = Instant::now() + Duration::from_secs(30);
        while Instant::now() < deadline {
            if port_in_use() {
                return;
            }
            std::thread::sleep(Duration::from_millis(200));
        }
        tracing::warn!("Vite dev server did not come up within 30s");
    }

    /// Terminate the spawned dev server (and its `node` child) if we started it.
    pub(super) fn stop() {
        let child = DEV_SERVER.lock().ok().and_then(|mut g| g.take());
        if let Some(mut child) = child {
            let pid = child.id();
            // `cmd /C npm run dev` spawns a `node` grandchild; kill the whole
            // tree, otherwise Vite keeps holding the port after the app exits.
            #[cfg(windows)]
            {
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .output();
            }
            let _ = child.kill();
            let _ = child.wait();
            tracing::info!(pid, "stopped Vite dev server");
        }
    }
}

/// Entry point for the Tauri application.
///
/// Initialises the TLS crypto provider, sets up logging, registers all
/// Tauri commands, and starts the application event loop.
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

    configure_runtime_env();

    if platform::try_single_instance() {
        return;
    }

    platform::init();
    init_logging();
    platform::check_dependencies();

    // When run via plain `cargo run` (not `cargo tauri dev`), start the Vite
    // dev server so it is available for the webview and torn down on exit.
    #[cfg(all(dev, not(target_os = "android")))]
    dev_server::start();

    let builder = create_base_builder();
    let builder = register_commands(builder);

    builder
        .manage(AppState::new())
        .setup(move |app| {
            init_app_state(app);
            platform::setup(app.handle().clone());
            setup_deep_link_handler(app.handle().clone());
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
                dev_server::stop();
                if let Some(state) = app.try_state::<AppState>() {
                    state.shutdown_offload_store();
                }
                platform::teardown();
            }
        });
}

/// Configure environment variables that influence the Tokio runtime
/// that Tauri spawns.
///
/// Must be called before any Tokio code runs so the settings are picked
/// up at initialisation time.
///
/// **Tokio** (`TOKIO_WORKER_THREADS`):
/// Tauri uses `#[tokio::main]` internally with default worker count =
/// number of logical CPUs.  Mumble I/O is light (a TCP socket, a UDP
/// socket, occasional file I/O); 4 worker threads is plenty.  Each thread
/// reserves ~2 MB of address space for its stack, so capping this saves
/// stack reservations on machines with many cores.
///
/// We deliberately do NOT pass `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`
/// flags here.  Experimenting with `--in-process-gpu` saved ~40 MB of
/// private memory but cost ~7% sustained idle CPU (battery drain),
/// because the in-process compositor never goes fully idle.  Keeping
/// the `WebView2` defaults turns out to be the better trade-off.
fn configure_runtime_env() {
    set_env_if_unset("TOKIO_WORKER_THREADS", "4");
    // mimalloc: return decommitted pages to the OS promptly (100 ms after
    // they go idle) instead of holding the high-water mark. Cheap for our
    // bursty allocation pattern (startup + occasional messages/audio).
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

fn init_logging() {
    let default_filter = std::env::var("RUST_LOG").unwrap_or_else(|_| "info".into());
    let filter = EnvFilter::try_new(&default_filter).unwrap_or_else(|_| EnvFilter::new("info"));
    let (filter_layer, reload_handle) = reload::Layer::new(filter);
    tracing_subscriber::registry()
        .with(filter_layer)
        .with(tracing_subscriber::fmt::layer())
        .init();
    let _ = LOG_RELOAD_HANDLE.set(reload_handle);
}

fn init_app_state(app: &mut tauri::App) {
    let state = app.state::<AppState>();
    state.set_app_handle(app.handle().clone());
    if let Err(e) = state.init_offload_store() {
        tracing::warn!("Failed to initialise offload store: {e}");
    }
    hydrate_persisted_prefs(app.handle(), &state);
}

/// Read `preferences.json` (written by `@tauri-apps/plugin-store`) and
/// hydrate the backend `AppState` with the user's persisted audio
/// settings, notification toggle, dual-path toggle and log level.
///
/// Without this step the backend stays on its built-in defaults until
/// the frontend gets around to invoking the per-setting commands, which
/// races against the user enabling voice and produces noticeably worse
/// audio (wrong VAD threshold, wrong device, wrong denoiser, etc.) for
/// the first call after launch.
fn hydrate_persisted_prefs(app: &tauri::AppHandle, state: &AppState) {
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
        if let Some(handle) = LOG_RELOAD_HANDLE.get() {
            if let Ok(filter) = EnvFilter::try_new(&level) {
                let _ = handle.reload(filter);
                tracing::info!("hydrate_persisted_prefs: log level = {level}");
            }
        }
    }
}

/// Forward incoming `fancy://` URLs to the frontend as a
/// `deep-link-open` event.  The frontend parses the URL and routes
/// accordingly (e.g. `fancy://marketplace/plugin/<id>` opens the
/// plugin detail page in the marketplace).  Also focuses the main
/// window so the user sees the result.
fn setup_deep_link_handler(handle: tauri::AppHandle) {
    #[cfg(not(target_os = "android"))]
    use tauri::Manager;
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

fn create_base_builder() -> tauri::Builder<tauri::Wry> {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("connection-service")
            .setup(|app, api| {
                let handle = api.register_android_plugin(
                    "com.fancymumble.app",
                    "ConnectionServicePlugin",
                )?;
                let cs_handle = platform::android::connection_service::ConnectionServiceHandle(handle);
                platform::android::connection_service::register_disconnect_listener(&cs_handle, app.clone());
                platform::android::connection_service::register_navigate_listener(&cs_handle, app.clone());
                let _ = app.manage(cs_handle);
                Ok(())
            })
            .build(),
    );

    #[cfg(target_os = "android")]
    let builder = builder.plugin(
        tauri::plugin::Builder::<tauri::Wry, ()>::new("fcm-service")
            .setup(|app, api| {
                let handle = api.register_android_plugin(
                    "com.fancymumble.app",
                    "FcmPlugin",
                )?;
                let fcm_handle = platform::android::fcm_service::FcmPluginHandle(handle);
                let _ = app.manage(fcm_handle);
                Ok(())
            })
            .build(),
    );

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            // Restore size/position/maximised state, but NEVER restore
            // visibility. The updater module decides whether the main
            // window should appear on launch.
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::all()
                    & !tauri_plugin_window_state::StateFlags::VISIBLE,
            )
            // Don't track the updater window - it has a fixed size set
            // in window.rs that must not be overridden by stale state.
            .with_denylist(&[updater::UPDATER_WINDOW_LABEL])
            .build(),
    );

    #[cfg(not(target_os = "android"))]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    #[cfg(not(target_os = "android"))]
    let builder = updater::register_plugins(builder);

    builder
}

macro_rules! all_command_handlers {
    () => {
        tauri::generate_handler![
            commands::connection::connect,
            commands::certificates::generate_certificate,
            commands::certificates::list_certificates,
            commands::certificates::delete_certificate,
            commands::certificates::export_certificate,
            commands::certificates::import_certificate,
            commands::certificates::sign_document,
            commands::connection::disconnect,
            commands::connection::get_status,
            commands::servers::list_servers,
            commands::servers::get_active_server,
            commands::servers::set_active_server,
            commands::servers::disconnect_server,
            commands::servers::find_user_by_hash,
            commands::servers::find_user_in_server,
            commands::channels::get_channels,
            commands::channels::get_users,
            commands::channels::get_user_texture,
            commands::channels::get_registered_user_texture,
            commands::channels::get_user_comment,
            commands::channels::get_channel_description,
            commands::messaging::get_messages,
            commands::messaging::send_message,
            commands::messaging::edit_message,
            commands::channels::select_channel,
            commands::channels::join_channel,
            commands::channels::get_current_channel,
            commands::channels::toggle_listen,
            commands::channels::get_listened_channels,
            commands::channels::get_push_subscribed_channels,
            commands::channels::get_unread_counts,
            commands::channels::mark_channel_read,
            commands::server::get_server_config,
            commands::server::get_server_info,
            commands::server::get_welcome_text,
            commands::channels::update_channel,
            commands::channels::create_channel,
            commands::channels::delete_channel,
            commands::server::ping_server,
            commands::public_servers::fetch_public_servers,
            commands::public_servers::fetch_file_server_capabilities,
            commands::audio::get_audio_devices,
            commands::audio::get_output_devices,
            commands::audio::get_audio_settings,
            commands::audio::get_denoiser_param_specs,
            commands::audio::get_available_denoiser_algorithms,
            commands::audio::set_audio_settings,
            commands::audio::set_audio_backend,
            commands::audio::get_audio_backend,
            commands::audio::get_voice_state,
            commands::audio::enable_voice,
            commands::audio::disable_voice,
            commands::audio::toggle_mute,
            commands::audio::toggle_deafen,
            commands::audio::push_to_talk_start,
            commands::audio::push_to_talk_end,
            commands::audio::voice_priority_start,
            commands::audio::voice_priority_end,
            commands::audio::set_user_volume,
            commands::audio::start_mic_test,
            commands::audio::stop_mic_test,
            commands::audio::calibrate_voice_threshold,
            commands::audio::start_voice_replay,
            commands::audio::stop_voice_replay,
            commands::audio::start_latency_test,
            commands::audio::stop_latency_test,
            commands::audio::start_recording,
            commands::audio::stop_recording,
            commands::audio::get_recording_state,
            commands::profile::set_user_comment,
            commands::profile::set_user_texture,
            commands::profile::get_own_session,
            commands::profile::send_plugin_data,
            commands::profile::send_plugin_message,
            commands::profile::send_fancy_poll,
            commands::profile::send_fancy_poll_vote,
            commands::files::upload_file,
            commands::files::upload_bytes,
            commands::files::upload_binary,
            commands::files::cancel_upload,
            commands::files::download_file,
            commands::files::download_to_base64,
            commands::files::fileserver_admin_list_files,
            commands::files::fileserver_admin_list_documents,
            commands::files::fileserver_admin_delete_file,
            commands::files::fileserver_admin_delete_document,
            commands::files::fileserver_admin_file_base64,
            commands::files::fileserver_my_list_files,
            commands::files::fileserver_my_delete_file,
            commands::files::fileserver_my_file_base64,
            commands::files::fileserver_my_file_link,
            commands::files::fileserver_get_private,
            commands::files::fileserver_put_private,
            commands::files::save_markdown_file,
            commands::files::add_custom_emote,
            commands::files::remove_custom_emote,
            commands::files::write_translation_files,
            commands::files::check_files_exist,
            commands::realtime::send_push_update,
            commands::realtime::send_subscribe_push,
            commands::messaging::send_read_receipt,
            commands::messaging::query_read_receipts,
            commands::messaging::send_typing_indicator,
            commands::messaging::send_watch_sync,
            commands::messaging::send_draw_stroke,
            commands::messaging::request_link_preview,
            commands::realtime::send_webrtc_signal,
            commands::messaging::send_reaction,
            commands::messaging::pin_message,
            commands::messaging::delete_pchat_messages,
            commands::messaging::plugin_inject_chat_message,
            commands::messaging::plugin_update_chat_message,
            commands::dm::send_dm,
            commands::dm::get_dm_messages,
            commands::dm::select_dm_user,
            commands::dm::get_dm_unread_counts,
            commands::dm::mark_dm_read,
            commands::system::reset_app_data,
            commands::system::set_log_level,
            commands::system::set_notifications_enabled,
            commands::system::set_disable_dual_path,
            commands::system::update_badge_count,
            commands::system::get_system_clock_format,
            commands::offload::offload_message,
            commands::offload::load_offloaded_message,
            commands::offload::load_offloaded_messages_batch,
            commands::offload::clear_offloaded_messages,
            commands::offload::fetch_older_messages,
            commands::offload::get_debug_stats,
            commands::messaging::super_search,
            commands::messaging::get_photos,
            commands::admin::kick_user,
            commands::admin::ban_user,
            commands::admin::register_user,
            commands::admin::mute_user,
            commands::admin::deafen_user,
            commands::admin::set_priority_speaker,
            commands::admin::reset_user_comment,
            commands::admin::remove_user_avatar,
            commands::admin::move_user_to_channel,
            commands::admin::move_channel_users,
            commands::admin::request_user_stats,
            commands::admin::request_user_list,
            commands::admin::update_user_list,
            commands::admin::request_user_comment,
            commands::admin::request_ban_list,
            commands::admin::update_ban_list,
            commands::admin::request_acl,
            commands::admin::update_acl,
            commands::onboarding::get_onboarding_config,
            commands::onboarding::get_onboarding_response,
            commands::onboarding::save_onboarding_config,
            commands::onboarding::submit_onboarding_response,
            commands::onboarding::request_onboarding_response,
            commands::server_settings::get_server_settings,
            commands::server_settings::save_server_settings,
            commands::plugin_admin::get_plugin_registry,
            commands::plugin_admin::get_plugin_broadcasts,
            commands::plugin_admin::request_server_plugins,
            commands::plugin_admin::set_server_plugin_enabled,
            commands::plugin_admin::install_server_plugin,
            commands::plugin_admin::uninstall_server_plugin,
            commands::plugin_admin::fetch_plugin_manifest_sha256,
            commands::plugin_admin::fetch_marketplace_index,
            commands::plugin_admin::fetch_marketplace_plugin,
            commands::keyshare::confirm_custodians,
            commands::keyshare::accept_custodian_changes,
            commands::keyshare::approve_key_share,
            commands::keyshare::dismiss_key_share,
            commands::keyshare::query_key_holders,
            commands::keyshare::get_key_holders,
            commands::keyshare::key_takeover,
            commands::image::blur_image,
            commands::image::process_background,
            commands::plugin_info::decode_plugin_info,
            commands::popout::open_image_popout,
            commands::popout::take_popout_image,
            commands::popout::open_stream_popout,
            commands::popout::take_popout_stream,
            commands::popout::open_dm_popout,
            commands::popout::take_popout_dm,
            commands::popout::open_translation_popout,
            commands::draw_overlay::open_drawing_overlay,
            commands::draw_overlay::close_drawing_overlay,
            commands::draw_overlay::take_drawing_overlay_context,
            commands::window::set_window_aspect_ratio,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_check,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_pending,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_download_and_install,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_dismiss,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_set_auto_install,
            #[cfg(not(target_os = "android"))]
            updater::commands::updater_set_skipped_version,
        ]
    };
}

fn register_commands(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder.invoke_handler(all_command_handlers!())
}
