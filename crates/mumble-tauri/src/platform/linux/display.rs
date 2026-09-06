//! Which display server GTK actually connected to, and what that costs us.
//!
//! Linux is two platforms wearing one target triple. Under X11 a client may
//! place its own windows and ask to stay above others; under Wayland it may
//! do neither - `gtk_window_move` and `gtk_window_set_keep_above` are silent
//! no-ops there, which is how an overlay ends up in the middle of the wrong
//! screen with a game painted over it.
//!
//! The app defaults to `GDK_BACKEND=x11` for exactly that reason
//! ([`super::webview::pre_init`]), so this is normally [`DisplayBackend::X11`]
//! even on a Wayland session (through `XWayland`). It is Wayland when the
//! environment already set `GDK_BACKEND`, or inside the `AppImage`, which
//! forces the native backend on Wayland sessions.
//!
//! The answer comes from GDK rather than from environment variables because
//! `GDK_BACKEND` is a *request*: GTK falls back to whatever it could open,
//! and only the display it ended up with says what the window API will do.

use std::sync::OnceLock;

/// The display server GTK is talking to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum DisplayBackend {
    /// X11 or `XWayland`: windows can be positioned and kept on top.
    X11,
    /// Native Wayland: the compositor owns placement and stacking. Only a
    /// layer surface ([`super::layer_shell`]) can pin anything.
    Wayland,
    /// GDK reported something else, or was not up yet when asked. Treated as
    /// "assume the capable path and let the individual calls fail" - the
    /// alternative is refusing features on a display that may be fine.
    Unknown,
}

/// Cached because it cannot change while the process runs, and because
/// `gdk::Display::default()` is only valid on the main thread - the value is
/// captured once from the setup hook and read from anywhere afterwards.
static BACKEND: OnceLock<DisplayBackend> = OnceLock::new();

/// Record the backend GTK connected to. Called once, on the main thread,
/// after Tauri has initialised GTK.
pub(crate) fn detect_on_main_thread() {
    let backend = read_from_gdk();
    tracing::info!(?backend, "display: GDK backend");
    let _ = BACKEND.set(backend);
}

/// The display server GTK is talking to.
pub(crate) fn backend() -> DisplayBackend {
    BACKEND.get().copied().unwrap_or(DisplayBackend::Unknown)
}

fn read_from_gdk() -> DisplayBackend {
    use gtk::gdk::prelude::DisplayExtManual as _;

    let Some(display) = gtk::gdk::Display::default() else {
        return DisplayBackend::Unknown;
    };
    // gdk-rs types the backend by the concrete GdkDisplay subclass, which is
    // the ground truth: `GdkWaylandDisplay` vs `GdkX11Display`.
    match display.backend() {
        gtk::gdk::Backend::Wayland => DisplayBackend::Wayland,
        gtk::gdk::Backend::X11 => DisplayBackend::X11,
        _ => DisplayBackend::Unknown,
    }
}
