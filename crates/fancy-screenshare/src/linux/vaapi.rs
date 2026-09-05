//! VA-API H.264 encoding through cros-codecs - the `ChromeOS` media team's
//! encoder stack, i.e. the same lineage as Chromium's
//! `VaapiVideoEncodeAccelerator` (and the crate Discord forks for its Linux
//! client).
//!
//! Frames arrive as CPU RGBA (the PipeWire shared-memory path), get
//! converted to NV12 in banded threads, and are imported into a VA surface
//! by [`CpuNv12Frame::to_native_handle`] - a `vaDeriveImage`/`vaPutImage`
//! upload, which is exactly Chromium's non-zero-copy VEA input path. The
//! GPU then does all prediction/transform/entropy work. DMA-BUF import
//! (Chromium's zero-copy path) can later slot in as a different
//! `VideoFrame` impl without touching the encoder.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::rc::Rc;

use cros_codecs::backend::vaapi::encoder::VaapiBackend;
use cros_codecs::codec::h264::parser::{Level, Profile};
use cros_codecs::encoder::h264::EncoderConfig;
use cros_codecs::encoder::stateless::h264::StatelessEncoder;
use cros_codecs::encoder::{
    FrameMetadata, PredictionStructure, RateControl, Tunings, VideoEncoder as CrosVideoEncoder,
};
use cros_codecs::libva;
use cros_codecs::video_frame::{ReadMapping, VideoFrame, WriteMapping};
use cros_codecs::{BlockingMode, Fourcc, FrameLayout, PlaneLayout, Resolution};

use crate::encode::{scaled_bitrate, EncodeSettings, EncodedFrame};

/// H.264 level with enough MB/s + frame-size headroom for the stream.
fn pick_level(width: u32, height: u32, fps: f32) -> Level {
    let mbs = u64::from(width.div_ceil(16)) * u64::from(height.div_ceil(16));
    let mb_rate = mbs.saturating_mul(fps.clamp(1.0, 240.0) as u64);
    if mbs <= 8_192 && mb_rate <= 245_760 {
        Level::L4_1 // up to 1080p30
    } else if mbs <= 22_080 && mb_rate <= 589_824 {
        Level::L5 // up to ~1440p60 / 4K30-ish
    } else if mbs <= 36_864 && mb_rate <= 983_040 {
        Level::L5_1 // up to 4K60
    } else {
        Level::L5_2
    }
}

/// One NV12 frame in plain CPU memory (tight pitches, Y then interleaved
/// UV). Implements cros-codecs' [`VideoFrame`] so the encoder can import it;
/// the import creates the VA surface and uploads the pixels.
pub(crate) struct CpuNv12Frame {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl std::fmt::Debug for CpuNv12Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CpuNv12Frame")
            .field("width", &self.width)
            .field("height", &self.height)
            .finish_non_exhaustive()
    }
}

struct CpuMapping<'a> {
    planes: Vec<&'a [u8]>,
}

impl<'a> ReadMapping<'a> for CpuMapping<'a> {
    fn get(&self) -> Vec<&[u8]> {
        self.planes.clone()
    }
}

impl CpuNv12Frame {
    fn y_size(&self) -> usize {
        (self.width as usize) * (self.height as usize)
    }
}

impl VideoFrame for CpuNv12Frame {
    type MemDescriptor = ();
    type NativeHandle = libva::Surface<()>;

    fn fourcc(&self) -> Fourcc {
        Fourcc::from(b"NV12")
    }

    fn resolution(&self) -> Resolution {
        Resolution {
            width: self.width,
            height: self.height,
        }
    }

    fn get_plane_size(&self) -> Vec<usize> {
        vec![self.y_size(), self.y_size() / 2]
    }

    fn get_plane_pitch(&self) -> Vec<usize> {
        vec![self.width as usize, self.width as usize]
    }

    fn map<'a>(&'a self) -> Result<Box<dyn ReadMapping<'a> + 'a>, String> {
        let (y, uv) = self.data.split_at(self.y_size());
        Ok(Box::new(CpuMapping {
            planes: vec![y, uv],
        }))
    }

    fn map_mut<'a>(&'a mut self) -> Result<Box<dyn WriteMapping<'a> + 'a>, String> {
        Err("CpuNv12Frame is filled before import; write mapping unsupported".to_owned())
    }

    /// Create a VA surface and upload the pixels - `vaDeriveImage` when the
    /// driver allows a direct view, `vaCreateImage`+`vaPutImage` otherwise.
    fn to_native_handle(&self, display: &Rc<libva::Display>) -> Result<Self::NativeHandle, String> {
        let mut surfaces = display
            .create_surfaces(
                libva::VA_RT_FORMAT_YUV420,
                Some(libva::VA_FOURCC_NV12),
                self.width,
                self.height,
                Some(libva::UsageHint::USAGE_HINT_ENCODER),
                vec![()],
            )
            .map_err(|e| format!("vaCreateSurfaces: {e}"))?;
        let surface = surfaces
            .pop()
            .ok_or_else(|| "vaCreateSurfaces returned nothing".to_owned())?;

        {
            let mut image = match libva::Image::derive_from(&surface, (self.width, self.height)) {
                Ok(image) => image,
                Err(_) => {
                    // Not derivable (tiled-only surface): go through an
                    // explicit NV12 image and let vaPutImage convert.
                    let format = display
                        .query_image_formats()
                        .map_err(|e| format!("vaQueryImageFormats: {e}"))?
                        .into_iter()
                        .find(|f| f.fourcc == libva::VA_FOURCC_NV12)
                        .ok_or_else(|| "driver exposes no NV12 image format".to_owned())?;
                    libva::Image::create_from(
                        &surface,
                        format,
                        (self.width, self.height),
                        (self.width, self.height),
                    )
                    .map_err(|e| format!("vaCreateImage: {e}"))?
                }
            };

            let va_image = *image.image();
            let (y_offset, y_pitch) = (va_image.offsets[0] as usize, va_image.pitches[0] as usize);
            let (uv_offset, uv_pitch) =
                (va_image.offsets[1] as usize, va_image.pitches[1] as usize);
            let (w, h) = (self.width as usize, self.height as usize);
            let buf = image.as_mut();

            let (src_y, src_uv) = self.data.split_at(w * h);
            for row in 0..h {
                let dst = y_offset + row * y_pitch;
                buf.get_mut(dst..dst + w)
                    .ok_or_else(|| "VA image smaller than Y plane".to_owned())?
                    .copy_from_slice(&src_y[row * w..row * w + w]);
            }
            for row in 0..h / 2 {
                let dst = uv_offset + row * uv_pitch;
                buf.get_mut(dst..dst + w)
                    .ok_or_else(|| "VA image smaller than UV plane".to_owned())?
                    .copy_from_slice(&src_uv[row * w..row * w + w]);
            }
            // Drop writes the image back to the surface for non-derived
            // images (vaPutImage) and unmaps either way.
        }

        Ok(surface)
    }
}

type Encoder = StatelessEncoder<CpuNv12Frame, VaapiBackend<(), libva::Surface<()>>>;

/// Per-resolution encoder instance (rebuilt on source resize).
struct Inner {
    encoder: Encoder,
    dims: (u32, u32),
    /// First submitted frame after (re)creation - always an IDR with
    /// SPS/PPS, so viewers can (re)sync.
    fresh: bool,
}

/// Stateful VA-API H.264 encoder consuming RGBA frames, mirroring the
/// openh264 tier's interface so the pipeline can swap tiers freely.
pub(crate) struct VaapiEncoder {
    display: Rc<libva::Display>,
    low_power: bool,
    settings: EncodeSettings,
    inner: Option<Inner>,
    timestamp: u64,
    /// Live rate-control target from the congestion controller, or 0 before
    /// one has arrived (then [`scaled_bitrate`] alone decides).
    target_bps: u32,
}

impl std::fmt::Debug for VaapiEncoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VaapiEncoder")
            .field("low_power", &self.low_power)
            .finish_non_exhaustive()
    }
}

impl VaapiEncoder {
    /// Open the default VA display and confirm an H.264 encode entrypoint
    /// exists. Cheap enough to run once per broadcast; fails cleanly on
    /// machines without a (working) driver so callers can fall back.
    pub(crate) fn probe(settings: EncodeSettings) -> Result<Self, String> {
        let mut errors: Vec<String> = Vec::new();
        for node in render_nodes_by_preference() {
            match Self::probe_node(&node, settings) {
                Ok(encoder) => return Ok(encoder),
                Err(e) => errors.push(format!("{}: {e}", node.display())),
            }
        }
        if errors.is_empty() {
            return Err("no /dev/dri render node".to_owned());
        }
        Err(errors.join("; "))
    }

    /// Probe ONE render node for an H.264 encode entrypoint.
    fn probe_node(node: &Path, settings: EncodeSettings) -> Result<Self, String> {
        let display = libva::Display::open_drm_display(node)
            .map_err(|e| format!("open_drm_display: {e:?}"))?;
        let entrypoints = display
            .query_config_entrypoints(libva::VAProfile::VAProfileH264Main)
            .map_err(|e| format!("vaQueryConfigEntrypoints: {e}"))?;
        // Prefer the low-power (VDEnc-style) engine where present - the
        // battle-tested path on modern Intel, and what Chromium prefers.
        let low_power = entrypoints.contains(&libva::VAEntrypoint::VAEntrypointEncSliceLP);
        let full_power = entrypoints.contains(&libva::VAEntrypoint::VAEntrypointEncSlice);
        if !low_power && !full_power {
            return Err("no H.264 encode entrypoint".to_owned());
        }
        let node_name = node.display().to_string();
        match display.query_vendor_string() {
            Ok(vendor) => {
                tracing::info!(
                    vendor,
                    low_power,
                    node = node_name,
                    "screenshare: VA-API encoder ready"
                );
            }
            Err(_) => {
                tracing::info!(
                    low_power,
                    node = node_name,
                    "screenshare: VA-API encoder ready"
                );
            }
        }
        Ok(Self {
            display,
            low_power,
            settings,
            inner: None,
            timestamp: 0,
            target_bps: 0,
        })
    }

    fn ensure_encoder(&mut self, w: u32, h: u32) -> Result<(), String> {
        if self.inner.as_ref().is_some_and(|i| i.dims == (w, h)) {
            return Ok(());
        }
        // Dropping the old instance frees its VA contexts before the new
        // ones are created (resize on a memory-tight iGPU).
        self.inner = None;

        let fps = self.settings.max_fps.clamp(1.0, 240.0).round() as u32;
        // ~2 s GOP. cros-codecs' LowDelay predictor emits a real IDR (new
        // SPS/PPS, frame_num 0) ONLY when its intra counter wraps - its
        // `force_keyframe` yields a mid-sequence I-slice without parameter
        // sets, which no joiner can sync on. Recreating the encoder per
        // demanded keyframe produced real IDRs but at COLD rate control:
        // multi-hundred-KB bursts that take longer to traverse a modest
        // uplink than any viewer-side reordering window tolerates - every
        // IDR died in transit, each loss PLI'd for the next (a storm that
        // saturated the uplink and stalled shares for ~30 s). A short
        // planned GOP is how streaming encoders solve this: the warm rate
        // controller budgets for the periodic IDR (a few times a P frame,
        // not tens of), and a PLI simply means the viewer resyncs at the
        // next wrap, at most one GOP away.
        let intra_period = u16::try_from((fps * 2).clamp(30, 256)).unwrap_or(256);
        let config = EncoderConfig {
            resolution: Resolution {
                width: w,
                height: h,
            },
            profile: Profile::Main,
            level: pick_level(w, h, self.settings.max_fps),
            pred_structure: PredictionStructure::LowDelay {
                limit: intra_period,
            },
            initial_tunings: Tunings {
                rate_control: RateControl::ConstantBitrate(u64::from(self.effective_bitrate(w, h))),
                framerate: fps,
                min_quality: 1,
                max_quality: 51,
            },
        };
        let encoder = Encoder::new_vaapi(
            Rc::clone(&self.display),
            config,
            Fourcc::from(b"NV12"),
            Resolution {
                width: w,
                height: h,
            },
            self.low_power,
            // Synchronous: one frame in, one access unit out, matching the
            // pipeline's frame-at-a-time pump.
            BlockingMode::Blocking,
        )
        .map_err(|e| format!("VA encoder init ({w}x{h}): {e}"))?;
        tracing::info!(
            w,
            h,
            low_power = self.low_power,
            "screenshare: VA-API H.264 encoder up"
        );
        self.inner = Some(Inner {
            encoder,
            dims: (w, h),
            fresh: true,
        });
        Ok(())
    }

    /// The target for a `w` x `h` frame: the controller's number once it has
    /// one, never above what the content can use.
    fn effective_bitrate(&self, w: u32, h: u32) -> u32 {
        let ceiling = scaled_bitrate(&self.settings, w, h);
        if self.target_bps == 0 {
            ceiling
        } else {
            self.target_bps.min(ceiling)
        }
    }

    /// Retarget rate control on the live encoder.
    ///
    /// cros-codecs applies this at the next frame boundary and, critically,
    /// does NOT force a keyframe: `apply_tunings` calls `new_sequence`, so the
    /// next frame is an ordinary P slice that merely carries fresh SPS/PPS.
    /// That is why [`patch_zero_nal_headers`] reads the real slice type out of
    /// the RBSP instead of inferring IDR-ness from the presence of an SPS -
    /// otherwise every retune would masquerade as a keyframe and, on radeonsi,
    /// stamp a P slice with an IDR NAL header.
    ///
    /// The rate-control VARIANT may never change (cros-codecs rejects that);
    /// we only ever move the CBR target, so the variant is constant by
    /// construction.
    pub(crate) fn set_bitrate(&mut self, bps: u32) {
        if self.target_bps == bps {
            return;
        }
        self.target_bps = bps;
        let fps = self.settings.max_fps.clamp(1.0, 240.0).round() as u32;
        let Some((w, h)) = self.inner.as_ref().map(|i| i.dims) else {
            return; // no encoder yet; ensure_encoder will pick the target up
        };
        let effective = self.effective_bitrate(w, h);
        let tunings = Tunings {
            rate_control: RateControl::ConstantBitrate(u64::from(effective)),
            framerate: fps,
            min_quality: 1,
            max_quality: 51,
        };
        let Some(inner) = self.inner.as_mut() else {
            return;
        };
        match inner.encoder.tune(tunings) {
            Ok(()) => tracing::debug!(bps = effective, "screenshare: VA-API retuned"),
            Err(e) => tracing::warn!(bps = effective, "screenshare: VA-API retune failed: {e}"),
        }
    }

    /// Encode one RGBA frame; `Ok(None)` only if the encoder queued it
    /// without emitting (not expected in blocking mode).
    pub(crate) fn encode_rgba(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        let w = width & !1;
        let h = height & !1;
        if w == 0 || h == 0 || rgba.len() < (width as usize) * (height as usize) * 4 {
            return Err("frame too small".to_owned());
        }
        // `force_keyframe` is deliberately NOT forwarded to cros-codecs
        // and no longer recreates the encoder: IDRs come from the planned
        // GOP (see `ensure_encoder`), so a demanded keyframe is satisfied
        // by the next wrap, at most one GOP (~2 s) away. Forwarding the
        // flag would produce an unsyncable mid-sequence I-slice instead.
        let _ = force_keyframe;
        self.ensure_encoder(w, h)?;

        let mut nv12 = Vec::new();
        rgba_to_nv12(width as usize, w as usize, h as usize, rgba, &mut nv12);
        let frame = CpuNv12Frame {
            width: w,
            height: h,
            data: nv12,
        };

        let inner = self.inner.as_mut().ok_or("encoder missing after init")?;
        // First frame after creation/resize: must come out as an IDR.
        let fresh = inner.fresh;
        inner.fresh = false;

        let meta = FrameMetadata {
            timestamp: self.timestamp,
            layout: FrameLayout {
                format: (Fourcc::from(b"NV12"), 0),
                size: Resolution {
                    width: w,
                    height: h,
                },
                planes: vec![
                    PlaneLayout {
                        buffer_index: 0,
                        offset: 0,
                        stride: w as usize,
                    },
                    PlaneLayout {
                        buffer_index: 0,
                        offset: (w as usize) * (h as usize),
                        stride: w as usize,
                    },
                ],
            },
            force_keyframe: false,
        };
        self.timestamp = self.timestamp.wrapping_add(1);

        inner
            .encoder
            .encode(meta, frame)
            .map_err(|e| format!("VA encode: {e}"))?;

        let mut data = Vec::new();
        while let Some(coded) = inner
            .encoder
            .poll()
            .map_err(|e| format!("VA encoder poll: {e}"))?
        {
            data.extend_from_slice(&coded.bitstream);
        }
        if data.is_empty() {
            return Ok(None);
        }
        patch_zero_nal_headers(&mut data, fresh);
        ensure_reorder_hint(&mut data);
        let keyframe = contains_idr(&data);
        if fresh && !keyframe {
            // Undecodable stream; the error demotes the broadcast to the
            // openh264 tier instead of sending it (see GpuPipelineLinux).
            return Err("first frame yielded no IDR".to_owned());
        }
        Ok(Some(EncodedFrame { data, keyframe }))
    }
}

/// Repair slice NAL headers the driver left as `0x00`.
///
/// cros-codecs supplies no packed slice header (its `h264/vaapi.rs` carries
/// a TODO in place of one), and without it radeonsi writes the slice NAL's
/// header byte as zero: `00 00 00 01 00 <slice RBSP>` - an invalid NAL every
/// decoder rejects, while the RBSP itself is sound (ffmpeg's `h264_vaapi` on
/// the same driver emits the identical RBSP behind a proper header). Rewrite
/// each zeroed header to what the frame is known to be: type 5 (IDR) when
/// the access unit starts a sequence - the caller forced it, or the encoder
/// wrote an SPS, which cros-codecs does exactly on IDRs - else type 1
/// (non-IDR slice), both as reference pictures. Headers the driver filled in
/// are left alone, so this is a no-op on drivers without the bug.
/// Whether an SPS NAL sits somewhere in the Annex B stream.
fn has_sps(data: &[u8]) -> bool {
    data.windows(4).any(|w| w[..3] == [0, 0, 1] && w[3] & 0x1f == 7)
}

/// Give every SPS in `data` a VUI bitstream restriction saying
/// `max_num_reorder_frames = 0`.
///
/// cros-codecs writes no VUI, and a Main-profile stream without one leaves
/// the receiver's decoder to take the level's whole DPB as possible reorder
/// depth (up to 16 frames at level 5.1). GStreamer's H.264 base class - the
/// one behind `vah264dec` and `nvh264dec`, which is what `WebKitGTK`'s
/// `WebCodecs` decodes with - then holds that many frames before showing the
/// first.
/// Measured on the NVENC tier before it got the same hint: ~5 frames held
/// instead of ~2, 290 ms of decoder latency at 20 fps, and on a slow-changing
/// desktop share that scales into seconds. The stream never reorders (no
/// B-frames), so the hint is simply the truth.
fn ensure_reorder_hint(data: &mut Vec<u8>) {
    use cros_codecs::codec::h264::nalu::Nalu;
    use cros_codecs::codec::h264::parser::NaluHeader;

    if !has_sps(data) {
        return;
    }
    let mut out = Vec::with_capacity(data.len() + 16);
    let mut cursor = std::io::Cursor::new(data.as_slice());
    let mut rewrote = false;
    while let Ok(nalu) = Nalu::<NaluHeader>::next(&mut cursor) {
        match hinted_sps(&nalu) {
            Some(sps) => {
                out.extend_from_slice(&sps);
                rewrote = true;
            }
            None => out.extend_from_slice(&nalu.data),
        }
    }
    if rewrote {
        *data = out;
    }
}

/// `nalu` re-serialised with the reorder hint, or `None` when it is not an
/// SPS, already carries the hint, or cannot be parsed and written back.
fn hinted_sps(
    nalu: &cros_codecs::codec::h264::nalu::Nalu<'_, cros_codecs::codec::h264::parser::NaluHeader>,
) -> Option<Vec<u8>> {
    use cros_codecs::codec::h264::parser::{NaluType, Parser, Sps};
    use cros_codecs::codec::h264::synthesizer::Synthesizer;
    use std::rc::Rc;

    if !matches!(nalu.header.type_, NaluType::Sps) {
        return None;
    }
    // The parser keeps the SPS behind an `Rc` and `Sps` is not `Clone`;
    // dropping the parser leaves this the only reference, so it unwraps.
    let mut parser = Parser::default();
    let sps = Rc::clone(parser.parse_sps(nalu).ok()?);
    drop(parser);
    let mut sps = Rc::try_unwrap(sps).ok()?;
    if sps.vui_parameters_present_flag && sps.vui_parameters.bitstream_restriction_flag {
        return None;
    }
    sps.vui_parameters_present_flag = true;
    sps.vui_parameters.bitstream_restriction_flag = true;
    sps.vui_parameters.max_num_reorder_frames = 0;
    sps.vui_parameters.max_dec_frame_buffering = u32::from(sps.max_num_ref_frames.max(1));
    let mut out = Vec::with_capacity(nalu.data.len() + 8);
    Synthesizer::<'_, Sps, &mut Vec<u8>>::synthesize(nalu.header.ref_idc, &sps, &mut out, true)
        .ok()?;
    Some(out)
}

fn patch_zero_nal_headers(data: &mut [u8], forced_idr: bool) {
    let mut idr = forced_idr;
    let mut i = 0;
    while i < data.len() {
        let rest = &data[i..];
        let header_at = if rest.starts_with(&[0, 0, 1]) {
            i + 3
        } else if rest.starts_with(&[0, 0, 0, 1]) {
            i + 4
        } else {
            i += 1;
            continue;
        };
        match data.get(header_at).copied() {
            Some(b) if b & 0x1f == 7 => idr = true, // SPS: a sequence starts
            Some(0) => {
                // Read the slice type out of the RBSP rather than trusting
                // the SPS: a live retune emits fresh parameter sets on an
                // ordinary P frame (see `VaapiEncoder::set_bitrate`), so
                // "this unit carries an SPS" no longer implies "this is an
                // IDR". The `idr` flag stays the fallback for a slice header
                // that will not parse.
                let intra = data
                    .get(header_at + 1..)
                    .and_then(slice_type_is_intra)
                    .unwrap_or(idr);
                let repaired = if intra { 0x65 } else { 0x41 };
                if let Some(slot) = data.get_mut(header_at) {
                    *slot = repaired;
                }
            }
            _ => {}
        }
        i = header_at;
    }
}

/// Render nodes worth trying for VA-API encode, best first.
///
/// `libva::Display::open` takes the FIRST `/dev/dri` render node. On a hybrid
/// machine that is the integrated GPU even when every display - and so every
/// buffer the compositor hands us - lives on the discrete one. The result is
/// silent and expensive: capture on one GPU, encode on another, with a CPU
/// bounce in between, and none of it visible in any log.
///
/// So the node that drives a connected display is tried first. If none can
/// encode (NVIDIA's VA driver is a decode-only shim, for instance) the ladder
/// simply moves on to NVENC, which is the right answer on exactly that
/// hardware.
fn render_nodes_by_preference() -> Vec<PathBuf> {
    let dri = Path::new("/dev/dri");
    let drm = Path::new("/sys/class/drm");
    let mut nodes: Vec<String> = std::fs::read_dir(dri)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| e.file_name().into_string().ok())
        .filter(|name| name.starts_with("renderD"))
        .collect();
    nodes.sort();
    let ranked = rank_render_nodes(&nodes, &display_owning_devices(drm), |name| {
        pci_device_of(drm, name)
    });
    ranked.into_iter().map(|n| dri.join(n)).collect()
}

/// PCI device paths of the GPUs that drive at least one connected display.
fn display_owning_devices(drm: &Path) -> HashSet<PathBuf> {
    let mut owners = HashSet::new();
    let Ok(entries) = std::fs::read_dir(drm) else {
        return owners;
    };
    for entry in entries.flatten() {
        let Ok(name) = entry.file_name().into_string() else {
            continue;
        };
        // Connector directories are "card0-DP-1"; the card itself has no dash.
        if !name.starts_with("card") || !name.contains('-') {
            continue;
        }
        let status = std::fs::read_to_string(drm.join(&name).join("status"));
        if status.map(|s| s.trim() != "connected").unwrap_or(true) {
            continue;
        }
        let Some((card, _)) = name.split_once('-') else {
            continue;
        };
        if let Some(device) = pci_device_of(drm, card) {
            let _ = owners.insert(device);
        }
    }
    owners
}

/// The canonical PCI device a DRM node belongs to.
fn pci_device_of(drm: &Path, node: &str) -> Option<PathBuf> {
    std::fs::canonicalize(drm.join(node).join("device")).ok()
}

/// Order `nodes` so those on a display-owning GPU come first, preserving the
/// original order within each group.
///
/// Split out from the filesystem walk so the ranking itself is testable: the
/// hardware it exists for (a hybrid laptop, or a desktop with an unused iGPU)
/// is exactly the hardware CI does not have.
fn rank_render_nodes(
    nodes: &[String],
    display_owners: &HashSet<PathBuf>,
    device_of: impl Fn(&str) -> Option<PathBuf>,
) -> Vec<String> {
    let (preferred, rest): (Vec<String>, Vec<String>) = nodes.iter().cloned().partition(|node| {
        device_of(node)
            .map(|dev| display_owners.contains(&dev))
            .unwrap_or(false)
    });
    preferred.into_iter().chain(rest).collect()
}

/// Whether a slice NAL's RBSP describes an intra slice.
///
/// `slice_header()` opens with two unsigned Exp-Golomb values,
/// `first_mb_in_slice` then `slice_type` (H.264 7.3.3). Types 2, 4, 7 and 9
/// are I slices - the 5..9 forms only additionally assert that every slice in
/// the picture shares the type (Table 7-6).
///
/// `None` when the bits run out. Emulation-prevention bytes are not unescaped
/// because they can only follow two consecutive zero bytes, which these first
/// few bits never produce.
fn slice_type_is_intra(rbsp: &[u8]) -> Option<bool> {
    let mut bits = BitReader::new(rbsp);
    let _first_mb_in_slice = bits.read_ue()?;
    let slice_type = bits.read_ue()?;
    Some(matches!(slice_type, 2 | 4 | 7 | 9))
}

/// Minimal MSB-first bit reader for the head of a slice header.
struct BitReader<'a> {
    data: &'a [u8],
    /// Next bit position, counted from the first bit of `data`.
    pos: usize,
}

impl<'a> BitReader<'a> {
    fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn bit(&mut self) -> Option<u32> {
        let byte = *self.data.get(self.pos / 8)?;
        let shift = 7 - (self.pos % 8);
        self.pos += 1;
        Some(u32::from((byte >> shift) & 1))
    }

    /// Read one unsigned Exp-Golomb code.
    fn read_ue(&mut self) -> Option<u32> {
        let mut zeros = 0u32;
        while self.bit()? == 0 {
            zeros += 1;
            if zeros > 31 {
                return None; // not a plausible slice header
            }
        }
        let mut suffix = 0u32;
        for _ in 0..zeros {
            suffix = (suffix << 1) | self.bit()?;
        }
        Some((1u32 << zeros) - 1 + suffix)
    }
}

/// Annex-B scan for an IDR NAL (type 5). Shared with the NVENC tier.
pub(super) fn contains_idr(data: &[u8]) -> bool {
    let mut i = 0;
    while i < data.len() {
        let rest = &data[i..];
        let header_at = if rest.starts_with(&[0, 0, 1]) {
            i + 3
        } else if rest.starts_with(&[0, 0, 0, 1]) {
            i + 4
        } else {
            i += 1;
            continue;
        };
        if data.get(header_at).is_some_and(|b| b & 0x1f == 5) {
            return true;
        }
        i = header_at;
    }
    false
}

/// RGBA -> NV12 (BT.601 limited range, same fixed-point math as the openh264
/// tier's I420 conversion so tier switches don't shift colours), threaded in
/// bands of source-row pairs. `src_width` is the RGBA row stride in pixels;
/// `w`/`h` are the (even) output dimensions.
/// Test-only re-export so the NVENC tier's pitched converter can be
/// verified against this tight-layout one.
#[cfg(test)]
pub(super) fn rgba_to_nv12_for_tests(
    src_width: usize,
    w: usize,
    h: usize,
    rgba: &[u8],
    out: &mut Vec<u8>,
) {
    rgba_to_nv12(src_width, w, h, rgba, out);
}

fn rgba_to_nv12(src_width: usize, w: usize, h: usize, rgba: &[u8], out: &mut Vec<u8>) {
    out.clear();
    out.resize(w * h * 3 / 2, 0);
    let (y_plane, uv_plane) = out.split_at_mut(w * h);

    let pairs = h / 2;
    let threads = std::thread::available_parallelism()
        .map(std::num::NonZero::get)
        .unwrap_or(4)
        .min(8);
    let band = pairs.div_ceil(threads.max(1)).max(1);

    std::thread::scope(|scope| {
        let mut y_rest = y_plane;
        let mut uv_rest = uv_plane;
        let mut pair0 = 0usize;
        while pair0 < pairs {
            let take = band.min(pairs - pair0);
            let (y_band, y_next) = y_rest.split_at_mut(take * 2 * w);
            let (uv_band, uv_next) = uv_rest.split_at_mut(take * w);
            y_rest = y_next;
            uv_rest = uv_next;
            let first_pair = pair0;
            let _ = scope.spawn(move || {
                convert_band(src_width, w, first_pair, take, rgba, y_band, uv_band);
            });
            pair0 += take;
        }
    });
}

/// Convert `pairs` source-row pairs starting at pair `first_pair`.
fn convert_band(
    src_width: usize,
    w: usize,
    first_pair: usize,
    pairs: usize,
    rgba: &[u8],
    y_band: &mut [u8],
    uv_band: &mut [u8],
) {
    for p in 0..pairs {
        let src_row = (first_pair + p) * 2;
        for dy in 0..2 {
            let src = &rgba[(src_row + dy) * src_width * 4..];
            let dst = &mut y_band[(p * 2 + dy) * w..(p * 2 + dy) * w + w];
            for (x, out_y) in dst.iter_mut().enumerate() {
                let px = &src[x * 4..x * 4 + 4];
                let (r, g, b) = (i32::from(px[0]), i32::from(px[1]), i32::from(px[2]));
                *out_y = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
            }
        }
        let row0 = &rgba[src_row * src_width * 4..];
        let row1 = &rgba[(src_row + 1) * src_width * 4..];
        let uv_row = &mut uv_band[p * w..p * w + w];
        for x2 in 0..w / 2 {
            let x = x2 * 2;
            let mut r = 0i32;
            let mut g = 0i32;
            let mut b = 0i32;
            for row in [row0, row1] {
                for dx in 0..2 {
                    let px = &row[(x + dx) * 4..(x + dx) * 4 + 4];
                    r += i32::from(px[0]);
                    g += i32::from(px[1]);
                    b += i32::from(px[2]);
                }
            }
            r /= 4;
            g /= 4;
            b /= 4;
            uv_row[x] = ((((-38) * r - 74 * g + 112 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
            uv_row[x + 1] = (((112 * r - 94 * g - 18 * b + 128) >> 8) + 128).clamp(0, 255) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn an_sps_without_vui_gets_the_no_reorder_hint() {
        use super::ensure_reorder_hint;
        use cros_codecs::codec::h264::nalu::Nalu;
        use cros_codecs::codec::h264::parser::{NaluHeader, Parser, Sps};
        use cros_codecs::codec::h264::synthesizer::Synthesizer;

        let sps = Sps {
            profile_idc: 77,
            level_idc: cros_codecs::codec::h264::parser::Level::L4_1,
            max_num_ref_frames: 2,
            pic_width_in_mbs_minus1: 119,
            pic_height_in_map_units_minus1: 67,
            log2_max_frame_num_minus4: 4,
            log2_max_pic_order_cnt_lsb_minus4: 4,
            ..Sps::default()
        };
        let mut stream = Vec::new();
        Synthesizer::<'_, Sps, &mut Vec<u8>>::synthesize(3, &sps, &mut stream, true).unwrap();
        // A slice behind it, so the rewrite has to keep unrelated NALs intact
        // (ending in the stop bit, as a real one does - the NAL reader strips
        // trailing zero bytes).
        stream.extend_from_slice(&[0, 0, 0, 1, 0x65, 0x88, 0x84, 0x80]);

        let before = stream.clone();
        ensure_reorder_hint(&mut stream);
        assert_ne!(stream, before, "the SPS should have been rewritten");
        assert!(stream.ends_with(&[0x65, 0x88, 0x84, 0x80]), "the slice must survive untouched");

        let mut cursor = std::io::Cursor::new(stream.as_slice());
        let nalu = Nalu::<NaluHeader>::next(&mut cursor).unwrap();
        let mut parser = Parser::default();
        let parsed = parser.parse_sps(&nalu).unwrap();
        assert!(parsed.vui_parameters_present_flag);
        assert!(parsed.vui_parameters.bitstream_restriction_flag);
        assert_eq!(parsed.vui_parameters.max_num_reorder_frames, 0);
        assert_eq!(parsed.vui_parameters.max_dec_frame_buffering, 2);
        assert_eq!(parsed.max_num_ref_frames, 2);

        // Idempotent: a hinted SPS is left alone.
        let hinted = stream.clone();
        ensure_reorder_hint(&mut stream);
        assert_eq!(stream, hinted);
    }

    #[test]
    fn idr_scan_finds_type5_after_long_and_short_start_codes() {
        // SPS (7), PPS (8), then IDR (5) behind a 3-byte start code.
        let data = [
            0u8, 0, 0, 1, 0x67, 0xAA, // SPS
            0, 0, 0, 1, 0x68, 0xBB, // PPS
            0, 0, 1, 0x65, 0x11, // IDR slice
        ];
        assert!(super::contains_idr(&data));
        let no_idr = [0u8, 0, 0, 1, 0x67, 0xAA, 0, 0, 1, 0x41, 0x22];
        assert!(!super::contains_idr(&no_idr));
    }

    /// The hybrid machine this exists for: renderD128 is the unused iGPU,
    /// renderD129 drives the displays. Taking the first node - what
    /// `Display::open` does - picks the wrong GPU.
    #[test]
    fn the_display_owning_gpu_is_tried_first() {
        let nodes = vec!["renderD128".to_owned(), "renderD129".to_owned()];
        let amd = std::path::PathBuf::from("/sys/devices/pci0000:00/0000:0e:00.0");
        let nvidia = std::path::PathBuf::from("/sys/devices/pci0000:00/0000:03:00.0");
        let owners: std::collections::HashSet<_> = [nvidia.clone()].into_iter().collect();
        let ranked = super::rank_render_nodes(&nodes, &owners, |node| match node {
            "renderD128" => Some(amd.clone()),
            "renderD129" => Some(nvidia.clone()),
            _ => None,
        });
        assert_eq!(ranked, vec!["renderD129", "renderD128"]);
    }

    #[test]
    fn a_single_gpu_machine_keeps_its_order() {
        let nodes = vec!["renderD128".to_owned()];
        let dev = std::path::PathBuf::from("/sys/devices/pci0000:00/0000:00:02.0");
        let owners: std::collections::HashSet<_> = [dev.clone()].into_iter().collect();
        let ranked = super::rank_render_nodes(&nodes, &owners, |_| Some(dev.clone()));
        assert_eq!(ranked, vec!["renderD128"]);
    }

    /// No connected display anywhere (headless, or sysfs unreadable): every
    /// node stays a candidate, in its original order, so the probe degrades to
    /// exactly what it did before rather than finding nothing.
    #[test]
    fn without_display_owners_nothing_is_dropped() {
        let nodes = vec!["renderD128".to_owned(), "renderD129".to_owned()];
        let owners = std::collections::HashSet::new();
        let ranked = super::rank_render_nodes(&nodes, &owners, |_| None);
        assert_eq!(ranked, vec!["renderD128", "renderD129"]);
    }

    #[test]
    fn slice_type_is_read_from_the_rbsp() {
        // ue(0) = "1", then ue(7) = "0001000" -> slice_type 7 (I, all slices).
        assert_eq!(super::slice_type_is_intra(&[0b1000_1000]), Some(true));
        // ue(0) = "1", then ue(5) = "00110" -> slice_type 5 (P, all slices).
        assert_eq!(super::slice_type_is_intra(&[0b1001_1010]), Some(false));
        // ue(0), ue(2) = "011" -> slice_type 2 (I).
        assert_eq!(super::slice_type_is_intra(&[0b1011_0000]), Some(true));
        // ue(0), ue(0) = "1" -> slice_type 0 (P).
        assert_eq!(super::slice_type_is_intra(&[0b1100_0000]), Some(false));
        // Nothing to read.
        assert_eq!(super::slice_type_is_intra(&[]), None);
    }

    /// The regression that live retuning would otherwise introduce: cros-codecs
    /// answers a `tune()` by starting a new sequence, so the very next frame is
    /// an ordinary P slice that happens to carry SPS/PPS. Inferring IDR-ness
    /// from the SPS would both mislabel the frame to the SFU and, on radeonsi,
    /// write an IDR NAL header onto a P slice.
    #[test]
    fn a_p_slice_carrying_new_parameter_sets_is_not_an_idr() {
        let mut retuned = vec![
            0, 0, 0, 1, 0x67, 0xAA, // SPS, re-emitted after the retune
            0, 0, 0, 1, 0x68, 0xBB, // PPS
            0, 0, 0, 0, 1, 0x00, 0x9A, // zeroed header over a P slice header
        ];
        super::patch_zero_nal_headers(&mut retuned, false);
        assert_eq!(retuned[17], 0x41, "a P slice must stay a P slice");
        assert!(
            !super::contains_idr(&retuned),
            "and must not be reported as a keyframe"
        );
    }

    #[test]
    fn zeroed_nal_headers_are_rewritten() {
        // An IDR access unit as radeonsi emits it: synthesized SPS/PPS with
        // real headers, then the driver's slice with a zeroed header byte
        // (behind the stray zero cros-codecs prepends to each segment).
        let mut idr = vec![
            0, 0, 0, 1, 0x67, 0xAA, // SPS
            0, 0, 0, 1, 0x68, 0xBB, // PPS
            0, 0, 0, 0, 1, 0x00, 0x88, 0x80, // zeroed slice header
        ];
        super::patch_zero_nal_headers(&mut idr, false); // the SPS alone implies IDR
        assert_eq!(idr[17], 0x65);
        assert!(super::contains_idr(&idr));

        // A delta frame: lone zeroed slice, no parameter sets.
        let mut delta = vec![0, 0, 0, 0, 1, 0x00, 0x9A];
        super::patch_zero_nal_headers(&mut delta, false);
        assert_eq!(delta[5], 0x41);

        // Forced keyframe with no SPS in the unit still gets the IDR type.
        let mut forced = vec![0, 0, 0, 1, 0x00, 0x88];
        super::patch_zero_nal_headers(&mut forced, true);
        assert_eq!(forced[4], 0x65);

        // A driver without the bug: nothing is touched.
        let good = [0u8, 0, 0, 1, 0x65, 0x88, 0, 0, 1, 0x41, 0x9A];
        let mut copy = good.to_vec();
        super::patch_zero_nal_headers(&mut copy, true);
        assert_eq!(copy, good);
    }

    /// The VA-API bitstream contract end to end, on real hardware: the
    /// stream opens with a full IDR access unit (SPS, PPS and a type-5
    /// slice), a demanded keyframe mid-sequence yields NO mid-sequence
    /// I-slice (IDRs come only from the planned GOP), and no NAL may keep
    /// the zeroed header radeonsi writes when no packed slice header is
    /// supplied.
    #[test]
    #[ignore = "needs a VA-API H.264 encode device"]
    fn forced_keyframes_are_idrs_on_a_real_device() {
        fn nal_types(data: &[u8]) -> Vec<u8> {
            let mut out = Vec::new();
            let mut i = 0;
            while i < data.len() {
                let rest = &data[i..];
                let at = if rest.starts_with(&[0, 0, 1]) {
                    i + 3
                } else if rest.starts_with(&[0, 0, 0, 1]) {
                    i + 4
                } else {
                    i += 1;
                    continue;
                };
                if let Some(b) = data.get(at) {
                    out.push(b & 0x1f);
                }
                i = at;
            }
            out
        }

        let mut enc =
            super::VaapiEncoder::probe(crate::encode::EncodeSettings::default()).expect("probe");
        let (w, h) = (640u32, 480u32);
        for i in 0..8u8 {
            // Changing content so the encoder has real deltas to code.
            let mut rgba = vec![0u8; (w * h * 4) as usize];
            for (p, px) in rgba.chunks_exact_mut(4).enumerate() {
                px[0] = ((p % 251) as u8).wrapping_add(i * 29);
                px[1] = ((p / 7 % 253) as u8).wrapping_add(i * 11);
                px[2] = i * 29;
                px[3] = 255;
            }
            let force = i == 3 || i == 6;
            let frame = enc
                .encode_rgba(w, h, &rgba, force)
                .expect("encode")
                .expect("blocking encode always emits");
            let nals = nal_types(&frame.data);
            assert!(
                !nals.contains(&0),
                "frame {i}: zeroed NAL header survived: {nals:?}"
            );
            if i == 0 {
                assert!(frame.keyframe, "first frame not a keyframe");
                assert!(
                    nals.contains(&7) && nals.contains(&8) && nals.contains(&5),
                    "frame {i}: IDR unit lacks SPS/PPS/IDR: {nals:?}"
                );
            } else {
                // Demanded keyframes are answered by the GOP, not by an
                // (unsyncable) mid-sequence I-slice; within one GOP of the
                // start every later frame is a plain P slice.
                assert!(!frame.keyframe, "frame {i}: unexpected keyframe");
                assert_eq!(nals, vec![1], "frame {i}: expected one P slice: {nals:?}");
            }
        }
    }

    #[test]
    fn nv12_conversion_produces_bt601_grey() {
        // 4x2 mid-grey: Y ~ 126, U/V ~ 128.
        let rgba = vec![128u8; 4 * 2 * 4];
        let mut out = Vec::new();
        super::rgba_to_nv12(4, 4, 2, &rgba, &mut out);
        assert_eq!(out.len(), 4 * 2 * 3 / 2);
        assert!(
            out[..8].iter().all(|&y| (125..=127).contains(&y)),
            "Y {:?}",
            &out[..8]
        );
        assert!(
            out[8..].iter().all(|&c| (127..=129).contains(&c)),
            "UV {:?}",
            &out[8..]
        );
    }
}
