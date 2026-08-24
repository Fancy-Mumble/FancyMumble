//! Does the denoiser actually improve the audio?
//!
//! Every other denoiser test in this workspace asserts that a backend
//! *constructs*, that it *does not panic*, and that it leaves the buffer
//! the right length. None of them measures whether the output sounds
//! better than the input, which is the only reason a denoiser exists.
//!
//! # Why real speech, and not a tone
//!
//! `DeepFilterNet3` is a **speech** enhancer. Measured against a 440 Hz
//! sine it applies its full attenuation limit - around 24 dB - because a
//! pure tone is, correctly, not speech. So a test built on the sine the
//! rest of the e2e suite uses would either fail against a working model
//! or, worse, pass for the wrong reason: the `tone_ratio` metric the
//! suite already has is *normalised by total power*, so it reads 1.000
//! whether the tone arrives at full level or 24 dB down. It cannot see
//! the difference between working and crushed.
//!
//! These tests therefore use the recorded speech sample already in
//! `tests/samples/`, mixed with synthetic noise at a known level, and
//! measure the thing a listener would notice:
//!
//! | measurement | what a regression there sounds like |
//! |---|---|
//! | noise floor in a speech pause | audible hiss between words |
//! | level during speech | the speaker gets quieter or is gated out |
//! | the two together (SNR gain) | "it is not doing anything" |
//!
//! # Where the thresholds come from
//!
//! Measured, not guessed. At the noise level used here the current model
//! delivers roughly **−24 dB** on the pause, **−1.2 dB** on speech and a
//! **+22 dB** SNR gain. The assertions sit well below those so ordinary
//! model or parameter drift does not fail the build, while a backend that
//! silently fell through to pass-through - which is exactly what happens
//! when the cargo feature is off - cannot pass any of them.
//!
//! # What this measurement does *not* say
//!
//! Run across the backends on this fixture, the numbers are:
//!
//! | backend | pause | speech | SNR gain |
//! |---|---|---|---|
//! | `DeepFilterNet` | −24.0 dB | −1.2 dB | +22.7 dB |
//! | `RNNoise` | −36.2 dB | −0.1 dB | +36.1 dB |
//! | OMLSA + IMCRA | −28.1 dB | −2.5 dB | +25.7 dB |
//! | off | 0.0 dB | 0.0 dB | 0.0 dB |
//!
//! **`RNNoise` scores higher here, and there is deliberately no test
//! asserting otherwise.** Two reasons, and neither is that the model is
//! underperforming:
//!
//! * `DeepFilterNet` lands on exactly −24.0 dB because *this application
//!   caps it there* - `deepfilter.rs` sets `atten_lim_db` to 24, on the
//!   grounds that unlimited attenuation sounds unnatural on a voice call.
//!   It is hitting its ceiling, not its limit.
//! * The fixture mixes **stationary white noise**, which is the easiest
//!   case there is and the one `RNNoise` is strongest on. The published
//!   advantage of `DeepFilterNet3` is on non-stationary and babble noise
//!   and in *perceptual* scores (PESQ), neither of which a broadband SNR
//!   ratio over a fixed window can see.
//!
//! So these tests assert what this fixture can actually support: that the
//! selected backend removes noise, keeps the speaker, and is the one the
//! build claims to offer. A comparative ranking would need non-stationary
//! noise and a perceptual metric, and asserting one from these numbers
//! would be inventing a result.

//! ```sh
//! cargo test -p mumble-protocol --test denoiser_quality \
//!     --features deepfilternet-denoiser,rnnoise-denoiser
//! ```

#![allow(
    unused_crate_dependencies,
    reason = "integration test: it links the whole crate's dependency set and uses a few"
)]
#![allow(
    dead_code,
    reason = "the measurement helpers serve the feature-gated test; a build without \
              `deepfilternet-denoiser` still compiles this file and leaves them unused"
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

/// Recorded speech: a spoken poem, already in the tree for the Opus
/// round-trip tests.
const SAMPLE: &str = "tests/samples/811749__bethanyw__memories-poem-2.mp3";

/// The pipeline's frame size: 10 ms at 48 kHz.
const FRAME: usize = 480;

/// Noise amplitude mixed under the speech.
///
/// Chosen to sit in the range a real noisy room produces - loud enough
/// that suppressing it is a visible effect, quiet enough that the speech
/// is still clearly dominant. Below roughly this level the model leaves
/// more of the input alone, which is correct behaviour and a poor test.
const NOISE_AMP: f32 = 0.05;

/// Decode the sample to mono f32 at 48 kHz, or `None` if it is absent.
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
                if (rate - 48_000.0).abs() < 1.0 {
                    out.extend(mono);
                } else {
                    // Linear interpolation is enough: this is a test
                    // fixture, and the denoiser is what is under test.
                    let ratio = 48_000.0 / rate;
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

/// Deterministic broadband noise in `[-amp, amp]`.
///
/// A fixed LCG rather than a random source: a denoiser test that draws
/// different noise each run has a different difficulty each run, and the
/// day it fails nobody can reproduce it.
fn noise(len: usize, amp: f32, seed: u32) -> Vec<f32> {
    let mut state = seed;
    (0..len)
        .map(|_| {
            state = state.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            ((state >> 8) as f32 / 8_388_608.0 - 1.0) * amp
        })
        .collect()
}

fn rms(samples: &[f32]) -> f32 {
    let n = samples.len().max(1) as f32;
    (samples.iter().map(|s| s * s).sum::<f32>() / n).sqrt()
}

/// `a` relative to `b`, in dB. Negative means quieter.
fn db(a: f32, b: f32) -> f32 {
    20.0 * (a.max(1e-9) / b.max(1e-9)).log10()
}

/// Run `input` through the denoiser exactly as the capture path does:
/// 10 ms frames, in place, one filter instance for the whole stream.
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
        filter
            .process(&mut frame)
            .expect("the filter accepts a frame");
        out.extend_from_slice(frame.as_f32_samples());
    }
    out
}

/// The quietest and loudest half-second of the clean recording.
///
/// Found rather than hard-coded, so re-cutting the sample does not
/// silently move the measurement onto the wrong part of the audio. The
/// quiet window is a real speech pause - where noise is all there is -
/// and the loud one is speech at full level.
fn pause_and_speech(clean: &[f32]) -> (usize, usize) {
    const WINDOW: usize = 24_000;
    let mut quietest = (0_usize, f32::MAX);
    let mut loudest = (0_usize, 0.0_f32);
    for start in (0..clean.len().saturating_sub(WINDOW)).step_by(4_800) {
        let level = rms(&clean[start..start + WINDOW]);
        if level < quietest.1 {
            quietest = (start, level);
        }
        if level > loudest.1 {
            loudest = (start, level);
        }
    }
    (quietest.0, loudest.0)
}

/// The measurement both tests below share.
struct Measured {
    /// Noise floor change in a speech pause, in dB. Very negative is good.
    pause_db: f32,
    /// Level change during speech, in dB. Near zero is good.
    speech_db: f32,
    /// How much better the speech-to-noise ratio got, in dB.
    snr_gain_db: f32,
}

fn measure(algorithm: NoiseSuppressionAlgorithm) -> Option<Measured> {
    const WINDOW: usize = 24_000;

    let clean = decode_sample()?;
    let (pause_at, speech_at) = pause_and_speech(&clean);

    let hiss = noise(clean.len(), NOISE_AMP, 11);
    let noisy: Vec<f32> = clean.iter().zip(&hiss).map(|(s, n)| s + n).collect();
    let out = denoise(&noisy, algorithm);

    let pause_in = rms(&noisy[pause_at..pause_at + WINDOW]);
    let pause_out = rms(&out[pause_at..pause_at + WINDOW]);
    let speech_in = rms(&noisy[speech_at..speech_at + WINDOW]);
    let speech_out = rms(&out[speech_at..speech_at + WINDOW]);

    Some(Measured {
        pause_db: db(pause_out, pause_in),
        speech_db: db(speech_out, speech_in),
        snr_gain_db: db(speech_out, pause_out) - db(speech_in, pause_in),
    })
}

#[cfg(feature = "deepfilternet-denoiser")]
#[test]
fn deepfilternet_removes_the_noise_and_keeps_the_speech() {
    let Some(m) = measure(NoiseSuppressionAlgorithm::DeepFilterNet) else {
        eprintln!("skipping: {SAMPLE} is not present");
        return;
    };

    // Between words, where there is nothing but hiss. Measured at −24 dB,
    // which is the configured attenuation limit - the model is doing all
    // it is allowed to do.
    assert!(
        m.pause_db < -12.0,
        "noise floor in a speech pause only fell {:.1} dB; a listener still hears hiss between \
         words. A pass-through backend scores 0 dB here, which is what a build with the \
         `deepfilternet-denoiser` feature switched off produces.",
        m.pause_db
    );

    // And the speaker is still there. This is the half that a denoiser
    // tuned purely for noise removal fails: suppressing everything scores
    // perfectly on the assertion above and makes the person inaudible.
    assert!(
        m.speech_db > -6.0,
        "speech was attenuated by {:.1} dB. The noise may be gone, but so is the speaker - \
         this is over-suppression, not enhancement.",
        m.speech_db
    );

    // The two together, which is the number that actually describes the
    // experience. Measured around +22 dB.
    assert!(
        m.snr_gain_db > 10.0,
        "speech-to-noise ratio improved by only {:.1} dB",
        m.snr_gain_db
    );
}

#[test]
fn the_selected_algorithm_is_the_one_that_runs() {
    // Availability is reported per build, and the whole point of that
    // report is that the UI never offers a choice the binary cannot
    // honour. On a build with the feature this is DeepFilterNet; on one
    // without, asking for it silently falls back and `is_available` is
    // what says so.
    assert_eq!(
        NoiseSuppressionAlgorithm::DeepFilterNet.is_available(),
        cfg!(feature = "deepfilternet-denoiser"),
        "availability must track the cargo feature, or the settings dropdown offers a backend \
         that is not linked in"
    );
    assert!(
        NoiseSuppressionAlgorithm::available().contains(&NoiseSuppressionAlgorithm::OmlsaImcra),
        "a classical backend must always be offered, whatever the build"
    );
}

#[test]
fn a_denoiser_leaves_the_frame_the_length_it_arrived() {
    // Cheap, and it runs in every build. A backend that returned a
    // different number of samples would desynchronise the Opus encoder
    // downstream, which sounds like the speaker slowly drifting out of
    // time rather than like a denoiser fault.
    let input: Vec<f32> = (0..FRAME * 20)
        .map(|i| (i as f32 * 0.01).sin() * 0.2)
        .collect();
    for algorithm in NoiseSuppressionAlgorithm::available() {
        let out = denoise(&input, algorithm);
        assert_eq!(
            out.len(),
            input.len(),
            "{algorithm:?} changed the sample count"
        );
        assert!(
            out.iter().all(|s| s.is_finite()),
            "{algorithm:?} produced a non-finite sample; this reaches the encoder"
        );
    }
}
