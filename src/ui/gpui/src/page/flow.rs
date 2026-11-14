//! A box being filled: the blocks already in it, and the line of words
//! still being written. White space is folded as a browser folds it.

use std::sync::Arc;

use super::style::Context;
use super::tree::{Align, Block, Kind, Lead, Look, Para, Piece, Words};

/// The words of a line being written.
#[derive(Debug, Default)]
struct Line {
    pieces: Vec<Piece>,
    words: Words,
    /// A space was met and is owed before the next word.
    space: bool,
}

impl Line {
    fn is_empty(&self) -> bool {
        self.pieces.is_empty() && self.words.text.is_empty()
    }

    /// Whether what was written last ends a line, or nothing was.
    fn at_line_start(&self) -> bool {
        self.words.text.is_empty() && self.pieces.is_empty() || self.words.text.ends_with('\n')
    }

    fn push(&mut self, text: &str, look: &Look, link: Option<&Arc<str>>) {
        if text.is_empty() {
            return;
        }
        let words = &mut self.words;
        let start = words.text.len();
        words.text.push_str(text);
        let end = words.text.len();
        match words.runs.last_mut() {
            Some((range, last)) if last == look && range.end == start => range.end = end,
            _ => words.runs.push((start..end, look.clone())),
        }
        if let Some(link) = link {
            match words.links.last_mut() {
                Some((range, last)) if Arc::ptr_eq(last, link) && range.end == start => {
                    range.end = end;
                }
                _ => words.links.push((start..end, Arc::clone(link))),
            }
        }
    }

    /// The words so far as a piece of their own, so a box can stand next.
    fn cut(&mut self) {
        if !self.words.text.is_empty() {
            self.pieces
                .push(Piece::Words(std::mem::take(&mut self.words)));
        }
    }

    fn finish(mut self) -> Vec<Piece> {
        // A break that ends a line adds none, but a break alone is a line:
        // `<p><br></p>` is how an old editor writes an empty one.
        let blank = self.pieces.is_empty() && self.words.text.trim().is_empty();
        let kept = if blank && self.words.text.contains('\n') {
            self.words.text.clear();
            self.words.text.push(' ');
            1
        } else {
            self.words.text.trim_end().len()
        };
        self.words.text.truncate(kept);
        if let Some((range, _)) = self.words.runs.first_mut().filter(|_| blank) {
            *range = 0..kept;
        }
        trim(&mut self.words.runs, kept);
        trim(&mut self.words.links, kept);
        self.cut();
        self.pieces
    }
}

/// `ranges` cut to end by `end`, those left empty gone.
fn trim<T>(ranges: &mut Vec<(std::ops::Range<usize>, T)>, end: usize) {
    ranges.retain_mut(|(range, _)| {
        range.end = range.end.min(end);
        range.start < range.end
    });
}

/// A box being filled.
#[derive(Debug)]
pub(super) struct Flow {
    blocks: Vec<Block>,
    line: Line,
    /// How the box sets its lines.
    align: Align,
    lead: Lead,
    keep_lines: bool,
}

impl Flow {
    /// An empty box whose lines are set as `context` says.
    pub(super) fn new(context: &Context) -> Self {
        Self {
            blocks: Vec::new(),
            line: Line::default(),
            align: context.align,
            lead: context.lead,
            keep_lines: context.keep_lines,
        }
    }

    /// Words, set as `context` says. Outside kept lines a run of white
    /// space is one space, and none at the start or end of a line.
    pub(super) fn text(&mut self, text: &str, context: &Context) {
        let link = context.link.as_ref().filter(|_| !context.in_link_box);
        let text = match context.case {
            Some(true) => text.to_uppercase(),
            Some(false) => text.to_lowercase(),
            None => text.to_owned(),
        };
        if context.keep_lines {
            self.line.push(&text, &context.look, link);
            return;
        }
        let mut word = String::new();
        for character in text.chars() {
            if character.is_whitespace() && character != '\u{a0}' {
                self.word(&mut word, context, link);
                self.line.space = !self.line.at_line_start();
            } else {
                word.push(character);
            }
        }
        self.word(&mut word, context, link);
    }

    fn word(&mut self, word: &mut String, context: &Context, link: Option<&Arc<str>>) {
        if word.is_empty() {
            return;
        }
        if std::mem::take(&mut self.line.space) {
            self.line.push(" ", &context.look, link);
        }
        self.line.push(word, &context.look, link);
        word.clear();
    }

    /// A line break: `<br>`.
    pub(super) fn line_break(&mut self, context: &Context) {
        self.line.space = false;
        self.line.push("\n", &context.look, None);
    }

    /// A box that stands among the words, as a word does.
    pub(super) fn atom(&mut self, block: Block, context: &Context) {
        if std::mem::take(&mut self.line.space) {
            self.line.push(" ", &context.look, None);
        }
        self.line.cut();
        self.line.pieces.push(Piece::Atom(Box::new(block)));
    }

    /// A block: the line before it ends.
    pub(super) fn block(&mut self, block: Block) {
        self.end_line();
        self.blocks.push(block);
    }

    fn end_line(&mut self) {
        let line = std::mem::take(&mut self.line);
        if line.is_empty() {
            return;
        }
        let pieces = line.finish();
        if pieces.is_empty() {
            return;
        }
        self.blocks.push(Block {
            frame: super::tree::Frame::default(),
            kind: Kind::Para(Para {
                pieces,
                align: self.align,
                lead: self.lead,
                keep_lines: self.keep_lines,
            }),
        });
    }

    /// What was put in it, as blocks.
    pub(super) fn finish(mut self) -> Vec<Block> {
        self.end_line();
        self.blocks
    }

    /// What was put in it, as what one block holds: a lone paragraph as
    /// itself, anything else as blocks one under another.
    pub(super) fn into_kind(self) -> Kind {
        let mut blocks = self.finish();
        match blocks.as_slice() {
            [
                Block {
                    frame,
                    kind: Kind::Para(_),
                },
            ] if frame.is_plain() => blocks
                .pop()
                .map_or(Kind::Stack(Vec::new()), |block| block.kind),
            _ => Kind::Stack(blocks),
        }
    }
}
