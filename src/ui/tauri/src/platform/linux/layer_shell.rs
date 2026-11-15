//! `wlr-layer-shell` overlay surfaces, for the one thing a Wayland client
//! otherwise cannot do: cover a specific output, above everything else.
//!
//! A Wayland toplevel has no say in where it goes or what it goes above, so
//! the drawing overlay - whose whole job is to sit exactly over the shared
//! screen - cannot be a toplevel there. `zwlr_layer_shell_v1` is the protocol
//! that grants precisely that, and `libgtk-layer-shell` is the GTK3 binding
//! for it: a few calls on a `GtkWindow` before it is realized turn it into a
//! layer surface, and GTK/webkit carry on drawing into it as usual.
//!
//! **Loaded at runtime, never linked.** The library is a small optional
//! package (`libgtk-layer-shell0` on Debian/Ubuntu, `gtk-layer-shell` on
//! Arch/Fedora) and the Rust binding crate for it is archived
//! (RUSTSEC-2024-0422), so this dlopens the C library and degrades to
//! [`is_supported`] returning `false` when it is absent. That is the same
//! answer a compositor without the protocol gives, and the caller needs one
//! code path for both.
//!
//! **Compositor support** is the real limit: `KWin`, wlroots (sway, Hyprland),
//! COSMIC and niri implement the protocol; GNOME/Mutter has refused it for
//! years (mutter#973), so on a native-Wayland GNOME session there is no way
//! to place an overlay at all and the caller must say so rather than open a
//! window that lands in the wrong place.

#![allow(
    unsafe_code,
    reason = "dlopen + C calls into libgtk-layer-shell; every call is \
              wrapped with an explicit SAFETY note and the symbols are \
              resolved by name from a library kept alive for the process."
)]

use std::sync::OnceLock;

use gtk::glib::translate::ToGlibPtr as _;
use gtk::prelude::Cast as _;
use libloading::{Library, Symbol};

/// `GTK_LAYER_SHELL_LAYER_OVERLAY`: above every normal window, and above
/// the top layer that panels use.
const LAYER_OVERLAY: u32 = 3;
/// `GTK_LAYER_SHELL_KEYBOARD_MODE_NONE`: never take keyboard focus. The
/// overlay is click-through and has nothing to type into.
const KEYBOARD_MODE_NONE: u32 = 0;
/// `GtkLayerShellEdge` values, in header order.
const EDGES: [u32; 4] = [0, 1, 2, 3];
/// Anchoring to all four edges is what stretches the surface across the
/// whole output; anchoring to none would let the compositor size it.
const ANCHOR: i32 = 1;
/// A negative exclusive zone means "do not reserve space, and do not let
/// panels push me around" - the overlay must cover the output edge to edge,
/// including whatever a panel occupies.
const EXCLUSIVE_ZONE_IGNORE: i32 = -1;

/// The name a compositor and its window rules see this surface as. Stable
/// on purpose: it is the handle users need for a "hide this from my
/// screencast" rule (niri `layer-rule`, Hyprland `layerrule`).
pub(crate) const NAMESPACE: &str = "fancy-mumble-draw-overlay";

/// The C entry points this module needs, resolved once.
struct LayerShell {
    // `Library` must outlive every symbol taken from it; symbols are looked
    // up per call against this field rather than stored as raw pointers.
    library: Library,
}

/// Resolved (or definitively unavailable) `libgtk-layer-shell`.
static LIBRARY: OnceLock<Option<LayerShell>> = OnceLock::new();

fn library() -> Option<&'static LayerShell> {
    LIBRARY
        .get_or_init(|| {
            // SAFETY: dlopen of a system library by soname. Loading runs the
            // library's initialisers, which for gtk-layer-shell only register
            // Wayland protocol hooks with the GTK it is already linked
            // against - the same library this process uses.
            let library = unsafe { Library::new("libgtk-layer-shell.so.0") };
            match library {
                Ok(library) => {
                    tracing::info!("layer-shell: libgtk-layer-shell loaded");
                    Some(LayerShell { library })
                }
                Err(e) => {
                    tracing::info!("layer-shell: unavailable ({e})");
                    None
                }
            }
        })
        .as_ref()
}

impl LayerShell {
    /// Look up one symbol. Failure means a library that is not the one we
    /// think it is, which is reported and treated as unsupported.
    fn symbol<T>(&self, name: &[u8]) -> Option<Symbol<'_, T>> {
        // SAFETY: the caller states the C signature for `name`; each call
        // site below uses the prototype from `gtk-layer-shell.h`.
        match unsafe { self.library.get::<T>(name) } {
            Ok(symbol) => Some(symbol),
            Err(e) => {
                tracing::warn!(
                    symbol = %String::from_utf8_lossy(name),
                    "layer-shell: symbol missing ({e})"
                );
                None
            }
        }
    }
}

/// Whether a layer surface can actually be created here: the library is
/// present AND the compositor implements the protocol.
///
/// May block for one Wayland round trip the first time it is called, which
/// is why the answer is cached.
pub(crate) fn is_supported() -> bool {
    static SUPPORTED: OnceLock<bool> = OnceLock::new();
    *SUPPORTED.get_or_init(|| {
        let Some(shell) = library() else {
            return false;
        };
        let Some(supported) =
            shell.symbol::<unsafe extern "C" fn() -> i32>(b"gtk_layer_is_supported\0")
        else {
            return false;
        };
        // SAFETY: no arguments, returns a gboolean; safe to call once GTK is
        // initialised, which it is by the time any window exists.
        let supported = unsafe { supported() } != 0;
        tracing::info!(supported, "layer-shell: compositor support");
        supported
    })
}

/// Turn `window` into a full-output overlay layer surface on `monitor`.
///
/// Must be called on the main thread, and BEFORE the window is realized -
/// the layer surface replaces the toplevel that realizing would otherwise
/// create. Returns an error string suitable for surfacing to the user.
pub(crate) fn make_overlay(
    window: &gtk::ApplicationWindow,
    monitor: Option<&gtk::gdk::Monitor>,
) -> Result<(), String> {
    let shell = library().ok_or("libgtk-layer-shell is not installed")?;
    let init = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow)>(b"gtk_layer_init_for_window\0")
        .ok_or("gtk_layer_init_for_window missing")?;
    let set_layer = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, u32)>(b"gtk_layer_set_layer\0")
        .ok_or("gtk_layer_set_layer missing")?;
    let set_anchor = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, u32, i32)>(
            b"gtk_layer_set_anchor\0",
        )
        .ok_or("gtk_layer_set_anchor missing")?;
    let set_exclusive_zone = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, i32)>(
            b"gtk_layer_set_exclusive_zone\0",
        )
        .ok_or("gtk_layer_set_exclusive_zone missing")?;
    let set_keyboard_mode = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, u32)>(
            b"gtk_layer_set_keyboard_mode\0",
        )
        .ok_or("gtk_layer_set_keyboard_mode missing")?;
    let set_namespace = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, *const std::os::raw::c_char)>(
            b"gtk_layer_set_namespace\0",
        )
        .ok_or("gtk_layer_set_namespace missing")?;
    let set_monitor = shell
        .symbol::<unsafe extern "C" fn(*mut gtk::ffi::GtkWindow, *mut gtk::gdk::ffi::GdkMonitor)>(
            b"gtk_layer_set_monitor\0",
        )
        .ok_or("gtk_layer_set_monitor missing")?;

    // The C API takes a GtkWindow*, so go through the parent class rather
    // than casting the GtkApplicationWindow pointer by hand.
    let window: &gtk::Window = window.upcast_ref();
    let raw: *mut gtk::ffi::GtkWindow = window.to_glib_none().0;
    let namespace = std::ffi::CString::new(NAMESPACE).map_err(|e| e.to_string())?;

    // SAFETY: `raw` is a live GtkWindow borrowed for this call, the enum
    // values are from `gtk-layer-shell.h`, and `namespace` outlives the call
    // (the library copies the string). Ordering follows the library's
    // contract: init first, everything else before the window is mapped.
    unsafe {
        init(raw);
        set_layer(raw, LAYER_OVERLAY);
        for edge in EDGES {
            set_anchor(raw, edge, ANCHOR);
        }
        set_exclusive_zone(raw, EXCLUSIVE_ZONE_IGNORE);
        set_keyboard_mode(raw, KEYBOARD_MODE_NONE);
        set_namespace(raw, namespace.as_ptr());
        if let Some(monitor) = monitor {
            set_monitor(raw, monitor.to_glib_none().0);
        }
    }
    tracing::info!(
        monitor = monitor.is_some(),
        "layer-shell: overlay surface configured"
    );
    Ok(())
}

/// The `GdkMonitor` whose logical geometry matches `logical` (origin and,
/// when given, extent), for handing to [`make_overlay`].
///
/// Main thread only. `None` when nothing matches, which leaves the
/// compositor to choose the output - the best remaining answer.
pub(crate) fn monitor_at_logical(
    logical_position: Option<(i32, i32)>,
    logical_size: Option<(i32, i32)>,
) -> Option<gtk::gdk::Monitor> {
    use gtk::prelude::MonitorExt as _;

    let (x, y) = logical_position?;
    let display = gtk::gdk::Display::default()?;
    (0..display.n_monitors())
        .filter_map(|i| display.monitor(i))
        .find(|monitor| {
            let geometry = monitor.geometry();
            let origin_matches = geometry.x() == x && geometry.y() == y;
            let size_matches = logical_size.is_none_or(|(w, h)| {
                // A compositor may report either the logical extent or the
                // scaled one for the same output; accept the origin alone
                // when the extent disagrees, since origins are unique.
                geometry.width() == w && geometry.height() == h
            });
            origin_matches && size_matches
        })
        .or_else(|| {
            // Origin matched nothing with the extent; try the origin alone.
            let display = gtk::gdk::Display::default()?;
            (0..display.n_monitors())
                .filter_map(|i| display.monitor(i))
                .find(|monitor| {
                    let geometry = monitor.geometry();
                    geometry.x() == x && geometry.y() == y
                })
        })
}
