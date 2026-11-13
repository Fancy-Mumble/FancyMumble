//! A surface filled with one of the theme's gradient stacks.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{ContentMask, Hsla, IntoElement, Styled, canvas, px};

use crate::paint::{Paint, Picture};

/// The picture last painted, and what it was painted from.
#[derive(Debug)]
struct Baked {
    paint: Arc<Paint>,
    ground: Hsla,
    /// The area it was drawn for, in whole pixels.
    area: (i32, i32),
    picture: Picture,
}

/// A gradient backdrop that fills whatever it is laid under.
///
/// It keeps the picture it drew, and draws another only when the paint or
/// the area changes: a view holds one of these for each surface it backs,
/// and asks it for an [`element`](Self::element) every frame.
///
/// Translucent chrome goes over it as an ordinary background colour. The
/// renderer blends in the colours' own encoding, as a browser does, so a
/// theme's `rgba()` surfaces come out the shade the theme means.
#[derive(Debug, Clone, Default)]
pub(crate) struct Backdrop {
    baked: Rc<RefCell<Option<Baked>>>,
}

impl Backdrop {
    /// The backdrop as an element: absolutely placed, filling its parent,
    /// painted with `paint` over `ground`. Put it first among the children
    /// of a `relative()` parent.
    pub(crate) fn element(&self, paint: &Arc<Paint>, ground: Hsla) -> impl IntoElement + use<> {
        let baked = Rc::clone(&self.baked);
        let paint = Arc::clone(paint);
        canvas(
            |_, _, _| (),
            move |bounds, (), window, _| {
                if paint.is_empty() {
                    return;
                }
                let (width, height) = (f32::from(bounds.size.width), f32::from(bounds.size.height));
                #[expect(clippy::cast_possible_truncation, reason = "a length on screen")]
                let area = (width.round() as i32, height.round() as i32);
                let mut baked = baked.borrow_mut();
                let fresh = baked.as_ref().is_some_and(|baked| {
                    baked.area == area
                        && baked.ground == ground
                        && Arc::ptr_eq(&baked.paint, &paint)
                });
                if !fresh {
                    // The old picture would otherwise stay in the atlas for
                    // as long as the window lives.
                    if let Some(stale) = baked.take() {
                        let _ = window.drop_image(stale.picture.image);
                    }
                    *baked = paint
                        .picture(width, height, ground.into())
                        .map(|picture| Baked {
                            paint: Arc::clone(&paint),
                            ground,
                            area,
                            picture,
                        });
                }
                if let Some(baked) = baked.as_ref() {
                    // A cell past the surface each way, and clipped to it.
                    let (across, down) = baked.picture.margin;
                    let spread = bounds.extend(gpui::Edges {
                        top: px(down),
                        bottom: px(down),
                        left: px(across),
                        right: px(across),
                    });
                    let image = Arc::clone(&baked.picture.image);
                    window.with_content_mask(Some(ContentMask { bounds }), |window| {
                        let _ =
                            window.paint_image(spread, gpui::Corners::default(), image, 0, false);
                    });
                }
            },
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full()
    }
}
