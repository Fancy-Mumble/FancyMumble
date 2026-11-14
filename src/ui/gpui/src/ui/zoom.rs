//! How the picture opened large is being looked at: how much larger than it
//! fits, and moved how far from the middle.

/// The most a picture is enlarged, over the size it fits at.
const MOST: f32 = 8.0;
/// What one notch of the wheel, or one press of a key, multiplies it by.
const NOTCH: f32 = 1.2;
/// What a click on a picture that fits enlarges it to.
const CLICKED: f32 = 2.0;

/// The view of one picture.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(super) struct View {
    /// Which picture this is the view of, by what is in its file: another
    /// picture starts as it fits.
    of: u64,
    /// How much larger than it fits: one is as it fits.
    scale: f32,
    /// How far its middle is from the middle of the room.
    offset: (f32, f32),
    /// Where the pointer was when it last moved with the button held on
    /// the picture, while it is held.
    held: Option<(f32, f32)>,
    /// Whether the pointer moved since the button went down: a press that
    /// moved the picture is not a click on it.
    moved: bool,
}

impl Default for View {
    fn default() -> Self {
        Self {
            of: 0,
            scale: 1.0,
            offset: (0.0, 0.0),
            held: None,
            moved: false,
        }
    }
}

impl View {
    /// The view of the picture held at `of`, as `held` has it: this one if
    /// it is of that picture, a fresh one if it is of another.
    pub(super) fn of(held: Self, of: u64) -> Self {
        if held.of == of {
            held
        } else {
            Self {
                of,
                ..Self::default()
            }
        }
    }

    pub(super) fn scale(self) -> f32 {
        self.scale
    }

    pub(super) fn offset(self) -> (f32, f32) {
        self.offset
    }

    /// Whether the button is held on the picture.
    pub(super) fn is_held(self) -> bool {
        self.held.is_some()
    }

    /// Whether it is larger than it fits.
    pub(super) fn enlarged(self) -> bool {
        self.scale > 1.0
    }

    /// Enlarged by `notches` of the wheel, or made smaller by as many
    /// below nothing; never smaller than it fits, where it is also back
    /// in the middle.
    #[must_use]
    pub(super) fn zoomed(mut self, notches: f32) -> Self {
        self.scale = (self.scale * NOTCH.powf(notches)).clamp(1.0, MOST);
        // Within a hair of fitting is fitting.
        if self.scale < 1.01 {
            self.scale = 1.0;
            self.offset = (0.0, 0.0);
        }
        self
    }

    /// As it fits, in the middle.
    #[must_use]
    pub(super) fn reset(self) -> Self {
        Self {
            of: self.of,
            ..Self::default()
        }
    }

    /// The button went down on the picture at `at`.
    #[must_use]
    pub(super) fn held_at(mut self, at: (f32, f32)) -> Self {
        self.held = Some(at);
        self.moved = false;
        self
    }

    /// The pointer is at `at`: with the button held on an enlarged
    /// picture, the picture goes with it.
    #[must_use]
    pub(super) fn dragged_to(self, at: (f32, f32)) -> Self {
        let enlarged = self.enlarged();
        self.followed_to(at, enlarged)
    }

    /// The same for a picture larger than its room at any scale (a shared
    /// screen shown pixel for pixel): it goes with the pointer.
    #[must_use]
    pub(super) fn panned_to(self, at: (f32, f32)) -> Self {
        self.followed_to(at, true)
    }

    fn followed_to(mut self, at: (f32, f32), moves: bool) -> Self {
        let Some(from) = self.held else {
            return self;
        };
        let by = (at.0 - from.0, at.1 - from.1);
        if by == (0.0, 0.0) {
            return self;
        }
        self.held = Some(at);
        self.moved = true;
        if moves {
            self = self.moved_by(by);
        }
        self
    }

    /// Moved `by`, as the wheel and the arrow keys move it.
    #[must_use]
    pub(super) fn moved_by(mut self, by: (f32, f32)) -> Self {
        self.offset = (self.offset.0 + by.0, self.offset.1 + by.1);
        self
    }

    /// The button came up. Says whether that was a click: the picture was
    /// held and not moved.
    pub(super) fn released(&mut self) -> bool {
        let clicked = self.held.take().is_some() && !self.moved;
        self.moved = false;
        clicked
    }

    /// What a click on the picture does: enlarges one that fits, and puts
    /// an enlarged one back.
    #[must_use]
    pub(super) fn clicked(self) -> Self {
        if self.enlarged() {
            self.reset()
        } else {
            Self {
                scale: CLICKED,
                ..self
            }
        }
    }

    /// Kept where some of it can be seen: a picture `fitted` large in a
    /// room of `room` is moved no further than leaves its middle inside.
    #[must_use]
    pub(super) fn kept_in(mut self, fitted: (f32, f32), room: (f32, f32)) -> Self {
        let reach = |fitted: f32, room: f32| ((fitted * self.scale - room) / 2.0).max(0.0);
        let (across, down) = (reach(fitted.0, room.0), reach(fitted.1, room.1));
        self.offset = (
            self.offset.0.clamp(-across, across),
            self.offset.1.clamp(-down, down),
        );
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_is_enlarged_by_the_notch_and_never_made_smaller_than_it_fits() {
        let view = View::default();
        assert!(!view.enlarged());
        let once = view.zoomed(1.0);
        assert!((once.scale() - 1.2).abs() < 1e-5);
        assert!(once.enlarged());
        // Back by as much is back to fitting, in the middle.
        let back = once
            .held_at((0.0, 0.0))
            .dragged_to((30.0, 10.0))
            .zoomed(-1.0);
        assert!(!back.enlarged());
        assert_eq!(back.offset(), (0.0, 0.0));
        assert!(!view.zoomed(-5.0).enlarged(), "never smaller than it fits");
        assert!(
            (view.zoomed(100.0).scale() - 8.0).abs() < 1e-5,
            "nor past the most"
        );
    }

    #[test]
    fn a_held_picture_goes_with_the_pointer_only_while_it_is_enlarged() {
        // One that fits stays where it is, and the press still was no click.
        let mut fits = View::default()
            .held_at((10.0, 10.0))
            .dragged_to((40.0, 10.0));
        assert_eq!(fits.offset(), (0.0, 0.0));
        assert!(!fits.released());
        let mut large = View::default()
            .zoomed(2.0)
            .held_at((10.0, 10.0))
            .dragged_to((40.0, 25.0))
            .dragged_to((45.0, 25.0));
        assert_eq!(large.offset(), (35.0, 15.0));
        assert!(!large.released(), "moved, so not a click");
        // Let go: the pointer moving does nothing.
        assert_eq!(large.dragged_to((100.0, 100.0)).offset(), (35.0, 15.0));
        // Held and let go where it was is a click.
        let mut still = View::default().held_at((5.0, 5.0)).dragged_to((5.0, 5.0));
        assert!(still.released());
        assert!(!still.released(), "once");
    }

    #[test]
    fn a_click_enlarges_what_fits_and_puts_back_what_is_enlarged() {
        let clicked = View::default().clicked();
        assert!((clicked.scale() - 2.0).abs() < 1e-5);
        assert!(!clicked.clicked().enlarged());
    }

    #[test]
    fn an_enlarged_picture_cannot_be_moved_out_of_sight() {
        // 400 wide at twice its size in a room of 600: 100 hangs over each
        // side, and that is how far it goes. It is not taller than the room.
        let view = View::default()
            .clicked()
            .held_at((0.0, 0.0))
            .dragged_to((500.0, -500.0))
            .kept_in((400.0, 200.0), (600.0, 500.0));
        assert_eq!(view.offset(), (100.0, 0.0));
    }

    #[test]
    fn a_picture_larger_than_its_room_pans_at_any_scale_and_stays_in_sight() {
        // A share of 1920 by 1080 pixel for pixel in a room of 800 by 600.
        let mut view = View::default()
            .held_at((100.0, 100.0))
            .panned_to((60.0, 90.0))
            .kept_in((1920.0, 1080.0), (800.0, 600.0));
        assert_eq!(view.offset(), (-40.0, -10.0));
        assert!(!view.released(), "moved, so not a click");
        let far = view.moved_by((-5000.0, 5000.0)).kept_in((1920.0, 1080.0), (800.0, 600.0));
        assert_eq!(far.offset(), (-560.0, 240.0), "no further than its edges");
        // Smaller than its room: it stays in the middle.
        assert_eq!(
            View::default().moved_by((30.0, 30.0)).kept_in((640.0, 360.0), (800.0, 600.0)).offset(),
            (0.0, 0.0)
        );
    }

    #[test]
    fn another_picture_starts_as_it_fits() {
        let first = View::of(View::default(), 7).zoomed(3.0);
        assert!(
            View::of(first, 7).enlarged(),
            "the same picture keeps its view"
        );
        assert!(!View::of(first, 8).enlarged());
    }
}
