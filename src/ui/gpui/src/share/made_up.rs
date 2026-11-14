//! Sharing with nothing behind it: the test pattern is offered to share,
//! every watched share shows it, and what would be sent is kept to be
//! looked at. The demo engine's, and so the tests'.
//!
//! In the demo the pattern moves at thirty frames a second. In the tests it
//! stands still: a share shows one frame when it comes into sight and
//! another only when a test asks ([`MadeUp::advance`]), so a test's window
//! settles.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::{Duration, Instant};

use gpui::SharedString;

use super::frame::{Frame, Pace};
use super::pattern::{Order, Pattern};
use super::{
    Broadcast, Feed, FeedStats, Heard, Media, SignalKind, Source, SourceKind, Standing, Start,
    Stroke, Uplink, Watch,
};
use crate::engine::EngineEvent;

/// Made-up sharing.
pub(crate) struct MadeUp {
    events: async_channel::Sender<EngineEvent>,
    /// Whether the pattern moves.
    moving: bool,
    /// Whether shares go through the real encoder and decoder
    /// ([`super::replay`]).
    codec: bool,
    relays: AtomicBool,
    said: Mutex<Vec<(SignalKind, String)>>,
    drawn: Mutex<Vec<Stroke>>,
    started: Mutex<Vec<Start>>,
    /// Frames owed to the shares watched, one count each, while it stands.
    owed: Mutex<Vec<Arc<AtomicU32>>>,
    /// Where the shares' sound would be heard: nowhere, kept to be read.
    unheard: Arc<super::audio::Unheard>,
    /// The ear of each share watched, to have it heard in a test.
    ears: Mutex<Vec<(crate::engine::Session, bool, Arc<super::audio::Ear>)>>,
    /// Where the pattern lies on the screens: where the run says, or where a
    /// test puts it.
    stand_in: Arc<super::whereabouts::StandIn>,
}

impl std::fmt::Debug for MadeUp {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("MadeUp").finish_non_exhaustive()
    }
}

impl MadeUp {
    /// Made-up sharing that tells `events`; `moving` for a pattern that
    /// moves on its own.
    pub(crate) fn new(events: async_channel::Sender<EngineEvent>, moving: bool) -> Self {
        Self {
            events,
            moving,
            codec: moving && super::replay::wanted(),
            relays: AtomicBool::new(true),
            said: Mutex::default(),
            drawn: Mutex::default(),
            started: Mutex::default(),
            owed: Mutex::default(),
            unheard: Arc::default(),
            ears: Mutex::default(),
            stand_in: Arc::new(super::whereabouts::StandIn::from_env()),
        }
    }

    /// Have what is shared lie lies on the screens from now.
    #[cfg(test)]
    pub(crate) fn lie(&self, lies: super::whereabouts::Lies) {
        self.stand_in.set(lies);
    }

    /// What `session`'s share's sound would have played.
    #[cfg(test)]
    pub(crate) fn played(&self, session: crate::engine::Session) -> Vec<f32> {
        self.unheard.played(session)
    }

    /// Have `session`'s share play `stereo` (20 ms, 48 kHz), as its
    /// computer would.
    #[cfg(test)]
    pub(crate) fn sound(&self, session: crate::engine::Session, stereo: &[f32]) {
        let ears = self.ears.lock().unwrap_or_else(PoisonError::into_inner);
        for (of, own, ear) in ears.iter().filter(|(of, _, _)| *of == session) {
            ear.hear(*of, *own, stereo);
        }
    }

    fn tell(&self, heard: Heard) {
        let _ = self.events.try_send(EngineEvent::Share(heard));
    }

    /// Every START and STOP said, in order.
    #[cfg(test)]
    pub(crate) fn said(&self) -> Vec<(SignalKind, String)> {
        self.said.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Every stroke packet sent, in order.
    #[cfg(test)]
    pub(crate) fn drawn(&self) -> Vec<Stroke> {
        self.drawn.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Every share started, in order.
    #[cfg(test)]
    pub(crate) fn started(&self) -> Vec<Start> {
        self.started.lock().unwrap_or_else(PoisonError::into_inner).clone()
    }

    /// Have the server relay shares, or not.
    #[cfg(test)]
    pub(crate) fn set_relays(&self, relays: bool) {
        self.relays.store(relays, Ordering::Relaxed);
    }

    /// One more frame of every share watched, where the pattern stands.
    #[cfg(test)]
    pub(crate) fn advance(&self) {
        for owed in self.owed.lock().unwrap_or_else(PoisonError::into_inner).iter() {
            let _ = owed.fetch_add(1, Ordering::Relaxed);
        }
    }
}

/// The sources offered: two screens, a window and a camera, all the
/// pattern.
fn sources() -> Vec<Source> {
    let source = |kind, id, title: &str, width, height| Source {
        kind,
        id,
        title: SharedString::from(title.to_owned()),
        width,
        height,
    };
    vec![
        source(SourceKind::Screen, 1, "Test pattern, screen 1", 1920, 1080),
        source(SourceKind::Screen, 2, "Test pattern, screen 2", 1280, 720),
        source(SourceKind::Window, 3, "Test pattern, a window", 1024, 640),
        source(SourceKind::Device, 4, "Test pattern, a camera", 640, 480),
    ]
}

/// The pattern's sources: what is offered wherever no real screen may be.
pub(crate) fn pattern_sources() -> Vec<Source> {
    sources()
}

/// A small picture of the pattern as `source` shows it, PNG.
pub(crate) fn pattern_thumbnail(source: &Source) -> Option<Arc<gpui::Image>> {
    let height = 180 * source.height / source.width.max(1);
    let pattern = Pattern::new(320, height);
    let pixels = pattern.frame(source.id * 1000, Order::Rgba);
    let picture = image::RgbaImage::from_raw(pattern.width(), pattern.height(), pixels)?;
    let mut png = Vec::new();
    picture
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    Some(Arc::new(gpui::Image::from_bytes(gpui::ImageFormat::Png, png)))
}

impl Media for MadeUp {
    fn sources(&self) -> Result<Vec<Source>, String> {
        Ok(sources())
    }

    fn thumbnail(&self, source: &Source) -> Option<Arc<gpui::Image>> {
        pattern_thumbnail(source)
    }

    fn broadcast(&self, start: Start) -> Result<Box<dyn Broadcast>, String> {
        if start.sources.is_empty() {
            return Err("nothing to share".to_owned());
        }
        let stop = Arc::new(AtomicBool::new(false));
        if self.codec {
            let quality = start.settings.quality;
            let source = &start.sources[0];
            let size = sent_size((source.width, source.height), quality.longest);
            let stopped = Arc::clone(&stop);
            let _thread = std::thread::Builder::new()
                .name("made-up-encode".to_owned())
                .spawn(move || super::replay::encode_away(size, quality.fps, &stopped))
                .map_err(|error| error.to_string())?;
        }
        self.started
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(start);
        self.tell(Heard::Broadcast(Standing::Connected));
        Ok(Box::new(Sent {
            events: self.events.clone(),
            stop,
        }))
    }

    fn watch(&self, watch: Watch) -> Result<Box<dyn Feed>, String> {
        self.ears
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((watch.session, watch.own, Arc::clone(&watch.ear)));
        if self.codec {
            return self.watch_decoded(&watch);
        }
        let stop = Arc::new(AtomicBool::new(false));
        let mut slots = Vec::new();
        for (at, track) in watch.tracks.iter().enumerate() {
            let owed = Arc::new(AtomicU32::new(1));
            if !self.moving {
                self.owed
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner)
                    .push(Arc::clone(&owed));
            }
            let shown = Shown {
                track: track.clone(),
                session: watch.session,
                camera: at > 0,
                wake: watch.wake.clone(),
                moving: self.moving,
                owed,
                stop: Arc::clone(&stop),
                made: 0,
                pace: Pace::default(),
                woke_unseen: None,
            };
            let _thread = std::thread::Builder::new()
                .name("made-up-share".to_owned())
                .spawn(move || shown.run())
                .map_err(|error| error.to_string())?;
            slots.push(track.slot.clone());
        }
        if self.moving {
            sound_on(&watch, &stop, false)?;
        }
        self.tell(Heard::Watch {
            session: watch.session,
            standing: Standing::Connected,
        });
        Ok(Box::new(Watched { stop, slots }))
    }

    fn announce(&self, _server: Option<SharedString>, kind: SignalKind, payload: String) {
        self.said
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push((kind, payload));
    }

    fn stroke(&self, stroke: Stroke) {
        self.drawn
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(stroke);
    }

    fn relays(&self) -> bool {
        self.relays.load(Ordering::Relaxed)
    }

    fn made_up(&self) -> bool {
        true
    }

    fn hearing(&self) -> Arc<dyn super::audio::Hearing> {
        self.unheard.clone()
    }

    fn whereabouts(&self) -> Arc<dyn super::whereabouts::Whereabouts> {
        self.stand_in.clone()
    }
}

/// Have a watched made-up share play a tone until `stop`: through the
/// Opus codec where `codec`, as a real share's sound comes.
fn sound_on(watch: &Watch, stop: &Arc<AtomicBool>, codec: bool) -> Result<(), String> {
    let (ear, session, own, stopped) = (Arc::clone(&watch.ear), watch.session, watch.own, Arc::clone(stop));
    let _thread = std::thread::Builder::new()
        .name("made-up-sound".to_owned())
        .spawn(move || super::replay::sound(&ear, session, own, &stopped, codec))
        .map_err(|error| error.to_string())?;
    Ok(())
}

impl MadeUp {
    /// Watch the pattern as the real decoder would see it come.
    fn watch_decoded(&self, watch: &Watch) -> Result<Box<dyn Feed>, String> {
        let stop = Arc::new(AtomicBool::new(false));
        let counts = Arc::new(super::decode::Counts::default());
        for track in &watch.tracks {
            let decoding = super::decode::Decoding::new(
                track.slot.clone(),
                Arc::clone(&track.wanted),
                watch.wake.clone(),
                Box::new(|| {}),
                Arc::clone(&counts),
            )?;
            let stopped = Arc::clone(&stop);
            let _thread = std::thread::Builder::new()
                .name("made-up-decode".to_owned())
                .spawn(move || super::replay::play(decoding, &stopped))
                .map_err(|error| error.to_string())?;
        }
        sound_on(watch, &stop, true)?;
        self.tell(Heard::Watch {
            session: watch.session,
            standing: Standing::Connected,
        });
        Ok(Box::new(Decoded { stop, counts }))
    }
}

/// The size a source is sent at, its longest side no more than `longest`
/// (0 for as it is), even each way.
fn sent_size(size: (u32, u32), longest: u32) -> (u32, u32) {
    let most = size.0.max(size.1);
    if longest == 0 || most <= longest {
        return (size.0 & !1, size.1 & !1);
    }
    let scale = |side: u32| ((u64::from(side) * u64::from(longest) / u64::from(most)) as u32) & !1;
    (scale(size.0), scale(size.1))
}

/// A made-up share watched through the decoder.
struct Decoded {
    stop: Arc<AtomicBool>,
    counts: Arc<super::decode::Counts>,
}

impl Feed for Decoded {
    fn stats(&self) -> FeedStats {
        let decoded = self.counts.decoded.load(Ordering::Relaxed);
        let busy = self.counts.busy_us.load(Ordering::Relaxed);
        FeedStats {
            connection: "made up, decoded".to_owned(),
            sent: self.counts.sent(),
            decoded,
            skipped: self.counts.skipped.load(Ordering::Relaxed),
            busy_ms: (decoded > 0).then(|| busy as f64 / decoded as f64 / 1000.0),
            ..FeedStats::default()
        }
    }

    fn stop(self: Box<Self>) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for Decoded {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// A made-up share of one's own.
struct Sent {
    events: async_channel::Sender<EngineEvent>,
    /// Stops its encoding, where it is encoded.
    stop: Arc<AtomicBool>,
}

impl Broadcast for Sent {
    fn uplink(&self) -> Option<Uplink> {
        Some(Uplink {
            target_kbps: 4000,
            ceiling_kbps: 6000,
            loss: 0.0,
            rtt_ms: Some(12),
        })
    }

    fn stop(self: Box<Self>) {
        self.stop.store(true, Ordering::Relaxed);
        let _ = self
            .events
            .try_send(EngineEvent::Share(Heard::Broadcast(Standing::Stopped)));
    }
}

/// A made-up share being watched.
struct Watched {
    stop: Arc<AtomicBool>,
    slots: Vec<super::FrameSlot>,
}

impl Feed for Watched {
    fn stats(&self) -> FeedStats {
        let made = self.slots.iter().map(|slot| slot.counts().0).sum();
        FeedStats {
            connection: "made up".to_owned(),
            rtt_ms: Some(12.0),
            ice: Some("host / host".to_owned()),
            sent: Some((1920, 1080)),
            decoded: made,
            busy_ms: Some(0.0),
            ..FeedStats::default()
        }
    }

    fn stop(self: Box<Self>) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Relaxed);
    }
}

/// The thread that makes the frames of one track of a watched made-up
/// share.
struct Shown {
    track: super::WatchTrack,
    session: crate::engine::Session,
    /// The camera beside the screen: smaller, and numbered apart.
    camera: bool,
    wake: super::Wake,
    moving: bool,
    owed: Arc<AtomicU32>,
    stop: Arc<AtomicBool>,
    made: u32,
    pace: Pace,
    woke_unseen: Option<Instant>,
}

impl Shown {
    /// The size the pattern is sent at, and its camera.
    const SENT: (u32, u32) = (1920, 1080);
    const CAMERA: (u32, u32) = (640, 480);

    fn run(mut self) {
        while !self.stop.load(Ordering::Relaxed) {
            self.step(Instant::now());
            std::thread::sleep(Duration::from_millis(if self.moving { 4 } else { 15 }));
        }
    }

    fn step(&mut self, now: Instant) {
        let wanted = &self.track.wanted;
        if !wanted.in_sight() {
            // As a real share does: now and then wake the window, whose
            // drawing is what brings it back into sight.
            if self.woke_unseen.is_none_or(|woke| now.duration_since(woke) >= Duration::from_secs(1)) {
                self.woke_unseen = Some(now);
                self.wake.now();
            }
            return;
        }
        let due = if self.moving {
            self.pace.due(wanted.rate(), now)
        } else {
            self.owed
                .try_update(Ordering::Relaxed, Ordering::Relaxed, |owed| owed.checked_sub(1))
                .is_ok()
        };
        if !due {
            return;
        }
        let sent = if self.camera { Self::CAMERA } else { Self::SENT };
        let (width, height) = wanted.size_for(sent);
        let pattern = Pattern::new(width, height);
        let number = self.session * 1000 + u32::from(self.camera) * 500 + self.made;
        self.made += 1;
        let frame = Frame {
            width: pattern.width(),
            height: pattern.height(),
            bgra: pattern.frame(number, Order::Bgra),
            sent,
        };
        if self.track.slot.put(frame) {
            self.wake.now();
        }
    }
}
