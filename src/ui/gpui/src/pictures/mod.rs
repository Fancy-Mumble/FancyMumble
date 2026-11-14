//! The pictures on screen, each held at the size it is seen at.
//!
//! A picture arrives as its file. Drawn from that, GPUI would decode all of
//! it and keep it for as long as the program runs: a photograph of twenty
//! megapixels is eighty megabytes, twice over once it is on the graphics
//! card, and an animation is that for every frame. So nothing here is drawn
//! from its file. [`shown`] gives what an `img` draws instead: a copy read
//! on another thread, scaled to the room it is shown in, kept while it is
//! looked at and for a little after, and let go of when the room is needed.

mod scaled;

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{App, Global, ImageCacheError, ImageSource, RenderImage, Window};

use scaled::{MIDDLE, Most, Read, Refused};

/// The room a picture is shown in, which is what decides how much of it is
/// kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Fit {
    /// Somebody's face, beside what they say: square, whatever shape
    /// the picture they chose is.
    Face,
    /// The picture across the head of a card, at the head's shape.
    Banner,
    /// A picture in a conversation, a banner, a preview.
    Tile,
    /// A picture in a page a server wrote, larger than a tile: as wide as
    /// the page's column, kept no finer than that.
    Page,
    /// The one picture opened large.
    Large,
    /// The banner across the head of a server's page: as wide as a window
    /// and a fifth as tall, cut around this point of it, in percent across
    /// and down.
    Livery(u8, u8),
    /// The picture behind a conversation: as wide as its column, and
    /// washed, so kept no finer than that shows; blurred this far, in
    /// pixels of a window, which is done once as it is read.
    Wall(u8),
}

impl Fit {
    /// How large a picture is kept for this room, on a screen that draws
    /// `scale` pixels to each of its own.
    fn most(self, scale: f32) -> Most {
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "one, two or three"
        )]
        let scale = scale.ceil().clamp(1.0, 3.0) as u32;
        match self {
            Self::Face => Most {
                fits: (128 * scale, 128 * scale),
                pixels: u64::MAX,
                shape: Some((1, 1)),
                blur: 0,
                focus: MIDDLE,
            },
            // The head of a card is 310 wide and 110 tall.
            Self::Banner => Most {
                fits: (340 * scale, 121 * scale),
                pixels: u64::MAX,
                shape: Some((31, 11)),
                blur: 0,
                focus: MIDDLE,
            },
            // As wide as a block of tiles, as tall as a picture alone.
            Self::Tile => Most {
                fits: (460 * scale, 320 * scale),
                pixels: u64::MAX,
                shape: None,
                blur: 0,
                focus: MIDDLE,
            },
            // A welcome's banner or a wide logo, across a dialog or a card.
            Self::Page => Most {
                fits: (960 * scale, 960 * scale),
                pixels: 4 << 20,
                shape: None,
                blur: 0,
                focus: MIDDLE,
            },
            // A blurred picture has nothing fine left in it: it is kept
            // smaller the further it is blurred, and blurred less for it.
            Self::Wall(blur) => {
                let coarser = 1 + u32::from(blur) / 6;
                #[expect(clippy::cast_possible_truncation, reason = "no more than it was")]
                let blur = (u32::from(blur) / coarser) as u8;
                Most {
                    fits: (1280 / coarser, 1280 / coarser),
                    pixels: u64::MAX,
                    shape: None,
                    blur,
                    focus: MIDDLE,
                }
            }
            Self::Livery(x, y) => Most {
                fits: (1400 * scale, 280 * scale),
                pixels: u64::MAX,
                shape: Some((5, 1)),
                blur: 0,
                focus: (x, y),
            },
            // As much as a large screen shows, looked at twice as close.
            Self::Large => Most {
                fits: (4096, 4096),
                pixels: 8 << 20,
                shape: None,
                blur: 0,
                focus: MIDDLE,
            },
        }
    }
}

/// How much of what is kept may be pictures nobody is looking at, in bytes
/// of pixels. The graphics card holds as much again.
const KEPT_MOST: usize = 24 << 20;
/// How long a picture is still being looked at after it was last drawn:
/// those are never let go of, whatever they take.
const LOOKED_AT: Duration = Duration::from_secs(2);
/// How long one that is not is kept at all.
const KEPT_FOR: Duration = Duration::from_secs(45);
/// How many files are read at once, and how much they may take between
/// them while they are: a large one is read alone.
const READERS: usize = 3;
const READING_MOST: u64 = 64 << 20;

/// A file's bytes, held by the picture they came in.
#[derive(Clone)]
struct File(Arc<gpui::Image>);

impl AsRef<[u8]> for File {
    fn as_ref(&self) -> &[u8] {
        self.0.bytes()
    }
}

/// An animation on show: the frame it is at, and where the next comes from.
struct Playing {
    frame: Arc<RenderImage>,
    /// When the frame after it is due.
    until: Instant,
    /// The frames after it, read as they are taken: closing this is what
    /// stops the reading.
    ahead: async_channel::Receiver<scaled::Shown>,
    /// Whether something is already set to draw the window again when the
    /// next frame is due.
    woken: bool,
}

enum Held {
    /// Asked for, and waiting for a reader.
    Wanted(Arc<gpui::Image>),
    /// Being read.
    Reading,
    Still(Arc<RenderImage>),
    Playing(Playing),
    Refused(Arc<Refused>),
}

struct Entry {
    held: Held,
    /// When it was last drawn, or asked for.
    seen: Instant,
    /// What reading its file takes while it is read, in bytes.
    weight: u64,
}

impl Entry {
    /// What it takes to keep, in bytes of pixels.
    fn bytes(&self) -> usize {
        let of = |image: &RenderImage| image.as_bytes(0).map_or(0, <[u8]>::len);
        match &self.held {
            Held::Still(image) => of(image),
            // The frame on show, the one read ahead, and the one being read.
            Held::Playing(playing) => of(&playing.frame) * 3,
            Held::Wanted(_) | Held::Reading | Held::Refused(_) => 0,
        }
    }

    /// What of it the graphics card holds.
    fn drawn(&self) -> Option<Arc<RenderImage>> {
        match &self.held {
            Held::Still(image) => Some(Arc::clone(image)),
            Held::Playing(playing) => Some(Arc::clone(&playing.frame)),
            Held::Wanted(_) | Held::Reading | Held::Refused(_) => None,
        }
    }
}

type Key = (u64, Fit);

/// Every picture kept, by its file and the room it was read for.
#[derive(Default)]
struct Kept {
    entries: HashMap<Key, Entry>,
    /// How many files are being read, and what they take.
    readers: usize,
    reading: u64,
}

impl Global for Kept {}

impl Kept {
    /// The entries to let go of at `now`: what was not looked at for long,
    /// and of what is not being looked at, the longest unseen until the
    /// rest fits. One opened large goes as soon as it is not looked at.
    fn let_go(&mut self, now: Instant) -> Vec<Arc<RenderImage>> {
        let idle = |entry: &Entry| now.duration_since(entry.seen);
        let mut unseen: Vec<(Key, Duration, usize)> = self
            .entries
            .iter()
            .filter(|(_, entry)| idle(entry) > LOOKED_AT && !matches!(entry.held, Held::Reading))
            .map(|(key, entry)| (*key, idle(entry), entry.bytes()))
            .collect();
        // Longest unseen first.
        unseen.sort_by_key(|unseen| std::cmp::Reverse(unseen.1));
        let mut kept: usize = self.entries.values().map(Entry::bytes).sum();
        let mut gone = Vec::new();
        for (key, idle, bytes) in unseen {
            let large = key.1 == Fit::Large;
            if !(large || idle > KEPT_FOR || kept > KEPT_MOST) {
                continue;
            }
            if let Some(entry) = self.entries.remove(&key) {
                kept -= bytes;
                gone.extend(entry.drawn());
            }
        }
        gone
    }

    /// Let go of every picture held large but the one at `key`: one is
    /// looked at at a time, and the one before it is not waited out.
    fn only_large(&mut self, key: Key) -> Vec<Arc<RenderImage>> {
        let others: Vec<Key> = self
            .entries
            .iter()
            .filter(|(held, entry)| {
                held.1 == Fit::Large && **held != key && !matches!(entry.held, Held::Reading)
            })
            .map(|(held, _)| *held)
            .collect();
        others
            .into_iter()
            .filter_map(|other| self.entries.remove(&other)?.drawn())
            .collect()
    }

    /// The next file to read, if a reader is free for it: of those still
    /// wanted, the one asked for last, which is the one being looked at.
    fn next(&mut self, now: Instant) -> Option<(Key, Arc<gpui::Image>)> {
        if self.readers >= READERS {
            return None;
        }
        let (key, weight) = self
            .entries
            .iter()
            .filter(|(_, entry)| matches!(entry.held, Held::Wanted(_)))
            .filter(|(_, entry)| now.duration_since(entry.seen) <= LOOKED_AT)
            .max_by_key(|(_, entry)| entry.seen)
            .map(|(key, entry)| (*key, entry.weight))?;
        // One large file is read alone; one too large for that, still.
        if self.readers > 0 && self.reading + weight > READING_MOST {
            return None;
        }
        let entry = self.entries.get_mut(&key)?;
        let Held::Wanted(picture) = std::mem::replace(&mut entry.held, Held::Reading) else {
            return None;
        };
        self.readers += 1;
        self.reading += weight;
        Some((key, picture))
    }
}

/// What an `img` draws for `picture` in a room of `fit`: its scaled copy
/// once that is read, and nothing until then.
pub(crate) fn shown(picture: &Arc<gpui::Image>, fit: Fit) -> ImageSource {
    let picture = Arc::clone(picture);
    ImageSource::Custom(Arc::new(move |window, cx| draw(&picture, fit, window, cx)))
}

/// Whether `picture` has been read for a room of `fit`: whether drawing
/// it there shows something yet.
pub(crate) fn is_read(picture: &gpui::Image, fit: Fit, cx: &mut App) -> bool {
    cx.default_global::<Kept>()
        .entries
        .get(&(picture.id(), fit))
        .is_some_and(|entry| matches!(entry.held, Held::Still(_) | Held::Playing(_)))
}

/// Let go of the picture opened large: it is not looked at any more.
pub(crate) fn close_large(window: &mut Window, cx: &mut App) {
    // No file has this for its own: every one held large goes.
    let nothing = (0, Fit::Face);
    for image in cx.default_global::<Kept>().only_large(nothing) {
        let _ = window.drop_image(image);
    }
    crate::trim::soon(cx);
}

/// Let go at once of what was read of the pictures `ids`, in every room:
/// they are not to be drawn again soon. One being read is left to land.
pub(crate) fn forget(ids: &[u64], cx: &mut App) {
    let mut gone = Vec::new();
    cx.default_global::<Kept>().entries.retain(|key, entry| {
        let goes = ids.contains(&key.0) && !matches!(entry.held, Held::Reading);
        if goes {
            gone.extend(entry.drawn());
        }
        !goes
    });
    for image in gone {
        cx.drop_image(image, None);
    }
    crate::trim::soon(cx);
}

/// How much is kept, in bytes of pixels.
pub(crate) fn kept_bytes(cx: &mut App) -> usize {
    cx.default_global::<Kept>()
        .entries
        .values()
        .map(Entry::bytes)
        .sum()
}

fn draw(
    picture: &Arc<gpui::Image>,
    fit: Fit,
    window: &mut Window,
    cx: &mut App,
) -> Option<Result<Arc<RenderImage>, ImageCacheError>> {
    let now = Instant::now();
    let key = (picture.id(), fit);
    let kept = cx.default_global::<Kept>();
    let entry = kept.entries.entry(key).or_insert_with(|| Entry {
        held: Held::Wanted(Arc::clone(picture)),
        seen: now,
        weight: crate::picture::dimensions(picture.bytes()).map_or(0, |(width, height)| {
            u64::from(width) * u64::from(height) * 4
        }),
    });
    entry.seen = now;
    let mut replaced = None;
    let mut wake = None;
    let answer = match &mut entry.held {
        Held::Wanted(_) | Held::Reading => None,
        Held::Still(image) => Some(Ok(Arc::clone(image))),
        Held::Refused(why) => Some(Err(ImageCacheError::Asset(why.to_string().into()))),
        Held::Playing(playing) => {
            if now >= playing.until
                && let Ok((pixels, stays)) = playing.ahead.try_recv()
            {
                replaced = Some(std::mem::replace(&mut playing.frame, frame(pixels)));
                playing.until = now + stays;
            }
            if !std::mem::replace(&mut playing.woken, true) {
                wake = Some(playing.until.saturating_duration_since(now));
            }
            Some(Ok(Arc::clone(&playing.frame)))
        }
    };
    let mut gone = kept.let_go(now);
    if fit == Fit::Large {
        gone.extend(kept.only_large(key));
    }
    for image in replaced.into_iter().chain(gone) {
        let _ = window.drop_image(image);
    }
    if let Some(after) = wake {
        wake_after(key, after, cx);
    }
    read_more(window.scale_factor(), cx);
    answer
}

/// One frame, as GPUI holds a picture.
fn frame(pixels: image::RgbaImage) -> Arc<RenderImage> {
    Arc::new(RenderImage::new(vec![image::Frame::new(pixels)]))
}

/// Draw the windows again once the animation at `key` is due its next
/// frame. That drawing is what takes the frame, and asks for this again:
/// an animation nobody draws asks for nothing, and reads nothing.
fn wake_after(key: Key, after: Duration, cx: &mut App) {
    let timer = cx.background_executor().timer(after);
    cx.spawn(async move |cx| {
        timer.await;
        let _ = cx.update(|cx| {
            if let Some(Entry {
                held: Held::Playing(playing),
                ..
            }) = cx.default_global::<Kept>().entries.get_mut(&key)
            {
                playing.woken = false;
                cx.refresh_windows();
            }
        });
    })
    .detach();
}

/// What came of reading a file.
enum Landed {
    Still(image::RgbaImage),
    /// An animation: its first frame, how long that stays, and where the
    /// rest come from.
    Moving(scaled::Shown, async_channel::Receiver<scaled::Shown>),
}

/// Start reading the files that are wanted, as far as readers are free.
fn read_more(scale: f32, cx: &mut App) {
    let now = Instant::now();
    while let Some((key, picture)) = cx.default_global::<Kept>().next(now) {
        let most = key.1.most(scale);
        let (tell, told) = async_channel::bounded(1);
        if scaled::may_move(picture.bytes()) {
            // On a thread of its own, which it keeps for as long as it
            // plays: the decoder of an animation cannot change threads.
            let spawned = std::thread::Builder::new()
                .name("animation".to_owned())
                .spawn(move || watch(File(picture), most, &tell));
            if let Err(error) = spawned {
                tracing::warn!(%error, "no thread to read an animation on");
            }
        } else {
            cx.background_executor()
                .spawn(async move {
                    let read = scaled::still(picture.bytes(), most).map(Landed::Still);
                    let _ = tell.send(read).await;
                })
                .detach();
        }
        cx.spawn(async move |cx| {
            let read = told
                .recv()
                .await
                .unwrap_or_else(|_| Err(Refused::Unreadable("nothing read it".to_owned())));
            let _ = cx.update(|cx| landed(key, read, scale, cx));
        })
        .detach();
    }
}

/// Read `file`, which may be an animation, and tell what it is; then, if
/// it is one, go on reading it for as long as its frames are taken. One
/// frame waits to be taken while this waits with the next: an animation
/// nobody draws is not read.
fn watch(file: File, most: Most, tell: &async_channel::Sender<Result<Landed, Refused>>) {
    let mut moving = match scaled::read(file, most) {
        Ok(Read::Moving(moving)) => moving,
        Ok(Read::Still(pixels)) => {
            let _ = tell.send_blocking(Ok(Landed::Still(pixels)));
            return;
        }
        Err(why) => {
            let _ = tell.send_blocking(Err(why));
            return;
        }
    };
    let first = match moving.next_frame() {
        Ok(first) => first,
        Err(why) => {
            let _ = tell.send_blocking(Err(why));
            return;
        }
    };
    let (read, ahead) = async_channel::bounded(1);
    if tell
        .send_blocking(Ok(Landed::Moving(first, ahead)))
        .is_err()
    {
        return;
    }
    while let Ok(shown) = moving.next_frame() {
        // Closed once the animation is let go of.
        if read.send_blocking(shown).is_err() {
            break;
        }
    }
}

/// A file was read: keep what came of it, and draw.
fn landed(key: Key, read: Result<Landed, Refused>, scale: f32, cx: &mut App) {
    let now = Instant::now();
    let held = match read {
        Ok(Landed::Still(pixels)) => Held::Still(frame(pixels)),
        Ok(Landed::Moving((first, stays), ahead)) => Held::Playing(Playing {
            frame: frame(first),
            until: now + stays,
            ahead,
            woken: false,
        }),
        Err(why) => {
            tracing::debug!(%why, "a picture is not shown");
            Held::Refused(Arc::new(why))
        }
    };
    let kept = cx.default_global::<Kept>();
    kept.readers = kept.readers.saturating_sub(1);
    if let Some(entry) = kept.entries.get_mut(&key) {
        kept.reading = kept.reading.saturating_sub(entry.weight);
        entry.held = held;
    }
    for image in kept.let_go(now) {
        cx.drop_image(image, None);
    }
    cx.refresh_windows();
    read_more(scale, cx);
    // Reading it touched far more than is kept of it.
    crate::trim::soon(cx);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(held: Held, seen: Instant) -> Entry {
        Entry {
            held,
            seen,
            weight: 0,
        }
    }

    fn still(side: u32) -> Held {
        Held::Still(frame(image::RgbaImage::new(side, side)))
    }

    #[test]
    fn a_room_decides_how_much_of_a_picture_is_kept() {
        assert_eq!(Fit::Tile.most(1.0).fits, (460, 320));
        assert_eq!(
            Fit::Tile.most(1.5).fits,
            (920, 640),
            "a sharper screen, more"
        );
        assert_eq!(Fit::Face.most(9.0).fits, (384, 384), "but not without end");
        assert_eq!(Fit::Large.most(1.0), Fit::Large.most(2.0));
    }

    #[test]
    fn what_is_looked_at_is_kept_and_the_longest_unseen_goes_first() {
        let now = Instant::now();
        let ago = |secs: u64| now - Duration::from_secs(secs);
        let mut kept = Kept::default();
        // Four megabytes each: seven fit, eight do not.
        for (id, seen) in [(1, 0), (2, 10), (3, 20), (4, 30)] {
            let _ = kept
                .entries
                .insert((id, Fit::Tile), entry(still(1024), ago(seen)));
        }
        assert!(kept.let_go(now).is_empty(), "all of it fits");
        for (id, seen) in [(5, 5), (6, 6), (7, 7), (8, 8)] {
            let _ = kept
                .entries
                .insert((id, Fit::Tile), entry(still(1024), ago(seen)));
        }
        assert_eq!(kept.let_go(now).len(), 2, "down to what fits");
        let left: std::collections::BTreeSet<u64> = kept.entries.keys().map(|key| key.0).collect();
        assert_eq!(
            left.into_iter().collect::<Vec<_>>(),
            [1, 2, 5, 6, 7, 8],
            "the two unseen longest went"
        );
        // Looked at just now: kept, however much that is.
        let mut busy = Kept::default();
        for id in 0..20 {
            let _ = busy
                .entries
                .insert((id, Fit::Tile), entry(still(1024), now));
        }
        assert!(busy.let_go(now).is_empty());
    }

    #[test]
    fn one_opened_large_and_one_long_unseen_are_let_go_of() {
        let now = Instant::now();
        let ago = |secs: u64| now - Duration::from_secs(secs);
        let mut kept = Kept::default();
        let _ = kept
            .entries
            .insert((1, Fit::Large), entry(still(64), ago(3)));
        let _ = kept
            .entries
            .insert((2, Fit::Large), entry(still(64), ago(1)));
        let _ = kept
            .entries
            .insert((3, Fit::Tile), entry(still(64), ago(60)));
        let _ = kept
            .entries
            .insert((4, Fit::Tile), entry(still(64), ago(30)));
        assert_eq!(kept.let_go(now).len(), 2);
        let mut left: Vec<Key> = kept.entries.keys().copied().collect();
        left.sort_by_key(|key| key.0);
        assert_eq!(left, [(2, Fit::Large), (4, Fit::Tile)]);
    }

    #[test]
    fn files_are_read_newest_wanted_first_and_a_large_one_alone() {
        let now = Instant::now();
        let picture = || Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Png, vec![1]));
        let wanted = |weight: u64, ago_ms: u64| Entry {
            held: Held::Wanted(picture()),
            seen: now - Duration::from_millis(ago_ms),
            weight,
        };
        let mut kept = Kept::default();
        let _ = kept.entries.insert((1, Fit::Tile), wanted(1 << 20, 300));
        let _ = kept.entries.insert((2, Fit::Tile), wanted(1 << 20, 100));
        let _ = kept.entries.insert((3, Fit::Tile), wanted(200 << 20, 200));
        // Scrolled past before a reader was free: not read at all.
        let _ = kept.entries.insert((4, Fit::Tile), wanted(1 << 20, 5000));
        assert_eq!(kept.next(now).map(|(key, _)| key.0), Some(2));
        // The large one is next, and waits for the reader to be done.
        assert!(kept.next(now).is_none());
        kept.readers = 0;
        kept.reading = 0;
        assert_eq!(kept.next(now).map(|(key, _)| key.0), Some(3), "alone");
        assert!(kept.next(now).is_none(), "nothing beside it");
        kept.readers = 0;
        kept.reading = 0;
        assert_eq!(kept.next(now).map(|(key, _)| key.0), Some(1));
        assert!(kept.next(now).is_none(), "the stale one stays unread");
    }
}
