//! What viewers draw on one's own share, drawn over the shared screen or
//! window itself, as the web client's desktop overlay draws it
//! (`DrawingOverlay.tsx`): a window the pointer passes through, that never
//! takes the keyboard, laid exactly over the source and following it ten
//! times a second, showing nothing while the window shared is minimized and
//! closing when it is closed. It is left out of screen captures, so the
//! share does not send each stroke back to the viewers a second time. The
//! strokes stay until cleared, as in the web client, which fades none.
//!
//! It is opened from the stage's menu of one's own share, and closes with
//! the share.

use std::sync::Arc;
use std::time::Duration;

use gpui::{
    AppContext, Bounds, Context, IntoElement, ParentElement, Render, Styled, Subscription, Task,
    WeakEntity, Window, div, point, prelude::*, px, size,
};

use super::super::Shell;
use super::super::aside::{Kind, Opening};
use super::drawing::strokes_over_all;
use crate::share::Source;
use crate::share::SourceKind;
use crate::share::whereabouts::{Area, Lies, Whereabouts};
use crate::words::t;

/// The window's name.
pub(crate) const NAME: &str = "overlay";
/// How often it looks where the source lies, as the web client's does.
pub(crate) const FOLLOW_EVERY: Duration = Duration::from_millis(100);

impl Shell {
    /// Whether the overlay is open.
    pub(super) fn overlay_open(&self) -> bool {
        self.aside_open(NAME)
    }

    /// Open the overlay over what one shares, or close it.
    pub(in crate::ui) fn toggle_overlay(&mut self, cx: &mut Context<Self>) {
        if self.overlay_open() {
            self.overlay_off(cx);
        } else {
            self.overlay_on(cx);
        }
    }

    /// Open the overlay over what one shares, where that lies now.
    fn overlay_on(&mut self, cx: &mut Context<Self>) {
        let source = self
            .stage
            .shares
            .own()
            .and_then(|own| {
                own.sources
                    .iter()
                    .find(|source| source.kind != SourceKind::Device)
            })
            .cloned();
        let Some(source) = source else {
            return;
        };
        let whereabouts = self.stage.media.whereabouts();
        let Lies::At(area) = whereabouts.of(&source) else {
            self.stage.notice = Some(t!(
                "What you share is not on screen, so nothing can be drawn over it."
            ));
            cx.notify();
            return;
        };
        // A point where it lies: the window puts itself there exactly, at
        // its own scale, before anything is drawn.
        let at = Bounds::new(
            point(px(area.x as f32), px(area.y as f32)),
            size(px(1.0), px(1.0)),
        );
        let opening = Opening {
            name: NAME,
            title: t!("Drawings over your share"),
            first: (1.0, 1.0),
            least: (1.0, 1.0),
            kind: Kind::Overlay { at },
            closed: Self::overlay_off,
        };
        self.open_aside(
            &opening,
            move |shell, window, cx| {
                cx.new(|cx| OverlayWindow::new(shell, source, whereabouts, window, cx))
                    .into()
            },
            cx,
        );
        cx.notify();
    }

    /// Close the overlay.
    pub(super) fn overlay_off(&mut self, cx: &mut Context<Self>) {
        self.close_aside(NAME, cx);
        cx.notify();
    }
}

/// The overlay's content: the strokes on one's own share, over all of it.
struct OverlayWindow {
    shell: WeakEntity<Shell>,
    /// Where it was put, and at what scale: put again only when that
    /// changes.
    placed: Option<(Area, f32)>,
    /// The window shared is minimized: nothing is shown.
    hidden: bool,
    /// The strokes' changes when last drawn.
    drawn: u64,
    _follow: Task<()>,
    _strokes: Option<Subscription>,
}

impl OverlayWindow {
    fn new(
        shell: WeakEntity<Shell>,
        source: Source,
        whereabouts: Arc<dyn Whereabouts>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        // Drawn again only when a stroke changes, not for every frame of
        // the share.
        let strokes = shell.upgrade().map(|shell| {
            cx.observe(&shell, |overlay: &mut Self, shell, cx| {
                let changes = shell.read(cx).stage.shares.strokes.changes();
                if std::mem::replace(&mut overlay.drawn, changes) != changes {
                    cx.notify();
                }
            })
        });
        let follow = cx.spawn_in(window, async move |overlay, cx| {
            loop {
                let lies = whereabouts.of(&source);
                let following =
                    overlay.update_in(cx, |overlay, window, cx| overlay.follow(lies, window, cx));
                if !matches!(following, Ok(true)) {
                    break;
                }
                cx.background_executor().timer(FOLLOW_EVERY).await;
            }
        });
        Self {
            shell,
            placed: None,
            hidden: false,
            drawn: 0,
            _follow: follow,
            _strokes: strokes,
        }
    }

    /// Lie where the source lies now. Says whether to go on following it.
    fn follow(&mut self, lies: Lies, window: &mut Window, cx: &mut Context<Self>) -> bool {
        match lies {
            Lies::At(area) => {
                let scale = window.scale_factor();
                if self.placed != Some((area, scale)) {
                    self.placed = Some((area, scale));
                    super::super::aside::place(window, Bounds::new(
                        point(px(area.x as f32 / scale), px(area.y as f32 / scale)),
                        size(
                            px(area.width as f32 / scale),
                            px(area.height as f32 / scale),
                        ),
                    ));
                }
                if std::mem::take(&mut self.hidden) {
                    cx.notify();
                }
                true
            }
            Lies::Hidden => {
                if !std::mem::replace(&mut self.hidden, true) {
                    cx.notify();
                }
                true
            }
            Lies::Gone => {
                let _ = self.shell.update(cx, Shell::overlay_off);
                false
            }
        }
    }
}

impl Render for OverlayWindow {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let strokes: Vec<_> = self
            .shell
            .upgrade()
            .and_then(|shell| {
                let shell = shell.read(cx);
                let channel = shell.stage.shares.own()?.channel;
                Some(shell.stage.shares.strokes.of(channel).cloned().collect())
            })
            .unwrap_or_default();
        let shown = if self.hidden || self.placed.is_none() {
            0
        } else {
            strokes.len()
        };
        div()
            .debug_selector(move || format!("overlay-strokes-{shown}"))
            .size_full()
            .when(shown > 0, |overlay| {
                overlay.child(strokes_over_all(strokes))
            })
    }
}
