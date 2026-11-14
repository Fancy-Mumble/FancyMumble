//! The patterned layer a theme may lay over its conversation: a lattice of
//! dots (Nimbus) or scanlines (Midnight Pretenders).
//!
//! The gradients under it are drawn once into a small picture and
//! stretched, which would smear a pattern into a tint. A pattern is drawn
//! instead, every frame, as the handful of small quads that cover what is in
//! view: each dot or line is one quad, and nothing is kept between frames.

use gpui::{Bounds, Hsla, Pixels, Window, point, px, size};

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
                if across < 1.0 || down < 1.0 {
                    return;
                }
                let side = px(radius * 2.0);
                let mut y = top + down / 2.0 - radius;
                while y < top + height {
                    let mut x = left + across / 2.0 - radius;
                    while x < left + width {
                        window.paint_quad(
                            gpui::fill(Bounds::new(point(px(x), px(y)), size(side, side)), color)
                                .corner_radii(px(radius)),
                        );
                        x += across;
                    }
                    y += down;
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
