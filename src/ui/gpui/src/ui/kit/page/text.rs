//! Lines of text, and the boxes that stand among them.
//!
//! Words set in one size and one face are one piece of text, wrapped as a
//! whole, its runs set apart by their weight, slant, lines and colours.
//! GPUI sets a piece of text in one size and one face, so a line that
//! mixes sizes or faces is laid out a word at a time instead.

use std::ops::Range;

use gpui::{
    AnyElement, FontStyle, FontWeight, HighlightStyle, InteractiveText, IntoElement, ParentElement,
    SharedString, StrikethroughStyle, Styled, StyledText, TextAlign, UnderlineStyle, div,
    prelude::*, px,
};

use super::Painter;
use crate::page::{Align, Block, Lead, Look, Para, Piece, Words};

impl Painter<'_> {
    /// A paragraph: its words, and any boxes among them.
    pub(super) fn para(&self, para: &Para) -> AnyElement {
        if let [Piece::Words(words)] = para.pieces.as_slice()
            && self.uniform(words)
        {
            return self.words(words, para, para.align).into_any_element();
        }
        div()
            .w_full()
            .flex()
            .flex_wrap()
            .items_end()
            .map(|line| justified(line, para.align))
            .children(para.pieces.iter().flat_map(|piece| match piece {
                Piece::Words(words) if self.uniform(words) => {
                    vec![self.words(words, para, Align::Left).into_any_element()]
                }
                Piece::Words(words) => self.word_by_word(words, para),
                Piece::Atom(block) => vec![self.atom(block)],
            }))
            .into_any_element()
    }

    /// Whether `words` are all of one size and one face.
    fn uniform(&self, words: &Words) -> bool {
        let first = words
            .runs
            .first()
            .map(|(_, look)| (look.size, &look.family));
        words
            .runs
            .iter()
            .all(|(_, look)| Some((look.size, &look.family)) == first)
    }

    /// Words of one size and face, as one piece of text, its lines set as
    /// `align` says. Among other pieces of a line it is set left: the line
    /// stands its pieces where they go.
    fn words(&self, words: &Words, para: &Para, align: Align) -> gpui::Div {
        let look = words
            .runs
            .first()
            .map(|(_, look)| look.clone())
            .unwrap_or_default();
        let size = rounded_size(look.size.at(self.surface.size));
        let lead = match para.lead {
            Lead::Surface => size * self.surface.lead,
            Lead::Times(times) => size * times,
            Lead::Len(len) => len.at(self.surface.size),
        };
        // Never a line into less height than its letters take.
        let lead = lead.max(size * LEAD_LEAST).round();
        let text = StyledText::new(SharedString::from(words.text.clone()))
            .with_highlights(self.highlights(words));
        let tag = self.tag("text");
        div()
            .debug_selector(move || tag)
            .min_w(px(self.least_width(words)))
            .text_size(px(size))
            .line_height(px(lead))
            .text_align(match align {
                Align::Left => TextAlign::Left,
                Align::Center => TextAlign::Center,
                Align::Right => TextAlign::Right,
            })
            .when_some(
                self.families.of(&look.family, &self.theme.skin.mono),
                Styled::font_family,
            )
            .when(para.keep_lines, Styled::whitespace_nowrap)
            .child(self.live(text, words))
    }

    /// `text` with the links of `words` live: each asked about before it
    /// is followed, its address said when the pointer rests on it.
    fn live(&self, text: StyledText, words: &Words) -> AnyElement {
        let Some(follow) = self.follow.clone().filter(|_| !words.links.is_empty()) else {
            return text.into_any_element();
        };
        let (ranges, addresses): (Vec<Range<usize>>, Vec<SharedString>) = words
            .links
            .iter()
            .map(|(range, to)| (range.clone(), SharedString::from(to.to_string())))
            .unzip();
        let tips: Vec<(Range<usize>, SharedString)> = ranges
            .iter()
            .cloned()
            .zip(addresses.iter().cloned())
            .collect();
        InteractiveText::new(self.name(), text)
            .tooltip(move |at, window, cx| {
                let (_, to) = tips.iter().find(|(range, _)| range.contains(&at))?;
                Some(super::super::keyed_tip(to.clone(), None::<&str>)(
                    window, cx,
                ))
            })
            .on_click(ranges, move |clicked, window, cx| {
                if let Some(to) = addresses.get(clicked) {
                    follow(to.clone(), window, cx);
                }
            })
            .into_any_element()
    }

    /// How each run of `words` is set apart from the text around it.
    fn highlights(&self, words: &Words) -> Vec<(Range<usize>, HighlightStyle)> {
        words
            .runs
            .iter()
            .filter_map(|(range, look)| {
                let style = self.highlight(look);
                (style != HighlightStyle::default()).then(|| (range.clone(), style))
            })
            .collect()
    }

    fn highlight(&self, look: &Look) -> HighlightStyle {
        HighlightStyle {
            color: Some(self.text_ink(look)),
            font_weight: Some(snapped_weight(look.weight))
                .filter(|weight| *weight != 400)
                .map(|weight| FontWeight(f32::from(weight))),
            font_style: look.italic.then_some(FontStyle::Italic),
            background_color: look.ground.map(|ink| self.ink(ink)),
            underline: look.underline.then_some(UnderlineStyle {
                thickness: px(1.0),
                color: None,
                wavy: false,
            }),
            strikethrough: look.strike.then_some(StrikethroughStyle {
                thickness: px(1.0),
                color: None,
            }),
            fade_out: None,
        }
    }

    /// Words of several sizes or faces, a word at a time, so a line can
    /// still break between any two.
    fn word_by_word(&self, words: &Words, para: &Para) -> Vec<AnyElement> {
        let mut out = Vec::new();
        let mut start = 0;
        let text = &words.text;
        for (at, character) in text.char_indices() {
            if character == ' ' {
                out.extend(self.slice(words, start..at + 1, para));
                start = at + 1;
            } else if character == '\n' {
                out.extend(self.slice(words, start..at, para));
                // A break is a line of its own width: what follows wraps.
                out.push(div().w_full().into_any_element());
                start = at + 1;
            }
        }
        out.extend(self.slice(words, start..text.len(), para));
        out
    }

    fn slice(&self, words: &Words, range: Range<usize>, para: &Para) -> Vec<AnyElement> {
        if range.is_empty() {
            return Vec::new();
        }
        let cut = |of: &Range<usize>| {
            let (start, end) = (of.start.max(range.start), of.end.min(range.end));
            (start < end).then(|| start - range.start..end - range.start)
        };
        let piece = Words {
            text: words.text[range.clone()].to_owned(),
            runs: words
                .runs
                .iter()
                .filter_map(|(run, look)| Some((cut(run)?, look.clone())))
                .collect(),
            links: words
                .links
                .iter()
                .filter_map(|(link, to)| Some((cut(link)?, to.clone())))
                .collect(),
        };
        // A word of mixed sizes is its parts, side by side.
        if !self.uniform(&piece) {
            return piece
                .runs
                .iter()
                .flat_map(|(run, _)| self.slice(&piece, run.clone(), para))
                .collect();
        }
        vec![
            self.words(&piece, para, Align::Left)
                .flex_none()
                .into_any_element(),
        ]
    }

    /// A box standing among words, in its own room.
    fn atom(&self, block: &Block) -> AnyElement {
        let margin = block.frame.margin;
        div()
            .flex_none()
            .max_w_full()
            .pt(px(margin.top.at(self.surface.size)))
            .pb(px(margin.bottom.at(self.surface.size)))
            .child(self.block(block))
            .into_any_element()
    }
}

/// `line`, its boxes standing as `align` says.
fn justified(line: gpui::Div, align: Align) -> gpui::Div {
    match align {
        Align::Left => line.justify_start(),
        Align::Center => line.justify_center(),
        Align::Right => line.justify_end(),
    }
}

/// The least a line is, as a multiple of its text: a document's own
/// `line-height` can ask for less, and its letters would then be cut.
const LEAD_LEAST: f32 = 1.15;
/// The smallest and largest text drawn, in pixels.
const SIZE_LEAST: f32 = 10.0;
const SIZE_MOST: f32 = 40.0;
/// `size` as it is drawn: a whole pixel, neither too small to read nor
/// larger than a page's heading should be. A size between pixels draws
/// each letter blurred.
pub(super) fn rounded_size(size: f32) -> f32 {
    size.round().clamp(SIZE_LEAST, SIZE_MOST)
}

/// `weight` as a weight the client has a face for: Inter comes in four,
/// and any other is made up by smearing the nearest.
pub(super) fn snapped_weight(weight: u16) -> u16 {
    match weight {
        0..=449 => 400,
        450..=549 => 500,
        550..=649 => 600,
        _ => 700,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sizes_are_whole_pixels_in_a_readable_range_and_weights_ones_inter_has() {
        assert_eq!(rounded_size(15.795), 16.0);
        assert_eq!(rounded_size(6.0), SIZE_LEAST);
        assert_eq!(rounded_size(72.0), SIZE_MOST);
        assert_eq!(
            [300, 510, 590, 700, 900].map(snapped_weight),
            [400, 500, 600, 700, 700]
        );
    }
}
