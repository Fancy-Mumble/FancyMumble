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

fn opened(file: &[u8]) -> Result<image::DynamicImage, String> {
    image::load_from_memory(file)
        .map_err(|error| format!("That file is not a picture this can read: {error}"))
}

/// A face made from an image file's bytes: scaled to fit [`FACE_SIDE`]
/// and encoded as JPEG, which keeps it under the size a stock server
/// accepts.
pub(crate) fn avatar(file: &[u8]) -> Result<Vec<u8>, String> {
    let scaled = opened(file)?
        .resize(FACE_SIDE, FACE_SIDE, image::imageops::FilterType::Triangle)
        .into_rgb8();
    jpeg(&scaled, 85)
}

/// A banner made from an image file's bytes: the middle of it at a
/// banner's shape, small enough to travel in the comment that carries a
/// profile.
pub(crate) fn banner(file: &[u8]) -> Result<Vec<u8>, String> {
    let filled = opened(file)?
        .resize_to_fill(BANNER.0, BANNER.1, image::imageops::FilterType::Triangle)
        .into_rgb8();
    jpeg(&filled, 80)
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
}

/// What goes up for the picture in `file`: with `smaller`, a copy no
/// larger than [`SHARED_SIDE`] in its place; and a small one to stand in
/// for it. Nothing for a file that is no picture. An animation is never
/// made smaller: it would stop moving.
pub(crate) fn outgoing(file: &[u8], smaller: bool) -> Outgoing {
    let (Some(kind), Some(natural)) = (mime(file), dimensions(file)) else {
        return Outgoing::default();
    };
    let Ok(picture) = image::load_from_memory(file) else {
        return Outgoing {
            pixels: Some(natural),
            ..Outgoing::default()
        };
    };
    let fitted = |side: u32| picture.thumbnail(side, side).into_rgb8();
    let longer = natural.0.max(natural.1);
    // What lets the page behind it through would lose that as a JPEG.
    let plain = kind != "image/gif" && !picture.color().has_alpha();
    let smaller = (smaller && plain && longer > SHARED_SIDE)
        .then(|| fitted(SHARED_SIDE))
        .and_then(|small| Some((small.dimensions(), jpeg(&small, 85).ok()?)));
    let stand_in = (longer > STAND_IN_SIDE)
        .then(|| jpeg(&fitted(STAND_IN_SIDE), 78).ok())
        .flatten();
    Outgoing {
        pixels: Some(smaller.as_ref().map_or(natural, |(size, _)| *size)),
        smaller: smaller.map(|(_, bytes)| bytes),
        stand_in,
    }
}

/// The longer side of the picture kept for behind a conversation: as
/// much as a large window shows of it.
const WALL_SIDE: u32 = 1920;

/// The picture behind a conversation, made from an image file's bytes:
/// no larger than a window, whatever was chosen, since it is all of it
/// that is kept.
pub(crate) fn wallpaper(file: &[u8]) -> Result<Vec<u8>, String> {
    let picture = opened(file)?;
    let kept = if picture.width().max(picture.height()) > WALL_SIDE {
        picture.thumbnail(WALL_SIDE, WALL_SIDE)
    } else {
        picture
    };
    jpeg(&kept.into_rgb8(), 88)
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
    let picture = image::load_from_memory(file)
        .map_err(|error| format!("That picture could not be read: {error}"))?;
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
        assert_eq!(
            outgoing(&png, true),
            Outgoing {
                smaller: None,
                stand_in: outgoing(&png, false).stand_in,
                pixels: Some((1200, 600)),
            }
        );
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
}
