//! Moving round a share shown pixel for pixel (1:1), where it is larger
//! than the stage: dragged with the pointer, scrolled with the wheel as the
//! web client's stage scrolls, stepped with the arrow keys while the stage
//! has the keyboard. It cannot be moved out of sight, and it is back in the
//! middle whenever the fit or the share shown changes. The picture view of
//! the lightbox (`ui::zoom`) does the moving and the keeping in sight.

use gpui::{Context, KeyDownEvent, Pixels, Point, ScrollDelta, ScrollEvent};

use super::super::Shell;
use super::super::zoom::View;
use crate::share::Fit;

/// How far one press of an arrow key moves it.
const STEP: f32 = 40.0;
/// How far one line of the wheel moves it.
const LINE: f32 = 40.0;

/// Where the share shown pixel for pixel is moved to.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct Pan {
    view: View,
}

impl Pan {
    /// How far it is moved from the middle.
    pub(crate) fn offset(self) -> (f32, f32) {
        self.view.offset()
    }
}

impl Shell {
    /// Whether the share shown large can be moved: it is pixel for pixel.
    fn pans(&self) -> bool {
        self.stage.shares.fit == Fit::Actual
    }

    /// Kept in sight: the large share's picture as last laid, in its room.
    fn keep_in_sight(&mut self) {
        let laid = self.large_track().and_then(|track| {
            let screen = track.screen.borrow();
            Some((screen.laid?, screen.room?))
        });
        if let Some((laid, room)) = laid {
            let room = (f32::from(room.size.width), f32::from(room.size.height));
            self.stage.pan.view = self.stage.pan.view.kept_in((laid.width, laid.height), room);
        }
    }

    /// The button went down on the large share at `at`.
    pub(super) fn pan_held(&mut self, at: Point<Pixels>) {
        if self.pans() {
            self.stage.pan.view = self.stage.pan.view.held_at((f32::from(at.x), f32::from(at.y)));
        }
    }

    /// The pointer moved to `at` with the button held.
    pub(super) fn pan_dragged(&mut self, at: Point<Pixels>, cx: &mut Context<Self>) {
        if !self.pans() || !self.stage.pan.view.is_held() {
            return;
        }
        self.stage.pan.view = self.stage.pan.view.panned_to((f32::from(at.x), f32::from(at.y)));
        self.keep_in_sight();
        cx.notify();
    }

    pub(super) fn pan_let_go(&mut self) {
        let _ = self.stage.pan.view.released();
    }

    /// Move it `by`.
    pub(in crate::ui) fn pan_by(&mut self, by: (f32, f32), cx: &mut Context<Self>) {
        if !self.pans() {
            return;
        }
        self.stage.pan.view = self.stage.pan.view.moved_by(by);
        self.keep_in_sight();
        cx.notify();
    }

    /// The wheel over the large share: down and up move the picture up and
    /// down, as a scrolled page moves; with Shift, left and right.
    pub(super) fn pan_wheel(&mut self, event: &ScrollEvent, cx: &mut Context<Self>) {
        if !self.pans() {
            return;
        }
        let (x, y) = match event.delta {
            ScrollDelta::Pixels(delta) => (f32::from(delta.x), f32::from(delta.y)),
            ScrollDelta::Lines(delta) => (delta.x * LINE, delta.y * LINE),
        };
        let by = if event.modifiers.shift { (y, x) } else { (x, y) };
        cx.stop_propagation();
        self.pan_by(by, cx);
    }

    /// An arrow key while the stage has the keyboard. Says whether it moved.
    pub(super) fn pan_key(&mut self, event: &KeyDownEvent, cx: &mut Context<Self>) -> bool {
        let by = match event.keystroke.key.as_str() {
            "left" => (STEP, 0.0),
            "right" => (-STEP, 0.0),
            "up" => (0.0, STEP),
            "down" => (0.0, -STEP),
            _ => return false,
        };
        if !self.pans() {
            return false;
        }
        self.pan_by(by, cx);
        true
    }

    /// Lay the large share `fit`; it is back in the middle.
    pub(super) fn lay_large(&mut self, fit: Fit) {
        self.stage.shares.fit = fit;
        self.stage.pan = Pan::default();
    }

    /// Show `session`'s share large, its camera where `camera`; it starts
    /// in the middle.
    pub(super) fn show_large(&mut self, session: crate::engine::Session, camera: bool) {
        self.stage.shares.focus(session);
        self.stage.large_camera = camera.then_some(session);
        self.stage.pan = Pan::default();
    }
}
