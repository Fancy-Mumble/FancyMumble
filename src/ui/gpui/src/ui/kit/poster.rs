//! The pieces a link's poster is made of, as the web client's
//! `LinkPreviewCard` draws them: the source chip, the title, the lines
//! under it, the playing time, the action pill, a listing's price, and
//! the grounds and scrims under them.
//!
//! A poster is artwork with words over it, so it keeps its own inks in
//! light and dark alike: white ink over a dark scrim, as the web's does.
//! The grounds and scrims are the web's CSS, drawn by `crate::paint`.

use std::sync::{Arc, LazyLock};

use gpui::{
    AnyElement, Div, FontWeight, Hsla, IntoElement, ParentElement, Path, PathBuilder, Pixels,
    Point, SharedString, Styled, canvas, div, prelude::*, px, rgba,
};

use crate::paint::Paint;
use crate::theme::Cut;

/// The widest a poster is drawn.
pub(crate) const BAND: f32 = 460.0;
/// A full poster with no picture to take its shape from.
pub(crate) const FULL_H: f32 = 200.0;
/// Tall art, contained.
pub(crate) const TALL_H: f32 = 290.0;
/// The side-thumb row, with a picture and without one.
pub(crate) const ROW_H: f32 = 112.0;
pub(crate) const BARE_H: f32 = 88.0;
/// A listing.
pub(crate) const SHOP_H: f32 = 196.0;
/// The picture in a side-thumb row.
pub(crate) const THUMB: (f32, f32) = (124.0, 88.0);
/// The inset of anything printed on a poster.
pub(crate) const PAD: f32 = 13.0;
/// The inset on a bottom corner that is cut.
pub(crate) const CUT_PAD: f32 = 30.0;

/// What a poster stands on where nothing is drawn over it.
pub(crate) fn poster_ground() -> Hsla {
    rgba(0x0a0d_14ff).into()
}

/// The scrim under a chip or a badge: `rgba(8,11,18,.72)`.
fn chip_scrim() -> Hsla {
    rgba(0x080b_12b8).into()
}

fn white() -> Hsla {
    rgba(0xffff_ffff).into()
}

/// A paint kept for the life of the program: `backdrop` keeps its
/// pictures by the paint they were drawn from.
macro_rules! kept_paint {
    ($name:ident, $css:expr) => {
        pub(crate) static $name: LazyLock<Arc<Paint>> =
            LazyLock::new(|| Arc::new(Paint::parse($css)));
    };
}

kept_paint!(
    SCRIM,
    "linear-gradient(180deg,rgba(8,11,18,0) 34%,rgba(8,11,18,.45) 55%,rgba(8,11,18,.82) 78%,rgba(8,11,18,.97) 100%)"
);
kept_paint!(
    SCRIM_CONTAINED,
    "linear-gradient(180deg,rgba(8,11,18,.25) 0%,rgba(8,11,18,0) 26%,rgba(8,11,18,.5) 55%,rgba(8,11,18,.86) 80%,rgba(8,11,18,.97) 100%)"
);
kept_paint!(
    SCRIM_ACROSS,
    "linear-gradient(90deg,rgba(8,11,18,.55) 0%,rgba(8,11,18,.82) 42%,rgba(8,11,18,.90) 100%)"
);
kept_paint!(
    TINTED,
    "radial-gradient(120% 140% at 12% 0%, #33406b 0%, #151c2c 70%)"
);
kept_paint!(
    STAGE,
    "radial-gradient(120% 130% at 78% 8%, #2c3a5c 0%, #121828 68%)"
);

/// `paint`, filling its relative parent.
pub(crate) fn layer(paint: &Arc<Paint>) -> impl IntoElement + use<> {
    super::backdrop::backdrop(paint, gpui::transparent_black(), px(0.0))
}

/// A hue for a source, from its name: stable for a source, distinct
/// between sources, as the web's `hueOf`. In degrees.
pub(crate) fn hue_of(label: &str) -> f32 {
    let mut hash: u32 = 0;
    for character in label.chars() {
        hash = (hash * 31 + u32::from(character)) % 3600;
    }
    #[expect(clippy::cast_precision_loss, reason = "under 3600")]
    let tenths = hash as f32;
    tenths / 10.0
}

/// `hsl(hue 70% lightness)`.
pub(crate) fn mark_ink(hue: f32, lightness: f32) -> Hsla {
    gpui::hsla(hue / 360.0, 0.7, lightness, 1.0)
}

/// One letter, or two: the start of a source's first word.
pub(crate) fn monogram_of(label: &str) -> String {
    let first = label
        .split(|c: char| c.is_whitespace() || c == '.')
        .find(|word| !word.is_empty())
        .unwrap_or("?");
    first.chars().take(2).collect::<String>().to_uppercase()
}

/// Words in tracked capitals, the chip's ink.
fn chip_ink(words: impl Into<SharedString>) -> Div {
    div()
        .flex_none()
        .text_size(px(11.0))
        .line_height(px(17.05))
        .font_weight(FontWeight::BOLD)
        .letter_spacing(0.14)
        .text_color(white())
        .whitespace_nowrap()
        .child(words.into())
}

/// The source chip, top left: the site's icon, or a tile tinted from its
/// name, and where this goes, with what qualifies it after a dot.
pub(crate) fn source_chip(
    icon: Option<&Arc<gpui::Image>>,
    label: &str,
    note: Option<&str>,
) -> impl IntoElement + use<> {
    let mark = match icon {
        Some(icon) => gpui::img(crate::pictures::shown(icon, crate::pictures::Fit::Face))
            .flex_none()
            .size(px(14.0))
            .object_fit(gpui::ObjectFit::Contain)
            .into_any_element(),
        None => div()
            .flex_none()
            .size(px(13.0))
            .rounded(px(2.0))
            .bg(mark_ink(hue_of(label), 0.58))
            .into_any_element(),
    };
    // The room it may take: clear of the corner a cut may take.
    div()
        .absolute()
        .left(px(PAD))
        .right(px(CUT_PAD + 26.0 - PAD))
        .top(px(12.0))
        .flex()
        .child(
            div()
                .min_w_0()
                .overflow_hidden()
                .flex()
                .items_center()
                .gap(px(7.0))
                .px(px(8.0))
                .py(px(4.0))
                .bg(chip_scrim())
                .child(mark)
                .child(chip_ink(label.to_uppercase()))
                .when_some(note, |chip, note| {
                    chip.child(chip_ink("·").opacity(0.7))
                        .child(chip_ink(note.to_uppercase()))
                }),
        )
}

/// The playing time, top right.
pub(crate) fn duration_badge(clock: SharedString) -> impl IntoElement {
    div()
        .absolute()
        .right(px(PAD))
        .top(px(12.0))
        .px(px(7.0))
        .py(px(3.0))
        .text_size(px(11.5))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(white())
        .bg(chip_scrim())
        .child(clock)
}

/// The title of a poster: white, two lines at most.
pub(crate) fn title(words: SharedString, size: f32) -> Div {
    div()
        .text_size(px(size))
        .line_height(px(size * 1.2))
        .font_weight(FontWeight::SEMIBOLD)
        .text_color(white())
        .line_clamp(2)
        .child(words)
}

/// One line of facts, joined by dots; none for none.
pub(crate) fn fact_line(facts: &[SharedString]) -> Option<Div> {
    (!facts.is_empty()).then(|| {
        div()
            .text_size(px(12.5))
            .line_height(px(19.375))
            .text_color(rgba(0xeaf2_ffff))
            .truncate()
            .child(SharedString::from(
                facts
                    .iter()
                    .map(SharedString::as_ref)
                    .collect::<Vec<_>>()
                    .join(" · "),
            ))
    })
}

/// A line of context under a title, two lines at most.
pub(crate) fn sub(words: SharedString) -> Div {
    div()
        .text_size(px(12.0))
        .line_height(px(16.2))
        .text_color(rgba(0xdbe4_f2ff))
        .line_clamp(2)
        .child(words)
}

/// The quiet line a side-thumb row names its source in.
pub(crate) fn caps(icon: Option<&Arc<gpui::Image>>, label: &str) -> impl IntoElement + use<> {
    div()
        .min_w_0()
        .flex()
        .items_center()
        .gap(px(6.0))
        .when_some(icon, |line, icon| {
            line.child(
                gpui::img(crate::pictures::shown(icon, crate::pictures::Fit::Face))
                    .flex_none()
                    .size(px(13.0))
                    .object_fit(gpui::ObjectFit::Contain),
            )
        })
        .child(
            div()
                .min_w_0()
                .truncate()
                .text_size(px(11.0))
                .line_height(px(17.05))
                .font_weight(FontWeight::SEMIBOLD)
                .text_color(white())
                .child(SharedString::from(label.to_owned())),
        )
}

/// A monogram where a row has no picture: on a dark tile, in the source's
/// hue; or, on a listing's white tile, in ink.
pub(crate) fn monogram(label: &str, on_white: bool) -> impl IntoElement + use<> {
    let tile = div()
        .flex_none()
        .size(px(64.0))
        .flex()
        .items_center()
        .justify_center()
        .font_weight(FontWeight::BOLD)
        .child(SharedString::from(monogram_of(label)));
    if on_white {
        tile.bg(white())
            .text_size(px(15.0))
            .letter_spacing(0.04)
            .text_color(rgba(0x1b21_30ff))
    } else {
        tile.bg(rgba(0x080b_128c))
            .text_size(px(22.0))
            .text_color(mark_ink(hue_of(label), 0.62))
    }
}

/// The poster's own action: a square play block on the accent, if there
/// is something to play, and a white tag with the words.
pub(crate) fn action_pill(
    play: Option<(Hsla, Hsla, AnyElement)>,
    tag: AnyElement,
) -> impl IntoElement {
    div()
        .flex()
        .h(px(30.0))
        .gap(px(3.0))
        .when_some(play, |pill, (accent, on_accent, block)| {
            pill.child(
                div()
                    .size(px(30.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .bg(accent)
                    .text_color(on_accent)
                    .child(block),
            )
        })
        .child(tag)
}

/// The white tag of an action pill, cut at its trailing bottom corner.
pub(crate) fn action_tag(words: &str) -> Div {
    div()
        .relative()
        .h_full()
        .flex()
        .items_center()
        .px(px(11.0))
        .bg(white())
        .text_size(px(11.5))
        .font_weight(FontWeight::BOLD)
        .letter_spacing(0.1)
        .text_color(rgba(0x0f13_1cff))
        .child(SharedString::from(words.to_uppercase()))
}

/// A listing's headline: the price, what it was, and the saving.
pub(crate) fn price_line(
    now: SharedString,
    was: Option<SharedString>,
    off: Option<u32>,
    ok: Hsla,
) -> impl IntoElement {
    div()
        .flex()
        .items_end()
        .gap(px(9.0))
        .child(
            div()
                .text_size(px(26.0))
                .line_height(px(24.7))
                .font_weight(FontWeight::BOLD)
                .text_color(ok)
                .child(now),
        )
        .when_some(was, |line, was| {
            line.child(
                div()
                    .pb(px(2.0))
                    .text_size(px(13.0))
                    .text_color(rgba(0xc9d6_eaff))
                    .line_through()
                    .child(was),
            )
        })
        .when_some(off, |line, off| {
            line.child(
                div()
                    .mb(px(2.0))
                    .px(px(7.0))
                    .py(px(3.0))
                    .text_size(px(11.0))
                    .font_weight(FontWeight::BOLD)
                    .letter_spacing(0.1)
                    .text_color(rgba(0x0f13_1cff))
                    .bg(ok)
                    .child(SharedString::from(format!("\u{2212}{off}%"))),
            )
        })
}

/// How far the poster's own cut reaches into its trailing bottom corner.
pub(crate) const OWN_CUT_SIZE: f32 = 18.0;

/// What stands outside the poster's cut, painted in `behind`: how a poster
/// is cut, since a picture cannot be. Put it last among the children of a
/// relative parent.
///
/// The theme's own cut (`Some`) is a polygon, drawn as a path, as the
/// theme's other cut surfaces are. Where the theme cuts nothing the poster
/// still cuts its own corner, and that is a small picture of the corner
/// drawn once: a path would make the renderer keep a window-sized
/// multisampled texture for a theme that draws no other path.
pub(crate) fn outside(cut: Option<Cut>, behind: Hsla) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| match cut {
            Some(cut) => {
                if let Some(path) = complement(&cut.points(bounds), bounds) {
                    window.paint_path(path, behind);
                }
            }
            None => {
                let size = px(OWN_CUT_SIZE);
                let corner = gpui::Bounds::new(
                    gpui::point(
                        bounds.origin.x + bounds.size.width - size,
                        bounds.origin.y + bounds.size.height - size,
                    ),
                    gpui::size(size, size),
                );
                let image = corner_picture(behind, window.scale_factor());
                let _ = window.paint_image(corner, corner, gpui::Corners::default(), image, 0, false);
            }
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}

/// The trailing bottom corner a poster cuts away, in `color`, for a screen
/// of `scale`: the triangle below the diagonal from its top right to its
/// bottom left, its edge smoothed. Drawn once for each colour and scale.
fn corner_picture(color: Hsla, scale: f32) -> Arc<gpui::RenderImage> {
    type Key = (u32, u32);
    static DRAWN: LazyLock<std::sync::Mutex<Vec<(Key, Arc<gpui::RenderImage>)>>> =
        LazyLock::new(std::sync::Mutex::default);
    let rgba = color.to_rgb();
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a colour's channels and a screen's scale, both small"
    )]
    let key = (
        u32::from_be_bytes([rgba.r, rgba.g, rgba.b, rgba.a].map(|c| (c * 255.0).round() as u8)),
        (scale * 100.0).round() as u32,
    );
    let mut drawn = DRAWN.lock().unwrap_or_else(std::sync::PoisonError::into_inner);
    if let Some((_, image)) = drawn.iter().find(|(at, _)| *at == key) {
        return Arc::clone(image);
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "eighteen pixels at a screen's scale"
    )]
    let side = (OWN_CUT_SIZE * scale).ceil().max(1.0) as u32;
    let mut pixels = Vec::with_capacity((side * side * 4) as usize);
    for y in 0..side {
        for x in 0..side {
            // How much of this pixel lies below the diagonal x + y = side,
            // found by sampling it four by four.
            let mut inside = 0u32;
            for sy in 0..4u32 {
                for sx in 0..4u32 {
                    #[expect(clippy::cast_precision_loss, reason = "a few pixels")]
                    let (px, py) = (
                        x as f32 + (sx as f32 + 0.5) / 4.0,
                        y as f32 + (sy as f32 + 0.5) / 4.0,
                    );
                    #[expect(clippy::cast_precision_loss, reason = "a few pixels")]
                    if px + py >= side as f32 {
                        inside += 1;
                    }
                }
            }
            #[expect(clippy::cast_precision_loss, reason = "sixteen samples")]
            let alpha = rgba.a * inside as f32 / 16.0;
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "a channel between 0 and 255"
            )]
            let byte = |channel: f32| (channel * alpha * 255.0).round() as u8;
            // The renderer's pictures are BGRA, premultiplied.
            pixels.extend([byte(rgba.b), byte(rgba.g), byte(rgba.r), byte(1.0)]);
        }
    }
    let image = Arc::new(gpui::RenderImage::new(vec![image::Frame::new(
        image::RgbaImage::from_raw(side, side, pixels).unwrap_or_default(),
    )]));
    drawn.push((key, Arc::clone(&image)));
    image
}

/// The box `bounds` with the polygon through `corners` taken out of it:
/// each corner of the box the polygon does not reach, as a fan back to
/// the polygon.
fn complement(corners: &[Point<Pixels>], bounds: gpui::Bounds<Pixels>) -> Option<Path<Pixels>> {
    let mut path = PathBuilder::fill();
    let mut any = false;
    for corner in [
        bounds.origin,
        bounds.top_right(),
        bounds.bottom_right(),
        bounds.bottom_left(),
    ] {
        if corners.iter().any(|at| near(*at, corner)) {
            continue;
        }
        // The two corners of the polygon nearest this one, on its two sides.
        let on_x = corners
            .iter()
            .filter(|at| (at.x - corner.x).abs() < px(0.5))
            .min_by(|a, b| {
                (a.y - corner.y)
                    .abs()
                    .partial_cmp(&(b.y - corner.y).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        let on_y = corners
            .iter()
            .filter(|at| (at.y - corner.y).abs() < px(0.5))
            .min_by(|a, b| {
                (a.x - corner.x)
                    .abs()
                    .partial_cmp(&(b.x - corner.x).abs())
                    .unwrap_or(std::cmp::Ordering::Equal)
            });
        if let (Some(along_x), Some(along_y)) = (on_x, on_y) {
            path.add_polygon(&[corner, *along_x, *along_y], true);
            any = true;
        }
    }
    if !any {
        return None;
    }
    path.build().ok()
}

fn near(one: Point<Pixels>, other: Point<Pixels>) -> bool {
    (one.x - other.x).abs() < px(0.5) && (one.y - other.y).abs() < px(0.5)
}

#[cfg(test)]
mod tests {
    use gpui::{Bounds, point, size};

    use super::*;

    #[test]
    fn a_source_has_its_own_hue_and_monogram() {
        assert_eq!(hue_of("reddit.com"), hue_of("reddit.com"));
        assert_ne!(hue_of("reddit.com"), hue_of("example.org"));
        assert!((0.0..360.0).contains(&hue_of("reddit.com")));
        assert_eq!(monogram_of("docs.example.org"), "DO");
        assert_eq!(monogram_of("notes.example.org"), "NO");
        assert_eq!(monogram_of(""), "?");
    }

    #[test]
    fn the_cut_corner_is_what_is_painted_over() {
        let cut: Cut = "polygon(0 0,100% 0,100% calc(100% - 18px),calc(100% - 18px) 100%,0 100%)"
            .parse()
            .expect("a polygon");
        let bounds = Bounds::new(point(px(0.0), px(0.0)), size(px(460.0), px(240.0)));
        assert!(complement(&cut.points(bounds), bounds).is_some());
        let whole: Cut = "polygon(0 0,100% 0,100% 100%,0 100%)".parse().expect("a box");
        assert!(complement(&whole.points(bounds), bounds).is_none());
    }
}
