//! A message's text as it is laid out: running text, and the lines set
//! apart from it. A quote has a rule down its side, code its own face and
//! ground, a heading its size, a list's item its mark in the margin.
//!
//! The measures are the web UI's (`bodyMarkupSx` in `MessageRow.tsx`).

use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use gpui::{
    AnyElement, Hsla, IntoElement, ParentElement, SharedString, Styled, div, prelude::*, px,
};

use super::conversation::{Place, words_as};
use super::widgets::EMPHASIS;
use crate::rich::{Block, Rich, Style};
use crate::theme::Theme;

/// How far a list stands in from what is around it, for each list it is
/// inside: the room its marks are set in.
const INDENT: f32 = 22.0;

/// What sets the name of a code block's text apart from the block's own:
/// more pieces than a message has.
const CODE_TEXT: usize = 1 << 20;

/// What drawing a text takes besides the text.
#[derive(Clone, Copy)]
pub(super) struct Setting<'a> {
    /// Where it is drawn: which row, and who shows a picture larger.
    pub at: Place<'a>,
    /// What says whether its hidden parts have been asked for.
    pub revealed: Option<&'a Arc<AtomicBool>>,
    /// The ink of a link, on the ground the text stands on.
    pub link_ink: Hsla,
    /// The theme it is drawn in.
    pub theme: &'a Theme,
}

/// A piece's name: the text it is of, and its place in that.
type Name = (SharedString, usize);

/// `rich` laid out, if there is any of it. Text with nothing set apart is
/// one piece, as it always was.
pub(super) fn prose(rich: &Rich, setting: Setting<'_>) -> Option<AnyElement> {
    if rich.text.is_empty() {
        return None;
    }
    let row = setting.at.row;
    if rich.blocks.is_empty() {
        return piece(rich, ("message".into(), row), setting).map(IntoElement::into_any_element);
    }
    // Each piece is an element of its own, named by the row and its place.
    let name = SharedString::from(format!("prose-{row}"));
    let pieces = rich
        .pieces()
        .into_iter()
        .enumerate()
        .map(|(nth, (range, block))| {
            let id = (name.clone(), nth);
            let text = rich.slice(range);
            match block {
                None => div().children(piece(&text, id, setting)).into_any_element(),
                Some(block) => set_apart(block, text, id, setting),
            }
        });
    Some(
        div()
            .flex()
            .flex_col()
            .gap(px(4.0))
            .children(pieces)
            .into_any_element(),
    )
}

/// One piece of text, with its links live and what it hides hidden.
fn piece(text: &Rich, id: Name, setting: Setting<'_>) -> Option<gpui::InteractiveText> {
    words_as(
        id,
        text,
        (setting.revealed, setting.at.viewer),
        setting.link_ink,
        setting.theme,
    )
}

/// The lines of `block`, drawn as that kind of block is.
fn set_apart(block: Block, text: Rich, id: Name, setting: Setting<'_>) -> AnyElement {
    let theme = setting.theme;
    match block {
        Block::Quote => div()
            .debug_selector(|| "prose-quote".to_owned())
            .pl(px(10.0))
            .border_l(px(3.0))
            .border_color(theme.c.line)
            .text_color(theme.c.dim)
            .children(piece(&text, id, setting))
            .into_any_element(),
        Block::Code => code(text, id, setting),
        Block::Heading(level) => {
            let larger = match level {
                1 => 1.3,
                2 => 1.18,
                3 => 1.08,
                _ => 1.0,
            };
            div()
                .debug_selector(|| "prose-heading".to_owned())
                .text_size(px(setting.at.text * larger))
                .line_height(gpui::relative(1.3))
                .font_weight(EMPHASIS)
                .children(piece(&text, id, setting))
                .into_any_element()
        }
        Block::Item { depth, mark } => item(&text, depth, usize::from(mark), id, setting),
    }
}

/// Code as it was written: in the face code is set in, on a ground of its
/// own, and scrolled sideways where it is wider than its room. A wrapped
/// line of code is a wrong line.
fn code(mut text: Rich, id: Name, setting: Setting<'_>) -> AnyElement {
    let theme = setting.theme;
    // The block is the ground: its text has none of its own.
    for (_, style) in &mut text.spans {
        style.code = false;
    }
    text.spans.retain(|(_, style)| *style != Style::default());
    div()
        .id(id.clone())
        .debug_selector(|| "prose-code".to_owned())
        .px(px(10.0))
        .py(px(8.0))
        .rounded(theme.skin.radius_sm)
        .bg(theme.c.card2)
        .border_1()
        .border_color(theme.c.line)
        .text_color(theme.c.text)
        .font_family(theme.skin.mono.clone())
        .text_size(px(11.5))
        .overflow_x_scroll()
        .whitespace_nowrap()
        .children(piece(&text, (id.0, id.1 + CODE_TEXT), setting))
        .into_any_element()
}

/// A list's item: its mark at the end of the margin, its words beside it,
/// so that a second line stands under the first and not under the mark.
fn item(text: &Rich, depth: u8, mark: usize, id: Name, setting: Setting<'_>) -> AnyElement {
    // The mark, and the space after it, are the margin's.
    let cut = (mark + 1).min(text.text.len());
    let (marked, words) = if text.text.is_char_boundary(cut) && text.text.is_char_boundary(mark) {
        (
            text.text[..mark].to_owned(),
            text.slice(cut..text.text.len()),
        )
    } else {
        (String::new(), text.clone())
    };
    div()
        .debug_selector(|| "prose-item".to_owned())
        .flex()
        .pl(px(INDENT * f32::from(depth)))
        .child(
            div()
                .flex_none()
                .w(px(INDENT))
                .pr(px(6.0))
                .flex()
                .justify_end()
                .text_color(setting.theme.c.muted)
                .child(SharedString::from(marked)),
        )
        .child(
            div()
                .flex_1()
                .min_w_0()
                .children(piece(&words, id, setting)),
        )
        .into_any_element()
}
