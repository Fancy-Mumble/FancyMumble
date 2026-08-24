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

    /// Re-encode the last produced picture as a (near-empty) delta frame.
    ///
    /// Change-driven capture emits NOTHING while the source is static, which
    /// starves the receiver's jitter buffer and makes natural pauses register
    /// as stream "freezes". The capture loop calls this on idle so RTP keeps
    /// flowing at a low keep-alive rate (Chrome's screen capture does the
    /// same). `Ok(None)` when the backend has no picture to repeat (or the
    /// concept doesn't apply - cameras never idle).
    fn encode_repeat(&mut self) -> Result<Option<EncodedFrame>, String> {
        Ok(None)
    }

    /// Release OS resources (capture sessions, encoder devices). Idempotent.
    fn shutdown(&mut self);
}

/// Pick the best pipeline for this OS + machine, falling back to CPU.
pub(crate) fn create_pipeline(
    kind: SourceKind,
    source_id: u32,
    settings: EncodeSettings,
) -> Result<Box<dyn EncodePipeline>, String> {
    // Cameras have exactly one capture path (the OS camera API via nokhwa);
    // the GPU screen-capture tiers below do not apply to them.
    if kind == SourceKind::Device {
        return crate::camera::CameraPipeline::new(source_id, settings)
            .map(|p| Box::new(p) as Box<dyn EncodePipeline>);
    }

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
                tracing::info!(
                    encoder = p.name(),
                    "screenshare: Linux portal pipeline active"
                );
                return Ok(Box::new(p));
            }
            Err(e) if source_id == 0 && sources::ensure_present(kind, source_id).is_err() => {
                // Advisory portal id (the compositor's dialog picks the real
                // source): no OS handle exists for the CPU fallback to
                // resolve, so falling through would bury this real failure
                // under a nonsense "screen 0 not found".
                //
                // `ensure_present` is what distinguishes that advisory 0 from
                // a *real* monitor whose id happens to be 0 - xcap's single
                // screen on a bare X server (Xvfb) is exactly that, and on
                // "id == 0" alone a portal-less X session was refused the CPU
                // fallback it needs most: the share died at start with the
                // portal's error on a display that never had a portal.
                return Err(e);
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
        f.debug_struct("CpuPipeline")
            .field("kind", &self.kind)
            .finish_non_exhaustive()
    }
}

impl CpuPipeline {
    /// One polled grab to prime a change-driven recorder that has reported no
    /// change yet.
    ///
    /// Logged, never swallowed: a failing grab looks identical to "the screen
    /// is still" from every other observation point, and that ambiguity
    /// already cost a debugging session on a display whose root was not
    /// readable at all. `None` simply retries on the next tick (~100 ms),
    /// which is the cadence the pure-polling path pays anyway.
    fn priming_grab(&self) -> Option<image::RgbaImage> {
        match self.target.capture() {
            Ok(img) => Some(img),
            Err(e) => {
                tracing::debug!("screenshare: priming grab failed ({e}); retrying next tick");
                None
            }
        }
    }

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
            // Devices never reach this pipeline (routed to CameraPipeline).
            SourceKind::Window | SourceKind::Device => None,
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
                sources::RecorderFrame::Idle => {
                    // A change-driven recorder reports *changes*, and a still
                    // screen has none - including at t=0. Without this, a
                    // monitor share of an idle desktop never produces even its
                    // FIRST frame: no initial IDR, nothing cached for
                    // `encode_repeat` or a demanded keyframe to re-encode, and
                    // the track sends zero RTP while the broadcaster raises a
                    // capture-stall hint that blames scanout. Viewers wait on
                    // a keyframe that cannot come. One polled grab primes the
                    // stream; from then on the cached frame serves keyframe
                    // demands and the recorder serves changes. A failed grab
                    // stays `None` and the next tick (~100 ms) retries, which
                    // is the cadence the pure-polling path pays anyway.
                    if self.last_scaled.is_none() {
                        fresh = self.priming_grab();
                    }
                }
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
            self.encoder
                .encode_rgba(img.width(), img.height(), img.as_raw(), force_keyframe)?;
        self.timings.encode += encode_start.elapsed();
        if encoded.is_some() {
            self.timings.frames += 1;
        }
        self.timings.maybe_log("cpu", img.width(), img.height());
        Ok(encoded)
    }

    fn encode_repeat(&mut self) -> Result<Option<EncodedFrame>, String> {
        let Some(img) = self.last_scaled.as_ref() else {
            return Ok(None);
        };
        // Same input again = a minimal P-frame (no keyframe).
        self.encoder
            .encode_rgba(img.width(), img.height(), img.as_raw(), false)
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
        f.debug_struct("FrameScaler")
            .field("max_dim", &self.max_dim)
            .finish_non_exhaustive()
    }
}

impl FrameScaler {
    pub(crate) fn new(max_dim: u32) -> Self {
        Self {
            max_dim,
            resizer: fast_image_resize::Resizer::new(),
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual diagnostic for screen-share delivery stalls: run the REAL
    /// pipeline selection (`create_pipeline`, GPU tier first) against the
    /// primary monitor for 20 s, mimicking the broadcast loop's pacing and
    /// 4 s periodic keyframes, and report the inter-frame GAP distribution.
    /// Freezes at receivers are born from gaps here. Run with an animated
    /// window on screen (e.g. `py fixtures/checkerboard.py --animate-ms 50`):
    /// `cargo test -p fancy-screenshare --release manual_screen_pipeline_gaps -- --ignored --nocapture`
    #[test]
    #[ignore = "manual diagnostic; needs a display with moving content"]
    fn manual_screen_pipeline_gaps() {
        tracing_subscriber::fmt().with_env_filter("info").init();
        let monitors = xcap::Monitor::all().expect("monitors");
        let monitor = monitors.first().expect("at least one monitor");
        let id = monitor.id().expect("monitor id");

        let settings = EncodeSettings::default();
        let mut pipeline = create_pipeline(SourceKind::Screen, id, settings).expect("pipeline");
        println!("pipeline: {}", pipeline.name());

        let frame_interval = Duration::from_secs_f32(1.0 / settings.max_fps.max(1.0));
        let run = Duration::from_secs(20);
        let periodic = Duration::from_secs(4);
        let start = Instant::now();
        let mut last_keyframe = Instant::now();
        let mut last_frame: Option<Instant> = None;
        let mut last_emit = Instant::now();
        let mut gaps_ms: Vec<u64> = Vec::new();
        let mut frames = 0u32;
        let mut repeats = 0u32;
        let mut sizes: Vec<usize> = Vec::new();

        // Mirror the production capture loop EXACTLY: 100 ms `next_frame` wait
        // (full throughput on active content) plus a 90 ms gap-fill repeat so
        // idle holes do not become receiver freezes. The emitted-frame gap
        // distribution here is what the receiver sees.
        const IDLE_REPEAT: Duration = Duration::from_millis(90);
        while start.elapsed() < run {
            let tick = Instant::now();
            let force = last_keyframe.elapsed() >= periodic;
            let produced = pipeline
                .next_frame(frame_interval.max(Duration::from_millis(100)), force)
                .and_then(|frame| match frame {
                    Some(f) => Ok(Some((f, false))),
                    None if last_emit.elapsed() >= IDLE_REPEAT => {
                        Ok(pipeline.encode_repeat()?.map(|f| (f, true)))
                    }
                    None => Ok(None),
                });
            match produced {
                Ok(Some((f, is_repeat))) => {
                    last_emit = Instant::now();
                    if f.keyframe {
                        last_keyframe = Instant::now();
                    }
                    let now = Instant::now();
                    if let Some(prev) = last_frame.replace(now) {
                        gaps_ms.push(now.duration_since(prev).as_millis() as u64);
                    }
                    frames += 1;
                    repeats += u32::from(is_repeat);
                    sizes.push(f.data.len());
                }
                Ok(None) => {}
                Err(e) => panic!("pipeline failed after {frames} frames: {e}"),
            }
            let elapsed = tick.elapsed();
            if elapsed < frame_interval {
                std::thread::sleep(frame_interval - elapsed);
            }
        }
        pipeline.shutdown();

        gaps_ms.sort_unstable();
        let p = |q: f64| {
            gaps_ms
                .get(((gaps_ms.len() as f64 * q) as usize).min(gaps_ms.len() - 1))
                .copied()
                .unwrap_or(0)
        };
        let over200 = gaps_ms.iter().filter(|&&g| g > 200).count();
        let max_size = sizes.iter().copied().max().unwrap_or(0);
        let avg_size = if sizes.is_empty() {
            0
        } else {
            sizes.iter().sum::<usize>() / sizes.len()
        };
        let over150 = gaps_ms.iter().filter(|&&g| g > 150).count();
        println!(
            "frames={frames} ({repeats} repeats) over 20s = {:.1} fps | gap p50={}ms p95={}ms p99={}ms max={}ms | gaps>150ms: {over150} >200ms: {over200} | frame size avg={avg_size}B max={max_size}B",
            f64::from(frames) / 20.0,
            p(0.5), p(0.95), p(0.99),
            gaps_ms.last().copied().unwrap_or(0),
        );
    }
}
