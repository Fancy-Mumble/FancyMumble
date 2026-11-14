//! The marks a drawn theme puts where no palette can: warning tape, rings,
//! a hollow wordmark, hatched and dashed rules, a lit core on the rail.
//!
//! Each is asked for by the theme (`theme::Marks`) and drawn here with
//! paths and quads, every frame it is on screen, from the theme's own
//! colours: nothing is drawn into a picture and kept, but a path is built
//! once for as long as its mark stays where it is (`super::built`). Where the theme asks
//! for a mark it does not draw, the function answers `None` and the view
//! has nothing to place.

use gpui::{
    AnyElement, Bounds, ContentMask, Hsla, IntoElement, ParentElement, PathBuilder, Pixels, Point,
    Styled, Window, canvas, div, point, prelude::*, px, size,
};

use super::built::{self, bits};
use super::lettering::{Ink, Lettering, OBLIQUE, Typeface};
use super::shape::polygon;
use crate::theme::{Ground, Halo, Ring, Stripes, Theme, Watermark};

/// How far an italic voice leans, in degrees, where its letters are drawn.
const ITALIC: f32 = 10.0;

/// The product's name, as a drawn skin prints it.
const WORDMARK: &str = "FANCY MUMBLE";

/// Paint `stripes` across `bounds` in `ink`: dashes running at the
/// stripes' angle, cut to the band. The phase is CSS's: the gradient line
/// runs through the band's middle and starts where it meets a corner.
pub(crate) fn paint_stripes(
    bounds: Bounds<Pixels>,
    stripes: Stripes,
    ink: Hsla,
    window: &mut Window,
) {
    let period = stripes.dash + stripes.gap;
    if period <= 0.0 || ink.a <= 0.0 {
        return;
    }
    let ink = Hsla {
        a: ink.a * stripes.opacity,
        ..ink
    };
    let Some(line) = GradientLine::new(bounds, stripes.angle) else {
        return;
    };
    let (top, bottom) = (f32::from(bounds.top()), f32::from(bounds.bottom()));
    let (left, right) = (f32::from(bounds.left()), f32::from(bounds.right()));
    // Every stripe that touches the band, from either end's furthest corner.
    let reach =
        [(left, top), (left, bottom), (right, top), (right, bottom)].map(|(x, y)| line.along(x, y));
    let first = (reach.iter().copied().fold(f32::MAX, f32::min) / period).floor();
    let last = (reach.iter().copied().fold(f32::MIN, f32::max) / period).ceil();
    let from = bits(&[
        left,
        top,
        right,
        bottom,
        stripes.angle,
        stripes.dash,
        period,
    ]);
    let paths = built::paths(&("stripes", from), || {
        let mut paths = Vec::new();
        let mut step = first;
        while step <= last {
            let (from, to) = (step * period, step * period + stripes.dash);
            let corners = [
                point(px(line.x_at(from, top)), px(top)),
                point(px(line.x_at(to, top)), px(top)),
                point(px(line.x_at(to, bottom)), px(bottom)),
                point(px(line.x_at(from, bottom)), px(bottom)),
            ];
            paths.extend(polygon(&corners));
            step += 1.0;
        }
        paths
    });
    window.with_content_mask(Some(ContentMask { bounds }), |window| {
        for path in paths.iter() {
            window.paint_path(path.clone(), ink);
        }
    });
}

/// A CSS gradient's line across a box: through its middle, at its angle,
/// starting where it meets a corner.
#[derive(Debug, Clone, Copy, PartialEq)]
struct GradientLine {
    centre: (f32, f32),
    /// The direction, with screen-down positive.
    direction: (f32, f32),
    length: f32,
}

impl GradientLine {
    /// The line at `angle` degrees across `bounds`; none for one that runs
    /// straight down, along which no stripe leans.
    fn new(bounds: Bounds<Pixels>, angle: f32) -> Option<Self> {
        let (sin, cos) = angle.to_radians().sin_cos();
        if sin.abs() < 1e-3 {
            return None;
        }
        let (width, height) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        let centre = bounds.center();
        Some(Self {
            centre: (f32::from(centre.x), f32::from(centre.y)),
            direction: (sin, -cos),
            length: (width * sin).abs() + (height * cos).abs(),
        })
    }

    /// How far along the line the screen point `(x, y)` lies.
    fn along(&self, x: f32, y: f32) -> f32 {
        (x - self.centre.0) * self.direction.0
            + (y - self.centre.1) * self.direction.1
            + self.length / 2.0
    }

    /// Where, across the screen at height `y`, the line is `along` far.
    fn x_at(&self, along: f32, y: f32) -> f32 {
        (along - self.length / 2.0 - (y - self.centre.1) * self.direction.1) / self.direction.0
            + self.centre.0
    }
}

/// A band of `stripes` filling its parent, in `ink`.
fn stripe_band(stripes: Stripes, ink: Hsla) -> impl IntoElement + use<> {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| paint_stripes(bounds, stripes, ink, window),
    )
    .size_full()
}

/// The warning tape across the top of the rail. Put it among the children
/// of the relative rail.
pub(crate) fn hazard(theme: &Theme) -> Option<AnyElement> {
    let stripes = theme.skin.marks.hazard?;
    Some(
        div()
            .debug_selector(|| "mark-hazard".to_owned())
            .absolute()
            .top(px(10.0))
            .left_0()
            .right_0()
            .h(px(stripes.height))
            .child(stripe_band(stripes, theme.c.accent2))
            .into_any_element(),
    )
}

/// The rail's expander as a drawn skin draws it: a faint full circle, an
/// open arc riding it, and a lit core. In the box of a 26px icon.
pub(crate) fn expander_ring(theme: &Theme) -> Option<AnyElement> {
    if !theme.skin.marks.expander_ring {
        return None;
    }
    let (track, core) = (theme.c.rail_dim, theme.c.accent2);
    Some(
        div()
            .debug_selector(|| "mark-expander".to_owned())
            .flex_none()
            .size(px(26.0))
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| paint_expander(bounds, track, core, window),
                )
                .size_full(),
            )
            .into_any_element(),
    )
}

fn paint_expander(bounds: Bounds<Pixels>, track: Hsla, core: Hsla, window: &mut Window) {
    let scale = f32::from(bounds.size.width) / 26.0;
    let centre = bounds.center();
    let stroke = 2.17 * scale;
    let faint = Hsla {
        a: track.a * 0.3,
        ..track
    };
    let from = bits(&[centre.x.into(), centre.y.into(), scale]);
    let parts = [
        built::paths(&("expander-circle", &from), || {
            stroke_arc(centre, 9.75 * scale, (0.0, 360.0), stroke, None)
                .into_iter()
                .collect()
        }),
        // The spinner's arc, three hundred degrees of the circle.
        built::paths(&("expander-arc", &from), || {
            stroke_arc(centre, 9.75 * scale, (-90.0, 210.0), stroke, None)
                .into_iter()
                .collect()
        }),
        built::paths(&("expander-core", &from), || {
            circle(centre, 4.5 * scale).into_iter().collect()
        }),
    ];
    for (paths, ink) in parts.iter().zip([faint, track, core]) {
        for path in paths.iter() {
            window.paint_path(path.clone(), ink);
        }
    }
}

/// The corners of a circle about `centre`, close enough to round at its size.
fn round(centre: Point<Pixels>, radius: f32, (from, to): (f32, f32)) -> Vec<Point<Pixels>> {
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a count of corners, a few hundred at most"
    )]
    let steps = ((radius * (to - from).abs().to_radians() / 3.0).ceil() as usize).clamp(12, 360);
    (0..=steps)
        .map(|step| {
            #[expect(clippy::cast_precision_loss, reason = "a few hundred steps")]
            let angle = (from + (to - from) * step as f32 / steps as f32).to_radians();
            centre + point(px(radius * angle.cos()), px(radius * angle.sin()))
        })
        .collect()
}

fn circle(centre: Point<Pixels>, radius: f32) -> Option<gpui::Path<Pixels>> {
    polygon(&round(centre, radius, (0.0, 360.0)))
}

/// An arc of a circle, `width` wide, from and to these degrees (clockwise
/// from three o'clock), dashed if `dashes` says how.
fn stroke_arc(
    centre: Point<Pixels>,
    radius: f32,
    span: (f32, f32),
    width: f32,
    dashes: Option<(f32, f32)>,
) -> Option<gpui::Path<Pixels>> {
    let mut path = PathBuilder::stroke(px(width));
    if let Some((dash, gap)) = dashes {
        path = path.dash_array(&[px(dash), px(gap)]);
    }
    let corners = round(centre, radius, span);
    path.add_polygon(&corners, (span.1 - span.0).abs() >= 360.0);
    path.build().ok()
}

/// The gold ellipse floated above a face `size` across, in its own glow,
/// brighter while its owner speaks. Placed against the face's box.
pub(crate) fn halo(halo: Halo, size: f32, talking: bool, theme: &Theme) -> AnyElement {
    let (width, height, lift) = halo.measures(size);
    let (gold, line) = (theme.c.accent2, f32::from(theme.skin.line_width));
    let faded = |alpha: f32| Hsla { a: alpha, ..gold };
    // The web UI's three: a close bloom, a wide one, and light inside.
    let (close, wide) = if talking { (0.95, 0.6) } else { (0.7, 0.36) };
    let glows = [(height * 0.5, faded(close)), (height * 1.7, faded(wide))];
    div()
        .debug_selector(|| "mark-halo".to_owned())
        .absolute()
        .top(px(-lift))
        .left(px((size - width) / 2.0))
        .w(px(width))
        .h(px(height))
        .child(
            canvas(
                |_, _, _| (),
                move |bounds, (), window, _| {
                    let corners = gpui::Corners::all(px(height / 2.0));
                    for (blur, color) in glows {
                        window.paint_drop_shadows(
                            bounds,
                            corners,
                            &[gpui::BoxShadow {
                                color,
                                offset: point(px(0.0), px(0.0)),
                                blur_radius: px(blur / 2.0),
                                spread_radius: px(0.0),
                                inset: false,
                            }],
                        );
                    }
                    let from = bits(&[
                        bounds.origin.x.into(),
                        bounds.origin.y.into(),
                        bounds.size.width.into(),
                        bounds.size.height.into(),
                        line,
                    ]);
                    let paths = built::paths(&("halo", from), || {
                        ellipse(bounds, line).into_iter().collect()
                    });
                    for path in paths.iter() {
                        window.paint_path(path.clone(), gold);
                    }
                },
            )
            .size_full(),
        )
        .into_any_element()
}

/// The ellipse filling `bounds`, outlined `line` wide inside them.
fn ellipse(bounds: Bounds<Pixels>, line: f32) -> Option<gpui::Path<Pixels>> {
    let centre = bounds.center();
    let (rx, ry) = (
        (f32::from(bounds.size.width) - line) / 2.0,
        (f32::from(bounds.size.height) - line) / 2.0,
    );
    // A circle as round as the ellipse's long side needs, squashed.
    let long = rx.max(ry).max(1.0);
    let corners: Vec<Point<Pixels>> = round(point(px(0.0), px(0.0)), long, (0.0, 360.0))
        .into_iter()
        .map(|on| centre + point(on.x * (rx / long), on.y * (ry / long)))
        .collect();
    let mut path = PathBuilder::stroke(px(line));
    path.add_polygon(&corners, true);
    path.build().ok()
}

/// The product's name down the rail, turned on its side.
pub(crate) fn rail_wordmark(theme: &Theme) -> Option<AnyElement> {
    if !theme.skin.marks.rail_wordmark {
        return None;
    }
    let voice = super::Role::Wordmark.voice(theme);
    let lettering = Lettering {
        typeface: Typeface::Bold,
        size: 10.0,
        slant: if voice.italic { ITALIC } else { 0.0 },
        track: voice.track,
        turned: true,
    };
    let (run, depth) = lettering.measure(WORDMARK);
    let ink = theme.c.rail_dim;
    Some(
        div()
            .debug_selector(|| "mark-wordmark".to_owned())
            .flex_none()
            .w(px(depth))
            .h(px(run))
            .child(
                canvas(
                    |_, _, _| (),
                    move |bounds, (), window, _| {
                        let corner = point(bounds.right(), bounds.top());
                        let _ = lettering.paint(WORDMARK, corner, Ink::Solid, ink, window);
                    },
                )
                .size_full(),
            )
            .into_any_element(),
    )
}

/// A dashed hairline that fills its parent's width: the rule a drawn
/// skin's section heading runs out to the edge.
pub(crate) fn dashes(dash: f32, gap: f32, ink: Hsla) -> impl IntoElement + use<> {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let (top, height) = (bounds.top(), bounds.size.height);
            let mut x = f32::from(bounds.left());
            let end = f32::from(bounds.right());
            window.with_content_mask(Some(ContentMask { bounds }), |window| {
                while x < end {
                    window.paint_quad(gpui::fill(
                        Bounds::new(point(px(x), top), size(px(dash), height)),
                        ink,
                    ));
                    x += dash + gap;
                }
            });
        },
    )
    .size_full()
}

/// What a drawn theme lays behind the conversation, over its gradient: the
/// theme's dots or lines, two rings in the far corner, the room's name
/// hollowed out low down, and the ground with its hatched rule. `None` for
/// a theme with none of them. Put it after the backdrop.
pub(crate) fn conversation_ground(theme: &Theme, name: &str) -> Option<AnyElement> {
    let marks = theme.skin.marks;
    let pattern = theme.c.pattern;
    if pattern.is_none()
        && marks.rings.iter().all(Option::is_none)
        && marks.watermark.is_none()
        && marks.ground.is_none()
    {
        return None;
    }
    let (line, tile) = (theme.c.line2, theme.c.tile);
    let words = poster_lines(name);
    let ground = canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            window.with_content_mask(Some(ContentMask { bounds }), |window| {
                if let Some(pattern) = pattern {
                    pattern.paint(bounds, window);
                }
                if let Some(ring) = marks.rings[0] {
                    paint_ring(bounds, ring, line, window);
                }
                if let Some(watermark) = marks.watermark {
                    paint_watermark(bounds, watermark, &words, line, window);
                }
                if let Some(ring) = marks.rings[1] {
                    paint_ring(bounds, ring, line, window);
                }
                if let Some(ground) = marks.ground {
                    paint_ground(bounds, ground, line, tile, window);
                }
            });
        },
    )
    .size_full();
    Some(
        div()
            .debug_selector(|| "mark-ground".to_owned())
            .absolute()
            .top_0()
            .left_0()
            .size_full()
            .child(ground)
            .into_any_element(),
    )
}

/// A room's name as a poster sets it: letters and digits only, in capitals,
/// broken into two lines at the middle word.
pub(crate) fn poster_lines(name: &str) -> Vec<String> {
    let cleaned: String = name
        .chars()
        .map(|letter| {
            if letter.is_alphanumeric() {
                letter
            } else {
                ' '
            }
        })
        .collect();
    let words: Vec<&str> = cleaned.split_whitespace().collect();
    if words.is_empty() {
        return Vec::new();
    }
    let half = words.len().div_ceil(2);
    [&words[..half], &words[half..]]
        .iter()
        .filter(|line| !line.is_empty())
        .map(|line| line.join(" ").to_uppercase())
        .collect()
}

fn paint_ring(bounds: Bounds<Pixels>, ring: Ring, ink: Hsla, window: &mut Window) {
    let radius = ring.diameter / 2.0;
    let centre = point(
        bounds.right() + px(-ring.right - radius),
        bounds.top() + px(ring.top + radius),
    );
    let ink = Hsla {
        a: ink.a * ring.opacity,
        ..ink
    };
    // The border is drawn inside the circle's box, so its middle runs half
    // a line in. A dashed border's dashes are three lines long, two apart,
    // as the browser draws them.
    let dashes = ring.dashed.then_some((ring.width * 3.0, ring.width * 2.0));
    let from = bits(&[centre.x.into(), centre.y.into(), radius, ring.width]);
    let paths = built::paths(&("ring", from, ring.dashed), || {
        stroke_arc(
            centre,
            radius - ring.width / 2.0,
            (0.0, 360.0),
            ring.width,
            dashes,
        )
        .into_iter()
        .collect()
    });
    for path in paths.iter() {
        window.paint_path(path.clone(), ink);
    }
}

fn paint_watermark(
    bounds: Bounds<Pixels>,
    mark: Watermark,
    lines: &[String],
    ink: Hsla,
    window: &mut Window,
) {
    let lettering = Lettering {
        typeface: Typeface::Poster {
            weight: mark.weight,
            width: mark.width,
        },
        size: mark.size,
        // A letter the poster face lacks comes from a face without its
        // italic, which the browser leans.
        slant: OBLIQUE,
        track: mark.track,
        turned: false,
    };
    // The name's box stands `right` in from the edge and is as wide as
    // what is left: a line longer than that breaks again, as text does.
    let room = f32::from(bounds.size.width) - mark.right;
    let lines: Vec<String> = lines
        .iter()
        .flat_map(|line| lettering.wrap(line, room))
        .collect();
    let leading = mark.size * mark.leading;
    // CSS centres each line's glyphs in its line box.
    let (_, depth) = lettering.measure("");
    let half_leading = (leading - depth) / 2.0;
    #[expect(clippy::cast_precision_loss, reason = "a few lines")]
    let mut top = f32::from(bounds.bottom()) - mark.bottom - leading * lines.len() as f32;
    let mut waiting = false;
    for line in &lines {
        let (run, _) = lettering.measure(line);
        let x = f32::from(bounds.right()) - mark.right - run;
        waiting |= lettering.paint(
            line,
            point(px(x), px(top + half_leading)),
            Ink::Hollow(mark.stroke),
            ink,
            window,
        );
        top += leading;
    }
    // Letters wait for the system's faces only the first time a run sets
    // one the bundled faces lack, for a few dozen milliseconds.
    if waiting {
        window.request_animation_frame();
    }
}

fn paint_ground(
    bounds: Bounds<Pixels>,
    ground: Ground,
    line: Hsla,
    tile: Hsla,
    window: &mut Window,
) {
    let fade = Bounds::new(
        point(bounds.left(), bounds.bottom() - px(ground.fade)),
        size(bounds.size.width, px(ground.fade)),
    );
    window.paint_quad(gpui::fill(
        fade,
        gpui::linear_gradient(
            180.0,
            gpui::linear_color_stop(Hsla { a: 0.0, ..tile }, 0.0),
            gpui::linear_color_stop(tile, 1.0),
        ),
    ));
    let rule = Bounds::new(
        point(
            bounds.left(),
            bounds.bottom() - px(ground.rule_bottom + ground.rule.height),
        ),
        size(bounds.size.width, px(ground.rule.height)),
    );
    paint_stripes(rule, ground.rule, line, window);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_is_set_as_a_poster_in_two_lines() {
        assert_eq!(poster_lines("lounge"), ["LOUNGE"]);
        assert_eq!(
            poster_lines("Magical rocks hangout"),
            ["MAGICAL ROCKS", "HANGOUT"]
        );
        assert_eq!(poster_lines("the #1 room!"), ["THE 1", "ROOM"]);
        assert!(poster_lines("  ~~ ").is_empty());
    }

    #[test]
    fn a_circle_is_round_enough_for_its_size() {
        let centre = point(px(0.0), px(0.0));
        let small = round(centre, 4.5, (0.0, 360.0));
        let large = round(centre, 380.0, (0.0, 360.0));
        assert!(small.len() >= 13);
        assert!(large.len() > small.len());
        for corner in &large {
            let distance = (f32::from(corner.x).powi(2) + f32::from(corner.y).powi(2)).sqrt();
            assert!((distance - 380.0).abs() < 0.01);
        }
    }

    #[test]
    fn stripes_are_placed_along_the_gradient_line() {
        let band = Bounds::new(point(px(0.0), px(0.0)), size(px(100.0), px(10.0)));
        // At ninety degrees the line runs left to right, from the left edge.
        let across = GradientLine::new(band, 90.0).expect("a line");
        assert!((across.along(0.0, 5.0)).abs() < 1e-3);
        assert!((across.along(100.0, 0.0) - 100.0).abs() < 1e-3);
        assert!((across.x_at(30.0, 7.0) - 30.0).abs() < 1e-3);
        // Leaning, a point and the place found for it agree.
        let leaning = GradientLine::new(band, 115.0).expect("a line");
        let along = leaning.along(40.0, 3.0);
        assert!((leaning.x_at(along, 3.0) - 40.0).abs() < 1e-3);
        assert!(GradientLine::new(band, 0.0).is_none());
    }
}
