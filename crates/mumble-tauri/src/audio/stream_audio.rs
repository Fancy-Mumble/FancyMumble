//! Playout of a watched broadcast's desktop audio.
//!
//! The native stream viewer decodes the broadcast's Opus track in Rust (see
//! `fancy_screenshare::viewer`) and hands 20 ms stereo frames here. Rather
//! than open a second output device, those frames join the voice mixer's
//! per-speaker buffers under a synthetic session id: the playback callback
//! already sums every buffer in that map, so a stream is mixed with voice,
//! ducks nothing, and follows the same output-device choice.
//!
//! The mixer is mono 48 kHz f32 (voice is), so stereo desktop audio is
//! downmixed on the way in. The buffer is the same per-speaker jitter buffer
//! voice uses - it primes to the floor, adapts to the arrival spread, and is
//! capped at [`MAX_SPEAKER_BUFFER_SAMPLES`] with the oldest samples dropped on
//! overflow - which is what the stats panel's playout row reports.

use std::sync::{Mutex, OnceLock};

use mumble_protocol::audio::mixer::{
    JitterConfig, MAX_SPEAKER_BUFFER_SAMPLES, SpeakerBuffer, SpeakerBuffers, SpeakerVolumes,
};
use mumble_protocol::audio::sample::AudioFormat;

/// Stream speakers live above every real Mumble session id (the server hands
/// those out from 0 upward), so a broadcast can never collide with a person.
const STREAM_SPEAKER_BASE: u32 = 0xF000_0000;

/// Mono samples per millisecond at the mixer's rate.
const SAMPLES_PER_MS: usize = 48;

/// `samples` as milliseconds of playout at the mixer's rate.
#[allow(
    clippy::cast_possible_truncation,
    reason = "a buffer is capped at 400 ms; the cast cannot overflow"
)]
fn as_ms(samples: usize) -> u32 {
    (samples / SAMPLES_PER_MS) as u32
}

/// The mixer buffer id carrying `session`'s shared desktop audio.
pub(crate) fn speaker_id(session: u32) -> u32 {
    STREAM_SPEAKER_BASE | (session & 0x0FFF_FFFF)
}

#[derive(Default)]
struct Registry {
    buffers: Option<SpeakerBuffers>,
    volumes: Option<SpeakerVolumes>,
}

fn registry() -> &'static Mutex<Registry> {
    static REGISTRY: OnceLock<Mutex<Registry>> = OnceLock::new();
    REGISTRY.get_or_init(|| Mutex::new(Registry::default()))
}

/// Publish the live mixer buffers. Called wherever the voice pipeline builds
/// them, so a stream started later finds them; a rebuild replaces them.
pub(crate) fn register(buffers: &SpeakerBuffers, volumes: &SpeakerVolumes) {
    if let Ok(mut slot) = registry().lock() {
        slot.buffers = Some(buffers.clone());
        slot.volumes = Some(volumes.clone());
    }
}

/// The live buffers, cloned out from under the registry lock. Returning the
/// `Arc` rather than a borrow of the guard is what lets callers lock the
/// buffers themselves without the registry guard outliving the expression.
fn live_buffers() -> Option<SpeakerBuffers> {
    registry().lock().ok()?.buffers.clone()
}

/// The live per-speaker volumes, cloned out the same way.
fn live_volumes() -> Option<SpeakerVolumes> {
    registry().lock().ok()?.volumes.clone()
}

/// Queue one decoded frame (interleaved stereo f32 at 48 kHz) for playout.
///
/// Silently does nothing while voice is disabled: there is no output stream
/// to mix into, and buffering audio nobody will drain only grows memory.
pub(crate) fn push(session: u32, stereo: &[f32]) {
    let Some(buffers) = live_buffers() else {
        return;
    };
    let Ok(mut map) = buffers.lock() else { return };
    let buffer = map.entry(speaker_id(session)).or_insert_with(|| {
        SpeakerBuffer::new(AudioFormat::MONO_48KHZ_F32, JitterConfig::default())
    });
    // Downmix into a scratch buffer: `push` takes a slice, and frames arrive
    // 20 ms at a time, so this is one small allocation per frame.
    let mono: Vec<f32> = stereo
        .as_chunks::<2>()
        .0
        .iter()
        .map(|f| (f[0] + f[1]) * 0.5)
        .collect();
    // `push`, not `push_complete`: a stream never sends a terminator, so this
    // primes to the jitter floor and then adapts exactly like a voice speaker.
    // It also applies the cap - the oldest samples go when playout falls behind.
    buffer.push(&mono);
}

/// Drop `session`'s stream audio (the viewer stopped). Anything still queued
/// is discarded rather than played out after the picture is gone.
pub(crate) fn stop(session: u32) {
    if let Some(buffers) = live_buffers()
        && let Ok(mut map) = buffers.lock()
    {
        let _removed = map.remove(&speaker_id(session));
    }
    if let Some(volumes) = live_volumes()
        && let Ok(mut map) = volumes.lock()
    {
        let _removed = map.remove(&speaker_id(session));
    }
}

/// Playout state of `session`'s stream audio, or `None` when it carries no
/// audio: how much is queued right now and the cap the buffer is held to,
/// both in milliseconds.
pub(crate) fn playout(session: u32) -> Option<(u32, u32)> {
    let buffers = live_buffers()?;
    let map = buffers.lock().ok()?;
    let buffer = map.get(&speaker_id(session))?;
    Some((as_ms(buffer.len()), as_ms(MAX_SPEAKER_BUFFER_SAMPLES)))
}

/// Set the playback volume of `session`'s stream audio (1.0 = unchanged).
pub(crate) fn set_volume(session: u32, volume: f32) {
    let Some(volumes) = live_volumes() else {
        return;
    };
    // `let ... else` rather than `if let`: on this edition the lock guard's
    // temporary would outlive `volumes` inside an `if let` body.
    let Ok(mut map) = volumes.lock() else { return };
    let _previous = map.insert(speaker_id(session), volume.clamp(0.0, 2.0));
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

    use mumble_protocol::audio::mixer::MAX_SPEAKER_BUFFER_SAMPLES;

    use super::{STREAM_SPEAKER_BASE, SpeakerBuffers, SpeakerVolumes, push, register, speaker_id};

    /// `frames` 20 ms stereo frames of (left, right) = (1.0, 0.0).
    fn stereo_frames(frames: usize) -> Vec<f32> {
        (0..frames * 960 * 2)
            .map(|i| if i % 2 == 0 { 1.0 } else { 0.0 })
            .collect()
    }

    /// `register` publishes into one process-wide registry, so tests that
    /// install their own buffers have to take turns.
    static REGISTRY_TURN: Mutex<()> = Mutex::new(());

    fn live_registry() -> (MutexGuard<'static, ()>, SpeakerBuffers, SpeakerVolumes) {
        let turn = REGISTRY_TURN.lock().unwrap_or_else(PoisonError::into_inner);
        let buffers: SpeakerBuffers = Arc::new(Mutex::new(HashMap::new()));
        let volumes: SpeakerVolumes = Arc::new(Mutex::new(HashMap::new()));
        register(&buffers, &volumes);
        (turn, buffers, volumes)
    }

    #[test]
    fn stream_speakers_never_collide_with_real_sessions() {
        assert!(speaker_id(0) > STREAM_SPEAKER_BASE - 1);
        assert_ne!(speaker_id(1), speaker_id(2));
        // A server would have to hand out 268 million sessions to reach here.
        assert!(speaker_id(7) > 1_000_000_000);
    }

    #[test]
    fn push_downmixes_stereo_into_one_speaker_buffer() {
        let (_turn, buffers, _volumes) = live_registry();

        push(11, &stereo_frames(2));

        let map = buffers.lock().expect("buffers");
        let buffer = map.get(&speaker_id(11)).expect("stream speaker");
        // Two 20 ms stereo frames downmix to 1920 mono samples...
        assert_eq!(buffer.len(), 1920);
        // ...each the mean of its channels.
        assert!(buffer.iter().all(|s| (s - 0.5).abs() < f32::EPSILON));
    }

    #[test]
    fn push_holds_the_buffer_to_the_cap() {
        let (_turn, buffers, _volumes) = live_registry();

        // Well past the cap: 25 frames is 24_000 mono samples.
        for _ in 0..25 {
            push(12, &stereo_frames(1));
        }

        let map = buffers.lock().expect("buffers");
        let buffer = map.get(&speaker_id(12)).expect("stream speaker");
        assert_eq!(buffer.len(), MAX_SPEAKER_BUFFER_SAMPLES);
    }
}
