//! Capturable source enumeration and thumbnails for the source-picker UI.

use base64::Engine as _;
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use xcap::{Monitor, Window};

/// What kind of thing a [`CaptureSource`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    /// A whole monitor.
    Screen,
    /// A single application window.
    Window,
    /// A video capture device (webcam).
    Device,
}

/// One selectable capture source (a monitor or a window).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CaptureSource {
    /// Backend-native identifier, stable for the lifetime of the source.
    pub id: u32,
    /// Screen or window.
    pub kind: SourceKind,
    /// Human-readable title (window title, or a monitor label).
    pub title: String,
    /// Source width in physical pixels.
    pub width: u32,
    /// Source height in physical pixels.
    pub height: u32,
}

/// Enumerate all capturable sources: every monitor, then every visible,
/// non-minimized window that has a title, then every connected camera.
///
/// Errors from the OS screen/window enumeration are returned; individual
/// sources that fail to report a property are skipped rather than failing
/// the whole list. Camera enumeration is best-effort (no cameras is normal).
///
/// On Wayland, applications cannot enumerate other windows or outputs at
/// all - the compositor's xdg-desktop-portal dialog does the real picking.
/// When native enumeration comes back empty there (and the portal pipeline
/// is compiled in), one synthetic entry per kind is returned so the flow
/// stays reachable from the in-app picker; their `id` is advisory and the
/// portal dialog chooses the concrete source. Cameras enumerate normally
/// there (V4L2 needs no portal).
pub fn list_sources() -> Result<Vec<CaptureSource>, String> {
    let native = native_sources();

    #[cfg(all(target_os = "linux", feature = "gpu"))]
    if !matches!(&native, Ok(list) if !list.is_empty()) {
        let mut out = vec![
            CaptureSource {
                id: 0,
                kind: SourceKind::Screen,
                title: "Entire screen (system picker)".to_owned(),
                width: 0,
                height: 0,
            },
            CaptureSource {
                id: 0,
                kind: SourceKind::Window,
                title: "Application window (system picker)".to_owned(),
                width: 0,
                height: 0,
            },
        ];
        out.extend(crate::camera::list_devices());
        return Ok(out);
    }

    native.map(|mut list| {
        list.extend(crate::camera::list_devices());
        list
    })
}

fn native_sources() -> Result<Vec<CaptureSource>, String> {
    let mut out = Vec::new();

    for (index, monitor) in Monitor::all()
        .map_err(|e| e.to_string())?
        .iter()
        .enumerate()
    {
        let Ok(id) = monitor.id() else { continue };
        let name = monitor.name().unwrap_or_default();
        let width = monitor.width().unwrap_or(0);
        let height = monitor.height().unwrap_or(0);
        let title = if name.is_empty() {
            format!("Screen {}", index + 1)
        } else {
            format!("Screen {} ({name})", index + 1)
        };
        out.push(CaptureSource {
            id,
            kind: SourceKind::Screen,
            title,
            width,
            height,
        });
    }

    // A window list is a window-manager service (`_NET_CLIENT_LIST_STACKING`),
    // and a bare X server - Xvfb, a kiosk - has no WM to publish it. xcap
    // reports that absence as an *error*, and propagating it here threw away
    // the real monitors enumerated just above: the picker then degraded to
    // the portal-only synthetic cards, and on a server with no portal either
    // (the same bare X server), a screen share died at start with a portal
    // error that had nothing to do with anything the user picked. Missing
    // windows must not disqualify present screens; true Wayland still gets
    // the synthetic cards because there the monitor list itself is empty.
    let windows = match Window::all() {
        Ok(windows) => windows,
        Err(e) => {
            tracing::info!("screenshare: window enumeration unavailable ({e}); screens only");
            Vec::new()
        }
    };
    for window in windows {
        let Ok(id) = window.id() else { continue };
        if window.is_minimized().unwrap_or(true) {
            continue;
        }
        let title = window.title().unwrap_or_default();
        if title.trim().is_empty() {
            continue;
        }
        let width = window.width().unwrap_or(0);
        let height = window.height().unwrap_or(0);
        // Zero-sized windows are not capturable (tool windows, ghosts).
        if width == 0 || height == 0 {
            continue;
        }
        out.push(CaptureSource {
            id,
            kind: SourceKind::Window,
            title,
            width,
            height,
        });
    }

    Ok(out)
}

/// Physical-pixel rectangle `(x, y, w, h)` of a capture source on the
/// virtual desktop, e.g. for pinning an overlay window over the shared
/// content. `None` when the source is gone or minimized, when the backend
/// cannot report positions (Wayland portal sources, whose ids are
/// advisory), or for cameras (which have no desktop rectangle at all).
pub fn source_rect(kind: SourceKind, id: u32) -> Option<(i32, i32, u32, u32)> {
    match CaptureTarget::resolve(kind, id).ok()? {
        CaptureTarget::Monitor(m) => Some((
            m.x().ok()?,
            m.y().ok()?,
            m.width().ok()?.max(1),
            m.height().ok()?.max(1),
        )),
        CaptureTarget::Window(w) => {
            if w.is_minimized().unwrap_or(false) {
                return None;
            }
            Some((
                w.x().ok()?,
                w.y().ok()?,
                w.width().ok()?.max(1),
                w.height().ok()?.max(1),
            ))
        }
    }
}

/// A shared window followed by its live on-screen rectangle.
///
/// The portal never says where a window it streams sits on screen
/// (xdg-desktop-portal#571), so an overlay pinned over a window share has to
/// find the window itself. On X11 - which under a Wayland session still means
/// every `XWayland` client, and games are `XWayland` clients - the window can
/// be matched by the size the stream negotiated and then followed: each
/// accessor below is one `GetGeometry` + `TranslateCoordinates` round trip,
/// cheap enough to poll, unlike the `Window::all()` walk that resolves it.
///
/// Linux-only: Windows follows the source by `HWND` in the embedder, and
/// macOS has no window-share overlay.
#[cfg(target_os = "linux")]
#[derive(Debug)]
pub struct SharedWindow {
    window: Window,
}

#[cfg(target_os = "linux")]
impl SharedWindow {
    /// Find the top-level window whose current size best matches
    /// `width` x `height`, ignoring this process's own windows and anything
    /// minimized. `None` when nothing is close enough, which is the normal
    /// answer under a native Wayland session (no window is enumerable).
    pub fn find_by_size(width: u32, height: u32) -> Option<Self> {
        if width == 0 || height == 0 {
            return None;
        }
        let own_pid = std::process::id();
        // Stacking order, bottom-most first (`_NET_CLIENT_LIST_STACKING`).
        let candidates: Vec<Window> = Window::all()
            .ok()?
            .into_iter()
            .filter(|w| w.pid().is_ok_and(|pid| pid != own_pid))
            .filter(|w| !w.is_minimized().unwrap_or(false))
            .collect();
        let sizes: Vec<(u32, u32)> = candidates
            .iter()
            .map(|w| (w.width().unwrap_or(0), w.height().unwrap_or(0)))
            .collect();
        let index = best_size_match(&sizes, (width, height))?;
        candidates
            .into_iter()
            .nth(index)
            .map(|window| Self { window })
    }

    /// Take hold of an already-known window by its X11 id, for following a
    /// share that did NOT go through the portal (a bare X11 session, where
    /// the in-app picker's id is the real one).
    pub fn resolve(id: u32) -> Option<Self> {
        Window::all()
            .ok()?
            .into_iter()
            .find(|w| w.id().is_ok_and(|window_id| window_id == id))
            .map(|window| Self { window })
    }

    /// Physical-pixel rect `(x, y, w, h)` right now, or `None` once the
    /// window is gone.
    pub fn rect(&self) -> Option<(i32, i32, u32, u32)> {
        Some((
            self.window.x().ok()?,
            self.window.y().ok()?,
            self.window.width().ok()?.max(1),
            self.window.height().ok()?.max(1),
        ))
    }

    /// Whether the window is currently minimized (`_NET_WM_STATE_HIDDEN`).
    /// A minimized window is not gone - the overlay hides and comes back
    /// with it - so this is deliberately separate from [`Self::rect`].
    pub fn is_minimized(&self) -> bool {
        self.window.is_minimized().unwrap_or(false)
    }
}

/// Index of the size in `sizes` closest to `want`, within
/// [`SIZE_MATCH_TOLERANCE`] on both axes. Ties go to the LAST match, which
/// in stacking order is the top-most window - the one the user was looking
/// at when they picked it in the portal dialog.
///
/// The tolerance exists because a compositor may stream a window's content
/// area while X reports its client geometry, and the two can disagree by a
/// pixel or two on fractional-scaling setups.
#[cfg(target_os = "linux")]
fn best_size_match(sizes: &[(u32, u32)], want: (u32, u32)) -> Option<usize> {
    let distance = |(w, h): (u32, u32)| {
        let dw = w.abs_diff(want.0);
        let dh = h.abs_diff(want.1);
        (dw <= SIZE_MATCH_TOLERANCE && dh <= SIZE_MATCH_TOLERANCE).then_some(dw + dh)
    };
    sizes
        .iter()
        .enumerate()
        .filter_map(|(i, &size)| distance(size).map(|d| (i, d)))
        // `min_by_key` keeps the FIRST minimum; reversing makes it the last.
        .rev()
        .min_by_key(|&(_, d)| d)
        .map(|(i, _)| i)
}

/// How far a window's reported size may sit from the negotiated stream size
/// and still be considered the shared window. See [`best_size_match`].
#[cfg(target_os = "linux")]
const SIZE_MATCH_TOLERANCE: u32 = 4;

/// Capture one frame of the given source, scaled down to at most `max_dim`
/// pixels on the longer edge, and return it as a `data:image/jpeg;base64,...`
/// URL for direct use in an `<img>` / QML `Image`.
pub fn capture_thumbnail(kind: SourceKind, id: u32, max_dim: u32) -> Result<String, String> {
    let frame = capture_frame(kind, id)?;
    let (w, h) = (frame.width(), frame.height());
    let scale = f64::from(max_dim) / f64::from(w.max(h).max(1));
    let img = if scale < 1.0 {
        let nw = ((f64::from(w) * scale) as u32).max(1);
        let nh = ((f64::from(h) * scale) as u32).max(1);
        image::imageops::resize(&frame, nw, nh, image::imageops::FilterType::Triangle)
    } else {
        frame
    };

    let mut jpeg = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 70);
    encoder
        .encode_image(&image::DynamicImage::ImageRgba8(img).to_rgb8())
        .map_err(|e| e.to_string())?;
    Ok(format!(
        "data:image/jpeg;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&jpeg)
    ))
}

/// A RESOLVED capture source whose OS handle is reused across frames.
///
/// Enumerating sources is expensive - `Window::all()` walks every top-level
/// window on the system (titles, PIDs, DWM attributes) and can take hundreds
/// of milliseconds on a busy desktop. Doing that per captured frame capped
/// real-world shares below 1 fps, so the broadcast pipeline resolves its
/// target once and calls [`CaptureTarget::capture`] per frame.
#[derive(Debug, Clone)]
pub(crate) enum CaptureTarget {
    /// A whole monitor.
    Monitor(Monitor),
    /// A single window.
    Window(Window),
}

impl CaptureTarget {
    /// Resolve a source id to its OS handle (one enumeration).
    pub(crate) fn resolve(kind: SourceKind, id: u32) -> Result<Self, String> {
        match kind {
            SourceKind::Screen => Monitor::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|m| m.id().map(|mid| mid == id).unwrap_or(false))
                .map(Self::Monitor)
                .ok_or_else(|| format!("screen {id} not found")),
            SourceKind::Window => Window::all()
                .map_err(|e| e.to_string())?
                .into_iter()
                .find(|w| w.id().map(|wid| wid == id).unwrap_or(false))
                .map(Self::Window)
                .ok_or_else(|| format!("window {id} not found")),
            // Cameras are not desktop capture targets; they resolve through
            // crate::camera on the capture thread instead.
            SourceKind::Device => Err("cameras have no desktop capture target".to_owned()),
        }
    }

    /// Capture one RGBA frame from the resolved handle.
    pub(crate) fn capture(&self) -> Result<RgbaImage, String> {
        match self {
            Self::Monitor(m) => m.capture_image().map_err(|e| e.to_string()),
            Self::Window(w) => w.capture_image().map_err(|e| e.to_string()),
        }
    }
}

/// Capture a single RGBA frame of a source (one-shot: thumbnails, probes).
pub(crate) fn capture_frame(kind: SourceKind, id: u32) -> Result<RgbaImage, String> {
    if kind == SourceKind::Device {
        return crate::camera::capture_device_frame(id);
    }
    CaptureTarget::resolve(kind, id)?.capture()
}

/// Confirm a screen/window source still resolves to a live OS handle WITHOUT
/// capturing any pixels. A full frame grab as an existence check is a portal
/// round-trip on Wayland (and redundant with the capture pipeline that opens
/// right after), so the broadcaster uses this to fail fast on a vanished
/// source instead - the screen/window analogue of `camera::device_exists`.
pub(crate) fn ensure_present(kind: SourceKind, id: u32) -> Result<(), String> {
    CaptureTarget::resolve(kind, id).map(|_| ())
}

/// Change-driven whole-screen capture through the OS recorder (WGC on
/// Windows): the compositor pushes an RGBA frame whenever the screen
/// actually changes, instead of us paying a full-screen blit per tick.
#[derive(Debug)]
pub(crate) struct ScreenRecorder {
    recorder: xcap::VideoRecorder,
    rx: std::sync::mpsc::Receiver<xcap::Frame>,
}

/// One poll of the recorder's frame stream.
#[derive(Debug)]
pub(crate) enum RecorderFrame {
    /// A new frame (the newest pending one; older ones were drained away).
    Frame(xcap::Frame),
    /// Nothing changed on screen within the wait budget.
    Idle,
    /// The recorder's stream ended; fall back to polled capture.
    Dead,
}

impl ScreenRecorder {
    /// Start recording the given monitor; `None` (with a log) on any failure
    /// so the caller falls back to per-frame polling.
    pub(crate) fn start(monitor_id: u32) -> Option<Self> {
        let monitor = Monitor::all()
            .ok()?
            .into_iter()
            .find(|m| m.id().map(|id| id == monitor_id).unwrap_or(false))?;
        let (recorder, rx) = match monitor.video_recorder() {
            Ok(pair) => pair,
            Err(e) => {
                tracing::info!("screenshare: screen recorder unavailable ({e}); polling instead");
                return None;
            }
        };
        if let Err(e) = recorder.start() {
            tracing::info!("screenshare: screen recorder failed to start ({e}); polling instead");
            return None;
        }
        tracing::info!("screenshare: change-driven screen recorder active");
        Some(Self { recorder, rx })
    }

    /// Wait up to `wait` for a frame, then drain to the newest pending one -
    /// encoding stale frames would only add latency.
    pub(crate) fn latest_frame(&self, wait: std::time::Duration) -> RecorderFrame {
        use std::sync::mpsc::RecvTimeoutError;
        let mut latest = match self.rx.recv_timeout(wait) {
            Ok(f) => f,
            Err(RecvTimeoutError::Timeout) => return RecorderFrame::Idle,
            Err(RecvTimeoutError::Disconnected) => return RecorderFrame::Dead,
        };
        while let Ok(newer) = self.rx.try_recv() {
            latest = newer;
        }
        RecorderFrame::Frame(latest)
    }

    /// Stop the OS recording session.
    pub(crate) fn shutdown(self) {
        if let Err(e) = self.recorder.stop() {
            tracing::debug!("screenshare: recorder stop: {e}");
        }
    }
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    /// The follower is moved into a polling task, so it has to cross threads.
    const _: () = {
        const fn assert_send<T: Send>() {}
        assert_send::<SharedWindow>();
    };

    #[test]
    fn exact_size_wins_over_a_near_miss() {
        let sizes = [(1280, 720), (1282, 722), (1920, 1080)];
        assert_eq!(best_size_match(&sizes, (1280, 720)), Some(0));
    }

    #[test]
    fn a_near_miss_still_matches_within_the_tolerance() {
        let sizes = [(1920, 1080), (1278, 719)];
        assert_eq!(best_size_match(&sizes, (1280, 720)), Some(1));
    }

    #[test]
    fn equally_close_candidates_resolve_to_the_topmost() {
        // Same distance, so stacking order decides: last is top-most.
        let sizes = [(1280, 718), (1920, 1080), (1280, 722)];
        assert_eq!(best_size_match(&sizes, (1280, 720)), Some(2));
    }

    #[test]
    fn nothing_within_the_tolerance_matches_nothing() {
        let sizes = [(1920, 1080), (800, 600)];
        assert_eq!(best_size_match(&sizes, (1280, 720)), None);
    }
}
