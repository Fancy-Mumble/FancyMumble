//! Windows platform: deep-link single-instance IPC and DWM window chrome.
//!
//! # Deep links
//!
//! When the user clicks a `fancy://` link in the browser, Windows spawns a
//! fresh process instead of activating the running one.  To forward the URL
//! to the already-open instance we use a TCP loopback listener:
//!
//! - Every instance attempts to bind `127.0.0.1:DEEP_LINK_PORT` on startup.
//!   The first to succeed becomes the "deep-link handler" for the session.
//! - A process launched via the URL scheme checks for a `fancy://` argument.
//!   If found it tries to connect to the port.  On success it writes the URL
//!   and exits immediately (no new window opened).  On failure (no one
//!   listening yet) it proceeds normally and will itself become the handler.
//! - Direct launches (dev server, clicking the .exe, etc.) do NOT check for
//!   a running instance, so multiple instances remain possible during
//!   development.

use std::io::{Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::time::Duration;

use tauri::{Emitter, Manager, WebviewWindow};
use tracing::info;
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_COLOR_NONE, DWMWA_WINDOW_CORNER_PREFERENCE,
    DWMWCP_DONOTROUND,
};

/// Loopback port used for deep-link IPC.
///
/// Chosen to be specific to this app and unlikely to conflict.
/// Falls in the IANA dynamic/private port range (49152-65535).
const DEEP_LINK_PORT: u16 = 58_722;

/// Timeout when dialling an existing instance.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);

/// Timeout when reading the URL from an incoming connection.
const READ_TIMEOUT: Duration = Duration::from_secs(2);

fn ipc_addr() -> SocketAddr {
    SocketAddr::from(([127, 0, 0, 1], DEEP_LINK_PORT))
}

/// If this process was launched via a `fancy://` URL, try to forward it to
/// an already-running instance via the IPC port.
///
/// Returns `true` when the URL was forwarded successfully (caller should
/// exit).  Returns `false` when no running instance was found (caller
/// proceeds normally) or when there is no `fancy://` argument (normal
/// launch - multiple instances are allowed).
pub fn try_forward_deep_link() -> bool {
    let url = match std::env::args().nth(1) {
        Some(a) if a.starts_with("fancy://") => a,
        _ => return false,
    };

    match TcpStream::connect_timeout(&ipc_addr(), CONNECT_TIMEOUT) {
        Ok(mut stream) => {
            let _ = stream.write_all(url.as_bytes());
            info!("deep-link: forwarded {url:?} to running instance, exiting");
            true
        }
        Err(_) => {
            info!("deep-link: no running instance found, handling locally");
            false
        }
    }
}

/// Attempt to bind the IPC listener port.
///
/// If the bind succeeds this instance becomes the deep-link handler:
/// URLs forwarded by later `fancy://` launches are received here and
/// re-emitted as `deep-link-open` Tauri events (which the frontend
/// already handles).  If the bind fails, another instance is already
/// the handler.
pub fn start_deep_link_listener(handle: tauri::AppHandle) {
    let Ok(listener) = TcpListener::bind(ipc_addr()) else {
        return;
    };

    info!("deep-link: IPC listener bound on {}", ipc_addr());

    let _ = std::thread::Builder::new()
        .name("deep-link-ipc".into())
        .spawn(move || run_listener(handle, listener));
}

fn run_listener(handle: tauri::AppHandle, listener: TcpListener) {
    for stream in listener.incoming() {
        let Ok(mut s) = stream else { continue };
        let _ = s.set_read_timeout(Some(READ_TIMEOUT));
        let mut buf = String::new();
        if s.read_to_string(&mut buf).is_ok() {
            let url = buf.trim();
            if url.starts_with("fancy://") {
                focus_main_window(&handle);
                let _ = handle.emit("deep-link-open", url.to_owned());
            }
        }
    }
}

fn focus_main_window(handle: &tauri::AppHandle) {
    if let Some(win) = handle.get_webview_window("main") {
        let _ = win.show();
        let _ = win.unminimize();
        let _ = win.set_focus();
    }
}

// ----- DWM window chrome -----------------------------------------------------

/// Strip the system-drawn corner rounding, border and shadow from an
/// undecorated window.
///
/// The shell paints its own outer corner (`--nebula-radius-xl`, 20 px) and
/// clips to it with `overflow: hidden`.  Windows 11 does not know that: DWM
/// still rounds the *`HWND`* at its own radius (~8 px) and strokes a border
/// plus a drop shadow along that arc.  Because the window is transparent, the
/// area between the two arcs shows nothing of ours - only DWM's leftover
/// border and shadow, which read as a ghost of the smaller radius sitting
/// outside our corner.
///
/// What actually creates the frame is `shadow: false` on the window itself
/// (`tauri.conf.json` for the main window, `.shadow(false)` on the popout
/// builders).  With the shadow on, tao insets `WM_NCCALCSIZE` to leave a
/// non-client frame for DWM to drop a shadow onto - and DWM decorates that
/// frame with its own corners and border.  Turning the shadow off is
/// therefore the fix; these two attributes only make sure nothing else DWM
/// draws survives:
///
/// - `DWMWCP_DONOTROUND` stops DWM rounding the frame at all, so nothing is
///   drawn along a radius we did not choose.
/// - `DWMWA_COLOR_NONE` removes the 1 px accent border DWM strokes around
///   the frame (which would otherwise become a *square* outline once
///   rounding is off).
///
/// Both are Windows 11 (build 22000+) only; on Windows 10
/// `DwmSetWindowAttribute` fails with `E_INVALIDARG` and there is nothing to
/// strip there anyway, so the `HRESULT` is deliberately ignored.
pub fn strip_system_chrome(win: &WebviewWindow) {
    let Ok(hwnd) = win.hwnd() else {
        return;
    };
    // tauri's HWND wraps `*mut c_void`; windows-sys wants the same pointer.
    let hwnd = hwnd.0 as windows_sys::Win32::Foundation::HWND;

    set_dwm_attribute(hwnd, DWMWA_WINDOW_CORNER_PREFERENCE, &DWMWCP_DONOTROUND);
    set_dwm_attribute(hwnd, DWMWA_BORDER_COLOR, &DWMWA_COLOR_NONE);
}

/// `DwmSetWindowAttribute` for a single `Copy` value, sized from the value
/// itself so the attribute and its width can never drift apart.
fn set_dwm_attribute<T: Copy>(
    hwnd: windows_sys::Win32::Foundation::HWND,
    attribute: windows_sys::Win32::Graphics::Dwm::DWMWINDOWATTRIBUTE,
    value: &T,
) {
    // SAFETY: `hwnd` comes from a live Tauri window, `value` is a valid
    // reference for the duration of the call, and `cbAttribute` is taken
    // from the very type being passed - the three things DWM reads.
    #[allow(
        unsafe_code,
        reason = "DwmSetWindowAttribute is raw FFI; the invariants it needs are argued above."
    )]
    // The HRESULT is the "this Windows is too old for that attribute" signal
    // and nothing more; see the doc comment on `strip_system_chrome`.
    let _ = unsafe {
        DwmSetWindowAttribute(
            hwnd,
            attribute.cast_unsigned(),
            std::ptr::from_ref(value).cast(),
            u32::try_from(size_of::<T>()).unwrap_or(0),
        )
    };
}
