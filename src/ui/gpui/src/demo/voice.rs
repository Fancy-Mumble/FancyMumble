//! Voice messages on the demo server: sent the way a real server would
//! carry them, as a file whose message says how long it is and its shape.

use super::{DemoEngine, FIRST_MESSAGE_MS, MINUTE_MS, OWN};
use crate::engine::{Attachment, Conversation, EngineEvent, Message, Session};
use crate::voice::{Clip, Note};

impl DemoEngine {
    /// What the demo's made-up recorder and player share: their clock,
    /// what they did, and what the server allows.
    pub(crate) fn voice(&self) -> &crate::voice::made_up::Studio {
        &self.voice
    }

    /// Have the demo server say how the voice packets fared.
    #[cfg(test)]
    pub(crate) fn set_voice_stats(&self, stats: crate::sound_check::Stats) {
        self.with_state(|state| state.stats = Some(stats));
    }

    /// How the noise suppressor was last tuned.
    #[cfg(test)]
    pub(crate) fn tuning(&self) -> std::collections::BTreeMap<String, f32> {
        self.with_state(|state| state.tuning.clone())
    }

    /// `clip`, said in `conversation` by the local user as a voice message.
    pub(super) fn say_voice(&self, conversation: Conversation, clip: &Clip) {
        let note = Note {
            duration_ms: clip.duration_ms,
            waveform: clip.waveform.clone().into(),
        };
        self.voice_said(OWN, "Alex", conversation, note, clip.size);
    }

    /// Have Rin and the local user say `count` voice messages in the
    /// lounge, taking turns: for looking at how they are drawn.
    pub(crate) fn voice_messages(&self, count: u32) {
        for nth in 0..count {
            let duration_ms = 1_000 + (nth * 7_919) % 61_000;
            let waveform: Vec<u8> = (0..48u32)
                .map(|bar| u8::try_from((bar * 37 + nth * 11) % 90 + 10).unwrap_or(50))
                .collect();
            let note = Note {
                duration_ms,
                waveform: waveform.into(),
            };
            let (session, name) = if nth % 2 == 0 {
                (3, "Rin")
            } else {
                (OWN, "Alex")
            };
            let size = u64::from(duration_ms) * 4;
            self.voice_said(session, name, Conversation::Channel(1), note, size);
        }
    }

    /// One voice message said by `session`, called `name`.
    fn voice_said(
        &self,
        session: Session,
        name: &str,
        conversation: Conversation,
        note: Note,
        size: u64,
    ) {
        self.with_state(|state| {
            let sent_at_ms = state
                .messages
                .last()
                .and_then(|(_, last)| last.sent_at_ms)
                .map_or(FIRST_MESSAGE_MS, |last| last + MINUTE_MS);
            state.messages.push((
                conversation,
                Message {
                    sender: Some(session),
                    sender_name: name.to_owned().into(),
                    html: gpui::SharedString::default(),
                    body: "sent a voice message".into(),
                    sent_at_ms: Some(sent_at_ms),
                    own: session == OWN,
                    id: Some(format!("demo-voice-{sent_at_ms}").into()),
                    edited: false,
                    failed: false,
                    pinned: false,
                    files: vec![Attachment {
                        name: "voice-message.ogg".into(),
                        size: Some(size),
                        key: Some(format!("demo/voice-{sent_at_ms}").into()),
                        voice: Some(note),
                        ..Attachment::default()
                    }],
                    reply_to: None,
                    reactions: Vec::new(),
                },
            ));
        });
        self.tell(EngineEvent::NewMessage { conversation });
    }
}
