//! Playing a video in place: a web view laid over the card the video
//! belongs to.
//!
//! On Windows the web view is a surface of the window's own composition
//! (GPUI's window composition): the system composes it between what the
//! client draws under it and what floats over it (menus, dialogs, toasts,
//! drawn on the composition's overlay), so nothing has to hide it while
//! something is drawn over it. It is placed in every frame the card is
//! drawn in, as the frame is laid out, from where the card is: it moves
//! with the conversation and is cut where the conversation's view ends. A
//! frame the card is not drawn in hides it.
//!
//! Nothing of the web view exists until a video is played, and all of it
//! goes when it stops. Only Windows has one; elsewhere a video opens in
//! the browser as it did.
//!
//! The boundary, for another way of showing the page (an off-screen
//! engine, another system's web view): a [`Screens`] says whether it plays
//! in place and opens a [`Screen`] for a [`Page`], which reports back as
//! [`Said`] on a channel. The client only ever tells a screen where it is
//! ([`Placement`], device pixels, with the part seen), when to start, to
//! give the keyboard back and to rest; a screen that renders off screen
//! hands its picture over through [`Screen::frame`] and the client draws
//! it. Nothing outside this module knows which kind it is: [`screens`]
//! picks this system's.

#[cfg(all(windows, not(test)))]
mod composed;
mod page;
mod place;

use std::rc::Rc;
use std::sync::Arc;

use gpui::{Bounds, CompositionSurfaceId, Pixels, RenderImage, Window};

pub(crate) use page::{Page, Said};
pub(crate) use place::Placement;

/// A view a page is shown in, over the client's own.
pub(crate) trait Screen {
    /// Load the page, which plays at once. Asked once, the first time more
    /// than half of it is seen: `YouTube` lets a player start by itself
    /// only once it is visible.
    fn start(&mut self);
    /// Put it at `placement`.
    fn place(&mut self, placement: Placement);
    /// The window's device pixels to each of its own, for a screen that
    /// takes the pointer from the client.
    fn scale(&mut self, _scale: f32) {}
    /// Give the keyboard back to the client's window.
    fn release_keys(&mut self);
    /// Hold as little memory as it can while `resting`, or work normally.
    fn rest(&mut self, resting: bool);
    /// The page's latest picture, for a screen that renders off screen
    /// and leaves the drawing to the client; a screen the system composes
    /// has none.
    fn frame(&mut self) -> Option<Arc<RenderImage>> {
        None
    }
    /// The surface of the window's composition that is drawn over this
    /// screen, for a screen the system composes: what floats over the
    /// window is drawn there.
    fn overlay(&self) -> Option<CompositionSurfaceId> {
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
        window: &mut Window,
        said: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String>;

    /// Whether screens that were closed still leave something in the
    /// window for [`Screens::settle`] to take away.
    fn unsettled(&self) -> bool {
        false
    }

    /// Take away what closed screens left in `window`. Called as the
    /// window is laid out.
    fn settle(&self, _window: &mut Window) {}
}

/// The screens of this platform. Under test, none: a test never makes a
/// web view, and one that plays gives its own screens.
pub(crate) fn screens() -> Rc<dyn Screens> {
    #[cfg(all(windows, not(test)))]
    return Rc::new(composed::WebViews::default());
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
        _: &mut Window,
        _: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String> {
        Err("no web view on this system".to_owned())
    }
}

/// Where the stage was laid out in the frame being drawn.
#[derive(Debug, Clone, Copy)]
struct Seen {
    stage: Bounds<Pixels>,
    mask: Bounds<Pixels>,
}

/// The player's view, and where it was put.
pub(crate) struct Stage {
    screen: Box<dyn Screen>,
    placed: Placement,
    seen: Option<Seen>,
    started: bool,
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
        }
    }

    /// The stage was laid out at `stage`, seen through `mask`.
    pub(crate) fn seen(&mut self, stage: Bounds<Pixels>, mask: Bounds<Pixels>) {
        self.seen = Some(Seen { stage, mask });
    }

    /// Everything that can hold the stage is laid out: put the view where
    /// the stage was, or hide it if the stage was not laid out.
    pub(crate) fn settle(&mut self, window: &Window) {
        let scale = window.scale_factor();
        self.screen.scale(scale);
        let placement = self
            .seen
            .take()
            .map_or(Placement::Hidden, |seen| Placement::of(seen.stage, seen.mask, scale));
        self.put(placement);
    }

    /// Put the view at `placement`, if it is not there, and start it the
    /// first time it is mostly seen.
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
        if !self.started && placement.mostly_seen() {
            self.started = true;
            self.screen.start();
        }
    }

    /// Give the keyboard back to the client's window.
    pub(crate) fn release_keys(&mut self) {
        self.screen.release_keys();
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

    /// Where what floats over the window is drawn while this plays.
    pub(crate) fn overlay(&self) -> Option<CompositionSurfaceId> {
        self.screen.overlay()
    }
}
