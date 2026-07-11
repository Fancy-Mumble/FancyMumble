//! Capture/encode pipeline orchestration.
//!
//! This is the industry pattern (Chromium, Discord, Teams): ONE shared
//! orchestration layer over per-OS backends, selected at compile time by
//! target gates and at runtime by capability probing:
//!
//! | platform | preferred backend                              | fallback |
//! |----------|------------------------------------------------|----------|
//! | Windows  | WGC → D3D11 VideoProcessor → MF hardware H.264 | CPU      |
//! | Linux    | PipeWire → VA-API (seam prepared, see below)   | CPU      |
//! | others   | CPU                                            | -        |
//!
//! The CPU backend (xcap capture + threaded I420 + openh264) works on every
//! desktop OS and is always available; GPU backends are a strictly-better
//! replacement when the machine provides them. All backends speak
//! [`EncodePipeline`]: a source goes in at construction, encoded H.264
//! Annex-B frames come out, and the broadcaster neither knows nor cares
//! which one it drives.

use std::time::{Duration, Instant};

use crate::encode::{EncodeSettings, EncodedFrame, H264Encoder, VideoEncoder};
use crate::sources::{self, SourceKind};

/// Consecutive capture failures tolerated before a pipeline declares the
/// source lost (e.g. the shared window was closed).
pub(crate) const MAX_CAPTURE_FAILURES: u32 = 30;

/// One platform capture+encode pipeline: frames of the chosen source go in
/// (internally), encoded H.264 comes out.
pub(crate) trait EncodePipeline {
    /// Short name for logs ("cpu", "windows-gpu", "linux-vaapi").
    fn name(&self) -> &'static str;

    /// Pump the pipeline once, waiting up to `wait` for a new frame.
    ///
    /// * `Ok(Some(frame))` - an encoded frame to send.
    /// * `Ok(None)` - nothing changed on screen (and no keyframe was due).
    /// * `Err(_)` - the pipeline is dead (source lost, device reset); the
    ///   caller ends or fails over.
    fn next_frame(
        &mut self,
        wait: Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String>;

    /// Release OS resources (capture sessions, encoder devices). Idempotent.
    fn shutdown(&mut self);
}

/// Pick the best pipeline for this OS + machine, falling back to CPU.
pub(crate) fn create_pipeline(
    kind: SourceKind,
    source_id: u32,
    settings: EncodeSettings,
) -> Result<Box<dyn EncodePipeline>, String> {
    #[cfg(all(windows, feature = "gpu"))]
    if kind == SourceKind::Screen {
        // Tier 1: the D3D12-native pipeline (Windows 11 video encode API -
        // the same modern path Chrome/Edge are rolling out).
        match crate::gpu_windows_d3d12::GpuPipelineD3D12::new(source_id, &settings) {
            Ok(_p) => {
                // Stage B mounts the trait impl here once the encoder lands.
                tracing::info!("screenshare: D3D12 pipeline selected");
            }
            Err(e) => {
                tracing::info!("screenshare: D3D12 pipeline unavailable ({e})");
            }
        }
        // Tier 2: D3D11 + MediaFoundation (what Chrome stable ships today).
        match crate::gpu_windows::GpuPipeline::new(source_id, &settings) {
            Ok(p) => {
                tracing::info!(dims = ?p.output_dims(), "screenshare: Windows GPU (D3D11/MF) pipeline active");
                return Ok(Box::new(p));
            }
            Err(e) => {
                tracing::info!("screenshare: GPU pipeline unavailable ({e}); using CPU pipeline");
            }
        }
    }

    #[cfg(all(target_os = "linux", feature = "gpu"))]
    {
        // The Chromium-style Linux stack: xdg-desktop-portal ScreenCast ->
        // PipeWire capture (works for screens AND windows, and is the only
        // path Wayland permits at all) -> VA-API H.264, with openh264 as the
        // in-pipeline encode fallback. If the portal itself is unavailable
        // (bare X11 session, no portal daemon) this fails fast and the xcap
        // CPU pipeline below takes over - the same ladder Chromium walks.
        match crate::linux::GpuPipelineLinux::new(kind, source_id, settings) {
            Ok(p) => {
                tracing::info!(encoder = p.name(), "screenshare: Linux portal pipeline active");
                return Ok(Box::new(p));
            }
            Err(e) => {
                tracing::info!(
                    "screenshare: portal pipeline unavailable ({e}); using CPU pipeline"
                );
            }
        }
    }

    CpuPipeline::new(kind, source_id, settings).map(|p| Box::new(p) as Box<dyn EncodePipeline>)
}

/// The portable software pipeline: xcap capture (change-driven recorder for
/// whole screens where the OS provides one, polled otherwise), SIMD
/// downscale, threaded I420 conversion, openh264 encode.
pub(crate) struct CpuPipeline {
    kind: SourceKind,
    source_id: u32,
    target: sources::CaptureTarget,
    recorder: Option<sources::ScreenRecorder>,
    encoder: H264Encoder,
    scaler: FrameScaler,
    /// Last encode-sized frame, re-encoded when a keyframe is due while the
    /// source is static (late joiners need IDRs even on a still screen).
    last_scaled: Option<image::RgbaImage>,
    failures: u32,
    timings: StageTimings,
}

impl std::fmt::Debug for CpuPipeline {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CpuPipeline").field("kind", &self.kind).finish_non_exhaustive()
    }
}

impl CpuPipeline {
    pub(crate) fn new(
        kind: SourceKind,
        source_id: u32,
        settings: EncodeSettings,
    ) -> Result<Self, String> {
        // Resolve the OS capture handle ONCE - re-enumerating per frame is
        // what once capped busy desktops below 1 fps (Window::all() walks
        // every top-level window in the system).
        let target = sources::CaptureTarget::resolve(kind, source_id)?;
        let recorder = match kind {
            SourceKind::Screen => sources::ScreenRecorder::start(source_id),
            SourceKind::Window => None,
        };
        Ok(Self {
            kind,
            source_id,
            target,
            recorder,
            encoder: H264Encoder::new(settings),
            scaler: FrameScaler::new(settings.max_dimension),
            last_scaled: None,
            failures: 0,
            timings: StageTimings::default(),
        })
    }
}

impl EncodePipeline for CpuPipeline {
    fn name(&self) -> &'static str {
        "cpu"
    }

    fn next_frame(
        &mut self,
        wait: Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let tick_start = Instant::now();

        // Acquire the next frame (None = source unchanged; only the polled
        // path can actually fail).
        let mut fresh: Option<image::RgbaImage> = None;
        if let Some(rec) = &self.recorder {
            match rec.latest_frame(wait) {
                sources::RecorderFrame::Frame(f) => {
                    fresh = image::RgbaImage::from_raw(f.width, f.height, f.raw);
                }
                sources::RecorderFrame::Idle => {}
                sources::RecorderFrame::Dead => {
                    tracing::warn!("screenshare: screen recorder died; falling back to polling");
                    self.recorder = None;
                }
            }
        } else {
            match self.target.capture() {
                Ok(img) => fresh = Some(img),
                Err(e) => {
                    // The handle may have gone stale (window recreated,
                    // monitor topology change) - re-resolve for next tick.
                    if let Ok(t) = sources::CaptureTarget::resolve(self.kind, self.source_id) {
                        self.target = t;
                    }
                    self.failures += 1;
                    if self.failures >= MAX_CAPTURE_FAILURES {
                        return Err(format!("capture lost: {e}"));
                    }
                    return Ok(None);
                }
            }
        }
        self.failures = 0;
        self.timings.capture += tick_start.elapsed();

        let had_fresh = fresh.is_some();
        if let Some(img) = fresh {
            let scale_start = Instant::now();
            self.last_scaled = Some(self.scaler.downscale(img));
            self.timings.scale += scale_start.elapsed();
        }

        // Fresh frames always encode; a static source re-encodes the last
        // frame only when the caller demands a keyframe.
        if !(had_fresh || force_keyframe) {
            return Ok(None);
        }
        let Some(img) = self.last_scaled.as_ref() else {
            return Ok(None); // nothing captured yet
        };

        let encode_start = Instant::now();
        let encoded =
            self.encoder.encode_rgba(img.width(), img.height(), img.as_raw(), force_keyframe)?;
        self.timings.encode += encode_start.elapsed();
        if encoded.is_some() {
            self.timings.frames += 1;
        }
        self.timings.maybe_log("cpu", img.width(), img.height());
        Ok(encoded)
    }

    fn shutdown(&mut self) {
        if let Some(rec) = self.recorder.take() {
            rec.shutdown();
        }
    }
}

/// Rolling per-stage cost accounting, logged every few seconds so a slow
/// share names its bottleneck (capture vs scale vs encode).
#[derive(Debug, Default)]
pub(crate) struct StageTimings {
    pub(crate) capture: Duration,
    pub(crate) scale: Duration,
    pub(crate) encode: Duration,
    pub(crate) frames: u32,
    window_start: Option<Instant>,
}

impl StageTimings {
    pub(crate) fn maybe_log(&mut self, pipeline: &str, out_w: u32, out_h: u32) {
        let start = *self.window_start.get_or_insert_with(Instant::now);
        let window = start.elapsed();
        if window < Duration::from_secs(5) {
            return;
        }
        let frames = self.frames.max(1);
        tracing::info!(
            pipeline,
            fps = format!("{:.1}", f64::from(self.frames) / window.as_secs_f64()),
            capture_ms = self.capture.as_millis() as u64 / u64::from(frames),
            scale_ms = self.scale.as_millis() as u64 / u64::from(frames),
            encode_ms = self.encode.as_millis() as u64 / u64::from(frames),
            out_w,
            out_h,
            "screenshare: pipeline timings (per frame)",
        );
        *self = Self::default();
    }
}

/// Downscales captured frames so their longest edge fits the encode budget,
/// using SIMD area averaging (`fast_image_resize`).
pub(crate) struct FrameScaler {
    max_dim: u32,
    resizer: fast_image_resize::Resizer,
}

impl std::fmt::Debug for FrameScaler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FrameScaler").field("max_dim", &self.max_dim).finish_non_exhaustive()
    }
}

impl FrameScaler {
    pub(crate) fn new(max_dim: u32) -> Self {
        Self { max_dim, resizer: fast_image_resize::Resizer::new() }
    }

    /// Downscale `img` so its longest edge is at most `max_dim` (0 = no cap);
    /// smaller frames pass through untouched. Box filter = proper area
    /// averaging, ideal for shrinking screen content.
    pub(crate) fn downscale(&mut self, img: image::RgbaImage) -> image::RgbaImage {
        if self.max_dim == 0 {
            return img;
        }
        let (w, h) = (img.width(), img.height());
        let longest = w.max(h);
        if longest <= self.max_dim {
            return img;
        }
        let scale = f64::from(self.max_dim) / f64::from(longest);
        // Even dimensions keep the encoder's I420 alignment exact.
        let nw = (((f64::from(w) * scale) as u32).max(2)) & !1;
        let nh = (((f64::from(h) * scale) as u32).max(2)) & !1;

        let Ok(src) = fast_image_resize::images::Image::from_vec_u8(
            w,
            h,
            img.into_raw(),
            fast_image_resize::PixelType::U8x4,
        ) else {
            tracing::warn!("screenshare: scaler rejected source frame");
            return image::RgbaImage::new(2, 2);
        };
        let mut dst =
            fast_image_resize::images::Image::new(nw, nh, fast_image_resize::PixelType::U8x4);
        let options = fast_image_resize::ResizeOptions::new().resize_alg(
            fast_image_resize::ResizeAlg::Convolution(fast_image_resize::FilterType::Box),
        );
        if let Err(e) = self.resizer.resize(&src, &mut dst, &options) {
            tracing::warn!("screenshare: downscale failed: {e}");
            // Rebuild the original frame; encoding full-size beats dropping it.
            return image::RgbaImage::from_raw(w, h, src.into_vec())
                .unwrap_or_else(|| image::RgbaImage::new(2, 2));
        }
        image::RgbaImage::from_raw(nw, nh, dst.into_vec())
            .unwrap_or_else(|| image::RgbaImage::new(2, 2))
    }
}
