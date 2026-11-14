//! The boxes made of boxes: a list's items beside their marks, a table's
//! cells in their columns, and a row of boxes side by side.

use gpui::{AnyElement, IntoElement, ParentElement, Styled, div, prelude::*, px, relative};

use super::Painter;
use crate::page::{Align, Cell, Extent, Frame, Item, Len, Row, Table, Valign};

impl Painter<'_> {
    /// A list: each item's mark in the gutter, its words beside it, the
    /// items close under one another. The mark stays at the gutter however
    /// the words in the item stand.
    pub(super) fn list(&self, items: &[Item], gutter: Len) -> AnyElement {
        let gutter = gutter.at(self.surface.size);
        div()
            .flex()
            .flex_col()
            .children(items.iter().map(|item| {
                let size = super::text::rounded_size(item.look.size.at(self.surface.size));
                let tag = self.tag("item");
                div()
                    .debug_selector(move || tag)
                    .flex()
                    .items_start()
                    .child(
                        div()
                            .flex_none()
                            .w(px(gutter))
                            .pr(px(size * 0.5))
                            .flex()
                            .justify_end()
                            .text_size(px(size))
                            .line_height(px((size * self.surface.lead).round()))
                            .text_color(self.text_ink(&item.look))
                            .child(item.mark.clone()),
                    )
                    .child(
                        div()
                            .flex_1()
                            .flex()
                            .flex_col()
                            .children(self.stack(&item.body, (false, false))),
                    )
            }))
            .into_any_element()
    }

    /// A table: rows of cells, each as wide as its columns ask, the cells
    /// of a row as tall as the tallest.
    pub(super) fn table(&self, table: &Table, frame: &Frame) -> AnyElement {
        let gap = px(table.spacing);
        let stretches = frame.width != Extent::Auto;
        // Each column starts at its words' own width, and gives some up,
        // down to its longest word, where the room is narrower; in a table
        // wider than its words, the rest is shared out as they are.
        let naturals = self.columns_natural(table);
        let leasts = self.columns_least(table);
        div()
            .flex()
            .flex_col()
            .gap(gap)
            .p(gap)
            .children(table.rows.iter().map(|cells| {
                div().flex().gap(gap).children(
                    cells
                        .iter()
                        .map(|cell| self.cell(cell, table, stretches, (&naturals, &leasts))),
                )
            }))
            .into_any_element()
    }

    fn cell(
        &self,
        cell: &Cell,
        table: &Table,
        stretches: bool,
        (naturals, leasts): (&[f32], &[f32]),
    ) -> AnyElement {
        let spanned =
            &table.columns[cell.column..(cell.column + cell.span.0).min(table.columns.len())];
        let share: Option<f32> = spanned
            .iter()
            .map(|extent| match extent {
                Extent::Share(share) => Some(*share),
                _ => None,
            })
            .sum();
        let pixels: Option<f32> = spanned
            .iter()
            .map(|extent| match extent {
                Extent::Len(len) => Some(len.at(self.surface.size)),
                _ => None,
            })
            .sum();
        // The cell's own width is its columns'; what it says of its own is
        // already counted in them.
        let frame = Frame {
            width: Extent::Auto,
            ..cell.frame.clone()
        };
        let tag = self.tag("cell");
        let end = (cell.column + cell.span.0).min(leasts.len());
        let least: f32 = leasts
            .get(cell.column..end)
            .unwrap_or_default()
            .iter()
            .sum();
        let part = self.framed(
            div()
                .debug_selector(move || tag)
                .flex()
                .flex_col()
                .min_w(px(least.ceil())),
            &frame,
            false,
            false,
        );
        // A cell starts from the width its columns ask, and gives some up
        // where the row is too narrow, but never below its longest word:
        // what does not fit then runs past the table rather than into a
        // column of single letters.
        let part = match (share, pixels) {
            (Some(share), _) if share > 0.0 => part.flex_basis(relative(share)).flex_shrink_1(),
            (_, Some(pixels)) => part.flex_basis(px(pixels)).flex_shrink_1(),
            _ => {
                let end = (cell.column + cell.span.0).min(naturals.len());
                let natural: f32 = naturals
                    .get(cell.column..end)
                    .unwrap_or_default()
                    .iter()
                    .sum();
                let mut part = part.flex_basis(px(natural.ceil())).flex_shrink_1();
                if stretches {
                    part.style().flex_grow = Some(natural.max(1.0));
                }
                part
            }
        };
        let part = match cell.valign {
            Valign::Top => part.justify_start(),
            Valign::Middle => part.justify_center(),
            Valign::Bottom => part.justify_end(),
        };
        let kept = (true, true);
        let body = self.grounded_by(&cell.frame, || self.stack(&cell.body, kept));
        self.linked(part.children(body), cell.frame.link.as_ref())
    }

    /// Boxes side by side, or one under another: `display: flex`.
    pub(super) fn row(&self, row: &Row) -> AnyElement {
        let base = self.surface.size;
        let part = div()
            .flex()
            .when(row.column, Styled::flex_col)
            .when(row.wrap, Styled::flex_wrap)
            .gap(px(row.gap.at(base)))
            .when(row.centred, Styled::items_center)
            .when(!row.centred, Styled::items_start);
        let part = match row.justify {
            Align::Left => part.justify_start(),
            Align::Center => part.justify_center(),
            Align::Right => part.justify_end(),
        };
        part.children(row.items.iter().map(|item| {
            let margin = item.frame.margin;
            let flex = item.frame.flex;
            let mut held = div()
                .flex()
                .flex_col()
                .mt(px(margin.top.at(base)))
                .mb(px(margin.bottom.at(base)))
                .child(self.block(item));
            let style = held.style();
            match flex {
                Some(flex) => {
                    style.flex_grow = Some(flex.grow);
                    style.flex_shrink = Some(flex.shrink);
                    if let Extent::Len(len) = flex.basis {
                        style.flex_basis = Some(px(len.at(base)).into());
                    }
                    if let Extent::Share(share) = flex.basis {
                        style.flex_basis = Some(relative(share).into());
                    }
                }
                None => style.flex_shrink = Some(1.0),
            }
            held
        }))
        .into_any_element()
    }
}
