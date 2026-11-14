//! Encoded pictures, as GPUI draws them.

/// `bytes` as a picture GPUI can draw, if they are one of the formats a
/// picture arrives in. The format is read from the bytes: nothing else
/// says what it is.
pub(crate) fn picture(bytes: Vec<u8>) -> Option<gpui::Image> {
    let format = match bytes.as_slice() {
        [0x89, b'P', b'N', b'G', ..] => gpui::ImageFormat::Png,
        [0xff, 0xd8, 0xff, ..] => gpui::ImageFormat::Jpeg,
        [b'G', b'I', b'F', b'8', ..] => gpui::ImageFormat::Gif,
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
        ] => gpui::ImageFormat::Webp,
        _ => return None,
    };
    Some(gpui::Image::from_bytes(format, bytes))
}

/// The MIME type of the picture in `bytes`, by the same reading.
fn mime(bytes: &[u8]) -> Option<&'static str> {
    Some(match bytes {
        [0x89, b'P', b'N', b'G', ..] => "image/png",
        [0xff, 0xd8, 0xff, ..] => "image/jpeg",
        [b'G', b'I', b'F', b'8', ..] => "image/gif",
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
        ] => "image/webp",
        _ => return None,
    })
}

/// Whether `bytes`, the start of a file at least, are a picture this can
/// send in a message.
pub(crate) fn is_picture(bytes: &[u8]) -> bool {
    mime(bytes).is_some()
}

/// The largest picture file that is read whole.
const FILE_MOST: u64 = 20 * 1024 * 1024;

/// The file at `path` whole, if it is a picture small enough to be read
/// whole; `None` for anything else, a file that cannot be read included.
pub(crate) fn at(path: &std::path::Path) -> Option<Vec<u8>> {
    use std::io::Read as _;
    let mut file = std::fs::File::open(path).ok()?;
    if file.metadata().ok()?.len() > FILE_MOST {
        return None;
    }
    // The first bytes say what it is; the rest is read only if it is one.
    let mut bytes = vec![0; 16];
    let read = file.read(&mut bytes).ok()?;
    bytes.truncate(read);
    if !is_picture(&bytes) {
        return None;
    }
    let _ = file.read_to_end(&mut bytes).ok()?;
    Some(bytes)
}

/// How many pixels wide and tall the picture in `bytes` is once it is the
/// way up its file says it is looked at, as its header says: nothing of
/// the picture itself is decoded.
pub(crate) fn dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    use image::ImageDecoder as _;
    use image::metadata::Orientation;
    let mut decoder = image::ImageReader::new(std::io::Cursor::new(bytes))
        .with_guessed_format()
        .ok()?
        .into_decoder()
        .ok()?;
    let (width, height) = decoder.dimensions();
    if width == 0 || height == 0 {
        return None;
    }
    // A camera held upright writes the picture lying down, and says so.
    let on_its_side = matches!(
        decoder.orientation(),
        Ok(Orientation::Rotate90
            | Orientation::Rotate270
            | Orientation::Rotate90FlipH
            | Orientation::Rotate270FlipH)
    );
    Some(if on_its_side {
        (height, width)
    } else {
        (width, height)
    })
}

/// The size a picture of `natural` size is drawn at to fit into `most`,
/// keeping its shape. Never larger than it is.
pub(crate) fn fitted(natural: (u32, u32), most: (f32, f32)) -> (f32, f32) {
    #[allow(
        clippy::cast_precision_loss,
        reason = "a picture's side in pixels is nowhere near 2^24"
    )]
    let (width, height) = (natural.0 as f32, natural.1 as f32);
    let scale = (most.0 / width).min(most.1 / height).min(1.0);
    (width * scale, height * scale)
}

/// The size a picture of `natural` size is drawn at to cover `room`,
/// keeping its shape: the smallest that leaves none of the room bare. The
/// side that fits is the room's; the other hangs over.
pub(crate) fn covering(natural: (u32, u32), room: (f32, f32)) -> (f32, f32) {
    #[allow(
        clippy::cast_precision_loss,
        reason = "a picture's side in pixels is nowhere near 2^24"
    )]
    let (width, height) = (natural.0.max(1) as f32, natural.1.max(1) as f32);
    let scale = (room.0 / width).max(room.1 / height);
    (width * scale, height * scale)
}

/// The side a face is scaled to fit: what faces are drawn at, twice over,
/// and small enough for a server's size limit on pictures.
const FACE_SIDE: u32 = 256;
/// The shape of the banner on a card, twice over.
const BANNER: (u32, u32) = (680, 240);

fn jpeg(picture: &image::RgbImage, quality: u8) -> Result<Vec<u8>, String> {
    let mut encoded = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, quality)
        .encode_image(picture)
        .map_err(|error| format!("The picture could not be encoded: {error}"))?;
    Ok(encoded)
}

/// The most a picture decoded whole here may take: a picture of 64
/// megapixels at four bytes each. A file of a few kilobytes can claim to be
/// a picture of gigabytes; the decoder refuses rather than tries.
const DECODED_MOST: u64 = 256 << 20;

/// Held while a picture is decoded whole and what is made from it is made.
///
/// A large picture decoded whole takes a hundred megabytes and more, and
/// several ways in decode one: staging a file, sending one, choosing a face,
/// a banner or a wallpaper. Each runs on a thread of its own, so a user who
/// stages pictures while others go up had several decoded at once, each
/// with its copies: hundreds of megabytes over the budget. With this, one
/// is decoded at a time and the next waits for it. Nothing on the window's
/// thread decodes a picture, so the window never waits for it.
static DECODING: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// `make` run on the picture in `file`, decoded whole and turned the way up
/// its camera said, while no other picture is decoded whole. What `make`
/// returns should be small: the picture itself is let go of when it ends.
fn with_opened<R>(file: &[u8], make: impl FnOnce(image::DynamicImage) -> R) -> Result<R, String> {
    let _alone = DECODING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    opened(file).map(make)
}

/// The picture in `file`, decoded whole and upright. Only under [`DECODING`].
fn opened(file: &[u8]) -> Result<image::DynamicImage, String> {
    use image::ImageDecoder as _;
    let unreadable = |error: image::ImageError| format!("That file is not a picture this can read: {error}");
    let mut reader = image::ImageReader::new(std::io::Cursor::new(file))
        .with_guessed_format()
        .map_err(|error| unreadable(error.into()))?;
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(DECODED_MOST);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(unreadable)?;
    // The way up a camera says it was held, applied here, once: what is
    // made from it is written without that note, upright.
    let orientation = decoder.orientation().ok();
    let mut picture = image::DynamicImage::from_decoder(decoder).map_err(unreadable)?;
    if let Some(orientation) = orientation {
        picture.apply_orientation(orientation);
    }
    Ok(picture)
}

/// A face made from an image file's bytes: scaled to fit [`FACE_SIDE`]
/// and encoded as JPEG, which keeps it under the size a stock server
/// accepts.
pub(crate) fn avatar(file: &[u8]) -> Result<Vec<u8>, String> {
    let scaled = with_opened(file, |picture| {
        picture
            .resize(FACE_SIDE, FACE_SIDE, image::imageops::FilterType::Triangle)
            .into_rgb8()
    })?;
    jpeg(&scaled, 85)
}

/// The side of a role's icon: a square that scales down into a pill.
const ROLE_ICON_SIDE: u32 = 128;

/// A role's icon made from an image file's bytes: the middle of it,
/// square, at [`ROLE_ICON_SIDE`], kept with its transparency as PNG.
pub(crate) fn role_icon(file: &[u8]) -> Result<Vec<u8>, String> {
    let square = with_opened(file, |picture| {
        picture.resize_to_fill(
            ROLE_ICON_SIDE,
            ROLE_ICON_SIDE,
            image::imageops::FilterType::Triangle,
        )
    })?;
    let mut png = Vec::new();
    square
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .map_err(|error| format!("The picture could not be encoded: {error}"))?;
    Ok(png)
}

/// A banner made from an image file's bytes: the middle of it at a
/// banner's shape, small enough to travel in the comment that carries a
/// profile.
pub(crate) fn banner(file: &[u8]) -> Result<Vec<u8>, String> {
    let filled = with_opened(file, |picture| {
        picture
            .resize_to_fill(BANNER.0, BANNER.1, image::imageops::FilterType::Triangle)
            .into_rgb8()
    })?;
    jpeg(&filled, 80)
}

/// The shorter side of the copy a waiting file's tile shows: a 150 pixel
/// tile covered at twice its size. And the longest its other side may be,
/// for a picture far longer than it is wide.
const TILE_SIDE: u32 = 300;
const TILE_LONGEST: u32 = 1200;

/// What staging a file needs of a picture.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Staging {
    /// A small copy for its tile, a JPEG: its shorter side [`TILE_SIDE`],
    /// or all of it where it is smaller.
    pub tile: Option<Vec<u8>>,
    /// How many bytes it would go up as made smaller, where it would be.
    pub smaller: Option<u64>,
}

/// What staging shows of the picture in `file`, from one decode of it: its
/// tile, and the size it would go up as made smaller, worked out exactly by
/// making that copy (as sending would) and keeping only its length.
pub(crate) fn staged(file: &[u8]) -> Staging {
    let (Some(kind), Some(natural)) = (mime(file), dimensions(file)) else {
        return Staging::default();
    };
    let made = with_opened(file, |picture| {
        let (width, height) = (picture.width().max(1), picture.height().max(1));
        let short = width.min(height);
        // Scaled so its shorter side is the tile's, its longer no longer
        // than the most; never enlarged.
        let scale = (f64::from(TILE_SIDE) / f64::from(short))
            .min(f64::from(TILE_LONGEST) / f64::from(width.max(height)))
            .min(1.0);
        #[expect(
            clippy::cast_possible_truncation,
            clippy::cast_sign_loss,
            reason = "no larger than the side it was scaled down from"
        )]
        let side = |of: u32| ((f64::from(of) * scale).round() as u32).max(1);
        let tile = picture.thumbnail(side(width), side(height)).into_rgb8();
        let smaller = (made_smaller(kind, &picture, natural)).then(|| picture.thumbnail(SHARED_SIDE, SHARED_SIDE).into_rgb8());
        // The whole picture goes before anything is encoded.
        drop(picture);
        (tile, smaller)
    });
    let Ok((tile, smaller)) = made else {
        return Staging::default();
    };
    Staging {
        tile: jpeg(&tile, 85).ok(),
        smaller: smaller
            .and_then(|small| jpeg(&small, 85).ok())
            .and_then(|bytes| u64::try_from(bytes.len()).ok()),
    }
}

/// Whether a picture of this kind goes up made smaller when that is asked
/// for: one larger than [`SHARED_SIDE`] that nothing shows through and that
/// does not move.
fn made_smaller(kind: &str, picture: &image::DynamicImage, natural: (u32, u32)) -> bool {
    // What lets the page behind it through would lose that as a JPEG; an
    // animation would stop moving.
    kind != "image/gif" && !picture.color().has_alpha() && natural.0.max(natural.1) > SHARED_SIDE
}

/// The longer side a picture shared as a file is made no larger than,
/// where the sender asks for a smaller one; and the side of the small copy
/// that stands in for it in a conversation.
const SHARED_SIDE: u32 = 2560;
const STAND_IN_SIDE: u32 = 480;

/// What goes up when a picture is shared as a file.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct Outgoing {
    /// A smaller copy to send in its place, where one was asked for and
    /// the picture is large enough for it to be one: a JPEG.
    pub smaller: Option<Vec<u8>>,
    /// A small copy that stands in for it where it is shown: a JPEG.
    pub stand_in: Option<Vec<u8>>,
    /// How large what goes up is, in pixels.
    pub pixels: Option<(u32, u32)>,
    /// What a stock Mumble client is to be shown of it: made from the same
    /// decoded picture, no larger than a message's picture may be.
    pub legacy: Option<mumble_tauri_lib::engine_api::legacy_picture::LegacyPicture>,
}

/// What goes up for the picture in `file`: with `smaller`, a copy no
/// larger than [`SHARED_SIDE`] in its place; and a small one to stand in
/// for it. Nothing for a file that is no picture. An animation is never
/// made smaller: it would stop moving. The picture is decoded once, turned
/// the way up its camera said, and let go of once all of it is made.
pub(crate) fn outgoing(file: &[u8], smaller: bool) -> Outgoing {
    let (Some(kind), Some(natural)) = (mime(file), dimensions(file)) else {
        return Outgoing::default();
    };
    let longer = natural.0.max(natural.1);
    // Everything is made from the one decode: the legacy copy and the
    // stand-in from the smaller copy where there is one (both are smaller
    // still), and the whole picture is let go of before anything is
    // encoded.
    let made = with_opened(file, |picture| {
        let small = (smaller && made_smaller(kind, &picture, natural)).then(|| {
            image::DynamicImage::ImageRgb8(picture.thumbnail(SHARED_SIDE, SHARED_SIDE).into_rgb8())
        });
        let source = small.as_ref().unwrap_or(&picture);
        let legacy = mumble_tauri_lib::engine_api::legacy_picture::LegacyPicture::new(source, file);
        let stand_in = (longer > STAND_IN_SIDE)
            .then(|| source.thumbnail(STAND_IN_SIDE, STAND_IN_SIDE).into_rgb8());
        (small.map(image::DynamicImage::into_rgb8), stand_in, legacy)
    });
    let Ok((small, stand_in, legacy)) = made else {
        return Outgoing {
            pixels: Some(natural),
            ..Outgoing::default()
        };
    };
    let smaller = small.and_then(|small| Some((small.dimensions(), jpeg(&small, 85).ok()?)));
    Outgoing {
        pixels: Some(smaller.as_ref().map_or(natural, |(size, _)| *size)),
        smaller: smaller.map(|(_, bytes)| bytes),
        stand_in: stand_in.and_then(|small| jpeg(&small, 78).ok()),
        legacy: Some(legacy),
    }
}

/// The longer side of the picture kept for behind a conversation: as
/// much as a large window shows of it.
const WALL_SIDE: u32 = 1920;

/// The picture behind a conversation, made from an image file's bytes:
/// no larger than a window, whatever was chosen, since it is all of it
/// that is kept.
pub(crate) fn wallpaper(file: &[u8]) -> Result<Vec<u8>, String> {
    let kept = with_opened(file, |picture| {
        if picture.width().max(picture.height()) > WALL_SIDE {
            picture.thumbnail(WALL_SIDE, WALL_SIDE)
        } else {
            picture
        }
        .into_rgb8()
    })?;
    jpeg(&kept, 88)
}

/// `picture`, an encoded picture, as the address that holds it whole.
pub(crate) fn data_uri(picture: &[u8]) -> Option<String> {
    use base64::Engine as _;
    let mut address = format!("data:{};base64,", mime(picture)?);
    base64::engine::general_purpose::STANDARD.encode_string(picture, &mut address);
    Some(address)
}

/// How long the message carrying `encoded` bytes of picture is: the bytes
/// in base64, inside the tag around them.
fn message_len(encoded: usize, mime: &str) -> usize {
    encoded.div_ceil(3) * 4 + r#"<img src="data:;base64,"/>"#.len() + mime.len()
}

fn tag(encoded: &[u8], mime: &str) -> String {
    use base64::Engine as _;
    let mut html = String::with_capacity(message_len(encoded.len(), mime));
    html.push_str(r#"<img src="data:"#);
    html.push_str(mime);
    html.push_str(";base64,");
    base64::engine::general_purpose::STANDARD.encode_string(encoded, &mut html);
    html.push_str(r#""/>"#);
    html
}

/// The sides a picture too large for a message is scaled to fit, and the
/// JPEG qualities tried at each, best first.
const SIDES: &[u32] = &[1600, 1200, 900, 640, 480, 320, 200];
const QUALITIES: &[u8] = &[85, 70, 50];

/// The message that sends the picture in `file`: an `<img>` holding it.
///
/// A file that fits `limit` bytes of message goes as it is, so an
/// animation stays one. A larger one is scaled down and encoded as JPEG
/// until it fits. A `limit` of zero is no limit.
pub(crate) fn message_html(file: &[u8], limit: usize) -> Result<String, String> {
    let kind = mime(file).ok_or("That file is not a picture this can send.")?;
    if limit == 0 || message_len(file.len(), kind) <= limit {
        return Ok(tag(file, kind));
    }
    // Decoded whole once, alone, and kept only at the largest size tried.
    let largest = SIDES[0];
    let picture = with_opened(file, |picture| {
        if picture.width().max(picture.height()) > largest {
            picture.resize(largest, largest, image::imageops::FilterType::Triangle)
        } else {
            picture
        }
    })?;
    let mut encoded = Vec::new();
    for side in SIDES {
        // Never scaled up: a small picture that is heavy only loses quality.
        let scaled = if picture.width().max(picture.height()) > *side {
            picture.resize(*side, *side, image::imageops::FilterType::Triangle)
        } else {
            picture.clone()
        }
        .into_rgb8();
        for quality in QUALITIES {
            encoded.clear();
            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, *quality)
                .encode_image(&scaled)
                .map_err(|error| format!("The picture could not be encoded: {error}"))?;
            if message_len(encoded.len(), "image/jpeg") <= limit {
                return Ok(tag(&encoded, "image/jpeg"));
            }
        }
    }
    Err("That picture is too large for this server, however small it is made.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_picture_file_becomes_a_small_face_and_a_banner() {
        let mut png = Vec::new();
        image::ImageBuffer::from_pixel(1200, 600, image::Rgb([200u8, 40, 40]))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("a png");
        let face = avatar(&png).expect("a face");
        assert!(face.starts_with(&[0xff, 0xd8, 0xff]), "a jpeg");
        assert_eq!(dimensions(&face), Some((256, 128)), "scaled to fit");
        assert!(face.len() < 64 * 1024, "well under a server's limit");
        assert!(avatar(b"not a picture").is_err());
        // A banner is filled, whatever shape the picture was.
        let over = banner(&png).expect("a banner");
        assert_eq!(dimensions(&over), Some((680, 240)));
        assert!(over.len() < 64 * 1024);
        let address = data_uri(&over).expect("an address");
        assert!(address.starts_with("data:image/jpeg;base64,/9j/"));
        assert_eq!(data_uri(b"words"), None);
        // Shared as a file: nothing is made of what is small already.
        let made = outgoing(&png, true);
        assert_eq!(made.smaller, None);
        assert_eq!(made.stand_in, outgoing(&png, false).stand_in);
        assert_eq!(made.pixels, Some((1200, 600)));
        // And from the same picture, what a stock client is shown.
        assert_eq!(made.legacy.map(|legacy| legacy.size()), Some((1200, 600)));
        assert!(
            outgoing(&png, true).stand_in.is_some(),
            "but a small copy is"
        );
        assert_eq!(outgoing(b"words", true), Outgoing::default());
        // What goes behind a conversation is no larger than a window.
        let mut large = Vec::new();
        image::ImageBuffer::from_pixel(4000, 1000, image::Rgb([9u8, 9, 9]))
            .write_to(
                &mut std::io::Cursor::new(&mut large),
                image::ImageFormat::Png,
            )
            .expect("a png");
        // A large one is made smaller where that is asked for, and says
        // how large what goes up is.
        let shared = outgoing(&large, true);
        let smaller = shared.smaller.expect("a smaller copy");
        assert_eq!(dimensions(&smaller), Some((2560, 640)));
        assert_eq!(shared.pixels, Some((2560, 640)));
        assert_eq!(outgoing(&large, false).pixels, Some((4000, 1000)));
        assert!(outgoing(&large, false).smaller.is_none());
        let wall = wallpaper(&large).expect("a wallpaper");
        assert_eq!(dimensions(&wall), Some((1920, 480)));
        assert_eq!(
            dimensions(&wallpaper(&png).expect("as it is")),
            Some((1200, 600))
        );
    }

    #[test]
    fn a_picture_covers_its_room_at_its_own_shape() {
        assert_eq!(covering((100, 160), (200.0, 200.0)), (200.0, 320.0));
        assert_eq!(covering((160, 100), (200.0, 200.0)), (320.0, 200.0));
        assert_eq!(covering((50, 50), (200.0, 100.0)), (200.0, 200.0));
        // Smaller than the room: enlarged to fill it, where fitting never is.
        assert_eq!(covering((10, 10), (40.0, 20.0)), (40.0, 40.0));
    }

    /// A picture that compresses badly: `side` square, every pixel its own.
    fn noisy_png(side: u32) -> Vec<u8> {
        let mut seed = 0x2545_f491_u32;
        let picture = image::RgbImage::from_fn(side, side, |_, _| {
            seed ^= seed << 13;
            seed ^= seed >> 17;
            seed ^= seed << 5;
            let [r, g, b, _] = seed.to_le_bytes();
            image::Rgb([r, g, b])
        });
        let mut file = Vec::new();
        image::DynamicImage::ImageRgb8(picture)
            .write_to(
                &mut std::io::Cursor::new(&mut file),
                image::ImageFormat::Png,
            )
            .expect("a png");
        file
    }

    #[test]
    fn a_picture_that_fits_is_sent_as_it_is() {
        let file = noisy_png(8);
        let html = message_html(&file, 0).expect("a message");
        assert!(html.starts_with(r#"<img src="data:image/png;base64,"#));
        assert_eq!(html.len(), message_len(file.len(), "image/png"));
        assert_eq!(
            message_html(&file, html.len()).as_deref(),
            Ok(html.as_str())
        );
        // And it is read back as the same picture.
        let rich = crate::rich::Rich::parse(&html);
        assert_eq!(rich.images, [file]);
    }

    #[test]
    fn a_picture_too_large_is_scaled_until_it_fits() {
        let file = noisy_png(400);
        let limit = 128 * 1024;
        assert!(
            message_len(file.len(), "image/png") > limit,
            "too large as it is"
        );
        let html = message_html(&file, limit).expect("a message");
        assert!(html.len() <= limit);
        assert!(html.starts_with(r#"<img src="data:image/jpeg;base64,"#));
        assert!(message_html(&file, 600).is_err(), "nothing fits in that");
        assert!(message_html(b"not a picture", 0).is_err());
    }

    #[test]
    fn a_picture_says_how_large_it_is_and_is_fitted_without_growing() {
        assert_eq!(dimensions(&noisy_png(12)), Some((12, 12)));
        assert_eq!(dimensions(b"\x89PNG\r\n\x1a\n...."), None, "only a header");
        assert_eq!(dimensions(b""), None);
        // Wider than the room: the width is what limits it.
        assert_eq!(fitted((840, 320), (420.0, 320.0)), (420.0, 160.0));
        // Taller than the room: the height is.
        assert_eq!(fitted((320, 640), (420.0, 320.0)), (160.0, 320.0));
        assert_eq!(fitted((40, 20), (420.0, 320.0)), (40.0, 20.0), "not grown");
    }

    #[test]
    fn a_picture_is_recognised_by_its_first_bytes() {
        let format = |bytes: &[u8]| picture(bytes.to_vec()).map(|image| image.format());
        assert_eq!(
            format(b"\x89PNG\r\n\x1a\n...."),
            Some(gpui::ImageFormat::Png)
        );
        assert_eq!(
            format(b"\xff\xd8\xff\xe0...."),
            Some(gpui::ImageFormat::Jpeg)
        );
        assert_eq!(format(b"GIF89a...."), Some(gpui::ImageFormat::Gif));
        assert_eq!(
            format(b"RIFF\x00\x00\x00\x00WEBPVP8 "),
            Some(gpui::ImageFormat::Webp)
        );
        assert_eq!(format(b"<html>"), None, "not a picture");
        assert_eq!(format(b""), None);
    }

    #[test]
    fn two_pictures_asked_for_at_once_are_decoded_one_after_the_other() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let file = noisy_png(64);
        let (inside, most) = (AtomicUsize::new(0), AtomicUsize::new(0));
        // How many are decoded while this one is, at the most.
        let read = || {
            with_opened(&file, |picture| {
                let now = inside.fetch_add(1, Ordering::SeqCst) + 1;
                let _ = most.fetch_max(now, Ordering::SeqCst);
                std::thread::sleep(std::time::Duration::from_millis(40));
                let _ = inside.fetch_sub(1, Ordering::SeqCst);
                picture.width()
            })
        };
        std::thread::scope(|scope| {
            let readers: Vec<_> = (0..4).map(|_| scope.spawn(read)).collect();
            for reader in readers {
                assert_eq!(reader.join().expect("a reader"), Ok(64));
            }
        });
        assert_eq!(most.load(Ordering::SeqCst), 1, "never two decoded at once");
    }

    #[test]
    fn a_staged_picture_gets_a_tile_and_the_size_it_would_go_up_as() {
        let mut large = Vec::new();
        image::ImageBuffer::from_pixel(4000, 1000, image::Rgb([9u8, 90, 9]))
            .write_to(&mut std::io::Cursor::new(&mut large), image::ImageFormat::Png)
            .expect("a png");
        let staging = staged(&large);
        let tile = staging.tile.expect("a tile");
        // Its shorter side is the tile's, its longer within the most.
        assert_eq!(dimensions(&tile), Some((1200, 300)));
        let smaller = outgoing(&large, true).smaller.expect("a smaller copy");
        assert_eq!(staging.smaller, u64::try_from(smaller.len()).ok());
        // A small one is shown whole, and is not made smaller.
        let small = staged(&noisy_png(40));
        assert_eq!(small.tile.as_deref().and_then(dimensions), Some((40, 40)));
        assert_eq!(small.smaller, None);
        assert_eq!(staged(b"words"), Staging::default());
    }
}
