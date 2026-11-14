//! Voice messages: recording one, and playing one that arrived.
//!
//! The view reaches both through two traits, [`Recorder`] and [`Player`],
//! which an engine hands out: the real engine's record from the microphone
//! chosen for talking and play through the speakers, the demo's are made
//! up (`made_up`) and make no sound at all. Neither is made before it is
//! first wanted: nothing of the audio machinery exists until the microphone
//! button is pressed or a voice message is played.
//!
//! What a message says of a voice message ([`Note`]) is drawn as it is;
//! the file is fetched only when it is played, and what is decoded of it is
//! never held whole (`clip_source`). Faster, it plays no higher
//! (`stretch`), as a browser plays the web client's.

mod clip_source;
pub(crate) mod engine_player;
pub(crate) mod engine_recorder;
pub(crate) mod heard;
pub(crate) mod made_up;
mod output;
mod stretch;
pub(crate) mod tone_recorder;

use std::path::PathBuf;

use gpui::SharedString;

/// What a server allows of voice messages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Support {
    /// Whether it takes them at all.
    pub available: bool,
    /// The longest it takes, in seconds; 0 for no limit.
    pub max_seconds: u32,
    /// The largest it takes, in bytes; 0 for no limit.
    pub max_bytes: u64,
}

impl Support {
    /// The longest take, in milliseconds; 0 for no limit.
    pub(crate) const fn limit_ms(self) -> u32 {
        self.max_seconds.saturating_mul(1000)
    }
}

/// What a message says of the voice message it carries: enough to draw
/// it before a byte of it is fetched.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub(crate) struct Note {
    /// How long it plays, as its sender measured it.
    pub duration_ms: u32,
    /// Its loudness, oldest first, 0 to 100 a bar.
    pub waveform: std::sync::Arc<[u8]>,
}

/// How a take is going.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Progress {
    /// How long it is so far.
    pub elapsed_ms: u32,
    /// How loud its last moment was, 0 to 1.
    pub level: f32,
    /// Whether it reached the server's limit and stopped itself.
    pub limit: bool,
    /// Why it ended, where the microphone could not be read.
    pub failed: Option<String>,
}

/// A finished take, written to a file of its own until it is sent or
/// thrown away.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Clip {
    pub path: PathBuf,
    pub duration_ms: u32,
    /// How large the file is, in bytes.
    pub size: u64,
    /// Its loudness, 0 to 100 a bar, for drawing it.
    pub waveform: Vec<u8>,
}

/// What a finished take arrives on.
pub(crate) type Finished = async_channel::Receiver<Result<Clip, String>>;

/// Records voice messages, one take at a time.
pub(crate) trait Recorder {
    /// Start a take that stops itself at `limit_ms` (0 for no limit). A
    /// microphone that cannot be read is said in [`Self::progress`].
    fn start(&mut self, limit_ms: u32) -> Result<(), String>;

    /// How the take is going.
    fn progress(&self) -> Progress;

    /// End the take; the clip arrives on what is handed back.
    fn finish(&mut self) -> Finished;

    /// End the take and throw it away. Nothing when none is running.
    fn cancel(&mut self);

    /// Throw away a finished clip that is not to be sent.
    fn discard(&mut self, clip: &Clip);
}

/// What a player is doing.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum State {
    /// Nothing held.
    #[default]
    Idle,
    /// Fetching or opening what it was asked to play.
    Loading,
    Playing,
    Paused,
    /// Played to its end; it starts again from the beginning.
    Ended,
    /// It could not be fetched or read.
    Failed,
}

/// What a player is doing, and with what.
#[derive(Debug, Clone, PartialEq, Default)]
pub(crate) struct Playback {
    /// What the voice message it holds is kept under.
    pub key: Option<SharedString>,
    pub state: State,
    /// Where it is in it.
    pub at_ms: u32,
    /// How long it is: what its message said until the file says better.
    pub length_ms: u32,
}

/// Plays voice messages, one at a time.
pub(crate) trait Player {
    /// Play the voice message kept under `key`, `length_ms` long as its
    /// message says, from `at_ms`, `speed` times as fast. It is fetched
    /// first where it is not the one held; whatever else was playing stops.
    fn play(&mut self, key: &SharedString, length_ms: u32, at_ms: u32, speed: f32);

    fn pause(&mut self);

    /// Go to `at_ms` in the one held.
    fn seek(&mut self, at_ms: u32);

    fn set_speed(&mut self, speed: f32);

    /// Stop, and let go of everything held: the file and what was decoded.
    fn stop(&mut self);

    /// What it is doing.
    fn now(&self) -> Playback;
}

/// Whether voice messages are to make no sound and hear no microphone:
/// under test, and in a run kept silent (`crate::silence`). A take is then
/// a tone made up on the spot, and playing decodes to no device, at the
/// pace it would be heard.
pub(crate) fn silent() -> bool {
    crate::silence::everything()
}

/// `m:ss`, the way a clip's length and a take's time are shown.
pub(crate) fn clock(ms: u32) -> String {
    let seconds = ms / 1000;
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_length_reads_as_minutes_and_seconds() {
        assert_eq!(clock(0), "0:00");
        assert_eq!(clock(1_999), "0:01");
        assert_eq!(clock(61_000), "1:01");
        assert_eq!(clock(600_000), "10:00");
        assert_eq!(
            Support {
                max_seconds: 120,
                ..Support::default()
            }
            .limit_ms(),
            120_000
        );
    }
}
