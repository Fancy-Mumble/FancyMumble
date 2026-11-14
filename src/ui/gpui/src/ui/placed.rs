//! Where the window was left, so that it opens there again.
//!
//! The size and place are kept with the settings and read before the window
//! is opened. A place that is on no screen any more (a monitor unplugged
//! since) is not gone back to: the window opens in the middle instead.

use std::time::Duration;

use gpui::{App, Bounds, Context, Pixels, Window, WindowBounds, point, px, size};

use super::Shell;
use crate::store::Placed;

/// The window's size on first launch, as the web UI opens.
const FIRST: (f32, f32) = (1410.0, 758.0);

/// How much of the window has to be on a screen for its place to be kept:
/// enough to see it and take hold of it.
const IN_SIGHT: f32 = 120.0;

/// How long the window has to have been left alone before where it is gets
/// written down: a drag is a hundred places, and one of them matters.
const SETTLED: Duration = Duration::from_millis(600);

impl Placed {
    /// Where `window` is now, with the size it goes back to if it fills the
    /// screen at the moment.
    pub(super) fn of(window: &Window) -> Self {
        let (bounds, maximized) = match window.window_bounds() {
            WindowBounds::Windowed(bounds) => (bounds, false),
            WindowBounds::Maximized(bounds) | WindowBounds::Fullscreen(bounds) => (bounds, true),
        };
        Self {
            x: bounds.origin.x.into(),
            y: bounds.origin.y.into(),
            width: bounds.size.width.into(),
            height: bounds.size.height.into(),
            maximized,
        }
    }

    fn bounds(self) -> Bounds<Pixels> {
        Bounds::new(
            point(px(self.x), px(self.y)),
            size(px(self.width), px(self.height)),
        )
    }

    /// Whether enough of it lies on one of `screens` to be seen.
    fn in_sight(self, screens: &[Bounds<Pixels>]) -> bool {
        let enough = px(IN_SIGHT);
        screens.iter().any(|screen| {
            let seen = screen.intersect(&self.bounds());
            seen.size.width >= enough && seen.size.height >= enough
        })
    }
}

/// How the window opens: where it was left, if that is still on a screen,
/// and otherwise in the middle at the size of a first launch.
pub(crate) fn opening(placed: Option<Placed>, cx: &App) -> WindowBounds {
    opening_sized(placed, FIRST, cx)
}

/// How a window opens: where it was left, if that is still on a screen,
/// and otherwise in the middle at `first`.
pub(crate) fn opening_sized(placed: Option<Placed>, first: (f32, f32), cx: &App) -> WindowBounds {
    let screens: Vec<_> = cx
        .displays()
        .iter()
        .map(|display| display.bounds())
        .collect();
    match placed.filter(|placed| placed.in_sight(&screens)) {
        Some(placed) if placed.maximized => WindowBounds::Maximized(placed.bounds()),
        Some(placed) => WindowBounds::Windowed(placed.bounds()),
        None => WindowBounds::Windowed(Bounds::centered(None, size(px(first.0), px(first.1)), cx)),
    }
}

impl Shell {
    /// The window was moved or resized: note where it is, and write it down
    /// once it has been left alone for a moment.
    pub(super) fn window_moved(&mut self, window: &Window, cx: &mut Context<Self>) {
        let placed = Placed::of(window);
        if self.chrome.placed == Some(placed) {
            return;
        }
        self.chrome.placed = Some(placed);
        cx.spawn(async move |shell, cx| {
            cx.background_executor().timer(SETTLED).await;
            let _ = shell.update(cx, |shell, cx| {
                // Moved again meanwhile: that move's own timer writes it.
                if shell.chrome.placed == Some(placed) {
                    shell.remember_settings(cx);
                }
            });
        })
        .detach();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn placed(x: f32, y: f32) -> Placed {
        Placed {
            x,
            y,
            width: 800.0,
            height: 600.0,
            maximized: false,
        }
    }

    #[test]
    fn a_place_is_kept_only_while_enough_of_it_is_on_a_screen() {
        let screens = [Bounds::new(
            point(px(0.0), px(0.0)),
            size(px(1920.0), px(1080.0)),
        )];
        assert!(placed(100.0, 100.0).in_sight(&screens));
        // Mostly off the right edge, but with a strip to take hold of.
        assert!(placed(1700.0, 100.0).in_sight(&screens));
        // A sliver, and nothing at all: a monitor that is gone.
        assert!(!placed(1900.0, 100.0).in_sight(&screens));
        assert!(!placed(2600.0, 100.0).in_sight(&screens));
        assert!(!placed(100.0, 100.0).in_sight(&[]));
    }
}
