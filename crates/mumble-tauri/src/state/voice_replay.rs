//! Voice replay: record the local microphone through the live
//! outbound filter chain (AGC + denoiser + noise gate) into a buffer,
//! then play that buffer back through the output device so the user
//! can hear what others hear.
//!
//! The replay loop is intentionally tiny: it does not own pipeline
//! state, it owns one capture, one filter chain, and one mixing
//! playback that it tears down on exit.  See
//! [`AppState::start_voice_replay`](crate::state::AppState) for the
//! state-management glue that wires it into the rest of the Tauri
//! audio module.

use std::collections::VecDeque;
use std::sync::atomic::AtomicU32;
use std::sync::Arc;
use std::time::{Duration, Instant};

use tauri::Emitter;
use tracing::{debug, warn};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::filter::FilterChain;
use mumble_protocol::audio::mixer::{SpeakerBuffers, SpeakerVolumes};

use crate::audio::{AudioDeviceFactory, MixingPlayback, PlatformAudioFactory};

use super::types::{AudioSettings, VoiceReplayState};

/// Maximum recording length for the voice replay feature, in seconds.
pub(super) const VOICE_REPLAY_CAPACITY_SECS: u32 = 20;

/// Reserved speaker-buffer key for replay playback.  Picked to be far
/// outside any plausible Mumble session id so it cannot collide.
const VOICE_REPLAY_SESSION_KEY: u32 = u32::MAX;

const VOICE_REPLAY_SAMPLE_RATE: u32 = 48_000;

/// Inputs gathered on the audio thread before the replay task spawns.
/// Bundles capture, the matching outbound filter chain, and the
/// playback handle so the async task does not have to touch
/// platform-specific factories itself.
pub(super) struct VoiceReplayContext {
    pub capture: Box<dyn AudioCapture>,
    pub filters: FilterChain,
    pub playback: Box<dyn MixingPlayback>,
    pub speaker_buffers: SpeakerBuffers,
}

/// Build the playback side of the replay path.  Mirrors the mixing
/// playback setup used by `enable_voice` so the user hears the replay
/// through the same device they normally hear other speakers on.
pub(super) fn make_voice_replay_playback(
    settings: &AudioSettings,
    output_volume: Arc<AtomicU32>,
    speaker_volumes: SpeakerVolumes,
) -> Result<(Box<dyn MixingPlayback>, SpeakerBuffers), String> {
    let speaker_buffers: SpeakerBuffers =
        Arc::new(std::sync::Mutex::new(std::collections::HashMap::new()));
    let playback = PlatformAudioFactory::create_mixing_playback(
        settings.selected_output_device.as_deref(),
        output_volume,
        speaker_buffers.clone(),
        speaker_volumes,
    )?;
    Ok((playback, speaker_buffers))
}

/// Background task that records the user through the live outbound
/// filter chain, then plays the captured buffer back through the
/// output device.
///
/// `stop_rx` is held high (`true`) by the spawning side and flipped to
/// `false` to request an early stop; the task also stops when the
/// recording buffer reaches `VOICE_REPLAY_CAPACITY_SECS` of audio.
pub(super) async fn voice_replay_loop(
    mut ctx: VoiceReplayContext,
    app: tauri::AppHandle,
    mut stop_rx: tokio::sync::watch::Receiver<bool>,
) {
    let _ = ctx.playback.start();
    if let Err(e) = ctx.capture.start() {
        warn!("voice_replay: capture start failed: {e}");
        emit_state(&app, VoiceReplayState::Idle);
        return;
    }

    let buffer = record(&mut ctx, &app, &mut stop_rx).await;
    let _ = ctx.capture.stop();

    if buffer.is_empty() {
        let _ = ctx.playback.stop();
        emit_state(&app, VoiceReplayState::Idle);
        return;
    }

    playback(&mut ctx, &app, &mut stop_rx, buffer).await;

    if let Ok(mut bufs) = ctx.speaker_buffers.lock() {
        let _ = bufs.remove(&VOICE_REPLAY_SESSION_KEY);
    }
    let _ = ctx.playback.stop();
    emit_state(&app, VoiceReplayState::Idle);
}

/// Record phase: capture frames, run the filter chain, append to the buffer.
async fn record(
    ctx: &mut VoiceReplayContext,
    app: &tauri::AppHandle,
    stop_rx: &mut tokio::sync::watch::Receiver<bool>,
) -> Vec<f32> {
    let capacity_samples =
        VOICE_REPLAY_CAPACITY_SECS as usize * VOICE_REPLAY_SAMPLE_RATE as usize;
    let mut buffer: Vec<f32> = Vec::with_capacity(capacity_samples);

    let mut interval = tokio::time::interval(Duration::from_millis(20));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    // Drop a placeholder entry so the mixing callback owns a buffer
    // before playback begins; this avoids a first-frame underrun pop.
    if let Ok(mut bufs) = ctx.speaker_buffers.lock() {
        let _ = bufs.insert(VOICE_REPLAY_SESSION_KEY, VecDeque::new());
    }

    let start = Instant::now();
    loop {
        let _ = interval.tick().await;

        if stop_requested(stop_rx) {
            break;
        }

        let Ok(mut frame) = ctx.capture.read_frame() else {
            continue;
        };

        if let Err(e) = ctx.filters.process(&mut frame) {
            debug!("voice_replay: filter chain error: {e}");
        }

        for &sample in frame.as_f32_samples() {
            if buffer.len() >= capacity_samples {
                break;
            }
            buffer.push(sample);
        }

        emit_state(
            app,
            VoiceReplayState::Recording {
                elapsed_ms: elapsed_ms(start),
                capacity_ms: VOICE_REPLAY_CAPACITY_SECS * 1000,
            },
        );

        if buffer.len() >= capacity_samples {
            break;
        }
    }
    buffer
}

/// Playback phase: hand the recorded samples to the mixing callback
/// and tick until the speaker buffer drains.
async fn playback(
    ctx: &mut VoiceReplayContext,
    app: &tauri::AppHandle,
    stop_rx: &mut tokio::sync::watch::Receiver<bool>,
    buffer: Vec<f32>,
) {
    let total_ms = (buffer.len() as u64 * 1000 / VOICE_REPLAY_SAMPLE_RATE as u64) as u32;

    if let Ok(mut bufs) = ctx.speaker_buffers.lock() {
        let entry = bufs.entry(VOICE_REPLAY_SESSION_KEY).or_default();
        entry.extend(buffer.iter().copied());
    }

    let playback_start = Instant::now();
    let mut tick = tokio::time::interval(Duration::from_millis(50));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        let _ = tick.tick().await;

        if stop_requested(stop_rx) {
            break;
        }

        let remaining = ctx
            .speaker_buffers
            .lock()
            .ok()
            .and_then(|bufs| bufs.get(&VOICE_REPLAY_SESSION_KEY).map(VecDeque::len))
            .unwrap_or(0);

        let elapsed = elapsed_ms(playback_start).min(total_ms);
        emit_state(
            app,
            VoiceReplayState::Playing {
                elapsed_ms: elapsed,
                total_ms,
            },
        );

        if remaining == 0 {
            break;
        }
    }
}

fn stop_requested(stop_rx: &mut tokio::sync::watch::Receiver<bool>) -> bool {
    if stop_rx.has_changed().unwrap_or(false) {
        stop_rx.mark_unchanged();
        return !*stop_rx.borrow();
    }
    false
}

fn elapsed_ms(start: Instant) -> u32 {
    u32::try_from(start.elapsed().as_millis()).unwrap_or(u32::MAX)
}

fn emit_state(app: &tauri::AppHandle, state: VoiceReplayState) {
    let _ = app.emit("voice-replay-state", state);
}
