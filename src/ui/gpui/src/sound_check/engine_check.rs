//! The real engine's voice check: its meter, its calibration and its
//! replay, with what it says of them kept in [`Heard`].

use std::sync::Arc;

use mumble_tauri_lib::engine_api::EngineHandle;

use super::heard::Heard;
use super::{Gate, Level, Sample, SoundCheck};

/// Checks the voice through the engine. Whatever it started stops when it
/// is let go of.
pub(crate) struct EngineCheck {
    engine: EngineHandle,
    heard: Arc<Heard>,
    metering: bool,
}

impl EngineCheck {
    pub(crate) fn new(engine: EngineHandle, heard: Arc<Heard>) -> Self {
        Self {
            engine,
            heard,
            metering: false,
        }
    }
}

impl SoundCheck for EngineCheck {
    fn start_meter(&mut self, _calibrating: bool) -> Result<(), String> {
        // The engine reads whether to calibrate from its own settings.
        let _ = self.heard.take_calibrated();
        self.engine.start_meter()?;
        self.metering = true;
        Ok(())
    }

    fn stop_meter(&mut self) {
        self.engine.stop_meter();
        self.metering = false;
        self.heard.silence();
    }

    fn level(&self) -> Level {
        self.heard.level()
    }

    fn take_calibration(&mut self) -> Option<Gate> {
        if !self.heard.take_calibrated() {
            return None;
        }
        let settings = self.engine.audio_settings();
        Some(Gate {
            open: settings.vad_threshold,
            close_ratio: settings.noise_gate_close_ratio,
            hold_frames: settings.hold_frames,
            max_gain_db: settings.max_gain_db,
        })
    }

    fn start_sample(&mut self) -> Result<(), String> {
        self.engine.start_replay()
    }

    fn advance_sample(&mut self) {
        self.engine.advance_replay();
    }

    fn sample(&self) -> Sample {
        self.heard.sample()
    }
}

impl Drop for EngineCheck {
    fn drop(&mut self) {
        if self.metering {
            self.stop_meter();
        }
        // Recording stops into playing, and playing stops: twice ends
        // whichever it is in.
        if self.heard.sample() != Sample::Idle {
            self.engine.advance_replay();
            self.engine.advance_replay();
        }
    }
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, Instant};

    use crate::engine::Engine as _;
    use crate::sound_check::Sample;

    /// Wait up to `within` for `done`.
    fn until(within: Duration, mut done: impl FnMut() -> bool) -> bool {
        let began = Instant::now();
        while began.elapsed() < within {
            if done() {
                return true;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        false
    }

    /// The real engine's meter, calibration and replay, run on the voice the
    /// engine makes up when it is kept silent (as it is under test): no
    /// microphone is opened and nothing is played.
    #[test]
    fn the_engines_meter_calibration_and_replay_run_silently() {
        let dir = std::env::temp_dir().join(format!("fancy-gpui-check-{}", std::process::id()));
        let engine = crate::real::RealEngine::start(&dir).expect("the engine starts");
        let mut voice = engine.voice_settings();
        voice.auto_calibrate = true;
        engine.set_voice_settings(voice);

        let mut check = engine.sound_check();
        check.start_meter(true).expect("the meter starts");
        assert!(
            until(Duration::from_secs(10), || check.level().rms > 0.01),
            "the made-up voice is heard: {:?}",
            check.level()
        );
        assert!(
            until(Duration::from_secs(15), || check
                .take_calibration()
                .is_some()),
            "the gate calibrated itself"
        );
        check.stop_meter();

        check.start_sample().expect("a sample starts");
        assert!(until(Duration::from_secs(3), || matches!(
            check.sample(),
            Sample::Recording { elapsed_ms, .. } if elapsed_ms >= 600
        )));
        check.advance_sample();
        assert!(
            until(Duration::from_secs(3), || matches!(
                check.sample(),
                Sample::Playing { .. }
            )),
            "{:?}",
            check.sample()
        );
        assert!(
            until(Duration::from_secs(5), || check.sample() == Sample::Idle),
            "played to its end on no device: {:?}",
            check.sample()
        );
        drop(check);
        engine.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
}
