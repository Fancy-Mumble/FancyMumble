//! What the real engine says of the voice check, kept for the view to read:
//! the meter's latest level, that the gate calibrated itself, where the
//! sample is, and how the voice packets fare. Written from the engine's
//! threads, read by the view when it looks.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, PoisonError};

use mumble_tauri_lib::engine_api::audio::{PacketCounts as EnginePackets, Replay, VoiceStats};

use super::{Level, PacketCounts, Sample, Stats};

/// What the engine last said.
#[derive(Debug, Default)]
pub(crate) struct Heard {
    /// The level, in millionths: written at the meter's pace, so kept in
    /// atomics rather than behind a lock the view would wait on.
    rms: AtomicU32,
    peak: AtomicU32,
    calibrated: AtomicBool,
    sample: Mutex<Sample>,
    stats: Mutex<Option<Stats>>,
}

fn counts(packets: EnginePackets) -> PacketCounts {
    PacketCounts {
        good: packets.good,
        late: packets.late,
        lost: packets.lost,
        resync: packets.resync,
    }
}

impl Heard {
    /// The meter's level, as the engine says it.
    pub(crate) fn hear_level(&self, rms: u32, peak: u32) {
        self.rms.store(rms, Ordering::Relaxed);
        self.peak.store(peak, Ordering::Relaxed);
    }

    pub(crate) fn level(&self) -> Level {
        let read = |held: &AtomicU32| held.load(Ordering::Relaxed) as f32 / 1_000_000.0;
        Level {
            rms: read(&self.rms),
            peak: read(&self.peak),
        }
    }

    /// The meter stopped: nothing is heard any more.
    pub(crate) fn silence(&self) {
        self.hear_level(0, 0);
    }

    pub(crate) fn hear_calibrated(&self) {
        self.calibrated.store(true, Ordering::Relaxed);
    }

    /// Whether the gate calibrated itself since last asked.
    pub(crate) fn take_calibrated(&self) -> bool {
        self.calibrated.swap(false, Ordering::Relaxed)
    }

    pub(crate) fn hear_replay(&self, replay: Replay) {
        *self.sample.lock().unwrap_or_else(PoisonError::into_inner) = match replay {
            Replay::Idle => Sample::Idle,
            Replay::Recording {
                elapsed_ms,
                capacity_ms,
            } => Sample::Recording {
                elapsed_ms,
                capacity_ms,
            },
            Replay::Playing {
                elapsed_ms,
                total_ms,
            } => Sample::Playing {
                elapsed_ms,
                total_ms,
            },
        };
    }

    pub(crate) fn sample(&self) -> Sample {
        *self.sample.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub(crate) fn hear_stats(&self, stats: VoiceStats) {
        *self.stats.lock().unwrap_or_else(PoisonError::into_inner) = Some(Stats {
            to_client: counts(stats.to_client),
            from_client: counts(stats.from_client),
        });
    }

    /// The server went: its counts are no longer the connection's.
    pub(crate) fn forget_stats(&self) {
        *self.stats.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    pub(crate) fn stats(&self) -> Option<Stats> {
        *self.stats.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_engine_says_is_read_back() {
        let heard = Heard::default();
        heard.hear_level(250_000, 500_000);
        assert!((heard.level().rms - 0.25).abs() < 1e-6);
        assert!((heard.level().peak - 0.5).abs() < 1e-6);
        heard.silence();
        assert_eq!(heard.level(), Level::default());
        assert!(!heard.take_calibrated());
        heard.hear_calibrated();
        assert!(heard.take_calibrated());
        assert!(!heard.take_calibrated(), "once");
        heard.hear_replay(Replay::Recording {
            elapsed_ms: 1,
            capacity_ms: 2,
        });
        assert_eq!(
            heard.sample(),
            Sample::Recording {
                elapsed_ms: 1,
                capacity_ms: 2
            }
        );
        assert_eq!(heard.stats(), None);
        heard.hear_stats(VoiceStats::default());
        assert_eq!(heard.stats(), Some(Stats::default()));
        heard.forget_stats();
        assert_eq!(heard.stats(), None);
    }
}
