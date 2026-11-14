//! The document's tree turned into the page's: each element set as a
//! browser sets it, and placed in the box it stands in.

use std::sync::Arc;

use super::css::{self, Declared, Display};
use super::dialect::{self, Treat};
use super::dom::{Dom, Id, Kind as NodeKind};
use super::flow::Flow;
use super::style::{Context, Styled, font_steps};
use super::tree::{Block, Extent, Frame, Ink, Kind, Len, Picture, Role, Row};
use super::values::{first_ink, parts};

/// How deep elements are followed. Deeper, only their words are kept.
pub(super) const DEEPEST: usize = 48;
/// How many boxes one page may have. Past this the rest is left out.
pub(super) const BLOCKS_MOST: usize = 4096;
/// How many pictures one page may carry.
pub(super) const PICTURES_MOST: usize = 32;

/// How a picture drawn in lines starts.
const SVG: &str = "data:image/svg+xml;";

/// Reads one document.
pub(super) struct Builder<'d> {
    pub(super) dom: &'d Dom,
    /// Boxes and pictures made so far.
    pub(super) blocks: usize,
    pub(super) pictures: usize,
}

impl Builder<'_> {
    /// Whether no more may be made.
    pub(super) fn full(&self) -> bool {
        self.blocks >= BLOCKS_MOST
    }

    /// Put the node `id` into `flow`.
    pub(super) fn node(&mut self, id: Id, context: &Context, flow: &mut Flow, depth: usize) {
        if self.full() {
            return;
        }
        match &self.dom.nodes[id].kind {
            NodeKind::Text(text) => flow.text(text, context),
            NodeKind::Element { .. } if depth >= DEEPEST => {
                let words = self.words_of(id);
                flow.text(&words, context);
            }
            NodeKind::Element { name, html, .. } => {
                if *html {
                    let name = name.to_ascii_lowercase();
                    self.element(id, &name, context, flow, depth);
                }
            }
            NodeKind::Root | NodeKind::Other => {}
        }
    }

    /// Every child of `id` into `flow`.
    pub(super) fn children(&mut self, id: Id, context: &Context, flow: &mut Flow, depth: usize) {
        for at in 0..self.dom.nodes[id].children.len() {
            let child = self.dom.nodes[id].children[at];
            self.node(child, context, flow, depth + 1);
        }
    }

    /// The words of everything under `id`, gathered without following it
    /// down: for what lies deeper than is followed.
    fn words_of(&self, id: Id) -> String {
        let mut words = String::new();
        let mut waiting = vec![id];
        while let Some(next) = waiting.pop() {
            match &self.dom.nodes[next].kind {
                NodeKind::Text(text) => words.push_str(text),
                _ => waiting.extend(self.dom.nodes[next].children.iter().rev()),
            }
        }
        words
    }

    fn element(&mut self, id: Id, name: &str, outer: &Context, flow: &mut Flow, depth: usize) {
        let tag = match dialect::treat(name) {
            Treat::Drop => return,
            Treat::Unwrap => return self.children(id, outer, flow, depth),
            Treat::Keep(tag) => tag,
        };
        let styled = self.styled(id, tag, outer);
        match (tag, styled.display) {
            (_, Display::None) => {}
            ("br", _) => flow.line_break(outer),
            ("img", display) => {
                if let Some(picture) = self.picture(id, &styled) {
                    if display == Display::Inline {
                        flow.atom(picture, outer);
                    } else {
                        flow.block(picture);
                    }
                }
            }
            // A link with a ground or an edge of its own is a button: a box
            // among the words, with room inside.
            ("a", Display::Inline) if super::room::is_box(&styled) => {
                let block = self.boxed(id, tag, &styled, depth);
                flow.atom(block, outer);
            }
            (_, Display::Inline) => {
                // An inline box's ground is the ground of its words.
                let mut context = self.linked(id, tag, styled.context);
                if let Some(ground) = styled.frame.ground {
                    context.look.ground = Some(ground);
                }
                self.children(id, &context, flow, depth);
            }
            (_, Display::InlineBlock) => {
                let block = self.boxed(id, tag, &styled, depth);
                flow.atom(block, outer);
            }
            _ => {
                let block = self.boxed(id, tag, &styled, depth);
                // An empty box takes no room but its margins, which fold
                // into its neighbours': leaving it out draws the same.
                let bare = Frame {
                    margin: super::tree::Sides::default(),
                    margin_said: (false, false),
                    ..block.frame.clone()
                };
                if bare.is_plain() && is_empty(&block.kind) {
                    return;
                }
                flow.block(block);
            }
        }
    }

    /// `tag` at `id`, set as its defaults and its own `style` say.
    pub(super) fn styled(&self, id: Id, tag: &str, outer: &Context) -> Styled {
        let mut styled = Styled::new(tag, outer);
        let mut declared = self
            .dom
            .attribute(id, "style")
            .map(css::read)
            .unwrap_or_default();
        if tag == "font" {
            let mut said = self.font_attributes(id);
            said.append(&mut declared);
            declared = said;
        }
        styled.apply(&declared, outer);
        if matches!(tag, "img" | "td" | "th" | "table" | "tr") {
            sized(
                &mut styled,
                self.dom.attribute(id, "width"),
                self.dom.attribute(id, "height"),
            );
        }
        styled
    }

    /// What an old `<font>` says by its attributes, as declarations.
    fn font_attributes(&self, id: Id) -> Vec<Declared> {
        let mut declared = Vec::new();
        if let Some(color) = self.dom.attribute(id, "color") {
            let ink = first_ink(&parts(color)).or_else(|| first_ink(&parts(&format!("#{color}"))));
            declared.extend(ink.map(Declared::Color));
        }
        if let Some(size) = self.dom.attribute(id, "size").and_then(font_steps) {
            declared.push(Declared::FontSize(size));
        }
        if let Some(face) = self.dom.attribute(id, "face") {
            declared.push(Declared::Family(face.to_owned()));
        }
        declared
    }

    /// `context`, inside the link `id` is, if it is one this reader keeps.
    fn linked(&self, id: Id, tag: &str, mut context: Context) -> Context {
        if tag != "a" {
            return context;
        }
        match self.dom.attribute(id, "href").and_then(dialect::link) {
            Some(href) => context.link = Some(href),
            // A link that leads nowhere it may is only its words.
            None if context.link.is_none() && context.look.ink == Some(Ink::Role(Role::Link)) => {
                context.look.ink = None;
            }
            None => {}
        }
        context
    }

    /// `tag` at `id` as a box of its own.
    fn boxed(&mut self, id: Id, tag: &str, styled: &Styled, depth: usize) -> Block {
        self.blocks += 1;
        let mut context = self.linked(id, tag, styled.context.clone());
        let mut frame = styled.frame.clone();
        if tag == "a" && context.link.is_some() && !context.in_link_box {
            frame.link.clone_from(&context.link);
            context.in_link_box = true;
        }
        let kind = match tag {
            "hr" => Kind::Rule,
            "ul" | "ol" => self.list(id, styled, &context, depth),
            "table" => self.table(id, styled, &context, depth),
            _ if styled.display == Display::Flex => self.row(id, styled, &context, depth),
            _ => {
                let mut flow = Flow::new(&context);
                self.children(id, &context, &mut flow, depth);
                flow.into_kind()
            }
        };
        // A table hands the room to its cells: its own padding is not used
        // where its borders collapse.
        if !matches!(tag, "hr" | "table") && super::room::is_box(styled) {
            let block = Block { frame, kind };
            if super::room::holds(std::slice::from_ref(&block)) {
                let mut padded = styled.clone();
                padded.frame = block.frame;
                let mut kind = block.kind;
                let inside: &mut [Block] = match &mut kind {
                    Kind::Stack(blocks) => blocks,
                    _ => &mut [],
                };
                super::room::pad(&mut padded, inside);
                return Block {
                    frame: padded.frame,
                    kind,
                };
            }
            return block;
        }
        Block { frame, kind }
    }

    /// A box laid out with flex: each child a box of its own.
    fn row(&mut self, id: Id, styled: &Styled, context: &Context, depth: usize) -> Kind {
        let mut items = Vec::new();
        for at in 0..self.dom.nodes[id].children.len() {
            let child = self.dom.nodes[id].children[at];
            let mut flow = Flow::new(context);
            self.node(child, context, &mut flow, depth + 1);
            for block in flow.finish() {
                items.push(match block.kind {
                    // A box among words is a box of the row all the same.
                    Kind::Para(para) if para.pieces.len() == 1 => {
                        match para.pieces.into_iter().next() {
                            Some(super::tree::Piece::Atom(atom)) => *atom,
                            Some(words) => Block {
                                frame: block.frame,
                                kind: Kind::Para(super::tree::Para {
                                    pieces: vec![words],
                                    ..para
                                }),
                            },
                            None => continue,
                        }
                    }
                    _ => block,
                });
            }
        }
        let setting = styled.row;
        Kind::Row(Row {
            items,
            gap: setting.gap,
            column: setting.column,
            wrap: setting.wrap,
            justify: setting.justify,
            centred: setting.centred,
        })
    }

    /// The picture at `id`, if it is one the document carries and it can
    /// be read.
    fn picture(&mut self, id: Id, styled: &Styled) -> Option<Block> {
        let source = self.dom.attribute(id, "src")?;
        if !dialect::picture(source) || self.pictures >= PICTURES_MOST {
            return None;
        }
        self.pictures += 1;
        self.blocks += 1;
        let mut bytes = crate::rich::embedded_picture(source)?;
        let mut own = None;
        if source
            .get(..SVG.len())
            .is_some_and(|head| head.eq_ignore_ascii_case(SVG))
        {
            let wide = match styled.frame.width {
                Extent::Len(len) => Some(len.px),
                _ => None,
            };
            let (png, size) = super::vector::raster(&bytes, wide)?;
            bytes = png;
            own = Some(size);
        }
        // A drawing is shown at its own size, not at the finer one it was
        // drawn at.
        let natural = own.or_else(|| crate::picture::dimensions(&bytes));
        let image = Arc::new(crate::picture::picture(bytes)?);
        Some(Block {
            frame: styled.frame.clone(),
            kind: Kind::Picture(Picture {
                image,
                natural,
                fit: styled.fit,
            }),
        })
    }
}

/// Whether a box holds nothing to draw.
pub(super) fn is_empty(kind: &Kind) -> bool {
    match kind {
        Kind::Stack(blocks) => blocks.is_empty(),
        Kind::List(items) => items.is_empty(),
        Kind::Table(table) => table.rows.is_empty(),
        Kind::Row(row) => row.items.is_empty(),
        Kind::Para(_) | Kind::Rule | Kind::Picture(_) => false,
    }
}

/// The size the old `width` and `height` attributes ask for: pixels, or a
/// share. A `style` that says otherwise wins.
fn sized(styled: &mut Styled, width: Option<&str>, height: Option<&str>) {
    let read = |value: &str| -> Option<Extent> {
        let value = value.trim();
        if let Some(share) = value.strip_suffix('%') {
            return share
                .trim()
                .parse::<f32>()
                .ok()
                .map(|share| Extent::Share(share / 100.0));
        }
        let number = value.strip_suffix("px").unwrap_or(value).trim();
        number
            .parse::<f32>()
            .ok()
            .filter(|px| *px >= 0.0)
            .map(|px| Extent::Len(Len::px(px)))
    };
    if styled.frame.width == Extent::Auto
        && let Some(width) = width.and_then(read)
    {
        styled.frame.width = width;
    }
    if styled.frame.height.is_none()
        && let Some(Extent::Len(height)) = height.and_then(read)
    {
        styled.frame.height = Some(height);
    }
}

/// A frame's ground, for a cell that has none, from the row it is in.
pub(super) fn grounded(frame: &mut Frame, row: Option<Ink>) {
    if frame.ground.is_none() && frame.wash.is_none() {
        frame.ground = row;
    }
}
