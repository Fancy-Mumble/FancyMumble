//! A page as it is drawn: blocks of text, lists, tables and pictures, each
//! in the box the document gave it.
//!
//! Sizes are kept as the document said them where they depend on the
//! surface: a heading is twice the size of the text around it, and only the
//! surface it is shown on knows how large that is.

use std::ops::Range;
use std::sync::Arc;

/// A length in pixels and in multiples of the size the surface sets its
/// text in: `px + em × base`.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct Len {
    pub px: f32,
    pub em: f32,
}

impl Len {
    pub(crate) const ZERO: Self = Self { px: 0.0, em: 0.0 };

    pub(crate) const fn px(px: f32) -> Self {
        Self { px, em: 0.0 }
    }

    pub(crate) const fn em(em: f32) -> Self {
        Self { px: 0.0, em }
    }

    /// In pixels, on a surface that sets its text `base` pixels high.
    pub(crate) fn at(self, base: f32) -> f32 {
        self.px + self.em * base
    }

    /// `by` times as long.
    pub(crate) fn times(self, by: f32) -> Self {
        Self {
            px: self.px * by,
            em: self.em * by,
        }
    }
}

/// How wide or tall a box is asked to be.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) enum Extent {
    /// As its contents and its room decide.
    #[default]
    Auto,
    Len(Len),
    /// A share of its room, from 0 to 1.
    Share(f32),
}

/// The four sides of a box.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub(crate) struct Sides<T> {
    pub top: T,
    pub right: T,
    pub bottom: T,
    pub left: T,
}

/// A colour the surface decides: what the welcome designer writes as a
/// theme variable, and what a surface gives links.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Role {
    Accent,
    AccentSoft,
    OnAccent,
    Line,
    Surface,
    Text,
    Muted,
    /// The ink the surface draws links in.
    Link,
}

/// A colour as a document gives it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Ink {
    /// Red, green, blue and opacity.
    Rgba([u8; 4]),
    Role(Role),
    /// The colour of the text it is with: `currentColor`.
    Current,
}

/// A ground that runs from one colour to another, at an angle in degrees as
/// CSS measures one (`180` runs downwards).
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Wash {
    pub angle: f32,
    pub from: Ink,
    pub to: Ink,
}

/// A shadow under a box: how far it falls, how blurred, in what.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Shadow {
    pub x: f32,
    pub y: f32,
    pub blur: f32,
    pub spread: f32,
    pub ink: Ink,
}

/// How a flexible box shares its row.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct Flex {
    pub grow: f32,
    pub shrink: f32,
    pub basis: Extent,
}

/// The box around something: its room inside and out, its edge, its
/// ground, and how large it is asked to be.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Frame {
    pub margin: Sides<Len>,
    pub padding: Sides<Len>,
    /// The width of each edge, in pixels.
    pub border: Sides<f32>,
    pub border_ink: Option<Ink>,
    pub dashed: bool,
    pub radius: Len,
    pub ground: Option<Ink>,
    pub wash: Option<Wash>,
    pub shadow: Option<Shadow>,
    pub width: Extent,
    pub min_width: Extent,
    pub max_width: Extent,
    pub height: Option<Len>,
    pub min_height: Option<Len>,
    pub max_height: Option<Len>,
    /// Stands in the middle of its room: `margin: 0 auto`.
    pub centred: bool,
    /// Cuts off what reaches outside it.
    pub clip: bool,
    pub flex: Option<Flex>,
    /// Where a click on it leads.
    pub link: Option<Arc<str>>,
    /// Whether the document set its margin above, and below: a margin it
    /// set stands where a box would otherwise drop it.
    pub margin_said: (bool, bool),
}

impl Frame {
    /// Whether it draws anything of its own, or holds its contents in.
    pub(crate) fn is_plain(&self) -> bool {
        *self == Self::default()
    }
}

/// How lines stand in their box.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Align {
    #[default]
    Left,
    Center,
    Right,
}

/// How tall a line is.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Lead {
    /// As the surface it is shown on sets its lines.
    Surface,
    /// This many times the size of its text.
    Times(f32),
    Len(Len),
}

/// What a run of text is set in.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) enum Family {
    /// The surface's own.
    #[default]
    Surface,
    /// The face code is set in.
    Mono,
    /// The first of these the system has, as CSS lists them.
    Named(Arc<str>),
}

/// How a run of text is set.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Look {
    pub size: Len,
    pub weight: u16,
    pub italic: bool,
    pub underline: bool,
    pub strike: bool,
    /// Its colour; `None` is the surface's.
    pub ink: Option<Ink>,
    pub ground: Option<Ink>,
    pub family: Family,
}

impl Default for Look {
    fn default() -> Self {
        Self {
            size: Len::em(1.0),
            weight: 400,
            italic: false,
            underline: false,
            strike: false,
            ink: None,
            ground: None,
            family: Family::Surface,
        }
    }
}

/// Words, set in runs, some of them links.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Words {
    pub text: String,
    /// How each stretch is set: in order, together covering all of it.
    pub runs: Vec<(Range<usize>, Look)>,
    /// Where it is a link, and where each leads.
    pub links: Vec<(Range<usize>, Arc<str>)>,
}

/// A piece of a line: words, or a box that stands among them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Piece {
    Words(Words),
    Atom(Box<Block>),
}

/// Lines of text, and the boxes among them.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Para {
    pub pieces: Vec<Piece>,
    pub align: Align,
    pub lead: Lead,
    /// Lines are kept as written, and not wrapped: `white-space: pre`.
    pub keep_lines: bool,
}

/// What a list marks its items with.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Marker {
    Disc,
    Circle,
    Square,
    Decimal,
    LowerAlpha,
    UpperAlpha,
    LowerRoman,
    UpperRoman,
    None,
}

/// One item of a list: its mark, and what it says.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Item {
    pub mark: String,
    pub look: Look,
    pub body: Vec<Block>,
}

/// Where a cell's contents stand in it, from top to bottom.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Valign {
    Top,
    #[default]
    Middle,
    Bottom,
}

/// One cell of a table.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Cell {
    pub frame: Frame,
    /// The first column it stands in, and how many columns and rows it
    /// spans.
    pub column: usize,
    pub span: (usize, usize),
    pub valign: Valign,
    pub body: Vec<Block>,
}

/// A table: rows of cells, laid out by its columns.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Table {
    pub rows: Vec<Vec<Cell>>,
    /// How wide each column is asked to be.
    pub columns: Vec<Extent>,
    /// The room between cells, in pixels.
    pub spacing: f32,
}

/// Boxes side by side: `display: flex`.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Row {
    pub items: Vec<Block>,
    pub gap: Len,
    /// One under another instead.
    pub column: bool,
    pub wrap: bool,
    pub justify: Align,
    /// Each box stands in the middle of the row's height, not at its top.
    pub centred: bool,
}

/// How a picture fills the box it is given.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Fit {
    /// Stretched to it.
    #[default]
    Fill,
    /// All of it, inside.
    Contain,
    /// All of the box, cut to it.
    Cover,
}

/// A picture the document carries in itself.
#[derive(Debug, Clone)]
pub(crate) struct Picture {
    pub image: Arc<gpui::Image>,
    /// How large its file says it is.
    pub natural: Option<(u32, u32)>,
    pub fit: Fit,
}

impl PartialEq for Picture {
    fn eq(&self, other: &Self) -> bool {
        self.image.id() == other.image.id() && self.fit == other.fit
    }
}

/// What a block is.
#[derive(Debug, Clone, PartialEq)]
pub(crate) enum Kind {
    Para(Para),
    /// Blocks one under another.
    Stack(Vec<Block>),
    Row(Row),
    List(Vec<Item>),
    Table(Table),
    /// A rule across: `<hr>`.
    Rule,
    Picture(Picture),
}

/// A box of the page and what is in it.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Block {
    pub frame: Frame,
    pub kind: Kind,
}

impl Block {
    /// The blocks right inside it: a stack's and a row's, each item's and
    /// each cell's, and the boxes that stand among its words.
    pub(crate) fn inner(&self) -> Vec<&Self> {
        match &self.kind {
            Kind::Para(para) => para
                .pieces
                .iter()
                .filter_map(|piece| match piece {
                    Piece::Atom(atom) => Some(&**atom),
                    Piece::Words(_) => None,
                })
                .collect(),
            Kind::Stack(blocks) | Kind::Row(Row { items: blocks, .. }) => blocks.iter().collect(),
            Kind::List(items) => items.iter().flat_map(|item| &item.body).collect(),
            Kind::Table(table) => table
                .rows
                .iter()
                .flatten()
                .flat_map(|cell| &cell.body)
                .collect(),
            Kind::Rule | Kind::Picture(_) => Vec::new(),
        }
    }

    /// Every block in it, itself first, without following it down by
    /// recursion: a document's depth is bounded, but a walk need not care.
    pub(crate) fn every(&self) -> Vec<&Self> {
        let mut found = Vec::new();
        let mut waiting = vec![self];
        while let Some(block) = waiting.pop() {
            found.push(block);
            waiting.extend(block.inner().into_iter().rev());
        }
        found
    }

    /// The words in it, for whoever needs them without their setting.
    #[cfg(test)]
    pub(crate) fn plain(&self, out: &mut String) {
        let line = |out: &mut String| {
            if !out.is_empty() && !out.ends_with('\n') {
                out.push('\n');
            }
        };
        match &self.kind {
            Kind::Para(para) => {
                line(out);
                for piece in &para.pieces {
                    match piece {
                        Piece::Words(words) => out.push_str(&words.text),
                        Piece::Atom(block) => block.plain(out),
                    }
                }
            }
            Kind::Stack(blocks) | Kind::Row(Row { items: blocks, .. }) => {
                blocks.iter().for_each(|block| block.plain(out));
            }
            Kind::List(items) => items.iter().for_each(|item| {
                line(out);
                out.push_str(&item.mark);
                out.push(' ');
                item.body.iter().for_each(|block| block.plain(out));
            }),
            Kind::Table(table) => {
                for cell in table.rows.iter().flatten() {
                    cell.body.iter().for_each(|block| block.plain(out));
                }
            }
            Kind::Rule | Kind::Picture(_) => {}
        }
    }
}
