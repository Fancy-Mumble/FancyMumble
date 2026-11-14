//! A picture drawn in lines: an SVG a document carries, drawn once into an
//! ordinary picture at the size it is shown, so the rest of the view keeps
//! it the way it keeps every other.
//!
//! Nothing an SVG points at is followed: a picture inside it, by address or
//! inline, is left out, and so is its text, which needs fonts looked up.

use resvg::{tiny_skia, usvg};

/// The longest side drawn, in pixels: a logo, an icon, a rule's ornament.
const LONGEST: f32 = 1024.0;
/// How many pixels are drawn for each the document asks for: enough for a
/// screen that draws two of its own to each.
const FINENESS: f32 = 2.0;

/// The SVG in `bytes` drawn as a PNG, `wanted` wide if the document said
/// how wide, else at its own size; and that own size, which is the size
/// it is shown at where the document says none (the PNG has more pixels).
pub(crate) fn raster(bytes: &[u8], wanted: Option<f32>) -> Option<(Vec<u8>, (u32, u32))> {
    let options = usvg::Options {
        image_href_resolver: usvg::ImageHrefResolver {
            resolve_data: Box::new(|_, _, _| None),
            resolve_string: Box::new(|_, _| None),
        },
        ..usvg::Options::default()
    };
    let tree = usvg::Tree::from_data(bytes, &options).ok()?;
    let size = tree.size();
    let wide = wanted.filter(|wide| *wide > 0.0).unwrap_or(size.width());
    let scale = (wide * FINENESS / size.width()).min(LONGEST / size.width().max(size.height()));
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "no more than the longest side, at least one"
    )]
    let side = |length: f32| (length * scale).ceil().clamp(1.0, LONGEST) as u32;
    let mut pixmap = tiny_skia::Pixmap::new(side(size.width()), side(size.height()))?;
    resvg::render(
        &tree,
        tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let pixels: Vec<u8> = pixmap
        .pixels()
        .iter()
        .flat_map(|pixel| {
            let color = pixel.demultiply();
            [color.red(), color.green(), color.blue(), color.alpha()]
        })
        .collect();
    let image = image::RgbaImage::from_raw(pixmap.width(), pixmap.height(), pixels)?;
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "an SVG's own size is positive and far below 2^32"
    )]
    let own = |length: f32| length.round().max(1.0) as u32;
    Some((png, (own(size.width()), own(size.height()))))
}
