//! What the Voice page holds while it is open: the check of the voice (the
//! meter, the gate's calibration, the sample to hear oneself), and what it
//! keeps between visits (what the gate was calibrated for, how the noise
//! suppressor is tuned).
//!
//! The check is asked of the engine when the meter or a recording is first
//! started, looked at every [`TICK`] for as long as either runs, and let go
//! of with the page.

use std::collections::BTreeMap;
use std::time::Duration;

use gpui::Context;

use super::super::Shell;
use super::super::toasts::Kind;
use crate::sound_check::{Level, Sample, SoundCheck};

/// How often a running meter or sample is looked at.
pub(super) const TICK: Duration = Duration::from_millis(50);

/// How long the user has to speak for a calibration to be sure.
pub(super) const SPEECH_MS: u32 = 5_000;

/// How long "speaking" stays lit after the voice drops, so it does not
/// flicker: in ticks.
const SPEAKING_HOLD: u32 = 14;

/// The Voice page's own state.
#[derive(Default)]
pub(crate) struct VoicePage {
    check: Option<Box<dyn SoundCheck>>,
    /// Whether the meter runs.
    pub metering: bool,
    /// What is heard, and the peak held, placed along the meter.
    pub level: Level,
    pub peak: f32,
    /// How long the user has spoken while the meter ran, up to what a
    /// calibration wants.
    pub speech_ms: u32,
    /// Ticks for which "speaking" still shows.
    speaking: u32,
    pub sample: Sample,
    ticking: bool,
    /// What the gate was last calibrated for (see [`calibrated_for`]).
    pub calibrated_for: Option<String>,
    /// How the noise suppressor is tuned, by knob.
    pub knobs: BTreeMap<String, f32>,
}

impl VoicePage {
    /// As the page starts, with what was kept from before.
    pub(crate) fn remembering(
        calibrated_for: Option<String>,
        knobs: BTreeMap<String, f32>,
    ) -> Self {
        Self {
            calibrated_for,
            knobs,
            ..Self::default()
        }
    }

    /// Whether the check has been made, for a test to see that it was not
    /// before it was wanted and is gone after.
    #[cfg(test)]
    pub(crate) const fn has_check(&self) -> bool {
        self.check.is_some()
    }

    /// Whether what is heard right now counts as speech.
    pub(super) const fn speaking(&self) -> bool {
        self.speaking > 0
    }
}

/// What a calibration of the gate depends on, as the web UI fingerprints
/// it: the microphone and what is done to it before the gate. The gate
/// needs calibrating again when any of them changed.
pub(super) fn calibrated_for(shell: &Shell) -> String {
    let voice = &shell.voice_settings;
    format!(
        "{:?}|{}|{}|{:?}|{:?}",
        shell.chosen_devices.input,
        voice.automatic_gain,
        voice.noise_suppression,
        voice.denoiser,
        shell.panels.settings.voice.knobs
    )
}

/// The least that counts as speech for the calibration's five seconds:
/// most of the gate's opening level, and never nothing.
fn speech_floor(open: f32) -> f32 {
    (open * 0.7).max(0.005)
}

impl Shell {
    /// The check, made now if it was not yet.
    fn sound_check(&mut self) -> &mut Box<dyn SoundCheck> {
        let engine = std::sync::Arc::clone(&self.engine);
        self.panels
            .settings
            .voice
            .check
            .get_or_insert_with(|| engine.sound_check())
    }

    /// Start the meter, or stop it.
    pub(super) fn toggle_meter(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.voice.metering {
            if let Some(check) = &mut self.panels.settings.voice.check {
                check.stop_meter();
            }
            let page = &mut self.panels.settings.voice;
            page.metering = false;
            page.level = Level::default();
            page.peak = 0.0;
            page.speaking = 0;
        } else {
            let calibrating = self.voice_settings.auto_calibrate;
            match self.sound_check().start_meter(calibrating) {
                Ok(()) => {
                    let page = &mut self.panels.settings.voice;
                    page.metering = true;
                    page.speech_ms = 0;
                    self.keep_check_ticking(cx);
                }
                Err(error) => self.toast(error, Kind::Told, cx),
            }
        }
        cx.notify();
    }

    /// Start recording a sample, or move it on: stop recording and play it,
    /// or stop playing.
    pub(super) fn toggle_sample(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.voice.sample == Sample::Idle {
            let started = self.sound_check().start_sample();
            if let Err(error) = started {
                self.toast(error, Kind::Told, cx);
                return;
            }
        } else if let Some(check) = &mut self.panels.settings.voice.check {
            check.advance_sample();
        }
        self.keep_check_ticking(cx);
        cx.notify();
    }

    /// The page is left: everything the check started stops, and it is
    /// let go of.
    pub(super) fn leave_voice_page(&mut self) {
        let page = &mut self.panels.settings.voice;
        page.check = None;
        page.metering = false;
        page.level = Level::default();
        page.peak = 0.0;
        page.speaking = 0;
        page.sample = Sample::Idle;
    }

    /// Look at the check every [`TICK`] for as long as something runs.
    fn keep_check_ticking(&mut self, cx: &mut Context<Self>) {
        if self.panels.settings.voice.ticking {
            return;
        }
        self.panels.settings.voice.ticking = true;
        cx.spawn(async move |shell, cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                let going = shell.update(cx, Shell::check_tick);
                if !matches!(going, Ok(true)) {
                    break;
                }
            }
        })
        .detach();
    }

    /// Take in what the meter hears, a calibration the gate came to, and
    /// where the sample is; whether to go on looking.
    fn check_tick(&mut self, cx: &mut Context<Self>) -> bool {
        let open = self.voice_settings.threshold;
        let page = &mut self.panels.settings.voice;
        let Some(check) = &mut page.check else {
            page.ticking = false;
            return false;
        };
        let calibration = if page.metering {
            let level = check.level();
            let seconds = TICK.as_secs_f32();
            page.peak = super::super::kit::held_peak(page.peak, level.peak, seconds);
            page.level = level;
            if level.rms > speech_floor(open) {
                page.speech_ms = (page.speech_ms + 50).min(SPEECH_MS);
                page.speaking = SPEAKING_HOLD;
            } else {
                page.speaking = page.speaking.saturating_sub(1);
            }
            check.take_calibration()
        } else {
            None
        };
        page.sample = check.sample();
        let going = page.metering || page.sample != Sample::Idle;
        page.ticking = going;
        if let Some(gate) = calibration {
            self.panels.settings.voice.calibrated_for = Some(calibrated_for(self));
            self.change_voice(
                |voice| {
                    voice.threshold = gate.open;
                    voice.close_ratio = gate.close_ratio;
                    voice.hold_frames = gate.hold_frames;
                    voice.max_gain_db = gate.max_gain_db;
                },
                cx,
            );
        }
        cx.notify();
        going
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_is_most_of_the_opening_level_and_never_nothing() {
        assert!((speech_floor(0.02) - 0.014).abs() < 1e-6);
        assert!((speech_floor(0.0) - 0.005).abs() < 1e-6);
    }
}
