//! One share drawn: the newest frame of its stream, laid in its room.
//!
//! A stream keeps one picture for as long as it is drawn at one size. Each
//! frame's pixels go into that picture's texture where it already lies
//! (`Window::update_image`); only a frame of another size makes a new
//! picture, and the old one is let go of at once. Drawing it is also what
//! tells the stream it is in sight, how large it is wanted and how often.
//!
//! This is the one place that writes frames into a texture
//! (`Window::update_image`, which the vendored GPUI adds): another GPUI's
//! streamed textures are a change to this file.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    Bounds, ContentMask, IntoElement, Pixels, RenderImage, Styled, Window, canvas, point, px, size,
};

use crate::share::fit::Rect;
use crate::share::{Fit, FrameSlot, Wanted};

/// What a stream has on screen.
#[derive(Default)]
pub(crate) struct Screen {
    picture: Option<Arc<RenderImage>>,
    /// The size of the frame in `picture`, and the size it was sent at.
    size: (u32, u32),
    sent: (u32, u32),
    /// Frames drawn: taken from the slot and put on screen.
    pub drawn: u64,
    /// Where the picture was laid when last drawn, in its room's own
    /// coordinates: what a stroke is placed by.
    pub laid: Option<Rect>,
    /// The room it was drawn in, in the window.
    pub room: Option<Bounds<Pixels>>,
}

impl std::fmt::Debug for Screen {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Screen")
            .field("size", &self.size)
            .field("drawn", &self.drawn)
            .finish_non_exhaustive()
    }
}

impl Screen {
    /// The size the stream is sent at, once a frame of it came.
    pub(crate) fn sent(&self) -> Option<(u32, u32)> {
        (self.sent.0 > 0).then_some(self.sent)
    }

    /// Whether a frame of it has come yet.
    pub(crate) fn has_picture(&self) -> bool {
        self.picture.is_some()
    }

    /// The picture on screen, to copy.
    pub(crate) fn picture(&self) -> Option<(Arc<RenderImage>, (u32, u32))> {
        self.picture.clone().map(|picture| (picture, self.size))
    }

    /// Let go of the picture: the stream is gone. Its texture is given back
    /// by whoever holds a window.
    pub(crate) fn release(&mut self) -> Option<Arc<RenderImage>> {
        self.laid = None;
        self.picture.take()
    }

    /// Take the newest frame from `slot`, if one came, into the picture.
    fn take(&mut self, slot: &FrameSlot, window: &mut Window) {
        let Some(frame) = slot.take() else {
            return;
        };
        self.drawn += 1;
        self.sent = frame.sent;
        let same = self.size == (frame.width, frame.height);
        if let Some(picture) = self.picture.as_ref().filter(|_| same)
            && window.update_image(picture, 0, &frame.bgra)
        {
            slot.give_back(frame.bgra);
            return;
        }
        let Some(pixels) = image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra) else {
            return;
        };
        let fresh = Arc::new(RenderImage::new(vec![image::Frame::new(pixels)]));
        if let Some(old) = self.picture.replace(fresh) {
            let _ = window.drop_image(old);
        }
        self.size = (frame.width, frame.height);
    }

    /// Draw it laid `fit` in `bounds`, moved `pan` from the middle where it
    /// is shown pixel for pixel (and no further than its edges).
    fn paint(&mut self, bounds: Bounds<Pixels>, fit: Fit, pan: (f32, f32), window: &mut Window) {
        let scale = window.scale_factor();
        let room = (f32::from(bounds.size.width), f32::from(bounds.size.height));
        let picture_size = if self.sent.0 > 0 { self.sent } else { self.size };
        let mut laid = fit.place(
            (picture_size.0 as f32, picture_size.1 as f32),
            room,
            scale,
        );
        if fit == Fit::Actual {
            let reach = |laid: f32, room: f32| ((laid - room) / 2.0).max(0.0);
            let (across, down) = (reach(laid.width, room.0), reach(laid.height, room.1));
            laid.x += pan.0.clamp(-across, across);
            laid.y += pan.1.clamp(-down, down);
        }
        self.laid = self.picture.is_some().then_some(laid);
        self.room = Some(bounds);
        let Some(picture) = self.picture.clone() else {
            return;
        };
        let at = Bounds::new(
            point(bounds.origin.x + px(laid.x), bounds.origin.y + px(laid.y)),
            size(px(laid.width), px(laid.height)),
        );
        window.with_content_mask(Some(ContentMask { bounds }), |window| {
            let _ = window.paint_image(at, gpui::Corners::default(), picture, 0, false);
        });
    }
}

/// A stream drawn laid `fit` in the room it is given, wanted `rate` frames
/// a second.
pub(crate) fn video(
    screen: Rc<RefCell<Screen>>,
    slot: FrameSlot,
    wanted: Arc<Wanted>,
    fit: Fit,
    pan: (f32, f32),
    rate: u32,
) -> impl IntoElement {
    canvas(
        |_, _, _| (),
        move |bounds, (), window, _| {
            let scale = window.scale_factor();
            #[expect(
                clippy::cast_possible_truncation,
                clippy::cast_sign_loss,
                reason = "a room on screen, positive and far below u32"
            )]
            let (width, height) = (
                (f32::from(bounds.size.width) * scale).round() as u32,
                (f32::from(bounds.size.height) * scale).round() as u32,
            );
            wanted.drawn(width, height, rate, fit);
            let mut screen = screen.borrow_mut();
            screen.take(&slot, window);
            screen.paint(bounds, fit, pan, window);
        },
    )
    .size_full()
}
