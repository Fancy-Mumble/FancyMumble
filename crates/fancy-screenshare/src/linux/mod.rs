//! The Linux capture+encode pipeline, deliberately shaped like
//! Chromium/Blink's:
//!
//! | Chromium component                      | Here                    |
//! |-----------------------------------------|-------------------------|
//! | `ScreenCastPortal` (xdg-desktop-portal) | [`portal`]              |
//! | `SharedScreenCastStream` (PipeWire)     | [`pipewire_stream`]     |
//! | `VaapiVideoEncodeAccelerator`           | [`vaapi`] (cros-codecs) |
//! | (no Chromium equivalent; Discord-style) | [`nvenc`]               |
//! | software encoder fallback               | openh264 tier below     |
//!
//! Capture and encode degrade independently, exactly like Chromium: the
//! portal/PipeWire capture is mandatory here (it is the only Wayland path
//! and preferred on X11), while the encoder walks VA-API -> NVENC ->
//! openh264. VA-API first because it is Chromium's path and covers
//! Intel/AMD; NVIDIA's VA driver is a decode-only shim, so on NVIDIA
//! machines the VA probe fails fast and NVENC (what Discord ships there;
//! Chromium just uses software) takes over. If the PORTAL itself is
//! unavailable, [`GpuPipelineLinux::new`] fails and the orchestrator falls
//! back to the xcap/X11 CPU pipeline.
//!
//! Platform quirks worth knowing:
//! - The compositor shows ITS OWN picker after ours (Wayland's security
//!   model; Chromium double-dialogs the same way). The in-app pick chooses
//!   screen-vs-window scoping; the compositor picks the concrete source, so
//!   the `source_id` from our picker is advisory only here.
//! - The portal dialog blocks `start_screen_broadcast` (and with it the
//!   broadcaster slot) until the user answers. Bring-up TODO: pre-open the
//!   session while the in-app picker is still showing.
//! - The user can end the cast from the compositor's own UI; that surfaces
//!   as [`pipewire_stream::StreamFrame::Dead`] and cleanly ends the
//!   broadcast.

pub mod camera_portal;
mod egl_import;
pub(crate) mod audio_capture;
mod egl_modifiers;
mod nvenc;
mod pipewire_stream;
mod portal;
mod vaapi;

use std::time::Instant;

pub use portal::set_restore_last_pick;

use crate::encode::{scaled_bitrate, EncodeSettings, EncodedFrame, H264Encoder, VideoEncoder};
use crate::pipeline::{EncodePipeline, FrameScaler, StageTimings};
use crate::sources::SourceKind;

/// The ONE runtime every portal (ashpd/zbus) interaction runs on, for the
/// life of the process.
///
/// ashpd caches a process-global D-Bus connection (`static SESSION` in its
/// proxy.rs) whose socket-reader task is spawned on the runtime of the
/// FIRST portal call. The previous design gave each portal session its own
/// short-lived runtime and shut it down at teardown - killing that reader,
/// after which the cached connection was deaf and every later portal
/// request stalled ("Portal request didn't receive a response"; before the
/// timeouts, an infinite hang: the original share-once-then-never-again
/// bug). One worker thread is plenty - this only shuttles D-Bus traffic.
pub(crate) fn portal_runtime() -> Result<&'static tokio::runtime::Runtime, String> {
    use std::sync::OnceLock;
    static RT: OnceLock<Result<tokio::runtime::Runtime, String>> = OnceLock::new();
    RT.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("portal-dbus")
            .enable_all()
            .build()
            .map_err(|e| format!("portal runtime: {e}"))
    })
    .as_ref()
    .map_err(Clone::clone)
}

/// Whether the compositor's own portal dialog should REPLACE the in-app
/// source picker: true on GNOME, whose Mutter offers no app-driven capture
/// or preview path (picker thumbnails would need a separate screenshot
/// grant), so the portal's native picker is the intended - and only fully
/// working - selection UI. Other desktops (KDE, wlroots) keep the in-app
/// picker, which merely scopes the portal dialog that follows.
///
/// The e2e harness drives the in-app picker through `WebDriver` and cannot
/// reach compositor dialogs, so its clients (marked by `FANCY_E2E_DATA_DIR`,
/// the same override the data-dir isolation uses) keep the in-app picker
/// even when GNOME's environment leaks into an xvfb-wrapped run.
pub fn native_portal_picker() -> bool {
    if std::env::var_os("FANCY_E2E_DATA_DIR").is_some() {
        return false;
    }
    std::env::var("XDG_CURRENT_DESKTOP")
        .unwrap_or_default()
        .to_ascii_lowercase()
        .contains("gnome")
}

/// Encoder tiers inside the Linux pipeline (capture is common).
enum EncoderTier {
    Vaapi(vaapi::VaapiEncoder),
    Nvenc(nvenc::NvencEncoder),
    Cpu(Box<H264Encoder>),
}

/// The Linux encoder ladder behind one capture source, however the pixels
/// arrive (PipeWire or xcap). Hardware encode does not depend on how a frame
/// was captured, so a session without a portal (bare X11, the e2e rig) gets
/// the same NVENC / VA-API tiers as the portal pipeline instead of paying
/// for software encode because of where its pixels came from.
///
/// Inherent methods rather than [`VideoEncoder`]: the VA-API tier is not
/// `Send`, and neither pipeline needs it to be.
pub(crate) struct LinuxEncoder {
    tier: EncoderTier,
    settings: EncodeSettings,
    /// Dimensions of the last frame handed in, for [`Self::content_bitrate`].
    last_dims: Option<(u32, u32)>,
}

impl LinuxEncoder {
    /// Walk the ladder from wherever [`EncoderPreference`] says it starts.
    pub(crate) fn new(settings: EncodeSettings) -> Self {
        Self {
            tier: probe_encoder(settings, EncoderPreference::from_env()),
            settings,
            last_dims: None,
        }
    }

    /// The tier in use: "vaapi", "nvenc" or "cpu".
    pub(crate) fn tier_name(&self) -> &'static str {
        match self.tier {
            EncoderTier::Vaapi(_) => "vaapi",
            EncoderTier::Nvenc(_) => "nvenc",
            EncoderTier::Cpu(_) => "cpu",
        }
    }

    /// Pipeline name for the xcap capture path, for logs and stats.
    pub(crate) fn xcap_pipeline_name(&self) -> &'static str {
        match self.tier {
            EncoderTier::Vaapi(_) => "xcap-vaapi",
            EncoderTier::Nvenc(_) => "xcap-nvenc",
            EncoderTier::Cpu(_) => "cpu",
        }
    }

    /// The bitrate curve at the dimensions last encoded (see
    /// [`scaled_bitrate`]); `None` before the first frame.
    pub(crate) fn content_bitrate(&self) -> Option<u32> {
        let (w, h) = self.last_dims?;
        Some(scaled_bitrate(&self.settings, w & !1, h & !1))
    }

    /// Encode with the current tier; a GPU-tier failure mid-stream demotes
    /// to openh264 permanently (with a fresh IDR so viewers re-sync).
    pub(crate) fn encode_rgba(
        &mut self,
        w: u32,
        h: u32,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        self.last_dims = Some((w, h));
        let gpu_error = match &mut self.tier {
            EncoderTier::Vaapi(vaapi) => match vaapi.encode_rgba(w, h, rgba, force_keyframe) {
                Ok(encoded) => return Ok(encoded),
                Err(e) => format!("VA-API: {e}"),
            },
            EncoderTier::Nvenc(nvenc) => match nvenc.encode_rgba(w, h, rgba, force_keyframe) {
                Ok(encoded) => return Ok(encoded),
                Err(e) => format!("NVENC: {e}"),
            },
            EncoderTier::Cpu(cpu) => return cpu.encode_rgba(w, h, rgba, force_keyframe),
        };
        tracing::warn!(
            "screenshare: GPU encode failed mid-stream ({gpu_error}); demoting to openh264"
        );
        let mut cpu = H264Encoder::new(self.settings);
        let encoded = cpu.encode_rgba(w, h, rgba, true);
        self.tier = EncoderTier::Cpu(Box::new(cpu));
        encoded
    }

    /// Retarget the live tier's rate control, in bits per second.
    pub(crate) fn set_bitrate(&mut self, bps: u32) {
        match &mut self.tier {
            EncoderTier::Vaapi(vaapi) => vaapi.set_bitrate(bps),
            EncoderTier::Nvenc(nvenc) => nvenc.set_bitrate(bps),
            EncoderTier::Cpu(cpu) => cpu.set_bitrate(bps),
        }
    }
}

/// Walk the encoder ladder from `preference` down, ending at openh264.
///
/// A tier the preference skips is not probed at all, which is the point:
/// on the dual-GPU machines this exists for, probing VA-API is exactly
/// what goes wrong, so declining to ask is the only answer.
fn probe_encoder(settings: EncodeSettings, preference: EncoderPreference) -> EncoderTier {
    // Why each tier above the one chosen was passed over, so a single log
    // line explains the result instead of the reader inferring it from an
    // absence.
    let mut passed_over: Vec<String> = Vec::new();

    // On a machine whose displays hang off an NVIDIA card, NVENC is the
    // right tier and VA-API is a trap: NVIDIA's VA driver is a decode-only
    // shim, so the VA-API probe walks past it to whatever OTHER GPU can
    // encode - typically an unused iGPU. Capture then happens on one GPU
    // and encode on another, which is silent, slow, and (with a compositor
    // that hands out tiled NVIDIA buffers) a source of corrupt frames.
    // Only the DEFAULT order is affected; an explicit preference is still
    // obeyed, so `FANCY_SCREENSHARE_ENCODER=vaapi` can still force it.
    if preference == EncoderPreference::Vaapi
        && display_gpu_driver().as_deref() == Some("nvidia")
    {
        match nvenc::NvencEncoder::probe(settings) {
            Ok(nvenc) => {
                tracing::info!("screenshare: using NVENC (the displays are on the NVIDIA GPU)");
                return EncoderTier::Nvenc(nvenc);
            }
            Err(err) => passed_over.push(format!("NVENC (display GPU): {err}")),
        }
    }

    if preference == EncoderPreference::Vaapi {
        match vaapi::VaapiEncoder::probe(settings) {
            Ok(vaapi) => return EncoderTier::Vaapi(vaapi),
            Err(err) => passed_over.push(format!("VA-API: {err}")),
        }
    } else {
        passed_over.push(format!("VA-API: skipped ({ENCODER_ENV})"));
    }

    if preference == EncoderPreference::Cpu {
        passed_over.push(format!("NVENC: skipped ({ENCODER_ENV})"));
    } else {
        match nvenc::NvencEncoder::probe(settings) {
            Ok(nvenc) => {
                let why = passed_over.join("; ");
                tracing::info!("screenshare: using NVENC ({why})");
                return EncoderTier::Nvenc(nvenc);
            }
            Err(err) => passed_over.push(format!("NVENC: {err}")),
        }
    }

    let why = passed_over.join("; ");
    tracing::info!("screenshare: no GPU encoder ({why}); encoding with openh264 instead");
    EncoderTier::Cpu(Box::new(H264Encoder::new(settings)))
}


/// Driver name of a GPU that drives a connected display (`nvidia`, `amdgpu`,
/// `i915`, ...), or `None` when nothing is connected or sysfs is unreadable.
///
/// This is how the tier ladder learns which GPU the compositor's buffers
/// actually live on. A hybrid machine has several render nodes and no way to
/// tell them apart from `/dev/dri` alone.
fn display_gpu_driver() -> Option<String> {
    let drm = std::path::Path::new("/sys/class/drm");
    for entry in std::fs::read_dir(drm).ok()?.flatten() {
        let name = entry.file_name().into_string().ok()?;
        // Connector directories are "card0-DP-1"; the card itself has no dash.
        let Some((card, _)) = name.split_once('-') else {
            continue;
        };
        if !card.starts_with("card") {
            continue;
        }
        let connected = std::fs::read_to_string(drm.join(&name).join("status"))
            .map(|s| s.trim() == "connected")
            .unwrap_or(false);
        if !connected {
            continue;
        }
        if let Ok(driver) = std::fs::canonicalize(drm.join(card).join("device").join("driver")) {
            if let Some(base) = driver.file_name().and_then(|n| n.to_str()) {
                return Some(base.to_owned());
            }
        }
    }
    None
}

/// The environment variable that names where the encoder ladder starts.
const ENCODER_ENV: &str = "FANCY_SCREENSHARE_ENCODER";

/// Which tier [`GpuPipelineLinux::probe_encoder`] starts the ladder at.
///
/// VA-API first is the right default nearly everywhere, and it is what
/// Chromium does. On a machine with BOTH an integrated GPU and a discrete
/// NVIDIA one it is the wrong default, and silently so: [`vaapi`]'s probe
/// calls `libva::Display::open`, which takes the FIRST `/dev/dri` render
/// node, and that is the integrated card. Its VA driver answers, the probe
/// succeeds, and the discrete card's NVENC is never reached. Nothing inside
/// the probe order can notice - both tiers really do work - so the choice
/// has to come from outside the process.
///
/// [`ENCODER_ENV`] names the tier to START at; the ladder then continues in
/// its usual order, and openh264 remains the last resort in every case.
/// `nvenc` therefore means "skip VA-API", not "NVENC or nothing": a
/// broadcast is never worth failing over a preference.
///
/// | Value            | Ladder                        |
/// |------------------|-------------------------------|
/// | unset, `vaapi`   | VA-API -> NVENC -> openh264   |
/// | `nvenc`          | NVENC -> openh264             |
/// | `cpu`            | openh264                      |
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EncoderPreference {
    Vaapi,
    Nvenc,
    Cpu,
}

impl EncoderPreference {
    /// The tier `value` names, or `None` when it names none of them.
    fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "vaapi" | "va-api" => Some(Self::Vaapi),
            "nvenc" | "nvidia" => Some(Self::Nvenc),
            "cpu" | "openh264" | "software" => Some(Self::Cpu),
            _ => None,
        }
    }

    /// What the environment asks for, defaulting to the VA-API-first ladder.
    ///
    /// An unrecognised value is reported and then ignored rather than
    /// refused. This runs when somebody starts a broadcast, and killing that
    /// over a stray environment variable helps nobody. But a typo that
    /// quietly changed nothing would be worse in the one situation this
    /// exists for - a benchmark that measured the iGPU while its operator
    /// believed it measured NVENC - so it is logged at error level rather
    /// than dropped.
    fn from_env() -> Self {
        let Some(raw) = std::env::var_os(ENCODER_ENV) else {
            return Self::Vaapi;
        };
        let text = raw.to_string_lossy();
        match Self::parse(&text) {
            Some(preference) => {
                tracing::info!(
                    "screenshare: {ENCODER_ENV}={text}; ladder starts at {preference:?}"
                );
                preference
            }
            None => {
                tracing::error!(
                    "screenshare: {ENCODER_ENV}={text} names no encoder tier \
                     (expected vaapi, nvenc or cpu); using the default ladder"
                );
                Self::Vaapi
            }
        }
    }
}

/// Portal + PipeWire capture with VA-API (preferred) or openh264 encode.
pub(crate) struct GpuPipelineLinux {
    /// Held for its lifetime: dropping it closes the cast.
    portal: portal::PortalSession,
    stream: pipewire_stream::PwCaptureStream,
    encoder: LinuxEncoder,
    settings: EncodeSettings,
    scaler: FrameScaler,
    /// Last encode-sized frame, re-encoded when a keyframe is due while the
    /// source is static (late joiners need IDRs even on a still screen).
    last_scaled: Option<image::RgbaImage>,
    timings: StageTimings,
}

impl std::fmt::Debug for GpuPipelineLinux {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("GpuPipelineLinux")
            .field("portal", &self.portal)
            .finish_non_exhaustive()
    }
}

impl GpuPipelineLinux {
    /// Open the portal (this pops the compositor's source dialog and blocks
    /// on the user's choice), connect the PipeWire stream, then walk the
    /// encoder ladder from wherever [`EncoderPreference`] says it starts.
    pub(crate) fn new(
        kind: SourceKind,
        _source_id: u32,
        settings: EncodeSettings,
    ) -> Result<Self, String> {
        let mut portal = portal::PortalSession::open(kind)?;
        let fd = portal
            .take_fd()
            .ok_or_else(|| "portal fd already taken".to_owned())?;
        let stream = pipewire_stream::PwCaptureStream::start(fd, portal.node_id)?;

        let encoder = LinuxEncoder::new(settings);

        Ok(Self {
            portal,
            stream,
            encoder,
            settings,
            scaler: FrameScaler::new(settings.max_dimension),
            last_scaled: None,
            timings: StageTimings::default(),
        })
    }

    /// Encode the last scaled frame on the ladder (see [`LinuxEncoder`]).
    fn encode(&mut self, force_keyframe: bool) -> Result<Option<EncodedFrame>, String> {
        let Some(img) = self.last_scaled.as_ref() else {
            return Ok(None); // nothing captured yet
        };
        self.encoder
            .encode_rgba(img.width(), img.height(), img.as_raw(), force_keyframe)
    }
}

impl EncodePipeline for GpuPipelineLinux {
    fn set_bitrate(&mut self, bps: u32) {
        self.encoder.set_bitrate(bps);
    }

    fn content_bitrate(&self) -> Option<u32> {
        // The tier encodes exactly what the scaler produced, so the scaled
        // frame's dimensions are the ones the curve must be evaluated at.
        let img = self.last_scaled.as_ref()?;
        Some(scaled_bitrate(
            &self.settings,
            img.width() & !1,
            img.height() & !1,
        ))
    }

    fn name(&self) -> &'static str {
        match self.encoder.tier_name() {
            "vaapi" => "linux-pipewire-vaapi",
            "nvenc" => "linux-pipewire-nvenc",
            _ => "linux-pipewire-cpu",
        }
    }

    fn next_frame(
        &mut self,
        wait: std::time::Duration,
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let tick_start = Instant::now();

        let mut had_fresh = false;
        match self.stream.latest_frame(wait) {
            pipewire_stream::StreamFrame::Frame(frame) => {
                let Some(img) = image::RgbaImage::from_raw(frame.width, frame.height, frame.rgba)
                else {
                    return Ok(None); // malformed frame; skip the tick
                };
                self.timings.capture += tick_start.elapsed();
                let scale_start = Instant::now();
                self.last_scaled = Some(self.scaler.downscale(img));
                self.timings.scale += scale_start.elapsed();
                had_fresh = true;
            }
            pipewire_stream::StreamFrame::Idle => {
                self.timings.capture += tick_start.elapsed();
            }
            // Definitive: the compositor ended the cast (user pressed its
            // "stop sharing", the source window closed) or the stream broke.
            pipewire_stream::StreamFrame::Dead(reason) => return Err(reason),
        }

        if !(had_fresh || force_keyframe) {
            return Ok(None);
        }

        let encode_start = Instant::now();
        let encoded = self.encode(force_keyframe)?;
        self.timings.encode += encode_start.elapsed();
        if encoded.is_some() {
            self.timings.frames += 1;
        }
        if let Some((w, h)) = self.last_scaled.as_ref().map(|i| (i.width(), i.height())) {
            let name = self.name();
            self.timings.maybe_log(name, w, h);
        }
        Ok(encoded)
    }

    fn encode_repeat(&mut self) -> Result<Option<EncodedFrame>, String> {
        // Change-driven PipeWire capture emits nothing while the screen is
        // static, so without this the sent stream goes silent: the receiver
        // (and our own loopback preview) freezes and the ICE-lite SFU drops
        // the peer on consent-freshness, which surfaced as a broadcast that
        // never left "Setting up stream...". Re-encode the last scaled
        // picture as a delta frame to hold the RTP cadence, exactly like the
        // CPU pipeline. `encode` returns Ok(None) until the first real frame.
        self.encode(false)
    }

    fn shutdown(&mut self) {
        self.stream.shutdown();
        // The portal session closes when the pipeline is dropped.
    }
}

/// Debug instrument (see the `portal-probe` feature): the exact broadcast
/// capture path - portal handshake, PipeWire consumer, `latest_frame` loop -
/// minus scaling/encoding, printing per-second fresh-frame counts until the
/// stream dies or the process is killed. Used to measure what the compositor
/// actually delivers during the capture-freeze investigation.
#[cfg(feature = "portal-probe")]
pub fn portal_probe_main() -> Result<(), String> {
    let mut portal = portal::PortalSession::open(SourceKind::Screen)?;
    let fd = portal.take_fd().ok_or("portal fd missing")?;
    let stream = pipewire_stream::PwCaptureStream::start(fd, portal.node_id)?;
    println!("probe: consuming node {}", portal.node_id);

    // Optional pixel-correctness check: save the frame closest to 15s in
    // (mid-run, content on screen) as a PNG for visual inspection.
    let snapshot = std::env::var_os("FANCY_PROBE_SNAPSHOT").map(std::path::PathBuf::from);
    let mut snapped = false;

    let started = Instant::now();
    let mut tick_start = Instant::now();
    let mut frames = 0u32;
    let mut dims = (0u32, 0u32);
    loop {
        match stream.latest_frame(std::time::Duration::from_millis(100)) {
            pipewire_stream::StreamFrame::Frame(f) => {
                frames += 1;
                dims = (f.width, f.height);
                if let Some(path) = snapshot
                    .as_ref()
                    .filter(|_| !snapped && started.elapsed() >= std::time::Duration::from_secs(15))
                {
                    snapped = true;
                    match image::save_buffer(
                        path,
                        &f.rgba,
                        f.width,
                        f.height,
                        image::ColorType::Rgba8,
                    ) {
                        Ok(()) => println!("probe: snapshot saved to {}", path.display()),
                        Err(e) => println!("probe: snapshot failed: {e}"),
                    }
                }
            }
            pipewire_stream::StreamFrame::Idle => {}
            pipewire_stream::StreamFrame::Dead(reason) => {
                println!("probe: stream dead: {reason}");
                return Ok(());
            }
        }
        if tick_start.elapsed() >= std::time::Duration::from_secs(1) {
            tick_start = Instant::now();
            println!(
                "t=+{:04}s frames={frames} ({}x{})",
                started.elapsed().as_secs(),
                dims.0,
                dims.1,
            );
            frames = 0;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::EncoderPreference;

    #[test]
    fn each_tier_has_a_name() {
        assert_eq!(
            EncoderPreference::parse("vaapi"),
            Some(EncoderPreference::Vaapi)
        );
        assert_eq!(
            EncoderPreference::parse("nvenc"),
            Some(EncoderPreference::Nvenc)
        );
        assert_eq!(
            EncoderPreference::parse("cpu"),
            Some(EncoderPreference::Cpu)
        );
    }

    #[test]
    fn the_spellings_a_person_would_actually_type_are_accepted() {
        // Whitespace and case come free with pasting a value into a shell or
        // a CI variable; the aliases are the names these tiers go by outside
        // this module (the driver, the vendor, the codec).
        assert_eq!(
            EncoderPreference::parse("  NVENC \n"),
            Some(EncoderPreference::Nvenc)
        );
        assert_eq!(
            EncoderPreference::parse("VA-API"),
            Some(EncoderPreference::Vaapi)
        );
        assert_eq!(
            EncoderPreference::parse("nvidia"),
            Some(EncoderPreference::Nvenc)
        );
        assert_eq!(
            EncoderPreference::parse("openh264"),
            Some(EncoderPreference::Cpu)
        );
        assert_eq!(
            EncoderPreference::parse("software"),
            Some(EncoderPreference::Cpu)
        );
    }

    #[test]
    fn a_typo_names_nothing_rather_than_guessing() {
        // The caller logs and falls back to the default ladder. Guessing here
        // (a prefix or fuzzy match) would turn `nvidia-smi` or `vaapi-off`
        // into a silent tier change, which is the failure this whole knob
        // exists to prevent.
        assert_eq!(EncoderPreference::parse("nvnec"), None);
        assert_eq!(EncoderPreference::parse("vaapi-off"), None);
        assert_eq!(EncoderPreference::parse(""), None);
        assert_eq!(EncoderPreference::parse("gpu"), None);
    }
}

#[cfg(test)]
mod perf_probe {
    use super::*;
    use std::time::Instant;

    fn frames(w: u32, h: u32) -> Vec<Vec<u8>> {
        (0..3u32)
            .map(|i| {
                let mut rgba = vec![0u8; (w * h * 4) as usize];
                for (p, px) in rgba.chunks_exact_mut(4).enumerate() {
                    px[0] = ((p % 251) as u8).wrapping_add((i * 29) as u8);
                    px[1] = ((p / 7 % 253) as u8).wrapping_add((i * 11) as u8);
                    px[2] = (i * 97) as u8;
                    px[3] = 255;
                }
                rgba
            })
            .collect()
    }

    fn stats(label: &str, times: &[f64]) {
        let avg = times.iter().sum::<f64>() / times.len() as f64;
        let max = times.iter().copied().fold(0.0f64, f64::max);
        println!("{label}: avg={avg:.2}ms max={max:.2}ms n={}", times.len());
    }

    /// The SPS a tier really emits, as the receiver's decoder will read it.
    fn describe_sps(data: &[u8]) -> String {
        use cros_codecs::codec::h264::nalu::Nalu;
        use cros_codecs::codec::h264::parser::{NaluHeader, NaluType, Parser};
        let mut cursor = std::io::Cursor::new(data);
        let mut parser = Parser::default();
        while let Ok(nalu) = Nalu::<NaluHeader>::next(&mut cursor) {
            if !matches!(nalu.header.type_, NaluType::Sps) {
                continue;
            }
            let sps = parser.parse_sps(&nalu).expect("sps parses");
            let v = &sps.vui_parameters;
            return format!(
                "profile={} level={:?} poc_type={} ref_frames={} vui={} restriction={} reorder={} dec_frame_buffering={}",
                sps.profile_idc, sps.level_idc, sps.pic_order_cnt_type, sps.max_num_ref_frames,
                sps.vui_parameters_present_flag, v.bitstream_restriction_flag,
                v.max_num_reorder_frames, v.max_dec_frame_buffering
            );
        }
        "no SPS".to_owned()
    }

    fn first_frame(mut encode: impl FnMut(bool) -> Result<Option<EncodedFrame>, String>) -> EncodedFrame {
        for i in 0..5 {
            if let Some(f) = encode(i == 0).expect("encode") {
                return f;
            }
        }
        panic!("no frame in 5 attempts");
    }

    #[test]
    fn dump_openh264_sps() {
        let mut enc = H264Encoder::new(EncodeSettings::default());
        let (w, h) = (640u32, 360u32);
        let rgba = vec![0x40u8; (w * h * 4) as usize];
        let f = first_frame(|k| enc.encode_rgba(w, h, &rgba, k));
        println!("OPENH264: keyframe={} bytes={} {}", f.keyframe, f.data.len(), describe_sps(&f.data));
    }

    #[test]
    #[ignore = "needs NVENC"]
    fn dump_nvenc_sps() {
        let mut enc = nvenc::NvencEncoder::probe(EncodeSettings::default()).expect("nvenc");
        let (w, h) = (640u32, 360u32);
        let rgba = vec![0x40u8; (w * h * 4) as usize];
        let f = first_frame(|k| enc.encode_rgba(w, h, &rgba, k));
        println!("NVENC: keyframe={} bytes={} {}", f.keyframe, f.data.len(), describe_sps(&f.data));
    }

    #[test]
    #[ignore = "needs a VA-API H.264 encode device"]
    fn dump_vaapi_sps() {
        let mut enc = vaapi::VaapiEncoder::probe(EncodeSettings::default()).expect("vaapi");
        let (w, h) = (640u32, 360u32);
        let rgba = vec![0x40u8; (w * h * 4) as usize];
        let f = first_frame(|k| enc.encode_rgba(w, h, &rgba, k));
        println!("VAAPI: keyframe={} bytes={} {}", f.keyframe, f.data.len(), describe_sps(&f.data));
    }

    #[test]
    #[ignore = "manual perf probe"]
    fn stage_timings_1920x1200() {
        let (w, h) = (1920u32, 1200u32);
        let inputs = frames(w, h);

        // 1. Fresh 9.2MB alloc + the alpha-force loop (read_frame's tail).
        let mut t = Vec::new();
        for i in 0..120 {
            let start = Instant::now();
            let mut rgba = vec![7u8; (w * h * 4) as usize];
            for px in rgba.chunks_exact_mut(4) {
                px[3] = 255;
            }
            let _ = std::hint::black_box(rgba.len());
            t.push(start.elapsed().as_secs_f64() * 1e3);
            let _ = std::hint::black_box(i);
        }
        stats("alloc+alpha", &t);

        // 2. RGBA -> NV12 with a fresh Vec each frame (encode_rgba today).
        let mut t = Vec::new();
        for i in 0..120usize {
            let src = &inputs[i % 3];
            let start = Instant::now();
            let mut nv12 = Vec::new();
            vaapi::rgba_to_nv12_for_tests(w as usize, w as usize, h as usize, src, &mut nv12);
            let _ = std::hint::black_box(nv12.len());
            t.push(start.elapsed().as_secs_f64() * 1e3);
        }
        stats("rgba->nv12 (fresh alloc)", &t);

        // 3. VA-API tier: full encode_rgba round trip.
        match vaapi::VaapiEncoder::probe(EncodeSettings::default()) {
            Ok(mut enc) => {
                let mut t = Vec::new();
                for i in 0..120usize {
                    let src = &inputs[i % 3];
                    let start = Instant::now();
                    let out = enc.encode_rgba(w, h, src, i == 0).expect("vaapi encode");
                    let _ = std::hint::black_box(out);
                    t.push(start.elapsed().as_secs_f64() * 1e3);
                }
                stats("vaapi encode_rgba (incl nv12+copy)", &t);
            }
            Err(e) => println!("vaapi probe failed: {e}"),
        }

        // 4. NVENC tier: full encode_rgba round trip.
        match nvenc::NvencEncoder::probe(EncodeSettings::default()) {
            Ok(mut enc) => {
                let mut t = Vec::new();
                for i in 0..120usize {
                    let src = &inputs[i % 3];
                    let start = Instant::now();
                    let out = enc.encode_rgba(w, h, src, i == 0).expect("nvenc encode");
                    let _ = std::hint::black_box(out);
                    t.push(start.elapsed().as_secs_f64() * 1e3);
                }
                stats("nvenc encode_rgba", &t);
            }
            Err(e) => println!("nvenc probe failed: {e}"),
        }

        // 5. Scaler pass-through sanity (max_dim 1920, frame edge 1920).
        let mut scaler = FrameScaler::new(1920);
        let img = image::RgbaImage::from_raw(w, h, inputs[0].clone()).unwrap();
        let start = Instant::now();
        let out = scaler.downscale(img);
        println!(
            "scaler pass-through: {:.2}ms ({}x{})",
            start.elapsed().as_secs_f64() * 1e3,
            out.width(),
            out.height()
        );
    }
}
