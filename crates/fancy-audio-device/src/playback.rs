//! Cpal-based multi-speaker mixing playback implementing [`MixingPlayback`].

use std::collections::{HashMap, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Arc;

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use tracing::{error, warn};

use mumble_protocol::audio::mixer::{SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::audio::playback::{soft_clip, MixingPlayback};
use mumble_protocol::error::{Error, Result};

/// Batch-drain up to `mono_needed` samples from every active speaker
/// into `mixed_buf` (summed/mixed).
///
/// Per-speaker volume is applied from `speaker_vols` (0.0-2.0,
/// defaulting to 1.0 when absent).
///
/// Returns `(had_data, valid_count, max_buf_before)`: whether any
/// speaker contributed, the number of valid mixed samples (max drained
/// from any single speaker), and the maximum buffer level across all
/// speakers before draining.  Positions beyond `valid_count` in
/// `mixed_buf` are zero and should be treated as underrun by the caller.
pub fn batch_drain_speakers(
    bufs: &mut HashMap<u32, VecDeque<f32>>,
    speaker_vols: &HashMap<u32, f32>,
    mixed_buf: &mut Vec<f32>,
    mono_needed: usize,
) -> (bool, usize, usize) {
    mixed_buf.clear();
    mixed_buf.resize(mono_needed, 0.0_f32);
    let mut any = false;
    let mut max_drained: usize = 0;
    let mut max_buf_before: usize = 0;

    for (session, buf) in bufs.iter_mut() {
        if buf.is_empty() {
            continue;
        }
        any = true;
        max_buf_before = max_buf_before.max(buf.len());
        let vol = speaker_vols.get(session).copied().unwrap_or(1.0);
        let n = buf.len().min(mono_needed);
        max_drained = max_drained.max(n);
        let (a, b) = buf.as_slices();
        let from_a = n.min(a.len());
        for (dst, src) in mixed_buf[..from_a].iter_mut().zip(&a[..from_a]) {
            *dst += *src * vol;
        }
        if from_a < n {
            let from_b = n - from_a;
            for (dst, src) in mixed_buf[from_a..n].iter_mut().zip(&b[..from_b]) {
                *dst += *src * vol;
            }
        }
        let _ = buf.drain(..n);
    }

    (any, max_drained, max_buf_before)
}

/// Multi-speaker mixing playback backed by cpal.
///
/// Instead of receiving frames via `write_frame`, this device reads
/// decoded samples directly from per-speaker ring buffers (managed by
/// [`AudioMixer`](mumble_protocol::audio::mixer::AudioMixer)) and sums
/// them in the cpal output callback.
pub struct CpalMixingPlayback {
    stream: Option<cpal::Stream>,
    device: cpal::Device,
    volume: Arc<AtomicU32>,
    buffers: SpeakerBuffers,
    speaker_volumes: SpeakerVolumes,
}

/// Mutable per-callback underrun tracking state for [`CpalMixingPlayback`].
struct PlaybackState {
    last_sample: f32,
    in_underrun: bool,
    ramp_pos: usize,
    underrun_samples: usize,
}

/// Try to drain speaker buffers into `mixed_buf`. Returns
/// `Some((had_data, valid_count, buf_depth))` on success, or `None`
/// when the caller should fill zeros and return early (not yet primed
/// or lock failure).
fn try_drain_speakers_checked(
    buffers: &SpeakerBuffers,
    speaker_volumes: &SpeakerVolumes,
    primed_cb: &AtomicBool,
    mixed_buf: &mut Vec<f32>,
    mono_needed: usize,
) -> Option<(bool, usize, usize)> {
    const PRE_BUFFER_SAMPLES: usize = 4800;
    let Ok(mut bufs) = buffers.lock() else { return None };
    if !primed_cb.load(Ordering::Relaxed) {
        let max_available = bufs.values().map(VecDeque::len).max().unwrap_or(0);
        if max_available < PRE_BUFFER_SAMPLES {
            return None;
        }
        primed_cb.store(true, Ordering::Relaxed);
    }
    // try_lock avoids blocking the real-time audio thread on a second
    // mutex; on contention we fall back to default volumes (1.0).
    // Borrow the guard instead of cloning the HashMap - this runs on
    // every output callback and a clone would allocate each time.
    let sv_guard = speaker_volumes.try_lock().ok();
    let empty = HashMap::new();
    let sv = sv_guard.as_deref().unwrap_or(&empty);
    Some(batch_drain_speakers(&mut bufs, sv, mixed_buf, mono_needed))
}

/// Apply a short anti-pop ramp when exiting an underrun, then return
/// the output sample. Updates `state` in-place.
fn apply_underrun_ramp(sample: f32, state: &mut PlaybackState) -> f32 {
    if !state.in_underrun {
        return sample;
    }
    const MAX_RAMP: usize = 48; // 1 ms at 48 kHz
    let ramp_len = state.underrun_samples.clamp(8, MAX_RAMP);
    state.ramp_pos += 1;
    if state.ramp_pos >= ramp_len {
        state.in_underrun = false;
        state.ramp_pos = 0;
        state.underrun_samples = 0;
        sample
    } else {
        let t = state.ramp_pos as f32 / ramp_len as f32;
        // Simple linear crossfade from last held value to new audio.
        state.last_sample * (1.0 - t) + sample * t
    }
}

/// Linearly interpolate one sample from `mixed_buf` at the fractional
/// position given by `out_index * src_ratio`. Returns `None` if the
/// computed source index falls outside `valid_count`.
fn resample_linear(
    mixed_buf: &[f32],
    valid_count: usize,
    drained: bool,
    out_index: usize,
    src_ratio: f64,
) -> Option<f32> {
    if !drained {
        return None;
    }
    let src_pos = out_index as f64 * src_ratio;
    let idx = src_pos as usize;
    if idx >= valid_count {
        return None;
    }
    let frac = (src_pos - idx as f64) as f32;
    let s0 = mixed_buf[idx];
    let s1 = if idx + 1 < valid_count { mixed_buf[idx + 1] } else { s0 };
    Some(s0 + (s1 - s0) * frac)
}

/// Write one output frame (mono sample duplicated to all channels) with
/// volume, underrun decay, and anti-pop ramp. Updates `state` in-place.
fn write_output_frame(
    frame: &mut [f32],
    sample_opt: Option<f32>,
    state: &mut PlaybackState,
    vol: f32,
) {
    const DECAY: f32 = 0.997;
    if let Some(raw) = sample_opt {
        let out = apply_underrun_ramp(raw, state);
        state.last_sample = out;
        let v = soft_clip(out * vol);
        for ch in frame.iter_mut() {
            *ch = v;
        }
    } else {
        state.in_underrun = true;
        state.ramp_pos = 0;
        state.underrun_samples += 1;
        state.last_sample *= DECAY;
        if state.last_sample.abs() < 1e-6 {
            state.last_sample = 0.0;
        }
        let v = soft_clip(state.last_sample * vol);
        for ch in frame.iter_mut() {
            *ch = v;
        }
    }
}

impl std::fmt::Debug for CpalMixingPlayback {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("CpalMixingPlayback").finish_non_exhaustive()
    }
}

// SAFETY: See CpalCapture.
#[allow(unsafe_code, reason = "WASAPI COM objects are MTA-safe; cpal's !Send is a conservative cross-platform guard")]
unsafe impl Send for CpalMixingPlayback {}

impl CpalMixingPlayback {
    /// Create a new mixing playback device.
    ///
    /// * `device_name` - choose a specific output device, or `None` for default.
    /// * `volume` - shared atomic master output volume (`f32` bits as `u32`).
    /// * `buffers` - per-speaker sample buffers written by the mixer.
    /// * `speaker_volumes` - per-speaker volume overrides read while mixing.
    pub fn new(
        device_name: Option<&str>,
        volume: Arc<AtomicU32>,
        buffers: SpeakerBuffers,
        speaker_volumes: SpeakerVolumes,
    ) -> Result<Self> {
        let host = cpal::default_host();
        let device = if let Some(name) = device_name {
            host.output_devices()
                .map_err(|e| Error::InvalidState(e.to_string()))?
                .find(|d| {
                    d.description()
                        .ok()
                        .map(|desc| desc.name() == name)
                        .unwrap_or(false)
                })
                .ok_or_else(|| Error::InvalidState(format!("Output device not found: {name}")))?
        } else {
            host.default_output_device()
                .ok_or_else(|| Error::InvalidState("No default output device".into()))?
        };

        Ok(Self {
            stream: None,
            device,
            volume,
            buffers,
            speaker_volumes,
        })
    }
}

/// Diagnostic counters for the playback callback, logged periodically.
struct CallbackDiag {
    callbacks: u64,
    underrun: u64,
    partial: u64,
    none: u64,
    peak: f32,
    buf_depth: usize,
}

impl CallbackDiag {
    fn log_if_due(&self, src_needed: usize, valid_count: usize, out_frames: usize, src_ratio: f64) {
        if self.callbacks.is_multiple_of(500) {
            warn!(
                "audio diag: cb={}, none={}, underrun={}, partial={}, \
                 src_needed={}, valid={}, out_frames={}, ratio={:.4}, \
                 peak={:.4}, buf={}",
                self.callbacks, self.none, self.underrun, self.partial,
                src_needed, valid_count, out_frames, src_ratio,
                self.peak, self.buf_depth,
            );
        }
    }
}

impl MixingPlayback for CpalMixingPlayback {
    fn start(&mut self) -> Result<()> {
        let buffers = self.buffers.clone();
        let volume = self.volume.clone();
        let speaker_volumes = self.speaker_volumes.clone();

        // Query the device's preferred output format. On WASAPI shared
        // mode the system mixer rate is fixed; hardcoding 48 kHz when
        // the device runs at a different rate causes the callback to
        // fire at the native rate while we feed 48 kHz data, starving
        // the speaker buffers.
        let default_config = self
            .device
            .default_output_config()
            .map_err(|e| Error::InvalidState(format!("output config query: {e}")))?;
        let device_rate = default_config.sample_rate();
        let device_channels = default_config.channels();

        warn!(
            "cpal output device: rate={} Hz, channels={}, format={:?}",
            device_rate, device_channels, default_config.sample_format()
        );

        let stream_config = cpal::StreamConfig {
            channels: device_channels,
            sample_rate: device_rate,
            buffer_size: cpal::BufferSize::Default,
        };

        // Source-to-output sample ratio for resampling.
        // < 1.0 when the device rate exceeds 48 kHz (upsampling).
        let src_ratio: f64 = 48_000.0 / device_rate as f64;
        let out_channels = device_channels as usize;

        let primed = Arc::new(AtomicBool::new(false));
        let primed_cb = primed;

        let mut diag = CallbackDiag { callbacks: 0, underrun: 0, partial: 0, none: 0, peak: 0.0, buf_depth: 0 };
        let mut pb_state = PlaybackState {
            last_sample: 0.0,
            in_underrun: false,
            ramp_pos: 0,
            underrun_samples: 0,
        };
        let mut mixed_buf: Vec<f32> = Vec::new();
        let mut consecutive_empty: u32 = 0;

        let stream = self
            .device
            .build_output_stream(
                &stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    let vol = f32::from_bits(volume.load(Ordering::Relaxed));
                    let out_frames = data.len() / out_channels;
                    let src_needed = ((out_frames as f64 * src_ratio).ceil() as usize).max(1);

                    diag.callbacks += 1;

                    let drain_result = try_drain_speakers_checked(
                        &buffers,
                        &speaker_volumes,
                        &primed_cb,
                        &mut mixed_buf,
                        src_needed,
                    );
                    let Some((drained, valid_count, buf_depth)) = drain_result else {
                        diag.none += 1;
                        for frame in data.chunks_exact_mut(out_channels) {
                            write_output_frame(frame, None, &mut pb_state, vol);
                        }
                        return;
                    };
                    diag.buf_depth = buf_depth;

                    if !drained || valid_count == 0 {
                        diag.underrun += 1;
                        consecutive_empty += 1;
                        // Only reprime after sustained silence (1.5 s).
                        // Natural speech pauses (100-500 ms) are absorbed
                        // by the buffer; repriming during those pauses
                        // would introduce ~100 ms audible gaps.
                        const REPRIME_AFTER: u32 = 150;
                        if consecutive_empty >= REPRIME_AFTER {
                            primed_cb.store(false, Ordering::Relaxed);
                        }
                    } else {
                        consecutive_empty = 0;
                        if valid_count < src_needed {
                            diag.partial += 1;
                        }
                    }
                    diag.log_if_due(src_needed, valid_count, out_frames, src_ratio);

                    for (i, frame) in data.chunks_exact_mut(out_channels).enumerate() {
                        let sample_opt = resample_linear(&mixed_buf, valid_count, drained, i, src_ratio);
                        if let Some(s) = &sample_opt {
                            diag.peak = diag.peak.max(s.abs());
                        }
                        write_output_frame(frame, sample_opt, &mut pb_state, vol);
                    }
                },
                |err| error!("cpal mixing output error: {err}"),
                None,
            )
            .map_err(|e| Error::InvalidState(e.to_string()))?;

        stream
            .play()
            .map_err(|e| Error::InvalidState(e.to_string()))?;

        self.stream = Some(stream);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.stream = None;
        if let Ok(mut bufs) = self.buffers.lock() {
            bufs.clear();
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, unused_results, reason = "acceptable in test code")]
    use super::*;

    #[test]
    fn batch_drain_sums_multiple_speakers() {
        let mut bufs = HashMap::new();
        bufs.insert(1u32, VecDeque::from(vec![0.5_f32; 10]));
        bufs.insert(2, VecDeque::from(vec![0.25; 10]));
        let speaker_vols: HashMap<u32, f32> = HashMap::new();
        let mut mixed = Vec::new();

        let (had, valid, _depth) = batch_drain_speakers(&mut bufs, &speaker_vols, &mut mixed, 10);
        assert!(had);
        assert_eq!(valid, 10);
        assert_eq!(mixed.len(), 10);
        for &s in &mixed {
            assert!((s - 0.75).abs() < 1e-6, "expected 0.75, got {s}");
        }
    }

    #[test]
    fn batch_drain_empty_returns_false() {
        let mut bufs: HashMap<u32, VecDeque<f32>> = HashMap::new();
        let speaker_vols: HashMap<u32, f32> = HashMap::new();
        let mut mixed = Vec::new();
        assert!(!batch_drain_speakers(&mut bufs, &speaker_vols, &mut mixed, 10).0);
    }

    #[test]
    fn resample_linear_identity_at_ratio_one() {
        let buf = vec![0.0, 0.25, 0.5, 0.75, 1.0];
        for i in 0..5 {
            let s = resample_linear(&buf, 5, true, i, 1.0).unwrap();
            assert!((s - buf[i]).abs() < 1e-6, "index {i}: expected {}, got {s}", buf[i]);
        }
    }
}
