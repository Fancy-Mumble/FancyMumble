//! A recorder that hears no microphone: a take is a tone made up on the
//! spot, at the pace speech would arrive, written by the engine's own
//! writer into exactly the file a real take makes. For a run that must stay
//! silent (`FANCY_GPUI_VOICE_MESSAGES=silent`) and for tests.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use mumble_tauri_lib::engine_api::voice::{VoiceClip, VoiceClipWriter, voice_clip_dir};

use super::engine_recorder::clip_of;
use super::{Clip, Finished, Progress, Recorder};

/// A take's longest, as the engine holds one to whatever the server says.
const HARD_LIMIT_MS: u32 = 30 * 60 * 1000;

/// How much of the tone is made at a time: one Opus frame.
const FRAME: u32 = 960;
const FRAME_TIME: Duration = Duration::from_millis(20);

/// A tone that rises and falls, louder and softer: something with a shape
/// to draw, and nothing anybody said.
#[derive(Debug, Default)]
pub(crate) struct Tone {
    /// Samples made so far.
    made: u64,
    phase: f32,
}

impl Tone {
    /// The next `count` samples, mono at 48 kHz.
    pub(crate) fn take(&mut self, count: u32) -> Vec<f32> {
        (0..count)
            .map(|_| {
                let seconds = self.made as f32 / 48_000.0;
                self.made += 1;
                let pitch = 440.0 + 220.0 * (seconds * 0.7 * std::f32::consts::TAU).sin();
                self.phase = (self.phase + pitch / 48_000.0).fract();
                let swell = 0.15 + 0.35 * (seconds * 1.6 * std::f32::consts::PI).sin().abs();
                (self.phase * std::f32::consts::TAU).sin() * swell
            })
            .collect()
    }
}

/// A take of the tone in progress.
struct Take {
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    thread: std::thread::JoinHandle<Result<Option<VoiceClip>, String>>,
}

/// Records the tone.
#[derive(Default)]
pub(crate) struct ToneRecorder {
    take: Option<Take>,
    progress: Arc<Mutex<Progress>>,
}

impl ToneRecorder {
    /// Make the tone into a clip on a thread of its own, until told to stop
    /// or `limit_ms` is reached.
    fn record(
        limit_ms: u32,
        progress: &Arc<Mutex<Progress>>,
        stop: &Arc<AtomicBool>,
        cancel: &Arc<AtomicBool>,
    ) -> Result<Option<VoiceClip>, String> {
        let mut writer = VoiceClipWriter::new()?;
        let mut tone = Tone::default();
        let limit = u64::from(limit_ms) * 48;
        while !stop.load(Ordering::Relaxed) && !cancel.load(Ordering::Relaxed) {
            writer.push(&tone.take(FRAME), limit)?;
            let reached = writer.samples() >= limit;
            {
                let mut said = progress.lock().unwrap_or_else(PoisonError::into_inner);
                said.elapsed_ms = writer.elapsed_ms();
                said.level = writer.level();
                said.limit = reached;
            }
            if reached {
                break;
            }
            std::thread::sleep(FRAME_TIME);
        }
        if cancel.load(Ordering::Relaxed) {
            return Ok(None);
        }
        writer.finish(&voice_clip_dir()).map(Some)
    }
}

impl Recorder for ToneRecorder {
    fn start(&mut self, limit_ms: u32) -> Result<(), String> {
        self.cancel();
        *self.progress.lock().unwrap_or_else(PoisonError::into_inner) = Progress::default();
        let limit_ms = match limit_ms {
            0 => HARD_LIMIT_MS,
            limit => limit.min(HARD_LIMIT_MS),
        };
        let (stop, cancel) = (Arc::<AtomicBool>::default(), Arc::<AtomicBool>::default());
        let (progress, stopping, cancelling) = (
            Arc::clone(&self.progress),
            Arc::clone(&stop),
            Arc::clone(&cancel),
        );
        let thread = std::thread::Builder::new()
            .name("voice-message-tone".to_owned())
            .spawn(move || Self::record(limit_ms, &progress, &stopping, &cancelling))
            .map_err(|error| error.to_string())?;
        self.take = Some(Take {
            stop,
            cancel,
            thread,
        });
        Ok(())
    }

    fn progress(&self) -> Progress {
        self.progress
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    fn finish(&mut self) -> Finished {
        let (tell, told) = async_channel::bounded(1);
        let Some(take) = self.take.take() else {
            let _ = tell.try_send(Err("Not recording a voice message".to_owned()));
            return told;
        };
        take.stop.store(true, Ordering::Relaxed);
        // Joined off the view's thread: the take ends within a frame.
        drop(std::thread::spawn(move || {
            let clip = match take.thread.join() {
                Ok(Ok(Some(clip))) => Ok(clip_of(clip)),
                Ok(Ok(None)) => Err("the voice message was cancelled".to_owned()),
                Ok(Err(error)) => Err(error),
                Err(_) => Err("the recorder stopped unexpectedly".to_owned()),
            };
            let _ = tell.try_send(clip);
        }));
        told
    }

    fn cancel(&mut self) {
        if let Some(take) = self.take.take() {
            take.cancel.store(true, Ordering::Relaxed);
            drop(std::thread::spawn(move || take.thread.join()));
        }
    }

    fn discard(&mut self, clip: &Clip) {
        // Only ever inside the folder takes are written to.
        if clip.path.parent() == Some(voice_clip_dir().as_path()) {
            let _ = std::fs::remove_file(&clip.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_take_of_the_tone_is_a_voice_message_as_long_as_it_ran() {
        let mut recorder = ToneRecorder::default();
        recorder.start(0).expect("starts");
        std::thread::sleep(Duration::from_millis(300));
        let progress = recorder.progress();
        assert!(progress.elapsed_ms >= 20, "it runs: {progress:?}");
        assert!(progress.level > 0.0);
        let clip = recorder
            .finish()
            .recv_blocking()
            .expect("an answer")
            .expect("a clip");
        assert!(clip.duration_ms >= progress.elapsed_ms);
        assert_eq!(clip.waveform.len(), 48);
        let file = std::fs::read(&clip.path).expect("the file");
        let reader =
            mumble_tauri_lib::engine_api::voice::VoiceClipReader::new(&file).expect("Ogg Opus");
        assert_eq!(reader.duration_ms(), clip.duration_ms);
        recorder.discard(&clip);
        assert!(!clip.path.exists(), "thrown away");
    }

    #[test]
    fn a_take_stops_itself_at_the_limit_and_one_cancelled_leaves_nothing() {
        let mut recorder = ToneRecorder::default();
        recorder.start(100).expect("starts");
        std::thread::sleep(Duration::from_millis(400));
        assert!(recorder.progress().limit);
        let clip = recorder
            .finish()
            .recv_blocking()
            .expect("an answer")
            .expect("a clip");
        assert_eq!(clip.duration_ms, 100);
        recorder.discard(&clip);

        recorder.start(0).expect("starts");
        recorder.cancel();
        let none = recorder.finish().recv_blocking().expect("an answer");
        assert!(none.is_err(), "nothing to finish");
    }
}
