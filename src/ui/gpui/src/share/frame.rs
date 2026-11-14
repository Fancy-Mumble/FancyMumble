//! Frames on their way from a stream to the window.
//!
//! A stream makes frames on a thread of its own; the window takes the newest
//! when it draws. The [`FrameSlot`] between them holds one frame: a frame
//! the window has not taken by the time the next is ready is dropped, so a
//! window that cannot keep up shows fewer frames, never older ones, and holds
//! no queue. What the window wants of a stream ([`Wanted`]) goes the other
//! way: the size it is shown at (frames are made that size, not the size
//! they were sent at), how many a second, and when it was last drawn at all
//! (a stream not drawn for a moment is not decoded).

use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use super::fit::Fit;

/// A stream not drawn for this long is taken to be out of sight.
pub(crate) const UNSEEN_AFTER: Duration = Duration::from_millis(1500);

/// One frame, ready to draw: BGRA, tightly packed.
#[derive(Clone, PartialEq, Eq)]
pub(crate) struct Frame {
    pub width: u32,
    pub height: u32,
    pub bgra: Vec<u8>,
    /// The size the stream was sent at, before it was scaled for the room.
    pub sent: (u32, u32),
}

impl std::fmt::Debug for Frame {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Frame")
            .field("width", &self.width)
            .field("height", &self.height)
            .field("sent", &self.sent)
            .finish_non_exhaustive()
    }
}

/// The newest frame of one stream, between its thread and the window.
#[derive(Clone, Default)]
pub(crate) struct FrameSlot(Arc<Mutex<Slot>>);

#[derive(Default)]
struct Slot {
    ready: Option<Frame>,
    /// A buffer the window is done with, for the next frame to be made in.
    spare: Option<Vec<u8>>,
    made: u64,
    dropped: u64,
}

impl std::fmt::Debug for FrameSlot {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let (made, dropped) = self.counts();
        f.debug_struct("FrameSlot")
            .field("made", &made)
            .field("dropped", &dropped)
            .finish()
    }
}

impl FrameSlot {
    fn slot(&self) -> std::sync::MutexGuard<'_, Slot> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Put `frame` out for the window, in place of one it did not take.
    /// Says whether the window has to be woken: it was not, for that one.
    pub(crate) fn put(&self, frame: Frame) -> bool {
        let mut slot = self.slot();
        slot.made += 1;
        let replaced = slot.ready.replace(frame);
        let wake = replaced.is_none();
        if let Some(old) = replaced {
            slot.dropped += 1;
            slot.spare = Some(old.bgra);
        }
        wake
    }

    /// The newest frame, if one came since the last was taken.
    pub(crate) fn take(&self) -> Option<Frame> {
        self.slot().ready.take()
    }

    /// The window is done with `buffer`: the next frame is made in it.
    pub(crate) fn give_back(&self, buffer: Vec<u8>) {
        self.slot().spare = Some(buffer);
    }

    /// A buffer of `len` bytes to make the next frame in.
    pub(crate) fn buffer(&self, len: usize) -> Vec<u8> {
        let mut buffer = self.slot().spare.take().unwrap_or_default();
        buffer.resize(len, 0);
        buffer
    }

    /// How many frames were made, and how many of those the window never
    /// took.
    pub(crate) fn counts(&self) -> (u64, u64) {
        let slot = self.slot();
        (slot.made, slot.dropped)
    }
}

/// What the window wants of one stream.
#[derive(Debug)]
pub(crate) struct Wanted {
    /// Width and height in device pixels, one word each; 0 before the
    /// stream was ever drawn.
    size: AtomicU64,
    /// Frames a second.
    rate: AtomicU32,
    /// How it is laid in its room: [`Fit`] by its place in [`Fit::ALL`].
    fit: AtomicU32,
    /// When it was last drawn, in milliseconds after `since`; 0 for never.
    drawn: AtomicU64,
    since: Instant,
}

impl Wanted {
    pub(crate) fn new() -> Arc<Self> {
        Arc::new(Self {
            size: AtomicU64::new(0),
            rate: AtomicU32::new(30),
            fit: AtomicU32::new(0),
            drawn: AtomicU64::new(0),
            since: Instant::now(),
        })
    }

    /// It is drawn now, laid `fit` in a room `width` by `height` device
    /// pixels, and wanted at `rate` frames a second.
    pub(crate) fn drawn(&self, width: u32, height: u32, rate: u32, fit: Fit) {
        self.size
            .store(u64::from(width) << 32 | u64::from(height), Ordering::Relaxed);
        self.rate.store(rate.max(1), Ordering::Relaxed);
        let place = Fit::ALL.iter().position(|each| *each == fit).unwrap_or(0);
        self.fit.store(u32::try_from(place).unwrap_or(0), Ordering::Relaxed);
        let at = u64::try_from(self.since.elapsed().as_millis()).unwrap_or(u64::MAX);
        self.drawn.store(at.max(1), Ordering::Relaxed);
    }

    /// The size a picture sent `sent` large is made for its room: as large
    /// as it is drawn there, never larger than it was sent (the window
    /// enlarges for nothing), and as sent before it was ever drawn.
    pub(crate) fn size_for(&self, sent: (u32, u32)) -> (u32, u32) {
        let Some(room) = self.size() else {
            return sent;
        };
        let fit = Fit::ALL[self.fit.load(Ordering::Relaxed) as usize % Fit::ALL.len()];
        let laid = fit.place(
            (sent.0 as f32, sent.1 as f32),
            (room.0 as f32, room.1 as f32),
            1.0,
        );
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a size on screen, positive and far below u32"
        )]
        let (width, height) = (laid.width.round() as u32, laid.height.round() as u32);
        if width >= sent.0 || height >= sent.1 {
            sent
        } else {
            (width.max(2), height.max(2))
        }
    }

    /// The size it is drawn at, once it has been drawn.
    pub(crate) fn size(&self) -> Option<(u32, u32)> {
        let both = self.size.load(Ordering::Relaxed);
        #[expect(clippy::cast_possible_truncation, reason = "two words packed into one")]
        let (width, height) = ((both >> 32) as u32, both as u32);
        (width > 0 && height > 0).then_some((width, height))
    }

    pub(crate) fn rate(&self) -> u32 {
        self.rate.load(Ordering::Relaxed)
    }

    /// Whether it was drawn lately: a stream that is not is not worked on.
    pub(crate) fn in_sight(&self) -> bool {
        let drawn = self.drawn.load(Ordering::Relaxed);
        let now = u64::try_from(self.since.elapsed().as_millis()).unwrap_or(u64::MAX);
        drawn > 0 && now.saturating_sub(drawn) < UNSEEN_AFTER.as_millis() as u64
    }
}

/// How often something is done: no more than so many times a second.
#[derive(Debug, Default)]
pub(crate) struct Pace {
    last: Option<Instant>,
}

impl Pace {
    /// Whether, at `rate` a second, it is due again at `now`. Says so once.
    pub(crate) fn due(&mut self, rate: u32, now: Instant) -> bool {
        // A little early is on time: frames arrive with jitter, and one that
        // misses its turn by a millisecond would halve the rate.
        let interval = Duration::from_secs(1) / rate.max(1);
        let early = interval / 8;
        let due = self
            .last
            .is_none_or(|last| now.duration_since(last) + early >= interval);
        if due {
            self.last = Some(now);
        }
        due
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(width: u32, height: u32) -> Frame {
        Frame {
            width,
            height,
            bgra: vec![0; (width * height * 4) as usize],
            sent: (width, height),
        }
    }

    #[test]
    fn a_frame_not_taken_is_dropped_for_the_next_and_its_buffer_used_again() {
        let slot = FrameSlot::default();
        assert!(slot.put(frame(2, 2)), "the first wakes the window");
        assert!(!slot.put(frame(4, 4)), "the window is woken already");
        assert_eq!(slot.counts(), (2, 1));
        let taken = slot.take().expect("the newest");
        assert_eq!((taken.width, taken.height), (4, 4));
        assert!(slot.take().is_none(), "taken once");
        // The dropped frame's buffer is the next one's.
        assert_eq!(slot.buffer(8).len(), 8);
        slot.give_back(taken.bgra);
        assert_eq!(slot.buffer(64).capacity(), 64);
        assert!(slot.put(frame(1, 1)), "taken, so the next wakes again");
    }

    #[test]
    fn a_stream_is_in_sight_while_it_is_drawn() {
        let wanted = Wanted::new();
        assert!(!wanted.in_sight(), "never drawn");
        assert_eq!(wanted.size(), None);
        assert_eq!(wanted.size_for((1920, 1080)), (1920, 1080), "as sent, until drawn");
        wanted.drawn(320, 180, 5, Fit::Whole);
        assert!(wanted.in_sight());
        assert_eq!(wanted.size(), Some((320, 180)));
        assert_eq!(wanted.rate(), 5);
    }

    #[test]
    fn a_picture_is_made_as_large_as_it_is_drawn_and_never_larger_than_sent() {
        let wanted = Wanted::new();
        wanted.drawn(800, 600, 30, Fit::Whole);
        assert_eq!(wanted.size_for((1920, 1080)), (800, 450));
        wanted.drawn(800, 600, 30, Fit::Fill);
        assert_eq!(wanted.size_for((1920, 1080)), (1067, 600));
        wanted.drawn(800, 600, 30, Fit::Actual);
        assert_eq!(wanted.size_for((1920, 1080)), (1920, 1080), "pixel for pixel");
        wanted.drawn(3000, 2000, 30, Fit::Whole);
        assert_eq!(wanted.size_for((1280, 720)), (1280, 720), "not enlarged");
    }

    #[test]
    fn pace_lets_through_so_many_a_second() {
        let start = Instant::now();
        let mut pace = Pace::default();
        let times = (0..60)
            .filter(|step| pace.due(10, start + Duration::from_millis(step * 1000 / 60)))
            .count();
        assert_eq!(times, 10, "ten of sixty frames a second");
        assert!(pace.due(30, start + Duration::from_secs(5)));
        assert!(!pace.due(30, start + Duration::from_secs(5) + Duration::from_millis(10)));
        assert!(pace.due(30, start + Duration::from_secs(5) + Duration::from_millis(30)));
    }
}
