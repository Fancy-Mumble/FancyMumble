//! The real engine's recorder: a take from the microphone chosen for
//! talking, through the same filters, written by the engine.

use std::sync::Arc;

use mumble_tauri_lib::engine_api::EngineHandle;
use mumble_tauri_lib::engine_api::voice::VoiceClip;

use super::heard::Heard;
use super::{Clip, Finished, Progress, Recorder};

/// Records through the engine. How a take goes is what the engine says of
/// it, kept in `heard`.
pub(crate) struct EngineRecorder {
    engine: EngineHandle,
    runtime: tokio::runtime::Handle,
    heard: Arc<Heard>,
}

impl EngineRecorder {
    pub(crate) fn new(
        engine: EngineHandle,
        runtime: tokio::runtime::Handle,
        heard: Arc<Heard>,
    ) -> Self {
        Self {
            engine,
            runtime,
            heard,
        }
    }
}

impl Recorder for EngineRecorder {
    fn start(&mut self, limit_ms: u32) -> Result<(), String> {
        self.heard.begin();
        self.engine.start_voice_message(limit_ms)
    }

    fn progress(&self) -> Progress {
        self.heard.progress()
    }

    fn finish(&mut self) -> Finished {
        let (tell, told) = async_channel::bounded(1);
        let engine = self.engine.clone();
        drop(self.runtime.spawn(async move {
            let clip = engine.finish_voice_message().await.map(clip_of);
            let _ = tell.send(clip).await;
        }));
        told
    }

    fn cancel(&mut self) {
        self.engine.cancel_voice_message();
    }

    fn discard(&mut self, clip: &Clip) {
        if let Err(error) = self.engine.discard_voice_clip(&clip.path.to_string_lossy()) {
            tracing::debug!(%error, "a voice message's file was not deleted");
        }
    }
}

/// The engine's clip as the view's.
pub(crate) fn clip_of(clip: VoiceClip) -> Clip {
    Clip {
        path: clip.path.into(),
        duration_ms: clip.duration_ms,
        size: clip.size,
        waveform: clip.waveform,
    }
}

/// The view's clip as the engine's, to be sent.
pub(crate) fn engine_clip(clip: Clip) -> VoiceClip {
    VoiceClip {
        path: clip.path.to_string_lossy().into_owned(),
        duration_ms: clip.duration_ms,
        size: clip.size,
        mime_type: "audio/ogg",
        waveform: clip.waveform,
    }
}
