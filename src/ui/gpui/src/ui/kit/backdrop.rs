//! A surface filled with one of the theme's gradient stacks.

use std::sync::Arc;

use gpui::{App, ContentMask, Global, Hsla, IntoElement, Pixels, Styled, Window, canvas, px};

use crate::paint::{Paint, Picture};

/// How many pictures are kept. The window, the conversation and a few
/// floating sheets are on screen at once; a resize or a theme change makes
/// new ones and lets the oldest go.
const KEPT: usize = 12;

/// A picture, and what it was painted from.
#[derive(Debug)]
struct Baked {
    paint: Arc<Paint>,
    ground: Hsla,
    /// The area it was drawn for, in whole pixels.
    area: (i32, i32),
    picture: Picture,
}

/// The pictures drawn so far, newest last.
#[derive(Debug, Default)]
struct Kept(Vec<Baked>);

impl Global for Kept {}

/// The picture of `paint` over `ground` for an area this size: the one
/// kept, or a new one, with the oldest let go of to make room.
fn picture(
    paint: &Arc<Paint>,
    ground: Hsla,
    (width, height): (f32, f32),
    window: &mut Window,
    cx: &mut App,
) -> Option<Picture> {
    #[expect(clippy::cast_possible_truncation, reason = "a length on screen")]
    let area = (width.round() as i32, height.round() as i32);
    let kept = &mut cx.default_global::<Kept>().0;
    let found = kept.iter().position(|baked| {
        baked.area == area && baked.ground == ground && Arc::ptr_eq(&baked.paint, paint)
    });
    if let Some(at) = found {
        // Used again: the last to be let go.
        let baked = kept.remove(at);
        let picture = baked.picture.clone();
        kept.push(baked);
        return Some(picture);
    }
    let picture = paint.picture(width, height, ground.into())?;
    if kept.len() >= KEPT {
        // It would otherwise stay in the atlas for as long as the window
        // lives.
        let _ = window.drop_image(kept.remove(0).picture.image);
    }
    kept.push(Baked {
        paint: Arc::clone(paint),
        ground,
        area,
        picture: picture.clone(),
    });
    Some(picture)
}

/// A gradient backdrop: absolutely placed, filling its parent, painted with
/// `paint` over `ground`, its corners rounded by `corner`. Put it first
/// among the children of a `relative()` parent.
///
/// The picture is drawn once for a size and kept. Translucent chrome goes
/// over it as an ordinary background colour: the renderer blends in the
/// colours' own encoding, as a browser does, so a theme's `rgba()` surfaces
/// come out the shade the theme means.
pub(crate) fn backdrop(
    paint: &Arc<Paint>,
    ground: Hsla,
    corner: Pixels,
) -> impl IntoElement + use<> {
    let paint = Arc::clone(paint);
    canvas(
        |_, _, _| (),
        move |bounds, (), window, cx| {
            if paint.is_empty() {
                return;
            }
            let size = (f32::from(bounds.size.width), f32::from(bounds.size.height));
            let Some(picture) = picture(&paint, ground, size, window, cx) else {
                return;
            };
            // A cell past the surface each way, and clipped to it.
            let (across, down) = picture.margin;
            let spread = bounds.extend(gpui::Edges {
                top: px(down),
                bottom: px(down),
                left: px(across),
                right: px(across),
            });
            if corner > px(0.0) {
                // Rounded: the picture itself is cut to the surface, which
                // costs it the cell of margin, and a dark hair at the edge
                // is hidden under the surface's own border.
                let _ =
                    window.paint_image(bounds, gpui::Corners::all(corner), picture.image, 0, false);
                return;
            }
            window.with_content_mask(Some(ContentMask { bounds }), |window| {
                let _ =
                    window.paint_image(spread, gpui::Corners::default(), picture.image, 0, false);
            });
        },
    )
    .absolute()
    .top_0()
    .left_0()
    .size_full()
}
