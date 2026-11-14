//! Several pictures sent inside one message, where the server keeps no
//! files: as the web client sends pictures put in its composer together
//! (`fitInlineImages`), they share what the server allows one message, and
//! a conversation draws them as one block of tiles.

/// Below this many characters a picture's share is not worth sending: the
/// web client's floor.
const LEAST_SHARE: usize = 5_000;

/// One message carrying every picture in `files`, each fitted into an even
/// share of `limit` characters (0 for no limit); `None` where a share would
/// be too small for a picture worth sending, and the pictures should go a
/// message each instead.
///
/// # Errors
///
/// When a file is no picture this can send.
pub(crate) fn message(files: &[Vec<u8>], limit: usize) -> Result<Option<String>, String> {
    if files.is_empty() {
        return Ok(None);
    }
    let share = if limit == 0 { 0 } else { limit / files.len() };
    if limit > 0 && share < LEAST_SHARE {
        return Ok(None);
    }
    let mut html = String::new();
    for file in files {
        html.push_str(&crate::picture::message_html(file, share)?);
    }
    Ok((limit == 0 || html.len() <= limit).then_some(html))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn png(side: u32) -> Vec<u8> {
        let mut bytes = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_fn(side, side, |x, y| {
            image::Rgb([
                (x * 7 % 256) as u8,
                (y * 13 % 256) as u8,
                ((x ^ y) % 256) as u8,
            ])
        }))
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("a png");
        bytes
    }

    #[test]
    fn pictures_share_one_message_within_the_limit() {
        let files = vec![png(300), png(300), png(300)];
        let html = message(&files, 131_072)
            .expect("pictures")
            .expect("one message");
        assert!(html.len() <= 131_072);
        assert_eq!(html.matches("<img").count(), 3);
        assert_eq!(crate::rich::Rich::parse(&html).images.len(), 3);
    }

    #[test]
    fn too_many_for_the_limit_go_a_message_each() {
        let files = vec![png(40); 30];
        assert_eq!(message(&files, 131_072), Ok(None), "4,369 characters each");
        assert!(message(&files, 0).expect("pictures").is_some(), "no limit");
        assert!(message(&[b"words".to_vec(), png(10)], 131_072).is_err());
    }
}
