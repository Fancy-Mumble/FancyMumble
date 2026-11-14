//! The stage: the shares in the channel the user is in, one large and the
//! others in a strip beside it, as the web client's `ScreenShareStage`
//! draws them; one's own share started from the picker; drawing on what is
//! shared. What sharing is and how a frame gets here is `crate::share`.

mod badge;
mod drawing;
mod inspect;
mod large;
mod menu;
mod overlay;
mod pan;
mod picker;
mod popout;
mod screen;
mod stats;
mod strip;
mod view;

use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::rc::Rc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use gpui::{AppContext as _, Context, SharedString, Task, Window};

pub(super) use badge::LiveBadge;
#[cfg(test)]
pub(super) use screen::textures_for_tests;
pub(super) use view::{overlays, render};
#[cfg(test)]
pub(super) use overlay::FOLLOW_EVERY;

use super::Shell;
use crate::engine::{ChannelId, Connection, Session};
use crate::share::shares::{Change, Own, Shares, Whose};
use crate::share::tracks::Content;
use crate::share::audio::{Ear, Loudness};
use crate::share::{
    Broadcast, Feed, FrameSlot, Heard, Media, Settings, SignalKind, Source, SourceKind, Standing,
    Start, Tracks, Uplink, Wake, Wanted, Watch, WatchTrack,
};
use crate::words::t;

/// How often the stage asks how its shares go, and announces one's own
/// again if that is due.
const TICK: Duration = Duration::from_secs(1);
/// How long a failed viewer waits before it watches again.
const AGAIN_AFTER: Duration = Duration::from_secs(2);
/// How often the window is drawn again for new frames, at most.
const FRAMES_EVERY: Duration = Duration::from_millis(28);

/// One track of a watched share, and what is on screen of it.
#[derive(Clone)]
pub(super) struct Track {
    pub(super) mid: String,
    pub(super) slot: FrameSlot,
    pub(super) wanted: Arc<Wanted>,
    pub(super) screen: Rc<RefCell<screen::Screen>>,
}

impl Track {
    fn new(mid: &str) -> Self {
        Self {
            mid: mid.to_owned(),
            slot: FrameSlot::default(),
            wanted: Wanted::new(),
            screen: Rc::default(),
        }
    }
}

/// A share being watched, and what is on screen of it.
pub(super) struct Watched {
    /// The viewer, once it is made: that takes a moment, off the window.
    feed: Option<Box<dyn Feed>>,
    /// The screen (or a camera shared alone), then a camera beside it.
    pub(super) tracks: Vec<Track>,
    standing: Standing,
    /// Which watch of this share it is: a viewer made for an earlier one is
    /// stopped as it arrives.
    round: u64,
}

impl Watched {
    /// The track the stage shows of it: the screen, or its camera.
    pub(super) fn track(&self, camera: bool) -> Option<&Track> {
        self.tracks.get(usize::from(camera))
    }

    /// The screen, or the camera shared alone.
    pub(super) fn main(&self) -> &Track {
        &self.tracks[0]
    }
}

impl std::fmt::Debug for Watched {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Watched")
            .field("standing", &self.standing)
            .field("round", &self.round)
            .finish_non_exhaustive()
    }
}

/// Told of new frames; holds nothing.
pub(crate) struct Frames;

/// Everything of screen sharing the window keeps.
pub(crate) struct Stage {
    media: Arc<dyn Media>,
    pub(super) shares: Shares,
    pub(super) feeds: HashMap<Session, Watched>,
    broadcast: Option<Box<dyn Broadcast>>,
    pub(super) picker: Option<picker::Picker>,
    /// The stage over the whole window.
    pub(super) expanded: bool,
    /// The channels drawn in: the drawing tools are out there.
    pub(super) drawing: HashSet<ChannelId>,
    pub(super) pen: drawing::PenState,
    /// Where the share shown pixel for pixel is moved to.
    pub(super) pan: pan::Pan,
    /// The share whose camera, not its screen, is shown large.
    pub(super) large_camera: Option<Session>,
    /// The feed in a window of its own.
    pub(super) popped: Option<popout::Popped>,
    /// Told when new frames came: what a window of a feed's own is drawn
    /// again by.
    pub(super) frames: gpui::Entity<Frames>,
    /// Where a watched share's sound is heard, and how loud each is.
    hearing: Arc<dyn crate::share::audio::Hearing>,
    pub(super) loudness: Arc<Loudness>,
    /// The stage's menu, for the share at its place, while it is open.
    pub(super) menu: Option<menu::StageMenu>,
    pub(super) stats_open: bool,
    pub(super) stats: HashMap<Session, stats::Sampled>,
    pub(super) uplink: Option<Uplink>,
    /// What went wrong, under the stage until dismissed.
    pub(super) notice: Option<SharedString>,
    wake: Wake,
    rounds: u64,
    /// Pictures of streams that ended, to be given back to the window.
    retired: Vec<screen::Picture>,
    _tasks: Vec<Task<()>>,
}

impl std::fmt::Debug for Stage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Stage")
            .field("shares", &self.shares)
            .field("feeds", &self.feeds.len())
            .finish_non_exhaustive()
    }
}

impl Stage {
    /// The stage of a window on `media`: nothing shared, nothing watched.
    pub(super) fn new(media: Arc<dyn Media>, window: &mut Window, cx: &mut Context<Shell>) -> Self {
        let (wake, woken) = Wake::new();
        // New frames draw the window again, no more often than this: the
        // whole window is drawn for a frame, so its rate is the cost.
        let frames = cx.spawn_in(window, async move |shell, cx| {
            while woken.recv().await.is_ok() {
                let drawn = shell.update_in(cx, Shell::frames_came);
                if drawn.is_err() {
                    break;
                }
                cx.background_executor().timer(FRAMES_EVERY).await;
            }
        });
        let ticks = cx.spawn(async move |shell, cx| {
            loop {
                cx.background_executor().timer(TICK).await;
                if shell.update(cx, Shell::share_tick).is_err() {
                    break;
                }
            }
        });
        let hearing = media.hearing();
        let frame_ticks = cx.new(|_| Frames);
        Self {
            media,
            shares: Shares::default(),
            feeds: HashMap::new(),
            broadcast: None,
            picker: None,
            expanded: false,
            drawing: HashSet::new(),
            pen: drawing::PenState::default(),
            pan: pan::Pan::default(),
            large_camera: None,
            popped: None,
            frames: frame_ticks,
            hearing,
            loudness: Arc::default(),
            menu: None,
            stats_open: false,
            stats: HashMap::new(),
            uplink: None,
            notice: None,
            wake,
            rounds: 0,
            retired: Vec::new(),
            _tasks: vec![frames, ticks],
        }
    }

    pub(super) fn media(&self) -> &Arc<dyn Media> {
        &self.media
    }

    /// Where a watched share's sound is heard.
    pub(super) fn hearing(&self) -> &Arc<dyn crate::share::audio::Hearing> {
        &self.hearing
    }

    /// Whether this window draws a watched feed: one that is not in a
    /// window of its own.
    fn feeds_drawn_here(&self) -> bool {
        self.feeds.values().map(|watched| watched.tracks.len()).sum::<usize>() > usize::from(self.popped.is_some())
    }

    /// Whether the local user is sharing from here.
    pub(super) fn sharing(&self) -> bool {
        self.shares.own().is_some()
    }
}

/// Run `work` off the window's thread and forget it.
fn off_the_window(cx: &mut Context<Shell>, work: impl FnOnce() + Send + 'static) {
    cx.background_executor().spawn(async move { work() }).detach();
}

impl Shell {
    /// The mark beside `session` while they share their screen.
    pub(super) fn live_badge(&self, session: Session) -> Option<LiveBadge> {
        self.stage
            .shares
            .is_live(session, self.snapshot.own_session)
            .then(|| LiveBadge::new(self.stage.media.relays()))
    }

    /// Something of screen sharing was heard.
    pub(super) fn hear_share(&mut self, heard: Heard, cx: &mut Context<Self>) {
        match heard {
            Heard::Signal(signal) => match self.stage.shares.heard(&signal) {
                Change::Began(session) => {
                    // Heard, as the web UI's `streamStart` (Settings,
                    // Notifications): somebody else's, not one's own.
                    if Some(session) != self.snapshot.own_session {
                        self.hear(crate::sounds::Event::StreamStart);
                    }
                    self.watch_shares(cx);
                }
                Change::Changed(session) => {
                    self.unwatch(session, cx);
                    self.watch_shares(cx);
                }
                Change::Ended(session) => {
                    self.unwatch(session, cx);
                    self.watch_shares(cx);
                }
                Change::Nothing => {}
            },
            Heard::Stroke(stroke) => {
                let sharing = self.stage.shares.is_live(stroke.sender, self.snapshot.own_session);
                self.stage.shares.strokes.take(stroke, sharing, Instant::now());
            }
            Heard::Broadcast(standing) => self.own_share_stands(standing, cx),
            Heard::Watch { session, standing } => self.watched_stands(session, standing, cx),
        }
    }

    /// The server's state changed: follow it with the shares.
    pub(super) fn follow_shares(&mut self, cx: &mut Context<Self>) {
        let server = self.active_session.clone();
        if self.stage.shares.on_server(server) {
            let watched: Vec<Session> = self.stage.feeds.keys().copied().collect();
            for session in watched {
                self.unwatch(session, cx);
            }
        }
        let here: HashSet<Session> = self.snapshot.users.iter().map(|user| user.session).collect();
        for gone in self.stage.shares.gone(|session| here.contains(&session)) {
            self.unwatch(gone, cx);
        }
        if self.stage.sharing() && self.snapshot.connection != Connection::Connected {
            self.stop_share(cx);
        }
        self.announce_if_due();
        self.watch_shares(cx);
    }

    /// Say one's own share again if somebody new is in its channel, its
    /// sharer moved, or it was said long enough ago.
    fn announce_if_due(&mut self) {
        let (Some(channel), Some(own)) = (self.snapshot.current_channel, self.snapshot.own_session) else {
            return;
        };
        let members: Vec<Session> = self
            .snapshot
            .users
            .iter()
            .filter(|user| user.channel == channel && user.session != own)
            .map(|user| user.session)
            .collect();
        if !self.stage.shares.announce_due(channel, members, Instant::now()) {
            return;
        }
        if let Some(own) = self.stage.shares.own() {
            self.stage
                .media
                .announce(own.server.clone(), SignalKind::Start, own.tracks.payload());
        }
    }

    /// What the stage shows: the shares in the channel the user is in.
    pub(super) fn shown_shares(&self) -> Vec<crate::share::shares::Shown> {
        let Some(channel) = self.snapshot.current_channel else {
            return Vec::new();
        };
        let in_channel = |session: Session| {
            self.snapshot
                .users
                .iter()
                .any(|user| user.session == session && user.channel == channel)
        };
        self.stage.shares.shown(self.snapshot.own_session, in_channel)
    }

    /// Watch every share the stage shows, and nothing else.
    fn watch_shares(&mut self, cx: &mut Context<Self>) {
        let shown = self.shown_shares();
        let wanted: HashSet<Session> = shown.iter().map(|each| each.session).collect();
        let watched: Vec<Session> = self.stage.feeds.keys().copied().collect();
        for session in watched.into_iter().filter(|session| !wanted.contains(session)) {
            self.unwatch(session, cx);
        }
        for each in shown {
            if !self.stage.feeds.contains_key(&each.session) {
                self.watch(each.session, each.whose != Whose::Theirs, &each.tracks, cx);
            }
        }
    }

    /// Start watching `session`'s share.
    fn watch(&mut self, session: Session, own: bool, tracks: &Tracks, cx: &mut Context<Self>) {
        let stage = &mut self.stage;
        stage.rounds += 1;
        let round = stage.rounds;
        let main = tracks.main().unwrap_or("0");
        let mut shown = vec![Track::new(main)];
        // A camera beside a screen is a feed of its own on the stage.
        if tracks.content(main) == Some(Content::Screen)
            && let Some(camera) = tracks.tracks.iter().find(|track| track.content == Content::Camera)
        {
            shown.push(Track::new(&camera.mid));
        }
        let watch = Watch {
            server: self.active_session.clone(),
            session,
            own,
            tracks: shown
                .iter()
                .map(|track| WatchTrack {
                    mid: track.mid.clone(),
                    wanted: Arc::clone(&track.wanted),
                    slot: track.slot.clone(),
                })
                .collect(),
            wake: stage.wake.clone(),
            ear: Arc::new(Ear {
                hearing: Arc::clone(&stage.hearing),
                loudness: Arc::clone(&stage.loudness),
            }),
        };
        let watched = Watched {
            feed: None,
            tracks: shown,
            standing: Standing::Connecting,
            round,
        };
        let _ = stage.feeds.insert(session, watched);
        let media = Arc::clone(&stage.media);
        let made = cx.background_executor().spawn(async move { media.watch(watch) });
        cx.spawn(async move |shell, cx| {
            let made = made.await;
            let _ = shell.update(cx, |shell, cx| shell.feed_made(session, round, made, cx));
        })
        .detach();
    }

    /// The viewer of `session`'s share, round `round`, is made, or failed.
    fn feed_made(
        &mut self,
        session: Session,
        round: u64,
        made: Result<Box<dyn Feed>, String>,
        cx: &mut Context<Self>,
    ) {
        let watched = self
            .stage
            .feeds
            .get_mut(&session)
            .filter(|watched| watched.round == round);
        match (watched, made) {
            (Some(watched), Ok(feed)) => watched.feed = Some(feed),
            (Some(watched), Err(why)) => {
                tracing::warn!(session, %why, "share: could not watch");
                watched.standing = Standing::Failed(why);
            }
            // Not wanted any more: stopped as soon as it came.
            (None, Ok(feed)) => off_the_window(cx, move || feed.stop()),
            (None, Err(_)) => {}
        }
        cx.notify();
    }

    /// Stop watching `session`'s share.
    fn unwatch(&mut self, session: Session, cx: &mut Context<Self>) {
        // Its window goes with it.
        if self.stage.popped_feed().is_some_and(|(popped, _)| popped == session) {
            self.bring_back(cx);
        }
        let Some(watched) = self.stage.feeds.remove(&session) else {
            return;
        };
        let _ = self.stage.stats.remove(&session);
        self.stage.loudness.forget(session);
        // Its sound stops with it, whatever its viewer does.
        self.stage.hearing.stop(session);
        for track in &watched.tracks {
            if let Some(picture) = track.screen.borrow_mut().release() {
                self.stage.retired.push(picture);
                self.stage.wake.now();
            }
        }
        if let Some(feed) = watched.feed {
            off_the_window(cx, move || feed.stop());
        }
    }

    /// New frames came: draw what shows them. A feed in a window of its
    /// own is drawn there, and this window again only for what it shows.
    fn frames_came(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        self.give_back_pictures(window);
        self.stage.frames.update(cx, |_, cx| cx.notify());
        if self.stage.feeds_drawn_here() {
            cx.notify();
        }
    }

    /// Give the window back the pictures of streams that ended.
    fn give_back_pictures(&mut self, window: &mut Window) {
        for picture in self.stage.retired.drain(..) {
            picture.give_back(window);
        }
    }

    /// The viewer of `session`'s share stands as `standing` now. A failed
    /// one watches again while the share goes on.
    fn watched_stands(&mut self, session: Session, standing: Standing, cx: &mut Context<Self>) {
        let Some(watched) = self.stage.feeds.get_mut(&session) else {
            return;
        };
        let failed = matches!(standing, Standing::Failed(_));
        watched.standing = standing;
        if !failed {
            return;
        }
        let round = watched.round;
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(AGAIN_AFTER).await;
            let _ = shell.update(cx, |shell, cx| {
                let still = shell.stage.feeds.get(&session).is_some_and(|w| w.round == round);
                if still {
                    shell.unwatch(session, cx);
                    shell.watch_shares(cx);
                }
            });
        })
        .detach();
    }

    /// Once a second: how the shares go, and one's own announced again if
    /// that is due.
    fn share_tick(&mut self, cx: &mut Context<Self>) {
        if self.stage.feeds.is_empty() && !self.stage.sharing() {
            return;
        }
        self.announce_if_due();
        self.stage.uplink = self.stage.broadcast.as_ref().and_then(|sent| sent.uplink());
        let shown = self.shown_shares();
        let asked: Vec<Session> = if self.stage.stats_open {
            shown.iter().map(|each| each.session).collect()
        } else {
            self.stage.shares.focused(&shown).map(|each| each.session).into_iter().collect()
        };
        for session in asked {
            self.ask_stats(session, cx);
        }
    }

    /// Ask how `session`'s share goes, off the window.
    fn ask_stats(&mut self, session: Session, cx: &mut Context<Self>) {
        // The viewer's own answer blocks: it is asked on its own thread, the
        // viewer lent there and back.
        let Some(feed) = self.stage.feeds.get_mut(&session).and_then(|w| w.feed.take()) else {
            return;
        };
        let asked = cx.background_executor().spawn(async move {
            let stats = feed.stats();
            (feed, stats)
        });
        cx.spawn(async move |shell, cx| {
            let (feed, stats) = asked.await;
            let _ = shell.update(cx, |shell, cx| match shell.stage.feeds.get_mut(&session) {
                Some(watched) if watched.feed.is_none() => {
                    watched.feed = Some(feed);
                    let before = shell.stage.stats.remove(&session).unwrap_or_default();
                    let _ = shell.stage.stats.insert(session, before.next(stats, Instant::now()));
                    cx.notify();
                }
                _ => off_the_window(cx, move || feed.stop()),
            });
        })
        .detach();
    }

    /// The share button: the picker, or stop sharing.
    pub(super) fn share_pressed(&mut self, cx: &mut Context<Self>) {
        if self.stage.sharing() {
            self.stop_share(cx);
        } else {
            self.open_share_picker(cx);
        }
    }

    /// Open the picker, unless sharing cannot start here.
    pub(super) fn open_share_picker(&mut self, cx: &mut Context<Self>) {
        let why_not = if self.snapshot.connection != Connection::Connected {
            Some(t!("Connect to a server to share your screen."))
        } else if self.stage.shares.shared_elsewhere(self.snapshot.own_session) {
            Some(t!("You are sharing from another device. Stop that share first."))
        } else if !self.stage.media.relays() {
            Some(t!(
                "This server does not relay screen shares, so a share would reach nobody."
            ))
        } else {
            None
        };
        if let Some(why) = why_not {
            self.stage.notice = Some(why);
            cx.notify();
            return;
        }
        let seeded = self.stage.shares.own().map(|own| (own.sources.clone(), own.settings));
        self.stage.picker = Some(picker::Picker::open(Arc::clone(&self.stage.media), seeded, cx));
        cx.notify();
    }

    /// Share `sources`, as `settings` say: in place of what is shared now,
    /// if something is.
    pub(super) fn start_share(&mut self, sources: Vec<Source>, settings: Settings, cx: &mut Context<Self>) {
        self.stage.picker = None;
        // It lay over what was shared until now.
        self.overlay_off(cx);
        let (Some(channel), Some(own)) = (self.snapshot.current_channel, self.snapshot.own_session) else {
            return;
        };
        if let Some(sent) = self.stage.broadcast.take() {
            off_the_window(cx, move || sent.stop());
        }
        let tracks = Tracks::of(sources.iter().map(|source| match source.kind {
            SourceKind::Device => Content::Camera,
            SourceKind::Screen | SourceKind::Window => Content::Screen,
        }));
        let server = self.active_session.clone();
        // START first: the server opens the share when it hears it, and an
        // offer for a share it has not opened is dropped.
        self.stage
            .media
            .announce(server.clone(), SignalKind::Start, tracks.payload());
        let members: Vec<Session> = self
            .snapshot
            .users
            .iter()
            .filter(|user| user.channel == channel && user.session != own)
            .map(|user| user.session)
            .collect();
        let start = Start {
            server: server.clone(),
            sources: sources.clone(),
            settings,
        };
        let previewed = self.stage.shares.own().map(|own| own.tracks.clone());
        self.stage.shares.begin_own(
            Own {
                server,
                channel,
                sources,
                settings,
                tracks: tracks.clone(),
                standing: Standing::Connecting,
            },
            own,
            members,
        );
        // Another track list is another preview.
        if previewed.is_some_and(|before| before != tracks) {
            self.unwatch(own, cx);
        }
        let media = Arc::clone(&self.stage.media);
        let made = cx.background_executor().spawn(async move { media.broadcast(start) });
        cx.spawn(async move |shell, cx| {
            let made = made.await;
            let _ = shell.update(cx, |shell, cx| shell.share_made(made, cx));
        })
        .detach();
        self.watch_shares(cx);
        cx.notify();
    }

    /// One's own share is going, or could not start.
    fn share_made(&mut self, made: Result<Box<dyn Broadcast>, String>, cx: &mut Context<Self>) {
        match made {
            Ok(sent) if self.stage.sharing() => self.stage.broadcast = Some(sent),
            Ok(sent) => off_the_window(cx, move || sent.stop()),
            Err(why) => {
                self.end_share(cx);
                self.stage.notice = Some(t!("Screen sharing failed to start: {{why}}", why = why));
            }
        }
        cx.notify();
    }

    /// How one's own share stands now.
    fn own_share_stands(&mut self, standing: Standing, cx: &mut Context<Self>) {
        let failed = match &standing {
            Standing::Failed(why) => Some(why.clone()),
            _ => None,
        };
        if let Some(own) = self.stage.shares.own_mut() {
            own.standing = standing;
        }
        if let Some(why) = failed.filter(|_| self.stage.sharing()) {
            self.stop_share(cx);
            self.stage.notice = Some(t!("Screen sharing failed: {{why}}", why = why));
        }
    }

    /// Stop sharing: tell the channel, and let go of capture.
    pub(super) fn stop_share(&mut self, cx: &mut Context<Self>) {
        if let Some(own) = self.stage.shares.own() {
            self.stage
                .media
                .announce(own.server.clone(), SignalKind::Stop, String::new());
        }
        self.end_share(cx);
    }

    /// One's own share is over, however it ended.
    fn end_share(&mut self, cx: &mut Context<Self>) {
        self.overlay_off(cx);
        if let Some(own) = self.stage.shares.end_own() {
            let _ = self.stage.drawing.remove(&own.channel);
        }
        if let Some(sent) = self.stage.broadcast.take() {
            off_the_window(cx, move || sent.stop());
        }
        self.stage.uplink = None;
        if let Some(own) = self.snapshot.own_session {
            self.unwatch(own, cx);
        }
        self.watch_shares(cx);
        cx.notify();
    }
}
