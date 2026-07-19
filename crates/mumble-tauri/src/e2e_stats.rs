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

fn writer_loop(inner: &'static StatsInner) {
    loop {
        std::thread::sleep(std::time::Duration::from_millis(1_000));

        // Tone + buffer-depth snapshot from the decoded speaker buffers
        // (empty when the buffers are unavailable this tick).
        let mut tone: HashMap<u32, (usize, f64)> = HashMap::new();
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
                let _ = tone.insert(session, (buf.len(), tone_ratio(&window, TONE_HZ, 48_000.0)));
            }
        }

        let snapshot = {
            let Ok(mut sessions) = inner.sessions.lock() else {
                continue;
            };
            for (session, (buffered, ratio)) in &tone {
                if let Some(s) = sessions.get_mut(session) {
                    s.buffered = *buffered;
                    s.tone_ratio = *ratio;
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
}
