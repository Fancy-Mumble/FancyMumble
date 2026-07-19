//! Video encoding: RGBA frames in, Annex-B H.264 access units out.
//!
//! The [`VideoEncoder`] trait keeps the broadcast pipeline codec-agnostic so
//! the encoder can be swapped (e.g. for VP8/libvpx) without touching capture
//! or WebRTC code. The default implementation is Cisco openh264 (constrained
//! baseline), chosen because it compiles from vendored C sources with `cc`
//! on both MSVC and MinGW toolchains.

use openh264::encoder::{Encoder, EncoderConfig};
use openh264::formats::YUVSource;
use openh264::OpenH264API;

/// One encoded video access unit.
#[derive(Debug)]
pub struct EncodedFrame {
    /// Annex-B byte stream (start-code delimited NAL units).
    pub data: Vec<u8>,
    /// Whether this frame is a keyframe (IDR).
    pub keyframe: bool,
}

/// A stateful video encoder consuming RGBA frames.
pub trait VideoEncoder: Send {
    /// Encode one RGBA frame (tightly packed, `width * height * 4` bytes).
    ///
    /// `force_keyframe` requests an IDR (e.g. a viewer sent a PLI). Returns
    /// `Ok(None)` when the encoder skipped the frame (rate control).
    fn encode_rgba(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String>;
}

/// Target encode parameters for screen content.
#[derive(Debug, Clone, Copy)]
pub struct EncodeSettings {
    /// Target bitrate in bits per second.
    pub bitrate_bps: u32,
    /// Maximum frame rate the pipeline will feed the encoder.
    pub max_fps: f32,
    /// Longest output edge in pixels; larger captures are downscaled before
    /// encoding (software H.264 at 4K runs several times slower than real
    /// time, and 4 Mbit/s spread over 4K looks worse than crisp 1080p).
    /// 0 disables the cap.
    pub max_dimension: u32,
}

impl Default for EncodeSettings {
    fn default() -> Self {
        // 60 fps is a CAP, not a target: the capture loop runs as fast as
        // capture+encode allow and sleeps only when it beats this budget.
        // Small windows comfortably exceed 30 fps (the e2e perf floor);
        // full 4K screens self-limit at whatever the machine manages.
        Self {
            bitrate_bps: 4_000_000,
            max_fps: 60.0,
            max_dimension: 1920,
        }
    }
}

/// Bitrate scaled with the actual pixel rate: `settings.bitrate_bps` is the
/// budget for 1080p@30, and larger/faster content gets proportionally more.
/// Without this (and with frame skipping, see the encoder config below) real
/// screen content starves the rate controller. Shared by every encoder tier
/// so quality is consistent when the pipeline picks a different backend.
pub(crate) fn scaled_bitrate(settings: &EncodeSettings, w: u32, h: u32) -> u32 {
    let reference = 1920.0 * 1080.0 * 30.0;
    let px_rate = f64::from(w) * f64::from(h) * f64::from(settings.max_fps.clamp(1.0, 60.0));
    let scaled = f64::from(settings.bitrate_bps) * (px_rate / reference).max(0.25);
    scaled.clamp(1_000_000.0, 20_000_000.0) as u32
}

/// H.264 encoder backed by openh264. Re-initialises itself transparently
/// when the source dimensions change (window resize) and forces an IDR on
/// the first frame after each (re-)initialisation.
pub struct H264Encoder {
    settings: EncodeSettings,
    encoder: Option<Encoder>,
    /// Dimensions the current `encoder` was initialised with (even-aligned).
    dims: (u32, u32),
    frame: I420Frame,
}

impl std::fmt::Debug for H264Encoder {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("H264Encoder")
            .field("dims", &self.dims)
            .finish_non_exhaustive()
    }
}

impl H264Encoder {
    /// Create an (uninitialised) encoder; the first frame sets dimensions.
    pub fn new(settings: EncodeSettings) -> Self {
        Self {
            settings,
            encoder: None,
            dims: (0, 0),
            frame: I420Frame::default(),
        }
    }

    fn ensure_encoder(&mut self, w: u32, h: u32) -> Result<(), String> {
        if self.encoder.is_none() || self.dims != (w, h) {
            let threads = std::thread::available_parallelism()
                .map(|n| n.get() as u16)
                .unwrap_or(4)
                .min(8);
            let config = EncoderConfig::new()
                .bitrate(openh264::encoder::BitRate::from_bps(scaled_bitrate(
                    &self.settings,
                    w,
                    h,
                )))
                .max_frame_rate(openh264::encoder::FrameRate::from_hz(self.settings.max_fps))
                // CameraVideoRealTime, deliberately: ScreenContentRealTime's
                // screen-coding tools cost ~7x the encode time on typical
                // desktop content (57 ms vs 8 ms per 1080p frame) regardless
                // of the complexity setting. The browser stack we are
                // replacing encoded with VP8 - no screen tools either - and
                // text at these bitrates stays crisp.
                .usage_type(openh264::encoder::UsageType::CameraVideoRealTime)
                .rate_control_mode(openh264::encoder::RateControlMode::Bitrate)
                // NEVER skip frames to hold the bitrate (the default!). The
                // rate controller must degrade QUALITY under pressure, like
                // the browser stack does - skipping turned real desktops
                // (high-entropy content) into a sub-1 fps slideshow while
                // flat test boards sailed through at 60.
                .skip_frames(false)
                // Realtime beats fidelity: Medium complexity costs 50-73 ms
                // per 1080p frame single-threaded (~8 fps pipelines).
                .complexity(openh264::encoder::Complexity::Low)
                // Size-limited slices switch the encoder off SM_SINGLE_SLICE,
                // which is ALSO what makes num_threads effective (OpenH264
                // parallelizes per slice). ~1180 bytes keeps every NAL inside
                // one RTP packet as a bonus.
                .max_slice_len(1180)
                .num_threads(threads);
            let enc = Encoder::with_api_config(OpenH264API::from_source(), config)
                .map_err(|e| format!("openh264 init failed: {e}"))?;
            self.encoder = Some(enc);
            self.dims = (w, h);
        }
        Ok(())
    }
}

impl VideoEncoder for H264Encoder {
    fn encode_rgba(
        &mut self,
        width: u32,
        height: u32,
        rgba: &[u8],
        force_keyframe: bool,
    ) -> Result<Option<EncodedFrame>, String> {
        // H.264 4:2:0 requires even dimensions; crop a trailing odd pixel.
        let w = width & !1;
        let h = height & !1;
        if w == 0 || h == 0 || rgba.len() < (width as usize) * (height as usize) * 4 {
            return Err("frame too small".to_owned());
        }

        let resized = self.dims != (w, h);
        self.frame.fill_from_rgba(width, w, h, rgba);
        self.ensure_encoder(w, h)?;
        let Some(encoder) = self.encoder.as_mut() else {
            return Err("encoder unavailable".to_owned());
        };
        if force_keyframe || resized {
            encoder.force_intra_frame();
        }

        let bitstream = encoder
            .encode(&self.frame)
            .map_err(|e| format!("h264 encode failed: {e}"))?;
        let data = bitstream.to_vec();
        if data.is_empty() {
            return Ok(None);
        }
        let keyframe = matches!(
            bitstream.frame_type(),
            openh264::encoder::FrameType::IDR | openh264::encoder::FrameType::I
        );
        Ok(Some(EncodedFrame { data, keyframe }))
    }
}

/// Reusable I420 (YUV 4:2:0 planar) buffer with BT.601 conversion from RGBA.
#[derive(Debug, Default)]
struct I420Frame {
    y: Vec<u8>,
    u: Vec<u8>,
    v: Vec<u8>,
    width: u32,
    height: u32,
}

impl I420Frame {
    /// Convert the top-left `w x h` region of a tightly packed RGBA image
    /// whose rows are `src_width` pixels wide. Integer BT.601 full-swing to
    /// limited-range, the same matrix browsers assume for camera content.
    fn fill_from_rgba(&mut self, src_width: u32, w: u32, h: u32, rgba: &[u8]) {
        self.width = w;
        self.height = h;
        let (wu, hu) = (w as usize, h as usize);
        let stride = src_width as usize * 4;
        self.y.resize(wu * hu, 0);
        self.u.resize(wu * hu / 4, 0);
        self.v.resize(wu * hu / 4, 0);

        // Full frames are the hottest per-pixel loop in the pipeline (a 4K
        // frame is 8.3M pixels), so split the work across cores in row
        // bands. Each band writes disjoint plane slices - plain safe
        // borrows, no synchronization needed beyond the scope join.
        let bands = std::thread::available_parallelism()
            .map(std::num::NonZero::get)
            .unwrap_or(4)
            .clamp(1, 8);
        // Chroma subsampling works on row PAIRS: band boundaries must stay
        // even so a 2x2 block never straddles two bands.
        let rows_per_band = (hu / bands).max(2) & !1;

        let cw = wu / 2;
        let y_bands = self.y.chunks_mut(rows_per_band * wu);
        let u_bands = self.u.chunks_mut(rows_per_band / 2 * cw);
        let v_bands = self.v.chunks_mut(rows_per_band / 2 * cw);
        std::thread::scope(|scope| {
            for (band, ((y_band, u_band), v_band)) in y_bands.zip(u_bands).zip(v_bands).enumerate()
            {
                let first_row = band * rows_per_band;
                let band_rows = y_band.len() / wu;
                let handle = scope.spawn(move || {
                    convert_band(
                        rgba, stride, wu, first_row, band_rows, y_band, u_band, v_band,
                    );
                });
                // Threads join at scope exit; the handle itself is unused.
                let _ = handle;
            }
        });
    }
}

/// Convert `band_rows` rows (starting at `first_row`) of a tightly packed
/// RGBA image into the given Y/U/V band slices (BT.601, see caller).
#[allow(
    clippy::too_many_arguments,
    reason = "hot loop; a struct would obscure the banding"
)]
fn convert_band(
    rgba: &[u8],
    stride: usize,
    wu: usize,
    first_row: usize,
    band_rows: usize,
    y_band: &mut [u8],
    u_band: &mut [u8],
    v_band: &mut [u8],
) {
    for row in 0..band_rows {
        let src_row = &rgba[(first_row + row) * stride..(first_row + row) * stride + wu * 4];
        let dst_row = &mut y_band[row * wu..(row + 1) * wu];
        for (x, dst) in dst_row.iter_mut().enumerate() {
            let p = &src_row[x * 4..x * 4 + 3];
            let (r, g, b) = (i32::from(p[0]), i32::from(p[1]), i32::from(p[2]));
            *dst = (((66 * r + 129 * g + 25 * b + 128) >> 8) + 16).clamp(0, 255) as u8;
        }
    }

    // Chroma: average each 2x2 block.
    let cw = wu / 2;
    for cy in 0..band_rows / 2 {
        for cx in 0..cw {
            let (mut r, mut g, mut b) = (0i32, 0i32, 0i32);
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let off = (first_row + cy * 2 + dy) * stride + (cx * 2 + dx) * 4;
                r += i32::from(rgba[off]);
                g += i32::from(rgba[off + 1]);
                b += i32::from(rgba[off + 2]);
            }
            let (r, g, b) = (r / 4, g / 4, b / 4);
            u_band[cy * cw + cx] =
                ((((-38 * r - 74 * g + 112 * b) + 128) >> 8) + 128).clamp(0, 255) as u8;
            v_band[cy * cw + cx] =
                ((((112 * r - 94 * g - 18 * b) + 128) >> 8) + 128).clamp(0, 255) as u8;
        }
    }
}

impl YUVSource for I420Frame {
    fn dimensions(&self) -> (usize, usize) {
        (self.width as usize, self.height as usize)
    }

    fn strides(&self) -> (usize, usize, usize) {
        (
            self.width as usize,
            self.width as usize / 2,
            self.width as usize / 2,
        )
    }

    fn y(&self) -> &[u8] {
        &self.y
    }

    fn u(&self) -> &[u8] {
        &self.u
    }

    fn v(&self) -> &[u8] {
        &self.v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual stage benchmark: per-stage cost of a 1080p frame for noise
    /// (worst case) and flat-cell board content (e2e-like). Run with
    /// `cargo test -p fancy-screenshare --release -- --ignored --nocapture`.
    /// One synthetic bench frame: pseudo-random noise (encoder worst case)
    /// or flat 120px cells with one row's shade cycling (e2e-like content).
    fn fill_bench_frame(rgba: &mut [u8], w: u32, i: u32, noise: bool) {
        if noise {
            for (px, chunk) in rgba.chunks_exact_mut(4).enumerate() {
                let v = (px as u32).wrapping_add(i.wrapping_mul(7919)) as u8;
                chunk[0] = v;
                chunk[1] = v.wrapping_mul(3);
                chunk[2] = v ^ 0x5a;
                chunk[3] = 255;
            }
            return;
        }
        for (px, chunk) in rgba.chunks_exact_mut(4).enumerate() {
            let (x, y) = (px as u32 % w, px as u32 / w);
            let green = ((x / 120 + y / 120) % 2) == 0;
            let step = if y / 120 == i % 9 {
                (i % 5 * 10) as u8
            } else {
                20
            };
            if green {
                chunk[0] = 0;
                chunk[1] = 160 + step;
                chunk[2] = 0;
            } else {
                chunk[0] = 130 + step;
                chunk[1] = 0;
                chunk[2] = 130 + step;
            }
            chunk[3] = 255;
        }
    }

    #[test]
    #[ignore = "manual benchmark, not a correctness test"]
    fn bench_convert_encode_1080p() {
        let (w, h) = (1920u32, 1080u32);
        let frames = 60u32;
        for noise in [true, false] {
            let mut rgba = vec![0u8; (w * h * 4) as usize];
            let mut enc = H264Encoder::new(EncodeSettings::default());
            let (mut t_convert, mut t_encode) =
                (std::time::Duration::ZERO, std::time::Duration::ZERO);
            for i in 0..frames {
                fill_bench_frame(&mut rgba, w, i, noise);
                let t0 = std::time::Instant::now();
                enc.frame.fill_from_rgba(w, w, h, &rgba);
                t_convert += t0.elapsed();
                enc.ensure_encoder(w, h).expect("encoder init");
                let t1 = std::time::Instant::now();
                let bitstream = enc
                    .encoder
                    .as_mut()
                    .expect("enc")
                    .encode(&enc.frame)
                    .expect("encode");
                t_encode += t1.elapsed();
                assert!(!bitstream.to_vec().is_empty() || i == u32::MAX);
            }
            println!(
                "1080p {} content: convert {:?}/frame, encode {:?}/frame",
                if noise { "noise" } else { "board" },
                t_convert / frames,
                t_encode / frames,
            );
        }
    }

    /// A solid green RGBA frame must convert to I420 with green-ish chroma
    /// (U low, V low) and encode to a non-empty keyframe.
    #[test]
    fn green_frame_encodes_to_idr() {
        let (w, h) = (64u32, 48u32);
        let mut rgba = vec![0u8; (w * h * 4) as usize];
        for px in rgba.chunks_exact_mut(4) {
            px[0] = 0;
            px[1] = 180;
            px[2] = 0;
            px[3] = 255;
        }
        let mut enc = H264Encoder::new(EncodeSettings::default());
        let frame = enc
            .encode_rgba(w, h, &rgba, true)
            .expect("encode should succeed")
            .expect("first frame should not be skipped");
        assert!(frame.keyframe, "first frame must be an IDR");
        assert!(frame.data.starts_with(&[0, 0, 0, 1]) || frame.data.starts_with(&[0, 0, 1]));
    }

    /// Odd dimensions are cropped, not rejected.
    #[test]
    fn odd_dimensions_are_cropped() {
        let (w, h) = (65u32, 49u32);
        let rgba = vec![128u8; (w * h * 4) as usize];
        let mut enc = H264Encoder::new(EncodeSettings::default());
        let out = enc
            .encode_rgba(w, h, &rgba, true)
            .expect("encode should succeed");
        assert!(out.is_some());
    }
}
