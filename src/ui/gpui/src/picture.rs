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

#[cfg(test)]
mod tests {
    use super::*;

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
