//! Every run of every test document is read where it is drawn: the welcome
//! designer's templates in each of their targets, the old-client document
//! and the banner like the user's, in the default theme dark and light.

use std::sync::Arc;

use super::Surface;
use super::ink::Grounds;
use crate::page::{Block, Kind, Page, Piece};
use crate::theme::{Catalog, DEFAULT_THEME, Mode, Theme};

/// Every test document, by name.
const DOCUMENTS: &[(&str, &str)] = &[
    ("banner", include_str!("../../../page/samples/banner.html")),
    ("qt", include_str!("../../../page/samples/qt.html")),
    (
        "front-page",
        include_str!("../../../page/samples/front-page.html"),
    ),
    (
        "front-page-qt",
        include_str!("../../../page/samples/front-page-qt.html"),
    ),
    ("modern", include_str!("../../../page/samples/modern.html")),
    (
        "modern-qt",
        include_str!("../../../page/samples/modern-qt.html"),
    ),
    ("notice", include_str!("../../../page/samples/notice.html")),
    (
        "notice-qt",
        include_str!("../../../page/samples/notice-qt.html"),
    ),
    (
        "server-front-page",
        include_str!("../../../page/samples/server-front-page.html"),
    ),
    (
        "event-night",
        include_str!("../../../page/samples/designer-event-night.html"),
    ),
    (
        "front-door",
        include_str!("../../../page/samples/designer-front-door.html"),
    ),
    (
        "german-welcome",
        include_str!("../../../page/samples/designer-german-welcome.html"),
    ),
    (
        "guest-nudge",
        include_str!("../../../page/samples/designer-guest-nudge.html"),
    ),
    (
        "newcomer-and-regular",
        include_str!("../../../page/samples/designer-newcomer-and-regular.html"),
    ),
    (
        "old-and-new",
        include_str!("../../../page/samples/designer-old-and-new.html"),
    ),
    (
        "outdated-client",
        include_str!("../../../page/samples/designer-outdated-client.html"),
    ),
    (
        "quiet-welcome",
        include_str!("../../../page/samples/designer-quiet-welcome.html"),
    ),
    (
        "warm-welcome",
        include_str!("../../../page/samples/designer-warm-welcome.html"),
    ),
];

/// Each run of `blocks` that reads worse than it needs, as its words.
fn unreadable(blocks: &[Block], grounds: &Grounds<'_>, out: &mut Vec<String>) {
    for block in blocks {
        grounds.within(&block.frame, || match &block.kind {
            Kind::Para(para) => runs(para, grounds, out),
            Kind::List(items) => {
                for item in items {
                    let (reads, needs) = grounds.reads(&item.look);
                    if reads + 0.01 < needs {
                        out.push(format!("the mark {:?} at {reads:.2}", item.mark));
                    }
                    unreadable(&item.body, grounds, out);
                }
            }
            Kind::Table(table) => {
                for cell in table.rows.iter().flatten() {
                    grounds.within(&cell.frame, || unreadable(&cell.body, grounds, out));
                }
            }
            _ => unreadable(
                &block.inner().into_iter().cloned().collect::<Vec<_>>(),
                grounds,
                out,
            ),
        });
    }
}

/// Each run of a paragraph that reads worse than it needs.
fn runs(para: &crate::page::Para, grounds: &Grounds<'_>, out: &mut Vec<String>) {
    for piece in &para.pieces {
        let Piece::Words(words) = piece else {
            continue;
        };
        for (range, look) in &words.runs {
            let (reads, needs) = grounds.reads(look);
            let said = words.text[range.clone()].trim();
            if reads + 0.01 < needs && !said.is_empty() {
                out.push(format!("{said:?} at {reads:.2}, needs {needs}"));
            }
        }
    }
    let atoms: Vec<Block> = para
        .pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Atom(atom) => Some((**atom).clone()),
            Piece::Words(_) => None,
        })
        .collect();
    unreadable(&atoms, grounds, out);
}

fn theme(mode: Mode) -> Theme {
    Catalog::get()
        .resolve(DEFAULT_THEME, mode, &[])
        .unwrap_or_else(|| panic!("the default theme in {mode:?}"))
}

#[test]
fn every_run_of_every_test_document_reads_in_dark_and_light() {
    let mut failures = Vec::new();
    for (name, html) in DOCUMENTS {
        let page = Arc::new(Page::read(html));
        for mode in [Mode::Dark, Mode::Light] {
            let theme = theme(mode);
            // The welcome dialog's surface, and the server card's.
            for surface in [
                Surface::text(13.5, 1.55, &theme).inked(theme.c.muted),
                Surface::text(12.5, 1.5, &theme),
            ] {
                let grounds = Grounds::new(&theme, surface);
                let mut found = Vec::new();
                unreadable(&page.blocks, &grounds, &mut found);
                failures.extend(
                    found
                        .into_iter()
                        .map(|run| format!("{name} {mode:?}: {run}")),
                );
            }
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}

#[test]
fn a_documents_dark_text_on_its_own_light_panel_stays_and_black_on_the_dark_surface_does_not() {
    let theme = theme(Mode::Dark);
    let grounds = Grounds::new(&theme, Surface::text(13.0, 1.5, &theme));
    let read = Page::read(concat!(
        r#"<p style="background-color:#fdf4e4;color:#4d3608">kept</p>"#,
        r#"<p><span style="color:#000000">black</span></p>"#,
    ));
    let mut inks = Vec::new();
    for block in &read.blocks {
        grounds.within(&block.frame, || {
            if let Kind::Para(para) = &block.kind
                && let Piece::Words(words) = &para.pieces[0]
            {
                inks.push((grounds.text(&words.runs[0].1), words.runs[0].1.ink));
            }
        });
    }
    let as_given = |at: usize| inks[at].1.map(|ink| grounds.ink(ink));
    assert_eq!(
        Some(inks[0].0),
        as_given(0),
        "dark on its own light panel stays"
    );
    assert_ne!(
        Some(inks[1].0),
        as_given(1),
        "black on the dark surface is lifted"
    );
    assert!(super::ink::contrast(inks[1].0, theme.c.bg0) >= super::ink::BODY);
}
