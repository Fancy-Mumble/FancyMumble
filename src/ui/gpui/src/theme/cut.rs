//! The silhouette a theme cuts a surface to, as the web UI writes it: a CSS
//! `polygon()` whose corners are placed by a share of the box and a number
//! of pixels (`calc(100% - 10px)`), so one shape serves a box of any size.
//!
//! Nimbus leans its controls by cutting a pixel count off two corners;
//! Midnight notches its panels. A theme that says `none` has no cut, and its
//! surfaces stay the rounded rectangles they always were.

use std::str::FromStr;

use gpui::{Bounds, Pixels, Point, point, px};

/// The most corners a cut may have: the window notch has eight.
const MOST: usize = 8;

/// Where along one side of a box a corner sits: a share of the side, and
/// pixels on top of that.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Along {
    share: f32,
    offset: f32,
}

impl Along {
    /// This place on a side that starts at `start` and is `length` long.
    fn on(self, start: f32, length: f32) -> f32 {
        start + self.share * length + self.offset
    }
}

/// One corner of a cut.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Corner {
    x: Along,
    y: Along,
}

/// A polygon placed relative to the box it cuts.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Cut {
    corners: [Corner; MOST],
    count: usize,
}

/// Why a value is not a cut: `none`, or something this reader does not take.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NotACut(String);

impl std::fmt::Display for NotACut {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "not a polygon this view can cut: {}", self.0)
    }
}

impl std::error::Error for NotACut {}

impl FromStr for Cut {
    type Err = NotACut;

    fn from_str(css: &str) -> Result<Self, Self::Err> {
        let refuse = || NotACut(css.to_owned());
        let body = css
            .trim()
            .strip_prefix("polygon(")
            .and_then(|rest| rest.strip_suffix(')'))
            .ok_or_else(refuse)?;
        let mut corners = [Corner::default(); MOST];
        let mut count = 0;
        for pair in split_outside(body, ',') {
            let mut parts = split_outside(pair, ' ');
            let (Some(x), Some(y), None) = (parts.next(), parts.next(), parts.next()) else {
                return Err(refuse());
            };
            let slot = corners.get_mut(count).ok_or_else(refuse)?;
            *slot = Corner {
                x: along(x).ok_or_else(refuse)?,
                y: along(y).ok_or_else(refuse)?,
            };
            count += 1;
        }
        if count < 3 {
            return Err(refuse());
        }
        Ok(Self { corners, count })
    }
}

impl Cut {
    /// The corners of this cut laid on `bounds`, in order.
    pub(crate) fn points(&self, bounds: Bounds<Pixels>) -> Vec<Point<Pixels>> {
        let (left, top) = (f32::from(bounds.origin.x), f32::from(bounds.origin.y));
        let (width, height) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        self.corners[..self.count]
            .iter()
            .map(|corner| point(px(corner.x.on(left, width)), px(corner.y.on(top, height))))
            .collect()
    }

    /// Whether `at` lies inside this cut laid on `bounds`: what the pointer
    /// would have to be over to be over the shape rather than its box. The
    /// view lets the box take the pointer (`ui::kit::shape`); this says how
    /// much of the box that is.
    #[cfg(test)]
    pub(crate) fn contains(&self, bounds: Bounds<Pixels>, at: Point<Pixels>) -> bool {
        let corners = self.points(bounds);
        let (x, y) = (f32::from(at.x), f32::from(at.y));
        let mut inside = false;
        let mut previous = corners.len() - 1;
        for (index, corner) in corners.iter().enumerate() {
            let (xi, yi) = (f32::from(corner.x), f32::from(corner.y));
            let (xj, yj) = (
                f32::from(corners[previous].x),
                f32::from(corners[previous].y),
            );
            if (yi > y) != (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi {
                inside = !inside;
            }
            previous = index;
        }
        inside
    }
}

/// The kinds of surface a theme shapes, as the web UI's skin names its cuts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Kind {
    /// A control: a field, a header's button, the send button, a plate of
    /// words (`clipPlate`).
    Plate,
    /// A channel row, and the bar down a selected one (`clipSelection`).
    Row,
    /// A message's bubble and the cards cut like one (`clipBubble`).
    Card,
}

/// The cut of each kind of surface; `None` leaves it a rectangle.
///
/// The window's own notch (`clipWindow`, Midnight Pretenders) is not among
/// them: the web UI cuts the window's corners away to the desktop, which a
/// window drawn opaque cannot do.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub(crate) struct Cuts {
    pub plate: Option<Cut>,
    pub row: Option<Cut>,
    pub card: Option<Cut>,
}

impl Cuts {
    /// What a surface of `kind` is cut to.
    pub(crate) fn of(&self, kind: Kind) -> Option<Cut> {
        match kind {
            Kind::Plate => self.plate,
            Kind::Row => self.row,
            Kind::Card => self.card,
        }
    }
}

/// `css` cut at each `separator` that is not inside brackets, empty pieces
/// left out.
fn split_outside(css: &str, separator: char) -> impl Iterator<Item = &str> {
    let mut depth = 0_usize;
    css.split(move |character| {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        character == separator && depth == 0
    })
    .map(str::trim)
    .filter(|part| !part.is_empty())
}

/// One coordinate: `0`, `10px`, `100%`, or `calc()` of those added and taken
/// away.
fn along(css: &str) -> Option<Along> {
    let inner = css
        .strip_prefix("calc(")
        .and_then(|rest| rest.strip_suffix(')'))
        .unwrap_or(css);
    let mut total = Along::default();
    let mut sign = 1.0;
    for word in inner.split_whitespace() {
        match word {
            "+" => sign = 1.0,
            "-" => sign = -1.0,
            term => {
                let part = term_of(term)?;
                total.share += sign * part.share;
                total.offset += sign * part.offset;
            }
        }
    }
    Some(total)
}

fn term_of(css: &str) -> Option<Along> {
    if let Some(percent) = css.strip_suffix('%') {
        let share = percent.parse::<f32>().ok()? / 100.0;
        return Some(Along { share, offset: 0.0 });
    }
    let offset = css.strip_suffix("px").unwrap_or(css).parse::<f32>().ok()?;
    Some(Along { share: 0.0, offset })
}

#[cfg(test)]
mod tests {
    use super::*;
    use gpui::size;

    /// Nimbus's control, leaning ten pixels.
    const PLATE: &str = "polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)";

    fn spot(x: f32, y: f32) -> Point<Pixels> {
        point(px(x), px(y))
    }

    fn box_at(x: f32, y: f32, width: f32, height: f32) -> Bounds<Pixels> {
        Bounds::new(spot(x, y), size(px(width), px(height)))
    }

    #[test]
    fn a_leaning_plate_is_laid_on_its_box() {
        let cut: Cut = PLATE.parse().expect("a polygon");
        let corners = cut.points(box_at(100.0, 50.0, 200.0, 40.0));
        assert_eq!(
            corners,
            [
                spot(110.0, 50.0),
                spot(300.0, 50.0),
                spot(290.0, 90.0),
                spot(100.0, 90.0)
            ]
        );
    }

    #[test]
    fn the_window_notch_takes_all_eight_corners() {
        let notch = "polygon(0 14px, 14px 0, calc(100% - 28px) 0, 100% 28px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 28px 100%, 0 calc(100% - 28px))";
        let cut: Cut = notch.parse().expect("a polygon");
        let corners = cut.points(box_at(0.0, 0.0, 1000.0, 500.0));
        assert_eq!(corners.len(), 8);
        assert_eq!(corners[3], spot(1000.0, 28.0));
        assert_eq!(corners[7], spot(0.0, 472.0));
    }

    #[test]
    fn none_and_nonsense_are_no_cut() {
        assert!("none".parse::<Cut>().is_err());
        assert!("polygon(0 0, 1px 1px)".parse::<Cut>().is_err());
        assert!("polygon(0 0, 10em 0, 0 10px)".parse::<Cut>().is_err());
        assert!(
            "polygon(0 0,1px 0,2px 0,3px 0,4px 0,5px 0,6px 0,7px 0,8px 0)"
                .parse::<Cut>()
                .is_err(),
            "more corners than a cut may have"
        );
    }

    #[test]
    fn the_cut_corners_are_outside_the_shape_and_its_middle_inside() {
        let cut: Cut = PLATE.parse().expect("a polygon");
        let plate = box_at(0.0, 0.0, 100.0, 30.0);
        // The box's top left and bottom right are what the lean cuts away.
        assert!(!cut.contains(plate, spot(2.0, 1.0)));
        assert!(!cut.contains(plate, spot(98.0, 29.0)));
        assert!(cut.contains(plate, spot(50.0, 15.0)));
        assert!(cut.contains(plate, spot(2.0, 29.0)));
        assert!(!cut.contains(plate, spot(120.0, 15.0)));
    }

    #[test]
    fn a_cut_inside_a_line_is_the_same_shape_a_line_smaller() {
        // How a stroke is drawn: the fill is the cut laid on the box inset by
        // the line, so the edge follows the lean on every side.
        let cut: Cut = PLATE.parse().expect("a polygon");
        let outer = box_at(0.0, 0.0, 100.0, 30.0);
        let inner = cut.points(box_at(2.0, 2.0, 96.0, 26.0));
        for corner in &inner {
            assert!(
                cut.contains(outer, *corner),
                "{corner:?} lies within the outer shape"
            );
        }
        assert_eq!(inner[0], spot(12.0, 2.0));
    }
}
