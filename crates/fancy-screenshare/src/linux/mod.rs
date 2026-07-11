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

mod nvenc;
mod pipewire_stream;
mod portal;
mod vaapi;

use std::time::Instant;

use crate::encode::{EncodeSettings, EncodedFrame, H264Encoder, VideoEncoder};
use crate::pipeline::{EncodePipeline, FrameScaler, StageTimings};
use crate::sources::SourceKind;

/// Encoder tiers inside the Linux pipeline (capture is common).
enum EncoderTier {
    Vaapi(vaapi::VaapiEncoder),
    Nvenc(nvenc::NvencEncoder),
    Cpu(H264Encoder),
}

/// Portal + PipeWire capture with VA-API (preferred) or openh264 encode.
pub(crate) struct GpuPipelineLinux {
    /// Held for its lifetime: dropping it closes the cast.
    portal: portal::PortalSession,
    stream: pipewire_stream::PwCaptureStream,
    encoder: EncoderTier,
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
    /// on the user's choice), connect the PipeWire stream, probe VA-API.
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

        let encoder = match vaapi::VaapiEncoder::probe(settings) {
            Ok(vaapi) => EncoderTier::Vaapi(vaapi),
            Err(va_err) => match nvenc::NvencEncoder::probe(settings) {
                Ok(nvenc) => {
                    tracing::info!("screenshare: VA-API unavailable ({va_err}); using NVENC");
                    EncoderTier::Nvenc(nvenc)
                }
                Err(nv_err) => {
                    tracing::info!(
                        "screenshare: no GPU encoder (VA-API: {va_err}; NVENC: {nv_err}); \
                         encoding with openh264 instead"
                    );
                    EncoderTier::Cpu(H264Encoder::new(settings))
                }
            },
        };

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

    /// Encode with the current tier; a GPU-tier failure mid-stream demotes
    /// to openh264 permanently (with a fresh IDR so viewers re-sync).
    fn encode(&mut self, force_keyframe: bool) -> Result<Option<EncodedFrame>, String> {
        let Some(img) = self.last_scaled.as_ref() else {
            return Ok(None); // nothing captured yet
        };
        let (w, h) = (img.width(), img.height());
        let gpu_error = match &mut self.encoder {
            EncoderTier::Vaapi(vaapi) => {
                match vaapi.encode_rgba(w, h, img.as_raw(), force_keyframe) {
                    Ok(encoded) => return Ok(encoded),
                    Err(e) => format!("VA-API: {e}"),
                }
            }
            EncoderTier::Nvenc(nvenc) => {
                match nvenc.encode_rgba(w, h, img.as_raw(), force_keyframe) {
                    Ok(encoded) => return Ok(encoded),
                    Err(e) => format!("NVENC: {e}"),
                }
            }
            EncoderTier::Cpu(cpu) => {
                return cpu.encode_rgba(w, h, img.as_raw(), force_keyframe);
            }
        };
        tracing::warn!(
            "screenshare: GPU encode failed mid-stream ({gpu_error}); demoting to openh264"
        );
        let mut cpu = H264Encoder::new(self.settings);
        let encoded = cpu.encode_rgba(w, h, img.as_raw(), true);
        self.encoder = EncoderTier::Cpu(cpu);
        encoded
    }
}

impl EncodePipeline for GpuPipelineLinux {
    fn name(&self) -> &'static str {
        match self.encoder {
            EncoderTier::Vaapi(_) => "linux-pipewire-vaapi",
            EncoderTier::Nvenc(_) => "linux-pipewire-nvenc",
            EncoderTier::Cpu(_) => "linux-pipewire-cpu",
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

    fn shutdown(&mut self) {
        self.stream.shutdown();
        // The portal session closes when the pipeline is dropped.
    }
}
