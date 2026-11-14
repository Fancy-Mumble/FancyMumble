//! A table, for what really is rows and columns: the web UI's `DataTable`
//! (`nebula/components/admin/controls.tsx`), as every list of the server's
//! administration shows its rows.
//!
//! Its head stays put and its rows scroll under it, inside the card it is
//! drawn on; only the rows in view are built, so a list of thousands costs
//! what a screenful does. A column's head is a place for the keyboard where
//! the rows can be put in order by it, and so is each row's menu.
//!
//! ```ignore
//! Table::new("users", columns, &widths, shown.len(), cx.processor(Shell::user_cells))
//!     .on_sort(cx.listener(|shell, at: &usize, _, cx| shell.sort_users(*at, cx)))
//!     .on_menu("users-menu", cx.listener(|shell, (row, at), _, cx| ...))
//! ```

mod cell;
mod chips;
mod column;
mod measure;

use std::ops::Range;
use std::rc::Rc;

use gpui::{
    AnyElement, App, ElementId, IntoElement, ParentElement, Pixels, Point, RenderOnce,
    SharedString, Styled, Window, div, prelude::*, px, uniform_list,
};

pub(crate) use cell::{Cell, ago};
pub(crate) use column::{Column, Direction, Widths};

use super::edges::{Edge, edged, grown, top_rounded};
use crate::theme::{ActiveTheme, Theme};
use column::{HEAD, SIDE};

/// The cells of the rows in a range, as the page has them.
type Rows = Box<dyn Fn(Range<usize>, &mut Window, &mut App) -> Vec<Vec<Cell>>>;
/// What a click on a column's head does, told which column.
type OnSort = Rc<dyn Fn(&usize, &mut Window, &mut App)>;
/// What a click on a row's menu does, told which row and where the pointer
/// was.
type OnMenu = Rc<dyn Fn(&(usize, Point<Pixels>), &mut Window, &mut App)>;

/// What every row is laid out by: the columns, their widths, and the menu
/// each row has, if it has one.
struct Shape {
    columns: Vec<Column>,
    widths: Widths,
    on_menu: Option<(&'static str, OnMenu)>,
    on_chip: Option<(&'static str, chips::OnChip)>,
}

/// How tall the head is inside its rule: 9 pixels either side of a line of
/// words set the way MUI sets a head cell's.
const HEAD_HEIGHT: f32 = 40.3;
/// How tall a row is inside its rule: the menu's button with 9 pixels
/// either side.
const ROW_HEIGHT: f32 = 43.0;

/// How tall a row is with its rule, the theme's weight of line.
fn row_height(theme: &Theme) -> f32 {
    ROW_HEIGHT + f32::from(theme.skin.line_width)
}

/// A table.
#[derive(IntoElement)]
pub(crate) struct Table {
    id: &'static str,
    columns: Vec<Column>,
    widths: Widths,
    count: usize,
    rows: Rows,
    on_sort: Option<OnSort>,
    on_menu: Option<(&'static str, OnMenu)>,
    on_chip: Option<(&'static str, chips::OnChip)>,
}

impl Table {
    /// `count` rows under `columns`, shared out by `widths`; `rows` gives
    /// the cells of those in view. `id` names the table and its parts for
    /// the tests: its heads are `<id>-sort-<column>`.
    pub(crate) fn new(
        id: &'static str,
        columns: Vec<Column>,
        widths: &Widths,
        count: usize,
        rows: impl Fn(Range<usize>, &mut Window, &mut App) -> Vec<Vec<Cell>> + 'static,
    ) -> Self {
        Self {
            id,
            columns,
            widths: widths.clone(),
            count,
            rows: Box::new(rows),
            on_sort: None,
            on_menu: None,
            on_chip: None,
        }
    }

    /// What a click on the head of a column the rows can be ordered by does.
    #[must_use]
    pub(crate) fn on_sort(
        mut self,
        handler: impl Fn(&usize, &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_sort = Some(Rc::new(handler));
        self
    }

    /// What a click on a row's menu button does. The buttons are named
    /// `<id>-<row>` for the tests.
    #[must_use]
    pub(crate) fn on_menu(
        mut self,
        id: &'static str,
        handler: impl Fn(&(usize, Point<Pixels>), &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_menu = Some((id, Rc::new(handler)));
        self
    }

    /// What a click on a pill of a row does, told the row and which pill
    /// of it. The pills are named `<id>-<row>-<pill>` for the tests, and
    /// are places for the keyboard.
    #[must_use]
    pub(crate) fn on_chip(
        mut self,
        id: &'static str,
        handler: impl Fn(&(usize, usize), &mut Window, &mut App) + 'static,
    ) -> Self {
        self.on_chip = Some((id, Rc::new(handler)));
        self
    }
}

/// `cell` placed in the column at `at`: as wide as the column's share, its
/// content padded and stood at the column's edge.
fn placed(at: usize, column: &Column, widths: &Widths, content: AnyElement) -> gpui::Div {
    let (width, grows) = widths.of(at, column);
    div()
        .h_full()
        .min_w_0()
        .flex_basis(px(width))
        .flex_shrink_0()
        .map(|cell| grown(cell, if grows { width } else { 0.0 }))
        .px(px(SIDE))
        .flex()
        .items_center()
        .when(column.end, gpui::Styled::justify_end)
        .child(content)
}

/// The head: each column's words, a place for the keyboard where the rows
/// can be put in order by it.
fn head(table: &Table, theme: &Theme) -> gpui::Div {
    let inner = theme.skin.radius_lg - theme.skin.line_width;
    div()
        .flex_none()
        .h(px(HEAD_HEIGHT) + theme.skin.line_width)
        .flex()
        .bg(theme.c.bg0)
        .map(|head| top_rounded(head, inner.max(px(0.0))))
        .map(|head| edged(head, Edge::Bottom, theme.skin.line_width))
        .border_color(theme.c.line2)
        .children(table.columns.iter().enumerate().map(|(at, column)| {
            let words = super::spaced(&column.head(), HEAD.spacing)
                .text_size(px(HEAD.size))
                .font_weight(HEAD.weight)
                .text_color(theme.c.dim);
            let content = match (&table.on_sort, column.sort) {
                (Some(on_sort), Some(_)) => {
                    let id = SharedString::from(format!("{}-sort-{at}", table.id));
                    let on_sort = on_sort.clone();
                    let selector = id.clone();
                    let button = div()
                        .id(ElementId::Name(id.clone()))
                        .debug_selector(move || selector.to_string())
                        .cursor_pointer()
                        .on_click(move |_, window, cx| on_sort(&at, window, cx))
                        .child(words);
                    super::Reachable::new(ElementId::Name(id), button)
                        .corner(theme.skin.radius_sm)
                        .into_any_element()
                }
                _ => words.into_any_element(),
            };
            placed(at, column, &table.widths, content)
        }))
}

/// The rows in `range`, each its cells in their columns under a rule.
fn rows(shape: &Rc<Shape>, cells: Vec<Vec<Cell>>, first: usize, theme: &Theme) -> Vec<AnyElement> {
    let Shape {
        columns,
        widths,
        on_menu,
        on_chip,
    } = shape.as_ref();
    cells
        .into_iter()
        .enumerate()
        .map(|(nth, cells)| {
            let row = first + nth;
            let menu = on_menu.as_ref().map(|(id, handler)| {
                let handler = handler.clone();
                super::IconButton::at(id, row, "ellipsis-vertical")
                    .size(cell::MENU_SIDE)
                    .glyph_size(15.0)
                    .on_click(move |event, window, cx| {
                        handler(&(row, event.position()), window, cx)
                    })
                    .into_any_element()
            });
            let mut menu = menu;
            div()
                .w_full()
                .h(px(row_height(theme)))
                .flex()
                .map(|row| edged(row, Edge::Top, theme.skin.line_width))
                .border_color(theme.c.line)
                .children(
                    cells
                        .into_iter()
                        .zip(columns)
                        .enumerate()
                        .map(|(at, (cell, column))| {
                            let wants_menu = matches!(cell, Cell::Menu);
                            let cell = match (cell, on_chip) {
                                (Cell::Chips(pills), Some((id, handler))) => {
                                    chips::clickable(id, row, pills, handler, theme)
                                }
                                (cell, _) => cell,
                            };
                            let content =
                                cell.content(theme, if wants_menu { menu.take() } else { None });
                            placed(at, column, widths, content)
                        }),
                )
                .into_any_element()
        })
        .collect()
}

impl RenderOnce for Table {
    fn render(self, _: &mut Window, cx: &mut App) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        let header = head(&self, &theme);
        let shape = Rc::new(Shape {
            columns: self.columns,
            widths: self.widths,
            on_menu: self.on_menu,
            on_chip: self.on_chip,
        });
        let fill = self.rows;
        let count = self.count;
        let list = uniform_list(
            SharedString::from(format!("{}-rows", self.id)),
            self.count,
            move |range: Range<usize>, window, cx| {
                let theme = ActiveTheme::get(cx);
                let first = range.start;
                let cells = fill(range, window, cx);
                rows(&shape, cells, first, &theme)
            },
        )
        // As tall as its rows to begin with, and shorter where the table
        // has less room: the CSS `flex: 0 1 auto` of the web UI's table,
        // which a list that measures itself does not take from its rows.
        .flex_basis(px(row_height(&theme) * count as f32))
        .flex_shrink()
        .min_h_0();
        div()
            .id(self.id)
            .debug_selector(move || self.id.to_owned())
            .flex_shrink()
            .min_h_0()
            .flex()
            .flex_col()
            .rounded(theme.skin.radius_lg)
            .bg(theme.c.card)
            .map(|card| edged(card, Edge::All, theme.skin.line_width))
            .border_color(theme.c.line)
            .child(header)
            .child(list)
    }
}
