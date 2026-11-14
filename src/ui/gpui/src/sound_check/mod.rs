//! Checking the voice: the microphone's level against the gate, the gate
//! calibrating itself from it, and hearing oneself through the filters.
//! What the Voice page needs of audio, behind one trait, [`SoundCheck`].
//!
//! The real engine's (`engine_check`) runs the engine's own meter and
//! replay; the demo's (`made_up`) makes the levels up by a clock. Neither
//! is made before the page is open and the meter or a recording is
//! started, and both are let go when the page is left.

pub(crate) mod engine_check;
pub(crate) mod heard;
pub(crate) mod made_up;
pub(crate) mod settings;

use mumble_tauri_lib::engine_api::audio::{DenoiserParamSpec, NoiseSuppressionAlgorithm};

/// The microphone's level, after the filters: what the gate judges.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Level {
    /// Its loudness, 0 to 1.
    pub rms: f32,
    /// Its loudest sample, 0 to 1.
    pub peak: f32,
}

/// Where hearing oneself stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Sample {
    #[default]
    Idle,
    Recording {
        elapsed_ms: u32,
        capacity_ms: u32,
    },
    Playing {
        elapsed_ms: u32,
        total_ms: u32,
    },
}

impl Sample {
    /// How full the button's bar is, 0 to 1: a recording fills it, playing
    /// empties it again, as the web UI's does.
    pub(crate) fn progress(self) -> f32 {
        match self {
            Self::Idle => 0.0,
            Self::Recording {
                elapsed_ms,
                capacity_ms,
            } => elapsed_ms as f32 / capacity_ms.max(1) as f32,
            Self::Playing {
                elapsed_ms,
                total_ms,
            } => total_ms.saturating_sub(elapsed_ms) as f32 / REPLAY_MS as f32,
        }
    }
}

/// The longest sample, as the engine records one.
pub(crate) const REPLAY_MS: u32 = 20_000;

/// What a calibration of the gate came to.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Gate {
    /// The level that opens it, 0 to 1.
    pub open: f32,
    /// The level that closes it, as a part of the open one.
    pub close_ratio: f32,
    /// Frames it stays open after the voice drops.
    pub hold_frames: u32,
    /// The most automatic gain may raise the voice by, in dB.
    pub max_gain_db: f32,
}

/// How the voice packets of one direction fared.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct PacketCounts {
    pub good: u32,
    pub late: u32,
    pub lost: u32,
    pub resync: u32,
}

impl PacketCounts {
    /// The part lost, as a percentage with one decimal.
    pub(crate) fn loss(self) -> String {
        let total = u64::from(self.good) + u64::from(self.late) + u64::from(self.lost);
        if total == 0 {
            return "0.0".to_owned();
        }
        format!("{:.1}", self.lost as f64 * 100.0 / total as f64)
    }
}

/// How the voice packets fared since connecting, both ways.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Stats {
    pub to_client: PacketCounts,
    pub from_client: PacketCounts,
}

/// What the Voice page asks of audio.
pub(crate) trait SoundCheck {
    /// Start the meter; with `calibrating`, the gate tunes itself from
    /// what it hears.
    fn start_meter(&mut self, calibrating: bool) -> Result<(), String>;

    fn stop_meter(&mut self);

    /// The latest level.
    fn level(&self) -> Level;

    /// What the gate calibrated itself to, once, since last asked.
    fn take_calibration(&mut self) -> Option<Gate>;

    /// Start recording a sample to hear.
    fn start_sample(&mut self) -> Result<(), String>;

    /// Stop recording and play it, or stop playing.
    fn advance_sample(&mut self);

    fn sample(&self) -> Sample;
}

/// A noise suppressor, as the engine names them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum Denoiser {
    #[default]
    Rnnoise,
    #[serde(rename = "deepfilternet")]
    DeepFilterNet,
    OmlsaImcra,
    SpectralSubtraction,
}

impl Denoiser {
    /// Every one, in the order the web UI offers them.
    #[cfg(test)]
    pub(crate) const ALL: [Self; 4] = [
        Self::Rnnoise,
        Self::DeepFilterNet,
        Self::OmlsaImcra,
        Self::SpectralSubtraction,
    ];

    /// The engine's name for it.
    pub(crate) const fn engine(self) -> NoiseSuppressionAlgorithm {
        match self {
            Self::Rnnoise => NoiseSuppressionAlgorithm::Rnnoise,
            Self::DeepFilterNet => NoiseSuppressionAlgorithm::DeepFilterNet,
            Self::OmlsaImcra => NoiseSuppressionAlgorithm::OmlsaImcra,
            Self::SpectralSubtraction => NoiseSuppressionAlgorithm::SpectralSubtraction,
        }
    }

    /// The one the engine names `algorithm`; `None` for no suppression.
    pub(crate) const fn of(algorithm: NoiseSuppressionAlgorithm) -> Option<Self> {
        match algorithm {
            NoiseSuppressionAlgorithm::None => None,
            NoiseSuppressionAlgorithm::Rnnoise => Some(Self::Rnnoise),
            NoiseSuppressionAlgorithm::DeepFilterNet => Some(Self::DeepFilterNet),
            NoiseSuppressionAlgorithm::OmlsaImcra => Some(Self::OmlsaImcra),
            NoiseSuppressionAlgorithm::SpectralSubtraction => Some(Self::SpectralSubtraction),
        }
    }

    /// The ones this build carries.
    pub(crate) fn available() -> Vec<Self> {
        mumble_tauri_lib::engine_api::audio::denoisers()
            .into_iter()
            .filter_map(Self::of)
            .collect()
    }

    /// The knobs it can be tuned with; none for one with nothing to tune.
    pub(crate) fn knobs(self) -> Vec<DenoiserParamSpec> {
        mumble_tauri_lib::engine_api::audio::denoiser_knobs(self.engine())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_sample_fills_its_bar_recording_and_empties_it_playing() {
        assert!((Sample::Idle.progress()).abs() < f32::EPSILON);
        let half = Sample::Recording {
            elapsed_ms: 10_000,
            capacity_ms: 20_000,
        };
        assert!((half.progress() - 0.5).abs() < 1e-6);
        let played = Sample::Playing {
            elapsed_ms: 1_000,
            total_ms: 5_000,
        };
        assert!((played.progress() - 0.2).abs() < 1e-6);
        let counts = PacketCounts {
            good: 98,
            late: 1,
            lost: 1,
            resync: 0,
        };
        assert_eq!(counts.loss(), "1.0");
        assert_eq!(PacketCounts::default().loss(), "0.0");
    }

    #[test]
    fn a_denoiser_is_named_as_the_engine_names_it() {
        for denoiser in Denoiser::ALL {
            assert_eq!(Denoiser::of(denoiser.engine()), Some(denoiser));
        }
        assert_eq!(Denoiser::of(NoiseSuppressionAlgorithm::None), None);
        assert_eq!(
            serde_json::to_string(&Denoiser::OmlsaImcra).expect("json"),
            "\"omlsa_imcra\""
        );
        assert!(Denoiser::available().contains(&Denoiser::SpectralSubtraction));
    }
}
