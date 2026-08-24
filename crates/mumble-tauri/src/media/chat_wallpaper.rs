//! Offline processing of animated chat wallpapers.
//!
//! The webview applies the wallpaper's blur and dim as a CSS filter, which the
//! compositor then re-evaluates for every frame of a playing video, forever.
//! This module spends that cost once instead: it decodes the clip, blurs and
//! dims the pixels, and encodes the result, so playback is a plain `<video>`
//! with no filter at all.
//!
//! The codec is the same vendored OpenH264 the screenshare encoder already
//! ships - nothing here depends on the system's GStreamer plugins, which is
//! also why this works on machines whose *webview* cannot decode H.264 at all.
//! Only H.264 in MP4 is processed; anything else falls back to the live CSS
//! path, and the caller treats that as a degradation rather than an error.

use std::io::{BufReader, BufWriter, Seek, Write};
use std::path::Path;

use mp4::{AvcConfig, MediaConfig, Mp4Config, Mp4Sample, Mp4Writer, TrackConfig, TrackType};
use openh264::decoder::{DecodedYUV, Decoder};
use openh264::encoder::{Encoder, EncoderConfig, FrameType};
use openh264::formats::{YUVBuffer, YUVSource};
use openh264::{OpenH264API, Timestamp};

/// Bake output is capped to the same processing bounds the still-image
/// pipeline uses (`fancy_utils::image_filter`): the result is a blurred
/// background, so the resolution is imperceptible and the blur cost per frame
/// stays flat regardless of the source.
const BAKE_MAX_WIDTH: usize = 960;
const BAKE_MAX_HEIGHT: usize = 540;

/// Refuse clips longer than this many frames (~7 minutes at 30 fps).
///
/// The bake is linear in frames; past this point it stops being "a moment
/// while the settings page looks busy" and turns into a background job nobody
/// asked for. Long clips simply keep the live-filter path.
const MAX_FRAMES: u32 = 12_000;

/// Keyframe cadence of the baked stream, in seconds.
///
/// A wallpaper only ever seeks to zero (the loop restart), so sparse IDRs cost
/// nothing in practice and keep the file small.
const KEYFRAME_INTERVAL_SECS: f64 = 4.0;

/// How often the progress callback fires, in frames.
const PROGRESS_STRIDE: u32 = 30;

// ---------------------------------------------------------------------------
// Annex B <-> AVCC
//
// MP4 stores each sample as length-prefixed NAL units ("AVCC"), while OpenH264
// speaks the start-code framing ("Annex B"). The conversions are mechanical
// but easy to get subtly wrong, so they live here with their own tests.
// ---------------------------------------------------------------------------

/// Rewrite one AVCC sample (`len_size`-byte big-endian length prefixes) into
/// Annex B, appending to `out`.
fn avcc_sample_to_annexb(sample: &[u8], len_size: usize, out: &mut Vec<u8>) -> Result<(), String> {
    if !(1..=4).contains(&len_size) {
        return Err(format!("invalid NAL length prefix size {len_size}"));
    }
    let mut cursor = 0usize;
    while cursor < sample.len() {
        let Some(prefix) = sample.get(cursor..cursor + len_size) else {
            return Err("truncated NAL length prefix".to_owned());
        };
        let mut len = 0usize;
        for byte in prefix {
            len = (len << 8) | usize::from(*byte);
        }
        cursor += len_size;
        let Some(nal) = sample.get(cursor..cursor + len) else {
            return Err("NAL length prefix exceeds sample".to_owned());
        };
        cursor += len;
        out.extend_from_slice(&[0, 0, 0, 1]);
        out.extend_from_slice(nal);
    }
    Ok(())
}

/// Split an Annex B stream into its NAL units (without start codes).
fn split_annexb(stream: &[u8]) -> Vec<&[u8]> {
    let mut nals = Vec::new();
    let mut start = None::<usize>;
    let mut i = 0usize;
    while i + 2 < stream.len() {
        if stream[i] == 0 && stream[i + 1] == 0 && stream[i + 2] == 1 {
            let code_start = if i > 0 && stream[i - 1] == 0 {
                i - 1
            } else {
                i
            };
            if let Some(s) = start {
                nals.push(&stream[s..code_start]);
            }
            start = Some(i + 3);
            i += 3;
        } else {
            i += 1;
        }
    }
    if let Some(s) = start {
        nals.push(&stream[s..]);
    }
    nals
}

/// The `nal_unit_type` of a NAL unit (low five bits of its first byte).
fn nal_type(nal: &[u8]) -> u8 {
    nal.first().map_or(0, |b| b & 0x1F)
}

const NAL_SPS: u8 = 7;
const NAL_PPS: u8 = 8;

/// Convert Annex B encoder output into one AVCC sample (4-byte prefixes),
/// dropping SPS/PPS (those live in the container's `avcC` box instead).
fn annexb_to_avcc_sample(stream: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(stream.len() + 16);
    for nal in split_annexb(stream) {
        if nal.is_empty() || matches!(nal_type(nal), NAL_SPS | NAL_PPS) {
            continue;
        }
        out.extend_from_slice(&u32::try_from(nal.len()).unwrap_or(0).to_be_bytes());
        out.extend_from_slice(nal);
    }
    out
}

// ---------------------------------------------------------------------------
// Pixel work
//
// All processing happens on interleaved RGB in plain `u8` buffers. The image
// crate's Gaussian is a true convolution and far too slow to run per frame;
// three box passes are visually indistinguishable for a background and run in
// linear time.
// ---------------------------------------------------------------------------

/// Box radii whose triple application approximates a Gaussian of `sigma`.
///
/// The standard "boxes for Gauss" construction (Kovesi): pick the ideal box
/// width, then split the three passes between the two nearest odd widths so
/// the accumulated variance lands on the target.
fn boxes_for_gauss(sigma: f32) -> [usize; 3] {
    if sigma <= 0.0 {
        return [0, 0, 0];
    }
    let n = 3.0f32;
    let w_ideal = (12.0 * sigma * sigma / n + 1.0).sqrt();
    let mut wl = w_ideal.floor() as i32;
    if wl % 2 == 0 {
        wl -= 1;
    }
    let wl = wl.max(1);
    let wu = wl + 2;
    let m_ideal = (12.0 * sigma * sigma - n * (wl * wl) as f32 - 4.0 * n * wl as f32 - 3.0 * n)
        / (-4.0 * wl as f32 - 4.0);
    let m = m_ideal.round() as i32;
    let mut radii = [0usize; 3];
    for (i, radius) in radii.iter_mut().enumerate() {
        let w = if (i as i32) < m { wl } else { wu };
        *radius = ((w - 1) / 2).max(0) as usize;
    }
    radii
}

/// One horizontal box pass over interleaved RGB, edge-clamped.
///
/// The window at output `x` covers `[x-radius, x+radius]` with indices clamped
/// to the row; the running sum adds the element entering on the right and
/// removes the one leaving on the left.
fn box_pass_horizontal(src: &[u8], dst: &mut [u8], w: usize, h: usize, radius: usize) {
    let window = (2 * radius + 1) as u32;
    for row in 0..h {
        let base = row * w * 3;
        let mut sums = [0u32; 3];
        for c in 0..3 {
            sums[c] = u32::from(src[base + c]) * (radius as u32 + 1);
        }
        for j in 1..=radius {
            let px = base + j.min(w - 1) * 3;
            for c in 0..3 {
                sums[c] += u32::from(src[px + c]);
            }
        }
        for x in 0..w {
            let out = base + x * 3;
            for c in 0..3 {
                dst[out + c] = (sums[c] / window) as u8;
            }
            let entering = base + (x + 1 + radius).min(w - 1) * 3;
            let leaving = base + x.saturating_sub(radius) * 3;
            for c in 0..3 {
                sums[c] += u32::from(src[entering + c]);
                sums[c] -= u32::from(src[leaving + c]);
            }
        }
    }
}

/// One vertical box pass over interleaved RGB, edge-clamped.
fn box_pass_vertical(src: &[u8], dst: &mut [u8], w: usize, h: usize, radius: usize) {
    let window = (2 * radius + 1) as u32;
    let stride = w * 3;
    for col in 0..w {
        let base = col * 3;
        let mut sums = [0u32; 3];
        for c in 0..3 {
            sums[c] = u32::from(src[base + c]) * (radius as u32 + 1);
        }
        for j in 1..=radius {
            let px = j.min(h - 1) * stride + base;
            for c in 0..3 {
                sums[c] += u32::from(src[px + c]);
            }
        }
        for y in 0..h {
            let out = y * stride + base;
            for c in 0..3 {
                dst[out + c] = (sums[c] / window) as u8;
            }
            let entering = (y + 1 + radius).min(h - 1) * stride + base;
            let leaving = y.saturating_sub(radius) * stride + base;
            for c in 0..3 {
                sums[c] += u32::from(src[entering + c]);
                sums[c] -= u32::from(src[leaving + c]);
            }
        }
    }
}

/// Approximate a Gaussian blur of `sigma` in place, using `scratch` as the
/// ping-pong buffer (same size as `buf`).
fn blur_rgb(buf: &mut [u8], scratch: &mut [u8], w: usize, h: usize, sigma: f32) {
    if sigma <= 0.0 || w == 0 || h == 0 {
        return;
    }
    for radius in boxes_for_gauss(sigma) {
        if radius == 0 {
            continue;
        }
        box_pass_horizontal(buf, scratch, w, h, radius);
        box_pass_vertical(scratch, buf, w, h, radius);
    }
}

/// Darken in place; the same arithmetic as `fancy_utils`' `DimFilter`, so a
/// baked clip and a baked still land on the same brightness.
fn dim_rgb(buf: &mut [u8], dim: f32) {
    if dim <= 0.0 {
        return;
    }
    let factor = 1.0 - dim.clamp(0.0, 1.0);
    for byte in buf {
        *byte = (f32::from(*byte) * factor) as u8;
    }
}

/// Bilinear-resize interleaved RGB to exactly `dw` x `dh`.
fn resize_rgb(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    let mut dst = vec![0u8; dw * dh * 3];
    if sw == 0 || sh == 0 || dw == 0 || dh == 0 {
        return dst;
    }
    let x_ratio = sw as f32 / dw as f32;
    let y_ratio = sh as f32 / dh as f32;
    for dy in 0..dh {
        let sy = (dy as f32 + 0.5) * y_ratio - 0.5;
        let y0 = sy.floor().max(0.0) as usize;
        let y1 = (y0 + 1).min(sh - 1);
        let fy = (sy - y0 as f32).clamp(0.0, 1.0);
        for dx in 0..dw {
            let sx = (dx as f32 + 0.5) * x_ratio - 0.5;
            let x0 = sx.floor().max(0.0) as usize;
            let x1 = (x0 + 1).min(sw - 1);
            let fx = (sx - x0 as f32).clamp(0.0, 1.0);
            let out = (dy * dw + dx) * 3;
            for c in 0..3 {
                let p00 = f32::from(src[(y0 * sw + x0) * 3 + c]);
                let p10 = f32::from(src[(y0 * sw + x1) * 3 + c]);
                let p01 = f32::from(src[(y1 * sw + x0) * 3 + c]);
                let p11 = f32::from(src[(y1 * sw + x1) * 3 + c]);
                let top = p00 + (p10 - p00) * fx;
                let bottom = p01 + (p11 - p01) * fx;
                dst[out + c] = (top + (bottom - top) * fy) as u8;
            }
        }
    }
    dst
}

/// The even-aligned dimensions a source frame is baked at: fitted into
/// 960x540, never upscaled.
fn bake_dimensions(sw: usize, sh: usize) -> (usize, usize) {
    let scale = (BAKE_MAX_WIDTH as f32 / sw as f32)
        .min(BAKE_MAX_HEIGHT as f32 / sh as f32)
        .min(1.0);
    let w = ((sw as f32 * scale) as usize).max(2) & !1;
    let h = ((sh as f32 * scale) as usize).max(2) & !1;
    (w, h)
}

/// Convert interleaved RGB to contiguous I420 (BT.601, like the screenshare
/// encoder's conversion), chroma averaged over each 2x2 block.
fn rgb_to_i420(rgb: &[u8], w: usize, h: usize) -> Vec<u8> {
    let mut yuv = vec![0u8; w * h + (w / 2) * (h / 2) * 2];
    let (y_plane, uv) = yuv.split_at_mut(w * h);
    let (u_plane, v_plane) = uv.split_at_mut((w / 2) * (h / 2));

    for row in 0..h {
        for col in 0..w {
            let p = (row * w + col) * 3;
            let (r, g, b) = (
                f32::from(rgb[p]),
                f32::from(rgb[p + 1]),
                f32::from(rgb[p + 2]),
            );
            y_plane[row * w + col] =
                (16.0 + 0.257 * r + 0.504 * g + 0.098 * b).clamp(0.0, 255.0) as u8;
        }
    }
    for row in (0..h).step_by(2) {
        for col in (0..w).step_by(2) {
            let mut r = 0.0f32;
            let mut g = 0.0f32;
            let mut b = 0.0f32;
            for (dy, dx) in [(0, 0), (0, 1), (1, 0), (1, 1)] {
                let p = ((row + dy).min(h - 1) * w + (col + dx).min(w - 1)) * 3;
                r += f32::from(rgb[p]);
                g += f32::from(rgb[p + 1]);
                b += f32::from(rgb[p + 2]);
            }
            let (r, g, b) = (r / 4.0, g / 4.0, b / 4.0);
            let idx = (row / 2) * (w / 2) + col / 2;
            u_plane[idx] = (128.0 - 0.148 * r - 0.291 * g + 0.439 * b).clamp(0.0, 255.0) as u8;
            v_plane[idx] = (128.0 + 0.439 * r - 0.368 * g - 0.071 * b).clamp(0.0, 255.0) as u8;
        }
    }
    yuv
}

// ---------------------------------------------------------------------------
// Demux + decode driver
// ---------------------------------------------------------------------------

/// Everything the bake needs to know about the source's video track.
struct VideoTrack {
    track_id: u32,
    timescale: u32,
    sample_count: u32,
    nal_length_size: usize,
    /// SPS + PPS as one Annex B chunk, fed to the decoder before any sample.
    headers: Vec<u8>,
    /// Composition timestamps of every sample, sorted ascending. Frames come
    /// out of the decoder in display order, so the i-th emitted frame belongs
    /// to the i-th of these regardless of B-frame reordering in the input.
    sorted_cts: Vec<u64>,
    fps: f64,
}

fn open_video_track<R: std::io::Read + Seek>(
    reader: &mut mp4::Mp4Reader<R>,
) -> Result<VideoTrack, String> {
    let track = reader
        .tracks()
        .values()
        .find(|t| {
            matches!(t.track_type(), Ok(TrackType::Video))
                && t.trak.mdia.minf.stbl.stsd.avc1.is_some()
        })
        .ok_or_else(|| "no H.264 video track (only MP4/H.264 can be pre-processed)".to_owned())?;

    let track_id = track.track_id();
    let sample_count = track.sample_count();
    if sample_count == 0 {
        return Err("video track has no samples".to_owned());
    }
    if sample_count > MAX_FRAMES {
        return Err(format!(
            "clip is too long to pre-process ({sample_count} frames; the limit is {MAX_FRAMES})"
        ));
    }

    let mut headers = Vec::new();
    headers.extend_from_slice(&[0, 0, 0, 1]);
    headers.extend_from_slice(
        track
            .sequence_parameter_set()
            .map_err(|e| format!("read SPS: {e}"))?,
    );
    headers.extend_from_slice(&[0, 0, 0, 1]);
    headers.extend_from_slice(
        track
            .picture_parameter_set()
            .map_err(|e| format!("read PPS: {e}"))?,
    );

    let nal_length_size = track
        .trak
        .mdia
        .minf
        .stbl
        .stsd
        .avc1
        .as_ref()
        .map_or(4, |avc1| {
            usize::from(avc1.avcc.length_size_minus_one & 0x3) + 1
        });

    let timescale = track.timescale();
    let duration_secs = track.duration().as_secs_f64();
    let fps = if duration_secs > 0.0 {
        f64::from(sample_count) / duration_secs
    } else {
        30.0
    };

    Ok(VideoTrack {
        track_id,
        timescale,
        sample_count,
        nal_length_size,
        headers,
        sorted_cts: Vec::new(),
        fps,
    })
}

/// Decode every frame of `track`, handing each display-ordered frame to
/// `sink` together with its index. `sink` returns `false` to stop early.
///
/// Returns the number of frames emitted.
fn decode_frames<R: std::io::Read + Seek>(
    reader: &mut mp4::Mp4Reader<R>,
    track: &mut VideoTrack,
    mut sink: impl FnMut(usize, &DecodedYUV<'_>) -> Result<bool, String>,
) -> Result<usize, String> {
    let mut decoder = Decoder::with_api_config(
        OpenH264API::from_source(),
        openh264::decoder::DecoderConfig::new(),
    )
    .map_err(|e| format!("H.264 decoder init: {e}"))?;

    // Headers first; the decoder returns no frame for these.
    let headers = track.headers.clone();
    let _ = decoder
        .decode(&headers)
        .map_err(|e| format!("decode SPS/PPS: {e}"))?;

    let mut cts = Vec::with_capacity(track.sample_count as usize);
    let mut annexb = Vec::new();
    let mut emitted = 0usize;

    for sample_id in 1..=track.sample_count {
        let Some(sample) = reader
            .read_sample(track.track_id, sample_id)
            .map_err(|e| format!("read sample {sample_id}: {e}"))?
        else {
            break;
        };
        if sample.bytes.is_empty() {
            continue;
        }
        cts.push(
            sample
                .start_time
                .saturating_add_signed(i64::from(sample.rendering_offset)),
        );

        annexb.clear();
        avcc_sample_to_annexb(&sample.bytes, track.nal_length_size, &mut annexb)?;
        let decoded = decoder
            .decode(&annexb)
            .map_err(|e| format!("decode frame {sample_id}: {e}"))?;
        if let Some(frame) = decoded {
            if !sink(emitted, &frame)? {
                track.sorted_cts = cts;
                track.sorted_cts.sort_unstable();
                return Ok(emitted + 1);
            }
            emitted += 1;
        }
    }

    for frame in decoder
        .flush_remaining()
        .map_err(|e| format!("flush decoder: {e}"))?
    {
        if !sink(emitted, &frame)? {
            emitted += 1;
            break;
        }
        emitted += 1;
    }

    track.sorted_cts = cts;
    track.sorted_cts.sort_unstable();
    Ok(emitted)
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/// Decode the opening moments of `input` and return a poster frame as JPEG,
/// fitted into 960x540.
///
/// Prefers a frame ~0.1s in over the very first one - clips habitually open
/// on a black frame, which would make a poor still.
pub(crate) fn extract_poster(input: &Path) -> Result<Vec<u8>, String> {
    let file = std::fs::File::open(input).map_err(|e| format!("open video: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("stat video: {e}"))?
        .len();
    let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size)
        .map_err(|e| format!("read MP4: {e}"))?;
    let mut track = open_video_track(&mut reader)?;

    // ~0.1s at the estimated frame rate, but never past the clip.
    let skip = ((track.fps * 0.1) as usize).min(track.sample_count as usize - 1);

    let mut rgb: Option<(Vec<u8>, usize, usize)> = None;
    let _frames = decode_frames(&mut reader, &mut track, |index, frame| {
        let (w, h) = frame.dimensions();
        let mut buf = vec![0u8; w * h * 3];
        frame.write_rgb8(&mut buf);
        rgb = Some((buf, w, h));
        Ok(index < skip)
    })?;

    let (buf, w, h) = rgb.ok_or_else(|| "could not decode any frame of that video".to_owned())?;
    let image = image::RgbImage::from_raw(w as u32, h as u32, buf)
        .ok_or_else(|| "decoded frame has unexpected size".to_owned())?;
    let mut poster = image::DynamicImage::ImageRgb8(image);
    if w > BAKE_MAX_WIDTH || h > BAKE_MAX_HEIGHT {
        poster = poster.resize(
            BAKE_MAX_WIDTH as u32,
            BAKE_MAX_HEIGHT as u32,
            image::imageops::FilterType::Triangle,
        );
    }
    let mut jpeg = Vec::new();
    poster
        .write_to(
            &mut std::io::Cursor::new(&mut jpeg),
            image::ImageFormat::Jpeg,
        )
        .map_err(|e| format!("encode poster: {e}"))?;
    Ok(jpeg)
}

/// Bake `sigma`/`dim` into every frame of `input`, writing an H.264 MP4 to
/// `output`. `progress` receives (done, total) as the bake advances.
pub(crate) fn bake_video(
    input: &Path,
    output: &Path,
    sigma: f32,
    dim: f32,
    mut progress: impl FnMut(u32, u32),
) -> Result<(), String> {
    let sigma = sigma.clamp(0.0, 50.0);
    let dim = dim.clamp(0.0, 1.0);

    let file = std::fs::File::open(input).map_err(|e| format!("open video: {e}"))?;
    let size = file
        .metadata()
        .map_err(|e| format!("stat video: {e}"))?
        .len();
    let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size)
        .map_err(|e| format!("read MP4: {e}"))?;
    let mut track = open_video_track(&mut reader)?;
    let total = track.sample_count;
    let timescale = track.timescale.max(1);
    let keyframe_interval = ((track.fps * KEYFRAME_INTERVAL_SECS) as usize).max(1);

    let mut encoder: Option<Encoder> = None;
    let mut dims = (0usize, 0usize);
    let mut scratch: Vec<u8> = Vec::new();
    // (avcc sample bytes, keyframe) per emitted frame, plus the stream's
    // parameter sets once known.
    let mut samples: Vec<(Vec<u8>, bool)> = Vec::new();
    let mut sps: Vec<u8> = Vec::new();
    let mut pps: Vec<u8> = Vec::new();
    let fps = track.fps;

    let _frames = decode_frames(&mut reader, &mut track, |index, frame| {
        let (sw, sh) = frame.dimensions();
        let mut rgb = vec![0u8; sw * sh * 3];
        frame.write_rgb8(&mut rgb);

        let (bw, bh) = bake_dimensions(sw, sh);
        let mut rgb = if (bw, bh) == (sw, sh) {
            rgb
        } else {
            resize_rgb(&rgb, sw, sh, bw, bh)
        };
        scratch.resize(rgb.len(), 0);
        blur_rgb(&mut rgb, &mut scratch, bw, bh, sigma);
        dim_rgb(&mut rgb, dim);

        if encoder.is_none() || dims != (bw, bh) {
            let bitrate = ((bw * bh) as f32 * fps as f32 * 0.06).clamp(600_000.0, 4_000_000.0);
            let config = EncoderConfig::new()
                .bitrate(openh264::encoder::BitRate::from_bps(bitrate as u32))
                .max_frame_rate(openh264::encoder::FrameRate::from_hz(fps as f32))
                .usage_type(openh264::encoder::UsageType::CameraVideoRealTime)
                .rate_control_mode(openh264::encoder::RateControlMode::Bitrate)
                .skip_frames(false)
                .complexity(openh264::encoder::Complexity::Medium);
            encoder = Some(
                Encoder::with_api_config(OpenH264API::from_source(), config)
                    .map_err(|e| format!("H.264 encoder init: {e}"))?,
            );
            dims = (bw, bh);
        }
        let Some(enc) = encoder.as_mut() else {
            return Err("encoder unavailable".to_owned());
        };
        if index.is_multiple_of(keyframe_interval) {
            enc.force_intra_frame();
        }

        let yuv = YUVBuffer::from_vec(rgb_to_i420(&rgb, bw, bh), bw, bh);
        let millis = index as u64 * 1000 / (fps.max(1.0) as u64).max(1);
        let bitstream = enc
            .encode_at(&yuv, Timestamp::from_millis(millis))
            .map_err(|e| format!("encode frame {index}: {e}"))?;
        let annexb = bitstream.to_vec();
        if sps.is_empty() {
            for nal in split_annexb(&annexb) {
                match nal_type(nal) {
                    NAL_SPS if sps.is_empty() => sps = nal.to_vec(),
                    NAL_PPS if pps.is_empty() => pps = nal.to_vec(),
                    _ => {}
                }
            }
        }
        let keyframe = matches!(bitstream.frame_type(), FrameType::IDR | FrameType::I);
        samples.push((annexb_to_avcc_sample(&annexb), keyframe));

        if (index as u32).is_multiple_of(PROGRESS_STRIDE) {
            progress(index as u32, total);
        }
        Ok(true)
    })?;

    if samples.is_empty() {
        return Err("could not decode any frame of that video".to_owned());
    }
    if sps.is_empty() || pps.is_empty() {
        return Err("encoder produced no parameter sets".to_owned());
    }

    // Composition times of the input, reused for the output. The bake is
    // frame-for-frame, so this preserves variable frame pacing exactly.
    let default_duration = (f64::from(timescale) / fps).max(1.0) as u32;
    write_baked_mp4(
        output,
        timescale,
        dims,
        (sps, pps),
        &samples,
        &track.sorted_cts,
        default_duration,
    )?;
    progress(total, total);
    Ok(())
}

/// Mux the encoded samples into an MP4 at `output`, reusing the source's
/// composition times so variable frame pacing survives the bake.
fn write_baked_mp4(
    output: &Path,
    timescale: u32,
    dims: (usize, usize),
    (sps, pps): (Vec<u8>, Vec<u8>),
    samples: &[(Vec<u8>, bool)],
    cts: &[u64],
    default_duration: u32,
) -> Result<(), String> {
    let out_file = std::fs::File::create(output).map_err(|e| format!("create output: {e}"))?;
    let mut writer = Mp4Writer::write_start(
        BufWriter::new(out_file),
        &Mp4Config {
            major_brand: str::parse("isom").map_err(|e| format!("brand: {e}"))?,
            minor_version: 512,
            compatible_brands: vec![
                str::parse("isom").map_err(|e| format!("brand: {e}"))?,
                str::parse("avc1").map_err(|e| format!("brand: {e}"))?,
            ],
            timescale,
        },
    )
    .map_err(|e| format!("start MP4: {e}"))?;

    writer
        .add_track(&TrackConfig {
            track_type: TrackType::Video,
            timescale,
            language: "und".to_owned(),
            media_conf: MediaConfig::AvcConfig(AvcConfig {
                width: dims.0 as u16,
                height: dims.1 as u16,
                seq_param_set: sps,
                pic_param_set: pps,
            }),
        })
        .map_err(|e| format!("add track: {e}"))?;

    let first_cts = cts.first().copied().unwrap_or(0);
    for (index, (bytes, keyframe)) in samples.iter().enumerate() {
        let start_time = cts.get(index).map_or_else(
            || index as u64 * u64::from(default_duration),
            |t| t - first_cts,
        );
        let duration = cts
            .get(index + 1)
            .and_then(|next| cts.get(index).map(|now| (next - now) as u32))
            .filter(|d| *d > 0)
            .unwrap_or(default_duration);
        writer
            .write_sample(
                1,
                &Mp4Sample {
                    start_time,
                    duration,
                    rendering_offset: 0,
                    is_sync: *keyframe,
                    bytes: bytes.clone().into(),
                },
            )
            .map_err(|e| format!("write sample {index}: {e}"))?;
    }
    writer.write_end().map_err(|e| format!("finish MP4: {e}"))?;
    writer
        .into_writer()
        .flush()
        .map_err(|e| format!("flush output: {e}"))?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn avcc_annexb_roundtrip() {
        // Two NALs (fake SPS-ish and slice-ish payloads) with 4-byte prefixes.
        let nal_a = [0x65, 1, 2, 3];
        let nal_b = [0x41, 9, 8, 7, 6];
        let mut avcc = Vec::new();
        avcc.extend_from_slice(&(nal_a.len() as u32).to_be_bytes());
        avcc.extend_from_slice(&nal_a);
        avcc.extend_from_slice(&(nal_b.len() as u32).to_be_bytes());
        avcc.extend_from_slice(&nal_b);

        let mut annexb = Vec::new();
        avcc_sample_to_annexb(&avcc, 4, &mut annexb).expect("convert");
        let nals = split_annexb(&annexb);
        assert_eq!(nals, vec![&nal_a[..], &nal_b[..]]);

        // And back, which also drops nothing for VCL NALs.
        let back = annexb_to_avcc_sample(&annexb);
        assert_eq!(back, avcc);
    }

    #[test]
    fn avcc_conversion_rejects_truncation() {
        let bogus = [0, 0, 0, 200, 1, 2, 3];
        let mut out = Vec::new();
        assert!(avcc_sample_to_annexb(&bogus, 4, &mut out).is_err());
    }

    #[test]
    fn blur_preserves_flat_images_and_spreads_impulses() {
        let (w, h) = (16usize, 16usize);
        let mut flat = vec![120u8; w * h * 3];
        let mut scratch = vec![0u8; w * h * 3];
        blur_rgb(&mut flat, &mut scratch, w, h, 6.0);
        assert!(flat.iter().all(|&b| (119..=121).contains(&b)));

        let mut impulse = vec![0u8; w * h * 3];
        let center = (h / 2 * w + w / 2) * 3;
        impulse[center] = 255;
        blur_rgb(&mut impulse, &mut scratch, w, h, 3.0);
        assert!(impulse[center] < 40, "impulse should have spread");
        assert!(
            impulse[center - 3] > 0 || impulse[center + 3] > 0,
            "neighbours should have picked up energy"
        );
    }

    #[test]
    fn dim_matches_the_image_filter_arithmetic() {
        let mut buf = vec![200u8; 12];
        dim_rgb(&mut buf, 0.5);
        assert!(buf.iter().all(|&b| b == 100));
    }

    #[test]
    fn bake_dimensions_fit_and_stay_even() {
        assert_eq!(bake_dimensions(1920, 1080), (960, 540));
        assert_eq!(bake_dimensions(640, 360), (640, 360));
        assert_eq!(bake_dimensions(641, 361), (640, 360));
        assert_eq!(bake_dimensions(3840, 1600), (960, 400));
    }

    /// The first SPS and PPS NAL units in `annexb`, written into `sps`/`pps`
    /// if not already found.
    fn collect_sps_pps(annexb: &[u8], sps: &mut Vec<u8>, pps: &mut Vec<u8>) {
        for nal in split_annexb(annexb) {
            match nal_type(nal) {
                NAL_SPS if sps.is_empty() => *sps = nal.to_vec(),
                NAL_PPS if pps.is_empty() => *pps = nal.to_vec(),
                _ => {}
            }
        }
    }

    /// Encode `frames` moving-gradient frames at `w`x`h` into an H.264 MP4,
    /// exercising the same mux path the bake uses.
    fn write_test_clip(path: &Path, w: usize, h: usize, frames: u32) {
        let config = EncoderConfig::new()
            .max_frame_rate(openh264::encoder::FrameRate::from_hz(30.0))
            .skip_frames(false);
        let mut encoder =
            Encoder::with_api_config(OpenH264API::from_source(), config).expect("encoder");

        let mut sps = Vec::new();
        let mut pps = Vec::new();
        let mut samples = Vec::new();
        for i in 0..frames {
            let mut rgb = vec![0u8; w * h * 3];
            for row in 0..h {
                for col in 0..w {
                    let p = (row * w + col) * 3;
                    rgb[p] = ((col * 2 + i as usize * 8) % 256) as u8;
                    rgb[p + 1] = ((row * 2) % 256) as u8;
                    rgb[p + 2] = 180;
                }
            }
            let yuv = YUVBuffer::from_vec(rgb_to_i420(&rgb, w, h), w, h);
            let bitstream = encoder
                .encode_at(&yuv, Timestamp::from_millis(u64::from(i) * 33))
                .expect("encode");
            let annexb = bitstream.to_vec();
            if sps.is_empty() {
                collect_sps_pps(&annexb, &mut sps, &mut pps);
            }
            let keyframe = matches!(bitstream.frame_type(), FrameType::IDR | FrameType::I);
            samples.push((annexb_to_avcc_sample(&annexb), keyframe));
        }

        let out = std::fs::File::create(path).expect("create clip");
        let mut writer = Mp4Writer::write_start(
            BufWriter::new(out),
            &Mp4Config {
                major_brand: str::parse("isom").expect("brand"),
                minor_version: 512,
                compatible_brands: vec![str::parse("isom").expect("brand")],
                timescale: 1000,
            },
        )
        .expect("writer");
        writer
            .add_track(&TrackConfig {
                track_type: TrackType::Video,
                timescale: 1000,
                language: "und".to_owned(),
                media_conf: MediaConfig::AvcConfig(AvcConfig {
                    width: w as u16,
                    height: h as u16,
                    seq_param_set: sps,
                    pic_param_set: pps,
                }),
            })
            .expect("track");
        for (i, (bytes, keyframe)) in samples.iter().enumerate() {
            writer
                .write_sample(
                    1,
                    &Mp4Sample {
                        start_time: i as u64 * 33,
                        duration: 33,
                        rendering_offset: 0,
                        is_sync: *keyframe,
                        bytes: bytes.clone().into(),
                    },
                )
                .expect("sample");
        }
        writer.write_end().expect("end");
    }

    /// Average brightness of the first decodable frame of an MP4.
    fn first_frame_brightness(path: &Path) -> f64 {
        let file = std::fs::File::open(path).expect("open");
        let size = file.metadata().expect("stat").len();
        let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size).expect("header");
        let mut track = open_video_track(&mut reader).expect("track");
        let mut brightness = None;
        let _ = decode_frames(&mut reader, &mut track, |_, frame| {
            let (w, h) = frame.dimensions();
            let mut rgb = vec![0u8; w * h * 3];
            frame.write_rgb8(&mut rgb);
            brightness = Some(rgb.iter().map(|&b| f64::from(b)).sum::<f64>() / rgb.len() as f64);
            Ok(false)
        })
        .expect("decode");
        brightness.expect("no frame decoded")
    }

    #[test]
    fn bake_roundtrip_blurs_dims_and_keeps_every_frame() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input = dir.path().join("clip.mp4");
        let output = dir.path().join("baked.mp4");
        write_test_clip(&input, 128, 72, 20);

        let mut reports = Vec::new();
        bake_video(&input, &output, 6.0, 0.4, |done, total| {
            reports.push((done, total));
        })
        .expect("bake");

        // The output is a decodable H.264 MP4 with the same frame count.
        let file = std::fs::File::open(&output).expect("open baked");
        let size = file.metadata().expect("stat").len();
        let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size).expect("header");
        let mut track = open_video_track(&mut reader).expect("baked has an H.264 track");
        assert_eq!(track.sample_count, 20);

        let mut decoded = 0usize;
        let _ = decode_frames(&mut reader, &mut track, |_, frame| {
            let (w, h) = frame.dimensions();
            assert_eq!((w, h), (128, 72), "small sources keep their size");
            decoded += 1;
            Ok(true)
        })
        .expect("decode baked");
        assert_eq!(decoded, 20, "the bake is frame-for-frame");

        // The dim is in the pixels: the baked clip is darker than the source.
        let before = first_frame_brightness(&input);
        let after = first_frame_brightness(&output);
        assert!(
            after < before * 0.75,
            "dim 0.4 should darken markedly (before {before:.1}, after {after:.1})"
        );

        // Progress reported and finished at the end.
        assert_eq!(reports.last(), Some(&(20, 20)));
    }

    #[test]
    fn bake_downscales_large_sources() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input = dir.path().join("clip.mp4");
        let output = dir.path().join("baked.mp4");
        write_test_clip(&input, 1280, 720, 4);

        bake_video(&input, &output, 0.0, 0.0, |_, _| {}).expect("bake");

        let file = std::fs::File::open(&output).expect("open baked");
        let size = file.metadata().expect("stat").len();
        let mut reader = mp4::Mp4Reader::read_header(BufReader::new(file), size).expect("header");
        let mut track = open_video_track(&mut reader).expect("track");
        let _ = decode_frames(&mut reader, &mut track, |_, frame| {
            assert_eq!(frame.dimensions(), (960, 540));
            Ok(false)
        })
        .expect("decode");
    }

    #[test]
    fn poster_is_a_jpeg_of_the_early_clip() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input = dir.path().join("clip.mp4");
        write_test_clip(&input, 128, 72, 8);

        let jpeg = extract_poster(&input).expect("poster");
        assert_eq!(&jpeg[..2], &[0xFF, 0xD8], "JPEG magic");
        let decoded = image::load_from_memory(&jpeg).expect("decodable");
        assert_eq!((decoded.width(), decoded.height()), (128, 72));
    }

    #[test]
    fn non_h264_input_is_refused_with_a_reason() {
        let dir = tempfile::tempdir().expect("tempdir");
        let input = dir.path().join("not-a-video.mp4");
        std::fs::write(&input, b"not an mp4 at all").expect("write");
        let err = extract_poster(&input).expect_err("must fail");
        assert!(err.contains("MP4"), "unhelpful error: {err}");
    }
}
