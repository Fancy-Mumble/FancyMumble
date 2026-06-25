//! Audio / voice types: mic-test and calibration payloads, packet/ping stats,
//! available devices, the user-configurable `AudioSettings` and voice state.

use std::collections::BTreeMap;

use serde::Serialize;

use mumble_protocol::audio::filter::denoiser::NoiseSuppressionAlgorithm;

/// Microphone amplitude payload emitted during mic test.
#[derive(Clone, Serialize)]
pub(crate) struct MicAmplitudePayload {
    /// RMS amplitude (0.0 - 1.0).
    pub rms: f32,
    /// Peak amplitude (0.0 - 1.0).
    pub peak: f32,
}

/// Auto-calibration result emitted when voice-activation auto-tunes
/// the noise-gate parameters.  Carries all four calibration knobs so
/// the frontend can refresh its UI atomically.
#[derive(Clone, Serialize)]
pub(crate) struct VoiceActivationCalibrationPayload {
    /// Auto-tuned open threshold (post-AGC RMS, 0.0 - 1.0).
    pub vad_threshold: f32,
    /// Close-threshold ratio relative to `vad_threshold`.
    pub noise_gate_close_ratio: f32,
    /// Frames to keep the gate open after audio drops below the close threshold.
    pub hold_frames: u32,
    /// Auto-tuned AGC max gain in dB.
    pub max_gain_db: f32,
}

/// Voice replay lifecycle, emitted on `voice-replay-state` so the
/// frontend can label its single Record / Stop / Playing button
/// without polling.
#[derive(Clone, Copy, Serialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub(crate) enum VoiceReplayState {
    /// Capturing through the same filter chain the live voice pipeline
    /// uses (AGC + denoiser + noise gate).
    Recording { elapsed_ms: u32, capacity_ms: u32 },
    /// Replaying the captured buffer through the output device.
    Playing { elapsed_ms: u32, total_ms: u32 },
    /// Replay finished or was cancelled.
    Idle,
}

/// Latency measurement payload emitted during latency test.
#[derive(Clone, Serialize)]
pub(crate) struct LatencyPayload {
    /// Round-trip time in milliseconds.
    pub rtt_ms: f64,
}

/// UDP crypto packet counters (good / late / lost / resync).
#[derive(Clone, Default, Serialize)]
pub(crate) struct PacketStats {
    pub good: u32,
    pub late: u32,
    pub lost: u32,
    pub resync: u32,
}

/// Payload emitted via the `crypto-stats` event on each Ping exchange.
#[derive(Clone, Serialize)]
pub(crate) struct CryptoStatsPayload {
    /// Our local decrypt stats (packets we successfully received/decoded).
    pub from_client: PacketStats,
    /// Server-reported stats for packets it sent to us.
    pub to_client: PacketStats,
}

/// Rolling-window packet statistics.
#[derive(Clone, Serialize)]
pub(crate) struct RollingStatsPayload {
    /// Rolling window duration in seconds.
    pub time_window: u32,
    pub from_client: PacketStats,
    pub from_server: PacketStats,
}

/// Payload emitted when a `UserStats` response arrives from the server.
#[derive(Clone, Serialize)]
pub(crate) struct UserStatsPayload {
    pub session: u32,
    pub tcp_packets: u32,
    pub udp_packets: u32,
    pub tcp_ping_avg: f32,
    pub tcp_ping_var: f32,
    pub udp_ping_avg: f32,
    pub udp_ping_var: f32,
    pub bandwidth: Option<u32>,
    pub onlinesecs: Option<u32>,
    pub idlesecs: Option<u32>,
    pub strong_certificate: bool,
    pub opus: bool,
    /// Client version string (e.g. "1.5.517").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    /// Operating system name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os: Option<String>,
    /// Operating system version.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub os_version: Option<String>,
    /// Client IP address (formatted string).  Only present for admins.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub address: Option<String>,
    /// Total UDP crypto stats: packets received from the client.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_client: Option<PacketStats>,
    /// Total UDP crypto stats: packets sent to the client.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub from_server: Option<PacketStats>,
    /// Rolling-window packet statistics.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub rolling_stats: Option<RollingStatsPayload>,
}

/// An available audio input device.
#[derive(Debug, Clone, Serialize)]
pub struct AudioDevice {
    pub name: String,
    pub is_default: bool,
}

/// User-configurable audio settings.
#[derive(Debug, Clone, Serialize, serde::Deserialize, PartialEq)]
pub struct AudioSettings {
    /// Selected input device name (None = system default).
    pub selected_device: Option<String>,
    /// Whether auto-gain is enabled.
    pub auto_gain: bool,
    /// Voice activation threshold (0.0-1.0). Below this level -> silence.
    pub vad_threshold: f32,
    /// AGC maximum gain boost in dB (expert, default 15.0).
    #[serde(default = "AudioSettings::default_max_gain")]
    pub max_gain_db: f32,
    /// Close-threshold ratio relative to `vad_threshold` (expert, default 0.8).
    #[serde(default = "AudioSettings::default_close_ratio")]
    pub noise_gate_close_ratio: f32,
    /// Number of frames to hold the gate open after audio drops below threshold.
    #[serde(default = "AudioSettings::default_hold_frames")]
    pub hold_frames: u32,
    /// Use push-to-talk instead of voice activation.
    #[serde(default)]
    pub push_to_talk: bool,
    /// Global shortcut string for PTT (e.g. "Alt+T").
    #[serde(default)]
    pub push_to_talk_key: Option<String>,
    /// Opus encoder bitrate in bits/s (e.g. 72000).
    #[serde(default = "AudioSettings::default_bitrate")]
    pub bitrate_bps: i32,
    /// Audio duration per Opus packet in milliseconds (10, 20, 40, or 60).
    #[serde(default = "AudioSettings::default_frame_size_ms")]
    pub frame_size_ms: u32,
    /// Whether the noise gate (noise suppression) is enabled.
    #[serde(default = "AudioSettings::default_noise_suppression")]
    pub noise_suppression: bool,
    /// Selected noise-suppression algorithm.  Only takes effect when
    /// `noise_suppression` is true.
    #[serde(default)]
    pub denoiser_algorithm: NoiseSuppressionAlgorithm,
    /// Per-algorithm tunable knobs (advanced/expert mode only).
    /// Keyed by `DenoiserParamSpec::id`; missing entries fall back to
    /// each spec's default.
    #[serde(default)]
    pub denoiser_params: BTreeMap<String, f32>,
    /// Selected output device name (None = system default).
    #[serde(default)]
    pub selected_output_device: Option<String>,
    /// Microphone volume multiplier (0.0-2.0, default 1.0).
    #[serde(default = "AudioSettings::default_volume")]
    pub input_volume: f32,
    /// Speaker volume multiplier (0.0-2.0, default 1.0).
    #[serde(default = "AudioSettings::default_volume")]
    pub output_volume: f32,    /// Automatically adjust input sensitivity based on ambient noise floor.
    #[serde(default)]
    pub auto_input_sensitivity: bool,
    /// Force audio to use TCP tunnel instead of UDP (e.g. behind strict NAT).
    #[serde(default)]
    pub force_tcp_audio: bool,
}

impl AudioSettings {
    pub(crate) fn default_max_gain() -> f32 {
        15.0
    }
    pub(crate) fn default_close_ratio() -> f32 {
        0.8
    }
    pub(crate) fn default_hold_frames() -> u32 {
        15
    }
    pub(crate) fn default_bitrate() -> i32 {
        72_000
    }
    pub(crate) fn default_frame_size_ms() -> u32 {
        20
    }
    pub(crate) fn default_noise_suppression() -> bool {
        true
    }
    pub(crate) fn default_volume() -> f32 {
        1.0
    }

    /// Convert an Opus packet duration in ms to samples-per-channel at
    /// 48 kHz.  Clamps to valid Opus frame sizes (10, 20, 40, 60 ms).
    pub fn frame_ms_to_samples(frame_size_ms: u32) -> usize {
        match frame_size_ms {
            10 => 480,
            40 => 1920,
            60 => 2880,
            _ => 960, // 20 ms default
        }
    }

    /// Whether any pipeline-relevant setting differs from `other`.
    ///
    /// PTT key and UI-only fields are excluded since they don't
    /// require a pipeline restart.
    pub fn needs_pipeline_restart(&self, other: &Self) -> bool {
        self.selected_device != other.selected_device
            || self.auto_gain != other.auto_gain
            || (self.vad_threshold - other.vad_threshold).abs() > f32::EPSILON
            || (self.max_gain_db - other.max_gain_db).abs() > f32::EPSILON
            || (self.noise_gate_close_ratio - other.noise_gate_close_ratio).abs() > f32::EPSILON
            || self.hold_frames != other.hold_frames
            || self.bitrate_bps != other.bitrate_bps
            || self.frame_size_ms != other.frame_size_ms
            || self.noise_suppression != other.noise_suppression
            || self.denoiser_algorithm != other.denoiser_algorithm
            || self.denoiser_params != other.denoiser_params
            || self.auto_input_sensitivity != other.auto_input_sensitivity
    }

    /// Whether the output device changed, requiring inbound pipeline restart.
    pub fn needs_inbound_restart(&self, other: &Self) -> bool {
        self.selected_output_device != other.selected_output_device
    }
}

impl Default for AudioSettings {
    fn default() -> Self {
        Self {
            selected_device: None,
            auto_gain: true,
            vad_threshold: 0.01,
            max_gain_db: 15.0,
            noise_gate_close_ratio: 0.8,
            hold_frames: 15,
            push_to_talk: false,
            push_to_talk_key: None,
            bitrate_bps: 72_000,
            frame_size_ms: 20,
            noise_suppression: true,
            denoiser_algorithm: NoiseSuppressionAlgorithm::default(),
            denoiser_params: BTreeMap::new(),
            selected_output_device: None,
            input_volume: 1.0,
            output_volume: 1.0,
            auto_input_sensitivity: false,
            force_tcp_audio: false,
        }
    }
}

/// Current voice state.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VoiceState {
    /// User is deaf + muted (default on connect / before enabling voice).
    #[default]
    Inactive,
    /// User has enabled voice calling - can speak and hear.
    Active,
    /// User is muted (mic off) but can still hear others.
    Muted,
}
