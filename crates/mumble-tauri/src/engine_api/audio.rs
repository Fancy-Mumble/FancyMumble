//! The voice settings as a whole, and the engine's ways of checking them:
//! the microphone's level as the gate sees it, calibrating the gate from
//! it, hearing oneself through the filters, and how the voice packets
//! fare. What the web client's Voice page asks of the engine, for a view
//! that is not the web page.

use super::EngineHandle;

pub use crate::state::types::AudioSettings;
pub use mumble_protocol::audio::filter::denoiser::{DenoiserParamSpec, NoiseSuppressionAlgorithm};

/// Where hearing oneself stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Replay {
    /// Nothing recorded or playing.
    #[default]
    Idle,
    /// Recording, through the filters the listeners hear.
    Recording {
        /// How long so far.
        elapsed_ms: u32,
        /// The longest it records.
        capacity_ms: u32,
    },
    /// Playing what was recorded.
    Playing {
        /// How far in.
        elapsed_ms: u32,
        /// How long it is.
        total_ms: u32,
    },
}

impl From<crate::state::types::VoiceReplayState> for Replay {
    fn from(state: crate::state::types::VoiceReplayState) -> Self {
        use crate::state::types::VoiceReplayState;
        match state {
            VoiceReplayState::Idle => Self::Idle,
            VoiceReplayState::Recording {
                elapsed_ms,
                capacity_ms,
            } => Self::Recording {
                elapsed_ms,
                capacity_ms,
            },
            VoiceReplayState::Playing {
                elapsed_ms,
                total_ms,
            } => Self::Playing {
                elapsed_ms,
                total_ms,
            },
        }
    }
}

/// How the voice packets of one direction fared since connecting.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct PacketCounts {
    /// Arrived in time.
    pub good: u32,
    /// Arrived too late to be played.
    pub late: u32,
    /// Never arrived.
    pub lost: u32,
    /// Times the decryption had to start over.
    pub resync: u32,
}

/// How the voice packets fared, both ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VoiceStats {
    /// What the server sent and this client received.
    pub to_client: PacketCounts,
    /// What this client sent, as the server counted it.
    pub from_client: PacketCounts,
}

impl From<&crate::state::types::PacketStats> for PacketCounts {
    fn from(stats: &crate::state::types::PacketStats) -> Self {
        Self {
            good: stats.good,
            late: stats.late,
            lost: stats.lost,
            resync: stats.resync,
        }
    }
}

/// A level from 0 to 1 in millionths: fine enough for a meter that reads
/// down to a thousandth (-60 dB).
pub(super) fn millionths(level: f32) -> u32 {
    (f64::from(level).clamp(0.0, 1.0) * 1_000_000.0).round() as u32
}

/// Make no device be touched from now on: every capture is a voice made
/// up on the spot, every playback goes nowhere at the pace it would be
/// heard. For a view that must stay silent; nothing turns it back.
pub fn keep_silent() {
    crate::audio::set_silent(true);
}

/// The noise suppressors this build carries.
pub fn denoisers() -> Vec<NoiseSuppressionAlgorithm> {
    NoiseSuppressionAlgorithm::available()
}

/// The knobs `algorithm` can be tuned with; none for one with nothing to
/// tune.
pub fn denoiser_knobs(algorithm: NoiseSuppressionAlgorithm) -> Vec<DenoiserParamSpec> {
    mumble_protocol::audio::filter::denoiser::algorithm_param_specs(algorithm).to_vec()
}

/// Whether the legacy audio backend (cpal) is used rather than rodio.
pub fn legacy_backend() -> bool {
    !crate::audio::is_rodio_backend()
}

/// Use the legacy audio backend from the next time voice is turned on.
pub fn set_legacy_backend(legacy: bool) {
    crate::audio::set_use_rodio_backend(!legacy);
}

impl EngineHandle {
    /// Every voice setting, as the engine holds them.
    pub fn audio_settings(&self) -> AudioSettings {
        self.state.audio_settings()
    }

    /// Use `settings`, all of them, at once: the pipelines start again
    /// where a change needs that.
    ///
    /// # Errors
    ///
    /// When a pipeline could not be started again.
    pub fn set_audio_settings(&self, settings: AudioSettings) -> Result<(), String> {
        self.state.apply_audio_settings(settings)
    }

    /// Start the microphone's meter: its level, after the filters, arrives
    /// as [`super::EngineEvent::MicLevel`]. With the gate set to calibrate
    /// itself it does so from what it hears, and says
    /// [`super::EngineEvent::GateCalibrated`] when it has.
    ///
    /// # Errors
    ///
    /// When the microphone cannot be opened.
    pub fn start_meter(&self) -> Result<(), String> {
        self.state.start_mic_test()
    }

    /// Stop the meter.
    pub fn stop_meter(&self) {
        self.state.stop_mic_test();
    }

    /// Record up to twenty seconds through the filters the listeners hear,
    /// then play it back; how it goes arrives as
    /// [`super::EngineEvent::Replay`].
    ///
    /// # Errors
    ///
    /// When the microphone or the speakers cannot be opened.
    pub fn start_replay(&self) -> Result<(), String> {
        self.state.start_voice_replay()
    }

    /// Stop recording and play back, or stop playing.
    pub fn advance_replay(&self) {
        self.state.stop_voice_replay();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_level_is_kept_to_a_millionth() {
        assert_eq!(millionths(0.001), 1_000);
        assert_eq!(millionths(1.5), 1_000_000);
        assert_eq!(millionths(-1.0), 0);
        assert_eq!(
            Replay::from(crate::state::types::VoiceReplayState::Playing {
                elapsed_ms: 5,
                total_ms: 9
            }),
            Replay::Playing {
                elapsed_ms: 5,
                total_ms: 9
            }
        );
    }
}
