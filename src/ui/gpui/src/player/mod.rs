//! Playing a video in place: a web view in a window of its own, laid over
//! the card the video belongs to.
//!
//! The window is a child of the client's, so the system draws it over
//! whatever the client draws there. It is placed in every frame the card
//! is painted in, at the end of that frame, from where the card was
//! painted: it moves with the conversation, is cut where the
//! conversation's view ends, and is hidden while anything painted later
//! covers it (a menu, a dialog). A frame the card is not painted in hides
//! it.
//!
//! Nothing of the web view exists until a video is played, and all of it
//! goes when it stops. Only Windows has one; elsewhere a video opens in
//! the browser as it did.
//!
//! The boundary, for another way of showing the page (a composited
//! surface, an off-screen engine, another system's web view): a
//! [`Screens`] says whether it plays in place and opens a [`Screen`] for a
//! [`Page`], which reports back as [`Said`] on a channel. The client only
//! ever tells a screen where it is ([`Placement`], device pixels, with the
//! part seen; `Hidden` under anything drawn over it), when to start and to
//! play on, to give the keyboard back and to rest; a screen that renders off screen
//! hands its picture over through [`Screen::frame`] and the client draws
//! it. Nothing outside this module knows which kind it is: [`screens`]
//! picks this system's.

mod page;
mod place;
#[cfg_attr(any(not(windows), test), expect(dead_code, reason = "the browser's arguments are for the Windows web view, which tests do not make"))]
mod settings;
#[cfg(all(windows, not(test)))]
mod web_view;
#[cfg(all(windows, not(test)))]
mod win32;

use std::rc::Rc;
use std::sync::Arc;

use gpui::{Bounds, PaintMark, Pixels, RenderImage, Window};

pub(crate) use page::{Moment, Page, Said};
pub(crate) use place::Placement;

/// A window a page is shown in, over the client's own.
pub(crate) trait Screen {
    /// Load the page, which plays at once. Asked once, the first time more
    /// than half of it is seen: `YouTube` lets a player start by itself
    /// only once it is visible.
    fn start(&mut self);
    /// Play on from a pause: the reader pressed the still it was put away
    /// behind.
    fn play_on(&mut self);
    /// Pause, and say so with where it stood.
    fn pause(&mut self);
    /// Put it at `placement`.
    fn place(&mut self, placement: Placement);
    /// Give the keyboard back to the client's window.
    fn release_keys(&mut self);
    /// Hold as little memory as it can while `resting`, or work normally.
    fn rest(&mut self, resting: bool);
    /// The page's latest picture, for a screen that renders off screen
    /// and leaves the drawing to the client; a screen that is a window of
    /// its own has none.
    fn frame(&mut self) -> Option<Arc<RenderImage>> {
        None
    }
}

/// What opens screens.
pub(crate) trait Screens {
    /// Whether anything can be played in place at all.
    fn plays_in_place(&self) -> bool;

    /// Show `page` over `window`, hidden until placed. What the page says
    /// comes on `said`.
    ///
    /// # Errors
    ///
    /// When there is no web view to show it in.
    fn open(
        &self,
        page: &Page,
        window: &Window,
        said: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String>;
}

/// The screens of this platform. Under test, none: a test never makes a
/// web view, and one that plays gives its own screens.
pub(crate) fn screens() -> Rc<dyn Screens> {
    #[cfg(all(windows, not(test)))]
    return Rc::new(web_view::WebViews);
    #[cfg(any(not(windows), test))]
    return Rc::new(Browser);
}

/// No screens: videos open in the browser.
#[cfg(any(not(windows), test))]
#[derive(Debug)]
struct Browser;

#[cfg(any(not(windows), test))]
impl Screens for Browser {
    fn plays_in_place(&self) -> bool {
        false
    }

    fn open(
        &self,
        _: &Page,
        _: &Window,
        _: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String> {
        Err("no web view on this system".to_owned())
    }
}

/// Where the stage was painted in the frame being drawn.
#[derive(Debug, Clone, Copy)]
struct Seen {
    stage: Bounds<Pixels>,
    mask: Bounds<Pixels>,
    mark: PaintMark,
}

/// The player's window, and where it was put.
pub(crate) struct Stage {
    screen: Box<dyn Screen>,
    placed: Placement,
    seen: Option<Seen>,
    started: bool,
    /// Asked to play on from a pause, once it is seen again.
    playing_on: bool,
}

impl std::fmt::Debug for Stage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Stage")
            .field("placed", &self.placed)
            .finish_non_exhaustive()
    }
}

impl Stage {
    /// Over nothing yet.
    pub(crate) fn new(screen: Box<dyn Screen>) -> Self {
        Self {
            screen,
            placed: Placement::Hidden,
            seen: None,
            started: false,
            playing_on: false,
        }
    }

    /// The stage was painted at `stage`, seen through `mask`, and what is
    /// painted after `mark` may cover it.
    pub(crate) fn seen(&mut self, stage: Bounds<Pixels>, mask: Bounds<Pixels>, mark: PaintMark) {
        self.seen = Some(Seen { stage, mask, mark });
    }

    /// The frame is painted: put the window where the stage was, or hide
    /// it if the stage was not painted. Whether it was out of sight: not
    /// painted, or painted where nothing of it is seen; covered by what is
    /// drawn over it is not out of sight.
    pub(crate) fn settle(&mut self, window: &Window) -> bool {
        let mut unseen = true;
        let placement = self.seen.take().map_or(Placement::Hidden, |seen| {
            let shown = seen.stage.intersect(&seen.mask);
            unseen = shown.is_empty();
            let covered = !shown.is_empty() && window.painted_over(seen.mark, shown);
            Placement::of(seen.stage, seen.mask, window.scale_factor(), covered)
        });
        self.put(placement);
        unseen
    }

    /// Pause it: the page then says where it stood.
    pub(crate) fn pause(&mut self) {
        self.screen.pause();
    }

    /// Put the window at `placement`, if it is not there; start it the
    /// first time it is mostly seen, and play on when asked once it is.
    pub(crate) fn put(&mut self, placement: Placement) {
        if placement == self.placed {
            return;
        }
        let was_shown = self.placed != Placement::Hidden;
        self.placed = placement;
        self.screen.place(placement);
        if was_shown && placement == Placement::Hidden {
            self.screen.release_keys();
        }
        if placement.mostly_seen() {
            if !self.started {
                self.started = true;
                self.screen.start();
            }
            if std::mem::take(&mut self.playing_on) {
                self.screen.play_on();
            }
        }
    }

    /// Give the keyboard back to the client's window.
    pub(crate) fn release_keys(&mut self) {
        self.screen.release_keys();
    }

    /// Play on from a pause, once it is seen again.
    pub(crate) fn play_on(&mut self) {
        self.playing_on = true;
    }

    /// Hold little while `resting`.
    pub(crate) fn rest(&mut self, resting: bool) {
        self.screen.rest(resting);
    }

    /// The picture to draw on the stage, where the screen leaves that to
    /// the client.
    pub(crate) fn frame(&mut self) -> Option<Arc<RenderImage>> {
        self.screen.frame()
    }
}
