//! What the real engine says of voice messages, kept for the view to read:
//! what the server allows, and how the take is going.

use std::sync::{Mutex, PoisonError};

use mumble_tauri_lib::engine_api::voice::{VoiceRecording, VoiceSupport};

use super::{Progress, Support};

/// What the engine last said.
#[derive(Debug, Default)]
pub(crate) struct Heard {
    /// What the server on screen allows; `None` until it has said.
    support: Mutex<Option<Support>>,
    progress: Mutex<Progress>,
}

impl Heard {
    /// The server said what it allows.
    pub(crate) fn allow(&self, support: VoiceSupport) {
        *self.support.lock().unwrap_or_else(PoisonError::into_inner) = Some(Support {
            available: support.available,
            max_seconds: support.max_seconds,
            max_bytes: support.max_bytes,
        });
    }

    /// The server went: what it allowed is no longer known.
    pub(crate) fn forget(&self) {
        *self.support.lock().unwrap_or_else(PoisonError::into_inner) = None;
    }

    /// What the server allows, as far as it said.
    pub(crate) fn support(&self) -> Option<Support> {
        *self.support.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The recorder said how the take is going.
    pub(crate) fn note(&self, recording: VoiceRecording) {
        let mut progress = self.progress.lock().unwrap_or_else(PoisonError::into_inner);
        match recording {
            VoiceRecording::Recording { elapsed_ms, level } => {
                progress.elapsed_ms = elapsed_ms;
                progress.level = f32::from(level) / 1000.0;
            }
            VoiceRecording::Limit { elapsed_ms } => {
                progress.elapsed_ms = elapsed_ms;
                progress.limit = true;
            }
            VoiceRecording::Failed { reason } => progress.failed = Some(reason),
        }
    }

    /// A take is starting: nothing is known of it yet.
    pub(crate) fn begin(&self) {
        *self.progress.lock().unwrap_or_else(PoisonError::into_inner) = Progress::default();
    }

    /// How the take is going.
    pub(crate) fn progress(&self) -> Progress {
        self.progress
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn what_the_recorder_says_is_how_the_take_is_going() {
        let heard = Heard::default();
        heard.note(VoiceRecording::Recording {
            elapsed_ms: 400,
            level: 250,
        });
        assert_eq!(heard.progress().elapsed_ms, 400);
        assert!((heard.progress().level - 0.25).abs() < f32::EPSILON);
        heard.note(VoiceRecording::Limit { elapsed_ms: 1000 });
        assert!(heard.progress().limit);
        heard.note(VoiceRecording::Failed {
            reason: "no microphone".to_owned(),
        });
        assert_eq!(heard.progress().failed.as_deref(), Some("no microphone"));
        heard.begin();
        assert_eq!(heard.progress(), Progress::default());
        assert_eq!(heard.support(), None);
        heard.allow(VoiceSupport {
            available: true,
            max_seconds: 60,
            max_bytes: 0,
        });
        assert_eq!(heard.support().map(Support::limit_ms), Some(60_000));
        heard.forget();
        assert_eq!(heard.support(), None);
    }
}
