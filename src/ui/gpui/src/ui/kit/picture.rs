//! A small picture a control shows beside its words, in its own colours: a
//! language's flag. Made from an SVG by drawing it once into an ordinary
//! picture, never through the icon path, which paints a file's shapes in
//! one ink as a mask.

use std::sync::Arc;

/// A picture to show, already drawn.
#[derive(Clone)]
pub(crate) struct Picture(pub(super) Arc<gpui::Image>);

impl Picture {
    /// The SVG in `svg`, drawn `width` pixels wide (twice as fine, for a
    /// screen that draws two of its own to each); none if it is not one.
    pub(crate) fn from_svg(svg: &[u8], width: f32) -> Option<Self> {
        let (png, _) = crate::page::raster_svg(svg, Some(width))?;
        Some(Self(Arc::new(gpui::Image::from_bytes(
            gpui::ImageFormat::Png,
            png,
        ))))
    }

    /// The picture, to be placed and sized like any element.
    pub(crate) fn element(&self) -> gpui::Img {
        gpui::img(Arc::clone(&self.0))
    }

    /// The drawn picture's pixels, for looking at it.
    #[cfg(test)]
    pub(crate) fn pixels(&self) -> image::RgbaImage {
        image::load_from_memory(self.0.bytes())
            .expect("a drawn picture")
            .to_rgba8()
    }
}
