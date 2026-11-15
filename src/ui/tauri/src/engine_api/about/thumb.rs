//! Thumbnails small enough to ride in a comment: JPEG, made smaller and
//! coarser until each fits its share of the room there is.

use super::bounds::Limits;
use super::model::Picture;

/// The sides tried, largest first, and the qualities at each.
const EDGES: [u32; 4] = [Limits::THUMB_EDGE, 128, 96, 64];
const QUALITIES: [u8; 3] = [70, 55, 40];

/// The largest picture read for a thumbnail, in pixels a side, and in bytes
/// held while it is read: a picture claiming more is not one to read.
const MOST_SIDE: u32 = 16_384;
const MOST_HELD: u64 = 512 << 20;

/// A thumbnail made.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Thumb {
    /// It, as a `data:` address.
    pub address: String,
    /// The size of the picture it was made from, in pixels.
    pub width: u32,
    /// The height of that picture.
    pub height: u32,
}

/// Makes thumbnails out of a room shared among the pictures still to come.
#[derive(Debug)]
pub struct Thumbnailer {
    /// Bytes left for thumbnails.
    room: usize,
    /// Pictures still to be made small, this one among them.
    left: usize,
}

impl Thumbnailer {
    /// One that shares `room` bytes among `pictures` pictures.
    #[must_use]
    pub const fn new(room: usize, pictures: usize) -> Self {
        Self {
            room,
            left: pictures,
        }
    }

    /// A thumbnail of the picture in `bytes`, within this picture's share
    /// of the room; `None` if it cannot be read, or no thumbnail fits. What
    /// it does not use is left to the pictures after it.
    pub fn thumb(&mut self, bytes: &[u8]) -> Option<Thumb> {
        let share = (self.room / self.left.max(1)).min(Limits::CARD.thumb);
        self.left = self.left.saturating_sub(1);
        let picture = read(bytes)?;
        let (width, height) = (picture.width(), picture.height());
        // Made small once; the whole picture is let go of at once.
        let small = picture.thumbnail(Limits::THUMB_EDGE, Limits::THUMB_EDGE);
        drop(picture);
        let made = EDGES
            .iter()
            .flat_map(|edge| QUALITIES.iter().map(move |quality| (*edge, *quality)))
            .find_map(|(edge, quality)| {
                encoded(&small, edge, quality).filter(|out| out.len() <= share)
            })?;
        self.room -= made.len();
        Some(Thumb {
            address: Picture::thumb_address(&made),
            width,
            height,
        })
    }
}

/// The picture in `bytes`, if it is one of a size worth reading.
fn read(bytes: &[u8]) -> Option<image::DynamicImage> {
    let mut reader = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MOST_SIDE);
    limits.max_image_height = Some(MOST_SIDE);
    limits.max_alloc = Some(MOST_HELD);
    reader.limits(limits);
    reader.decode().ok()
}

/// `picture` at most `edge` pixels a side, as a JPEG of `quality`, with
/// what was see-through laid on grey.
fn encoded(picture: &image::DynamicImage, edge: u32, quality: u8) -> Option<Vec<u8>> {
    let small = picture.thumbnail(edge, edge).to_rgba8();
    let flat = image::RgbImage::from_fn(small.width(), small.height(), |x, y| {
        let [r, g, b, a] = small.get_pixel(x, y).0;
        let over = |part: u8| {
            let mixed = (u32::from(part) * u32::from(a) + 128 * u32::from(255 - a)) / 255;
            u8::try_from(mixed).unwrap_or(u8::MAX)
        };
        image::Rgb([over(r), over(g), over(b)])
    });
    let mut out = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality)
        .encode_image(&flat)
        .ok()?;
    Some(out)
}
