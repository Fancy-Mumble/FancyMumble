//! HTML a server or a user writes, read into a page this view draws: a
//! welcome message, a channel's description, what somebody wrote about
//! themselves.
//!
//! The dialect is the web client's (`sanitizeHtml.ts`), and so is how it
//! is read: html5ever builds the tree a browser would, the web client's
//! allow-lists decide what of it is drawn, and each element is set as a
//! browser's own stylesheet sets it, then as its `style` says. Nothing is
//! ever run or fetched; a picture is drawn only if the document carries it.
//!
//! A document cannot make reading slow or deep: what is read is bounded in
//! size, in tags, in depth, in boxes, in pictures and in a table's rows and
//! columns, and past each bound the rest is left out or kept as its words.
//! Chat messages are not read here: `rich.rs` reads those.

mod build;
mod css;
mod dialect;
mod dom;
mod flow;
mod parts;
mod room;
mod safe;
mod style;
#[cfg(test)]
mod tests;
mod tree;
mod values;
mod vector;

/// An SVG drawn into an ordinary picture, in its own colours: for anything
/// else that shows one (a language's flag).
pub(crate) use vector::raster as raster_svg;

pub(crate) use tree::{
    Align, Block, Cell, Extent, Family, Fit, Frame, Ink, Item, Kind, Lead, Len, Look, Para,
    Picture, Piece, Role, Row, Sides, Table, Valign, Words,
};

/// The most of a document read, in bytes. A welcome is capped by its
/// server well below this; what is past it is left out.
const BYTES_MOST: usize = 4 << 20;
/// The most tags read. What follows the last is left out: html5ever is
/// quick, but some tags make it look back over every element still open.
const TAGS_MOST: usize = 12_000;

/// A document, read and ready to draw.
#[derive(Debug, Default, PartialEq)]
pub(crate) struct Page {
    pub blocks: Vec<Block>,
}

impl Page {
    /// Read `html`.
    pub(crate) fn read(html: &str) -> Self {
        let html = &html[..bounded(html)];
        let dom = dom::Dom::parse(html);
        let Some(body) = dom.body() else {
            return Self::default();
        };
        let mut builder = build::Builder {
            dom: &dom,
            blocks: 0,
            pictures: 0,
        };
        let context = style::Context::surface();
        let mut flow = flow::Flow::new(&context);
        builder.children(body, &context, &mut flow, 0);
        Self {
            blocks: flow.finish(),
        }
    }

    /// Whether there is nothing in it to draw.
    pub(crate) fn is_empty(&self) -> bool {
        self.blocks.is_empty()
    }

    /// Its words, a line to each paragraph, without their setting.
    #[cfg(test)]
    pub(crate) fn plain(&self) -> String {
        let mut out = String::new();
        self.blocks.iter().for_each(|block| block.plain(&mut out));
        out
    }

    /// Its pictures, in the order they stand in it.
    #[cfg(test)]
    pub(crate) fn pictures(&self) -> Vec<std::sync::Arc<gpui::Image>> {
        self.blocks
            .iter()
            .flat_map(Block::every)
            .filter_map(|block| match &block.kind {
                Kind::Picture(picture) => Some(std::sync::Arc::clone(&picture.image)),
                _ => None,
            })
            .collect()
    }
}

/// How much of `html` is read: no more than [`BYTES_MOST`] bytes, and
/// nothing after the [`TAGS_MOST`]th tag.
fn bounded(html: &str) -> usize {
    let mut end = html.len().min(BYTES_MOST);
    while !html.is_char_boundary(end) {
        end -= 1;
    }
    let bytes = html.as_bytes();
    let mut tags = 0;
    for at in memchr_lt(&bytes[..end]) {
        let starts_tag = bytes
            .get(at + 1)
            .is_some_and(|next| next.is_ascii_alphabetic() || *next == b'/' || *next == b'!');
        if starts_tag {
            tags += 1;
            if tags > TAGS_MOST {
                return at;
            }
        }
    }
    end
}

/// Where each `<` is in `bytes`.
fn memchr_lt(bytes: &[u8]) -> impl Iterator<Item = usize> + '_ {
    bytes
        .iter()
        .enumerate()
        .filter_map(|(at, byte)| (*byte == b'<').then_some(at))
}
