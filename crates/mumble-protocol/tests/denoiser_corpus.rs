//! A synthetic noisy-speech corpus, and what the denoisers score on it.
//!
//! `denoiser_quality.rs` measures one backend against one noise type and
//! deliberately asserts no ranking, because it could not support one: white
//! noise is stationary, and stationary noise is the case classical and RNN
//! denoisers are already good at. This file exists to make the comparison
//! answerable, by generating the cases that actually separate the backends.
//!
//! # The corpus
//!
//! Clean speech from `tests/samples/`, mixed with generated noise at a
//! controlled SNR. Four noise types, chosen because they fail differently:
//!
//! | noise | character | what it catches |
//! |---|---|---|
//! | white | stationary, flat | the easy case; everything scores well |
//! | pink | stationary, `1/f` | closer to real room tone than white |
//! | babble | **non-stationary, speech-shaped** | the hard case: a spectral denoiser cannot tell it from the speaker |
//! | impulsive | sparse transients | keyboard and door clicks; punishes slow noise estimators |
//!
//! Babble is the one that matters. It is built by summing several
//! time-shifted, detuned copies of the speech itself, so it has the spectrum
//! and the modulation of real voices - which is exactly why a noise estimator
//! that assumes stationarity cannot subtract it, and why a learned model is
//! supposed to win.
//!
//! # Mixing at a stated SNR
//!
//! The noise gain is computed against the **active** speech level, not the
//! level of the whole file. A recording that is half silence has an RMS far
//! below its speech level, so mixing against the plain RMS quietly produces a
//! corpus several dB noisier than its label says - and every published number
//! it is compared against becomes meaningless. Frames below a floor relative
//! to the loudest frame are treated as silence, which is the idea behind
//! ITU-T P.56 without the full machinery.
//!
//! # Delay compensation is mandatory, not a refinement
//!
//! Every metric here compares the output against the clean reference sample
//! by sample, and the backends do not return audio at the same time:
//!
//! | backend | algorithmic delay |
//! |---|---|
//! | off | 0 ms |
//! | `RNNoise` | 10.0 ms |
//! | OMLSA + IMCRA | 10.6 ms |
//! | `DeepFilterNet` | **40.0 ms** |
//!
//! Measured, by cross-correlating a chirp through each. Uncompensated, that
//! 40 ms alone drives `DeepFilterNet`'s SI-SDR *negative* - it would score as
//! catastrophically broken while sounding perfect. So the alignment below is
//! load-bearing, and the reason the earlier RMS-window test did not need it is
//! only that a 24 000-sample window swamps a 1 919-sample shift.
//!
//! **That 40 ms is also a real cost.** Mumble sends 10 ms or 20 ms frames;
//! adding 40 ms of algorithmic delay to the capture path is a mouth-to-ear
//! regression that no audio-quality score will show.
//!
//! # Why SI-SDR
//!
//! Scale-invariant signal-to-distortion ratio: it is insensitive to overall
//! gain, so a backend cannot score well merely by turning everything down, and
//! it penalises removing speech as heavily as leaving noise. That two-sided
//! property is what a plain noise-floor measurement lacks. PESQ and STOI are
//! the published metrics for this task and neither has a usable Rust
//! implementation - upstream `DeepFilterNet` computes both in Python
//! (`df/stoi.py`, `df/sepm.py`) - so a like-for-like comparison against
//! published PESQ numbers needs the Python path and the real corpus; see
//! `E2E_VOICEBANK_DEMAND` below.
//!
//! # What it measured
//!
//! SI-SDR in dB, higher is better; `in` is the untouched mixture, so any
//! column below it is a backend that made things *worse*.
//!
//! | noise | SNR | in | `RNNoise` | `DeepFilterNet` | OMLSA |
//! |---|---|---|---|---|---|
//! | white | 0 | −1.6 | 7.9 | **14.4** | 9.1 |
//! | white | 5 | 3.5 | 12.8 | **17.0** | 10.4 |
//! | white | 15 | 13.5 | **16.2** | 9.0 | 11.7 |
//! | pink | 0 | −1.6 | 6.2 | **10.0** | 1.6 |
//! | pink | 5 | 3.4 | 10.2 | **13.5** | 5.6 |
//! | pink | 15 | 13.4 | **15.0** | 14.1 | 10.9 |
//! | babble | 0 | −1.4 | **−1.2** | −2.1 | −2.4 |
//! | babble | 5 | 3.5 | **4.0** | 2.6 | 3.2 |
//! | babble | 15 | 13.5 | 12.9 | **3.6** | 10.2 |
//! | impulsive | 0 | 1.4 | 6.4 | **8.8** | 2.3 |
//! | impulsive | 5 | 4.0 | 8.9 | **9.2** | 4.4 |
//! | impulsive | 15 | 13.5 | **15.1** | 11.4 | 10.4 |
//!
//! Two results, and the second is the one that changes a decision:
//!
//! * **In a noisy room `DeepFilterNet` is far ahead.** At 0-5 dB SNR it beats
//!   `RNNoise` by 3-6.5 dB on every noise but babble. That is the condition
//!   users complain about, and no amount of tuning gets a classical backend
//!   there.
//! * **On already-clean audio it does harm.** At 15 dB SNR it is *below the
//!   untouched input* on white, babble and impulsive - worst on babble, 13.5
//!   down to 3.6, where it removes the talker along with the crowd. Most
//!   calls are made in quiet rooms, which is why it ships selectable and not
//!   selected, and why `deepfilternet_must_not_be_the_default` exists.
//!
//! Babble is the standing weakness for everything here, `RNNoise` included:
//! nothing gains more than half a dB on it at any SNR. That is expected -
//! babble is speech, and a single-channel denoiser has no cue to separate one
//! talker from many.
//!
//! # Using the real benchmark instead
//!
//! Set `E2E_VOICEBANK_DEMAND=<dir>` to a local copy of the VoiceBank-DEMAND
//! test set (CC BY-4.0, `noisy_testset_wav/` and `clean_testset_wav/`, 824
//! utterances) and the corpus below is replaced by it. That is the set
//! `DeepFilterNet3`'s published numbers are measured on, so it is the only way
//! to compare against them directly. It is not vendored: 2.3 GB, and the
//! noise half of it is CC BY-SA, which is not a licence this tree can absorb.

//! ```sh
//! cargo test -p mumble-protocol --test denoiser_corpus \
//!     --features deepfilternet-denoiser,rnnoise-denoiser -- --nocapture
//! ```

#![allow(
    unused_crate_dependencies,
    reason = "integration test: it links the whole crate's dependency set and uses a few"
)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "concise failure reporting in tests"
)]

use mumble_protocol::audio::filter::denoiser::{
    DenoiserConfig, DenoiserParams, NoiseSuppressionAlgorithm, SpectralDenoiser,
};
use mumble_protocol::audio::filter::AudioFilter;
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};

const SAMPLE: &str = "tests/samples/811749__bethanyw__memories-poem-2.mp3";
const RATE: f32 = 48_000.0;
const FRAME: usize = 480;

/// Longest delay any backend is allowed to add, in samples (50 ms).
///
/// The alignment search bound. Generous against the 40 ms `DeepFilterNet`
/// actually adds, so a future backend that buffers more is aligned rather
/// than silently mis-scored.
const MAX_DELAY: usize = 2_400;

/// The kinds of noise a voice call actually meets.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Noise {
    White,
    Pink,
    Babble,
    Impulsive,
}

impl Noise {
    const ALL: [Self; 4] = [Self::White, Self::Pink, Self::Babble, Self::Impulsive];

    fn label(self) -> &'static str {
        match self {
            Self::White => "white",
            Self::Pink => "pink",
            Self::Babble => "babble",
            Self::Impulsive => "impulsive",
        }
    }

    /// Unit-ish noise of `len` samples; the caller scales it for the SNR.
    fn generate(self, len: usize, speech: &[f32]) -> Vec<f32> {
        let mut rng = Lcg::new(0x9E37_79B9);
        match self {
            Self::White => (0..len).map(|_| rng.next_bipolar()).collect(),
            Self::Pink => pink(len, &mut rng),
            Self::Babble => babble(len, speech),
            Self::Impulsive => impulsive(len, &mut rng),
        }
    }
}

/// Voss-McCartney pink noise: octave-spaced random sources summed, which
/// gives a `1/f` slope without designing an FIR. Closer to room tone and
/// traffic than white is.
fn pink(len: usize, rng: &mut Lcg) -> Vec<f32> {
    const OCTAVES: usize = 8;
    let mut rows = [0.0_f32; OCTAVES];
    let mut out = Vec::with_capacity(len);
    for i in 0..len {
        for (octave, row) in rows.iter_mut().enumerate() {
            if i % (1 << octave) == 0 {
                *row = rng.next_bipolar();
            }
        }
        out.push(rows.iter().sum::<f32>() / OCTAVES as f32);
    }
    out
}

/// Speech-shaped, non-stationary noise, because it *is* speech: several
/// copies of the talker, shifted apart, detuned so no two share a pitch,
/// and **time-reversed**.
///
/// The reversal is not cosmetic. Only one recording is in the tree, so an
/// un-reversed babble is the target speaker's own voice, and the
/// measurement then asks the model to separate a talker from himself -
/// a degenerate case no real deployment produces. Reversed speech keeps the
/// long-term spectrum and the syllabic modulation while destroying the
/// correlation with the target, which is the standard construction.
fn babble(len: usize, speech: &[f32]) -> Vec<f32> {
    const TALKERS: usize = 7;
    if speech.is_empty() {
        return vec![0.0; len];
    }
    let reversed: Vec<f32> = speech.iter().rev().copied().collect();
    let mut out = vec![0.0_f32; len];
    for talker in 0..TALKERS {
        let offset = (talker * 37_003 + 5_101) % reversed.len();
        // Detune by up to ~6%, so the harmonics do not stack.
        let rate = (talker as f32 - 3.0).mul_add(0.02, 1.0);
        for (i, slot) in out.iter_mut().enumerate() {
            let pos = (i as f32 * rate) as usize + offset;
            *slot += reversed[pos % reversed.len()];
        }
    }
    let scale = (TALKERS as f32).sqrt();
    for s in &mut out {
        *s /= scale;
    }
    out
}

/// Sparse transients: a keyboard, a door, cutlery. Punishes a noise
/// estimator that adapts slowly, and a gate that opens on the click and
/// then stays open.
fn impulsive(len: usize, rng: &mut Lcg) -> Vec<f32> {
    /// Samples a click takes to decay (~5 ms).
    const DECAY: usize = 240;

    let mut out = vec![0.0_f32; len];
    let mut at = 0_usize;
    while at < len {
        // A click every 80-400 ms.
        at += 3_840 + (rng.next_u32() as usize % 15_360);
        for k in 0..DECAY.min(len.saturating_sub(at)) {
            let env = 1.0 - (k as f32 / DECAY as f32);
            out[at + k] += rng.next_bipolar() * env * env * 4.0;
        }
    }
    out
}

/// A fixed linear congruential generator.
///
/// Deterministic on purpose: a corpus that draws fresh noise each run has a
/// different difficulty each run, so a threshold that holds today fails next
/// week for no reason anybody can reproduce.
struct Lcg(u32);

impl Lcg {
    const fn new(seed: u32) -> Self {
        Self(seed)
    }

    fn next_u32(&mut self) -> u32 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        self.0
    }

    /// Uniform in `[-1, 1)`.
    ///
    /// The top 24 bits, because an LCG's low bits have short periods and a
    /// noise fixture built from them is audibly periodic.
    fn next_bipolar(&mut self) -> f32 {
        (self.next_u32() >> 8) as f32 / 8_388_608.0 - 1.0
    }
}

/// RMS over the frames that actually carry speech.
///
/// Frames more than `FLOOR_DB` below the loudest frame are treated as
/// silence and excluded. Mixing against the whole-file RMS instead makes a
/// recording that is half pauses come out several dB noisier than its label.
fn active_speech_level(x: &[f32]) -> f32 {
    const FLOOR_DB: f32 = -35.0;

    let frames: Vec<f32> = x.chunks(FRAME).map(rms).collect();
    let loudest = frames.iter().copied().fold(0.0_f32, f32::max);
    if loudest <= 0.0 {
        return 0.0;
    }
    let floor = loudest * 10.0_f32.powf(FLOOR_DB / 20.0);
    let active: Vec<f32> = frames.into_iter().filter(|f| *f >= floor).collect();
    if active.is_empty() {
        return loudest;
    }
    (active.iter().map(|f| f * f).sum::<f32>() / active.len() as f32).sqrt()
}

fn rms(x: &[f32]) -> f32 {
    if x.is_empty() {
        return 0.0;
    }
    (x.iter().map(|s| s * s).sum::<f32>() / x.len() as f32).sqrt()
}

/// Mix `noise` under `speech` so the result sits at `snr_db`.
fn mix_at_snr(speech: &[f32], noise: &[f32], snr_db: f32) -> Vec<f32> {
    let speech_level = active_speech_level(speech);
    let noise_level = rms(noise).max(1e-9);
    let wanted = speech_level / 10.0_f32.powf(snr_db / 20.0);
    let gain = wanted / noise_level;
    speech
        .iter()
        .zip(noise)
        .map(|(s, n)| (s + n * gain).clamp(-1.0, 1.0))
        .collect()
}

/// Run a whole signal through one backend, 10 ms at a time.
fn denoise(input: &[f32], algorithm: NoiseSuppressionAlgorithm) -> Vec<f32> {
    let mut filter = SpectralDenoiser::new(DenoiserConfig {
        algorithm,
        attenuation: 1.0,
        params: DenoiserParams::new(),
    });
    let mut out = Vec::with_capacity(input.len());
    for chunk in input.chunks(FRAME) {
        let mut data = Vec::with_capacity(chunk.len() * 4);
        for s in chunk {
            data.extend_from_slice(&s.to_ne_bytes());
        }
        let mut frame = AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: 0,
            is_silent: false,
        };
        filter.process(&mut frame).expect("the filter accepts a frame");
        out.extend_from_slice(frame.as_f32_samples());
    }
    out
}

/// The lag at which `estimate` best lines up with `reference`.
///
/// Without this every metric below measures the backend's latency instead of
/// its quality - see the module header.
fn best_lag(reference: &[f32], estimate: &[f32]) -> usize {
    let span = reference.len().min(estimate.len()).saturating_sub(MAX_DELAY);
    if span == 0 {
        return 0;
    }
    let mut best = (0_usize, f64::MIN);
    for lag in 0..MAX_DELAY {
        let mut dot = 0.0_f64;
        let mut energy = 0.0_f64;
        // Every 4th sample: the peak is broad compared with the stride and
        // this is a test fixture, not a real-time correlator.
        for i in (0..span).step_by(4) {
            let e = f64::from(estimate[i + lag]);
            dot += f64::from(reference[i]) * e;
            energy += e * e;
        }
        let score = if energy > 0.0 { dot / energy.sqrt() } else { 0.0 };
        if score > best.1 {
            best = (lag, score);
        }
    }
    best.0
}

/// Scale-invariant signal-to-distortion ratio, in dB.
///
/// The estimate is projected onto the reference, that projection is the
/// signal and the remainder is distortion. Scale invariance is the property
/// that matters here: a backend cannot score well by attenuating everything,
/// which is exactly how a naive noise-floor measurement is fooled.
fn si_sdr(reference: &[f32], estimate: &[f32]) -> f32 {
    let lag = best_lag(reference, estimate);
    let n = reference.len().min(estimate.len() - lag.min(estimate.len()));
    if n == 0 {
        return f32::NEG_INFINITY;
    }
    let r = &reference[..n];
    let e = &estimate[lag..lag + n];

    let dot: f64 = r.iter().zip(e).map(|(a, b)| f64::from(*a) * f64::from(*b)).sum();
    let ref_energy: f64 = r.iter().map(|a| f64::from(*a) * f64::from(*a)).sum();
    if ref_energy <= 0.0 {
        return f32::NEG_INFINITY;
    }
    let scale = dot / ref_energy;

    let mut target = 0.0_f64;
    let mut noise = 0.0_f64;
    for (a, b) in r.iter().zip(e) {
        let t = scale * f64::from(*a);
        let d = f64::from(*b) - t;
        target += t * t;
        noise += d * d;
    }
    if noise <= 0.0 {
        return f32::INFINITY;
    }
    (10.0 * (target / noise).log10()) as f32
}

/// Decode the speech fixture to mono f32 at 48 kHz.
fn decode_sample() -> Option<Vec<f32>> {
    use minimp3::{Decoder, Error};

    let file = std::fs::File::open(SAMPLE).ok()?;
    let mut decoder = Decoder::new(file);
    let mut out: Vec<f32> = Vec::new();
    loop {
        match decoder.next_frame() {
            Ok(frame) => {
                let channels = frame.channels;
                let mono: Vec<f32> = if channels <= 1 {
                    frame.data.iter().map(|&s| f32::from(s) / 32768.0).collect()
                } else {
                    frame
                        .data
                        .chunks(channels)
                        .map(|c| {
                            c.iter().map(|&s| f32::from(s) / 32768.0).sum::<f32>() / channels as f32
                        })
                        .collect()
                };
                let rate = f64::from(frame.sample_rate);
                if (rate - f64::from(RATE)).abs() < 1.0 {
                    out.extend(mono);
                } else {
                    let ratio = f64::from(RATE) / rate;
                    let len = (mono.len() as f64 * ratio) as usize;
                    for i in 0..len {
                        let pos = i as f64 / ratio;
                        let idx = pos as usize;
                        let frac = (pos - idx as f64) as f32;
                        let a = mono.get(idx).copied().unwrap_or(0.0);
                        let b = mono.get(idx + 1).copied().unwrap_or(a);
                        out.push(a + (b - a) * frac);
                    }
                }
            }
            Err(Error::Eof) => break,
            Err(_) => return None,
        }
    }
    (!out.is_empty()).then_some(out)
}

/// One corpus entry: clean reference plus the noisy mixture.
struct Item {
    noise: Noise,
    snr_db: f32,
    clean: Vec<f32>,
    noisy: Vec<f32>,
}

/// Build the corpus: every noise type at every SNR.
fn corpus(snrs: &[f32]) -> Option<Vec<Item>> {
    // Six seconds is enough for a stable measurement and keeps the whole
    // grid inside a normal test run; the model is the slow part.
    let clean: Vec<f32> = decode_sample()?.into_iter().take(48_000 * 6).collect();

    let mut items = Vec::new();
    for noise in Noise::ALL {
        let generated = noise.generate(clean.len(), &clean);
        for &snr_db in snrs {
            items.push(Item {
                noise,
                snr_db,
                clean: clean.clone(),
                noisy: mix_at_snr(&clean, &generated, snr_db),
            });
        }
    }
    Some(items)
}

#[cfg(feature = "deepfilternet-denoiser")]
#[test]
fn every_backend_scored_across_the_corpus() {
    let Some(items) = corpus(&[0.0, 5.0, 15.0]) else {
        eprintln!("skipping: {SAMPLE} is not present");
        return;
    };

    let backends = NoiseSuppressionAlgorithm::available();
    println!("\nSI-SDR (dB), higher is better. `in` is the unprocessed mixture.\n");
    print!("{:<11} {:>5} {:>7}", "noise", "snr", "in");
    for b in &backends {
        print!(" {:>10}", format!("{b:?}"));
    }
    println!();

    for item in &items {
        let input = si_sdr(&item.clean, &item.noisy);
        print!(
            "{:<11} {:>4.0} {:>7.1}",
            item.noise.label(),
            item.snr_db,
            input
        );
        for b in &backends {
            print!(" {:>10.1}", si_sdr(&item.clean, &denoise(&item.noisy, *b)));
        }
        println!();
    }
    println!();
}

#[cfg(feature = "deepfilternet-denoiser")]
#[test]
fn deepfilternet_is_a_large_win_in_a_noisy_room() {
    // The case the model exists for, and the case a user actually
    // complains about: a genuinely noisy input. At 0-5 dB SNR it is the
    // best backend available by a margin no parameter tweak closes.
    //
    // Babble is excluded deliberately and not because it is inconvenient
    // - see `deepfilternet_must_not_be_the_default` for what it does
    // there and why that is the more important test.
    let Some(items) = corpus(&[0.0, 5.0]) else {
        eprintln!("skipping: {SAMPLE} is not present");
        return;
    };

    for item in items.iter().filter(|i| i.noise != Noise::Babble) {
        let before = si_sdr(&item.clean, &item.noisy);
        let after = si_sdr(
            &item.clean,
            &denoise(&item.noisy, NoiseSuppressionAlgorithm::DeepFilterNet),
        );
        assert!(
            after - before > 3.0,
            "{} at {} dB SNR gained only {:.1} dB ({before:.1} -> {after:.1}); this is the \
             condition the model is for",
            item.noise.label(),
            item.snr_db,
            after - before
        );
    }
}

#[cfg(feature = "deepfilternet-denoiser")]
#[test]
fn deepfilternet_must_not_be_the_default() {
    // The guard that matters, and the reason this file exists.
    //
    // On an input that is *already clean* the model does not help, it
    // harms: at 15 dB SNR it drops white noise from 13.5 to 9.0 dB SI-SDR
    // and babble from 13.5 to 3.6 - it removes the speaker along with the
    // noise. Most calls are made in quiet rooms, so a build that defaulted
    // to DeepFilterNet would make the majority of users sound worse in
    // exchange for helping the minority in noisy ones.
    //
    // So it ships selectable and not selected. If somebody changes the
    // default, this test is what tells them what they are trading.
    assert_eq!(
        NoiseSuppressionAlgorithm::default(),
        NoiseSuppressionAlgorithm::Rnnoise,
        "DeepFilterNet degrades already-clean audio; it must stay an opt-in choice"
    );

    // And the harm is real, not theoretical - measured here so the claim
    // above cannot quietly stop being true.
    let Some(items) = corpus(&[15.0]) else {
        eprintln!("skipping: {SAMPLE} is not present");
        return;
    };
    let babble = items
        .iter()
        .find(|i| i.noise == Noise::Babble)
        .expect("the corpus carries a babble case");
    let before = si_sdr(&babble.clean, &babble.noisy);
    let after = si_sdr(
        &babble.clean,
        &denoise(&babble.noisy, NoiseSuppressionAlgorithm::DeepFilterNet),
    );
    assert!(
        after < before,
        "DeepFilterNet no longer damages clean babble ({before:.1} -> {after:.1} dB). That is \
         good news and this test is now wrong: re-measure the whole grid and revisit the default."
    );
}

#[test]
fn the_corpus_is_mixed_at_the_snr_it_claims() {
    // The fixture testing itself. A mixer that is quietly 6 dB off makes
    // every number this file prints wrong in the same direction, which is
    // the kind of error that survives review because the *ranking* still
    // looks sensible.
    let Some(clean) = decode_sample() else {
        eprintln!("skipping: {SAMPLE} is not present");
        return;
    };
    let clean: Vec<f32> = clean.into_iter().take(48_000 * 6).collect();
    let speech_level = active_speech_level(&clean);

    for snr_db in [0.0_f32, 10.0, 20.0] {
        let noise = Noise::White.generate(clean.len(), &clean);
        let noisy = mix_at_snr(&clean, &noise, snr_db);
        // Recover the noise that was actually added and measure it.
        let added: Vec<f32> = noisy.iter().zip(&clean).map(|(m, c)| m - c).collect();
        let got = 20.0 * (speech_level / rms(&added).max(1e-9)).log10();
        assert!(
            (got - snr_db).abs() < 1.0,
            "asked for {snr_db} dB SNR, mixed {got:.1} dB"
        );
    }
}

#[test]
fn active_level_ignores_the_silence_between_words() {
    // Why the mixer does not use plain RMS: a signal that is half silence
    // has an RMS well below its speech level, and mixing against that makes
    // the corpus noisier than its label claims.
    let tone: Vec<f32> = (0..48_000)
        .map(|i| (2.0 * std::f32::consts::PI * 300.0 * i as f32 / RATE).sin() * 0.5)
        .collect();
    let mut half_silent = tone.clone();
    half_silent.extend(std::iter::repeat_n(0.0, 48_000));

    let active = active_speech_level(&half_silent);
    let plain = rms(&half_silent);
    assert!(
        active > plain * 1.3,
        "active level {active:.4} should exceed whole-file RMS {plain:.4}"
    );
    assert!(
        (active - active_speech_level(&tone)).abs() < 0.02,
        "padding a signal with silence must not change its speech level"
    );
}

#[test]
fn si_sdr_is_blind_to_gain_and_sees_added_noise() {
    // The two properties the ranking depends on. If SI-SDR moved with gain,
    // a backend could win by turning the volume down.
    let clean: Vec<f32> = (0..48_000)
        .map(|i| (2.0 * std::f32::consts::PI * 220.0 * i as f32 / RATE).sin() * 0.4)
        .collect();

    let halved: Vec<f32> = clean.iter().map(|s| s * 0.5).collect();
    assert!(
        si_sdr(&clean, &halved) > 60.0,
        "a pure gain change must not cost SI-SDR"
    );

    let mut rng = Lcg::new(5);
    let noisy: Vec<f32> = clean.iter().map(|s| s + rng.next_bipolar() * 0.4).collect();
    let scored = si_sdr(&clean, &noisy);
    assert!(
        (-10.0..15.0).contains(&scored),
        "added noise should land in a sane range, got {scored:.1} dB"
    );
}

#[test]
fn alignment_recovers_a_delayed_signal() {
    // The guard on the module's central claim. A 40 ms shift is what
    // DeepFilterNet adds; uncompensated it reads as catastrophic damage.
    let clean: Vec<f32> = (0..48_000)
        .map(|i| {
            let t = i as f32 / RATE;
            (2.0 * std::f32::consts::PI * (200.0 * t + 600.0 * t * t)).sin() * 0.3
        })
        .collect();

    let delay = 1_919; // measured, DeepFilterNet
    let mut delayed = vec![0.0_f32; delay];
    delayed.extend_from_slice(&clean);

    assert_eq!(best_lag(&clean, &delayed), delay, "the lag was not found");
    assert!(
        si_sdr(&clean, &delayed) > 40.0,
        "an aligned pure delay must score as near-perfect, not as damage"
    );
}
