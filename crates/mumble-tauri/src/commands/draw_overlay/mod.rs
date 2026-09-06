//! Drawing overlay window: a transparent, click-through, always-on-top
//! window pinned over the broadcaster's shared content so they can see
//! viewer drawings on their actual screen / window.
//!
//! Properties (set at window creation):
//! - **Transparent** background so only the strokes paint over the
//!   real desktop / window.
//! - **Always-on-top** so the overlay sits above the captured source.
//! - **Click-through** (`set_ignore_cursor_events(true)`) - all
//!   pointer events pass through to whatever is underneath.
//! - **Excluded from screen capture** (`WDA_EXCLUDEFROMCAPTURE` on
//!   Windows, `NSWindowSharingNone` on macOS) so the strokes do not
//!   appear in the broadcaster's outgoing stream.
//!
//! Sizing strategy (in priority order):
//! 1. Linux, portal share: the compositor's own dialog picked the
//!    source, so the portal's report of it - which output, at what
//!    logical rect, streaming what pixel size - is the only truthful
//!    answer, and the in-app source id is advisory. See
//!    [`portal_source_placement`].
//! 2. The running Rust broadcast knows exactly which monitor or window
//!    it captures - resolve that source's screen rect directly and pin
//!    the overlay over it (window shares are then followed, by `HWND`
//!    on Windows and by X11 geometry on Linux).
//! 3. Legacy fallback when no Rust broadcast is active:
//!    (a) `display_surface == "window"` on Windows: enumerate top-level
//!    windows for one whose client area matches the captured size and
//!    pin the overlay over its screen rect, then poll for movement.
//!    (b) `display_surface == "monitor"`: pick the monitor whose pixel
//!    dimensions match the captured size and cover it fully.
//!    (c) Monitor under the cursor, then primary monitor.
//!
//! At most one overlay window per app process; reopening replaces the
//! previous one.

use crate::state::AppState;

#[cfg(not(target_os = "android"))]
use crate::platform::window::WindowExt;

#[cfg(any(target_os = "windows", target_os = "linux"))]
mod tracker;
#[cfg(target_os = "windows")]
mod win_tracker;

/// Stable label used for the (single) drawing-overlay window.
/// Picked up by the frontend's `App.tsx` window-kind dispatcher.
#[cfg(not(target_os = "android"))]
pub(crate) const DRAW_OVERLAY_LABEL: &str = "draw-overlay";

/// Payload picked up by the freshly-opened drawing-overlay window.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub(crate) struct DrawOverlayContext {
    /// Channel the overlay should mirror strokes for.
    pub channel_id: u32,
    /// The local user's session id (kept for symmetry with the in-app
    /// `DrawingOverlay`; the overlay only renders, never sends).
    pub own_session: u32,
}

#[cfg(not(target_os = "android"))]
struct OverlayPlacement {
    /// Physical-pixel position (top-left) on the virtual desktop.
    x: i32,
    y: i32,
    /// Physical-pixel size.
    w: u32,
    h: u32,
    /// The shared window to follow as the user moves it, when the share is
    /// a window and this platform can locate one. Monitors never move.
    #[cfg(any(target_os = "windows", target_os = "linux"))]
    follow: Option<tracker::SourceFollower>,
}

/// Open the drawing-overlay window for `channel_id`.  Replaces any
/// existing overlay.  No-op on Android.
///
/// Placement prefers the running Rust broadcast's capture source (see
/// module docs).  `capture_width` / `capture_height` / `display_surface`
/// only feed the legacy fallback: pixel dimensions and surface kind of
/// the shared track from `MediaStreamTrack.getSettings()`, used to guess
/// the shared window or monitor when no Rust broadcast is active.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn open_drawing_overlay(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    channel_id: u32,
    own_session: u32,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
    display_surface: Option<String>,
) -> Result<(), String> {
    use tauri::Manager;

    if let Ok(mut slot) = state.draw_overlay_context.lock() {
        *slot = Some(DrawOverlayContext {
            channel_id,
            own_session,
        });
    }

    // Tear down any previous overlay + tracker before opening a new one.
    abort_tracker(&state);
    if let Some(existing) = app.get_webview_window(DRAW_OVERLAY_LABEL) {
        let _ = existing.close();
    }

    let placement = compute_placement(
        &app,
        capture_width,
        capture_height,
        display_surface.as_deref(),
    )?;

    // How this session lets a window be placed at all - and, on a Wayland
    // compositor without layer-shell, that it cannot be, before opening a
    // window nobody can position.
    #[cfg(target_os = "linux")]
    let linux_mode = linux_placement_mode()?;

    let builder = tauri::WebviewWindowBuilder::new(
        &app,
        DRAW_OVERLAY_LABEL,
        tauri::WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("")
    .decorations(false)
    .shadow(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .resizable(false)
    .focused(false);
    // A layer surface has to be configured before the window is realized, so
    // it is born hidden and shown once it has been turned into one.
    #[cfg(target_os = "linux")]
    let builder = match linux_mode {
        LinuxPlacementMode::LayerSurface => builder.visible(false),
        LinuxPlacementMode::Toplevel => builder,
    };
    let window = builder.build().map_err(|e: tauri::Error| e.to_string())?;

    // Exact physical placement (builder coordinates are logical; setting
    // physical afterwards avoids per-monitor scale-factor guesswork; the
    // window is transparent, so the brief reposition is invisible).
    // A layer surface is placed by the compositor from its anchors and the
    // output it was given, and ignores both calls.
    #[cfg(target_os = "linux")]
    let position_directly = matches!(linux_mode, LinuxPlacementMode::Toplevel);
    #[cfg(not(target_os = "linux"))]
    let position_directly = true;
    if position_directly {
        let _ = window.set_position(tauri::PhysicalPosition::new(placement.x, placement.y));
        let _ = window.set_size(tauri::PhysicalSize::new(placement.w, placement.h));
    }

    #[cfg(target_os = "linux")]
    configure_linux_window(&app, &window, linux_mode).await?;

    // Click-through, and only now: the window must already be on screen.
    // tao reaches for the `GdkWindow` to set an empty input region and
    // unwraps it (0.34 `event_loop.rs:448`), and an unrealized window has
    // none - which aborts the process, not just the call. Everything above
    // has made the window visible by this point, on every platform.
    if let Err(e) = window.set_ignore_cursor_events(true) {
        tracing::warn!("draw-overlay: set_ignore_cursor_events failed: {e}");
    }
    if let Err(e) = window.set_excluded_from_capture(true) {
        tracing::warn!("draw-overlay: capture exclusion not applied: {e}");
    }

    #[cfg(any(target_os = "windows", target_os = "linux"))]
    spawn_tracker_if_supported(&app, &state, placement.follow);
    #[cfg(not(any(target_os = "windows", target_os = "linux")))]
    spawn_tracker_if_supported(&app, &state);

    Ok(())
}

/// How this Linux session lets the overlay be placed.
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum LinuxPlacementMode {
    /// X11 or `XWayland`: an ordinary always-on-top window, positioned by us.
    Toplevel,
    /// Native Wayland with `wlr-layer-shell`: a layer surface anchored to
    /// one output. The compositor places it; we only say which output.
    LayerSurface,
}

/// Machine-readable reasons the overlay cannot open, for the UI to localise.
/// The compositor implements no protocol that can pin a window to an output.
#[cfg(target_os = "linux")]
const REASON_NO_LAYER_SHELL: &str = "wayland-no-layer-shell";
/// A window share under Wayland: nothing reports where the window is.
#[cfg(target_os = "linux")]
const REASON_WAYLAND_WINDOW_SHARE: &str = "wayland-window-share";

/// `WM_WINDOW_ROLE` of the overlay window, so users can write a window rule
/// against it (`KWin` matches on role) - the only way to keep the overlay out
/// of a monitor capture on Linux. See `docs/DRAW-OVERLAY-LINUX-RESEARCH.md`.
#[cfg(target_os = "linux")]
const WINDOW_ROLE: &str = "fancy-mumble-draw-overlay";

/// How long to wait for the GTK main thread to configure the window.
#[cfg(target_os = "linux")]
const GTK_SETUP_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

/// Decide how - and whether - this session can place the overlay.
#[cfg(target_os = "linux")]
fn linux_placement_mode() -> Result<LinuxPlacementMode, String> {
    use crate::platform::linux::{
        display::{self, DisplayBackend},
        layer_shell,
    };

    if display::backend() != DisplayBackend::Wayland {
        return Ok(LinuxPlacementMode::Toplevel);
    }
    if !layer_shell::is_supported() {
        // GNOME/Mutter, mainly. Refusing here is the honest answer: the
        // window would open somewhere the compositor chose, under the
        // windows it is supposed to be over.
        return Err(REASON_NO_LAYER_SHELL.to_owned());
    }
    if matches!(
        fancy_screenshare::active_portal_source().map(|s| s.kind),
        Some(fancy_screenshare::SourceKind::Window)
    ) {
        // A layer surface can only be anchored to an output, and Wayland
        // tells nobody where a window is, so there is nothing to pin to.
        return Err(REASON_WAYLAND_WINDOW_SHARE.to_owned());
    }
    Ok(LinuxPlacementMode::LayerSurface)
}

/// Do the GTK-side setup of the overlay window on the main thread.
///
/// GTK objects may only be touched there, and this command runs on a worker,
/// so the work is posted and awaited. Both things it does need the native
/// window: the identity a screencast rule can match, and (on Wayland) the
/// layer surface that is the only way to cover an output.
#[cfg(target_os = "linux")]
async fn configure_linux_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
    mode: LinuxPlacementMode,
) -> Result<(), String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let window = window.clone();
    // Read the portal's answer here, not on the main thread: it takes a
    // lock, and the main thread is the one place that must never wait.
    let source = fancy_screenshare::active_portal_source();
    app.run_on_main_thread(move || {
        let _ = tx.send(configure_linux_window_on_main_thread(&window, mode, source));
    })
    .map_err(|e| e.to_string())?;

    match tokio::time::timeout(GTK_SETUP_TIMEOUT, rx).await {
        Ok(Ok(result)) => result,
        Ok(Err(_)) => Err("draw-overlay: GTK setup never reported back".to_owned()),
        Err(_) => Err("draw-overlay: GTK setup timed out".to_owned()),
    }
}

#[cfg(target_os = "linux")]
fn configure_linux_window_on_main_thread(
    window: &tauri::WebviewWindow,
    mode: LinuxPlacementMode,
    source: Option<fancy_screenshare::PortalSource>,
) -> Result<(), String> {
    use crate::platform::linux::layer_shell;
    use gtk::prelude::GtkWindowExt as _;

    let gtk_window = window.gtk_window().map_err(|e| e.to_string())?;
    // Identity first, so it is set whichever way the window is placed.
    gtk_window.set_role(WINDOW_ROLE);

    if mode == LinuxPlacementMode::LayerSurface {
        let monitor = layer_shell::monitor_at_logical(
            source.and_then(|s| s.logical_position),
            source.and_then(|s| s.logical_size),
        );
        layer_shell::make_overlay(&gtk_window, monitor.as_ref())?;
        // Only now may it be mapped: the layer surface replaces the toplevel
        // that realizing would otherwise have created.
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Decide where to put the overlay window.
#[cfg(not(target_os = "android"))]
fn compute_placement(
    app: &tauri::AppHandle,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
    display_surface: Option<&str>,
) -> Result<OverlayPlacement, String> {
    // Best answer on Linux: what the compositor's portal dialog actually
    // picked. It outranks everything below because on that path the in-app
    // source id never reached the compositor at all.
    #[cfg(target_os = "linux")]
    if let Some(p) = portal_source_placement(app) {
        return Ok(p);
    }
    // Preferred: the running Rust broadcast knows exactly which monitor
    // or window it is capturing - pin the overlay over that source.
    if let Some(p) = broadcast_source_placement() {
        return Ok(p);
    }
    // Legacy fallback (no Rust broadcast running): guess the source from
    // the capture dimensions the frontend passed.
    if matches!(display_surface, Some("window") | Some("application")) {
        if let Some(p) = window_share_placement(capture_width, capture_height) {
            return Ok(p);
        }
        tracing::info!(
            "draw-overlay: window-share requested but no matching top-level window \
             found ({capture_width:?}x{capture_height:?}); falling back to monitor"
        );
    }
    monitor_placement(app, capture_width, capture_height)
}

/// Placement over the exact source of the running Rust broadcast.
#[cfg(not(target_os = "android"))]
fn broadcast_source_placement() -> Option<OverlayPlacement> {
    let (kind, id) = crate::commands::screenshare::active_broadcast_source()?;
    let Some((x, y, w, h)) = fancy_screenshare::sources::source_rect(kind, id) else {
        tracing::info!(
            ?kind,
            id,
            "draw-overlay: broadcast source rect unavailable; falling back"
        );
        return None;
    };
    tracing::info!(
        ?kind,
        id,
        x,
        y,
        w,
        h,
        "draw-overlay: pinned to the broadcast's capture source"
    );
    let is_window = kind == fancy_screenshare::SourceKind::Window;
    Some(OverlayPlacement {
        x,
        y,
        w,
        h,
        #[cfg(target_os = "windows")]
        follow: is_window.then(|| tracker::SourceFollower::Hwnd(id as isize)),
        #[cfg(target_os = "linux")]
        follow: is_window
            .then(|| fancy_screenshare::sources::SharedWindow::resolve(id))
            .flatten()
            .map(tracker::SourceFollower::X11),
    })
}

/// Placement over the source the xdg-desktop-portal is streaming.
///
/// The portal is the shipped Linux capture path, and on it the compositor's
/// dialog - not the in-app picker - chooses the source, so this is the only
/// description of the shared content that is true. Without it the overlay
/// fell through to "the monitor under the cursor", which on a multi-head
/// desktop is the wrong screen as often as not.
#[cfg(target_os = "linux")]
fn portal_source_placement(app: &tauri::AppHandle) -> Option<OverlayPlacement> {
    let source = fancy_screenshare::active_portal_source()?;
    match source.kind {
        fancy_screenshare::SourceKind::Screen => {
            let monitors = app.available_monitors().ok()?;
            let geometries: Vec<MonitorGeometry> =
                monitors.iter().map(MonitorGeometry::of).collect();
            let index = pick_portal_monitor(
                &geometries,
                source.logical_position,
                source.logical_size,
                source.stream_size,
            )?;
            let monitor = monitors.get(index)?;
            let (position, size) = (monitor.position(), monitor.size());
            tracing::info!(
                x = position.x,
                y = position.y,
                w = size.width,
                h = size.height,
                logical = ?source.logical_position,
                "draw-overlay: pinned to the portal's shared monitor"
            );
            Some(OverlayPlacement {
                x: position.x,
                y: position.y,
                w: size.width,
                h: size.height,
                follow: None,
            })
        }
        fancy_screenshare::SourceKind::Window => {
            // The portal never reports where a shared window is, so it has
            // to be found by the size the stream negotiated - and then
            // followed, because the user can move it.
            let (width, height) = source.stream_size?;
            let shared = fancy_screenshare::sources::SharedWindow::find_by_size(width, height)?;
            let (x, y, w, h) = shared.rect()?;
            tracing::info!(
                x,
                y,
                w,
                h,
                "draw-overlay: pinned to the portal's shared window (matched by stream size)"
            );
            Some(OverlayPlacement {
                x,
                y,
                w,
                h,
                follow: Some(tracker::SourceFollower::X11(shared)),
            })
        }
        // Cameras have no place on the desktop to pin anything over.
        fancy_screenshare::SourceKind::Device => None,
    }
}

/// A monitor as both coordinate spaces see it, for [`pick_portal_monitor`].
#[cfg(target_os = "linux")]
#[derive(Debug, Clone, Copy, PartialEq)]
struct MonitorGeometry {
    /// Physical-pixel rect, which is what the overlay is placed at.
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    /// Ratio between the two spaces on this monitor.
    scale: f64,
}

#[cfg(target_os = "linux")]
impl MonitorGeometry {
    fn of(monitor: &tauri::Monitor) -> Self {
        let (position, size) = (monitor.position(), monitor.size());
        Self {
            x: position.x,
            y: position.y,
            w: size.width,
            h: size.height,
            scale: monitor.scale_factor(),
        }
    }

    /// Origin in the compositor's logical space, which is what the portal
    /// reports. Equal to the physical origin at scale 1 - the common case,
    /// and the only one `XWayland` presents.
    fn logical_origin(self) -> (f64, f64) {
        let scale = if self.scale > 0.0 { self.scale } else { 1.0 };
        (f64::from(self.x) / scale, f64::from(self.y) / scale)
    }

    fn logical_size(self) -> (f64, f64) {
        let scale = if self.scale > 0.0 { self.scale } else { 1.0 };
        (f64::from(self.w) / scale, f64::from(self.h) / scale)
    }
}

/// Which monitor the portal is streaming, from what it told us about it.
///
/// The origin is the discriminator - it is unique per monitor, while sizes
/// routinely are not (two identical screens side by side). Size is only used
/// when there is no position, and only when it singles one monitor out;
/// guessing between equals would put the overlay on the wrong screen, and
/// the caller's cursor/primary fallback is the better answer then.
#[cfg(target_os = "linux")]
fn pick_portal_monitor(
    monitors: &[MonitorGeometry],
    logical_position: Option<(i32, i32)>,
    logical_size: Option<(i32, i32)>,
    stream_size: Option<(u32, u32)>,
) -> Option<usize> {
    /// Logical coordinates are floats and scaling makes them inexact.
    const EPSILON: f64 = 1.5;
    let close = |a: f64, b: f64| (a - b).abs() <= EPSILON;

    if let Some((px, py)) = logical_position {
        let mut hits = monitors.iter().enumerate().filter(|(_, m)| {
            let (mx, my) = m.logical_origin();
            close(mx, f64::from(px)) && close(my, f64::from(py))
        });
        if let Some((index, monitor)) = hits.next() {
            // Two monitors sharing an origin is impossible; if it happens,
            // let the logical extent break the tie rather than picking one.
            if hits.next().is_none() {
                return Some(index);
            }
            if let Some((sw, sh)) = logical_size {
                let (mw, mh) = monitor.logical_size();
                if close(mw, f64::from(sw)) && close(mh, f64::from(sh)) {
                    return Some(index);
                }
            }
        }
    }

    if let Some((sw, sh)) = stream_size {
        let mut hits = monitors
            .iter()
            .enumerate()
            .filter(|(_, m)| m.w == sw && m.h == sh);
        let only = hits.next();
        if hits.next().is_none() {
            return only.map(|(index, _)| index);
        }
    }

    None
}

/// Try to find a top-level window with matching client size.  Windows-only.
#[cfg(target_os = "windows")]
fn window_share_placement(
    capture_width: Option<u32>,
    capture_height: Option<u32>,
) -> Option<OverlayPlacement> {
    let (w, h) = (capture_width?, capture_height?);
    let hwnd = win_tracker::find_window_by_client_size(w, h)?;
    let rect = win_tracker::screen_rect_of(hwnd)?;
    Some(OverlayPlacement {
        x: rect.x,
        y: rect.y,
        w: rect.w.max(1) as u32,
        h: rect.h.max(1) as u32,
        follow: Some(tracker::SourceFollower::Hwnd(hwnd)),
    })
}

/// Try to find a top-level window with matching size.  X11-only: under a
/// native Wayland session nothing is enumerable and this always misses.
#[cfg(target_os = "linux")]
fn window_share_placement(
    capture_width: Option<u32>,
    capture_height: Option<u32>,
) -> Option<OverlayPlacement> {
    let shared =
        fancy_screenshare::sources::SharedWindow::find_by_size(capture_width?, capture_height?)?;
    let (x, y, w, h) = shared.rect()?;
    Some(OverlayPlacement {
        x,
        y,
        w,
        h,
        follow: Some(tracker::SourceFollower::X11(shared)),
    })
}

#[cfg(all(
    not(target_os = "android"),
    not(any(target_os = "windows", target_os = "linux"))
))]
fn window_share_placement(
    _capture_width: Option<u32>,
    _capture_height: Option<u32>,
) -> Option<OverlayPlacement> {
    None
}

/// Choose the monitor that the overlay should cover and turn it into
/// an [`OverlayPlacement`].
#[cfg(not(target_os = "android"))]
fn monitor_placement(
    app: &tauri::AppHandle,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
) -> Result<OverlayPlacement, String> {
    let monitor = pick_target_monitor(app, capture_width, capture_height)?;
    let size = monitor.size();
    let position = monitor.position();
    Ok(OverlayPlacement {
        x: position.x,
        y: position.y,
        w: size.width,
        h: size.height,
        #[cfg(any(target_os = "windows", target_os = "linux"))]
        follow: None,
    })
}

/// Choose the monitor that the overlay should cover.
///
/// Priority:
/// 1. A monitor whose pixel size matches `capture_width` x `capture_height`.
/// 2. The monitor under the cursor right now.
/// 3. The primary monitor.
#[cfg(not(target_os = "android"))]
fn pick_target_monitor(
    app: &tauri::AppHandle,
    capture_width: Option<u32>,
    capture_height: Option<u32>,
) -> Result<tauri::Monitor, String> {
    let monitors = app
        .available_monitors()
        .map_err(|e| format!("available_monitors failed: {e}"))?;

    if let (Some(w), Some(h)) = (capture_width, capture_height)
        && let Some(m) = monitors
            .iter()
            .find(|m| m.size().width == w && m.size().height == h)
    {
        return Ok(m.clone());
    }

    if let Ok(pos) = app.cursor_position()
        && let Some(m) = monitors.iter().find(|m| {
            let mp = m.position();
            let ms = m.size();
            let x = pos.x as i32;
            let y = pos.y as i32;
            x >= mp.x && y >= mp.y && x < mp.x + ms.width as i32 && y < mp.y + ms.height as i32
        })
    {
        return Ok(m.clone());
    }

    app.primary_monitor()
        .map_err(|e| format!("primary_monitor failed: {e}"))?
        .ok_or_else(|| "no primary monitor available".to_string())
}

/// Start following the shared window, when there is one to follow.
///
/// Monitor shares pass `None` (monitors do not move) and so does every
/// platform that cannot locate the shared window - macOS, and Linux under a
/// native Wayland session where no window is enumerable at all.
#[cfg(any(target_os = "windows", target_os = "linux"))]
fn spawn_tracker_if_supported(
    app: &tauri::AppHandle,
    state: &tauri::State<'_, AppState>,
    follow: Option<tracker::SourceFollower>,
) {
    let Some(follower) = follow else {
        return;
    };
    let handle = tracker::spawn(app.clone(), follower);
    if let Ok(mut slot) = state.draw_overlay_tracker.lock() {
        *slot = Some(handle);
    }
}

#[cfg(all(
    not(target_os = "android"),
    not(any(target_os = "windows", target_os = "linux"))
))]
fn spawn_tracker_if_supported(_app: &tauri::AppHandle, _state: &tauri::State<'_, AppState>) {}

#[cfg(not(target_os = "android"))]
fn abort_tracker(state: &tauri::State<'_, AppState>) {
    if let Ok(mut slot) = state.draw_overlay_tracker.lock()
        && let Some(handle) = slot.take()
    {
        handle.abort();
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn open_drawing_overlay(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
    _channel_id: u32,
    _own_session: u32,
    _capture_width: Option<u32>,
    _capture_height: Option<u32>,
    _display_surface: Option<String>,
) -> Result<(), String> {
    Err("Drawing overlay windows are not supported on Android".to_string())
}

/// What the desktop overlay can actually do on this machine, right now.
///
/// The toggle used to be offered unconditionally and simply fail (or worse,
/// open a window in the wrong place) where the platform cannot deliver. This
/// lets the UI say so up front, and stop promising capture exclusion on a
/// platform that has none.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DrawingOverlaySupport {
    /// Whether opening the overlay would work at all.
    pub available: bool,
    /// Machine-readable reason when it would not, for the UI to localise.
    pub reason: Option<String>,
    /// Whether a shared *window* is followed as the user moves it.
    pub follows_windows: bool,
    /// Whether the overlay is kept out of the broadcaster's own stream.
    pub excluded_from_capture: bool,
}

/// Report [`DrawingOverlaySupport`] for this session.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) fn drawing_overlay_support() -> DrawingOverlaySupport {
    #[cfg(target_os = "linux")]
    {
        use crate::platform::linux::display::{self, DisplayBackend};

        let x11 = display::backend() != DisplayBackend::Wayland;
        let (available, reason) = match linux_placement_mode() {
            Ok(_) => (true, None),
            Err(reason) => (false, Some(reason)),
        };
        DrawingOverlaySupport {
            available,
            reason,
            // Only X11 can locate another window, let alone follow it.
            follows_windows: x11,
            // Neither X11 nor Wayland has an equivalent of
            // WDA_EXCLUDEFROMCAPTURE; a monitor share therefore records the
            // overlay too. (A window share does not - the compositor
            // streams that window's own surface.)
            excluded_from_capture: false,
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        DrawingOverlaySupport {
            available: true,
            reason: None,
            follows_windows: cfg!(target_os = "windows"),
            excluded_from_capture: true,
        }
    }
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) fn drawing_overlay_support() -> DrawingOverlaySupport {
    DrawingOverlaySupport {
        available: false,
        reason: Some("unsupported-platform".to_owned()),
        follows_windows: false,
        excluded_from_capture: false,
    }
}

/// Close the currently-open drawing-overlay window, if any.
#[cfg(not(target_os = "android"))]
#[tauri::command]
pub(crate) async fn close_drawing_overlay(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    use tauri::Manager;

    abort_tracker(&state);
    if let Ok(mut slot) = state.draw_overlay_context.lock() {
        *slot = None;
    }
    if let Some(existing) = app.get_webview_window(DRAW_OVERLAY_LABEL) {
        let _ = existing.close();
    }
    Ok(())
}

#[cfg(target_os = "android")]
#[tauri::command]
pub(crate) async fn close_drawing_overlay(
    _app: tauri::AppHandle,
    _state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    Ok(())
}

/// Hand the overlay window the channel/session it should mirror.
/// Idempotent: returns the same context on repeated calls so a
/// reload (e.g. devtools refresh) still gets the data.
#[tauri::command]
pub(crate) fn take_drawing_overlay_context(
    state: tauri::State<'_, AppState>,
) -> Option<DrawOverlayContext> {
    state
        .draw_overlay_context
        .lock()
        .ok()
        .and_then(|m| m.clone())
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// Two 2560x1440 screens side by side at scale 1 - the case that used to
    /// land the overlay on whichever one the mouse happened to be on.
    const TWINS: [MonitorGeometry; 2] = [
        MonitorGeometry {
            x: 0,
            y: 0,
            w: 2560,
            h: 1440,
            scale: 1.0,
        },
        MonitorGeometry {
            x: 2560,
            y: 0,
            w: 2560,
            h: 1440,
            scale: 1.0,
        },
    ];

    #[test]
    fn the_portal_position_picks_between_identical_screens() {
        assert_eq!(
            pick_portal_monitor(&TWINS, Some((2560, 0)), Some((2560, 1440)), None),
            Some(1)
        );
        assert_eq!(
            pick_portal_monitor(&TWINS, Some((0, 0)), Some((2560, 1440)), None),
            Some(0)
        );
    }

    #[test]
    fn a_scaled_monitor_is_matched_in_logical_coordinates() {
        // A 3840x2160 screen at 2x sits at logical (1920, 0) next to a
        // 1920-wide one, so only the scaled comparison finds it.
        let monitors = [
            MonitorGeometry {
                x: 0,
                y: 0,
                w: 1920,
                h: 1080,
                scale: 1.0,
            },
            MonitorGeometry {
                x: 3840,
                y: 0,
                w: 3840,
                h: 2160,
                scale: 2.0,
            },
        ];
        assert_eq!(
            pick_portal_monitor(&monitors, Some((1920, 0)), Some((1920, 1080)), None),
            Some(1)
        );
    }

    #[test]
    fn without_a_position_a_unique_size_still_identifies_the_screen() {
        let monitors = [
            MonitorGeometry {
                x: 0,
                y: 0,
                w: 2560,
                h: 1440,
                scale: 1.0,
            },
            MonitorGeometry {
                x: 2560,
                y: 0,
                w: 1920,
                h: 1200,
                scale: 1.0,
            },
        ];
        assert_eq!(
            pick_portal_monitor(&monitors, None, None, Some((1920, 1200))),
            Some(1)
        );
    }

    #[test]
    fn ambiguity_is_declined_rather_than_guessed() {
        // Same size, no position: the caller's cursor/primary fallback is a
        // better answer than a coin flip.
        assert_eq!(
            pick_portal_monitor(&TWINS, None, None, Some((2560, 1440))),
            None
        );
        assert_eq!(pick_portal_monitor(&TWINS, None, None, None), None);
    }

    #[test]
    fn a_position_on_no_monitor_matches_nothing() {
        assert_eq!(
            pick_portal_monitor(&TWINS, Some((9999, 9999)), None, None),
            None
        );
    }
}
