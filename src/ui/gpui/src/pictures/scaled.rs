//! A picture's file, read into something small enough to keep: scaled to
//! the size it is shown at as soon as it is decoded, so that what is held
//! is the size of what is seen and not of what was sent.
//!
//! An animation is read a frame at a time, for as long as it is watched:
//! none of it is held but the frame on show and the one after.

use std::io::Cursor;
use std::time::Duration;

use image::metadata::Orientation;
use image::{AnimationDecoder as _, DynamicImage, ImageDecoder as _, RgbaImage};

/// The most a picture takes while it is being read: its pixels as they
/// come out of the file, at four bytes each. One that would take more is
/// not read at all: a file of a few kilobytes can claim to be a picture of
/// a gigabyte.
const READING_MOST: u64 = 192 << 20;

/// The same for an animation, whose whole canvas is held for as long as it
/// plays. A larger one is shown as its first frame.
const MOVING_MOST: u64 = 48 << 20;

/// The shortest a frame stays. A file that says less is taken as browsers
/// take it: as not having said.
const SHORTEST: Duration = Duration::from_millis(20);
const UNSAID: Duration = Duration::from_millis(100);

/// How large a picture comes out, at most.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Most {
    /// The room it is shown in, in pixels: so wide and so tall.
    pub fits: (u32, u32),
    /// All of it, in pixels.
    pub pixels: u64,
    /// The shape its middle is cut to, as so wide to so tall, where it is
    /// shown filling a room of that shape; `None` leaves it its own.
    pub shape: Option<(u32, u32)>,
    /// How far it is blurred, in its own pixels once it is this size;
    /// nought leaves it sharp. A still picture only.
    pub blur: u8,
    /// Where a picture cut to a shape is cut around, in percent across and
    /// down, as CSS's `object-position` places it: [`MIDDLE`] for its middle.
    pub focus: (u8, u8),
}

/// The middle of a picture: where it is cut around unless told otherwise.
pub(crate) const MIDDLE: (u8, u8) = (50, 50);

impl Most {
    /// `picture`, at the size it is kept, as blurred as is asked for.
    fn blurred(self, picture: RgbaImage) -> RgbaImage {
        if self.blur == 0 {
            return picture;
        }
        image::imageops::fast_blur(&picture, f32::from(self.blur))
    }

    /// The part of a picture of `natural` size that is kept: its middle at
    /// the shape wanted, as where it starts and how large it is. All of it
    /// where no shape is.
    fn cut(self, natural: (u32, u32)) -> (u32, u32, u32, u32) {
        let (width, height) = natural;
        let Some((wide, tall)) = self.shape.filter(|(wide, tall)| *wide > 0 && *tall > 0) else {
            return (0, 0, width, height);
        };
        // Whichever side is too long for the shape loses its ends.
        let (wide, tall) = (u64::from(wide), u64::from(tall));
        let fits_wide = (u64::from(height) * wide / tall).clamp(1, u64::from(width.max(1)));
        let fits_tall = (u64::from(width) * tall / wide).clamp(1, u64::from(height.max(1)));
        #[expect(
            clippy::cast_possible_truncation,
            reason = "no larger than the side it was cut from"
        )]
        let (kept_wide, kept_tall) = if fits_wide < u64::from(width) {
            (fits_wide as u32, height)
        } else {
            (width, fits_tall as u32)
        };
        // What is left over is shared out as the focus says: half each side
        // for the middle, all of it after for a focus at the start.
        let share = |left_over: u32, percent: u8| {
            let percent = u64::from(percent.min(100));
            u32::try_from(u64::from(left_over) * percent / 100).unwrap_or(0)
        };
        (
            share(width - kept_wide, self.focus.0),
            share(height - kept_tall, self.focus.1),
            kept_wide,
            kept_tall,
        )
    }

    /// The size a picture of `natural` size comes out at: its own shape,
    /// within both limits, and never larger than it is.
    fn of(self, natural: (u32, u32)) -> (u32, u32) {
        let (width, height) = (f64::from(natural.0.max(1)), f64::from(natural.1.max(1)));
        #[expect(clippy::cast_precision_loss, reason = "a count of pixels on a screen")]
        let by_area = (self.pixels as f64 / (width * height)).sqrt();
        let scale = (f64::from(self.fits.0) / width)
            .min(f64::from(self.fits.1) / height)
            .min(by_area)
            .min(1.0);
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "no larger than the side it was scaled down from"
        )]
        let side = |natural: f64| ((natural * scale).round() as u32).max(1);
        (side(width), side(height))
    }
}

/// Why a picture is not shown.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refused {
    /// It is larger than is read here: this many pixels wide and tall.
    TooLarge(u32, u32),
    /// Its file could not be read as a picture.
    Unreadable(String),
}

impl std::fmt::Display for Refused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge(width, height) => {
                write!(f, "Too large to show here ({width} × {height})")
            }
            Self::Unreadable(why) => write!(f, "This picture could not be read ({why})"),
        }
    }
}

fn unreadable(error: impl std::fmt::Display) -> Refused {
    Refused::Unreadable(error.to_string())
}

/// What a decoder is held to: whatever the file says of itself.
fn limits(most: u64) -> image::Limits {
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(most);
    limits
}

/// Whether a picture this size is read at all, while taking at most `most`.
fn allowed((width, height): (u32, u32), most: u64) -> Result<(), Refused> {
    if u64::from(width) * u64::from(height) * 4 > most {
        return Err(Refused::TooLarge(width, height));
    }
    Ok(())
}

/// Pixels as GPUI draws them: blue first.
fn drawable(mut pixels: RgbaImage) -> RgbaImage {
    for pixel in pixels.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
    }
    pixels
}

/// The picture in `file`, no larger than `most`, turned the way its file
/// says it is to be looked at.
///
/// # Errors
///
/// When the file is no picture, or one too large to read.
pub(crate) fn still(file: &[u8], most: Most) -> Result<RgbaImage, Refused> {
    let mut reader = image::ImageReader::new(Cursor::new(file))
        .with_guessed_format()
        .map_err(unreadable)?;
    reader.limits(limits(READING_MOST));
    let mut decoder = reader.into_decoder().map_err(unreadable)?;
    let natural = decoder.dimensions();
    allowed(natural, READING_MOST)?;
    // A file that does not say is one that is the right way up.
    let turned = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    // The room is for the picture the way up it is looked at.
    let upright = if on_its_side(turned) {
        (natural.1, natural.0)
    } else {
        natural
    };
    let (_, _, kept_wide, kept_tall) = most.cut(upright);
    let (wide, tall) = most.of((kept_wide, kept_tall));
    // How much of its size it is wanted at, at the least.
    let share = (f64::from(wide) / f64::from(kept_wide.max(1)))
        .max(f64::from(tall) / f64::from(kept_tall.max(1)));
    let mut picture = match small_jpeg(file, natural, share) {
        Some(small) => small,
        None => DynamicImage::from_decoder(decoder).map_err(unreadable)?,
    };
    if most.shape.is_some() {
        // Cut the way up it is looked at: its middle is not the same
        // part of it lying down.
        picture.apply_orientation(turned);
        let (left, top, width, height) = most.cut((picture.width(), picture.height()));
        let kept = picture.crop_imm(left, top, width, height);
        let small = kept.thumbnail_exact(wide, tall).into_rgba8();
        return Ok(drawable(most.blurred(small)));
    }
    // Scaled before it is turned, and in the colours it came in: the
    // large copy is let go of as early as it can be.
    let (wide, tall) = if on_its_side(turned) {
        (tall, wide)
    } else {
        (wide, tall)
    };
    let mut small = if (wide, tall) == (picture.width(), picture.height()) {
        picture
    } else {
        picture.thumbnail_exact(wide, tall)
    };
    small.apply_orientation(turned);
    Ok(drawable(most.blurred(small.into_rgba8())))
}

/// Whether a picture turned this way to be looked at lies on its side in
/// its file: as wide there as it is tall.
fn on_its_side(turned: Orientation) -> bool {
    matches!(
        turned,
        Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH
    )
}

/// The JPEG in `file`, `natural` in size, read at the smallest of a half,
/// a quarter or an eighth of that which is still `share` of it or more.
/// A JPEG can be read small without being read whole first: a photograph
/// of twenty megapixels shown in a conversation takes a fiftieth of the
/// room that way, and a fraction of the time. `None` for a file that is no
/// JPEG, one wanted nearly whole, or one this cannot read: those are read
/// the usual way.
fn small_jpeg(file: &[u8], natural: (u32, u32), share: f64) -> Option<DynamicImage> {
    if !file.starts_with(&[0xff, 0xd8]) || share > 0.5 {
        return None;
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "a share of a side that fits a u32"
    )]
    let wanted =
        |side: u32| ((f64::from(side) * share).ceil() as u32).clamp(1, u32::from(u16::MAX));
    let mut decoder = jpeg_decoder::Decoder::new(Cursor::new(file));
    decoder.read_info().ok()?;
    let (wide, tall) = decoder
        .scale(wanted(natural.0) as u16, wanted(natural.1) as u16)
        .ok()?;
    let pixels = decoder.decode().ok()?;
    let (wide, tall) = (u32::from(wide), u32::from(tall));
    match decoder.info()?.pixel_format {
        jpeg_decoder::PixelFormat::RGB24 => {
            image::RgbImage::from_raw(wide, tall, pixels).map(DynamicImage::ImageRgb8)
        }
        jpeg_decoder::PixelFormat::L8 => {
            image::GrayImage::from_raw(wide, tall, pixels).map(DynamicImage::ImageLuma8)
        }
        // Rare, and not worth a second way of reading colours.
        _ => None,
    }
}

/// Whether the picture in `file` may be one that moves: what decides
/// whether it is read on a thread of its own, where an animation is read
/// for as long as it plays. Told from the start of the file alone.
pub(crate) fn may_move(file: &[u8]) -> bool {
    use image::codecs::{png::PngDecoder, webp::WebPDecoder};
    match file {
        // Any of these may have a second frame: nothing says before it.
        [b'G', b'I', b'F', b'8', ..] => true,
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => WebPDecoder::new(Cursor::new(file)).is_ok_and(|decoder| decoder.has_animation()),
        [0x89, b'P', b'N', b'G', ..] => PngDecoder::new(Cursor::new(file))
            .and_then(|decoder| decoder.is_apng())
            .unwrap_or(false),
        _ => false,
    }
}

/// What a file's bytes are kept in while an animation plays from them.
pub(crate) trait File: AsRef<[u8]> + Clone + Send + 'static {}

impl<T: AsRef<[u8]> + Clone + Send + 'static> File for T {}

/// An animation being read: the frames of `file`, one after another and
/// round again, each no larger than `most`. It stays on the thread it was
/// opened on: the decoders under it do.
pub(crate) struct Moving<F: File> {
    file: F,
    most: Most,
    frames: image::Frames<'static>,
    /// Frames read ahead of where the animation is: what it took to find
    /// out that it is one.
    ahead: std::collections::VecDeque<Shown>,
    /// How many frames this pass has given: a pass that gives none is the
    /// end of an animation that cannot be read, not the start of another.
    given: usize,
}

impl<F: File> std::fmt::Debug for Moving<F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Moving")
            .field("most", &self.most)
            .field("given", &self.given)
            .finish_non_exhaustive()
    }
}

/// One frame, and how long it stays.
pub(crate) type Shown = (RgbaImage, Duration);

/// The frames of the animation in `file`, or `None` for a file of a kind
/// that never moves, or one whose canvas is too large to hold.
fn frames<F: File>(file: &F) -> Result<Option<image::Frames<'static>>, Refused> {
    use image::codecs::{gif::GifDecoder, png::PngDecoder, webp::WebPDecoder};
    let read = Cursor::new(file.clone());
    let fits = |size: (u32, u32)| allowed(size, MOVING_MOST).is_ok();
    Ok(match file.as_ref() {
        [b'G', b'I', b'F', b'8', ..] => {
            let mut decoder = GifDecoder::new(read).map_err(unreadable)?;
            let _ = decoder.set_limits(limits(MOVING_MOST));
            fits(decoder.dimensions()).then(|| decoder.into_frames())
        }
        [
            b'R',
            b'I',
            b'F',
            b'F',
            _,
            _,
            _,
            _,
            b'W',
            b'E',
            b'B',
            b'P',
            ..,
        ] => {
            let decoder = WebPDecoder::new(read).map_err(unreadable)?;
            (decoder.has_animation() && fits(decoder.dimensions())).then(|| decoder.into_frames())
        }
        [0x89, b'P', b'N', b'G', ..] => {
            let decoder = PngDecoder::new(read).map_err(unreadable)?;
            if decoder.is_apng().map_err(unreadable)? && fits(decoder.dimensions()) {
                Some(decoder.apng().map_err(unreadable)?.into_frames())
            } else {
                None
            }
        }
        _ => None,
    })
}

impl<F: File> Moving<F> {
    /// The frame after the last one given, starting over after the last
    /// of the file.
    ///
    /// # Errors
    ///
    /// When the file stops being readable part of the way through.
    pub(crate) fn next_frame(&mut self) -> Result<Shown, Refused> {
        if let Some(ahead) = self.ahead.pop_front() {
            return Ok(ahead);
        }
        if let Some(shown) = self.read()? {
            return Ok(shown);
        }
        if self.given == 0 {
            return Err(Refused::Unreadable("no frames".to_owned()));
        }
        // Round again, from the file: nothing of the last pass was kept.
        self.frames = frames(&self.file)?.ok_or_else(|| unreadable("no longer an animation"))?;
        self.given = 0;
        self.read()?
            .ok_or_else(|| Refused::Unreadable("no frames".to_owned()))
    }

    /// The next frame of this pass, scaled; `None` after the last.
    fn read(&mut self) -> Result<Option<Shown>, Refused> {
        let Some(frame) = self.frames.next() else {
            return Ok(None);
        };
        let frame = frame.map_err(unreadable)?;
        self.given += 1;
        let (numerator, denominator) = frame.delay().numer_denom_ms();
        let stays = Duration::from_millis(u64::from(numerator) / u64::from(denominator.max(1)));
        let stays = if stays < SHORTEST { UNSAID } else { stays };
        let canvas = frame.into_buffer();
        let (left, top, width, height) = self.most.cut(canvas.dimensions());
        let canvas = if (width, height) == canvas.dimensions() {
            canvas
        } else {
            image::imageops::crop_imm(&canvas, left, top, width, height).to_image()
        };
        let natural = canvas.dimensions();
        let (width, height) = self.most.of(natural);
        let small = if (width, height) == natural {
            canvas
        } else {
            image::imageops::thumbnail(&canvas, width, height)
        };
        Ok(Some((drawable(small), stays)))
    }
}

/// A file, read.
#[derive(Debug)]
pub(crate) enum Read<F: File> {
    /// A picture that stands still.
    Still(RgbaImage),
    /// One that moves, at its first frame.
    Moving(Moving<F>),
}

/// Read the picture in `file`, to be shown no larger than `most`.
///
/// # Errors
///
/// When the file is no picture, or one too large to read.
pub(crate) fn read<F: File>(file: F, most: Most) -> Result<Read<F>, Refused> {
    let Some(frames) = frames(&file)? else {
        return still(file.as_ref(), most).map(Read::Still);
    };
    let mut moving = Moving {
        file,
        most,
        frames,
        ahead: std::collections::VecDeque::new(),
        given: 0,
    };
    // An animation of one frame is a picture: two are read to tell.
    let Some(first) = moving.read()? else {
        return still(moving.file.as_ref(), most).map(Read::Still);
    };
    match moving.read()? {
        Some(second) => {
            moving.ahead.extend([first, second]);
            Ok(Read::Moving(moving))
        }
        None => Ok(Read::Still(first.0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANY: Most = Most {
        fits: (4096, 4096),
        pixels: 16 << 20,
        shape: None,
        blur: 0,
        focus: MIDDLE,
    };

    fn encoded(picture: &DynamicImage, format: image::ImageFormat) -> Vec<u8> {
        let mut file = Vec::new();
        picture
            .write_to(&mut Cursor::new(&mut file), format)
            .expect("an encoded picture");
        file
    }

    /// Two colours side by side, red on the left.
    fn halves(width: u32, height: u32) -> DynamicImage {
        DynamicImage::ImageRgb8(image::RgbImage::from_fn(width, height, |x, _| {
            if x < width / 2 {
                image::Rgb([255, 0, 0])
            } else {
                image::Rgb([0, 0, 255])
            }
        }))
    }

    #[test]
    fn a_picture_comes_out_within_both_limits_at_its_own_shape() {
        let small = Most {
            fits: (100, 100),
            pixels: 1 << 20,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        assert_eq!(small.of((400, 200)), (100, 50));
        assert_eq!(small.of((200, 400)), (50, 100));
        // A room that is wider than tall holds a tall picture by its height.
        let wide = Most {
            fits: (400, 100),
            ..small
        };
        assert_eq!(wide.of((200, 400)), (50, 100));
        assert_eq!(wide.of((800, 100)), (400, 50));
        assert_eq!(small.of((80, 40)), (80, 40), "never larger than it is");
        // The area is what holds a square one back before its side does.
        let few = Most {
            fits: (4096, 4096),
            pixels: 10_000,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        assert_eq!(few.of((1000, 1000)), (100, 100));
        assert_eq!(few.of((0, 0)), (1, 1), "a file that claims nothing");
    }

    #[test]
    fn a_picture_is_cut_to_the_shape_of_its_room_from_its_middle() {
        let square = Most {
            fits: (50, 50),
            pixels: 1 << 20,
            shape: Some((1, 1)),
            blur: 0,
            focus: MIDDLE,
        };
        assert_eq!(square.cut((400, 200)), (100, 0, 200, 200));
        assert_eq!(square.cut((200, 400)), (0, 100, 200, 200));
        assert_eq!(square.cut((90, 90)), (0, 0, 90, 90));
        // Red on the left, blue on the right: the middle has both.
        let file = encoded(&halves(400, 200), image::ImageFormat::Png);
        let read = still(&file, square).expect("a picture");
        assert_eq!(read.dimensions(), (50, 50));
        assert_eq!(read.get_pixel(5, 25).0, [0, 0, 255, 255]);
        assert_eq!(read.get_pixel(45, 25).0, [255, 0, 0, 255]);
        // A banner out of a tall picture is a band across its middle.
        let banner = Most {
            fits: (300, 300),
            pixels: 1 << 20,
            shape: Some((3, 1)),
            blur: 0,
            focus: MIDDLE,
        };
        assert_eq!(banner.cut((300, 900)), (0, 400, 300, 100));
        assert_eq!(ANY.cut((300, 900)), (0, 0, 300, 900), "its own shape");
    }

    #[test]
    fn a_picture_is_cut_around_the_point_its_owner_named() {
        // As CSS's `object-position` places it: the point at a fifth down
        // the picture lands a fifth down the room.
        let banner = Most {
            fits: (300, 300),
            pixels: 1 << 20,
            shape: Some((3, 1)),
            blur: 0,
            focus: (50, 20),
        };
        assert_eq!(banner.cut((300, 900)), (0, 160, 300, 100));
        let start = Most {
            focus: (0, 0),
            ..banner
        };
        assert_eq!(start.cut((300, 900)), (0, 0, 300, 100));
        let end = Most {
            focus: (100, 100),
            ..banner
        };
        assert_eq!(end.cut((300, 900)), (0, 800, 300, 100));
        assert_eq!(end.cut((900, 100)), (600, 0, 300, 100), "across as well");
    }

    #[test]
    fn a_large_jpeg_is_read_small_and_comes_out_the_same_size() {
        // Sixteen hundred wide, wanted a tenth of that: read at an eighth.
        let file = encoded(&halves(1600, 800), image::ImageFormat::Jpeg);
        let small = small_jpeg(&file, (1600, 800), 0.1).expect("read small");
        assert_eq!((small.width(), small.height()), (200, 100));
        // Wanted nearly whole, or not a JPEG: read the usual way.
        assert!(small_jpeg(&file, (1600, 800), 0.8).is_none());
        let png = encoded(&halves(1600, 800), image::ImageFormat::Png);
        assert!(small_jpeg(&png, (1600, 800), 0.1).is_none());
        // And what comes out is what the room asks for, red still left.
        let most = Most {
            fits: (160, 160),
            pixels: 1 << 20,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        let read = still(&file, most).expect("a picture");
        assert_eq!(read.dimensions(), (160, 80));
        let [blue, _, red, _] = read.get_pixel(20, 40).0;
        assert!(red > 200 && blue < 60, "{red} {blue}");
    }

    #[test]
    fn a_picture_read_blurred_runs_its_colours_into_each_other() {
        let file = encoded(&halves(200, 100), image::ImageFormat::Png);
        let sharp = Most {
            fits: (200, 200),
            pixels: 1 << 20,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        let blurred = Most { blur: 12, ..sharp };
        let edge = |most| still(&file, most).expect("a picture").get_pixel(97, 50).0;
        // Just left of where red meets blue: all red when sharp.
        assert_eq!(edge(sharp), [0, 0, 255, 255]);
        let [blue, _, red, _] = edge(blurred);
        assert!(blue > 40 && red > 40, "{red} {blue}");
    }

    #[test]
    fn a_picture_is_read_small_with_blue_first() {
        let file = encoded(&halves(400, 200), image::ImageFormat::Png);
        let most = Most {
            fits: (100, 100),
            pixels: 1 << 20,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        let read = still(&file, most).expect("a picture");
        assert_eq!(read.dimensions(), (100, 50));
        // Red on the left, as GPUI wants it told: blue, green, red.
        assert_eq!(read.get_pixel(10, 25).0, [0, 0, 255, 255]);
        assert_eq!(read.get_pixel(90, 25).0, [255, 0, 0, 255]);
    }

    #[test]
    fn a_picture_too_large_or_unreadable_is_refused() {
        // A header alone: 30000 pixels each way, which nothing here reads.
        let mut header = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = b"IHDR".to_vec();
        chunk.extend(30_000_u32.to_be_bytes());
        chunk.extend(30_000_u32.to_be_bytes());
        // Eight bits of grey, and nothing unusual.
        chunk.extend([8, 0, 0, 0, 0]);
        header.extend(13_u32.to_be_bytes());
        header.extend(&chunk);
        header.extend(checksum(&chunk).to_be_bytes());
        // And where its pixels would start: a reader looks no further.
        header.extend(0_u32.to_be_bytes());
        header.extend(b"IDAT");
        header.extend(checksum(b"IDAT").to_be_bytes());
        assert_eq!(still(&header, ANY), Err(Refused::TooLarge(30_000, 30_000)));
        assert!(matches!(
            still(b"not a picture", ANY),
            Err(Refused::Unreadable(_))
        ));
        assert_eq!(
            Refused::TooLarge(3, 4).to_string(),
            "Too large to show here (3 × 4)"
        );
    }

    /// An animation of `colours`, each a frame of its own colour.
    fn animation(colours: &[[u8; 3]], delay_ms: u32) -> Vec<u8> {
        let mut file = Vec::new();
        {
            let mut encoder = image::codecs::gif::GifEncoder::new(&mut file);
            encoder
                .set_repeat(image::codecs::gif::Repeat::Infinite)
                .expect("a repeat");
            for [red, green, blue] in colours {
                let frame = RgbaImage::from_pixel(40, 20, image::Rgba([*red, *green, *blue, 255]));
                let delay = image::Delay::from_numer_denom_ms(delay_ms, 1);
                encoder
                    .encode_frame(image::Frame::from_parts(frame, 0, 0, delay))
                    .expect("a frame");
            }
        }
        file
    }

    #[test]
    fn an_animation_is_read_a_frame_at_a_time_and_round_again() {
        let file = std::sync::Arc::<[u8]>::from(animation(&[[255, 0, 0], [0, 0, 255]], 80));
        let most = Most {
            fits: (20, 20),
            pixels: 1 << 20,
            shape: None,
            blur: 0,
            focus: MIDDLE,
        };
        let Read::Moving(mut moving) = read(file, most).expect("read") else {
            panic!("two frames are an animation");
        };
        let colour = |shown: &Shown| shown.0.get_pixel(5, 5).0;
        let first = moving.next_frame().expect("the first");
        assert_eq!(first.0.dimensions(), (20, 10), "each frame scaled");
        assert_eq!(first.1, Duration::from_millis(80));
        // Red, then blue, and red again: blue first in what is drawn.
        assert_eq!(colour(&first), [0, 0, 255, 255]);
        assert_eq!(
            colour(&moving.next_frame().expect("the second")),
            [255, 0, 0, 255]
        );
        assert_eq!(
            colour(&moving.next_frame().expect("round")),
            [0, 0, 255, 255]
        );
        assert_eq!(
            colour(&moving.next_frame().expect("again")),
            [255, 0, 0, 255]
        );
    }

    #[test]
    fn an_animation_of_one_frame_is_a_picture_and_no_delay_is_a_tenth() {
        let one = std::sync::Arc::<[u8]>::from(animation(&[[0, 255, 0]], 80));
        assert!(matches!(read(one, ANY), Ok(Read::Still(_))));
        let hasty = std::sync::Arc::<[u8]>::from(animation(&[[0, 0, 0], [9, 9, 9]], 0));
        let Ok(Read::Moving(mut moving)) = read(hasty, ANY) else {
            panic!("an animation");
        };
        assert_eq!(moving.next_frame().expect("a frame").1, UNSAID);
        // A still picture of a kind that can move is a still picture.
        let png = std::sync::Arc::<[u8]>::from(encoded(&halves(8, 8), image::ImageFormat::Png));
        assert!(matches!(read(png, ANY), Ok(Read::Still(_))));
    }

    /// `file`, a JPEG, saying of itself that it is to be turned a quarter
    /// clockwise to be looked at: what a camera held upright writes.
    fn held_upright(file: &[u8]) -> Vec<u8> {
        let mut said = vec![0xff, 0xd8, 0xff, 0xe1, 0, 34];
        said.extend(b"Exif\0\0");
        // Little-endian TIFF, one entry: orientation (0x0112), a short, 6.
        said.extend(b"II*\0");
        said.extend(8_u32.to_le_bytes());
        said.extend(1_u16.to_le_bytes());
        said.extend(0x0112_u16.to_le_bytes());
        said.extend(3_u16.to_le_bytes());
        said.extend(1_u32.to_le_bytes());
        said.extend(6_u32.to_le_bytes());
        said.extend(0_u32.to_le_bytes());
        said.extend(file.get(2..).expect("a file"));
        said
    }

    #[test]
    fn a_picture_is_turned_the_way_its_file_says() {
        let lying = encoded(&halves(40, 20), image::ImageFormat::Jpeg);
        let upright = held_upright(&lying);
        let read = still(&upright, ANY).expect("a picture");
        // A quarter clockwise: the left half, red, is now on top.
        assert_eq!(read.dimensions(), (20, 40));
        let [blue, _, red, _] = read.get_pixel(10, 3).0;
        assert!(red > 200 && blue < 60, "{red} {blue}");
        assert_eq!(still(&lying, ANY).expect("as it is").dimensions(), (40, 20));
    }

    /// The checksum a PNG chunk ends in.
    fn checksum(chunk: &[u8]) -> u32 {
        let mut crc = u32::MAX;
        for byte in chunk {
            crc ^= u32::from(*byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xedb8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }
}
