//! Voice messages, for a view that is not the web page: what a server
//! allows of them, recording one, sending it the way the web client does,
//! and reading one back to play it.
//!
//! The recorder and the clip format are the engine's own
//! (`state::voice_message`): a take is Ogg Opus, mono, 48 kHz, on every
//! platform, so what one client records every other plays.

use std::path::PathBuf;

use super::EngineHandle;

pub use crate::state::voice_message::{
    ClipReader as VoiceClipReader, ClipWriter as VoiceClipWriter, VoiceClip,
};

/// What a server allows of voice messages. A server that predates them
/// never says, which is the same as saying no.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct VoiceSupport {
    /// Whether it takes them at all.
    pub available: bool,
    /// The longest it takes, in seconds; 0 for no limit.
    pub max_seconds: u32,
    /// The largest it takes, in bytes; 0 for no limit.
    pub max_bytes: u64,
}

/// How a take is going, as the recorder reports it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum VoiceRecording {
    /// Recording.
    Recording {
        /// How long the take is so far.
        elapsed_ms: u32,
        /// How loud the last moment of it was, in thousandths of full scale.
        level: u16,
    },
    /// The take reached the server's limit and stopped itself; it waits to
    /// be sent like any other.
    Limit {
        /// How long the take is.
        elapsed_ms: u32,
    },
    /// The microphone could not be read. The take is over.
    Failed {
        /// Why, in words.
        reason: String,
    },
}

impl From<crate::state::voice_message::RecorderState> for VoiceRecording {
    fn from(state: crate::state::voice_message::RecorderState) -> Self {
        use crate::state::voice_message::RecorderState;
        match state {
            RecorderState::Recording { elapsed_ms, level } => Self::Recording {
                elapsed_ms,
                level: thousandths(level),
            },
            RecorderState::Limit { elapsed_ms } => Self::Limit { elapsed_ms },
            RecorderState::Failed { reason } => Self::Failed { reason },
        }
    }
}

/// A loudness from 0 to 1 in thousandths.
fn thousandths(level: f32) -> u16 {
    (level * 1000.0).round().clamp(0.0, 1000.0) as u16
}

/// What a message says of the voice message it carries: enough to draw it
/// before a byte of it is fetched.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VoiceNote {
    /// How long it plays, as its sender measured it.
    pub duration_ms: u32,
    /// Its loudness, oldest first, 0 to 100 a bar.
    pub waveform: Vec<u8>,
}

/// The most bars a stated waveform may carry, and the longest stated clip:
/// a message is its sender's word, and a card is laid out from it.
const MOST_BARS: usize = 128;
const LONGEST_MS: u64 = 24 * 3600 * 1000;

impl VoiceNote {
    /// What the `voice` of a file's mark says, where it is worth believing:
    /// as the web client reads it (`fileAttachments.ts`, `statedVoice`).
    /// Bars out of range are clamped, not refused: a bar slightly wrong is
    /// a drawing, not a lie about the file.
    pub(super) fn stated(value: &serde_json::Value) -> Option<Self> {
        let duration = value.get("durationMs")?.as_f64()?;
        if !duration.is_finite() || duration < 0.0 || duration > LONGEST_MS as f64 {
            return None;
        }
        let waveform = value
            .get("waveform")
            .and_then(serde_json::Value::as_array)
            .map(|bars| {
                bars.iter()
                    .take(MOST_BARS)
                    .map(|bar| bar.as_f64().map_or(0, percent))
                    .collect()
            })
            .unwrap_or_default();
        Some(Self {
            duration_ms: whole(duration),
            waveform,
        })
    }
}

/// A bar as a whole percentage.
fn percent(bar: f64) -> u8 {
    if bar.is_finite() {
        bar.round().clamp(0.0, 100.0) as u8
    } else {
        0
    }
}

/// A length already held under a day, in whole milliseconds.
fn whole(ms: f64) -> u32 {
    ms.round() as u32
}

/// What a voice message is called once shared: what the web client calls
/// it, and what others see.
const SHARED_NAME: &str = "voice-message.ogg";

/// `0:07`, `12:40`: a clip's length the way the web client writes it for a
/// client that cannot draw the card.
fn clip_length(duration_ms: u32) -> String {
    let seconds = (duration_ms + 500) / 1000;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

/// The message that carries a voice message: its mark, and on a server
/// that takes HTML a line for a client that does not know the mark. Byte
/// for byte what `sendVoiceMessage.ts` sends, but for the order of the
/// mark's fields.
pub(super) fn voice_message_body(
    key: &str,
    size: u64,
    expires_at: u64,
    clip: &VoiceClip,
    html: bool,
) -> String {
    use base64::Engine as _;
    let stated = serde_json::json!({
        "url": "",
        "key": key,
        "filename": SHARED_NAME,
        "sizeBytes": size,
        "mode": "session",
        "expiresAt": (expires_at > 0).then_some(expires_at),
        "voice": { "durationMs": clip.duration_ms, "waveform": clip.waveform },
    });
    let mark = format!(
        "<!-- FANCY_FILE:{} -->",
        base64::engine::general_purpose::STANDARD.encode(stated.to_string())
    );
    if !html {
        return mark;
    }
    format!(
        "{mark}\n<!-- FANCY_LEGACY -->\u{1f3a4} Voice message ({})<!-- /FANCY_LEGACY -->",
        clip_length(clip.duration_ms)
    )
}

/// Where clips wait between being made and being sent: the only place
/// [`EngineHandle::discard_voice_clip`] deletes from.
pub fn voice_clip_dir() -> PathBuf {
    crate::state::voice_message::clip_dir()
}

impl EngineHandle {
    /// Ask the server what it allows of voice messages. The answer arrives
    /// as [`super::EngineEvent::VoiceSupport`], and again whenever the
    /// server's operator changes it; a server that predates voice messages
    /// never answers.
    ///
    /// # Errors
    ///
    /// When not connected.
    pub async fn request_voice_support(&self) -> Result<(), String> {
        let asked = uuid::Uuid::new_v4().simple().to_string();
        self.state.request_voice_support(format!("voice-support-{asked}")).await
    }

    /// Start recording a voice message from the microphone chosen for
    /// talking, through the same filters. `limit_ms` is the server's
    /// limit, 0 for none: the take stops itself there. How it goes arrives
    /// as [`super::EngineEvent::VoiceRecording`].
    ///
    /// # Errors
    ///
    /// When the microphone cannot be opened.
    pub fn start_voice_message(&self, limit_ms: u32) -> Result<(), String> {
        self.state.start_voice_message(limit_ms)
    }

    /// End the take and hand over the clip, written to a file of its own.
    ///
    /// # Errors
    ///
    /// When nothing is being recorded, or nothing was.
    pub async fn finish_voice_message(&self) -> Result<VoiceClip, String> {
        self.state.finish_voice_message().await
    }

    /// End the take and throw it away; nothing when none is running.
    pub fn cancel_voice_message(&self) {
        self.state.cancel_voice_message();
    }

    /// Delete a finished clip's file. Only a file in [`voice_clip_dir`].
    ///
    /// # Errors
    ///
    /// When it is not a clip, or could not be deleted.
    pub fn discard_voice_clip(&self, path: &str) -> Result<(), String> {
        self.state.discard_voice_clip(path)
    }

    /// Send `clip` as a voice message: given to the server to keep as one
    /// (it checks its voice-message settings and the right to send them,
    /// not the right to share files), then said in `channel`, or to the
    /// user `direct` with `channel` the way it goes up. The clip's file is
    /// deleted whether or not this works: a recording of the user is not
    /// left in a temporary folder.
    ///
    /// # Errors
    ///
    /// When the server keeps no files, or refuses this one, or the message
    /// could not be sent.
    pub async fn send_voice_message(
        &self,
        channel: u32,
        direct: Option<u32>,
        clip: &VoiceClip,
    ) -> Result<(), String> {
        let sent = self.say_voice_message(channel, direct, clip).await;
        let _ = self.discard_voice_clip(&clip.path);
        sent
    }

    async fn say_voice_message(
        &self,
        channel: u32,
        direct: Option<u32>,
        clip: &VoiceClip,
    ) -> Result<(), String> {
        let shared = self
            .state
            .starling_upload_file(
                clip.path.clone(),
                channel,
                Some(clip.mime_type.to_owned()),
                String::new(),
                mumble_protocol::proto::fancy::files::Visibility::Session,
                0,
                String::new(),
                Some(clip.duration_ms),
            )
            .await?;
        let html = self.state.server_config().allow_html;
        let body = voice_message_body(&shared.key, shared.size, shared.expires_at, clip, html);
        match direct {
            Some(session) => self.state.send_dm(session, body).await,
            None => self.state.send_message(channel, body).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clip(duration_ms: u32) -> VoiceClip {
        VoiceClip {
            path: String::new(),
            duration_ms,
            size: 1234,
            mime_type: "audio/ogg",
            waveform: vec![0, 50, 100],
        }
    }

    #[test]
    fn a_voice_message_is_said_as_the_web_client_says_it() {
        let body = voice_message_body("k/1", 1234, 0, &clip(1400), true);
        let (mark, line) = body.split_once('\n').expect("a mark, then a line");
        assert_eq!(
            line,
            "<!-- FANCY_LEGACY -->\u{1f3a4} Voice message (0:01)<!-- /FANCY_LEGACY -->"
        );
        let file = super::super::attachments_in(mark);
        assert_eq!(file.len(), 1);
        assert_eq!(file[0].filename, "voice-message.ogg");
        assert_eq!(file[0].key.as_deref(), Some("k/1"));
        assert_eq!(file[0].mode.as_deref(), Some("session"));
        assert_eq!(file[0].expires_at, None);
        assert_eq!(
            file[0].voice,
            Some(VoiceNote {
                duration_ms: 1400,
                waveform: vec![0, 50, 100]
            })
        );
        // On a server that takes no HTML, the mark alone.
        assert_eq!(voice_message_body("k/1", 1234, 0, &clip(1400), false), mark);
        assert_eq!(clip_length(61_499), "1:01");
        assert_eq!(clip_length(61_500), "1:02");
    }

    #[test]
    fn a_stated_voice_is_believed_only_as_far_as_it_is_believable() {
        let read = |json: &str| VoiceNote::stated(&serde_json::from_str(json).expect("json"));
        assert_eq!(
            read(r#"{"durationMs":1500.4,"waveform":[-5,40.6,250,"x"]}"#),
            Some(VoiceNote {
                duration_ms: 1500,
                waveform: vec![0, 41, 100, 0]
            })
        );
        assert_eq!(read(r#"{"durationMs":-1,"waveform":[]}"#), None);
        assert_eq!(read(r#"{"durationMs":99999999999}"#), None);
        assert_eq!(read(r#"{"waveform":[1]}"#), None);
        let long = format!(r#"{{"durationMs":1,"waveform":[{}]}}"#, vec!["7"; 300].join(","));
        assert_eq!(read(&long).map(|note| note.waveform.len()), Some(MOST_BARS));
        assert_eq!(thousandths(0.5), 500);
        assert_eq!(thousandths(2.0), 1000);
    }
}
