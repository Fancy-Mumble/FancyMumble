//! The gradients a theme paints its window and its conversation with.
//!
//! The theme table carries them as the CSS the web UI hands a browser: a
//! stack of `radial-gradient()` and `linear-gradient()` layers. GPUI fills
//! with two-stop linear gradients only, so the stack is drawn here instead,
//! once, into a picture an eighth of the size it will cover, and that picture
//! is stretched. A gradient has no detail to lose to that, and the picture is
//! tens of kilobytes rather than the megabytes a full one would be.
//!
//! Two kinds of layer are left out, because they are detail and would smear:
//! `repeating-*` gradients (scanlines) and layers with a tile size (dots).

use std::sync::Arc;

use gpui::{RenderImage, Rgba};

use crate::theme::parse_color;

/// How much smaller than the area it covers the picture is, each way.
const SHRINK: f32 = 8.0;

/// A length as CSS writes one: of the box, or absolute.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Length {
    Percent(f32),
    Px(f32),
}

impl Length {
    fn of(self, whole: f32) -> f32 {
        match self {
            Self::Percent(percent) => whole * percent / 100.0,
            Self::Px(px) => px,
        }
    }
}

/// One colour stop: the colour, premultiplied, and where along the gradient
/// it sits (0 to 1), once every stop has been given a place.
#[derive(Debug, Clone, Copy, PartialEq)]
struct Stop {
    color: [f32; 4],
    at: f32,
}

#[derive(Debug, Clone, PartialEq)]
enum Shape {
    /// Along a line at this angle, in degrees clockwise from "to top".
    Linear(f32),
    /// An ellipse of these radii about this centre.
    Radial {
        radius: (Length, Length),
        centre: (Length, Length),
    },
}

#[derive(Debug, Clone, PartialEq)]
struct Layer {
    shape: Shape,
    stops: Vec<Stop>,
}

/// A stack of gradient layers, first on top, as CSS lists them.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Paint {
    layers: Vec<Layer>,
}

impl Paint {
    /// Read a CSS `background` value. Layers this module does not draw are
    /// dropped; a value with none it can draw is an empty paint.
    pub(crate) fn parse(css: &str) -> Self {
        Self {
            layers: split_top_level(css).filter_map(parse_layer).collect(),
        }
    }

    /// Whether there is nothing to draw.
    pub(crate) fn is_empty(&self) -> bool {
        self.layers.is_empty()
    }

    /// The colour at `(x, y)` in a box `width` by `height`, over `ground`.
    fn at(&self, x: f32, y: f32, width: f32, height: f32, ground: [f32; 4]) -> [f32; 4] {
        // Painted bottom layer first, each one over what is there.
        self.layers.iter().rev().fold(ground, |under, layer| {
            let top = layer.color_at(x, y, width, height);
            let keep = 1.0 - top[3];
            [
                top[0] + under[0] * keep,
                top[1] + under[1] * keep,
                top[2] + under[2] * keep,
                top[3] + under[3] * keep,
            ]
        })
    }

    /// The paint over `ground`, for an area `width` by `height`, as a picture
    /// to stretch over that area and one cell more on every side: see
    /// [`Picture::margin`]. `None` for an area with no size.
    ///
    /// The extra cell is what the renderer blends the picture's edge with
    /// when it stretches it. Without one it blends with whatever else is in
    /// its atlas, and the area gets a dark rim.
    pub(crate) fn picture(&self, width: f32, height: f32, ground: Rgba) -> Option<Picture> {
        if width < 1.0 || height < 1.0 {
            return None;
        }
        let columns = (width / SHRINK).ceil().max(1.0);
        let rows = (height / SHRINK).ceil().max(1.0);
        let cell = (width / columns, height / rows);
        let ground = [
            ground.r * ground.a,
            ground.g * ground.a,
            ground.b * ground.a,
            ground.a,
        ];
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "a window's size in eighths of a pixel, at least one"
        )]
        let (across, down) = (columns as u32 + 2, rows as u32 + 2);
        let mut pixels = Vec::with_capacity(across as usize * down as usize * 4);
        for row in 0..down {
            for column in 0..across {
                // The middle of the pixel, in the area's own coordinates:
                // the first row and column lie outside it.
                #[expect(clippy::cast_precision_loss, reason = "a pixel index")]
                let (x, y) = ((column as f32 - 0.5) * cell.0, (row as f32 - 0.5) * cell.1);
                let [red, green, blue, alpha] = self.at(x, y, width, height, ground);
                // The text system's pictures are BGRA, premultiplied.
                pixels.extend([blue, green, red, alpha].map(byte));
            }
        }
        let frame = image::Frame::new(image::RgbaImage::from_raw(across, down, pixels)?);
        Some(Picture {
            image: Arc::new(RenderImage::new(vec![frame])),
            margin: cell,
        })
    }
}

/// A paint drawn small, to be stretched.
#[derive(Debug, Clone)]
pub(crate) struct Picture {
    pub image: Arc<RenderImage>,
    /// How far past the area, each way, the picture is to be drawn: its
    /// outermost cells, which belong outside and are to be clipped off.
    pub margin: (f32, f32),
}

impl Layer {
    fn color_at(&self, x: f32, y: f32, width: f32, height: f32) -> [f32; 4] {
        let along = match self.shape {
            Shape::Linear(degrees) => {
                let (sin, cos) = degrees.to_radians().sin_cos();
                // The gradient line runs through the middle and is as long
                // as it takes for its ends to reach the corners.
                let length = (width * sin).abs() + (height * cos).abs();
                if length <= 0.0 {
                    return [0.0; 4];
                }
                let (dx, dy) = (x - width / 2.0, y - height / 2.0);
                (dx * sin - dy * cos) / length + 0.5
            }
            Shape::Radial { radius, centre } => {
                let (rx, ry) = (radius.0.of(width), radius.1.of(height));
                if rx <= 0.0 || ry <= 0.0 {
                    return [0.0; 4];
                }
                let (dx, dy) = (x - centre.0.of(width), y - centre.1.of(height));
                ((dx / rx).powi(2) + (dy / ry).powi(2)).sqrt()
            }
        };
        color_along(&self.stops, along)
    }
}

/// The colour `along` a list of stops, held at the ends.
fn color_along(stops: &[Stop], along: f32) -> [f32; 4] {
    let (Some(first), Some(last)) = (stops.first(), stops.last()) else {
        return [0.0; 4];
    };
    if along <= first.at {
        return first.color;
    }
    if along >= last.at {
        return last.color;
    }
    for pair in stops.windows(2) {
        let (from, to) = (pair[0], pair[1]);
        if along <= to.at {
            let span = to.at - from.at;
            let part = if span > 0.0 {
                (along - from.at) / span
            } else {
                1.0
            };
            return [0, 1, 2, 3].map(|channel| {
                from.color[channel] + (to.color[channel] - from.color[channel]) * part
            });
        }
    }
    last.color
}

#[expect(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    reason = "clamped to a byte first"
)]
fn byte(value: f32) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// `css` cut at the commas that are not inside brackets.
fn split_top_level(css: &str) -> impl Iterator<Item = &str> {
    let mut depth = 0_usize;
    css.split(move |character| {
        match character {
            '(' => depth += 1,
            ')' => depth = depth.saturating_sub(1),
            _ => {}
        }
        character == ',' && depth == 0
    })
    .map(str::trim)
    .filter(|part| !part.is_empty())
}

fn parse_layer(css: &str) -> Option<Layer> {
    let (name, rest) = css.split_once('(')?;
    let (inside, after) = rest.rsplit_once(')')?;
    // A position or tile size after the gradient makes it a pattern.
    if !after.trim().is_empty() {
        return None;
    }
    let mut parts = split_top_level(inside).peekable();
    let shape = match name.trim() {
        "linear-gradient" => {
            let angle = parts.peek().and_then(|first| first.strip_suffix("deg"));
            match angle.and_then(|degrees| degrees.trim().parse::<f32>().ok()) {
                Some(degrees) => {
                    let _ = parts.next();
                    Shape::Linear(degrees)
                }
                // No direction given: top to bottom.
                None => Shape::Linear(180.0),
            }
        }
        "radial-gradient" => parse_ellipse(parts.next()?)?,
        _ => return None,
    };
    let stops = place_stops(parts.map(parse_stop).collect::<Option<Vec<_>>>()?);
    (stops.len() >= 2).then_some(Layer { shape, stops })
}

/// `<rx> <ry> at <x> <y>`, the only form the table uses.
fn parse_ellipse(css: &str) -> Option<Shape> {
    let (size, place) = css.split_once(" at ")?;
    let mut size = size.split_whitespace().map(parse_length);
    let mut place = place.split_whitespace().map(parse_length);
    Some(Shape::Radial {
        radius: (size.next()??, size.next()??),
        centre: (place.next()??, place.next()??),
    })
}

fn parse_length(css: &str) -> Option<Length> {
    if let Some(percent) = css.strip_suffix('%') {
        return percent.parse().ok().map(Length::Percent);
    }
    css.strip_suffix("px")?.parse().ok().map(Length::Px)
}

/// A colour and, perhaps, where it sits.
fn parse_stop(css: &str) -> Option<([f32; 4], Option<f32>)> {
    let css = css.trim();
    // The place, if there is one, is what follows the last space outside
    // the colour's own brackets.
    let cut = css.rfind(')').map_or(0, |close| close + 1);
    let (color, place) = match css[cut..].trim() {
        "" => (css, None),
        tail if cut > 0 => (&css[..cut], Some(tail)),
        _ => match css.rsplit_once(' ') {
            Some((color, place)) => (color, Some(place)),
            None => (css, None),
        },
    };
    let color = if color.trim() == "transparent" {
        [0.0; 4]
    } else {
        let Rgba { r, g, b, a } = parse_color(color.trim())?;
        [r * a, g * a, b * a, a]
    };
    let at = match place {
        Some(place) => Some(place.trim().strip_suffix('%')?.parse::<f32>().ok()? / 100.0),
        None => None,
    };
    Some((color, at))
}

/// Give every stop a place, as CSS does: the first at the start and the last
/// at the end unless they say otherwise, the unplaced ones between two placed
/// ones spread evenly, and none before the one ahead of it.
fn place_stops(stops: Vec<([f32; 4], Option<f32>)>) -> Vec<Stop> {
    let count = stops.len();
    let mut places: Vec<Option<f32>> = stops.iter().map(|(_, at)| *at).collect();
    if let Some(first) = places.first_mut() {
        *first = first.or(Some(0.0));
    }
    if let Some(last) = places.last_mut() {
        *last = last.or(Some(1.0));
    }
    let mut from = 0;
    while from + 1 < count {
        let Some(to) = (from + 1..count).find(|&at| places[at].is_some()) else {
            break;
        };
        let (start, end) = (places[from].unwrap_or(0.0), places[to].unwrap_or(1.0));
        for (step, place) in places[from + 1..to].iter_mut().enumerate() {
            #[expect(clippy::cast_precision_loss, reason = "a handful of stops")]
            let part = (step + 1) as f32 / (to - from) as f32;
            *place = Some(start + (end - start) * part);
        }
        from = to;
    }
    let mut furthest = f32::MIN;
    stops
        .into_iter()
        .zip(places)
        .map(|((color, _), at)| {
            furthest = furthest.max(at.unwrap_or(furthest));
            Stop {
                color,
                at: furthest,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const WINDOW: &str = "radial-gradient(120% 90% at 10% 0%, #1c2647 0%, rgba(28,38,71,0) 62%), radial-gradient(90% 80% at 100% 100%, #22273a 0%, rgba(34,39,58,0) 66%), linear-gradient(160deg,#13161d,#0c0e13)";

    fn bytes(color: [f32; 4]) -> [u8; 4] {
        color.map(byte)
    }

    #[test]
    fn reads_the_layers_of_a_window() {
        let paint = Paint::parse(WINDOW);
        assert_eq!(paint.layers.len(), 3);
        assert_eq!(
            paint.layers[0].shape,
            Shape::Radial {
                radius: (Length::Percent(120.0), Length::Percent(90.0)),
                centre: (Length::Percent(10.0), Length::Percent(0.0)),
            }
        );
        assert_eq!(paint.layers[2].shape, Shape::Linear(160.0));
        assert!((paint.layers[0].stops[1].at - 0.62).abs() < 1e-6);
    }

    #[test]
    fn a_radial_layer_is_its_colour_at_the_centre_and_gone_past_its_edge() {
        let paint = Paint::parse(WINDOW);
        // The first ellipse is centred on (10%, 0%): its own colour there.
        assert_eq!(
            bytes(paint.at(100.0, 0.0, 1000.0, 500.0, [0.0; 4])),
            [28, 38, 71, 255]
        );
        // Far from both ellipses only the linear layer is left, and half
        // way along it lies between its two colours.
        let middle = bytes(paint.at(500.0, 250.0, 1000.0, 500.0, [0.0; 4]));
        assert!(middle[0] >= 12 && middle[0] <= 28, "{middle:?}");
        assert_eq!(middle[3], 255);
    }

    #[test]
    fn a_linear_layer_runs_from_its_first_colour_to_its_last() {
        let paint = Paint::parse("linear-gradient(180deg,#000000,#ffffff)");
        assert_eq!(bytes(paint.at(5.0, 0.0, 10.0, 100.0, [0.0; 4]))[0], 0);
        assert_eq!(bytes(paint.at(5.0, 100.0, 10.0, 100.0, [0.0; 4]))[0], 255);
        assert_eq!(bytes(paint.at(5.0, 50.0, 10.0, 100.0, [0.0; 4]))[0], 128);
        // With no angle it runs the same way.
        assert_eq!(Paint::parse("linear-gradient(#000,#fff)"), paint);
    }

    #[test]
    fn stops_without_a_place_are_spread_between_those_with_one() {
        let paint = Paint::parse(
            "linear-gradient(180deg, rgba(0,0,0,.5), rgba(8,12,22,.42) 45%, rgba(8,12,22,.56))",
        );
        let places: Vec<f32> = paint.layers[0].stops.iter().map(|stop| stop.at).collect();
        assert_eq!(places, [0.0, 0.45, 1.0]);
        let spread = Paint::parse("linear-gradient(90deg,#000,#111,#222,#333 90%)");
        let places: Vec<f32> = spread.layers[0].stops.iter().map(|stop| stop.at).collect();
        assert!((places[1] - 0.3).abs() < 1e-6 && (places[2] - 0.6).abs() < 1e-6);
    }

    #[test]
    fn a_translucent_layer_lets_the_one_under_it_through() {
        let paint = Paint::parse(
            "linear-gradient(180deg,rgba(255,255,255,.5),rgba(255,255,255,.5)),linear-gradient(#000,#000)",
        );
        assert_eq!(
            bytes(paint.at(1.0, 1.0, 10.0, 10.0, [0.0; 4])),
            [128, 128, 128, 255]
        );
        // `transparent` fades the colour beside it out rather than to black.
        let fade = Paint::parse("linear-gradient(90deg,#ffffff,transparent)");
        let half = fade.at(5.0, 1.0, 10.0, 10.0, [0.0; 4]);
        assert!((half[0] - 0.5).abs() < 0.01 && (half[3] - 0.5).abs() < 0.01);
    }

    #[test]
    fn patterns_are_left_out_and_nonsense_is_nothing() {
        let dots = Paint::parse(
            "radial-gradient(rgba(195,218,238,0.5) 1.5px, transparent 1.6px) 0 0/22px 22px,linear-gradient(165deg, #eef5fc 0%, #dceaf7 100%)",
        );
        assert_eq!(dots.layers.len(), 1);
        let lines = Paint::parse(
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.03) 0px, rgba(0,0,0,0) 3px),linear-gradient(#fff,#eee)",
        );
        assert_eq!(lines.layers.len(), 1);
        assert!(Paint::parse("none").is_empty());
        assert!(Paint::parse("").is_empty());
    }

    #[test]
    fn the_picture_is_an_eighth_of_the_area_and_opaque() {
        let paint = Paint::parse(WINDOW);
        let picture = paint
            .picture(1410.0, 758.0, Rgba::default())
            .expect("an area with a size");
        // An eighth each way, and a cell more all round.
        let size = picture.image.size(0);
        assert_eq!((size.width.0, size.height.0), (179, 97));
        assert!((picture.margin.0 - 1410.0 / 177.0).abs() < 1e-3);
        let pixels = picture.image.as_bytes(0).expect("one frame");
        assert!(pixels.chunks(4).all(|pixel| pixel[3] == 255));
        assert!(paint.picture(0.0, 10.0, Rgba::default()).is_none());
    }
}
