//! Env-gated inbound-audio statistics for the e2e suite.
//!
//! When `FANCY_E2E_AUDIO_STATS_FILE=<path>` is set, every received voice
//! packet is tallied per sender session and a JSON snapshot is written to
//! `<path>` once per second. The e2e tests poll that file to assert the
//! sender-side timing contract without touching the webview:
//!
//! - `nominal_samples` (from the Opus TOC, at 48 kHz) must grow at
//!   ~48 000/s of wall time - a sender that mislabels its capture rate
//!   fails this.
//! - `last_frame_number - first_frame_number` must equal
//!   `nominal_samples / 480` - Mumble's frame numbers count 10 ms frames,
//!   the contract official receivers time their jitter buffers by.
//! - `tone_ratio` (Goertzel at the probe frequency over the speaker's
//!   buffered decoded audio) proves the payload is the expected tone and
//!   not silence/garbage.
//! - `rms` is the plain level of that same window, and it exists because
//!   `tone_ratio` **cannot see loudness**: it is normalised by total
//!   power, so it reads 1.000 for a clean tone whether that tone arrives
//!   at full scale or 24 dB down. Anything that changes level rather than
//!   spectral content - a denoiser, AGC, a volume control - is invisible
//!   to every other field here.
//!
//! Everything is a no-op (a single `OnceLock` read) when the env var is
//! absent.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Instant;

use mumble_protocol::audio::mixer::SpeakerBuffers;

/// Env var: path of the JSON snapshot file (enables the module).
pub const ENV_STATS_FILE: &str = "FANCY_E2E_AUDIO_STATS_FILE";

/// Env var: directory to write per-speaker decoded WAVs into.
///
/// Separate from [`ENV_STATS_FILE`] because they answer different questions and
/// cost different amounts. The JSON is a few numbers a second; this is every
/// decoded sample, and it exists so a test can compare what arrived against
/// what was spoken - the only assertion that can tell speech from a tone that
/// merely survived.
pub const ENV_DUMP_DIR: &str = "FANCY_E2E_AUDIO_DUMP_DIR";

/// Probe frequency for the tone detector, matching the virtual mic's
/// default test tone.
const TONE_HZ: f64 = 440.0;

/// Decoded samples analysed per tone measurement (100 ms @ 48 kHz).
const TONE_WINDOW: usize = 4_800;

#[derive(Default, Clone, serde::Serialize)]
struct SessionStats {
    packets: u64,
    terminators: u64,
    first_frame_number: u64,
    last_frame_number: u64,
    /// Sum of per-packet Opus durations (48 kHz samples, from the TOC).
    nominal_samples: u64,
    /// Decoded samples currently buffered for playback (snapshot).
    buffered: usize,
    /// Goertzel power ratio at [`TONE_HZ`] over the last buffered window
    /// (1.0 = pure tone, ~0 = silence/noise). Snapshot of the last tick.
    tone_ratio: f64,
    /// RMS level of that same window, on the decoder's f32 scale.
    ///
    /// The only field here that reports *loudness*. A denoiser is a change
    /// in level, so without this the suite cannot distinguish audio that
    /// was cleaned up from audio that was crushed - or from a denoiser
    /// that was never linked into the build.
    rms: f64,
}

struct StatsInner {
    started: Instant,
    path: std::path::PathBuf,
    sessions: Mutex<HashMap<u32, SessionStats>>,
    buffers: Mutex<Option<SpeakerBuffers>>,
    writer_spawned: AtomicBool,
}

fn inner() -> Option<&'static StatsInner> {
    static INNER: OnceLock<Option<StatsInner>> = OnceLock::new();
    INNER
        .get_or_init(|| {
            let path = std::env::var(ENV_STATS_FILE).ok()?;
            tracing::warn!("e2e audio stats enabled -> {path}");
            Some(StatsInner {
                started: Instant::now(),
                path: path.into(),
                sessions: Mutex::new(HashMap::new()),
                buffers: Mutex::new(None),
                writer_spawned: AtomicBool::new(false),
            })
        })
        .as_ref()
}

/// Record one inbound voice packet. No-op unless the env var is set.
pub fn record_packet(session: u32, frame_number: u64, opus: &[u8], is_terminator: bool) {
    let Some(inner) = inner() else { return };
    {
        let Ok(mut sessions) = inner.sessions.lock() else {
            return;
        };
        let s = sessions.entry(session).or_default();
        if s.packets == 0 {
            s.first_frame_number = frame_number;
        }
        s.packets += 1;
        if is_terminator {
            s.terminators += 1;
        }
        s.last_frame_number = s.last_frame_number.max(frame_number);
        s.nominal_samples += u64::from(opus_nb_samples_48k(opus).unwrap_or(0));
    }
    // First packet lazily spawns the snapshot writer thread.
    if !inner.writer_spawned.swap(true, Ordering::Relaxed) {
        let _ = std::thread::Builder::new()
            .name("e2e-audio-stats".into())
            .spawn(move || writer_loop(inner));
    }
}

/// Register the live per-speaker decoded-audio buffers so the writer can
/// measure buffered depth and tone content. No-op unless enabled.
pub fn register_speaker_buffers(buffers: &SpeakerBuffers) {
    let Some(inner) = inner() else { return };
    if let Ok(mut slot) = inner.buffers.lock() {
        *slot = Some(buffers.clone());
    }
}

/// Decoded samples accumulated per speaker session.
type DumpBuffers = Mutex<HashMap<u32, Vec<f32>>>;

/// Accumulated decoded audio per speaker, written out on demand.
///
/// The outer `Option` is "dumping is off": set once, from the environment, so
/// the hot path checks a pointer rather than re-reading a variable.
static DUMP: OnceLock<Option<DumpBuffers>> = OnceLock::new();

fn dump_dir() -> Option<&'static str> {
    static DIR: OnceLock<Option<String>> = OnceLock::new();
    DIR.get_or_init(|| std::env::var(ENV_DUMP_DIR).ok())
        .as_deref()
}

/// Start recording every decoded sample, if [`ENV_DUMP_DIR`] is set.
///
/// Installs the mixer's decoded tap, which sees each sample exactly once and
/// includes inserted silence - so the dump is what the listener would have
/// heard, gaps and all, rather than what was successfully decoded.
///
/// Held in memory and written at the end rather than streamed: this is called
/// from the decode path, and opening or flushing a file there would put I/O on
/// the one thread that must never block. A minute of 48 kHz mono is 11 MB.
/// Written once a second by the thread this spawns, rather than at shutdown:
/// an e2e run kills the app rather than closing it politely, and a dump that
/// only existed after a clean exit would never exist at all.
///
/// The result is a **wall-clock timeline**, not a pile of decoded samples: a
/// pause during which the speaker sent nothing appears as silence of the right
/// length. That is the difference between a recording of what a listener heard
/// and a recording of what happened to be decoded.
pub fn start_audio_dump() {
    let Some(_) = dump_dir() else { return };
    if DUMP.set(Some(Mutex::new(HashMap::new()))).is_err() {
        return; // already started
    }
    tracing::warn!("e2e decoded-audio dump enabled");
    let started = Instant::now();
    mumble_protocol::audio::mixer::set_decoded_tap(Box::new(move |session, samples| {
        let Some(Some(dump)) = DUMP.get() else { return };
        if let Ok(mut per_session) = dump.lock() {
            let buf = per_session.entry(session).or_default();

            // **Pad to wall clock before appending.**
            //
            // Without this the dump is a pile of decoded samples rather than a
            // timeline: a speaker who stops talking simply stops producing
            // any, so the pause vanishes and everything after it slides
            // earlier. The mixer's own concealment does not cover it either -
            // `detect_certain_gap` caps insertion at 400 ms, so a one-second
            // pause still loses half a second.
            //
            // That is invisible to a packet count and fatal to a comparison
            // against the source: the received signal ends up non-uniformly
            // time-warped, which no single alignment can undo. Measured on a
            // real run it turned 12.2 s of speech into 11.3 s and dropped the
            // envelope correlation to 0.2.
            //
            // The tolerance absorbs ordinary jitter - decoded audio arrives in
            // bursts as packets do - so padding only appears for a gap larger
            // than any jitter buffer would explain.
            const RATE: f64 = 48_000.0;
            const TOLERANCE_SAMPLES: usize = 4_800; // 100 ms
            let due = (started.elapsed().as_secs_f64() * RATE) as usize;
            let have = buf.len() + samples.len();
            if due > have + TOLERANCE_SAMPLES {
                buf.resize(due - samples.len(), 0.0);
            }

            buf.extend_from_slice(samples);
        }
    }));
    let _ = std::thread::Builder::new()
        .name("e2e-audio-dump".into())
        .spawn(|| loop {
            std::thread::sleep(std::time::Duration::from_millis(1_000));
            let _ = write_audio_dump();
        });
}

/// Write one WAV per speaker into [`ENV_DUMP_DIR`], named `speaker-<session>.wav`.
///
/// Returns how many files were written. Callable more than once; each call
/// writes everything accumulated so far, so a test can take a snapshot without
/// stopping the audio.
pub fn write_audio_dump() -> usize {
    let (Some(dir), Some(Some(dump))) = (dump_dir(), DUMP.get()) else {
        return 0;
    };
    let Ok(per_session) = dump.lock() else {
        return 0;
    };
    if let Err(e) = std::fs::create_dir_all(dir) {
        tracing::warn!("e2e audio dump dir {dir}: {e}");
        return 0;
    }

    let mut written = 0;
    for (session, samples) in per_session.iter() {
        let path = std::path::Path::new(dir).join(format!("speaker-{session}.wav"));
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        match hound::WavWriter::create(&path, spec) {
            Ok(mut writer) => {
                for s in samples {
                    // Clamped rather than wrapped: a sample that overshot
                    // full scale is loud, and wrapping would render it as a
                    // sign flip - an artefact the analysis would then blame
                    // on the pipeline.
                    let clamped = s.clamp(-1.0, 1.0);
                    let _ = writer.write_sample((clamped * f32::from(i16::MAX)) as i16);
                }
                if writer.finalize().is_ok() {
                    written += 1;
                }
            }
            Err(e) => tracing::warn!("e2e audio dump {}: {e}", path.display()),
        }
    }
    tracing::warn!("e2e decoded-audio dump: wrote {written} file(s) to {dir}");
    written
}

fn writer_loop(inner: &'static StatsInner) {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(1_000));

        // Tone + buffer-depth snapshot from the decoded speaker buffers
        // (empty when the buffers are unavailable this tick).
        let mut tone: HashMap<u32, (usize, f64, f64)> = HashMap::new();
        'tone: {
            let Ok(slot) = inner.buffers.lock() else {
                break 'tone;
            };
            let Some(buffers) = slot.as_ref() else {
                break 'tone;
            };
            let Ok(bufs) = buffers.lock() else {
                break 'tone;
            };
            for (&session, buf) in bufs.iter() {
                let take = buf.len().min(TONE_WINDOW);
                let window: Vec<f32> = buf.iter().skip(buf.len() - take).copied().collect();
                let _ = tone.insert(
                    session,
                    (
                        buf.len(),
                        tone_ratio(&window, TONE_HZ, 48_000.0),
                        rms(&window),
                    ),
                );
            }
        }

        let snapshot = {
            let Ok(mut sessions) = inner.sessions.lock() else {
                continue;
            };
            for (session, (buffered, ratio, level)) in &tone {
                if let Some(s) = sessions.get_mut(session) {
                    s.buffered = *buffered;
                    s.tone_ratio = *ratio;
                    s.rms = *level;
                }
            }
            sessions.clone()
        };

        let doc = serde_json::json!({
            "wall_ms": inner.started.elapsed().as_millis() as u64,
            "sessions": snapshot,
        });
        if let Err(e) = std::fs::write(&inner.path, doc.to_string()) {
            tracing::warn!("e2e audio stats write failed: {e}");
        }
    }
}

/// Duration of an Opus packet in 48 kHz samples, parsed from the TOC byte
/// (RFC 6716 section 3.1) - no decoder needed.
fn opus_nb_samples_48k(packet: &[u8]) -> Option<u32> {
    let toc = *packet.first()?;
    let config = toc >> 3;
    let code = toc & 0x3;
    let per_frame: u32 = match config {
        // SILK NB/MB/WB: 10, 20, 40, 60 ms.
        0..=11 => match config % 4 {
            0 => 480,
            1 => 960,
            2 => 1920,
            _ => 2880,
        },
        // Hybrid SWB/FB: 10, 20 ms.
        12..=15 => {
            if config % 2 == 0 {
                480
            } else {
                960
            }
        }
        // CELT: 2.5, 5, 10, 20 ms.
        _ => match config % 4 {
            0 => 120,
            1 => 240,
            2 => 480,
            _ => 960,
        },
    };
    let frames: u32 = match code {
        0 => 1,
        1 | 2 => 2,
        _ => u32::from(*packet.get(1)? & 0x3F),
    };
    Some(per_frame * frames)
}

/// Normalised Goertzel power ratio of `freq` in `samples`: ~1.0 for a
/// pure sine at `freq`, ~0.0 for silence or unrelated content.
/// Plain RMS level of a decoded window.
///
/// Deliberately unnormalised, unlike [`tone_ratio`]: reporting a level
/// relative to anything would reintroduce exactly the blindness this
/// field exists to fix.
fn rms(samples: &[f32]) -> f64 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|s| f64::from(*s) * f64::from(*s)).sum();
    (sum / samples.len() as f64).sqrt()
}

fn tone_ratio(samples: &[f32], freq: f64, rate: f64) -> f64 {
    let n = samples.len();
    if n < 64 {
        return 0.0;
    }
    let w = 2.0 * std::f64::consts::PI * freq / rate;
    let coeff = 2.0 * w.cos();
    let (mut s1, mut s2) = (0.0f64, 0.0f64);
    let mut energy = 0.0f64;
    for &x in samples {
        let x = f64::from(x);
        energy += x * x;
        let s0 = x + coeff * s1 - s2;
        s2 = s1;
        s1 = s0;
    }
    let power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
    let mean_square = energy / n as f64;
    let denom = (n as f64 / 2.0).powi(2) * 2.0 * mean_square + f64::EPSILON;
    (power / denom).clamp(0.0, 1.0)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    #[allow(
        clippy::unusual_byte_groupings,
        reason = "the underscores mark the Opus TOC bit layout: config(5) | stereo(1) | code(2)"
    )]
    fn toc_parser_matches_known_durations() {
        // CELT fullband 20 ms (config 31), code 0 -> 960 samples.
        assert_eq!(opus_nb_samples_48k(&[0b11111_0_00]), Some(960));
        // CELT 10 ms (config 30), code 2 (two frames) -> 960.
        assert_eq!(opus_nb_samples_48k(&[0b11110_0_10]), Some(960));
        // SILK WB 20 ms (config 9), code 0 -> 960.
        assert_eq!(opus_nb_samples_48k(&[0b01001_0_00]), Some(960));
        // SILK NB 60 ms (config 3), code 0 -> 2880.
        assert_eq!(opus_nb_samples_48k(&[0b00011_0_00]), Some(2880));
        // Hybrid FB 10 ms (config 14), code 0 -> 480.
        assert_eq!(opus_nb_samples_48k(&[0b01110_0_00]), Some(480));
        // Code 3: frame count in the next byte (5 frames of 20 ms CELT).
        assert_eq!(opus_nb_samples_48k(&[0b11111_0_11, 5]), Some(4800));
        // Empty packet.
        assert_eq!(opus_nb_samples_48k(&[]), None);
    }

    #[test]
    fn tone_ratio_detects_sine_and_rejects_noise() {
        let rate = 48_000.0;
        let sine: Vec<f32> = (0..4800)
            .map(|i| (2.0 * std::f64::consts::PI * 440.0 * i as f64 / rate).sin() as f32 * 0.4)
            .collect();
        let r = tone_ratio(&sine, 440.0, rate);
        assert!(r > 0.8, "pure 440 Hz should score high, got {r}");

        let silence = vec![0.0f32; 4800];
        assert!(tone_ratio(&silence, 440.0, rate) < 0.01);

        let other: Vec<f32> = (0..4800)
            .map(|i| (2.0 * std::f64::consts::PI * 2_500.0 * i as f64 / rate).sin() as f32 * 0.4)
            .collect();
        let r = tone_ratio(&other, 440.0, rate);
        assert!(r < 0.05, "2.5 kHz tone should not score at 440 Hz, got {r}");
    }

    #[test]
    fn rms_sees_the_level_change_that_tone_ratio_cannot() {
        // The whole reason `rms` exists, asserted directly. A denoiser
        // that attenuates a clean tone by 24 dB leaves `tone_ratio`
        // untouched - it is normalised by total power - so a suite with
        // only that metric reports "the tone is present" about audio the
        // user can no longer hear.
        let rate = 48_000.0;
        let loud: Vec<f32> = (0..4800)
            .map(|i| (2.0 * std::f64::consts::PI * 440.0 * f64::from(i) / rate).sin() as f32 * 0.4)
            .collect();
        let quiet: Vec<f32> = loud.iter().map(|s| s * 0.0631).collect(); // -24 dB

        let (loud_ratio, quiet_ratio) = (
            tone_ratio(&loud, 440.0, rate),
            tone_ratio(&quiet, 440.0, rate),
        );
        assert!(
            (loud_ratio - quiet_ratio).abs() < 0.01,
            "tone_ratio is supposed to be blind to level; it moved {loud_ratio} -> {quiet_ratio}"
        );

        let (loud_rms, quiet_rms) = (rms(&loud), rms(&quiet));
        assert!(
            quiet_rms < loud_rms * 0.1,
            "rms must see the 24 dB drop: {loud_rms} -> {quiet_rms}"
        );
    }

    #[test]
    fn rms_of_silence_is_zero_and_of_nothing_does_not_divide_by_zero() {
        assert!(rms(&[0.0; 480]) < 1e-9);
        assert!((rms(&[]) - 0.0).abs() < f64::EPSILON);
    }
}
