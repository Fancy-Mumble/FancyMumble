//! The view's voice settings to the engine's and back.

use mumble_tauri_lib::engine_api::audio::{AudioSettings, NoiseSuppressionAlgorithm};

use super::Denoiser;
use crate::engine::VoiceSettings;

/// The loudest a volume may be set: twice as loud as captured or sent.
const LOUDEST: f32 = 2.0;
/// The lowest and highest bitrate the encoder is given.
const BITRATES: (u32, u32) = (8_000, 320_000);
/// The packet lengths the encoder takes, in milliseconds.
pub(crate) const FRAMES_MS: [u32; 4] = [10, 20, 40, 60];

/// The engine's settings as the view keeps them.
pub(crate) fn voice_of(audio: &AudioSettings) -> VoiceSettings {
    let denoiser = Denoiser::of(audio.denoiser_algorithm);
    VoiceSettings {
        push_to_talk: audio.push_to_talk,
        threshold: audio.vad_threshold,
        noise_suppression: audio.noise_suppression && denoiser.is_some(),
        automatic_gain: audio.auto_gain,
        input_volume: audio.input_volume,
        output_volume: audio.output_volume,
        bitrate_bps: u32::try_from(audio.bitrate_bps).unwrap_or(0),
        voice_over_tcp: audio.force_tcp_audio,
        close_ratio: audio.noise_gate_close_ratio,
        hold_frames: audio.hold_frames,
        max_gain_db: audio.max_gain_db,
        auto_calibrate: audio.auto_input_sensitivity,
        frame_ms: audio.frame_size_ms,
        denoiser: denoiser.unwrap_or_default(),
        exclusive_input: audio.exclusive_input,
        legacy_backend: mumble_tauri_lib::engine_api::audio::legacy_backend(),
    }
}

/// `audio` with what the view keeps of it set to `voice`; what the view
/// does not keep (the devices, the jitter floor, the tuning) is left.
pub(crate) fn apply(audio: &mut AudioSettings, voice: &VoiceSettings) {
    audio.push_to_talk = voice.push_to_talk;
    audio.vad_threshold = voice.threshold.clamp(0.0, 1.0);
    audio.noise_suppression = voice.noise_suppression;
    audio.denoiser_algorithm = if voice.noise_suppression {
        voice.denoiser.engine()
    } else {
        // Kept as it was, so switching back on finds the one chosen.
        match audio.denoiser_algorithm {
            NoiseSuppressionAlgorithm::None => voice.denoiser.engine(),
            kept => kept,
        }
    };
    audio.auto_gain = voice.automatic_gain;
    audio.input_volume = voice.input_volume.clamp(0.0, LOUDEST);
    audio.output_volume = voice.output_volume.clamp(0.0, LOUDEST);
    audio.bitrate_bps =
        i32::try_from(voice.bitrate_bps.clamp(BITRATES.0, BITRATES.1)).unwrap_or(i32::MAX);
    audio.force_tcp_audio = voice.voice_over_tcp;
    audio.noise_gate_close_ratio = voice.close_ratio.clamp(0.1, 0.99);
    audio.hold_frames = voice.hold_frames.clamp(1, 50);
    audio.max_gain_db = voice.max_gain_db.clamp(1.0, 40.0);
    audio.auto_input_sensitivity = voice.auto_calibrate;
    audio.frame_size_ms = if FRAMES_MS.contains(&voice.frame_ms) {
        voice.frame_ms
    } else {
        20
    };
    audio.exclusive_input = voice.exclusive_input;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_view_keeps_goes_to_the_engine_and_comes_back_the_same() {
        let mut audio = AudioSettings::default();
        let voice = VoiceSettings {
            push_to_talk: true,
            threshold: 0.03,
            close_ratio: 0.6,
            hold_frames: 22,
            max_gain_db: 9.0,
            auto_calibrate: true,
            frame_ms: 40,
            denoiser: Denoiser::SpectralSubtraction,
            exclusive_input: true,
            ..VoiceSettings::default()
        };
        apply(&mut audio, &voice);
        let back = voice_of(&audio);
        assert_eq!(
            VoiceSettings {
                legacy_backend: voice.legacy_backend,
                ..back
            },
            voice
        );
        // Out of range is held to what the engine takes.
        let wild = VoiceSettings {
            hold_frames: 500,
            frame_ms: 33,
            close_ratio: 3.0,
            ..voice
        };
        apply(&mut audio, &wild);
        assert_eq!((audio.hold_frames, audio.frame_size_ms), (50, 20));
        assert!((audio.noise_gate_close_ratio - 0.99).abs() < f32::EPSILON);
        // Suppression off keeps the one chosen for when it is on again.
        apply(
            &mut audio,
            &VoiceSettings {
                noise_suppression: false,
                ..voice
            },
        );
        assert_eq!(
            audio.denoiser_algorithm,
            NoiseSuppressionAlgorithm::SpectralSubtraction
        );
    }
}
