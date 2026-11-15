//! Linux-specific platform integrations.
//!
//! - [`desktop`]: `.desktop` file, icon installation, quick-action IPC.
//! - [`display`]: which display server GTK connected to (X11 vs Wayland).
//! - [`layer_shell`]: `wlr-layer-shell` overlay surfaces, where supported.
//! - [`webview`]: `WebKitGTK` / `AppImage` environment workarounds.

pub(crate) mod desktop;
pub(crate) mod display;
pub(crate) mod layer_shell;
pub(crate) mod webview;
