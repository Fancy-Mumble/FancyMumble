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
        let display = libva::Display::open()
            .ok_or_else(|| "no VA display (no /dev/dri render node or libva driver)".to_owned())?;
        let entrypoints = display
            .query_config_entrypoints(libva::VAProfile::VAProfileH264Main)
            .map_err(|e| format!("vaQueryConfigEntrypoints: {e}"))?;
        // Prefer the low-power (VDEnc-style) engine where present - the
        // battle-tested path on modern Intel, and what Chromium prefers.
        let low_power = entrypoints.contains(&libva::VAEntrypoint::VAEntrypointEncSliceLP);
        let full_power = entrypoints.contains(&libva::VAEntrypoint::VAEntrypointEncSlice);
        if !low_power && !full_power {
            return Err("VA driver has no H.264 encode entrypoint".to_owned());
        }
        match display.query_vendor_string() {
            Ok(vendor) => tracing::info!(vendor, low_power, "screenshare: VA-API encoder ready"),
            Err(_) => tracing::info!(low_power, "screenshare: VA-API encoder ready"),
        }
        Ok(Self {
            display,
            low_power,
            settings,
            inner: None,
            timestamp: 0,
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
        let config = EncoderConfig {
            resolution: Resolution {
                width: w,
                height: h,
            },
            profile: Profile::Main,
            level: pick_level(w, h, self.settings.max_fps),
            pred_structure: PredictionStructure::LowDelay { limit: 2048 },
            initial_tunings: Tunings {
                rate_control: RateControl::ConstantBitrate(u64::from(scaled_bitrate(
                    &self.settings,
                    w,
                    h,
                ))),
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
        self.ensure_encoder(w, h)?;

        let mut nv12 = Vec::new();
        rgba_to_nv12(width as usize, w as usize, h as usize, rgba, &mut nv12);
        let frame = CpuNv12Frame {
            width: w,
            height: h,
            data: nv12,
        };

        let inner = self.inner.as_mut().ok_or("encoder missing after init")?;
        let force = force_keyframe || inner.fresh;
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
            force_keyframe: force,
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
        let keyframe = contains_idr(&data);
        Ok(Some(EncodedFrame { data, keyframe }))
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
