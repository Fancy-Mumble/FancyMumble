//! Webcam ("device") capture: enumeration, thumbnails and the camera
//! encode pipeline.
//!
//! Cameras are the third [`crate::sources::SourceKind`] next to screens and
//! windows. A camera is reached through one of several **backends**, each
//! exposing the same [`CameraBackend`] interface so the picker, thumbnails and
//! the encode pipeline iterate real and virtual cameras identically:
//!
//! * [`NativeCameraBackend`] - the OS-native capture API via nokhwa (Media
//!   Foundation on Windows, V4L2 on Linux, AVFoundation on macOS). This is
//!   every physical UVC webcam.
//! * [`crate::camera_directshow::DirectShowBackend`] (Windows only) -
//!   DirectShow video-input devices, which is where *virtual* cameras such as
//!   OBS Virtual Camera register. Media Foundation does not enumerate
//!   DirectShow-only virtual cameras, so without this backend they are
//!   invisible (the "No camera found" report).
//!
//! Whichever backend a device comes from, it opens as a [`FrameSource`] that
//! vends RGBA frames by blocking on the device's own cadence. Those frames feed
//! the exact same downscale + H.264 encode stages as the CPU screen pipeline -
//! only the frame *source* differs, so a camera track rides the broadcast like
//! any screen track.
//!
//! Backends (and the [`FrameSource`]s they open) are created and used entirely
//! on the broadcast's capture thread - the OS capture objects are thread-affine
//! and never cross a thread boundary - so neither trait carries a `Send` bound.

use image::RgbaImage;
use nokhwa::pixel_format::RgbAFormat;
use nokhwa::utils::{
    ApiBackend, CameraFormat, CameraIndex, FrameFormat, RequestedFormat, RequestedFormatType,
    Resolution,
};
use nokhwa::Camera;

use crate::encode::{EncodeSettings, EncodedFrame, H264Encoder, VideoEncoder};
use crate::pipeline::{EncodePipeline, FrameScaler, StageTimings, MAX_CAPTURE_FAILURES};
use crate::sources::{CaptureSource, SourceKind};

/// A live webcam frame source: opened once on the capture thread (the OS
/// objects are thread-affine), then polled for RGBA frames. Backends implement
/// this per capture API - Media Foundation via nokhwa for real cameras,
/// DirectShow for virtual ones - so the pipeline drives them identically.
pub(crate) trait FrameSource {
    /// Block for the next frame. `Err` means the device is gone; the pipeline
    /// then tries to reopen it once before giving up.
    fn next_frame(&mut self) -> Result<RgbaImage, String>;

    /// One-line description of the negotiated capture format, for logs.
    fn describe(&self) -> String;
}

/// A source of webcam devices: enumerates them and opens them as
/// [`FrameSource`]s. Each backend owns a disjoint slice of the `u32` device-id
/// space (see [`DSHOW_ID_BASE`]) so an id routes unambiguously back to the
/// backend that produced it.
pub(crate) trait CameraBackend {
    /// Short name for logs.
    fn name(&self) -> &'static str;

    /// Enumerate this backend's devices as picker sources. Failure yields an
    /// empty list - one backend being unavailable must not break the others.
    fn list(&self) -> Vec<CaptureSource>;

    /// Whether `id` falls in this backend's id-space.
    fn owns(&self, id: u32) -> bool;

    /// Open a live capture handle for the device `id`.
    fn open(&self, id: u32) -> Result<Box<dyn FrameSource>, String>;
}

/// Start of the DirectShow backend's device-id space. nokhwa enumerates by
/// small numeric index (0, 1, ...), so reserving everything at and above this
/// base for DirectShow keeps the two id-spaces disjoint and lets an id route
/// back to the backend that produced it.
pub(crate) const DSHOW_ID_BASE: u32 = 0x1000_0000;

/// All camera backends available on this platform, in preference order. Real
/// (native) cameras come first so that a device exposed through *both* APIs is
/// listed once, via its native entry (see [`list_devices`]).
fn backends() -> Vec<Box<dyn CameraBackend>> {
    // `mut` is only exercised on Windows, where a DirectShow backend is pushed.
    #[cfg_attr(not(windows), allow(unused_mut))]
    let mut v: Vec<Box<dyn CameraBackend>> = vec![Box::new(NativeCameraBackend)];
    #[cfg(windows)]
    v.push(Box::new(crate::camera_directshow::DirectShowBackend));
    v
}

/// Enumerate connected cameras across all backends as picker sources.
/// Deduplicated by name: a webcam visible through several APIs appears once,
/// preferring the first (native) backend. Enumeration is best-effort - a
/// machine with no cameras (or camera privacy switched on) simply yields an
/// empty list and must not break screen/window listing.
pub(crate) fn list_devices() -> Vec<CaptureSource> {
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for backend in backends() {
        for dev in backend.list() {
            if seen.insert(dev.title.to_lowercase()) {
                out.push(dev);
            }
        }
    }
    out
}

/// Open the device `id` through whichever backend owns its id-space. When
/// that backend cannot open it, fall back to another backend's device of the
/// same name: many virtual cameras (DroidCam, ...) enumerate through Media
/// Foundation but only actually *open* through DirectShow, and dedup keeps
/// the native entry - so the same physical device is retried by title.
fn open_source(id: u32) -> Result<Box<dyn FrameSource>, String> {
    let all = backends();
    let Some(owner) = all.iter().find(|b| b.owns(id)) else {
        return Err(format!("camera {id} not found"));
    };
    tracing::debug!(backend = owner.name(), id, "screenshare: opening camera");
    let primary_err = match owner.open(id) {
        Ok(source) => return Ok(source),
        Err(e) => e,
    };

    // Every backend's failure ends up in the message: "MediaFoundation failed"
    // alone sends users chasing the wrong subsystem when e.g. the device
    // simply has no active session (DroidCam without its phone connected
    // fails BOTH backends with "cannot open").
    let mut errors = vec![format!("{}: {primary_err}", owner.name())];
    let title = owner.list().into_iter().find(|c| c.id == id).map(|c| c.title);
    if let Some(title) = title {
        for other in all.iter().filter(|b| !b.owns(id)) {
            let twin = other
                .list()
                .into_iter()
                .find(|c| c.title.eq_ignore_ascii_case(&title));
            if let Some(twin) = twin {
                match other.open(twin.id) {
                    Ok(source) => {
                        tracing::info!(
                            from = owner.name(),
                            to = other.name(),
                            %title,
                            "screenshare: camera opened via fallback backend",
                        );
                        return Ok(source);
                    }
                    Err(e) => errors.push(format!("{}: {e}", other.name())),
                }
            }
        }
    }
    // Camera access on Windows is commonly EXCLUSIVE: when every backend
    // fails, the most frequent real-world causes are another app holding the
    // device or a virtual camera whose source app isn't streaming. Say so -
    // the raw backend errors ("cannot open the file", "failed to fulfill
    // requested format") send users chasing the wrong subsystem.
    Err(format!(
        "{} - is the camera in use by another application, or its source app not streaming?",
        errors.join("; "),
    ))
}

/// Cheap existence probe for [`crate::broadcast`]'s fail-fast check: opening
/// the device here would add hundreds of ms and briefly flash the camera LED
/// before the real capture takes over.
pub(crate) fn device_exists(id: u32) -> Result<(), String> {
    if list_devices().iter().any(|c| c.id == id) {
        Ok(())
    } else {
        Err(format!("camera {id} not found"))
    }
}

/// Grab one warmed-up RGBA frame for the picker thumbnail. The first frames
/// after opening are routinely black/underexposed while auto-exposure
/// settles, so a few are discarded.
pub(crate) fn capture_device_frame(id: u32) -> Result<RgbaImage, String> {
    let mut source = open_source(id)?;
    let mut frame = source.next_frame()?;
    for _ in 0..3 {
        match source.next_frame() {
            Ok(next) => frame = next,
            Err(_) => break, // keep the last good frame
        }
    }
    Ok(frame)
}

/// Capture formats requested from the device, best first. 720p30 is the UVC
/// sweet spot: virtually every webcam serves it natively, and it stays well
/// inside the encoder budget. nokhwa's `Closest` matches the *pixel format
/// strictly* (a camera without it fails outright - it does not fall through
/// to another format), so the ladder covers MJPEG (most webcams), then raw
/// YUY2 (virtual cams like DroidCam offer nothing else), then whatever the
/// device has.
fn preferred_formats() -> [RequestedFormat<'static>; 3] {
    let hd = |format| {
        RequestedFormatType::Closest(CameraFormat::new(Resolution::new(1280, 720), format, 30))
    };
    [
        RequestedFormat::new::<RgbAFormat>(hd(FrameFormat::MJPEG)),
        RequestedFormat::new::<RgbAFormat>(hd(FrameFormat::YUYV)),
        RequestedFormat::new::<RgbAFormat>(RequestedFormatType::None),
    ]
}

/// Numeric id for a camera. Backends on all three desktop OSes enumerate by
/// numeric index; string-indexed backends (browser/opencv) are not compiled
/// in, but map defensively instead of panicking.
fn index_to_id(index: &CameraIndex) -> u32 {
    match index {
        CameraIndex::Index(i) => *i,
        CameraIndex::String(s) => s.parse().unwrap_or(u32::MAX),
    }
}

/// The OS-native capture backend (nokhwa): every physical webcam, enumerated by
/// the small numeric index the platform assigns. This is Media Foundation on
/// Windows, V4L2 on Linux and AVFoundation on macOS.
struct NativeCameraBackend;

impl CameraBackend for NativeCameraBackend {
    fn name(&self) -> &'static str {
        "native"
    }

    fn list(&self) -> Vec<CaptureSource> {
        let cameras = match nokhwa::query(ApiBackend::Auto) {
            Ok(list) => list,
            Err(e) => {
                tracing::info!("screenshare: camera enumeration unavailable ({e})");
                return Vec::new();
            }
        };
        cameras
            .iter()
            .map(|info| CaptureSource {
                id: index_to_id(info.index()),
                kind: SourceKind::Device,
                // Actual capture resolution is negotiated at open time.
                title: info.human_name(),
                width: 0,
                height: 0,
            })
            .collect()
    }

    fn owns(&self, id: u32) -> bool {
        id < DSHOW_ID_BASE
    }

    fn open(&self, id: u32) -> Result<Box<dyn FrameSource>, String> {
        Ok(Box::new(NokhwaSource::open(id)?))
    }
}

/// A [`FrameSource`] backed by a nokhwa [`Camera`]. `next_frame` blocks on the
/// device's own frame cadence, which paces the capture loop at the camera's fps.
struct NokhwaSource {
    camera: Camera,
}

impl NokhwaSource {
    fn open(id: u32) -> Result<Self, String> {
        let mut last_err = String::new();
        for format in preferred_formats() {
            let mut camera = match Camera::new(CameraIndex::Index(id), format) {
                Ok(c) => c,
                Err(e) => {
                    last_err = format!("camera {id}: {e}");
                    continue;
                }
            };
            match camera.open_stream() {
                Ok(()) => return Ok(Self { camera }),
                Err(e) => last_err = format!("camera {id} stream: {e}"),
            }
        }
        Err(last_err)
    }
}

impl FrameSource for NokhwaSource {
    fn next_frame(&mut self) -> Result<RgbaImage, String> {
        let buffer = self.camera.frame().map_err(|e| format!("camera frame: {e}"))?;
        buffer.decode_image::<RgbAFormat>().map_err(|e| format!("camera decode: {e}"))
    }

    fn describe(&self) -> String {
        self.camera.camera_format().to_string()
    }
}

/// The camera capture+encode pipeline: [`FrameSource`] frames -> SIMD downscale
/// -> openh264, the same tail as [`crate::pipeline::CpuPipeline`]. The source's
/// `next_frame` blocks on the device's own cadence, so the loop naturally runs
/// at the camera's fps (capped further by the caller's frame pacing).
pub(crate) struct CameraPipeline {
    id: u32,
    source: Option<Box<dyn FrameSource>>,
    encoder: H264Encoder,
    scaler: FrameScaler,
    /// Last encode-sized frame, re-encoded when a keyframe is due while the
    /// device momentarily stalls (late joiners need IDRs regardless).
    last_scaled: Option<RgbaImage>,
    failures: u32,
    timings: StageTimings,
}

impl std::fmt::Debug for CameraPipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CameraPipeline").field("id", &self.id).finish_non_exhaustive()
    }
}

impl CameraPipeline {
    pub(crate) fn new(id: u32, settings: EncodeSettings) -> Result<Self, String> {
        let source = open_source(id)?;
        tracing::info!(
            format = %source.describe(),
            "screenshare: camera capture active",
        );
        Ok(Self {
            id,
            source: Some(source),
            encoder: H264Encoder::new(settings),
            scaler: FrameScaler::new(settings.max_dimension),
            last_scaled: None,
            failures: 0,
            timings: StageTimings::default(),
        })
    }
}

impl EncodePipeline for CameraPipeline {
    fn name(&self) -> &'static str {
        "camera"
    }

    fn next_frame(
        &mut self,
        _wait: std::time::Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let tick_start = std::time::Instant::now();

        let mut fresh: Option<RgbaImage> = None;
        if let Some(source) = &mut self.source {
            match source.next_frame() {
                Ok(img) => {
                    self.failures = 0;
                    fresh = Some(img);
                }
                Err(e) => {
                    // Transient stalls happen (exposure changes, USB hiccups);
                    // a persistent failure means the device is gone. Re-open
                    // once mid-way through the budget in case the OS handle
                    // went stale (device re-enumerated).
                    self.failures += 1;
                    if self.failures == MAX_CAPTURE_FAILURES / 2 {
                        self.source = open_source(self.id).ok();
                    }
                    if self.failures >= MAX_CAPTURE_FAILURES {
                        return Err(format!("camera lost: {e}"));
                    }
                }
            }
        } else {
            self.source = Some(open_source(self.id).map_err(|e| format!("camera lost: {e}"))?);
        }
        self.timings.capture += tick_start.elapsed();

        let had_fresh = fresh.is_some();
        if let Some(img) = fresh {
            let scale_start = std::time::Instant::now();
            self.last_scaled = Some(self.scaler.downscale(img));
            self.timings.scale += scale_start.elapsed();
        }

        if !(had_fresh || force_keyframe) {
            return Ok(None);
        }
        let Some(img) = self.last_scaled.as_ref() else {
            return Ok(None); // nothing captured yet
        };

        let encode_start = std::time::Instant::now();
        let encoded =
            self.encoder.encode_rgba(img.width(), img.height(), img.as_raw(), force_keyframe)?;
        self.timings.encode += encode_start.elapsed();
        if encoded.is_some() {
            self.timings.frames += 1;
        }
        self.timings.maybe_log("camera", img.width(), img.height());
        Ok(encoded)
    }

    fn shutdown(&mut self) {
        // Dropping the source releases the OS capture handle (nokhwa stops its
        // stream on drop; the DirectShow graph stops and uninitialises COM).
        self.source = None;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual perf check through the SAME path the app uses (`open_source`:
    /// backend ladder + cross-backend fallback): frames per second per listed
    /// camera. Run on the affected machine:
    /// `cargo test --release -p fancy-screenshare manual_all_cameras_fps -- --ignored --nocapture`
    #[test]
    #[ignore = "manual perf measurement; needs real capture devices"]
    fn manual_all_cameras_fps() {
        for dev in list_devices() {
            print!("{} (id {}): ", dev.title, dev.id);
            let mut src = match open_source(dev.id) {
                Ok(s) => s,
                Err(e) => {
                    println!("open ERR: {e}");
                    continue;
                }
            };
            let _ = src.next_frame(); // warmup / spin-up
            let n = 60u32;
            let start = std::time::Instant::now();
            for _ in 0..n {
                if let Err(e) = src.next_frame() {
                    println!("frame ERR after warmup: {e}");
                    break;
                }
            }
            let elapsed = start.elapsed();
            println!(
                "{} -> {:.1} fps ({} frames in {:?})",
                src.describe(),
                f64::from(n) / elapsed.as_secs_f64(),
                n,
                elapsed,
            );
        }
    }

    /// Enumeration must never panic or error the whole source list - a
    /// machine without cameras (CI) simply yields no Device sources.
    #[test]
    fn enumeration_is_infallible() {
        let devices = list_devices();
        for device in &devices {
            assert_eq!(device.kind, SourceKind::Device);
            assert!(!device.title.is_empty());
        }
    }

    /// A bogus id must fail the existence probe (fail-fast path in
    /// `ScreenBroadcaster::start`), not hang or panic.
    #[test]
    fn bogus_device_id_fails_probe() {
        assert!(device_exists(u32::MAX - 1).is_err());
    }
}
