//! The two boxes made of boxes: a list of items, and a table of cells.

use super::build::{Builder, grounded};
use super::css::Display;
use super::dialect::{self, Treat};
use super::dom::{Id, Kind as NodeKind};
use super::flow::Flow;
use super::style::{Context, Styled};
use super::tree::{Cell, Extent, Item, Kind, Marker, Table, Valign};

/// How many rows and columns one table may have. Past these, the rest of
/// it is left out.
pub(super) const ROWS_MOST: usize = 256;
pub(super) const COLUMNS_MOST: usize = 32;

impl Builder<'_> {
    /// The element at `id`, if it is drawn, by the tag it is drawn as.
    fn kept(&self, id: Id) -> Option<&'static str> {
        match &self.dom.nodes[id].kind {
            NodeKind::Element {
                name, html: true, ..
            } => match dialect::treat(&name.to_ascii_lowercase()) {
                Treat::Keep(tag) => Some(tag),
                Treat::Drop | Treat::Unwrap => None,
            },
            _ => None,
        }
    }

    fn child_ids(&self, id: Id) -> Vec<Id> {
        self.dom.nodes[id].children.clone()
    }

    /// A list's items, each with its mark.
    pub(super) fn list(
        &mut self,
        id: Id,
        styled: &Styled,
        context: &Context,
        depth: usize,
    ) -> Kind {
        let marker = styled.marker.unwrap_or(Marker::Disc);
        let mut items: Vec<Item> = Vec::new();
        let mut number = 1;
        for child in self.child_ids(id) {
            if self.full() {
                break;
            }
            if self.kept(child) == Some("li") {
                let item = self.styled(child, "li", context);
                if item.display == Display::None {
                    continue;
                }
                self.blocks += 1;
                let mut flow = Flow::new(&item.context);
                self.children(child, &item.context, &mut flow, depth + 1);
                items.push(Item {
                    mark: mark(item.marker.unwrap_or(marker), number),
                    look: item.context.look.clone(),
                    body: flow.finish(),
                });
                number += 1;
                continue;
            }
            // Anything else in a list is the list's, under no mark.
            let mut flow = Flow::new(context);
            self.node(child, context, &mut flow, depth + 1);
            let body = flow.finish();
            if !body.is_empty() {
                items.push(Item {
                    mark: String::new(),
                    look: context.look.clone(),
                    body,
                });
            }
        }
        Kind::List(items)
    }

    /// The rows a table holds, in the order they are drawn: its head, its
    /// bodies, its foot.
    fn rows_of(&self, id: Id) -> Vec<Id> {
        let (mut head, mut body, mut foot) = (Vec::new(), Vec::new(), Vec::new());
        for child in self.child_ids(id) {
            match self.kept(child) {
                Some("tr") => body.push(child),
                Some(group @ ("thead" | "tbody" | "tfoot")) => {
                    let rows = self
                        .child_ids(child)
                        .into_iter()
                        .filter(|row| self.kept(*row) == Some("tr"));
                    match group {
                        "thead" => head.extend(rows),
                        "tfoot" => foot.extend(rows),
                        _ => body.extend(rows),
                    }
                }
                _ => {}
            }
        }
        head.into_iter()
            .chain(body)
            .chain(foot)
            .take(ROWS_MOST)
            .collect()
    }

    /// A table's cells, each placed in its column, and how wide each
    /// column is asked to be.
    pub(super) fn table(
        &mut self,
        id: Id,
        styled: &Styled,
        context: &Context,
        depth: usize,
    ) -> Kind {
        let rows_ids = self.rows_of(id);
        // A table with an edge or a ground gives its cells room inside.
        let boxed = super::room::is_box(styled);
        let mut taken = vec![[0_usize; COLUMNS_MOST]; rows_ids.len()];
        let mut columns = vec![Extent::Auto; 0];
        let mut rows = Vec::with_capacity(rows_ids.len());
        for (at, row_id) in rows_ids.iter().copied().enumerate() {
            let row_style = self.styled(row_id, "tr", context);
            let mut cells = Vec::new();
            let mut column = 0;
            for cell_id in self.child_ids(row_id) {
                let Some(tag @ ("td" | "th")) = self.kept(cell_id) else {
                    continue;
                };
                while column < COLUMNS_MOST && taken[at][column] > 0 {
                    column += 1;
                }
                if column >= COLUMNS_MOST || self.full() {
                    break;
                }
                let span = |name: &str, most: usize| {
                    self.dom
                        .attribute(cell_id, name)
                        .and_then(|value| value.trim().parse::<usize>().ok())
                        .unwrap_or(1)
                        .clamp(1, most)
                };
                let wide = span("colspan", COLUMNS_MOST - column);
                let tall = span("rowspan", rows_ids.len() - at);
                for below in taken.iter_mut().skip(at).take(tall) {
                    below[column..column + wide]
                        .iter_mut()
                        .for_each(|cell| *cell = 1);
                }
                let cell = self.cell(cell_id, tag, &row_style, boxed, depth);
                if columns.len() < column + wide {
                    columns.resize(column + wide, Extent::Auto);
                }
                if wide == 1 && columns[column] == Extent::Auto {
                    columns[column] = cell.frame.width;
                }
                cells.push(Cell {
                    column,
                    span: (wide, tall),
                    ..cell
                });
                column += wide;
            }
            rows.push(cells);
        }
        Kind::Table(Table {
            rows,
            columns,
            spacing: styled.spacing,
        })
    }

    fn cell(&mut self, id: Id, tag: &str, row: &Styled, boxed: bool, depth: usize) -> Cell {
        self.blocks += 1;
        let mut styled = self.styled(id, tag, &row.context);
        grounded(&mut styled.frame, row.frame.ground);
        // A row's height is the least each of its cells is.
        if styled.frame.height.is_none() {
            styled.frame.height = row.frame.height;
        }
        let mut flow = Flow::new(&styled.context);
        self.children(id, &styled.context, &mut flow, depth + 2);
        let mut body = flow.finish();
        if (boxed || super::room::is_box(&styled)) && super::room::holds(&body) {
            super::room::pad(&mut styled, &mut body);
        }
        Cell {
            frame: styled.frame,
            column: 0,
            span: (1, 1),
            valign: styled.valign.or(row.valign).unwrap_or(Valign::Middle),
            body,
        }
    }
}

/// The mark of the `number`th item of a list marked with `marker`.
fn mark(marker: Marker, number: u32) -> String {
    match marker {
        Marker::Disc => "•".to_owned(),
        Marker::Circle => "◦".to_owned(),
        Marker::Square => "▪".to_owned(),
        Marker::Decimal => format!("{number}."),
        Marker::LowerAlpha => format!("{}.", letters(number)),
        Marker::UpperAlpha => format!("{}.", letters(number).to_uppercase()),
        Marker::LowerRoman => format!("{}.", roman(number)),
        Marker::UpperRoman => format!("{}.", roman(number).to_uppercase()),
        Marker::None => String::new(),
    }
}

/// `a`, `b`, … `z`, `aa`: how a list counts in letters.
fn letters(mut number: u32) -> String {
    let mut out = Vec::new();
    while number > 0 {
        number -= 1;
        out.push(char::from(b'a' + u8::try_from(number % 26).unwrap_or(0)));
        number /= 26;
    }
    out.iter().rev().collect()
}

fn roman(mut number: u32) -> String {
    const NUMERALS: [(u32, &str); 13] = [
        (1000, "m"),
        (900, "cm"),
        (500, "d"),
        (400, "cd"),
        (100, "c"),
        (90, "xc"),
        (50, "l"),
        (40, "xl"),
        (10, "x"),
        (9, "ix"),
        (5, "v"),
        (4, "iv"),
        (1, "i"),
    ];
    let mut out = String::new();
    for (value, numeral) in NUMERALS {
        while number >= value {
            out.push_str(numeral);
            number -= value;
        }
    }
    out
}
