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
