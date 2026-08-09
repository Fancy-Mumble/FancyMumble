//! Env-gated virtual microphone for the e2e suite.
//!
//! `FANCY_E2E_VIRTUAL_MIC="sine:<rate_hz>:<freq_hz>"` replaces the hardware
//! capture backend with a wall-clock-paced sine generator running at an
//! arbitrary (fractional allowed) sample rate, e.g. `sine:44100:440` or
//! `sine:192000:440`.
//!
//! A trailing `+noise:<amp>` mixes deterministic broadband noise under the
//! tone - `sine:48000:440+noise:0.10`. That is what makes a **denoiser**
//! measurable end to end: a pure tone gives noise suppression nothing to
//! remove, so a suite built only on the spec above cannot tell a working
//! denoiser from one that was never linked in.
//!
//! Set the amplitude to make the noise the *whole* signal
//! (`sine:48000:440+noise:0.10` with a tone the denoiser will attenuate
//! anyway) or keep the tone as a carrier the far end can still lock onto.
//!
//! `FANCY_E2E_VIRTUAL_MIC="file:<path>[:<rate_hz>]"` plays a mono 16-bit
//! WAV instead, looping it for as long as capture runs.
//!
//! # Why a file source exists next to the generator
//!
//! A tone is the easiest signal every stage downstream will ever see, and
//! a suite built only on one cannot distinguish a pipeline that carries
//! speech from one that mangles it:
//!
//! * **Opus picks its mode from the content.** A steady tone steers the
//!   encoder toward CELT; SILK's LPC/LTP path - the one actual speech
//!   goes through - may never execute, so a fault confined to it is
//!   invisible.
//! * **A tone never stops.** Real speech is roughly half silence, so
//!   discontinuous transmission and every "resumes after a pause" path
//!   are untested by a continuous generator.
//! * **A noise gate is judged on onsets.** Plosives and trailing
//!   fricatives are what a gate clips, and a constant tone has neither.
//! * **A denoiser tuned for speech is being measured on a tone**, which
//!   is the opposite of its design target: it can be shredding real
//!   voice and still score well against `+noise`.
//!
//! The tone also makes for a weak oracle at the far end. A dominant-bin
//! ratio survives clipping, wrong gain, short dropouts and resampler
//! aliasing - it answers "something tonal arrived", not "this is
//! intelligible". A file source lets the far end be compared against the
//! very samples that were fed in.
//!
//! Both sources produce samples at exactly `rate_hz` per wall-clock
//! second and feed them through the SAME [`StreamResampler`] the real
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

/// Where a virtual microphone's samples come from.
///
/// Split out so the pacing, resampling and framing below - which is the part
/// that actually mirrors a real capture backend, and the part worth getting
/// right once - is shared by every source. A source only has to answer "the
/// next `n` samples, please".
trait SampleSource: Send {
    /// Append exactly `n` samples in `[-1.0, 1.0]` to `out`.
    ///
    /// Must always produce `n`: the caller has already decided that many are
    /// due by wall clock, and a short read would silently slow the device
    /// down rather than report anything.
    fn fill(&mut self, out: &mut Vec<f32>, n: usize);

    /// Return to the beginning, for a capture that is being restarted.
    fn rewind(&mut self);

    /// What this source is, for the log line that says the mic is virtual.
    fn describe(&self) -> String;
}

/// A sine tone, optionally with deterministic broadband noise under it.
struct SineSource {
    rate: f64,
    freq: f64,
    /// Peak amplitude of broadband noise mixed under the tone, `0.0` for
    /// none. What gives a denoiser something to actually remove.
    noise_amp: f64,
    /// Deterministic noise generator state.
    ///
    /// A fixed LCG rather than a random source: an e2e assertion about how
    /// much noise survived needs the same noise every run, or the day it
    /// fails nobody can reproduce it.
    noise_state: u32,
    /// Sine phase in radians, wrapped each cycle.
    phase: f64,
}

impl SineSource {
    /// The next deterministic noise sample in `[-noise_amp, noise_amp]`.
    fn next_noise(&mut self) -> f64 {
        if self.noise_amp == 0.0 {
            return 0.0;
        }
        self.noise_state = self
            .noise_state
            .wrapping_mul(1_664_525)
            .wrapping_add(1_013_904_223);
        (f64::from(self.noise_state >> 8) / 8_388_608.0 - 1.0) * self.noise_amp
    }
}

impl SampleSource for SineSource {
    fn fill(&mut self, out: &mut Vec<f32>, n: usize) {
        let step = 2.0 * std::f64::consts::PI * self.freq / self.rate;
        for _ in 0..n {
            let noise = self.next_noise();
            out.push((self.phase.sin() * AMPLITUDE + noise) as f32);
            self.phase += step;
            if self.phase > 2.0 * std::f64::consts::PI {
                self.phase -= 2.0 * std::f64::consts::PI;
            }
        }
    }

    fn rewind(&mut self) {
        self.phase = 0.0;
        self.noise_state = 0x2545_F491;
    }

    fn describe(&self) -> String {
        format!("{} Hz sine, noise {}", self.freq, self.noise_amp)
    }
}

/// A WAV file, looped for as long as capture runs.
///
/// Read into memory once rather than streamed from disk. A capture backend is
/// called on the audio thread every 10 ms, and a file read there is a syscall
/// on the one path in this program that must never block - the same reason the
/// real backends hand over a pre-filled buffer. Test fixtures are seconds long,
/// so the whole thing is a few hundred kilobytes.
///
/// **Looped, not padded with silence.** The far-end assertion compares what
/// arrived against the source, and it needs the source to still be playing when
/// it starts listening; a file that ran out would be indistinguishable from a
/// pipeline that stopped carrying audio.
struct FileSource {
    /// The decoded file, mono, in `[-1.0, 1.0]`.
    samples: Arc<[f32]>,
    /// Read cursor, wrapping at the end.
    at: usize,
    path: String,
}

impl FileSource {
    /// Decode a mono or multi-channel 16-bit PCM WAV into mono samples.
    ///
    /// Channels are averaged rather than taking the first: a stereo fixture
    /// with one silent channel is a real thing to be handed, and taking
    /// channel 0 would turn it into silence with no error anywhere.
    fn load(path: &str) -> std::result::Result<Self, String> {
        let mut reader =
            hound::WavReader::open(path).map_err(|e| format!("cannot read {path}: {e}"))?;
        let spec = reader.spec();
        let channels = usize::from(spec.channels).max(1);

        // Read as f32 whatever the file holds, so a fixture regenerated as
        // float does not silently decode to zeros.
        let interleaved: Vec<f32> = match spec.sample_format {
            hound::SampleFormat::Float => reader
                .samples::<f32>()
                .collect::<std::result::Result<_, _>>()
                .map_err(|e| format!("bad float samples in {path}: {e}"))?,
            hound::SampleFormat::Int => {
                let full = f32::from(i16::MAX);
                reader
                    .samples::<i32>()
                    .map(|s| s.map(|v| v as f32 / full))
                    .collect::<std::result::Result<_, _>>()
                    .map_err(|e| format!("bad integer samples in {path}: {e}"))?
            }
        };

        let samples: Vec<f32> = interleaved
            .chunks(channels)
            .map(|frame| frame.iter().sum::<f32>() / frame.len() as f32)
            .collect();
        if samples.is_empty() {
            return Err(format!("{path} contains no audio"));
        }
        Ok(Self {
            samples: samples.into(),
            at: 0,
            path: path.to_owned(),
        })
    }
}

impl SampleSource for FileSource {
    fn fill(&mut self, out: &mut Vec<f32>, n: usize) {
        for _ in 0..n {
            out.push(self.samples[self.at]);
            self.at = (self.at + 1) % self.samples.len();
        }
    }

    fn rewind(&mut self) {
        self.at = 0;
    }

    fn describe(&self) -> String {
        format!("{} ({} samples, looped)", self.path, self.samples.len())
    }
}

/// A wall-clock-paced synthetic microphone at an arbitrary sample rate,
/// resampled to the pipeline's 48 kHz.
///
/// Named for what it is rather than for its first source: it plays a tone or a
/// file, and the pacing and resampling around them are identical.
pub struct VirtualCapture {
    /// Nominal device rate in Hz (fractional supported).
    rate: f64,
    /// Where the samples come from.
    source: Box<dyn SampleSource>,
    frame_size: usize,
    sequence: u64,
    volume: Arc<AtomicU32>,
    /// Wall-clock anchor; `Some` while started.
    started: Option<Instant>,
    /// Input samples generated so far (at `rate`).
    generated: u64,
    resampler: StreamResampler,
    /// Resampled 48 kHz samples awaiting frame assembly.
    out: VecDeque<f32>,
    /// Scratch batch buffer.
    batch: Vec<f32>,
}

impl std::fmt::Debug for VirtualCapture {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VirtualCapture")
            .field("rate", &self.rate)
            .field("source", &self.source.describe())
            .field("frame_size", &self.frame_size)
            .finish_non_exhaustive()
    }
}

impl VirtualCapture {
    /// Parse a `sine:<rate>:<freq>[+noise:<amp>]` or `file:<path>[:<rate>]`
    /// spec into a capture instance.
    pub fn from_spec(
        spec: &str,
        frame_size: usize,
        volume: Arc<AtomicU32>,
    ) -> std::result::Result<Self, String> {
        // `file:` is matched before anything is split on `:`, because a
        // Windows path contains one (`file:C:\...\speech.wav`) and splitting
        // first would cut it in half.
        let (rate, source): (f64, Box<dyn SampleSource>) = if let Some(rest) =
            spec.strip_prefix("file:")
        {
            let (path, rate) = split_file_spec(rest)?;
            (rate, Box::new(FileSource::load(path)?))
        } else {
            let (rate, sine) = parse_sine(spec)?;
            (rate, Box::new(sine))
        };

        let resampler = StreamResampler::new(rate, 48_000.0).map_err(|e| e.to_string())?;
        tracing::warn!(
            "e2e virtual mic active: {rate} Hz device, source {}",
            source.describe()
        );
        Ok(Self {
            rate,
            source,
            frame_size,
            sequence: 0,
            volume,
            started: None,
            generated: 0,
            resampler,
            out: VecDeque::with_capacity(4 * frame_size),
            batch: Vec::with_capacity(GEN_BATCH),
        })
    }

    /// Generate input samples up to the wall-clock due count and resample.
    fn pump(&mut self) {
        let Some(started) = self.started else { return };
        let due = (started.elapsed().as_secs_f64() * self.rate) as u64;
        while self.generated < due {
            let n = ((due - self.generated) as usize).min(GEN_BATCH);
            self.batch.clear();
            self.source.fill(&mut self.batch, n);
            self.generated += n as u64;
            let mut produced = Vec::new();
            self.resampler.process_into(&self.batch, &mut produced);
            self.out.extend(produced);
        }
    }
}

/// `<path>[:<rate>]`, where the path may itself contain a drive-letter colon.
///
/// The rate is taken from the trailing field only when it parses as a number,
/// so `file:C:\audio\speech.wav` is a path and not a path plus the rate `\...`.
/// Defaults to 48 kHz, which is what a fixture is normally recorded at and
/// means the common case needs no suffix.
fn split_file_spec(rest: &str) -> std::result::Result<(&str, f64), String> {
    // Nested rather than a let-chain: this crate is not on edition 2024.
    if let Some((path, tail)) = rest.rsplit_once(':') {
        if let Ok(rate) = tail.parse::<f64>() {
            if rate <= 0.0 {
                return Err(format!("file rate {rate} must be positive"));
            }
            return Ok((path, rate));
        }
    }
    Ok((rest, 48_000.0))
}

/// `sine:<rate>:<freq>[+noise:<amp>]`, unchanged in meaning.
fn parse_sine(spec: &str) -> std::result::Result<(f64, SineSource), String> {
    // The noise suffix is split off first so the tone spec keeps
    // parsing exactly as it did - an existing `sine:44100:440` must
    // not start meaning something new.
    let (tone_spec, noise_amp) = match spec.split_once("+noise:") {
        Some((tone, amp)) => (
            tone,
            amp.parse::<f64>()
                .map_err(|e| format!("bad noise amplitude: {e}"))?,
        ),
        None => (spec, 0.0),
    };
    if !(0.0..=1.0).contains(&noise_amp) {
        return Err(format!(
            "noise amplitude {noise_amp} is outside 0.0..=1.0; it is a peak level, not a gain"
        ));
    }

    let mut parts = tone_spec.split(':');
    let kind = parts.next().unwrap_or_default();
    if kind != "sine" {
        return Err(format!(
            "unsupported virtual mic kind '{kind}' (expected 'sine' or 'file')"
        ));
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
    Ok((
        rate,
        SineSource {
            rate,
            freq,
            noise_amp,
            noise_state: 0x2545_F491,
            phase: 0.0,
        },
    ))
}

impl AudioCapture for VirtualCapture {
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
        self.source.rewind();
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
        assert!(VirtualCapture::from_spec("sine:44100:440", 480, vol.clone()).is_ok());
        assert!(VirtualCapture::from_spec("sine:123456.78:440", 480, vol.clone()).is_ok());
        assert!(VirtualCapture::from_spec("square:44100:440", 480, vol.clone()).is_err());
        assert!(VirtualCapture::from_spec("sine:abc:440", 480, vol.clone()).is_err());
        assert!(VirtualCapture::from_spec("sine:44100", 480, vol).is_err());
    }

    #[test]
    fn the_noise_suffix_is_optional_and_validated() {
        // The existing spec must keep meaning exactly what it meant, or
        // every suite already using it starts testing something else.
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let (_, plain) = parse_sine("sine:48000:440").unwrap();
        assert!((plain.noise_amp - 0.0).abs() < f64::EPSILON);

        let (_, noisy) = parse_sine("sine:48000:440+noise:0.1").unwrap();
        assert!((noisy.noise_amp - 0.1).abs() < 1e-9);

        // An amplitude, not a gain: values outside the sample range are a
        // typo, and clamping one would silently test the wrong level.
        assert!(VirtualCapture::from_spec("sine:48000:440+noise:9", 480, vol.clone()).is_err());
        assert!(
            VirtualCapture::from_spec("sine:48000:440+noise:abc", 480, vol.clone()).is_err()
        );
        assert!(VirtualCapture::from_spec("sine:48000:440+noise:-1", 480, vol).is_err());
    }

    #[test]
    fn noise_is_broadband_bounded_and_repeatable() {
        // Repeatable because an assertion about how much noise survived a
        // denoiser needs the same noise every run. Bounded because the
        // sum of tone and noise must not clip.
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let draw = || {
            let (_, mut sine) = parse_sine("sine:48000:440+noise:0.1").unwrap();
            (0..2048).map(|_| sine.next_noise()).collect::<Vec<_>>()
        };
        let _ = &vol;

        let first = draw();
        assert_eq!(first, draw(), "the noise must be identical run to run");
        assert!(first.iter().all(|n| n.abs() <= 0.1 + 1e-9), "out of range");

        // Not a constant, and not silence: mean near zero, real spread.
        let mean = first.iter().sum::<f64>() / first.len() as f64;
        let var = first.iter().map(|n| (n - mean).powi(2)).sum::<f64>() / first.len() as f64;
        assert!(mean.abs() < 0.01, "noise should be centred, mean {mean}");
        assert!(var > 0.001, "noise has no spread, var {var}");
    }

    /// Write a mono 16-bit WAV and return its path.
    fn write_wav(name: &str, rate: u32, samples: &[f32]) -> String {
        let path = std::env::temp_dir().join(name);
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: rate,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for s in samples {
            writer.write_sample((s * f32::from(i16::MAX)) as i16).unwrap();
        }
        writer.finalize().unwrap();
        path.to_string_lossy().into_owned()
    }

    #[test]
    fn a_file_spec_keeps_a_windows_drive_letter_intact() {
        // The trap this splitting exists for. `file:C:\a\b.wav` contains a
        // colon that is part of the path, so splitting on `:` first would ask
        // the loader for `C` and call `\a\b.wav` the sample rate. The rate is
        // only taken from the tail when the tail is actually a number.
        assert_eq!(
            split_file_spec(r"C:\audio\speech.wav").unwrap(),
            (r"C:\audio\speech.wav", 48_000.0)
        );
        assert_eq!(
            split_file_spec(r"C:\audio\speech.wav:44100").unwrap(),
            (r"C:\audio\speech.wav", 44_100.0)
        );
        assert_eq!(
            split_file_spec("/tmp/speech.wav").unwrap(),
            ("/tmp/speech.wav", 48_000.0)
        );
        assert!(split_file_spec("/tmp/speech.wav:0").is_err());
    }

    #[test]
    fn a_file_source_loops_and_reproduces_its_samples() {
        // Looping is load-bearing: the far-end assertion needs the source to
        // still be playing when it starts listening, and a file that ran out
        // would look exactly like a pipeline that stopped carrying audio.
        let path = write_wav("virtmic-loop.wav", 48_000, &[0.5, -0.5, 0.25]);
        let mut source = FileSource::load(&path).unwrap();
        let mut out = Vec::new();
        source.fill(&mut out, 7);

        // Quantised to 16 bits on the way through the file, so compare with a
        // tolerance of one step rather than exactly.
        let step = 1.0 / f32::from(i16::MAX);
        for (got, want) in out.iter().zip([0.5, -0.5, 0.25, 0.5, -0.5, 0.25, 0.5]) {
            assert!((got - want).abs() < 2.0 * step, "got {got}, want {want}");
        }
    }

    #[test]
    fn a_stereo_file_is_averaged_rather_than_half_discarded() {
        // A fixture with one silent channel is a real thing to be handed, and
        // taking channel 0 would turn it into silence with nothing reported.
        let path = std::env::temp_dir().join("virtmic-stereo.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for (l, r) in [(0.0_f32, 0.8_f32), (0.0, 0.4)] {
            writer.write_sample((l * f32::from(i16::MAX)) as i16).unwrap();
            writer.write_sample((r * f32::from(i16::MAX)) as i16).unwrap();
        }
        writer.finalize().unwrap();

        let mut source = FileSource::load(path.to_str().unwrap()).unwrap();
        let mut out = Vec::new();
        source.fill(&mut out, 2);
        assert!(out[0] > 0.3, "a silent left channel must not silence the mic");
        assert!((out[0] - 0.4).abs() < 0.01 && (out[1] - 0.2).abs() < 0.01);
    }

    #[test]
    fn an_unreadable_or_empty_file_is_reported_rather_than_played_as_silence() {
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        assert!(VirtualCapture::from_spec("file:/nope/missing.wav", 480, vol.clone()).is_err());
        let empty = write_wav("virtmic-empty.wav", 48_000, &[]);
        assert!(VirtualCapture::from_spec(&format!("file:{empty}"), 480, vol).is_err());
    }

    #[test]
    fn a_file_mic_paces_to_wall_clock_like_the_generator() {
        // The point of reusing the pacing path: a file device at 44.1 kHz must
        // still deliver 48 kHz frames at real time, or the fidelity assertion
        // downstream is measuring the mic and not the pipeline.
        let path = write_wav(
            "virtmic-paced.wav",
            44_100,
            &(0..44_100)
                .map(|i| ((i as f32) * 0.01).sin() * 0.4)
                .collect::<Vec<_>>(),
        );
        let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let mut cap =
            VirtualCapture::from_spec(&format!("file:{path}:44100"), 480, vol).unwrap();
        cap.start().unwrap();
        let t0 = Instant::now();
        let mut frames = 0u32;
        while t0.elapsed().as_millis() < 200 {
            match cap.read_frame() {
                Ok(_) => frames += 1,
                Err(Error::NotEnoughSamples) => {
                    std::thread::sleep(std::time::Duration::from_millis(2))
                }
                Err(e) => panic!("read_frame: {e}"),
            }
        }
        assert!(
            (14..=24).contains(&frames),
            "got {frames} frames in 200 ms (expected ~20)"
        );
    }

    #[test]
    fn paces_output_to_wall_clock_at_48k() {
        // 200 ms of wall time must yield ~200 ms of 48 kHz audio (+- one
        // frame + filter delay), regardless of the virtual device rate.
        for spec in ["sine:44100:440", "sine:192000:440"] {
            let vol = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
            let mut cap = VirtualCapture::from_spec(spec, 480, vol).unwrap();
            cap.start().unwrap();
            let t0 = Instant::now();
            let mut frames = 0u32;
            while t0.elapsed().as_millis() < 200 {
                match cap.read_frame() {
                    Ok(_) => frames += 1,
                    Err(Error::NotEnoughSamples) => {
                        std::thread::sleep(std::time::Duration::from_millis(2))
                    }
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
