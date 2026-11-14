//! Audio that touches no device: for a view that must neither hear the
//! microphone nor make a sound (a test, a run that is looked at).
//!
//! Switched on with [`set_silent`]. From then on every capture the
//! factory makes is [`MadeUpVoice`], a voice made up on the spot at the
//! pace a microphone delivers one, and every playback is
//! [`SilentPlayback`], which takes what would be heard at the pace a
//! device would and lets it go. Everything between - filters, the gate,
//! the encoder, the replay buffer, the mixer - runs as it always does.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::time::{Duration, Instant};

use mumble_protocol::audio::capture::AudioCapture;
use mumble_protocol::audio::mixer::{SpeakerBuffers, SpeakerVolumes};
use mumble_protocol::audio::sample::{AudioFormat, AudioFrame};
use mumble_protocol::error::{Error, Result};

/// Whether no device is to be touched.
static SILENT: AtomicBool = AtomicBool::new(false);

/// Touch no audio device from now on (`true`), or the real ones again.
/// Takes effect on the next capture or playback made.
pub fn set_silent(silent: bool) {
    SILENT.store(silent, Ordering::Relaxed);
}

/// Whether no audio device is touched.
pub fn is_silent() -> bool {
    SILENT.load(Ordering::Relaxed)
}

const RATE: f64 = 48_000.0;

/// A voice made up on the spot: syllables of a gliding tone, a little
/// louder and softer each, with pauses between phrases over a faint hiss.
/// Speech-like enough for a level meter, a gate and its calibration to
/// have something to measure; nothing anybody said.
pub(crate) struct MadeUpVoice {
    frame_size: usize,
    volume: Arc<AtomicU32>,
    started: Option<Instant>,
    /// Samples handed out since the start.
    made: u64,
    phase: f64,
    /// A small generator for the hiss, so it is the same every run.
    noise: u32,
    sequence: u64,
}

impl std::fmt::Debug for MadeUpVoice {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MadeUpVoice")
            .field("made", &self.made)
            .finish_non_exhaustive()
    }
}

impl MadeUpVoice {
    pub(crate) fn new(frame_size: usize, volume: Arc<AtomicU32>) -> Self {
        Self {
            frame_size,
            volume,
            started: None,
            made: 0,
            phase: 0.0,
            noise: 0x1234_5678,
            sequence: 0,
        }
    }

    /// The `n`th sample of the made-up voice.
    fn sample(&mut self, n: u64) -> f32 {
        let seconds = n as f64 / RATE;
        // Phrases of 2.4 s, the last 0.6 s of each a pause.
        let in_phrase = seconds % 2.4;
        let syllable = (in_phrase * 4.0 * std::f64::consts::PI).sin().abs();
        let loudness = if in_phrase < 1.8 { 0.35 * syllable } else { 0.0 };
        let pitch = 160.0 + 60.0 * (seconds * 1.3).sin();
        self.phase = (self.phase + pitch / RATE).fract();
        self.noise ^= self.noise << 13;
        self.noise ^= self.noise >> 17;
        self.noise ^= self.noise << 5;
        let hiss = (f64::from(self.noise) / f64::from(u32::MAX) - 0.5) * 0.004;
        ((self.phase * std::f64::consts::TAU).sin() * loudness + hiss) as f32
    }
}

impl AudioCapture for MadeUpVoice {
    fn format(&self) -> AudioFormat {
        AudioFormat::MONO_48KHZ_F32
    }

    fn read_frame(&mut self) -> Result<AudioFrame> {
        let started = self
            .started
            .ok_or_else(|| Error::InvalidState("made-up voice not started".into()))?;
        let due = (started.elapsed().as_secs_f64() * RATE) as u64;
        if due < self.made + self.frame_size as u64 {
            return Err(Error::NotEnoughSamples);
        }
        let volume = f32::from_bits(self.volume.load(Ordering::Relaxed));
        let mut data = Vec::with_capacity(self.frame_size * 4);
        for _ in 0..self.frame_size {
            let sample = self.sample(self.made) * volume;
            self.made += 1;
            data.extend_from_slice(&sample.to_ne_bytes());
        }
        self.sequence += 1;
        Ok(AudioFrame {
            data,
            format: AudioFormat::MONO_48KHZ_F32,
            sequence: self.sequence,
            is_silent: false,
        })
    }

    fn start(&mut self) -> Result<()> {
        self.started = Some(Instant::now());
        self.made = 0;
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.started = None;
        Ok(())
    }
}

/// How much a silent playback takes at a time: what a device asks for.
const SLICE: Duration = Duration::from_millis(10);

/// A mixing playback with no device: a thread pulls the mix at the pace a
/// device would and lets it go, so what waits to be heard drains as if it
/// were heard.
pub(crate) struct SilentPlayback {
    buffers: SpeakerBuffers,
    speaker_volumes: SpeakerVolumes,
    volume: Arc<AtomicU32>,
    running: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}

impl SilentPlayback {
    pub(crate) fn new(
        volume: Arc<AtomicU32>,
        buffers: SpeakerBuffers,
        speaker_volumes: SpeakerVolumes,
    ) -> Self {
        Self {
            buffers,
            speaker_volumes,
            volume,
            running: Arc::new(AtomicBool::new(false)),
            thread: None,
        }
    }
}

impl super::MixingPlayback for SilentPlayback {
    fn start(&mut self) -> Result<()> {
        self.running.store(true, Ordering::Relaxed);
        let mix = super::rodio_desktop::MumbleMixerSource::new(
            Arc::clone(&self.buffers),
            Arc::clone(&self.speaker_volumes),
            Arc::clone(&self.volume),
            Arc::clone(&self.running),
        );
        let running = Arc::clone(&self.running);
        let thread = std::thread::Builder::new()
            .name("silent-playback".to_owned())
            .spawn(move || {
                let mut drain = Drain::new(mix);
                while running.load(Ordering::Relaxed) {
                    drain.catch_up();
                    std::thread::sleep(SLICE);
                }
            })
            .map_err(|e| Error::InvalidState(format!("silent playback: {e}")))?;
        self.thread = Some(thread);
        Ok(())
    }

    fn stop(&mut self) -> Result<()> {
        self.running.store(false, Ordering::Relaxed);
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        Ok(())
    }
}

/// The mix of a silent playback, pulled a slice at a time and let go, as
/// fast as a device would have asked for it since it began.
struct Drain {
    mix: super::rodio_desktop::MumbleMixerSource,
    began: Instant,
    /// Samples pulled since it began.
    pulled: u64,
}

impl Drain {
    /// Samples a device asks for at a time.
    const PER_SLICE: usize = (RATE * SLICE.as_secs_f64()) as usize;

    fn new(mix: super::rodio_desktop::MumbleMixerSource) -> Self {
        Self {
            mix,
            began: Instant::now(),
            pulled: 0,
        }
    }

    /// Pull and let go of every slice that is due by now.
    fn catch_up(&mut self) {
        let due = (self.began.elapsed().as_secs_f64() * RATE) as u64;
        while self.pulled < due {
            self.mix.by_ref().take(Self::PER_SLICE).for_each(drop);
            self.pulled += Self::PER_SLICE as u64;
        }
    }
}

impl Drop for SilentPlayback {
    fn drop(&mut self) {
        self.running.store(false, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]
    use super::*;

    #[test]
    fn the_made_up_voice_speaks_and_pauses_at_a_microphones_pace() {
        let volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let mut voice = MadeUpVoice::new(960, volume);
        assert!(voice.read_frame().is_err(), "not before it is started");
        voice.start().unwrap();
        assert!(voice.read_frame().is_err(), "nothing before its time");
        // Speech, then the pause at the end of the first phrase.
        let loudness = |voice: &mut MadeUpVoice, from: u64| {
            let samples: Vec<f32> = (from..from + 4800).map(|n| voice.sample(n)).collect();
            (samples.iter().map(|s| s * s).sum::<f32>() / samples.len() as f32).sqrt()
        };
        assert!(loudness(&mut voice, 24_000) > 0.05, "speaking");
        assert!(loudness(&mut voice, 96_000) < 0.01, "paused");
        std::thread::sleep(Duration::from_millis(60));
        assert!(voice.read_frame().is_ok(), "a frame once it is due");
    }
}
