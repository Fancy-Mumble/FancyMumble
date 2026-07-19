//! Tauri command handlers, grouped into logical submodules.
//!
//! All `#[tauri::command]` functions live here, organised by feature
//! area.  The single `tauri::generate_handler!` registration lives in
//! [`registry`]; `lib.rs` only contains application bootstrap.

pub(crate) mod registry;

pub(crate) mod account;
pub(crate) mod admin;
pub(crate) mod audio;
pub(crate) mod certificates;
pub(crate) mod channels;
pub(crate) mod connection;
pub(crate) mod dm;
pub(crate) mod draw_overlay;
pub(crate) mod files;
pub(crate) mod image;
pub(crate) mod keyshare;
pub(crate) mod messaging;
pub(crate) mod offload;
pub(crate) mod onboarding;
pub(crate) mod plugin_admin;
pub(crate) mod audit;
pub(crate) mod plugin_info;
pub(crate) mod popout;
pub(crate) mod profile;
pub(crate) mod public_servers;
pub(crate) mod realtime;
/// Screen-share BROADCASTING needs OS capture APIs unavailable on Android.
/// Viewing does not live here: it is the webview viewer layer plus the
/// platform-independent `send_webrtc_signal`, so Android watches streams
/// without this module.
#[cfg(not(target_os = "android"))]
pub(crate) mod screenshare;
/// Native stream viewer commands (Linux + opt-in Windows); loud stubs on
/// every other platform, Android included, so a stray invoke fails with a
/// message instead of "command not found".
pub(crate) mod stream_view;
pub(crate) mod server;
pub(crate) mod server_settings;
pub(crate) mod servers;
pub(crate) mod system;
pub(crate) mod ui_mode;
pub(crate) mod window;
