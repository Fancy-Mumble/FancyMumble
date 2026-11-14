//! How a shared picture is laid in the stage (`fitMode.ts`): whole, filling
//! the stage, or pixel for pixel. Drawing goes by the same rectangle: a
//! stroke's points are fractions of where the picture is, not of the stage.

/// How the picture is laid in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Fit {
    /// Whole, as large as fits.
    #[default]
    Whole,
    /// Filling the stage, its edges cut.
    Fill,
    /// One pixel of it to one of the screen, in the middle.
    Actual,
}

impl Fit {
    pub(crate) const ALL: [Self; 3] = [Self::Whole, Self::Fill, Self::Actual];

    /// Its name on the stage's buttons and menu.
    pub(crate) fn name(self) -> gpui::SharedString {
        match self {
            Self::Whole => crate::words::t!("Fit"),
            Self::Fill => crate::words::t!("Fill"),
            Self::Actual => "1:1".into(),
        }
    }

    /// Where a picture `picture` (width, height) is laid in a stage `room`,
    /// both in the same units, the picture's in device pixels when `scale`
    /// turns them into the room's: `(x, y, width, height)` from the room's
    /// top left. It may reach outside the room.
    pub(crate) fn place(self, picture: (f32, f32), room: (f32, f32), scale: f32) -> Rect {
        if picture.0 <= 0.0 || picture.1 <= 0.0 {
            return Rect::new(0.0, 0.0, room.0, room.1);
        }
        let (across, down) = (room.0 / picture.0, room.1 / picture.1);
        let by = match self {
            Self::Whole => across.min(down),
            Self::Fill => across.max(down),
            Self::Actual => 1.0 / scale.max(0.1),
        };
        let (width, height) = (picture.0 * by, picture.1 * by);
        Rect::new((room.0 - width) / 2.0, (room.1 - height) / 2.0, width, height)
    }
}

/// A rectangle, from the stage's top left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Rect {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

impl Rect {
    pub(crate) fn new(x: f32, y: f32, width: f32, height: f32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// Where `at` (from the stage's top left) is on the picture, 0 to 1 each
    /// way; `None` when it is off the picture.
    pub(crate) fn fraction(&self, at: (f32, f32)) -> Option<(f32, f32)> {
        let inside = at.0 >= self.x
            && at.1 >= self.y
            && at.0 <= self.x + self.width
            && at.1 <= self.y + self.height;
        inside.then(|| self.clamped(at))
    }

    /// The same, held to the picture's edge.
    pub(crate) fn clamped(&self, at: (f32, f32)) -> (f32, f32) {
        (
            ((at.0 - self.x) / self.width.max(1.0)).clamp(0.0, 1.0),
            ((at.1 - self.y) / self.height.max(1.0)).clamp(0.0, 1.0),
        )
    }

    /// Where a fraction of the picture is, from the stage's top left.
    pub(crate) fn point(&self, fraction: (f32, f32)) -> (f32, f32) {
        (
            self.x + fraction.0 * self.width,
            self.y + fraction.1 * self.height,
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_wide_picture_fits_across_fills_down_and_stands_as_it_is_at_one_to_one() {
        let (picture, room) = ((1920.0, 1080.0), (800.0, 600.0));
        assert_eq!(
            Fit::Whole.place(picture, room, 1.0),
            Rect::new(0.0, 75.0, 800.0, 450.0)
        );
        let filled = Fit::Fill.place(picture, room, 1.0);
        assert!((filled.height - 600.0).abs() < 1e-3);
        assert!((filled.x + (filled.width - 800.0) / 2.0).abs() < 1e-3);
        // Two device pixels to one: 1920 of them are 960 of the stage's.
        assert_eq!(
            Fit::Actual.place(picture, room, 2.0),
            Rect::new(-80.0, 30.0, 960.0, 540.0)
        );
        assert_eq!(
            Fit::Whole.place((0.0, 0.0), room, 1.0),
            Rect::new(0.0, 0.0, 800.0, 600.0)
        );
    }

    #[test]
    fn a_point_is_a_fraction_of_the_picture_and_back() {
        let laid = Rect::new(0.0, 75.0, 800.0, 450.0);
        assert_eq!(laid.fraction((400.0, 300.0)), Some((0.5, 0.5)));
        assert_eq!(laid.fraction((400.0, 50.0)), None, "on the bar above it");
        assert_eq!(laid.clamped((900.0, 50.0)), (1.0, 0.0));
        assert_eq!(laid.point((0.25, 1.0)), (200.0, 525.0));
    }
}
