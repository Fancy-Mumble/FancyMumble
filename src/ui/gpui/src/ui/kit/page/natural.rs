//! How wide a part would be if nothing made it wrap: what a browser calls
//! its max-content width.
//!
//! A table nobody gave a width is as wide as that, or as its room where
//! that is wider: a short table hugs its words, and a long one fills its
//! room and wraps, never squeezed into a column narrower than either. The
//! layout engine is not asked: it measures such a table at its narrowest
//! instead, so the width is worked out here from the text itself, shaped
//! as it will be drawn.

use gpui::{Font, FontStyle, FontWeight, SharedString, TextRun, px};

use super::Painter;

/// The most letters a text may have to be kept on one line where it fits:
/// a label, a button, a heading of a few words.
const SHORT: usize = 32;
/// The most room asked for one word: a long address wraps past it.
const WORD_MOST: f32 = 220.0;

use super::text::rounded_size;
use crate::page::{Block, Extent, Frame, Kind, Look, Para, Piece, Table, Words};

impl Painter<'_> {
    /// The width `block` takes, edges and margins included, where nothing
    /// makes it wrap.
    fn natural(&self, block: &Block) -> f32 {
        let base = self.surface.size;
        let frame = &block.frame;
        let room = if frame.centred {
            0.0
        } else {
            frame.margin.left.at(base) + frame.margin.right.at(base)
        };
        self.natural_box(block) + room
    }

    /// The width of `block`'s box, edges included, where nothing makes it
    /// wrap.
    pub(super) fn natural_box(&self, block: &Block) -> f32 {
        let base = self.surface.size;
        let frame = &block.frame;
        let inside = match (&block.kind, frame.width) {
            (_, Extent::Len(len)) => return len.at(base) + across(frame, base),
            (Kind::Picture(picture), _) => picture.natural.map_or(0.0, |(wide, tall)| {
                #[expect(
                    clippy::cast_precision_loss,
                    reason = "a picture's side is far below 2^24"
                )]
                let (wide, tall) = (wide as f32, tall as f32);
                frame
                    .height
                    .map_or(wide, |height| height.at(base) * wide / tall)
            }),
            (Kind::Para(para), _) => self.para_natural(para),
            (Kind::Stack(blocks), _) => self.widest(blocks),
            (Kind::Row(row), _) if row.column => self.widest(&row.items),
            (Kind::Row(row), _) => {
                #[expect(clippy::cast_precision_loss, reason = "a row has few items")]
                let gaps = row.gap.at(base) * row.items.len().saturating_sub(1) as f32;
                row.items.iter().map(|item| self.natural(item)).sum::<f32>() + gaps
            }
            (Kind::List(items), _) => items
                .iter()
                .map(|item| self.widest(&item.body))
                .fold(0.0, f32::max),
            (Kind::Table(table), _) => {
                self.columns_natural(table).iter().sum::<f32>() + table_edges(table)
            }
            (Kind::Rule, _) => 0.0,
        };
        inside + across(frame, base)
    }

    /// The widest of `blocks`.
    fn widest(&self, blocks: &[Block]) -> f32 {
        blocks
            .iter()
            .map(|block| self.natural(block))
            .fold(0.0, f32::max)
    }

    /// How wide each column of `table` is where nothing wraps: the widest
    /// of the cells that stand in it alone.
    pub(super) fn columns_natural(&self, table: &Table) -> Vec<f32> {
        let base = self.surface.size;
        let mut widths = vec![0.0_f32; table.columns.len()];
        for cell in table.rows.iter().flatten() {
            if cell.span.0 != 1 {
                continue;
            }
            let wide = self.widest(&cell.body) + across(&cell.frame, base);
            if let Some(width) = widths.get_mut(cell.column) {
                *width = width.max(wide);
            }
        }
        widths
    }

    /// A paragraph's longest line.
    fn para_natural(&self, para: &Para) -> f32 {
        let mut longest = 0.0_f32;
        let mut line = 0.0_f32;
        for piece in &para.pieces {
            let widths = match piece {
                Piece::Atom(block) => vec![self.natural(block)],
                Piece::Words(words) => self.line_widths(words),
            };
            // The first goes on the line already begun; each after it, after
            // a break, begins one.
            for (at, width) in widths.into_iter().enumerate() {
                if at > 0 {
                    longest = longest.max(line);
                    line = 0.0;
                }
                line += width;
            }
        }
        longest.max(line)
    }

    /// The width of each line of `words`, between its breaks.
    fn line_widths(&self, words: &Words) -> Vec<f32> {
        let mut at = 0;
        words
            .text
            .split('\n')
            .map(|line| {
                let width = self.words_natural(words, at..at + line.len());
                at += line.len() + 1;
                width
            })
            .collect()
    }

    /// The width of `range` of `words` on one line, shaped run by run.
    fn words_natural(&self, words: &Words, range: std::ops::Range<usize>) -> f32 {
        words
            .runs
            .iter()
            .filter_map(|(run, look)| {
                let (start, end) = (run.start.max(range.start), run.end.min(range.end));
                (start < end).then(|| self.shaped(&words.text[start..end], look))
            })
            .sum()
    }

    /// The least room `words` are given: a short text all of it, as a
    /// browser sizes a button to its label; a longer one its longest word,
    /// so it wraps between words and never inside one.
    pub(super) fn least_width(&self, words: &Words) -> f32 {
        let text = &words.text;
        if text.trim().chars().count() <= SHORT {
            return self.para_words(words).min(WORD_MOST);
        }
        let mut longest = 0.0_f32;
        let mut start = None;
        for (at, character) in text.char_indices().chain([(text.len(), ' ')]) {
            match (character.is_whitespace(), start) {
                (false, None) => start = Some(at),
                (true, Some(from)) => {
                    longest = longest.max(self.words_natural(words, from..at));
                    start = None;
                }
                _ => {}
            }
        }
        longest.min(WORD_MOST)
    }

    /// The longest line of `words` alone.
    fn para_words(&self, words: &Words) -> f32 {
        self.line_widths(words).into_iter().fold(0.0, f32::max)
    }

    /// `text` set as `look` sets it, on one line.
    fn shaped(&self, text: &str, look: &Look) -> f32 {
        let size = rounded_size(look.size.at(self.surface.size));
        let family = self
            .families
            .of(&look.family, &self.theme.skin.mono)
            .unwrap_or_else(|| self.theme.skin.font.clone());
        let font = Font {
            weight: FontWeight(f32::from(super::text::snapped_weight(look.weight))),
            style: if look.italic {
                FontStyle::Italic
            } else {
                FontStyle::Normal
            },
            ..gpui::font(family)
        };
        let run = TextRun {
            len: text.len(),
            font,
            color: gpui::black(),
            background_color: None,
            underline: None,
            strikethrough: None,
            letter_spacing: 0.0,
        };
        let line =
            self.text
                .shape_line(SharedString::from(text.to_owned()), px(size), &[run], None);
        // A pixel over, as a browser rounds a line's width up.
        f32::from(line.width).ceil()
    }
}

/// What `frame` adds across a box: its padding and edges.
fn across(frame: &Frame, base: f32) -> f32 {
    frame.padding.left.at(base)
        + frame.padding.right.at(base)
        + frame.border.left
        + frame.border.right
}

/// The room a table's spacing takes across it: between its cells and at
/// its sides.
fn table_edges(table: &Table) -> f32 {
    #[expect(clippy::cast_precision_loss, reason = "a table has at most 32 columns")]
    let gaps = (table.columns.len() + 1) as f32;
    table.spacing * gaps
}
