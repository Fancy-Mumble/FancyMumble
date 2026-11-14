//! Where the player goes in a frame: over the stage drawn for it, and cut
//! where what the stage is drawn in cuts it.

use gpui::{Bounds, Pixels};

/// A rectangle in the window's device pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Rect {
    pub(crate) x: i32,
    pub(crate) y: i32,
    pub(crate) width: i32,
    pub(crate) height: i32,
}

impl Rect {
    /// `bounds` in device pixels, each edge rounded on its own: two
    /// rectangles that meet still meet.
    fn of(bounds: Bounds<Pixels>, scale: f32) -> Self {
        #[expect(
            clippy::cast_possible_truncation,
            reason = "a window is far smaller than i32"
        )]
        let edge = |at: Pixels| (f32::from(at) * scale).round() as i32;
        let (x, y) = (edge(bounds.left()), edge(bounds.top()));
        Self {
            x,
            y,
            width: edge(bounds.right()) - x,
            height: edge(bounds.bottom()) - y,
        }
    }

    fn is_empty(self) -> bool {
        self.width <= 0 || self.height <= 0
    }

    /// The part of this the other covers, or an empty one.
    fn intersect(self, other: Self) -> Self {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        Self {
            x,
            y,
            width: right - x,
            height: bottom - y,
        }
    }
}

/// Where the player's window is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Placement {
    /// Out of sight.
    #[default]
    Hidden,
    /// Over `frame`, of which only `shows` is seen, in the frame's own
    /// coordinates; `None` when all of it is.
    Shown { frame: Rect, shows: Option<Rect> },
}

impl Placement {
    /// Over `stage`, as far as `mask` lets it be seen, on a screen of
    /// `scale` device pixels to each of the window's.
    pub(crate) fn of(stage: Bounds<Pixels>, mask: Bounds<Pixels>, scale: f32) -> Self {
        let frame = Rect::of(stage, scale);
        let seen = frame.intersect(Rect::of(mask, scale));
        if frame.is_empty() || seen.is_empty() {
            return Self::Hidden;
        }
        let shows = (seen != frame).then_some(Rect {
            x: seen.x - frame.x,
            y: seen.y - frame.y,
            ..seen
        });
        Self::Shown { frame, shows }
    }

    /// Whether more than half of the window is seen.
    pub(crate) fn mostly_seen(self) -> bool {
        let area = |rect: Rect| i64::from(rect.width) * i64::from(rect.height);
        match self {
            Self::Hidden => false,
            Self::Shown { shows: None, .. } => true,
            Self::Shown {
                frame,
                shows: Some(seen),
            } => 2 * area(seen) > area(frame),
        }
    }
}

#[cfg(test)]
mod tests {
    use gpui::{point, px, size};

    use super::*;

    fn bounds(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
        Bounds::new(point(px(x), px(y)), size(px(width), px(height)))
    }

    const STAGE: (f32, f32, f32, f32) = (100.0, 200.0, 420.0, 236.0);

    fn stage() -> Bounds<Pixels> {
        bounds(STAGE.0, STAGE.1, STAGE.2, STAGE.3)
    }

    #[test]
    fn a_stage_in_full_view_is_covered_whole() {
        let placed = Placement::of(stage(), bounds(0.0, 0.0, 1000.0, 800.0), 1.0);
        let frame = Rect {
            x: 100,
            y: 200,
            width: 420,
            height: 236,
        };
        assert_eq!(placed, Placement::Shown { frame, shows: None });
    }

    #[test]
    fn device_pixels_are_what_the_window_is_placed_in() {
        let placed = Placement::of(
            bounds(100.25, 200.5, 420.0, 236.0),
            bounds(0.0, 0.0, 1000.0, 800.0),
            1.5,
        );
        let Placement::Shown { frame, shows } = placed else {
            panic!("shown")
        };
        // 150.375 to 780.375, 300.75 to 654.75.
        assert_eq!(
            (frame.x, frame.y, frame.width, frame.height),
            (150, 301, 630, 354)
        );
        assert_eq!(shows, None);
    }

    #[test]
    fn it_is_cut_where_the_conversation_ends() {
        // The conversation's view ends 100 pixels into the stage's top.
        let placed = Placement::of(stage(), bounds(0.0, 300.0, 1000.0, 400.0), 1.0);
        let Placement::Shown { frame, shows } = placed else {
            panic!("shown")
        };
        assert_eq!(frame.y, 200, "the window stays where the stage is");
        assert_eq!(
            shows,
            Some(Rect {
                x: 0,
                y: 100,
                width: 420,
                height: 136
            }),
            "only the part below the edge shows"
        );
        // And at the bottom.
        let placed = Placement::of(stage(), bounds(0.0, 0.0, 1000.0, 236.0), 1.0);
        let Placement::Shown { shows, .. } = placed else {
            panic!("shown")
        };
        assert_eq!(
            shows,
            Some(Rect {
                x: 0,
                y: 0,
                width: 420,
                height: 36
            })
        );
    }

    #[test]
    fn more_than_half_of_it_must_be_seen_to_start() {
        let view = |top: f32| bounds(0.0, top, 1000.0, 800.0);
        assert!(Placement::of(stage(), view(0.0), 1.0).mostly_seen());
        // 100 of 236 rows cut off: 136 seen.
        assert!(Placement::of(stage(), view(300.0), 1.0).mostly_seen());
        // 118 cut off: exactly half, not more.
        assert!(!Placement::of(stage(), view(318.0), 1.0).mostly_seen());
        assert!(!Placement::Hidden.mostly_seen());
    }

    #[test]
    fn out_of_view_it_is_hidden() {
        let view = bounds(0.0, 0.0, 1000.0, 800.0);
        let above = bounds(0.0, 500.0, 1000.0, 300.0);
        assert_eq!(Placement::of(stage(), above, 1.0), Placement::Hidden);
        let flat = bounds(100.0, 200.0, 420.0, 0.0);
        assert_eq!(Placement::of(flat, view, 1.0), Placement::Hidden);
    }
}
