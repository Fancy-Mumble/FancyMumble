//! Reads an older profile's HTML into blocks, a tag at a time.
//!
//! What a bio holds is written by many editors over many years, so this is
//! forgiving: a tag closed that was never opened, a list item outside a list,
//! a list inside a list (flattened into the first level) all read as what
//! they plainly meant. What it does not know keeps its text and loses its
//! setting. Reading stops taking text, pictures and blocks once a full
//! profile's limits are reached, whatever the HTML holds.

use crate::markup::attribute;

use super::bounds::{Limits, linkable};
use super::model::{About, Align, Block, Picture, Run};
use super::tags::Token;

/// How a run is set, as counts of the tags open that set it so.
#[derive(Debug, Clone, Copy, Default)]
struct Marks {
    bold: u32,
    italic: u32,
    underline: u32,
    strike: u32,
    code: u32,
}

impl Marks {
    /// Add `other`, or with `by` false take it away.
    fn add(&mut self, other: Self, by: bool) {
        let change = |count: u32, delta: u32| {
            if by {
                count.saturating_add(delta)
            } else {
                count.saturating_sub(delta)
            }
        };
        self.bold = change(self.bold, other.bold);
        self.italic = change(self.italic, other.italic);
        self.underline = change(self.underline, other.underline);
        self.strike = change(self.strike, other.strike);
        self.code = change(self.code, other.code);
    }

    /// What a `style` attribute sets of these.
    fn of_style(style: &str) -> Self {
        let mut marks = Self::default();
        for (property, value) in style.split(';').filter_map(|part| part.split_once(':')) {
            let (property, value) = (property.trim().to_ascii_lowercase(), value.to_ascii_lowercase());
            let value = value.trim();
            match property.as_str() {
                "font-weight" => {
                    let heavy = value.starts_with("bold")
                        || value.parse::<u32>().is_ok_and(|weight| weight >= 600);
                    marks.bold = u32::from(heavy);
                }
                "font-style" => marks.italic = u32::from(value != "normal"),
                "text-decoration" | "text-decoration-line" => {
                    marks.underline = u32::from(value.contains("underline"));
                    marks.strike = u32::from(value.contains("line-through"));
                }
                "font-family" => {
                    marks.code = u32::from(value.contains("monospace") || value.contains("courier"));
                }
                _ => {}
            }
        }
        marks
    }
}

/// A list being read: items of one level, however deep the HTML went.
#[derive(Debug)]
struct OpenList {
    numbered: bool,
    align: Align,
    items: Vec<Vec<Run>>,
    /// How many lists are open: one closes the list only at its own end.
    depth: u32,
}

/// What is being read, and what has been.
#[derive(Debug, Default)]
pub(super) struct Reader {
    blocks: Vec<Block>,
    /// The pictures pasted in, in order: their bytes.
    pub(super) embedded: Vec<Vec<u8>>,
    /// The runs of the block being read.
    runs: Vec<Run>,
    /// Pictures side by side, not yet a block.
    row: Vec<Picture>,
    marks: Marks,
    /// What each span open set, innermost last.
    spans: Vec<Marks>,
    link: Option<String>,
    /// The alignment each block open says, if it says one, innermost last.
    aligns: Vec<Option<Align>>,
    heading: u32,
    quote: u32,
    list: Option<OpenList>,
    /// How many characters of text were taken.
    taken: usize,
}

impl Reader {
    pub(super) fn token(&mut self, token: Token<'_>) {
        match token {
            Token::Text(text) => self.text(&text),
            Token::Open { name, attributes } => self.open(&name, attributes),
            Token::Close(name) => self.close(&name),
        }
    }

    pub(super) fn finish(mut self) -> (About, Vec<Vec<u8>>) {
        self.end_block();
        if let Some(list) = self.list.as_mut() {
            list.depth = 1;
        }
        self.close_list();
        self.flush_row();
        (About { blocks: self.blocks }, self.embedded)
    }

    fn open(&mut self, name: &str, attributes: &str) {
        let marks = |set: fn(&mut Marks)| {
            let mut marks = Marks::default();
            set(&mut marks);
            marks
        };
        match name {
            "b" | "strong" => self.marks.add(marks(|m| m.bold = 1), true),
            "i" | "em" | "cite" => self.marks.add(marks(|m| m.italic = 1), true),
            "u" | "ins" => self.marks.add(marks(|m| m.underline = 1), true),
            "s" | "strike" | "del" => self.marks.add(marks(|m| m.strike = 1), true),
            "code" | "tt" | "kbd" | "samp" => self.marks.add(marks(|m| m.code = 1), true),
            "span" | "font" => {
                let set = attribute(attributes, "style").map_or_else(Marks::default, |style| {
                    Marks::of_style(&style)
                });
                self.marks.add(set, true);
                self.spans.push(set);
            }
            "a" => self.link = attribute(attributes, "href").filter(|href| linkable(href)),
            "br" => self.push_text("\n"),
            "img" => self.image(attributes),
            "hr" => {
                self.end_block();
                self.push_block(Block::Divider);
            }
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                self.end_block();
                self.aligns.push(align_of(name, attributes));
                self.heading += 1;
            }
            "blockquote" => {
                self.end_block();
                self.quote += 1;
            }
            "ul" | "ol" => self.open_list(name == "ol", attributes),
            "li" => self.item(),
            "td" | "th" => self.push_text(" "),
            "p" | "div" | "center" | "section" | "article" | "header" | "footer" | "table"
            | "tr" | "pre" | "dl" | "dt" | "dd" => self.begin(name, attributes),
            _ => {}
        }
    }

    fn close(&mut self, name: &str) {
        let marks = |set: fn(&mut Marks)| {
            let mut marks = Marks::default();
            set(&mut marks);
            marks
        };
        match name {
            "b" | "strong" => self.marks.add(marks(|m| m.bold = 1), false),
            "i" | "em" | "cite" => self.marks.add(marks(|m| m.italic = 1), false),
            "u" | "ins" => self.marks.add(marks(|m| m.underline = 1), false),
            "s" | "strike" | "del" => self.marks.add(marks(|m| m.strike = 1), false),
            "code" | "tt" | "kbd" | "samp" => self.marks.add(marks(|m| m.code = 1), false),
            "span" | "font" => {
                if let Some(set) = self.spans.pop() {
                    self.marks.add(set, false);
                }
            }
            "a" => self.link = None,
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                self.end_block();
                let _ = self.aligns.pop();
                self.heading = self.heading.saturating_sub(1);
            }
            "blockquote" => {
                self.end_block();
                self.quote = self.quote.saturating_sub(1);
            }
            "ul" | "ol" => self.close_list(),
            "li" => self.flush_item(),
            "p" | "div" | "center" | "section" | "article" | "header" | "footer" | "table"
            | "tr" | "pre" | "dl" | "dt" | "dd" => self.end(),
            _ => {}
        }
    }

    /// Whether blocks inside this one are its lines, not blocks of their own.
    const fn gathering(&self) -> bool {
        self.quote > 0 || self.heading > 0 || self.list.is_some()
    }

    /// A block element begins.
    fn begin(&mut self, name: &str, attributes: &str) {
        if self.gathering() {
            self.new_line();
        } else {
            self.end_block();
        }
        // Not deeper than anybody writes: a hostile nest stops counting.
        if self.aligns.len() < 64 {
            self.aligns.push(align_of(name, attributes));
        }
    }

    /// A block element ends.
    fn end(&mut self) {
        if self.gathering() {
            self.new_line();
        } else {
            self.end_block();
        }
        let _ = self.aligns.pop();
    }

    fn align(&self) -> Align {
        self.aligns.iter().rev().find_map(|align| *align).unwrap_or_default()
    }

    /// The runs read so far become a block of their own.
    fn end_block(&mut self) {
        if self.list.is_some() {
            self.flush_item();
            return;
        }
        let runs = tidy(std::mem::take(&mut self.runs));
        self.flush_row();
        if runs.is_empty() {
            return;
        }
        let align = self.align();
        let block = if self.heading > 0 {
            let text: String = runs.iter().map(|run| run.text.replace('\n', " ")).collect();
            Block::Heading { text, align }
        } else if self.quote > 0 {
            Block::Quote { runs }
        } else {
            Block::Text { runs, align }
        };
        self.push_block(block);
    }

    fn push_block(&mut self, block: Block) {
        if self.blocks.len() < Limits::PAGE.blocks {
            self.blocks.push(block);
        }
    }

    fn flush_row(&mut self) {
        if !self.row.is_empty() {
            let pictures = std::mem::take(&mut self.row);
            self.push_block(Block::Pictures { pictures });
        }
    }

    fn open_list(&mut self, numbered: bool, attributes: &str) {
        if let Some(list) = self.list.as_mut() {
            list.depth += 1;
            self.flush_item();
            return;
        }
        self.end_block();
        let align = align_of("ul", attributes).unwrap_or_else(|| self.align());
        self.list = Some(OpenList {
            numbered,
            align,
            items: Vec::new(),
            depth: 1,
        });
    }

    fn item(&mut self) {
        if self.list.is_none() {
            self.open_list(false, "");
        }
        self.flush_item();
    }

    /// The runs read so far become the list's next item.
    fn flush_item(&mut self) {
        let runs = tidy(std::mem::take(&mut self.runs));
        if let Some(list) = self.list.as_mut().filter(|_| !runs.is_empty()) {
            list.items.push(runs);
        }
    }

    fn close_list(&mut self) {
        let Some(list) = self.list.as_mut() else {
            return;
        };
        list.depth = list.depth.saturating_sub(1);
        if list.depth > 0 {
            self.flush_item();
            return;
        }
        self.flush_item();
        if let Some(list) = self.list.take().filter(|list| !list.items.is_empty()) {
            self.push_block(Block::List {
                numbered: list.numbered,
                items: list.items,
                align: list.align,
            });
        }
        self.flush_row();
    }

    fn image(&mut self, attributes: &str) {
        let Some(bytes) = attribute(attributes, "src").and_then(|src| embedded_picture(&src)) else {
            return;
        };
        if self.embedded.len() >= Limits::PAGE.pictures {
            return;
        }
        // Words before it in the same paragraph are a block before it.
        if self.list.is_none() && !self.runs.is_empty() {
            self.end_block();
        }
        if self.row.len() >= Limits::CARD.row {
            self.flush_row();
        }
        self.row.push(Picture {
            alt: attribute(attributes, "alt").unwrap_or_default(),
            ..Picture::default()
        });
        self.embedded.push(bytes);
    }

    /// Text between tags: runs of white space are one space, as HTML has it.
    fn text(&mut self, text: &str) {
        let mut collapsed = String::with_capacity(text.len());
        for character in text.chars() {
            if character.is_whitespace() {
                let at_start = collapsed.is_empty() && self.ends_in_space();
                if !at_start && !collapsed.ends_with(' ') {
                    collapsed.push(' ');
                }
            } else {
                collapsed.push(character);
            }
        }
        if !collapsed.trim().is_empty() || !self.runs.is_empty() {
            self.push_text(&collapsed);
        }
    }

    /// Start a new line of the block being read, unless one was just begun.
    fn new_line(&mut self) {
        if !self.runs.last().is_none_or(|run| run.text.ends_with('\n')) {
            self.push_text("\n");
        }
    }

    /// Whether what was read last is a space or a line's start.
    fn ends_in_space(&self) -> bool {
        self.runs
            .last()
            .is_none_or(|run| run.text.ends_with([' ', '\n']))
    }

    /// `text`, set as the marks open say, onto the runs.
    fn push_text(&mut self, text: &str) {
        if text == "\n" && self.runs.is_empty() {
            return;
        }
        let room = Limits::PAGE.text.saturating_sub(self.taken);
        let text: String = text.chars().take(room).collect();
        if text.is_empty() {
            return;
        }
        // Pictures already standing are a row before what follows them.
        if self.list.is_none() && !self.row.is_empty() && !text.trim().is_empty() {
            self.flush_row();
        }
        self.taken += text.chars().count();
        let run = Run {
            text,
            bold: self.marks.bold > 0,
            italic: self.marks.italic > 0,
            underline: self.marks.underline > 0,
            strike: self.marks.strike > 0,
            code: self.marks.code > 0,
            link: self.link.clone(),
        };
        match self.runs.last_mut() {
            Some(last) if last.same_setting(&run) => last.text.push_str(&run.text),
            _ => self.runs.push(run),
        }
    }
}

/// `runs` without white space at either end of a line, and without runs
/// left with nothing in them.
fn tidy(mut runs: Vec<Run>) -> Vec<Run> {
    for run in &mut runs {
        while run.text.contains(" \n") || run.text.contains("\n ") {
            run.text = run.text.replace(" \n", "\n").replace("\n ", "\n");
        }
    }
    if let Some(first) = runs.first_mut() {
        first.text = first.text.trim_start().to_owned();
    }
    if let Some(last) = runs.last_mut() {
        last.text = last.text.trim_end().to_owned();
    }
    runs.retain(|run| !run.text.is_empty());
    runs
}

/// The alignment a block element says, if it says one.
fn align_of(name: &str, attributes: &str) -> Option<Align> {
    if name == "center" {
        return Some(Align::Center);
    }
    let styled = attribute(attributes, "style").and_then(|style| {
        style
            .split(';')
            .filter_map(|part| part.split_once(':'))
            .find(|(property, _)| property.trim().eq_ignore_ascii_case("text-align"))
            .map(|(_, value)| value.trim().to_ascii_lowercase())
    });
    let said = styled.or_else(|| attribute(attributes, "align").map(|a| a.to_ascii_lowercase()))?;
    Some(match said.as_str() {
        "center" | "middle" => Align::Center,
        "right" | "end" => Align::Right,
        _ => Align::Left,
    })
}

/// The bytes of a picture written as a base64 `data:` address.
fn embedded_picture(source: &str) -> Option<Vec<u8>> {
    use base64::Engine as _;
    let (kind, encoded) = source.trim().strip_prefix("data:image/")?.split_once(',')?;
    if !kind.ends_with(";base64") {
        return None;
    }
    // Encoders wrap long lines, and an address may have been percent-encoded.
    let encoded: String = encoded
        .replace("%2B", "+")
        .replace("%2F", "/")
        .replace("%3D", "=")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    base64::engine::general_purpose::STANDARD
        .decode(encoded)
        .ok()
        .filter(|bytes| !bytes.is_empty())
}
