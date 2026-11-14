//! A feed in a window of its own (`ScreenSharePopout.tsx`), over every
//! other window as the web client's is. The feed moves there: it is
//! decoded once, for that window, and the stage says where it went and
//! can take it back. The window has the web client's controls (how the
//! picture is laid, the whole screen, close), and closing it in any way
//! brings the feed back. A share that ends takes its window with it.

use gpui::{
    AnyElement, App, AppContext, Context, IntoElement, ParentElement, Render, SharedString, Styled,
    Subscription, WeakEntity, Window, div, hsla, prelude::*, px,
};

use super::super::Shell;
use super::super::aside::{Kind, Opening};
use super::super::kit::{IconButton, Segmented, Variant};
use super::Track;
use super::large::feed_video;
use super::view::{WELL, kind_of, name_of};
use crate::engine::Session;
use crate::share::Fit;
use crate::share::shares::Whose;
use crate::words::t;

/// The window's name, under which its place is kept.
pub(crate) const NAME: &str = "stream";
/// Its size the first time, as the web client opens it.
const FIRST: (f32, f32) = (960.0, 540.0);
const LEAST: (f32, f32) = (320.0, 180.0);
/// The frames a second it is wanted at: as the stage's large feed.
const RATE: u32 = 30;

/// The feed in its own window, and how it is laid there.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Popped {
    pub session: Session,
    pub camera: bool,
    pub fit: Fit,
}

impl super::Stage {
    /// The feed in its own window: whose, and whether it is their camera.
    pub(crate) fn popped_feed(&self) -> Option<(Session, bool)> {
        self.popped.map(|popped| (popped.session, popped.camera))
    }
}

impl Shell {
    /// Move the feed shown large into a window of its own. Another already
    /// there comes back first; one's own share stays, as in the web client.
    pub(in crate::ui) fn pop_out(&mut self, cx: &mut Context<Self>) {
        let Some(feed) = self.large_feed(&self.stage_feeds()) else {
            return;
        };
        if feed.each.whose == Whose::Mine {
            return;
        }
        self.bring_back(cx);
        let (session, camera) = (feed.session(), feed.camera);
        // Its picture lies with this window: given back here, and made
        // again there.
        if let Some(track) = self
            .stage
            .feeds
            .get(&session)
            .and_then(|watched| watched.track(camera))
            && let Some(picture) = track.screen.borrow_mut().release()
        {
            self.stage.retired.push(picture);
            self.stage.wake.now();
        }
        self.stage.popped = Some(Popped {
            session,
            camera,
            fit: Fit::Whole,
        });
        let opening = Opening {
            name: NAME,
            title: format!("{} · {}", name_of(self, &feed.each), kind_of(self, &feed)).into(),
            first: FIRST,
            least: LEAST,
            kind: Kind::OnTop,
            closed: Self::bring_back,
        };
        self.open_aside(
            &opening,
            |shell, window, cx| cx.new(|cx| StreamWindow::new(shell, window, cx)).into(),
            cx,
        );
        cx.notify();
    }

    /// Bring the feed in its own window back to the stage, and close the
    /// window.
    pub(in crate::ui) fn bring_back(&mut self, cx: &mut Context<Self>) {
        let Some(popped) = self.stage.popped.take() else {
            return;
        };
        // Its picture lay with that window, and goes with it.
        if let Some(track) = self
            .stage
            .feeds
            .get(&popped.session)
            .and_then(|watched| watched.track(popped.camera))
        {
            let _ = track.screen.borrow_mut().release();
        }
        self.close_aside(NAME, cx);
        cx.notify();
    }

    /// Lay the feed in its own window `fit`.
    fn lay_popped(&mut self, fit: Fit, cx: &mut Context<Self>) {
        if let Some(popped) = self.stage.popped.as_mut() {
            popped.fit = fit;
            cx.notify();
        }
    }
}

/// What the window shows: drawn again whenever the shell is, which is when
/// a frame comes.
struct StreamWindow {
    shell: WeakEntity<Shell>,
    _shell_changed: Option<Subscription>,
}

impl StreamWindow {
    fn new(shell: WeakEntity<Shell>, _window: &mut Window, cx: &mut Context<Self>) -> Self {
        let changed = shell
            .upgrade()
            .map(|shell| cx.observe(&shell, |_, _, cx| cx.notify()));
        Self {
            shell,
            _shell_changed: changed,
        }
    }
}

/// What the window draws of the shell, read before anything is drawn.
struct Shown {
    track: Track,
    fit: Fit,
    caption: SharedString,
}

impl StreamWindow {
    fn shown(&self, cx: &App) -> Option<Shown> {
        let shell = self.shell.upgrade()?;
        let shell = shell.read(cx);
        let popped = shell.stage.popped?;
        let track = shell
            .stage
            .feeds
            .get(&popped.session)?
            .track(popped.camera)?
            .clone();
        let feeds = shell.stage_feeds();
        let feed = feeds
            .iter()
            .find(|feed| feed.session() == popped.session && feed.camera == popped.camera)?;
        Some(Shown {
            track,
            fit: popped.fit,
            caption: format!("{} · {}", name_of(shell, &feed.each), kind_of(shell, feed)).into(),
        })
    }

    /// Have the shell do `what`.
    fn tell(
        shell: &WeakEntity<Shell>,
        cx: &mut App,
        what: impl FnOnce(&mut Shell, &mut Context<Shell>),
    ) {
        let _ = shell.update(cx, what);
    }
}

impl Render for StreamWindow {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let shown = self.shown(cx);
        let stream = div()
            .id("popout")
            .debug_selector(|| "popout".to_owned())
            .size_full()
            .relative()
            .bg(WELL)
            .overflow_hidden();
        let Some(shown) = shown else {
            return stream;
        };
        stream
            .child(feed_video(&shown.track, shown.fit, (0.0, 0.0), RATE))
            .child(caption(shown.caption))
            .child(controls(&self.shell, shown.fit, window))
    }
}

/// Whose it is and what, over the top.
fn caption(says: SharedString) -> impl IntoElement {
    div()
        .debug_selector(|| "popout-caption".to_owned())
        .absolute()
        .top(px(8.0))
        .left(px(10.0))
        .px(px(6.0))
        .rounded(px(4.0))
        .bg(hsla(0.61, 0.38, 0.05, 0.7))
        .text_size(px(11.0))
        .text_color(hsla(0.62, 0.3, 0.93, 1.0))
        .child(says)
}

/// A glass button over the picture.
fn glass(button: IconButton) -> IconButton {
    button.size(26.0).glyph_size(12.0).variant(Variant::Filled)
}

/// The controls over the foot: how it is laid, the whole screen, close.
fn controls(shell: &WeakEntity<Shell>, fit: Fit, window: &Window) -> AnyElement {
    let taken = Fit::ALL.iter().position(|each| *each == fit).unwrap_or(0);
    let whole = window.is_fullscreen();
    let (laid, closing) = (shell.clone(), shell.clone());
    div()
        .absolute()
        .bottom(px(8.0))
        .left(px(10.0))
        .right(px(10.0))
        .flex()
        .items_center()
        .gap(px(6.0))
        .child(
            Segmented::new("popout-fit", Fit::ALL.map(Fit::name), taken).on_choose(
                move |at, _, cx| {
                    let fit = Fit::ALL[*at];
                    StreamWindow::tell(&laid, cx, |shell, cx| shell.lay_popped(fit, cx));
                },
            ),
        )
        .child(div().flex_1())
        .child(
            glass(IconButton::new(
                "popout-whole",
                if whole { "minimize" } else { "maximize" },
            ))
            .tip(if whole {
                t!("Exit fullscreen")
            } else {
                t!("Fullscreen")
            })
            .on_click(|_, window, _| window.toggle_fullscreen()),
        )
        .child(
            glass(IconButton::new("popout-close", "x"))
                .tip(t!("Close"))
                .on_click(move |_, _, cx| StreamWindow::tell(&closing, cx, Shell::bring_back)),
        )
        .into_any_element()
}
