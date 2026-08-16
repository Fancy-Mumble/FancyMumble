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
