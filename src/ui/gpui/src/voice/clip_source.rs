//! A voice message as something to play: decoded a frame at a time as it
//! is heard, from wherever it is sought to, as fast as asked and no higher
//! (`stretch`).

use std::num::{NonZeroU16, NonZeroU32};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::time::Duration;

use mumble_tauri_lib::engine_api::voice::VoiceClipReader;
use rodio::source::SeekError;

use super::stretch::Stretch;

/// Samples a second: every voice message is 48 kHz.
const RATE: u32 = 48_000;

/// What the one playing it turns while it plays, and reads off it.
#[derive(Debug)]
pub(super) struct Dial {
    /// How fast it plays, as an `f32`'s bits.
    speed: AtomicU32,
    /// Where in the voice message what is heard now is, in samples.
    heard: AtomicU64,
    /// Where it is to go, in milliseconds; [`NOWHERE`] for nowhere. Taken
    /// up by the one playing it at its next sample, so whoever asks waits
    /// for nothing.
    seek: AtomicU64,
}

/// No seek asked for.
const NOWHERE: u64 = u64::MAX;

impl Dial {
    fn new(speed: f32) -> Self {
        Self {
            speed: AtomicU32::new(speed.to_bits()),
            heard: AtomicU64::new(0),
            seek: AtomicU64::new(NOWHERE),
        }
    }

    /// Go to `at_ms`.
    pub(super) fn seek(&self, at_ms: u32) {
        self.heard
            .store(u64::from(at_ms) * u64::from(RATE) / 1000, Ordering::Relaxed);
        self.seek.store(u64::from(at_ms), Ordering::Relaxed);
    }

    pub(super) fn set_speed(&self, speed: f32) {
        self.speed.store(speed.to_bits(), Ordering::Relaxed);
    }

    fn speed(&self) -> f32 {
        f32::from_bits(self.speed.load(Ordering::Relaxed))
    }

    /// Where what is heard now is, in milliseconds.
    pub(super) fn heard_ms(&self) -> u32 {
        u32::try_from(self.heard.load(Ordering::Relaxed) * 1000 / u64::from(RATE))
            .unwrap_or(u32::MAX)
    }
}

/// A voice message being played. What is held decoded is a frame or two.
pub(super) struct ClipSource {
    reader: VoiceClipReader,
    stretch: Stretch,
    /// Whether what comes out goes through the stretch: at any speed but
    /// one.
    stretching: bool,
    /// Whether the reader has nothing more for the stretch.
    read_out: bool,
    /// The stretch of output being handed out, and how far into it.
    frame: Vec<f32>,
    at: usize,
    dial: Arc<Dial>,
}

impl ClipSource {
    /// The voice message in `file`, a whole Ogg Opus file, to be played
    /// `speed` times as fast.
    pub(super) fn new(file: &[u8], speed: f32) -> Result<Self, String> {
        Ok(Self {
            reader: VoiceClipReader::new(file)?,
            stretch: Stretch::default(),
            stretching: false,
            read_out: false,
            frame: Vec::new(),
            at: 0,
            dial: Arc::new(Dial::new(speed)),
        })
    }

    /// How long it plays.
    pub(super) fn length_ms(&self) -> u32 {
        self.reader.duration_ms()
    }

    /// What its speed is set with and where it is read from.
    pub(super) fn dial(&self) -> Arc<Dial> {
        Arc::clone(&self.dial)
    }

    /// The next stretch of output; `None` at the end.
    fn refill(&mut self) -> Option<Vec<f32>> {
        let speed = self.dial.speed();
        if (speed - 1.0).abs() < 0.01 {
            if self.stretching {
                // Back to one: on from where the stretch had got to.
                self.stretching = false;
                let _ = self.reader.seek(self.stretch.position());
            }
            let frame = self.reader.next_frame()?;
            self.dial
                .heard
                .store(self.reader.position(), Ordering::Relaxed);
            return Some(frame);
        }
        if !self.stretching {
            self.stretching = true;
            self.read_out = false;
            self.stretch.restart(self.reader.position());
        }
        loop {
            if let Some(out) = self.stretch.step(speed, self.read_out) {
                self.dial
                    .heard
                    .store(self.stretch.position(), Ordering::Relaxed);
                return Some(out);
            }
            if self.read_out {
                return None;
            }
            match self.reader.next_frame() {
                Some(frame) => self.stretch.feed(&frame),
                None => self.read_out = true,
            }
        }
    }
}

impl Iterator for ClipSource {
    type Item = f32;

    fn next(&mut self) -> Option<f32> {
        let sought = self.dial.seek.swap(NOWHERE, Ordering::Relaxed);
        if sought != NOWHERE {
            let _ = rodio::Source::try_seek(self, Duration::from_millis(sought));
        }
        while self.at >= self.frame.len() {
            self.frame = self.refill()?;
            self.at = 0;
        }
        let sample = self.frame.get(self.at).copied();
        self.at += 1;
        sample
    }
}

impl rodio::Source for ClipSource {
    fn current_span_len(&self) -> Option<usize> {
        None
    }

    fn channels(&self) -> NonZeroU16 {
        NonZeroU16::MIN
    }

    fn sample_rate(&self) -> NonZeroU32 {
        NonZeroU32::new(RATE).unwrap_or(NonZeroU32::MIN)
    }

    fn total_duration(&self) -> Option<Duration> {
        Some(Duration::from_millis(u64::from(self.length_ms())))
    }

    fn try_seek(&mut self, to: Duration) -> Result<(), SeekError> {
        let sample = u64::try_from(to.as_millis()).unwrap_or(u64::MAX) * u64::from(RATE) / 1000;
        self.reader
            .seek(sample)
            .map_err(|error| SeekError::Other(Arc::new(std::io::Error::other(error))))?;
        self.stretching = false;
        self.frame.clear();
        self.at = 0;
        self.dial
            .heard
            .store(self.reader.position(), Ordering::Relaxed);
        Ok(())
    }
}

/// A voice message written the way a take writes one, from a tone of
/// `seconds`: for tests that must not touch a microphone.
#[cfg(test)]
pub(crate) fn made_clip(
    seconds: u32,
) -> (
    std::path::PathBuf,
    mumble_tauri_lib::engine_api::voice::VoiceClip,
) {
    use mumble_tauri_lib::engine_api::voice::VoiceClipWriter;
    let dir = std::env::temp_dir().join(format!(
        "fancy-gpui-voice-test-{}-{}",
        std::process::id(),
        MADE.fetch_add(1, Ordering::Relaxed)
    ));
    let mut writer = VoiceClipWriter::new().expect("an encoder");
    let samples = super::tone_recorder::Tone::default().take(seconds * RATE);
    writer.push(&samples, u64::MAX).expect("encodes");
    let clip = writer.finish(&dir).expect("a clip");
    (dir, clip)
}

#[cfg(test)]
static MADE: AtomicU32 = AtomicU32::new(0);

#[cfg(test)]
mod tests {
    use rodio::Source as _;

    use super::*;

    fn source(seconds: u32, speed: f32) -> ClipSource {
        let (dir, clip) = made_clip(seconds);
        let file = std::fs::read(&clip.path).expect("the file");
        let _ = std::fs::remove_dir_all(dir);
        ClipSource::new(&file, speed).expect("a voice message")
    }

    #[test]
    fn a_voice_message_plays_every_sample_it_has_and_no_more() {
        let played = source(2, 1.0);
        let dial = played.dial();
        assert_eq!(played.length_ms(), 2000);
        assert_eq!(played.total_duration(), Some(Duration::from_secs(2)));
        let samples: Vec<f32> = played.collect();
        assert_eq!(samples.len(), 2 * 48_000);
        let loudest = samples.iter().fold(0.0f32, |most, s| most.max(s.abs()));
        assert!(loudest > 0.2, "the tone is heard: {loudest}");
        assert_eq!(dial.heard_ms(), 2000);
    }

    #[test]
    fn it_plays_on_from_where_it_is_sought_to() {
        let mut played = source(3, 1.0);
        played
            .try_seek(Duration::from_millis(2_500))
            .expect("seeks");
        assert_eq!(played.dial().heard_ms(), 2_500);
        assert_eq!(played.by_ref().count(), 24_000);
        played.try_seek(Duration::ZERO).expect("seeks back");
        assert_eq!(played.count(), 3 * 48_000);
    }

    #[test]
    fn faster_it_takes_less_time_and_still_reaches_the_end() {
        let played = source(2, 2.0);
        let dial = played.dial();
        let out = played.count();
        assert!((47_000..=50_000).contains(&out), "about one second: {out}");
        assert!(dial.heard_ms() >= 1_900, "{}", dial.heard_ms());
    }

    #[test]
    fn the_speed_changes_while_it_plays() {
        let mut played = source(2, 1.0);
        let dial = played.dial();
        assert_eq!(played.by_ref().take(48_000).count(), 48_000);
        dial.set_speed(2.0);
        let rest = played.by_ref().count();
        assert!(
            (23_000..=26_000).contains(&rest),
            "the second second in half: {rest}"
        );
    }

    #[test]
    fn a_seek_asked_while_it_plays_is_taken_up_at_once() {
        let mut played = source(2, 1.0);
        let dial = played.dial();
        assert_eq!(played.by_ref().take(10_000).count(), 10_000);
        dial.seek(1_500);
        assert_eq!(dial.heard_ms(), 1_500, "said at once");
        assert_eq!(played.count(), 24_000);
    }
}
