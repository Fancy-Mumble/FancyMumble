//! One share drawn: the newest frame of its stream, laid in its room.
//!
//! A stream keeps one texture for as long as it is drawn at one size: a
//! dynamic texture of GPUI's, outside the sprite atlas, that each frame's
//! pixels are uploaded into where it lies (`Window::update_dynamic_texture`).
//! Only a frame of another size makes a new texture, and the old one is let
//! go of at once. Where the platform has no dynamic textures, each frame is
//! a picture of its own instead, and the one before it is let go of. The
//! newest frame's pixels are kept either way, for copying it. Drawing it is
//! also what tells the stream it is in sight, how large it is wanted and
//! how often.
//!
//! This is the one place that writes frames into a texture: another GPUI's
//! streamed textures are a change to this file.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;

use gpui::{
    Bounds, ContentMask, DevicePixels, DynamicTexture, IntoElement, Pixels, RenderImage, Styled,
    Window, canvas, point, px, size,
};

use crate::share::fit::Rect;
use crate::share::{Fit, FrameSlot, Wanted};

/// What a frame is shown from.
#[derive(Debug, Clone)]
pub(crate) enum Picture {
    /// A texture the next frame is uploaded into.
    Texture(DynamicTexture),
    /// A picture of one frame, where the platform has no such textures.
    Still(Arc<RenderImage>),
}

impl Picture {
    /// Give it back to the window: the stream is gone, or the frame is.
    pub(crate) fn give_back(self, window: &mut Window) {
        match self {
            Self::Texture(texture) => window.remove_dynamic_texture(texture),
            Self::Still(image) => {
                let _ = window.drop_image(image);
            }
        }
    }
}

/// What a stream has on screen.
#[derive(Default)]
pub(crate) struct Screen {
    picture: Option<Picture>,
    /// The newest frame's pixels, BGRA, as they are on screen: what is
    /// copied. Swapped with the frame each one replaces, which goes back to
    /// the slot, so no more buffers are held than before. Empty while the
    /// picture holds them itself (`Picture::Still`).
    pixels: Vec<u8>,
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

    /// The frame on screen, BGRA, and its size: to copy.
    pub(crate) fn picture(&self) -> Option<(Vec<u8>, (u32, u32))> {
        let pixels = match self.picture.as_ref()? {
            Picture::Texture(_) => self.pixels.clone(),
            Picture::Still(image) => image.as_bytes(0)?.to_vec(),
        };
        Some((pixels, self.size))
    }

    /// Let go of the picture: the stream is gone. It is given back by
    /// whoever holds a window.
    pub(crate) fn release(&mut self) -> Option<Picture> {
        self.laid = None;
        self.pixels = Vec::new();
        self.picture.take()
    }

    /// Take the newest frame from `slot`, if one came, into the picture.
    fn take(&mut self, slot: &FrameSlot, window: &mut Window) {
        let Some(frame) = slot.take() else {
            return;
        };
        self.drawn += 1;
        self.sent = frame.sent;
        let (Ok(width), Ok(height)) = (i32::try_from(frame.width), i32::try_from(frame.height))
        else {
            slot.give_back(frame.bgra);
            return;
        };
        let whole = size(DevicePixels(width), DevicePixels(height));
        let row = frame.width * 4;
        let same = self.size == (frame.width, frame.height);
        if let Some(Picture::Texture(texture)) = self.picture.as_ref().filter(|_| same) {
            let at = Bounds::new(point(DevicePixels(0), DevicePixels(0)), whole);
            // Refused while earlier uploads wait for the window to draw:
            // this frame is skipped and the one on screen stays.
            let kept = match window.update_dynamic_texture(*texture, at, &frame.bgra, row) {
                Ok(()) => std::mem::replace(&mut self.pixels, frame.bgra),
                Err(_) => frame.bgra,
            };
            slot.give_back(kept);
            return;
        }
        let fresh = match window.create_dynamic_texture(whole, &frame.bgra, row) {
            Ok(texture) => {
                slot.give_back(std::mem::replace(&mut self.pixels, frame.bgra));
                Picture::Texture(texture)
            }
            Err(_) => {
                let Some(pixels) = image::RgbaImage::from_raw(frame.width, frame.height, frame.bgra)
                else {
                    return;
                };
                self.pixels = Vec::new();
                Picture::Still(Arc::new(RenderImage::new(vec![image::Frame::new(pixels)])))
            }
        };
        if let Some(old) = self.picture.replace(fresh) {
            old.give_back(window);
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
        window.with_content_mask(Some(ContentMask { bounds }), |window| match picture {
            Picture::Texture(texture) => {
                let _ = window.paint_dynamic_texture(at, texture);
            }
            Picture::Still(image) => {
                let _ = window.paint_image(at, at, gpui::Corners::default(), image, 0, false);
            }
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

/// GPUI's test platform has no dynamic textures: tests get a backend that
/// takes every upload, so that they go the way a window on Windows or macOS
/// goes. Process-wide, as GPUI's backend is; installed once.
#[cfg(test)]
pub(crate) fn textures_for_tests() {
    /// Takes every texture and upload, and keeps nothing.
    struct Accepting;

    impl gpui::DynamicTexturePlatform for Accepting {
        fn create_texture(
            &self,
            _: gpui::DynamicTextureId,
            _: gpui::Size<DevicePixels>,
            _: &[u8],
        ) -> gpui::Result<()> {
            Ok(())
        }

        fn update_texture(
            &self,
            _: gpui::DynamicTextureId,
            _: Bounds<DevicePixels>,
            _: &[u8],
        ) -> gpui::Result<()> {
            Ok(())
        }

        fn remove_texture(&self, _: gpui::DynamicTextureId) {}
    }

    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| gpui::set_dynamic_texture_platform(Arc::new(Accepting)));
}