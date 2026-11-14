//! The picture behind the conversation, laid as the web UI lays it
//! (`ChatBackdrop`): covering the room, cut around the point the user
//! chose, a little larger than the room so a blurred edge never shows,
//! darkened as far as asked, and under a wash of the window's colour.

use std::sync::Arc;

use gpui::{
    App, Bounds, Hsla, IntoElement, ParentElement, Pixels, RenderOnce, Size, Styled, Window,
    canvas, div, prelude::*, px,
};

use crate::pictures::{Fit, shown};

/// How much larger than the room the picture is laid: the web UI's
/// `scale(1.08)`, which keeps a blurred picture's soft edge out of view.
const OVERSCAN: f32 = 1.08;

/// What the picture was last laid in, kept between frames: the room is
/// only known once it is laid out, and a picture's shape once it is read.
#[derive(Default)]
struct Laid {
    room: Option<Size<Pixels>>,
    shape: Option<(u64, (u32, u32))>,
}

/// The picture behind the conversation.
///
/// ```ignore
/// Wall::new(picture).focus(0.5, 0.2).blur(8).dim(0.5).wash(colour)
/// ```
#[derive(IntoElement)]
pub(crate) struct Wall {
    picture: Arc<gpui::Image>,
    focus: (f32, f32),
    blur: u8,
    dim: f32,
    wash: Hsla,
    /// Whether it is drawn small, on a tile: read at a tile's size, and
    /// laid exactly in its room.
    small: bool,
}

impl Wall {
    /// `picture`, centred, sharp, neither darkened nor washed.
    pub(crate) fn new(picture: Arc<gpui::Image>) -> Self {
        Self {
            picture,
            focus: (0.5, 0.5),
            blur: 0,
            dim: 0.0,
            wash: gpui::transparent_black(),
            small: false,
        }
    }

    /// Draw it small, on a tile, exactly covering it.
    pub(crate) fn tile(mut self) -> Self {
        self.small = true;
        self
    }

    /// Keep the point `x` across and `y` down, as shares of the picture,
    /// in the room where the room cuts the picture.
    pub(crate) fn focus(mut self, x: f32, y: f32) -> Self {
        self.focus = (x.clamp(0.0, 1.0), y.clamp(0.0, 1.0));
        self
    }

    /// Blur it this far, in pixels.
    pub(crate) fn blur(mut self, blur: u8) -> Self {
        self.blur = blur;
        self
    }

    /// Darken it this far, from not at all to black.
    pub(crate) fn dim(mut self, dim: f32) -> Self {
        self.dim = dim.clamp(0.0, 1.0);
        self
    }

    /// Lay this colour over it, as far as its alpha says.
    pub(crate) fn wash(mut self, wash: Hsla) -> Self {
        self.wash = wash;
        self
    }
}

/// Where a picture of `shape` is laid in a room of `room`: covering it,
/// the point `focus` kept where the room cuts the picture, then grown by
/// [`OVERSCAN`] about the room's middle. Left, top, width, height.
fn laid(room: Size<Pixels>, shape: (u32, u32), focus: (f32, f32), overscan: f32) -> Bounds<Pixels> {
    #[expect(clippy::cast_precision_loss, reason = "a picture's side")]
    let (width, height) = (shape.0.max(1) as f32, shape.1.max(1) as f32);
    let (room_width, room_height) = (f32::from(room.width), f32::from(room.height));
    let scale = (room_width / width).max(room_height / height);
    let (drawn_width, drawn_height) = (width * scale, height * scale);
    let left = (room_width - drawn_width) * focus.0;
    let top = (room_height - drawn_height) * focus.1;
    let grow = |at: f32, middle: f32| middle + (at - middle) * overscan;
    Bounds::new(
        gpui::point(
            px(grow(left, room_width / 2.0)),
            px(grow(top, room_height / 2.0)),
        ),
        gpui::size(px(drawn_width * overscan), px(drawn_height * overscan)),
    )
}

impl RenderOnce for Wall {
    fn render(self, window: &mut Window, cx: &mut App) -> impl IntoElement {
        let held = window.use_keyed_state("wall-laid", cx, |_, _| Laid::default());
        let id = self.picture.id();
        let known = held.read(cx);
        let shape = match known.shape {
            Some((of, shape)) if of == id => Some(shape),
            _ => {
                let shape = crate::picture::dimensions(self.picture.bytes());
                if let Some(shape) = shape {
                    held.update(cx, |laid, _| laid.shape = Some((id, shape)));
                }
                shape
            }
        };
        let room = held.read(cx).room;
        let (fit, overscan) = if self.small {
            (Fit::Tile, 1.0)
        } else {
            (Fit::Wall(self.blur), OVERSCAN)
        };
        let picture = gpui::img(shown(&self.picture, fit)).absolute();
        let picture = match room.zip(shape) {
            Some((room, shape)) => {
                let at = laid(room, shape, self.focus, overscan);
                picture
                    .left(at.origin.x)
                    .top(at.origin.y)
                    .w(at.size.width)
                    .h(at.size.height)
            }
            // Until the room is known: covering it, from the middle.
            None => picture
                .top_0()
                .left_0()
                .size_full()
                .object_fit(gpui::ObjectFit::Cover),
        };
        // The room, noted as it is laid out; a room that changed draws the
        // window again, so the picture follows it the next frame.
        let measure = canvas(
            move |bounds, window, cx| {
                let changed = held.update(cx, |laid, _| {
                    let changed = laid.room != Some(bounds.size);
                    laid.room = Some(bounds.size);
                    changed
                });
                if changed {
                    window.refresh();
                }
            },
            |_, (), _, _| {},
        )
        .absolute()
        .top_0()
        .left_0()
        .size_full();
        let mut dim = gpui::black();
        dim.a = self.dim;
        div()
            .debug_selector(|| "wall".to_owned())
            .absolute()
            .size_full()
            .top_0()
            .left_0()
            .overflow_hidden()
            .child(measure)
            .child(picture)
            .child(div().absolute().top_0().left_0().size_full().bg(dim))
            .child(div().absolute().top_0().left_0().size_full().bg(self.wash))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn room(width: f32, height: f32) -> Size<Pixels> {
        gpui::size(px(width), px(height))
    }

    #[test]
    fn a_picture_covers_its_room_around_its_focus_and_a_little_past_it() {
        // A square in a wide room: as wide as the room, cut top and bottom.
        let middle = laid(room(800.0, 400.0), (100, 100), (0.5, 0.5), OVERSCAN);
        assert!((f32::from(middle.size.width) - 800.0 * OVERSCAN).abs() < 0.01);
        assert!(
            (f32::from(middle.center().y) - 200.0).abs() < 0.01,
            "centred"
        );
        // Its top kept: the cut is all below.
        let top = laid(room(800.0, 400.0), (100, 100), (0.5, 0.0), OVERSCAN);
        assert!(top.origin.y > middle.origin.y);
        assert!((f32::from(top.origin.y) - (200.0 - 200.0 * OVERSCAN)).abs() < 0.01);
        // Its bottom kept: the cut is all above.
        let bottom = laid(room(800.0, 400.0), (100, 100), (0.5, 1.0), OVERSCAN);
        assert!((f32::from(bottom.bottom()) - (200.0 + 200.0 * OVERSCAN)).abs() < 0.01);
        // Nothing of the room is left uncovered, wherever the focus is.
        for focus in [(0.0, 0.0), (1.0, 1.0), (0.3, 0.8)] {
            let at = laid(room(300.0, 700.0), (1920, 1080), focus, 1.0);
            assert!(at.origin.x <= px(0.01) && at.origin.y <= px(0.01), "{at:?}");
            assert!(
                at.right() >= px(299.99) && at.bottom() >= px(699.99),
                "{at:?}"
            );
        }
    }
}
