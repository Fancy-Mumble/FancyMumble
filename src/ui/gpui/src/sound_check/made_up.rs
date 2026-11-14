//! A made-up voice check, for the demo engine and tests: a voice that
//! speaks in phrases and pauses by the made-up clock, a gate that has
//! calibrated itself once five seconds of it were heard, and a sample that
//! records and plays back by the same clock. No device is touched.

use crate::voice::made_up::Studio;

use super::{Gate, Level, REPLAY_MS, Sample, SoundCheck};

/// How long the meter must run while calibrating before the gate has
/// tuned itself: the five seconds of speech the web UI asks for.
pub(crate) const CALIBRATES_IN_MS: u64 = 5_000;

/// What the made-up gate calibrates itself to.
pub(crate) const CALIBRATED: Gate = Gate {
    open: 0.012,
    close_ratio: 0.75,
    hold_frames: 12,
    max_gain_db: 18.0,
};

/// The made-up voice's level `ms` into the meter: phrases of 1.8 s with a
/// 0.6 s pause after each, over a faint hiss.
pub(crate) fn level_at(ms: u64) -> Level {
    let in_phrase = ms % 2_400;
    if in_phrase >= 1_800 {
        return Level {
            rms: 0.0015,
            peak: 0.004,
        };
    }
    let syllable = (in_phrase as f64 / 1_000.0 * 4.0 * std::f64::consts::PI)
        .sin()
        .abs();
    let rms = (0.004 + 0.12 * syllable) as f32;
    Level {
        rms,
        peak: (rms * 2.4).min(1.0),
    }
}

/// The made-up check.
#[derive(Debug)]
pub(crate) struct MadeUpCheck {
    studio: Studio,
    /// When the meter started, and whether it calibrates.
    meter: Option<(u64, bool)>,
    /// Whether the calibration was handed over.
    calibration_taken: bool,
    /// When the sample started recording, and when it stopped, once it did.
    sample: Option<(u64, Option<u64>)>,
}

impl MadeUpCheck {
    pub(crate) fn new(studio: Studio) -> Self {
        Self {
            studio,
            meter: None,
            calibration_taken: false,
            sample: None,
        }
    }
}

impl SoundCheck for MadeUpCheck {
    fn start_meter(&mut self, calibrating: bool) -> Result<(), String> {
        self.meter = Some((self.studio.now_ms(), calibrating));
        self.calibration_taken = false;
        Ok(())
    }

    fn stop_meter(&mut self) {
        self.meter = None;
    }

    fn level(&self) -> Level {
        self.meter.map_or_else(Level::default, |(from, _)| {
            level_at(self.studio.now_ms().saturating_sub(from))
        })
    }

    fn take_calibration(&mut self) -> Option<Gate> {
        let (from, calibrating) = self.meter?;
        let heard = self.studio.now_ms().saturating_sub(from);
        if !calibrating || self.calibration_taken || heard < CALIBRATES_IN_MS {
            return None;
        }
        self.calibration_taken = true;
        Some(CALIBRATED)
    }

    fn start_sample(&mut self) -> Result<(), String> {
        self.sample = Some((self.studio.now_ms(), None));
        Ok(())
    }

    fn advance_sample(&mut self) {
        let now = self.studio.now_ms();
        self.sample = match self.sample {
            Some((from, None)) => Some((from, Some(now))),
            _ => None,
        };
    }

    fn sample(&self) -> Sample {
        let Some((from, stopped)) = self.sample else {
            return Sample::Idle;
        };
        let now = self.studio.now_ms();
        let capacity = u64::from(REPLAY_MS);
        // A recording that ran its whole length plays by itself.
        let stopped = stopped.or_else(|| (now - from >= capacity).then_some(from + capacity));
        let ms = |span: u64| u32::try_from(span).unwrap_or(u32::MAX);
        match stopped {
            None => Sample::Recording {
                elapsed_ms: ms(now - from),
                capacity_ms: REPLAY_MS,
            },
            Some(stopped) => {
                let total = stopped - from;
                let played = now.saturating_sub(stopped);
                if played >= total {
                    Sample::Idle
                } else {
                    Sample::Playing {
                        elapsed_ms: ms(played),
                        total_ms: ms(total),
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_made_up_voice_speaks_and_pauses() {
        assert!(level_at(125).rms > 0.1, "mid-syllable");
        assert!(level_at(2_000).rms < 0.002, "in the pause");
        assert!(level_at(2_000).peak > level_at(2_000).rms);
    }

    #[test]
    fn the_gate_calibrates_after_five_seconds_once_and_only_when_asked() {
        let studio = Studio::default();
        let mut check = MadeUpCheck::new(studio.clone());
        assert_eq!(check.level(), Level::default(), "nothing before the meter");
        check.start_meter(true).expect("starts");
        studio.advance(4_000);
        assert_eq!(check.take_calibration(), None);
        studio.advance(1_000);
        assert_eq!(check.take_calibration(), Some(CALIBRATED));
        assert_eq!(check.take_calibration(), None, "once");
        check.start_meter(false).expect("starts");
        studio.advance(9_000);
        assert_eq!(check.take_calibration(), None, "not by hand");
    }

    #[test]
    fn a_sample_records_then_plays_as_long_as_it_recorded() {
        let studio = Studio::default();
        let mut check = MadeUpCheck::new(studio.clone());
        check.start_sample().expect("starts");
        studio.advance(3_000);
        assert_eq!(
            check.sample(),
            Sample::Recording {
                elapsed_ms: 3_000,
                capacity_ms: REPLAY_MS
            }
        );
        check.advance_sample();
        studio.advance(1_000);
        assert_eq!(
            check.sample(),
            Sample::Playing {
                elapsed_ms: 1_000,
                total_ms: 3_000
            }
        );
        studio.advance(2_000);
        assert_eq!(check.sample(), Sample::Idle);
        // One left to run fills twenty seconds and plays by itself.
        check.start_sample().expect("starts");
        studio.advance(25_000);
        assert_eq!(
            check.sample(),
            Sample::Playing {
                elapsed_ms: 5_000,
                total_ms: REPLAY_MS
            }
        );
    }
}
