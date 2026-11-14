//! A decoded picture (YUV 4:2:0, as H.264 gives it) made into what the
//! window draws (BGRA), at the size it is drawn.
//!
//! The planes are scaled first, each on its own, and the colour worked out
//! only for the pixels that are drawn: a stage half the size of the stream
//! costs a quarter of the colour work, and a filmstrip tile next to none.
//! The colours are BT.601 in studio range, the inverse of what the
//! broadcaster encodes with (`fill_from_rgba` in `fancy-screenshare`).

use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer, images::Image};

/// The three planes of a decoded picture, as the decoder holds them.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Planes<'a> {
    pub width: u32,
    pub height: u32,
    pub y: &'a [u8],
    pub u: &'a [u8],
    pub v: &'a [u8],
    /// Bytes from one row to the next: of Y, and of U and V.
    pub strides: (usize, usize),
}

/// Scales and colours pictures, keeping its buffers from one to the next.
#[derive(Default)]
pub(crate) struct Converter {
    resizer: Resizer,
    /// Each plane, packed and then scaled.
    packed: [Vec<u8>; 3],
    scaled: [Vec<u8>; 3],
}

impl std::fmt::Debug for Converter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Converter").finish_non_exhaustive()
    }
}

impl Converter {
    /// `planes` as BGRA, `size` large, into `out`.
    pub(crate) fn convert(&mut self, planes: &Planes<'_>, size: (u32, u32), out: &mut Vec<u8>) {
        let (width, height) = (size.0.max(1), size.1.max(1));
        let (chroma_w, chroma_h) = (width.div_ceil(2), height.div_ceil(2));
        let (from_cw, from_ch) = (planes.width.div_ceil(2), planes.height.div_ceil(2));
        let sources = [
            (planes.y, planes.strides.0, planes.width, planes.height, width, height),
            (planes.u, planes.strides.1, from_cw, from_ch, chroma_w, chroma_h),
            (planes.v, planes.strides.1, from_cw, from_ch, chroma_w, chroma_h),
        ];
        for (at, (plane, stride, from_w, from_h, to_w, to_h)) in sources.into_iter().enumerate() {
            pack(plane, stride, from_w, from_h, &mut self.packed[at]);
            if (from_w, from_h) == (to_w, to_h) {
                std::mem::swap(&mut self.packed[at], &mut self.scaled[at]);
            } else {
                self.scaled[at].resize((to_w * to_h) as usize, 0);
                scale(&mut self.resizer, &self.packed[at], (from_w, from_h), &mut self.scaled[at], (to_w, to_h));
            }
        }
        out.resize((width * height * 4) as usize, 0);
        let [y, u, v] = &self.scaled;
        colour(y, u, v, (width, chroma_w), out);
    }
}

/// `plane`'s rows without what pads them, into `into`.
fn pack(plane: &[u8], stride: usize, width: u32, height: u32, into: &mut Vec<u8>) {
    let (width, height) = (width as usize, height as usize);
    into.clear();
    into.reserve(width * height);
    for row in plane.chunks(stride.max(width)).take(height) {
        into.extend_from_slice(&row[..width.min(row.len())]);
    }
    into.resize(width * height, 0);
}

/// One plane scaled from `from` to `to`.
fn scale(resizer: &mut Resizer, plane: &[u8], from: (u32, u32), out: &mut [u8], to: (u32, u32)) {
    let options = ResizeOptions::new().resize_alg(ResizeAlg::Convolution(FilterType::Bilinear));
    let made = fast_image_resize::images::ImageRef::new(from.0, from.1, plane, PixelType::U8)
        .and_then(|source| Image::from_slice_u8(to.0, to.1, out, PixelType::U8).map(|target| (source, target)));
    if let Ok((source, mut target)) = made
        && let Err(error) = resizer.resize(&source, &mut target, &options)
    {
        tracing::debug!(%error, "share: a plane could not be scaled");
    }
}

/// BT.601 studio range to BGRA, `width` pixels a row, the chroma planes
/// `chroma_w` a row.
fn colour(y: &[u8], u: &[u8], v: &[u8], (width, chroma_w): (u32, u32), out: &mut [u8]) {
    let (width, chroma_w) = (width as usize, chroma_w as usize);
    for (row, (lumas, pixels)) in y.chunks_exact(width).zip(out.chunks_exact_mut(width * 4)).enumerate() {
        let chroma = (row / 2) * chroma_w;
        let (us, vs) = (&u[chroma..chroma + chroma_w], &v[chroma..chroma + chroma_w]);
        for (col, (luma, pixel)) in lumas.iter().zip(pixels.as_chunks_mut::<4>().0).enumerate() {
            let c = 298 * (i32::from(*luma) - 16);
            let d = i32::from(us[col / 2]) - 128;
            let e = i32::from(vs[col / 2]) - 128;
            pixel[0] = byte((c + 516 * d + 128) >> 8);
            pixel[1] = byte((c - 100 * d - 208 * e + 128) >> 8);
            pixel[2] = byte((c + 409 * e + 128) >> 8);
            pixel[3] = 255;
        }
    }
}

fn byte(value: i32) -> u8 {
    u8::try_from(value.clamp(0, 255)).unwrap_or(u8::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A picture of one colour, its rows padded as a decoder pads them.
    fn flat(width: u32, height: u32, (y, u, v): (u8, u8, u8)) -> (Vec<u8>, Vec<u8>, Vec<u8>) {
        let stride = width as usize + 16;
        let chroma = (width.div_ceil(2) as usize + 8) * height.div_ceil(2) as usize;
        (vec![y; stride * height as usize], vec![u; chroma], vec![v; chroma])
    }

    fn planes<'a>(width: u32, height: u32, (y, u, v): &'a (Vec<u8>, Vec<u8>, Vec<u8>)) -> Planes<'a> {
        Planes {
            width,
            height,
            y,
            u,
            v,
            strides: (width as usize + 16, width.div_ceil(2) as usize + 8),
        }
    }

    #[test]
    fn white_black_and_a_red_come_out_as_they_went_in() {
        let mut converter = Converter::default();
        let mut out = Vec::new();
        // Studio-range YUV of white, black and the encoder's own pure red.
        for (yuv, bgra) in [
            ((235, 128, 128), [255, 255, 255, 255]),
            ((16, 128, 128), [0, 0, 0, 255]),
            ((82, 90, 240), [0, 0, 255, 255]),
        ] {
            let held = flat(64, 36, yuv);
            converter.convert(&planes(64, 36, &held), (64, 36), &mut out);
            assert_eq!(out.len(), 64 * 36 * 4);
            let got: [u8; 4] = out[..4].try_into().expect("a pixel");
            for (got, want) in got.iter().zip(bgra) {
                assert!(got.abs_diff(want) <= 2, "{yuv:?}: {got:?} for {bgra:?}");
            }
        }
    }

    #[test]
    fn a_picture_is_made_the_size_it_is_drawn() {
        let mut converter = Converter::default();
        let mut out = Vec::new();
        let held = flat(1280, 720, (235, 128, 128));
        converter.convert(&planes(1280, 720, &held), (321, 181), &mut out);
        assert_eq!(out.len(), 321 * 181 * 4);
        assert!(out.as_chunks::<4>().0.iter().all(|pixel| pixel[0] > 250), "still white");
        converter.convert(&planes(1280, 720, &held), (1280, 720), &mut out);
        assert_eq!(out.len(), 1280 * 720 * 4, "and as it is");
    }
}
