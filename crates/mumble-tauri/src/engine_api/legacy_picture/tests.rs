#![allow(clippy::unwrap_used, reason = "unwrap is acceptable in test code")]

use super::*;
use crate::engine_api::gifs::MessageLimits;

/// A picture that compresses like a photograph: smooth, with grain.
fn photo(width: u32, height: u32) -> DynamicImage {
    let mut seed = 0x2545_f491_u32;
    DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, y| {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let grain = (seed & 0x1f) as u8;
        let r = u8::try_from((x * 200 / width.max(1)) % 256).unwrap();
        let g = u8::try_from((y * 200 / height.max(1)) % 256).unwrap();
        image::Rgb([r.saturating_add(grain), g.saturating_add(grain), 90u8.saturating_add(grain)])
    }))
}

/// A test card: three flat colours.
fn card(width: u32, height: u32) -> DynamicImage {
    DynamicImage::ImageRgb8(RgbImage::from_fn(width, height, |x, _| match x * 3 / width {
        0 => image::Rgb([200, 30, 30]),
        1 => image::Rgb([240, 240, 240]),
        _ => image::Rgb([20, 20, 120]),
    }))
}

fn file_of(picture: &DynamicImage, format: image::ImageFormat) -> Vec<u8> {
    let mut bytes = Vec::new();
    picture.write_to(&mut std::io::Cursor::new(&mut bytes), format).unwrap();
    bytes
}

fn decoded(copy: &Encoded) -> DynamicImage {
    image::load_from_memory(&copy.bytes).unwrap()
}

/// The picture inside a fenced block, decoded.
fn picture_in(block: &str) -> DynamicImage {
    use base64::Engine as _;
    let start = block.find(";base64,").unwrap() + ";base64,".len();
    let end = start + block[start..].find('"').unwrap();
    let bytes = base64::engine::general_purpose::STANDARD.decode(&block[start..end]).unwrap();
    image::load_from_memory(&bytes).unwrap()
}

fn part(name: &str, picture: Option<LegacyPicture>, link: Option<&str>) -> Part {
    Part {
        mark: format!("<!-- FANCY_FILE:{name} -->"),
        line: format!("{name} (5 bytes), shared as a file"),
        picture,
        name: name.to_owned(),
        link: link.map(str::to_owned),
    }
}

fn limits(image: u32) -> MessageLimits {
    MessageLimits {
        max_image_message_length: image,
        ..MessageLimits::default()
    }
}

fn length(text: &str) -> usize {
    text.encode_utf16().count()
}

#[test]
fn the_message_is_the_marks_and_then_each_copy_fenced_as_the_web_client_writes_it() {
    let picture = photo(400, 250);
    let kept = LegacyPicture::new(&picture, &file_of(&picture, image::ImageFormat::Png));
    let body = message("look", &[part("a.png", Some(kept), None)], MessageLimits::default(), true);
    let (before, block) = body.rsplit_once('\n').unwrap();
    assert_eq!(before, "look\n<!-- FANCY_FILE:a.png -->", "the line gives way to the copy");
    assert!(block.starts_with(r#"<!-- FANCY_LEGACY --><img src="data:image/"#), "{}", &block[..60]);
    assert!(block.ends_with(r#"" alt="a.png" /><!-- /FANCY_LEGACY -->"#));
    assert_eq!(picture_in(block).dimensions(), (400, 250), "small enough to go whole");
    // A Fancy client reads the marks alone.
    assert_eq!(fancy_utils::html::strip_legacy_fallback(&body), before);
}

#[test]
fn a_public_file_has_its_link_under_the_copy() {
    let picture = card(300, 200);
    let kept = LegacyPicture::new(&picture, &[]);
    let body = message(
        "",
        &[part("a&b.png", Some(kept), Some("https://files.example/s/a?x=1&y=2"))],
        MessageLimits::default(),
        true,
    );
    assert!(body.contains(
        r#"" alt="a&amp;b.png" /><br><a href="https://files.example/s/a?x=1&amp;y=2">a&amp;b.png</a><!-- /FANCY_LEGACY -->"#
    ));
}

#[test]
fn the_whole_message_stays_within_every_limit_and_uses_most_of_it() {
    let picture = photo(1400, 900);
    let kept = LegacyPicture::new(&picture, &[]);
    for limit in [20_000_u32, 60_000, 131_072, 300_000] {
        let parts = [part("a.jpg", Some(kept.clone()), None), part("notes.txt", None, None)];
        let body = message("words", &parts, limits(limit), true);
        assert!(length(&body) <= limit as usize, "{} over {limit}", length(&body));
        assert!(crate::engine_api::gifs::accepted(&body, limits(limit)));
        assert!(body.contains("<img"), "a copy at {limit}");
        assert!(body.contains("notes.txt (5 bytes)"), "the other file keeps its line");
        // Most of the room is used: a copy is not a thumbnail.
        let shown = picture_in(&body[body.find("<!-- FANCY_LEGACY --><img").unwrap()..]);
        if shown.width() < 1400 {
            assert!(length(&body) * 10 >= limit as usize * 7, "{} of {limit}", length(&body));
        }
    }
}

#[test]
fn several_copies_share_the_room_and_a_stacked_height() {
    let picture = photo(900, 900);
    let kept = LegacyPicture::new(&picture, &[]);
    let parts = [
        part("a.jpg", Some(kept.clone()), None),
        part("b.jpg", Some(kept.clone()), None),
        part("c.jpg", Some(kept), None),
    ];
    let body = message("", &parts, MessageLimits::default(), true);
    assert!(length(&body) <= 131_072);
    let blocks: Vec<&str> = body.split('\n').filter(|line| line.contains("<img")).collect();
    assert_eq!(blocks.len(), 3);
    for block in blocks {
        assert!(picture_in(block).height() <= 600, "1800 shared by three");
    }
}

#[test]
fn too_little_room_or_no_markup_keeps_the_line() {
    let picture = photo(600, 400);
    let kept = LegacyPicture::new(&picture, &[]);
    let parts = [part("a.jpg", Some(kept), None)];
    let plain = "<!-- FANCY_FILE:a.jpg -->\n<!-- FANCY_LEGACY -->a.jpg (5 bytes), shared as a file<!-- /FANCY_LEGACY -->";
    assert_eq!(message("", &parts, limits(5_000), true), plain, "a tiny limit");
    let no_html = MessageLimits {
        allow_html: false,
        ..MessageLimits::default()
    };
    assert_eq!(message("", &parts, no_html, true), "<!-- FANCY_FILE:a.jpg -->", "HTML off: the bare marks");
    assert_eq!(message("", &parts, MessageLimits::default(), false), plain, "copies not wanted");
}

#[test]
fn size_is_kept_and_quality_given_up_first() {
    let picture = photo(800, 500);
    let fitter = Fitter::new(&picture, LEGACY_BOX, usize::MAX);
    let at_floor = jpeg(&fitter.opaque, QUALITY_FLOOR).unwrap();
    // Room for the full size at the lowest quality worth sending: full size.
    let room = at_floor.address_len() + 16;
    let copy = LegacyPicture::new(&picture, &[]).fitted(room, LEGACY_BOX.1).unwrap();
    assert_eq!((copy.kind, copy.size), ("image/jpeg", (800, 500)));
    assert!(copy.address_len() <= room);
    // A little less, and it is made smaller rather than worse.
    let copy = LegacyPicture::new(&picture, &[]).fitted(room - 2_000, LEGACY_BOX.1).unwrap();
    assert!(copy.size.0 < 800, "{:?}", copy.size);
    assert!(copy.address_len() <= room - 2_000);
}

#[test]
fn a_large_picture_is_held_to_the_box() {
    let kept = LegacyPicture::new(&photo(3200, 1200), &[]);
    assert_eq!(kept.size(), (1600, 600));
    let copy = kept.fitted(usize::MAX, LEGACY_BOX.1).unwrap();
    assert_eq!(copy.size, (1600, 600));
    assert_eq!(stacked_height(1), 1000);
    assert_eq!(stacked_height(4), 450);
}

#[test]
fn few_colours_go_as_png_and_a_photograph_as_jpeg() {
    let copy = LegacyPicture::new(&card(1200, 700), &[]).fitted(131_000, 1000).unwrap();
    assert_eq!((copy.kind, copy.size), ("image/png", (1200, 700)));
    let copy = LegacyPicture::new(&photo(1200, 700), &[]).fitted(131_000, 1000).unwrap();
    assert_eq!(copy.kind, "image/jpeg");
}

#[test]
fn what_shows_through_is_kept_as_png_or_laid_on_white() {
    let mut seed = 7_u32;
    let clear = DynamicImage::ImageRgba8(image::RgbaImage::from_fn(500, 300, |x, _| {
        seed = seed.wrapping_mul(1_103_515_245).wrapping_add(12_345);
        let alpha = if x < 50 { 0 } else { 255 };
        let [r, g, b, _] = seed.to_le_bytes();
        image::Rgba([r, g, b, alpha])
    }));
    let kept = LegacyPicture::new(&clear, &[]);
    let png = kept.fitted(usize::MAX, 1000).unwrap();
    assert_eq!(png.kind, "image/png");
    assert_eq!(decoded(&png).to_rgba8().get_pixel(0, 0).0[3], 0, "still clear");
    // Too heavy for a PNG: a JPEG, white where it was clear.
    let jpeg = kept.fitted(60_000, 1000).unwrap();
    assert_eq!(jpeg.kind, "image/jpeg");
    let [r, g, b] = decoded(&jpeg).to_rgb8().get_pixel(5, 150).0;
    assert!(r > 235 && g > 235 && b > 235, "{r} {g} {b}");
}

/// A two-frame GIF: red, then blue.
fn animation(width: u32, height: u32) -> Vec<u8> {
    use image::codecs::gif::{GifEncoder, Repeat};
    let mut bytes = Vec::new();
    {
        let mut encoder = GifEncoder::new(&mut bytes);
        encoder.set_repeat(Repeat::Infinite).unwrap();
        for colour in [[220, 20, 20, 255], [20, 20, 220, 255]] {
            let frame = image::RgbaImage::from_pixel(width, height, image::Rgba(colour));
            encoder.encode_frame(image::Frame::new(frame)).unwrap();
        }
    }
    bytes
}

#[test]
fn an_animation_that_fits_goes_as_it_is_and_one_that_does_not_as_its_first_frame() {
    let small = animation(120, 80);
    let kept = LegacyPicture::new(&image::load_from_memory(&small).unwrap(), &small);
    let copy = kept.fitted(131_000, 1000).unwrap();
    assert_eq!(copy.kind, "image/gif");
    assert_eq!(copy.bytes, small, "still moving");

    let wide = animation(1800, 200);
    let kept = LegacyPicture::new(&image::load_from_memory(&wide).unwrap(), &wide);
    let copy = kept.fitted(131_000, 1000).unwrap();
    assert_ne!(copy.kind, "image/gif", "larger than the box");
    let [r, _, b] = decoded(&copy).to_rgb8().get_pixel(10, 10).0;
    assert!(r > 180 && b < 80, "the first frame: {r} {b}");
}

#[test]
fn a_camera_picture_that_must_be_turned_is_not_sent_as_it_is() {
    assert!(upright(&file_of(&photo(20, 10), image::ImageFormat::Jpeg)));
    assert!(!upright(b"not a picture"));
    // Only the types a stock client reads go as they are.
    assert_eq!(legacy_kind(b"RIFF\0\0\0\0WEBPVP8 "), None);
}

#[test]
fn the_name_is_cut_short_and_escaped() {
    let long = format!("{}.png", "\"".repeat(100));
    let block = fenced("data:x", &long, None);
    assert!(block.contains(&format!("alt=\"{}\"", "&quot;".repeat(64))), "{block}");
}

#[test]
fn an_album_sends_copies_of_its_first_four_and_names_the_rest() {
    let kept = LegacyPicture::new(&photo(1200, 800), &[]);
    for count in [4_usize, 11] {
        let parts: Vec<Part> = (0..count)
            .map(|n| part(&format!("p{n}.jpg"), Some(kept.clone()), None))
            .collect();
        let body = message("", &parts, MessageLimits::default(), true);
        assert!(length(&body) <= 131_072, "{count}: {}", length(&body));
        let copies: Vec<&str> = body.split('\n').filter(|line| line.contains("<img")).collect();
        assert_eq!(copies.len(), 4, "{count}");
        for copy in &copies {
            let shown = picture_in(copy);
            assert!(shown.height() <= 450, "{count}: {:?}", shown.dimensions());
            assert!(shown.width() >= 300, "{count}: {:?}", shown.dimensions());
        }
        // Every picture past the fourth keeps its line.
        for n in 4..count {
            assert!(body.contains(&format!("p{n}.jpg (5 bytes), shared as a file")), "{n}");
        }
        assert!(!body.contains("p0.jpg (5 bytes)"), "a copy, not a line");
    }
}

#[test]
fn a_file_without_a_copy_is_named_as_the_web_client_names_it() {
    assert_eq!(
        file_line("a<b>.png", Some(3_984_588), None, false),
        "\u{1f5bc}\u{fe0f} a&lt;b&gt;.png (3.8 MiB)"
    );
    assert_eq!(
        file_line("report.pdf", Some(2_200_000), Some("https://f.example/d?a=1&b=2"), false),
        "\u{1f4ce} <a href=\"https://f.example/d?a=1&amp;b=2\">report.pdf</a> (2.1 MiB)"
    );
    assert_eq!(file_line("x.png", None, None, true), "\u{1f5bc}\u{fe0f} x.png \u{1f512}");
    assert_eq!(format_bytes(812), "812 B");
    assert_eq!(format_bytes(1_536), "1.5 KiB");
    assert_eq!(format_bytes(12 * 1024 * 1024 + 5), "12 MiB");
}

#[test]
fn several_files_are_one_message_shaped_as_the_web_client_shapes_it() {
    // `withLegacyFallback(\`${message}\n${markers.join("\n")}\`, ...)` for a
    // document and a picture with no room for a copy: the marks a line
    // each, then the lines fenced together, joined by a break.
    let parts = [part("a.pdf", None, None), part("b.png", None, None)];
    assert_eq!(
        message("said", &parts, MessageLimits::default(), true),
        "said\n<!-- FANCY_FILE:a.pdf -->\n<!-- FANCY_FILE:b.png -->\n\
         <!-- FANCY_LEGACY -->a.pdf (5 bytes), shared as a file<br>\
         b.png (5 bytes), shared as a file<!-- /FANCY_LEGACY -->"
    );
}
