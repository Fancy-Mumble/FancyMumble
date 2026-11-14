//! A column of a table: its head, how it takes its share of the width, and
//! whether the rows can be put in order by it.
//!
//! The width is shared out as a browser shares out a table laid out
//! `auto`: each column is first as wide as its widest content, and what is
//! left over goes to the columns that take any in proportion to those
//! widths. Flexbox does exactly that when a column's basis and its grow
//! factor are both its natural width, so a row is a flex row and nothing
//! has to know how wide the table came out.

use gpui::{App, SharedString};

use super::cell::Cell;
use super::measure::Setting;
use crate::theme::Theme;

/// The room each side of a cell's content.
pub(super) const SIDE: f32 = 12.0;

/// How a column's head is set: 10.5 pixels, heavy, in capitals spaced
/// eight hundredths of their size apart.
pub(super) const HEAD: Setting = Setting::new(10.5, gpui::FontWeight::SEMIBOLD).spaced(0.84);

/// Which way the rows run, by the column they are in order by.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) enum Direction {
    /// First to last: A to Z, oldest to newest.
    #[default]
    Up,
    Down,
}

impl Direction {
    /// The other way.
    #[must_use]
    pub(crate) fn turned(self) -> Self {
        match self {
            Self::Up => Self::Down,
            Self::Down => Self::Up,
        }
    }

    /// The mark after the head of the column the rows are in order by.
    fn mark(self) -> &'static str {
        match self {
            Self::Up => " ▲",
            Self::Down => " ▼",
        }
    }
}

/// One column.
#[derive(Debug, Clone)]
pub(crate) struct Column {
    pub(super) title: SharedString,
    /// The width it keeps at least; `None` for one that takes a share of
    /// what is left over.
    pub(super) least: Option<f32>,
    /// Whether its content stands at its far edge.
    pub(super) end: bool,
    /// Whether the rows can be put in order by it, and if they are, which
    /// way.
    pub(super) sort: Option<Option<Direction>>,
}

impl Column {
    pub(crate) fn new(title: impl Into<SharedString>) -> Self {
        Self {
            title: title.into(),
            least: None,
            end: false,
            sort: None,
        }
    }

    /// At least `width` wide, and no wider than its content needs: it
    /// takes no share of what is left over.
    #[must_use]
    pub(crate) fn least(mut self, width: f32) -> Self {
        self.least = Some(width);
        self
    }

    /// Its content at the far edge.
    #[must_use]
    pub(crate) fn end(mut self) -> Self {
        self.end = true;
        self
    }

    /// The rows can be put in order by it; `by` is the way they run when
    /// they are.
    #[must_use]
    pub(crate) fn sortable(mut self, by: Option<Direction>) -> Self {
        self.sort = Some(by);
        self
    }

    /// What its head says.
    pub(super) fn head(&self) -> SharedString {
        let mark = self.sort.flatten().map_or("", Direction::mark);
        format!("{}{mark}", self.title.to_uppercase()).into()
    }
}

/// How wide each column's content is, its sides counted: what the columns
/// share the table's width out by.
#[derive(Debug, Clone, Default, PartialEq)]
pub(crate) struct Widths(pub(super) Vec<f32>);

impl Widths {
    /// The widths of `columns` holding `rows`: each the widest of its head
    /// and its cells. Measured over every row, not only those in view, so
    /// the columns do not move while the table is scrolled.
    pub(crate) fn measure(
        columns: &[Column],
        rows: impl IntoIterator<Item = Vec<Cell>>,
        theme: &Theme,
        cx: &App,
    ) -> Self {
        let mut widest: Vec<f32> = columns
            .iter()
            .map(|column| HEAD.width(&column.head(), theme, cx))
            .collect();
        for row in rows {
            for (width, cell) in widest.iter_mut().zip(&row) {
                *width = width.max(cell.natural(theme, cx));
            }
        }
        Self(
            widest
                .into_iter()
                .zip(columns)
                .map(|(width, column)| (width + 2.0 * SIDE).max(column.least.unwrap_or(0.0)))
                .collect(),
        )
    }

    /// The width of the column at `at`, and whether it takes a share of
    /// what is left over.
    pub(super) fn of(&self, at: usize, column: &Column) -> (f32, bool) {
        let width = self.0.get(at).copied().unwrap_or(2.0 * SIDE);
        (width, column.least.is_none())
    }
}
