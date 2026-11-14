//! An about drawn: its blocks, in the measures of a card's text. The card,
//! the full profile and the editor's preview all draw one this way.
//!
//! A list stands as its alignment says: against the left, its marks hang in
//! a margin of their own; centred, each item is one line with its mark, so
//! the mark stays beside its words. A picture is its thumbnail; a click
//! looks at it large, fetching the full picture where one is kept.

use std::sync::Arc;

use gpui::{
    AnyElement, Context, Div, Hsla, IntoElement, ParentElement, SharedString, Styled, WeakEntity,
    div, prelude::*, px,
};
use mumble_tauri_lib::engine_api::about::{Align, Block, Picture, Run};

use super::Shell;
use super::conversation::words_as;
use crate::profile::{Shown, rich_of};
use crate::theme::Theme;

/// The gap between two pictures of a row, and between blocks.
const GAP: f32 = 4.0;

/// How an about is drawn where it is drawn.
#[derive(Clone, Copy)]
pub(super) struct Drawing<'a> {
    /// What names its parts.
    pub name: &'static str,
    /// How wide it is: what the pictures of a row share.
    pub room: f32,
    /// The ink of its words.
    pub ink: Hsla,
    /// The ink of a link.
    pub link: Hsla,
    /// The ink of a rule: a divider, a quote's side.
    pub line: Hsla,
    pub theme: &'a Theme,
    /// Who asks before a link is opened.
    pub viewer: &'a WeakEntity<Shell>,
}

/// The blocks of `shown`, in order.
pub(super) fn blocks(
    shown: &Arc<Shown>,
    drawing: Drawing<'_>,
    cx: &mut Context<Shell>,
) -> Vec<AnyElement> {
    let mut pictures = 0;
    let mut drawn = Vec::with_capacity(shown.about.blocks.len());
    for (at, block) in shown.about.blocks.iter().enumerate() {
        let element = match block {
            Block::Heading { text, align } => heading(text, *align, drawing).into_any_element(),
            Block::Text { runs, align } => text(runs, *align, (at, 0), drawing).into_any_element(),
            Block::List {
                numbered,
                items,
                align,
            } => list(items, *numbered, *align, at, drawing).into_any_element(),
            Block::Quote { runs } => quote(runs, at, drawing).into_any_element(),
            Block::Divider => div()
                .my(px(4.0))
                .h(px(1.0))
                .w_full()
                .bg(drawing.line)
                .into_any_element(),
            Block::Pictures { pictures: row } => {
                let from = pictures;
                pictures += row.len();
                picture_row(shown, row, from, drawing, cx).into_any_element()
            }
        };
        drawn.push(element);
    }
    drawn
}

/// `div` with its text standing as `align` says.
fn aligned(div: Div, align: Align) -> Div {
    match align {
        Align::Left => div.text_left(),
        Align::Center => div.text_center(),
        Align::Right => div.text_right(),
    }
}

fn heading(text: &str, align: Align, drawing: Drawing<'_>) -> Div {
    aligned(div().w_full().mt(px(2.0)), align)
        .text_size(px(13.0))
        .font_weight(gpui::FontWeight::BOLD)
        .text_color(drawing.theme.c.text)
        .child(SharedString::from(text.to_owned()))
}

/// Runs, with their links live, named by the block and the line.
fn text(runs: &[Run], align: Align, (at, line): (usize, usize), drawing: Drawing<'_>) -> Div {
    let id = (SharedString::from(format!("{}-{at}", drawing.name)), line);
    aligned(div().w_full(), align).children(words_as(
        id,
        &rich_of(runs),
        (None, Some(drawing.viewer)),
        drawing.link,
        drawing.theme,
    ))
}

fn list(items: &[Vec<Run>], numbered: bool, align: Align, at: usize, drawing: Drawing<'_>) -> Div {
    let mark = |nth: usize| {
        if numbered {
            format!("{}.", nth + 1)
        } else {
            "\u{2022}".to_owned()
        }
    };
    let rows = items.iter().enumerate().map(|(nth, item)| {
        if align == Align::Left {
            // The mark in a margin of its own; the words beside it.
            div()
                .w_full()
                .flex()
                .gap(px(6.0))
                .child(
                    div()
                        .flex_none()
                        .w(px(16.0))
                        .text_right()
                        .text_color(drawing.ink)
                        .child(mark(nth)),
                )
                .child(
                    div()
                        .flex_1()
                        .min_w_0()
                        .child(text(item, Align::Left, (at, nth), drawing)),
                )
        } else {
            // The mark is the start of the item's line, and stands with it.
            let mut marked = vec![Run::plain(format!("{} ", mark(nth)))];
            marked.extend_from_slice(item);
            text(&marked, align, (at, nth), drawing)
        }
    });
    div().w_full().flex().flex_col().gap(px(2.0)).children(rows)
}

fn quote(runs: &[Run], at: usize, drawing: Drawing<'_>) -> Div {
    div()
        .w_full()
        .border_l_2()
        .border_color(drawing.line)
        .pl(px(10.0))
        .italic()
        .child(text(runs, Align::Left, (at, 0), drawing))
}

/// A row of pictures sharing the room: each its thumbnail, as tall as its
/// shape asks within reason, or a stand-in where it has none.
fn picture_row(
    shown: &Arc<Shown>,
    row: &[Picture],
    from: usize,
    drawing: Drawing<'_>,
    cx: &mut Context<Shell>,
) -> Div {
    #[expect(clippy::cast_precision_loss, reason = "a handful of pictures")]
    let count = row.len().max(1) as f32;
    let wide = (drawing.room - GAP * (count - 1.0)) / count;
    let tiles = row.iter().enumerate().map(|(nth, picture)| {
        let index = from + nth;
        let thumb = shown.thumbs.get(index).cloned().flatten();
        #[expect(clippy::cast_precision_loss, reason = "pixels of a picture")]
        let tall = match (picture.width, picture.height) {
            (0, _) | (_, 0) => wide,
            (width, height) => wide * height as f32 / width as f32,
        }
        .clamp(wide * 0.5, wide * 1.4);
        let key = picture.key.clone().map(SharedString::from);
        let opened = thumb.clone();
        let opens = opened.is_some() || key.is_some();
        div()
            .id((
                SharedString::from(format!("{}-picture", drawing.name)),
                index,
            ))
            .debug_selector({
                let name = drawing.name;
                move || format!("{name}-picture-{index}")
            })
            .flex_none()
            .w(px(wide))
            .h(px(tall))
            .rounded(px(8.0))
            .overflow_hidden()
            .bg(drawing.theme.c.card2)
            .flex()
            .items_center()
            .justify_center()
            .when(opens, |tile| {
                tile.cursor_pointer()
                    .on_click(cx.listener(move |shell, _, _, cx| {
                        shell.look_at_profile_picture(opened.clone(), key.clone(), cx);
                    }))
            })
            .map(|tile| match thumb {
                Some(thumb) => tile.child(
                    gpui::img(crate::pictures::shown(&thumb, crate::pictures::Fit::Tile))
                        .size_full()
                        .object_fit(gpui::ObjectFit::Cover),
                ),
                None => tile.child(super::kit::icon("image", 18.0, drawing.theme.c.dim)),
            })
    });
    div()
        .w_full()
        .flex()
        .justify_center()
        .gap(px(GAP))
        .children(tiles)
}
