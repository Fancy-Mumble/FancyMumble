/** Audio / voice: input-output devices, the per-user audio settings struct,
 *  voice-activation state and noise-suppression configuration. */

export interface AudioDevice {
  name: string;
  is_default: boolean;
}

export interface AudioSettings {
  /** Selected input device name (null = system default). */
  selected_device: string | null;
  /** Whether auto-gain is enabled. */
  auto_gain: boolean;
  /** Voice activation open threshold (0.0–1.0). */
  vad_threshold: number;
  /** AGC max gain boost in dB (expert, default 15). */
  max_gain_db: number;
  /** Close-threshold ratio relative to vad_threshold (expert, default 0.8). */
  noise_gate_close_ratio: number;
  /** Frames to hold the gate open after audio drops below threshold (expert). */
  hold_frames: number;
  /** Use push-to-talk instead of voice activation. */
  push_to_talk: boolean;
  /** Global shortcut string for PTT, e.g. "Alt+T". */
  push_to_talk_key: string | null;  /** Opus encoder bitrate in bits/s (e.g. 72000). */
  bitrate_bps: number;
  /** Audio duration per Opus packet in ms (10, 20, 40, or 60). */
  frame_size_ms: number;
  /** Whether noise suppression (noise gate) is enabled. */
  noise_suppression: boolean;
  /** Selected noise-suppression algorithm. Only takes effect when
   * noise_suppression is true. */
  denoiser_algorithm: NoiseSuppressionAlgorithm;
  /** Per-algorithm tunable knobs (advanced/expert mode only).
   *  Keyed by `DenoiserParamSpec.id`; missing entries fall back to
   *  each spec's default. */
  denoiser_params: Record<string, number>;
  /** Selected output device name (null = system default). */
  selected_output_device: string | null;
  /** Microphone volume multiplier (0.0-2.0, default 1.0). */
  input_volume: number;
  /** Speaker volume multiplier (0.0-2.0, default 1.0). */
  output_volume: number;
  /** Automatically adjust VAD threshold based on ambient noise floor. */
  auto_input_sensitivity: boolean;
  /** Force audio to use TCP tunnel instead of UDP (e.g. behind strict NAT). */
  force_tcp_audio: boolean;
}

export type VoiceState = "inactive" | "active" | "muted";

/** Noise-suppression backend selectable from the audio settings.
 *  Mirrors `mumble_protocol::audio::filter::denoiser::NoiseSuppressionAlgorithm`. */
export type NoiseSuppressionAlgorithm =
  | "none"
  | "rnnoise"
  | "deepfilternet"
  | "omlsa_imcra"
  | "spectral_subtraction";

/** Display labels for `NoiseSuppressionAlgorithm`, kept in sync with
 *  the Rust `label()` helper. */
export const NOISE_SUPPRESSION_LABELS: Record<NoiseSuppressionAlgorithm, string> = {
  none: "Off",
  rnnoise: "RNNoise (recurrent neural network)",
  deepfilternet: "DeepFilterNet (deep-learning SOTA)",
  omlsa_imcra: "OMLSA + IMCRA (modern classical)",
  spectral_subtraction: "Spectral subtraction (low-CPU classical)",
};

/** Schema for a single tunable denoiser parameter, returned by the
 *  `get_denoiser_param_specs` Tauri command.  Mirrors the Rust
 *  `DenoiserParamSpec` struct. */
export interface DenoiserParamSpec {
  id: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  default: number;
  unit: string;
}
