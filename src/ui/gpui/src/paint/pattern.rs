//! The patterned layer a theme may lay over its conversation: a lattice of
//! dots (Nimbus) or scanlines (Midnight Pretenders).
//!
//! The gradients under it are drawn once into a small picture and
//! stretched, which would smear a pattern into a tint. A pattern is drawn
//! instead, every frame: each line as one quad, the dots as one path of
//! small polygons, built once for the box they fill and kept while it does
//! not change (a thousand quads cost a frame more than a millisecond).

use std::cell::RefCell;

use gpui::{Bounds, Hsla, Path, Pixels, Point, Window, point, px, size};

use crate::theme::parse_color;

/// One patterned layer.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Pattern {
    /// A dot of `color` and `radius` in the middle of every `spacing` square:
    /// `radial-gradient(<color> <radius>px, transparent ...) 0 0/<w>px <h>px`.
    Dots {
        color: Hsla,
        radius: f32,
        spacing: (f32, f32),
    },
    /// A line of `color`, `thickness` tall, every `period` down:
    /// `repeating-linear-gradient(0deg, <color> 0px, <color> <t>px, transparent <t>px, transparent <p>px)`.
    Lines {
        color: Hsla,
        thickness: f32,
        period: f32,
    },
}

impl Pattern {
    /// The first patterned layer of a CSS `background` stack, if it has one.
    pub(crate) fn find(css: &str) -> Option<Self> {
        super::split_top_level(css).find_map(|layer| dots(layer).or_else(|| lines(layer)))
    }

    /// Paint what of this pattern falls inside `bounds`.
    pub(crate) fn paint(self, bounds: Bounds<Pixels>, window: &mut Window) {
        let (left, top) = (f32::from(bounds.origin.x), f32::from(bounds.origin.y));
        let (width, height) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        match self {
            Self::Dots {
                color,
                radius,
                spacing: (across, down),
            } => {
                if across < 1.0 || down < 1.0 || radius <= 0.0 {
                    return;
                }
                let key = [left, top, width, height, radius, across, down].map(f32::to_bits);
                let lattice = LATTICE.with_borrow_mut(|kept| match kept {
                    Some(known) if known.from == key => known.lattice.clone(),
                    _ => {
                        let lattice = lattice(bounds, radius, (across, down));
                        *kept = Some(Kept {
                            from: key,
                            lattice: lattice.clone(),
                        });
                        lattice
                    }
                });
                if let Some(lattice) = lattice {
                    window.paint_path(lattice, color);
                }
            }
            Self::Lines {
                color,
                thickness,
                period,
            } => {
                if period < 1.0 {
                    return;
                }
                // `0deg` runs from the bottom up, so the first line sits on
                // the foot of the box.
                let mut y = top + height - thickness;
                while y > top - thickness {
                    window.paint_quad(gpui::fill(
                        Bounds::new(point(px(left), px(y)), size(px(width), px(thickness))),
                        color,
                    ));
                    y -= period;
                }
            }
        }
    }
}

/// The dots last built, and the box, size and spacing they were built for.
#[derive(Debug)]
struct Kept {
    from: [u32; 7],
    lattice: Option<Path<Pixels>>,
}

thread_local! {
    static LATTICE: RefCell<Option<Kept>> = const { RefCell::new(None) };
}

/// How many sides a dot is drawn with: round at the size of a dot. A
/// hexagon strays at most an eighth of its radius from the circle, a fifth
/// of a pixel for Nimbus's 1.5px dots, under what anti-aliasing shows; it
/// is half the vertices of ten sides, which a frame copies and scales.
const SIDES: usize = 6;

/// A dot of `radius` in the middle of every `spacing` cell of `bounds`,
/// all in one path.
fn lattice(
    bounds: Bounds<Pixels>,
    radius: f32,
    (across, down): (f32, f32),
) -> Option<Path<Pixels>> {
    let (left, top) = (f32::from(bounds.origin.x), f32::from(bounds.origin.y));
    let (right, bottom) = (
        left + f32::from(bounds.size.width),
        top + f32::from(bounds.size.height),
    );
    let mut path: Option<Path<Pixels>> = None;
    let mut y = top + down / 2.0;
    while y - radius < bottom {
        let mut x = left + across / 2.0;
        while x - radius < right {
            let corners: Vec<Point<Pixels>> = (0..SIDES)
                .map(|side| {
                    #[expect(clippy::cast_precision_loss, reason = "six sides")]
                    let angle = std::f32::consts::TAU * side as f32 / SIDES as f32;
                    point(px(x + radius * angle.cos()), px(y + radius * angle.sin()))
                })
                .collect();
            let path = path.get_or_insert_with(|| Path::new(corners[0]));
            path.move_to(corners[0]);
            for corner in &corners[1..] {
                path.line_to(*corner);
            }
            x += across;
        }
        y += down;
    }
    path
}

/// `radial-gradient(<color> <r>px, transparent <r>px) <x> <y>/<w>px <h>px`.
fn dots(layer: &str) -> Option<Pattern> {
    let rest = layer.strip_prefix("radial-gradient(")?;
    let (inside, after) = rest.rsplit_once(')')?;
    let (_, tile) = after.split_once('/')?;
    let mut tile = tile.split_whitespace().map(pixels);
    let spacing = (tile.next()??, tile.next()??);
    let mut stops = super::split_top_level(inside);
    let (ink, radius) = stops.next()?.rsplit_once(' ')?;
    Some(Pattern::Dots {
        color: parse_color(ink)?.into(),
        radius: pixels(radius)?,
        spacing,
    })
}

/// `repeating-linear-gradient(0deg, <c> 0px, <c> <t>px, <clear> <t>px, <clear> <p>px)`.
fn lines(layer: &str) -> Option<Pattern> {
    let inside = layer
        .strip_prefix("repeating-linear-gradient(")?
        .strip_suffix(')')?;
    let mut parts = super::split_top_level(inside);
    if parts.next()? != "0deg" {
        return None;
    }
    let stops: Vec<(&str, f32)> = parts
        .map(|stop| {
            let (ink, at) = stop.rsplit_once(' ')?;
            Some((ink, pixels(at)?))
        })
        .collect::<Option<_>>()?;
    let [(ink, _), (_, thickness), _, (_, period)] = stops.as_slice() else {
        return None;
    };
    Some(Pattern::Lines {
        color: parse_color(ink)?.into(),
        thickness: *thickness,
        period: *period,
    })
}

fn pixels(css: &str) -> Option<f32> {
    css.trim().strip_suffix("px")?.parse().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_the_dot_lattice_of_a_backdrop() {
        let css = "radial-gradient(rgba(32,52,74,0.500) 1.5px, transparent 1.6px) 0 0/22px 22px,linear-gradient(165deg, #0f1a24 0%, #0a121a 100%)";
        let Some(Pattern::Dots {
            color,
            radius,
            spacing,
        }) = Pattern::find(css)
        else {
            panic!("a lattice");
        };
        assert_eq!((radius, spacing), (1.5, (22.0, 22.0)));
        assert!((color.a - 0.5).abs() < 1e-3);
    }

    #[test]
    fn finds_the_scanlines_of_a_backdrop() {
        let css = "repeating-linear-gradient(0deg, rgba(0,0,0,0.096) 0px, rgba(0,0,0,0.096) 1px, rgba(0,0,0,0.000) 1px, rgba(0,0,0,0.000) 3px),linear-gradient(#fff,#eee)";
        assert!(matches!(
            Pattern::find(css),
            Some(Pattern::Lines { thickness, period, .. }) if thickness == 1.0 && period == 3.0
        ));
    }

    #[test]
    fn a_plain_backdrop_has_no_pattern() {
        assert_eq!(
            Pattern::find(
                "linear-gradient(180deg,#000,#fff),radial-gradient(90% 80% at 100% 100%, #22273a 0%, rgba(34,39,58,0) 66%)"
            ),
            None
        );
        assert_eq!(Pattern::find(""), None);
    }
}
