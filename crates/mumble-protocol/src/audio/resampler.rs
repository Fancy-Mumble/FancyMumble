//! Arbitrary-rate streaming resampler to/from any sample rate.
//!
//! Mumble's wire format is locked to 48 kHz: the official client always
//! creates its Opus codec at `SAMPLE_RATE = 48000` and, when the capture
//! device runs at anything else, feeds it through a windowed-sinc
//! resampler (`speex_resampler_init(1, iMicFreq, iSampleRate, 3, ..)` in
//! `AudioInput::initializeMixer`).  Sending samples that are merely
//! *labelled* 48 kHz but were produced at another rate makes the stream's
//! real-time rate diverge from its nominal rate - the receiver's jitter
//! buffer then perpetually starves (or overfills), which is heard as
//! choppy, laggy, out-of-sync audio on official clients.
//!
//! [`StreamResampler`] is the same class of algorithm as speex's
//! (windowed-sinc interpolation over an oversampled kernel table), written
//! in safe Rust with an `f64` position accumulator, so it accepts **any**
//! finite positive rate - integer or fractional - and converts it to any
//! other: 8 kHz, 44.1 kHz, 192 kHz or 123456.78 Hz all work.  The output
//! position is derived from an integer output counter multiplied by the
//! exact `f64` ratio (never accumulated sample-by-sample), so the
//! conversion cannot drift over time.
//!
//! The resampler is mono: every capture path downmixes to mono before
//! entering the 48 kHz pipeline, matching the official client (which
//! mixes its mic channels before resampling).

use crate::error::{Error, Result};

/// Number of fractional phases tabulated per input-sample interval.
/// Coefficients between two adjacent phases are linearly interpolated,
/// which is what makes truly arbitrary (fractional) ratios exact.
const PHASES: usize = 256;

/// One-sided kernel half-width (in input samples) when not downsampling.
/// 16 gives a 32-tap filter, comparable to the speex resampler at the
/// quality level the official client uses (quality 3).
const BASE_HALF: usize = 16;

/// Upper bound on the half-width after downsampling widening, so extreme
/// ratios (e.g. 768 kHz -> 48 kHz) stay affordable.
const MAX_HALF: usize = 192;

/// Cutoff as a fraction of the narrower Nyquist band. Slightly below 1.0
/// leaves a transition band for the finite filter, trading a little
/// bandwidth (voice content is unaffected) for stopband rejection.
const CUTOFF: f64 = 0.92;

/// Streaming windowed-sinc resampler between two arbitrary sample rates.
///
/// Feed input in slices of any length with [`process_into`]; output
/// samples are appended to the caller's buffer as soon as enough input
/// context exists.  The filter introduces a fixed group delay of
/// `half_width` *input* samples (well under a millisecond at speech
/// rates).
///
/// [`process_into`]: StreamResampler::process_into
pub struct StreamResampler {
    /// Input sample rate in Hz (may be fractional).
    input_rate: f64,
    /// Output sample rate in Hz (may be fractional).
    output_rate: f64,
    /// Input samples advanced per output sample (`input_rate / output_rate`).
    step: f64,
    /// Absolute input position of output sample 0 of the current segment.
    base: f64,
    /// Outputs produced in the current segment (position = base + n * step).
    n_out: u64,
    /// One-sided kernel width in input samples for the current ratio.
    half: usize,
    /// Oversampled kernel: `(PHASES + 1)` rows of `2 * half` taps.
    /// Row `p` holds the kernel evaluated at fractional offset `p / PHASES`.
    table: Vec<f32>,
    /// Sliding window of input history; `hist[0]` is absolute input
    /// index `hist_start`.
    hist: Vec<f32>,
    /// Absolute input index of `hist[0]`.
    hist_start: u64,
    /// Total input samples ever accepted (absolute index of next push).
    in_total: u64,
}

impl std::fmt::Debug for StreamResampler {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("StreamResampler")
            .field("input_rate", &self.input_rate)
            .field("output_rate", &self.output_rate)
            .field("half", &self.half)
            .finish_non_exhaustive()
    }
}

/// Normalised sinc: `sin(pi x) / (pi x)`.
fn sinc(x: f64) -> f64 {
    if x.abs() < 1e-12 {
        1.0
    } else {
        let px = std::f64::consts::PI * x;
        px.sin() / px
    }
}

/// 4-term Blackman-Harris window, centred: `u` in [-1, 1].
fn window(u: f64) -> f64 {
    const A0: f64 = 0.358_75;
    const A1: f64 = 0.488_29;
    const A2: f64 = 0.141_28;
    const A3: f64 = 0.011_68;
    let pu = std::f64::consts::PI * u;
    A0 + A1 * pu.cos() + A2 * (2.0 * pu).cos() + A3 * (3.0 * pu).cos()
}

/// Validate a sample rate: finite and within a sane range.
fn check_rate(rate: f64) -> Result<()> {
    if !rate.is_finite() || !(1.0..=1_000_000.0).contains(&rate) {
        return Err(Error::InvalidState(format!(
            "unsupported sample rate {rate} Hz (expected 1 Hz ..= 1 MHz)"
        )));
    }
    Ok(())
}

impl StreamResampler {
    /// Create a resampler converting `input_rate` Hz to `output_rate` Hz.
    ///
    /// Both rates may be fractional.  Rates outside 1 Hz ..= 1 MHz are
    /// rejected.
    pub fn new(input_rate: f64, output_rate: f64) -> Result<Self> {
        check_rate(input_rate)?;
        check_rate(output_rate)?;
        let mut rs = Self {
            input_rate,
            output_rate,
            step: input_rate / output_rate,
            base: 0.0,
            n_out: 0,
            half: 0,
            table: Vec::new(),
            hist: Vec::new(),
            hist_start: 0,
            in_total: 0,
        };
        rs.rebuild_kernel();
        // Pre-fill one filter's worth of silence so the first real input
        // sample sits at the centre of the kernel once it becomes
        // computable (fixed group delay of `half` input samples).
        rs.hist = vec![0.0; rs.half];
        rs.in_total = rs.half as u64;
        rs.base = rs.half as f64;
        Ok(rs)
    }

    /// The current input rate in Hz.
    pub fn input_rate(&self) -> f64 {
        self.input_rate
    }

    /// True when input and output rates are equal and samples pass
    /// through untouched (no delay, no filtering).
    pub fn is_passthrough(&self) -> bool {
        self.input_rate == self.output_rate
    }

    /// Change the input rate mid-stream, preserving continuity.
    ///
    /// This is what makes *measured*-rate correction possible: when a
    /// driver claims 48 kHz but delivers 44 099.6 samples per wall-clock
    /// second, switching to the measured (fractional) rate restores the
    /// stream's real-time correctness.
    pub fn set_input_rate(&mut self, input_rate: f64) -> Result<()> {
        check_rate(input_rate)?;
        if input_rate == self.input_rate {
            return Ok(());
        }
        // Rebase so position continues exactly where it left off.
        self.base += self.n_out as f64 * self.step;
        self.n_out = 0;
        self.input_rate = input_rate;
        self.step = input_rate / self.output_rate;
        self.rebuild_kernel();
        Ok(())
    }

    /// Resample `input` and append the produced samples to `output`.
    ///
    /// Any number of input samples per call is fine (including zero, to
    /// flush what has become computable).  Output timing is exact in the
    /// long run: after feeding N input samples, `N * output_rate /
    /// input_rate` samples (+/- the fixed filter delay) have been
    /// produced.
    pub fn process_into(&mut self, input: &[f32], output: &mut Vec<f32>) {
        if self.is_passthrough() {
            output.extend_from_slice(input);
            return;
        }

        self.hist.extend_from_slice(input);
        self.in_total += input.len() as u64;

        loop {
            let p = self.base + self.n_out as f64 * self.step;
            let i = p.floor();
            // The kernel needs input samples `i - half + 1 ..= i + half`.
            let last_needed = i as i64 + self.half as i64;
            if last_needed >= self.in_total as i64 {
                break; // not enough input context yet
            }
            let frac = p - i;
            let first = i as i64 - self.half as i64 + 1;
            debug_assert!(first >= self.hist_start as i64);
            let start = (first - self.hist_start as i64) as usize;

            // Fractional phase -> two adjacent kernel rows, linearly
            // interpolated per tap.
            let phase_f = frac * PHASES as f64;
            let phase = (phase_f as usize).min(PHASES - 1);
            let t = (phase_f - phase as f64) as f32;
            let taps = self.half * 2;
            let row0 = &self.table[phase * taps..(phase + 1) * taps];
            let row1 = &self.table[(phase + 1) * taps..(phase + 2) * taps];

            let mut acc = 0.0f32;
            let window = &self.hist[start..start + taps];
            for ((s, c0), c1) in window.iter().zip(row0.iter()).zip(row1.iter()) {
                let c = c0 + t * (c1 - c0);
                acc += s * c;
            }
            output.push(acc);
            self.n_out += 1;
        }

        self.trim_history();
    }

    /// Drop history that can no longer be referenced by future outputs,
    /// keeping a `MAX_HALF` margin so `set_input_rate` to a slower rate
    /// (wider kernel) stays safe.
    fn trim_history(&mut self) {
        let p_next = self.base + self.n_out as f64 * self.step;
        let keep_from = (p_next.floor() as i64 - MAX_HALF as i64 - 1).max(0) as u64;
        if keep_from > self.hist_start {
            let n = (keep_from - self.hist_start) as usize;
            if n >= self.hist.len() {
                self.hist.clear();
                self.hist_start = self.in_total;
            } else {
                let _ = self.hist.drain(..n);
                self.hist_start = keep_from;
            }
        }
    }

    /// (Re)build the oversampled kernel table for the current ratio.
    fn rebuild_kernel(&mut self) {
        // Downsampling narrows the cutoff to the OUTPUT Nyquist and
        // widens the kernel proportionally, exactly like speex.
        let ratio = self.output_rate / self.input_rate; // < 1 when downsampling
        let band = ratio.min(1.0);
        let half = ((BASE_HALF as f64 / band).ceil() as usize).clamp(BASE_HALF, MAX_HALF);
        let fc = 0.5 * CUTOFF * band; // cycles per input sample

        let taps = half * 2;
        let mut table = vec![0.0f32; (PHASES + 1) * taps];
        for (phase, row) in table.chunks_exact_mut(taps).enumerate() {
            let frac = phase as f64 / PHASES as f64;
            let mut sum = 0.0f64;
            for (tap, coeff) in row.iter_mut().enumerate() {
                // Tap `tap` reads input index `i + tap - half + 1`, i.e.
                // offset `x` from the exact (fractional) position.
                let x = (tap as f64 - (half as f64 - 1.0)) - frac;
                let v = 2.0 * fc * sinc(2.0 * fc * x) * window(x / half as f64);
                *coeff = v as f32;
                sum += v;
            }
            // Normalise each phase row to unity DC gain: removes the
            // truncation ripple and guarantees constant signals pass
            // through at exactly their level.
            if sum.abs() > f64::EPSILON {
                let inv = (1.0 / sum) as f32;
                for coeff in row.iter_mut() {
                    *coeff *= inv;
                }
            }
        }
        self.half = half;
        self.table = table;
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    /// Generate `n` samples of a sine at `freq` Hz sampled at `rate` Hz.
    fn sine(freq: f64, rate: f64, n: usize) -> Vec<f32> {
        (0..n)
            .map(|i| (2.0 * std::f64::consts::PI * freq * i as f64 / rate).sin() as f32)
            .collect()
    }

    /// Run a full conversion in randomly-sized chunks to exercise the
    /// streaming paths (mid-buffer boundaries, history trimming).
    fn convert_chunked(rs: &mut StreamResampler, input: &[f32]) -> Vec<f32> {
        let mut out = Vec::new();
        let mut i = 0;
        let mut chunk = 17; // deliberately odd, varying sizes
        while i < input.len() {
            let end = (i + chunk).min(input.len());
            rs.process_into(&input[i..end], &mut out);
            i = end;
            chunk = (chunk * 7 + 3) % 512 + 1;
        }
        out
    }

    /// Estimate the dominant frequency of a signal by counting zero
    /// crossings over the steady middle section.
    fn dominant_freq(samples: &[f32], rate: f64) -> f64 {
        let lo = samples.len() / 4;
        let hi = samples.len() * 3 / 4;
        let mut crossings = 0u32;
        for i in lo + 1..hi {
            if (samples[i - 1] < 0.0) != (samples[i] < 0.0) {
                crossings += 1;
            }
        }
        let span_secs = (hi - lo) as f64 / rate;
        f64::from(crossings) / 2.0 / span_secs
    }

    fn rms(samples: &[f32]) -> f64 {
        if samples.is_empty() {
            return 0.0;
        }
        let sum: f64 = samples.iter().map(|&s| f64::from(s) * f64::from(s)).sum();
        (sum / samples.len() as f64).sqrt()
    }

    #[test]
    fn passthrough_at_equal_rates_is_lossless() {
        let mut rs = StreamResampler::new(48_000.0, 48_000.0).unwrap();
        let input = sine(1000.0, 48_000.0, 4800);
        let mut out = Vec::new();
        rs.process_into(&input, &mut out);
        assert_eq!(out, input);
        assert!(rs.is_passthrough());
    }

    #[test]
    fn output_length_matches_ratio_for_many_rates() {
        // 2 seconds of input at each rate; output must be 2 s at 48 kHz
        // within one filter length.
        for &rate in &[
            8_000.0, 11_025.0, 16_000.0, 22_050.0, 44_100.0, 96_000.0, 176_400.0, 192_000.0,
        ] {
            let mut rs = StreamResampler::new(rate, 48_000.0).unwrap();
            let input = sine(440.0, rate, (rate * 2.0) as usize);
            let out = convert_chunked(&mut rs, &input);
            let expected = input.len() as f64 * 48_000.0 / rate;
            let tolerance = 2.0 * MAX_HALF as f64 * 48_000.0 / rate + 2.0;
            assert!(
                (out.len() as f64 - expected).abs() <= tolerance,
                "rate {rate}: got {} samples, expected ~{expected}",
                out.len(),
            );
        }
    }

    #[test]
    fn fractional_odd_rate_is_supported_and_exact() {
        // The requirement: arbitrary fractional rates like 123456.78 Hz.
        let rate = 123_456.78;
        let mut rs = StreamResampler::new(rate, 48_000.0).unwrap();
        let secs = 5.0;
        let input = sine(1000.0, rate, (rate * secs) as usize);
        let out = convert_chunked(&mut rs, &input);

        // Length: 5 s of 48 kHz audio within a filter length.
        let expected = input.len() as f64 * 48_000.0 / rate;
        assert!(
            (out.len() as f64 - expected).abs() <= 200.0,
            "got {} samples, expected ~{expected}",
            out.len(),
        );

        // The 1 kHz tone must still be a 1 kHz tone at 48 kHz.
        let freq = dominant_freq(&out, 48_000.0);
        assert!(
            (freq - 1000.0).abs() < 5.0,
            "tone shifted: measured {freq} Hz, expected 1000 Hz"
        );
    }

    #[test]
    fn tone_frequency_preserved_up_and_down() {
        for &(rate, tone) in &[
            (44_100.0, 1_000.0),
            (8_000.0, 700.0),
            (96_000.0, 3_000.0),
            (192_000.0, 440.0),
        ] {
            let mut rs = StreamResampler::new(rate, 48_000.0).unwrap();
            let input = sine(tone, rate, (rate * 2.0) as usize);
            let out = convert_chunked(&mut rs, &input);
            let freq = dominant_freq(&out, 48_000.0);
            assert!(
                (freq - tone).abs() < tone * 0.01 + 2.0,
                "rate {rate}: measured {freq} Hz, expected {tone} Hz"
            );
            // Amplitude preserved (in-band tones): RMS of a unit sine is ~0.707.
            let level = rms(&out[out.len() / 4..out.len() * 3 / 4]);
            assert!(
                (level - 0.707).abs() < 0.03,
                "rate {rate}: RMS {level}, expected ~0.707"
            );
        }
    }

    #[test]
    fn downsampling_rejects_aliasing() {
        // A 30 kHz tone at 96 kHz input is above the 24 kHz output
        // Nyquist: it must be attenuated to near-silence, not folded
        // back into the audible band.
        let mut rs = StreamResampler::new(96_000.0, 48_000.0).unwrap();
        let input = sine(30_000.0, 96_000.0, 96_000);
        let out = convert_chunked(&mut rs, &input);
        let level = rms(&out[out.len() / 4..out.len() * 3 / 4]);
        assert!(
            level < 0.01,
            "aliased energy leaked through: RMS {level} (expected < 0.01)"
        );
    }

    #[test]
    fn dc_gain_is_unity() {
        let mut rs = StreamResampler::new(44_100.0, 48_000.0).unwrap();
        let input = vec![0.7f32; 44_100];
        let out = convert_chunked(&mut rs, &input);
        // Skip the group-delay ramp-in at the start.
        for (i, &s) in out.iter().enumerate().skip(200) {
            assert!(
                (s - 0.7).abs() < 1e-3,
                "sample {i}: {s} deviates from DC level 0.7"
            );
        }
    }

    #[test]
    fn long_run_has_no_drift() {
        // 60 simulated seconds at 44.1 kHz: cumulative output must stay
        // within a filter length of the exact ratio - a drifting
        // resampler is precisely the "laggy / out of sync" bug.
        let rate = 44_100.0;
        let mut rs = StreamResampler::new(rate, 48_000.0).unwrap();
        let chunk = vec![0.25f32; 441]; // 10 ms
        let mut out = Vec::new();
        let mut in_total = 0u64;
        for _ in 0..6_000 {
            rs.process_into(&chunk, &mut out);
            in_total += chunk.len() as u64;
        }
        let expected = in_total as f64 * 48_000.0 / rate;
        let error = (out.len() as f64 - expected).abs();
        assert!(
            error <= 64.0,
            "drifted by {error} samples over 60 s (expected <= filter delay)"
        );
    }

    #[test]
    fn set_input_rate_mid_stream_keeps_continuity() {
        // Simulates measured-rate correction: a driver claiming 48 kHz
        // that actually delivers 44.1 kHz. After correction the tone
        // must come out at the true frequency, with no NaNs or jumps.
        let mut rs = StreamResampler::new(48_000.0, 48_000.0).unwrap();
        assert!(rs.is_passthrough());
        rs.set_input_rate(44_100.0).unwrap();
        assert!(!rs.is_passthrough());
        assert_eq!(rs.input_rate(), 44_100.0);

        let input = sine(1000.0, 44_100.0, 88_200);
        let out = convert_chunked(&mut rs, &input);
        assert!(out.iter().all(|s| s.is_finite()), "non-finite output");
        let freq = dominant_freq(&out, 48_000.0);
        assert!(
            (freq - 1000.0).abs() < 10.0,
            "after rate correction: measured {freq} Hz, expected 1000 Hz"
        );

        // A fractional corrected rate must be accepted too.
        rs.set_input_rate(44_099.63).unwrap();
        assert_eq!(rs.input_rate(), 44_099.63);
        let mut more = Vec::new();
        rs.process_into(&sine(1000.0, 44_099.63, 4410), &mut more);
        assert!(more.iter().all(|s| s.is_finite()));
    }

    #[test]
    fn rejects_nonsense_rates() {
        assert!(StreamResampler::new(0.0, 48_000.0).is_err());
        assert!(StreamResampler::new(-44_100.0, 48_000.0).is_err());
        assert!(StreamResampler::new(f64::NAN, 48_000.0).is_err());
        assert!(StreamResampler::new(f64::INFINITY, 48_000.0).is_err());
        assert!(StreamResampler::new(2_000_000.0, 48_000.0).is_err());
        let mut rs = StreamResampler::new(44_100.0, 48_000.0).unwrap();
        assert!(rs.set_input_rate(f64::NAN).is_err());
    }

    #[test]
    fn zero_length_input_is_fine() {
        let mut rs = StreamResampler::new(44_100.0, 48_000.0).unwrap();
        let mut out = Vec::new();
        rs.process_into(&[], &mut out);
        assert!(out.is_empty());
    }
}
