//! Env-gated virtual microphone for the e2e suite.
//!
//! `FANCY_E2E_VIRTUAL_MIC="sine:<rate_hz>:<freq_hz>"` replaces the hardware
//! capture backend with a wall-clock-paced sine generator running at an
//! arbitrary (fractional allowed) sample rate, e.g. `sine:44100:440` or
//! `sine:192000:440`.
//!
//! The generator produces samples at exactly `rate_hz` per wall-clock
//! second and feeds them through the SAME [`StreamResampler`] the real
//! capture backends use, so the whole non-48 kHz contract is exercised
//! end-to-end: pacing, resampling, 10 ms framing, Opus encoding and the
//! wire `frame_number` units. This is the regression surface for the
//! "non-48 kHz mics sound laggy/out-of-sync on official clients" bug -
//! a real kernel-level virtual audio device would need a driver install
//! and cannot run in CI.

use std::collections::VecDeque;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::Instant;

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::resampler::StreamResampler;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};

/// Env var selecting the virtual microphone (`sine:<rate>:<freq>`).
pub const ENV_VIRTUAL_MIC: &str = "FANCY_E2E_VIRTUAL_MIC";

/// Peak amplitude of the generated tone. Loud enough to open the noise
/// gate reliably, far from clipping so AGC/filters stay linear.
const AMPLITUDE: f64 = 0.4;

/// Input samples generated per batch fed to the resampler.
const GEN_BATCH: usize = 1024;

/// A wall-clock-paced sine tone masquerading as a microphone at an
/// arbitrary sample rate, resampled to the pipeline's 48 kHz.
pub struct VirtualSineCapture {
    /// Nominal device rate in Hz (fractional supported).
    rate: f64,
    /// Tone frequency in Hz.
    freq: f64,
    frame_size: usize,
    sequence: u64,
    volume: Arc<AtomicU32>,
    /// Wall-clock anchor; `Some` while started.
    started: Option<Instant>,
    /// Input samples generated so far (at `rate`).
    generated: u64,
    /// Sine phase in radians, wrapped each cycle.
    phase: f64,
    resampler: StreamResampler,
    /// Resampled 48 kHz samples awaiting frame assembly.
    out: VecDeque<f32>,
    /// Scratch batch buffer.
    batch: Vec<f32>,
}

impl std::fmt::Debug for VirtualSineCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VirtualSineCapture")
            .field("rate", &self.rate)
            .field("freq", &self.freq)
            .field("frame_size", &self.frame_size)
            .finish_non_exhaustive()
    }
}

impl VirtualSineCapture {
    /// Parse a `sine:<rate>:<freq>` spec into a capture instance.
    pub fn from_spec(
        spec: &str,
        frame_size: usize,
        volume: Arc<AtomicU32>,
    ) -> std::result::Result<Self, String> {
        let mut parts = spec.split(':');
        let kind = parts.next().unwrap_or_default();
        if kind != "sine" {
            return Err(format!("unsupported virtual mic kind '{kind}' (expected 'sine')"));
        }
        let rate: f64 = parts
            .next()
            .ok_or("missing rate in FANCY_E2E_VIRTUAL_MIC")?
            .parse()
            .map_err(|e| format!("bad rate: {e}"))?;
        let freq: f64 = parts
            .next()
            .ok_or("missing frequency in FANCY_E2E_VIRTUAL_MIC")?
            .parse()
            .map_err(|e| format!("bad frequency: {e}"))?;
        let resampler = StreamResampler::new(rate, 48_000.0).map_err(|e| e.to_string())?;
        tracing::warn!("e2e virtual mic active: {rate} Hz sine at {freq} Hz");
        Ok(Self {
            rate,
            freq,
            frame_size,
            sequence: 0,
            volume,
            started: None,
            generated: 0,
            phase: 0.0,
            resampler,
            out: VecDeque::with_capacity(4 * frame_size),
            batch: Vec::with_capacity(GEN_BATCH),
        })
    }

    /// Generate input samples up to the wall-clock due count and resample.
    fn pump(&mut self) {
        let Some(started) = self.started else { return };
        let due = (started.elapsed().as_secs_f64() * self.rate) as u64;
        let step = 2.0 * std::f64::consts::PI * self.freq / self.rate;
        while self.generated < due {
            let n = ((due - self.generated) as usize).min(GEN_BATCH);
            self.batch.clear();
            for _ in 0..n {
                self.batch.push((self.phase.sin() * AMPLITUDE) as f32);
                self.phase += step;
                if self.phase > 2.0 * std::f64::consts::PI {
                    self.phase -= 2.0 * std::f64::consts::PI;
                }
            }
            self.generated += n as u64;
            let mut produced = Vec::new();
            self.resampler.process_into(&self.batch, &mut produced);
            self.out.extend(produced);
        }
    }
}

impl AudioCapture for VirtualSineCapture {
    fn format(&self) -> AudioFormat {
        AudioFormat::MONO_48KHZ_F32
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        if self.started.is_none() {
            return Err(Error::InvalidState("virtual mic not started".into()));
        }
        self.pump();
        if self.out.len() < self.frame_size {
            return Err(Error::NotEnoughSamples);
        }
        let vol = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for _ in 0..self.frame_size {
            let s = self.out.pop_front().unwrap_or(0.0);
            data.extend_from_slice(&(s * vol).to_ne_bytes());
        }
        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        self.started = Some(Instant::now());
        self.generated = 0;
        self.phase = 0.0;
        self.out.clear();
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.started = None;
        self.out.clear();
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn parses_spec_and_rejects_garbage() {
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        assert!(VirtualSineCapture::from_spec("sine:44100:440", 480, vol.clone()).is_ok());
        assert!(VirtualSineCapture::from_spec("sine:123456.78:440", 480, vol.clone()).is_ok());
        assert!(VirtualSineCapture::from_spec("square:44100:440", 480, vol.clone()).is_err());
        assert!(VirtualSineCapture::from_spec("sine:abc:440", 480, vol.clone()).is_err());
        assert!(VirtualSineCapture::from_spec("sine:44100", 480, vol).is_err());
    }

    #[test]
    fn paces_output_to_wall_clock_at_48k() {
        // 200 ms of wall time must yield ~200 ms of 48 kHz audio (+- one
        // frame + filter delay), regardless of the virtual device rate.
        for spec in ["sine:44100:440", "sine:192000:440"] {
            let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
            let mut cap = VirtualSineCapture::from_spec(spec, 480, vol).unwrap();
            cap.start().unwrap();
            let t0 = Instant::now();
            let mut frames = 0u32;
            while t0.elapsed().as_millis() < 200 {
                match cap.read_frame() {
                    Ok(_) => frames += 1,
                    Err(Error::NotEnoughSamples) => std::thread::sleep(std::time::Duration::from_millis(2)),
                    Err(e) => panic!("read_frame: {e}"),
                }
            }
            // ~20 frames of 10 ms in 200 ms; allow generous slack for CI.
            assert!(
                (14..=24).contains(&frames),
                "{spec}: got {frames} frames in 200 ms (expected ~20)"
            );
        }
    }
}
