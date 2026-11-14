//! The reader, held to what a browser and the web client's sanitiser do.

use std::time::{Duration, Instant};

use super::*;

fn page(html: &str) -> Page {
    Page::read(html)
}

/// The blocks of a page whose only block is a box: what is in the box.
fn inner(block: &Block) -> &[Block] {
    match &block.kind {
        Kind::Stack(blocks) => blocks,
        _ => std::slice::from_ref(block),
    }
}

fn para(block: &Block) -> &Para {
    match &block.kind {
        Kind::Para(para) => para,
        other => panic!("not a paragraph: {other:?}"),
    }
}

fn words(block: &Block) -> &Words {
    match para(block).pieces.as_slice() {
        [Piece::Words(words)] => words,
        other => panic!("not words alone: {other:?}"),
    }
}

/// How the text `wanted` in `words` is set.
fn look_of<'a>(words: &'a Words, wanted: &str) -> &'a Look {
    let at = words
        .text
        .find(wanted)
        .unwrap_or_else(|| panic!("no {wanted:?} in {:?}", words.text));
    &words
        .runs
        .iter()
        .find(|(range, _)| range.contains(&at))
        .expect("a run over every character")
        .1
}

/// A PNG `width` by `height`, as a `data:` URI.
fn png(width: u32, height: u32) -> String {
    use base64::Engine as _;
    let image = image::RgbaImage::from_pixel(width, height, image::Rgba([200, 30, 30, 255]));
    let mut bytes = Vec::new();
    image
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("a PNG");
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

#[test]
fn white_space_folds_as_a_browser_folds_it() {
    let read = page("  hello   there\n friend  <br>  again ");
    assert_eq!(read.plain(), "hello there friend\nagain");
    let kept = page("<pre>a\n   b</pre>");
    assert_eq!(words(&kept.blocks[0]).text, "a\n   b");
    assert!(para(&kept.blocks[0]).keep_lines);
}

#[test]
fn headings_are_sized_and_spaced_as_a_browser_sets_them() {
    let read = page("<h1>One</h1><h2>Two</h2><h3>Three</h3><h6>Six</h6><p>Text</p>");
    let sizes: Vec<f32> = read
        .blocks
        .iter()
        .map(|block| look_of(words(block), "").size.em)
        .collect();
    assert_eq!(sizes, [2.0, 1.5, 1.17, 0.67, 1.0]);
    assert_eq!(look_of(words(&read.blocks[0]), "One").weight, 700);
    // Room above and below, in the heading's own size: 0.67 of two.
    let margin = read.blocks[0].frame.margin;
    assert!((margin.top.em - 1.34).abs() < 1e-4 && margin.bottom == margin.top);
    assert_eq!(read.blocks[4].frame.margin.top, Len::em(1.0));
    // A size the document gives wins.
    let sized = page(r#"<h2 style="margin:0;font-size:30px">Big</h2>"#);
    assert_eq!(look_of(words(&sized.blocks[0]), "Big").size, Len::px(30.0));
    assert_eq!(sized.blocks[0].frame.margin.top, Len::ZERO);
}

#[test]
fn every_inline_tag_sets_its_words() {
    let read = page(concat!(
        "<p><b>b</b> <strong>st</strong> <i>i</i> <em>em</em> <u>u</u> <ins>ins</ins> ",
        "<s>struck</s> <del>del</del> <small>sm</small> <sub>sub</sub> <sup>sup</sup> ",
        "<mark>mark</mark> <code>code</code> <abbr>abbr</abbr> <span>span</span></p>"
    ));
    let words = words(&read.blocks[0]);
    assert_eq!(look_of(words, "b ").weight, 700);
    assert_eq!(look_of(words, "st").weight, 700);
    assert!(look_of(words, "i ").italic && look_of(words, "em").italic);
    assert!(look_of(words, "u ").underline && look_of(words, "ins").underline);
    assert!(look_of(words, "struck").strike && look_of(words, "del").strike);
    for small in ["sm", "sub", "sup"] {
        assert!(
            (look_of(words, small).size.em - 1.0 / 1.2).abs() < 1e-4,
            "{small}"
        );
    }
    assert_eq!(
        look_of(words, "mark").ground,
        Some(Ink::Rgba([255, 255, 0, 255]))
    );
    assert_eq!(look_of(words, "code").family, Family::Mono);
    assert_eq!(look_of(words, "abbr"), &Look::default());
}

#[test]
fn an_old_font_tag_is_read_as_a_browser_reads_it() {
    let read = page(
        r#"<p><font color="red" size="+2" face="Georgia, serif">big</font> <font color="00ff00" size="1">small</font></p>"#,
    );
    let words = words(&read.blocks[0]);
    let big = look_of(words, "big");
    assert_eq!(big.ink, Some(Ink::Rgba([255, 0, 0, 255])));
    // `+2` is the fifth of seven fixed sizes, not a step from the text around.
    assert_eq!(big.size, Len::px(24.0));
    assert_eq!(big.family, Family::Named("Georgia, serif".into()));
    let small = look_of(words, "small");
    assert_eq!(
        (small.ink, small.size),
        (Some(Ink::Rgba([0, 255, 0, 255])), Len::px(10.0))
    );
}

#[test]
fn the_safe_properties_are_drawn_and_anything_that_reaches_out_is_not() {
    let read = page(concat!(
        r#"<p style="color: rgb(10 20 30 / 50%); background-color: hsl(120, 100%, 25%); "#,
        r#"text-align: center; padding: 4px 8px; border: 2px dashed #123; border-radius: 6px; "#,
        r#"font-weight: 600; font-style: italic; text-transform: uppercase; line-height: 2; "#,
        r#"width: 50%; max-width: 300px; margin: 0 auto; box-shadow: 0 2px 6px #000">x</p>"#,
    ));
    let block = &read.blocks[0];
    let frame = &block.frame;
    assert_eq!(frame.ground, Some(Ink::Rgba([0, 128, 0, 255])));
    assert_eq!(frame.padding.left, Len::px(8.0));
    assert_eq!(frame.border.top, 2.0);
    assert!(frame.dashed && frame.centred);
    assert_eq!(frame.border_ink, Some(Ink::Rgba([0x11, 0x22, 0x33, 255])));
    assert_eq!(frame.radius, Len::px(6.0));
    assert_eq!(
        (frame.width, frame.max_width),
        (Extent::Share(0.5), Extent::Len(Len::px(300.0)))
    );
    assert!(frame.shadow.is_some());
    let para = para(block);
    assert_eq!((para.align, para.lead), (Align::Center, Lead::Times(2.0)));
    let look = look_of(words(block), "X");
    assert_eq!(look.ink, Some(Ink::Rgba([10, 20, 30, 128])));
    assert!(look.italic && look.weight == 600);
    for hostile in [
        "background: url(https://tracker.example/a.png)",
        "background-image: image-set('a.png' 1x)",
        "color: expression(alert(1))",
        "color: \\72 ed",
        "position: fixed",
        "background:javascript:alert(1)",
    ] {
        let read = page(&format!(r#"<p style="{hostile}">x</p>"#));
        let frame = &read.blocks[0].frame;
        assert!(
            frame.ground.is_none() && frame.wash.is_none() && frame.border == Sides::default(),
            "{hostile}"
        );
        assert_eq!(
            look_of(words(&read.blocks[0]), "x"),
            &Look::default(),
            "{hostile}"
        );
    }
}

#[test]
fn the_welcome_designers_theme_colours_are_the_themes() {
    let read = page(
        r#"<p style="background-color:var(--color-accent, #3399dd);color:var(--color-text-on-accent, #fff);border:var(--nebula-line-width, 1px) solid var(--unknown, #888)">x</p>"#,
    );
    let frame = &read.blocks[0].frame;
    assert_eq!(frame.ground, Some(Ink::Role(Role::Accent)));
    assert_eq!(
        look_of(words(&read.blocks[0]), "x").ink,
        Some(Ink::Role(Role::OnAccent))
    );
    assert_eq!(frame.border.left, 1.0);
    assert_eq!(frame.border_ink, Some(Ink::Rgba([0x88, 0x88, 0x88, 255])));
}

#[test]
fn a_gradient_is_a_wash_from_its_first_colour_to_its_last() {
    let read = page(
        r#"<p style="background: linear-gradient(to right, #000 0%, #888 50%, #fff 100%), #111">x</p>
        <p style="background: radial-gradient(110% 80% at 0% 0%, rgba(110,139,255,.11), rgba(0,0,0,0) 62%)">y</p>"#,
    );
    let wash = read.blocks[0].frame.wash.expect("a wash");
    assert_eq!(
        (wash.angle, wash.from, wash.to),
        (
            90.0,
            Ink::Rgba([0, 0, 0, 255]),
            Ink::Rgba([255, 255, 255, 255])
        )
    );
    assert_eq!(
        read.blocks[0].frame.ground,
        Some(Ink::Rgba([17, 17, 17, 255]))
    );
    let round = read.blocks[1].frame.wash.expect("a wash");
    assert!(
        (round.angle - 135.0).abs() < 0.01,
        "from the top left corner: {}",
        round.angle
    );
}

#[test]
fn unknown_tags_give_their_words_and_the_dangerous_give_nothing() {
    let read = page(concat!(
        "<div>one</div><center>two</center><custom-thing>three</custom-thing>",
        "<script>alert(1)</script><style>p{display:none}</style><svg><text>no</text></svg>",
        "<iframe src='https://x.example'>no</iframe><noscript>quiet</noscript><title>t</title>",
        "<form><input value=no><button>no</button></form>four",
    ));
    // DOMPurify drops what a `noscript` holds with it.
    assert_eq!(read.plain(), "onetwothreefour");
}

#[test]
fn only_a_web_address_is_a_link() {
    let read = page(concat!(
        r#"<p><a href="https://example.org/a">web</a> <a href="javascript:alert(1)">script</a> "#,
        r#"<a href="mailto:a@example.org">mail</a> <a href="mumble://x">mumble</a> "#,
        r#"<a href="  https://example.org">spaced</a> <a>bare</a></p>"#,
    ));
    let words = words(&read.blocks[0]);
    let linked: Vec<&str> = words
        .links
        .iter()
        .map(|(range, _)| &words.text[range.clone()])
        .collect();
    assert_eq!(linked, ["web"]);
    assert_eq!(&*words.links[0].1, "https://example.org/a");
    // The surface's link ink, unless the document gives one; none for words
    // that lead nowhere.
    assert_eq!(look_of(words, "web").ink, Some(Ink::Role(Role::Link)));
    assert_eq!(look_of(words, "script").ink, None);
    let inked =
        page(r#"<a href="https://e.org" style="color:#3399dd;text-decoration:underline">x</a>"#);
    let look = look_of(words_of_first(&inked), "x");
    assert!(look.underline && look.ink == Some(Ink::Rgba([0x33, 0x99, 0xdd, 255])));
}

fn words_of_first(page: &Page) -> &Words {
    words(&page.blocks[0])
}

#[test]
fn a_box_that_is_a_link_leads_there_and_its_words_need_not() {
    let read = page(
        r#"<a href="https://example.org/register" style="display:block;background-color:#5e6ad2;color:#fff;padding:9px 17px">Register</a>"#,
    );
    let block = &read.blocks[0];
    assert_eq!(
        block.frame.link.as_deref(),
        Some("https://example.org/register")
    );
    assert!(words(block).links.is_empty());
}

#[test]
fn a_picture_is_drawn_only_from_the_document_itself() {
    let read = page(&format!(
        r#"<p>a <img src="{}" width="40"> b <img src="https://tracker.example/p.png"> <img src="data:image/png;base64,!!!"></p>"#,
        png(80, 20)
    ));
    let pieces = &para(&read.blocks[0]).pieces;
    let pictures: Vec<&Block> = pieces
        .iter()
        .filter_map(|piece| match piece {
            Piece::Atom(block) => Some(&**block),
            Piece::Words(_) => None,
        })
        .collect();
    assert_eq!(
        pictures.len(),
        1,
        "the remote one and the broken one are not drawn"
    );
    assert_eq!(pictures[0].frame.width, Extent::Len(Len::px(40.0)));
    let Kind::Picture(picture) = &pictures[0].kind else {
        panic!("a picture");
    };
    assert_eq!(picture.natural, Some((80, 20)));
    assert_eq!(read.pictures().len(), 1);
}

#[test]
fn a_picture_in_lines_is_drawn_as_a_picture_at_the_size_it_is_shown() {
    use base64::Engine as _;
    let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18"><rect width="18" height="9" fill="#fff"/><image href="https://tracker.example/x.png" width="9" height="9"/></svg>"##;
    let uri = format!(
        "data:image/svg+xml;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(svg)
    );
    let read = page(&format!(
        r#"<img src="{uri}" width="36" height="36" style="display:block">"#
    ));
    let Kind::Picture(picture) = &read.blocks[0].kind else {
        panic!("a picture: {:?}", read.blocks);
    };
    // Shown at its own size where nothing else is said, and drawn twice as
    // fine as it is shown, for a screen of two pixels to one.
    assert_eq!(picture.natural, Some((18, 18)));
    assert_eq!(crate::picture::dimensions(picture.image.bytes()), Some((72, 72)));
    assert_eq!(picture.image.format(), gpui::ImageFormat::Png);
}

#[test]
fn a_list_is_tight_and_a_paragraph_in_an_item_adds_no_room() {
    let read = page(concat!(
        "<ul><li><p>one</p></li><li><p>two</p><ul><li>inner<ol><li>a</li><li>b</li></ol></li></ul></li></ul>",
        "<ol style=\"list-style-type: upper-roman\"><li>x</li><li>y</li><li>z</li><li>w</li></ol>",
    ));
    let Kind::List(items) = &read.blocks[0].kind else {
        panic!("a list");
    };
    assert_eq!(read.blocks[0].frame.padding.left, Len::px(40.0));
    assert_eq!(
        items
            .iter()
            .map(|item| item.mark.as_str())
            .collect::<Vec<_>>(),
        ["•", "•"]
    );
    for item in items {
        assert_eq!(
            item.body[0].frame.margin,
            Sides::default(),
            "no room around a paragraph in an item"
        );
    }
    let Kind::List(nested) = &items[1].body[1].kind else {
        panic!("a nested list: {:?}", items[1].body);
    };
    assert_eq!(nested[0].mark, "◦");
    assert_eq!(
        items[1].body[1].frame.margin.top,
        Len::ZERO,
        "a nested list adds no room"
    );
    let Kind::List(numbered) = &nested[0].body[1].kind else {
        panic!("a numbered list");
    };
    assert_eq!(
        numbered
            .iter()
            .map(|item| item.mark.as_str())
            .collect::<Vec<_>>(),
        ["1.", "2."]
    );
    let Kind::List(roman) = &read.blocks[1].kind else {
        panic!("a list");
    };
    assert_eq!(
        roman
            .iter()
            .map(|item| item.mark.as_str())
            .collect::<Vec<_>>(),
        ["I.", "II.", "III.", "IV."]
    );
}

#[test]
fn a_table_is_laid_out_by_its_columns() {
    let read = page(concat!(
        r#"<table width="100%" style="border-collapse:collapse"><tr><td width="30%">a</td>"#,
        r#"<td style="width:70%;background-color:#222;vertical-align:top">b</td></tr>"#,
        r#"<tr style="background-color:#111"><td colspan="2">wide</td></tr></table>"#,
        "<table><tr><th>head</th><td>cell</td></tr></table>",
    ));
    let Kind::Table(table) = &read.blocks[0].kind else {
        panic!("a table");
    };
    assert_eq!(read.blocks[0].frame.width, Extent::Share(1.0));
    assert_eq!(table.columns, [Extent::Share(0.3), Extent::Share(0.7)]);
    assert_eq!(table.spacing, 0.0);
    let b = &table.rows[0][1];
    assert_eq!(
        (b.column, b.valign, b.frame.ground),
        (1, Valign::Top, Some(Ink::Rgba([34, 34, 34, 255])))
    );
    let wide = &table.rows[1][0];
    assert_eq!(
        (wide.span, wide.frame.ground),
        ((2, 1), Some(Ink::Rgba([17, 17, 17, 255])))
    );
    let Kind::Table(plain) = &read.blocks[1].kind else {
        panic!("a table");
    };
    assert_eq!(plain.spacing, 2.0, "a browser's own room between cells");
    let head = &plain.rows[0][0];
    assert_eq!(para(&head.body[0]).align, Align::Center);
    assert_eq!(look_of(words(&head.body[0]), "head").weight, 700);
}

#[test]
fn a_huge_table_is_cut_to_its_bounds() {
    let mut html = String::from("<table>");
    for _ in 0..400 {
        html.push_str("<tr>");
        for _ in 0..60 {
            html.push_str("<td>x</td>");
        }
        html.push_str("</tr>");
    }
    html.push_str("</table>");
    let started = Instant::now();
    let read = page(&html);
    assert!(started.elapsed() < Duration::from_secs(2));
    let Kind::Table(table) = &read.blocks[0].kind else {
        panic!("a table");
    };
    assert!(table.rows.len() <= parts::ROWS_MOST);
    assert!(
        table
            .rows
            .iter()
            .all(|row| row.len() <= parts::COLUMNS_MOST)
    );
    assert!(table.columns.len() <= parts::COLUMNS_MOST);
}

#[test]
fn deep_nesting_keeps_its_words_and_is_quick() {
    let depth = 50_000;
    let html = format!("{}deep{}", "<span>".repeat(depth), "</span>".repeat(depth));
    let started = Instant::now();
    let read = page(&html);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    // Past the tags read, the rest is left out; nothing is drawn deeper
    // than is followed.
    let blocks = "<blockquote>".repeat(200) + "inside";
    let read_blocks = page(&blocks);
    assert!(read_blocks.plain().contains("inside"));
    let _ = read;
}

#[test]
fn a_flood_of_paragraphs_is_bounded_in_time_and_in_boxes() {
    let html = "<p>x</p>".repeat(200_000);
    let started = Instant::now();
    let read = page(&html);
    assert!(
        started.elapsed() < Duration::from_secs(3),
        "{:?}",
        started.elapsed()
    );
    assert!(read.blocks.len() <= TAGS_MOST);
}

#[test]
fn unclosed_and_misnested_tags_come_out_as_a_browser_builds_them() {
    let read = page("<p><b>bold <i>both</b> italic</i><p>next<li>stray");
    let first = words(&read.blocks[0]);
    assert_eq!(first.text, "bold both italic");
    assert!(look_of(first, "both").weight == 700 && look_of(first, "both").italic);
    assert!(look_of(first, "italic").italic && look_of(first, "italic").weight == 400);
    assert!(read.plain().ends_with("next\nstray"));
    for broken in [
        "<",
        "<b",
        "a < b",
        "<<>>",
        "&",
        "&#;",
        "</b>x",
        "<a href=",
        "<!--",
        "<table><td>x",
    ] {
        let _ = page(broken);
    }
}

#[test]
fn the_designers_front_page_reads_as_it_was_drawn() {
    let read = page(include_str!("samples/front-page.html"));
    // A centred mark, a centred heading at its own size, a rule, a row of
    // two link cards, a notice, a quote, and a filled button.
    assert!(read.blocks.len() >= 10);
    let heading = inner(&read.blocks[1]);
    assert_eq!(para(&heading[0]).align, Align::Center);
    assert_eq!(look_of(words(&heading[0]), "Welcome").size, Len::px(30.0));
    assert!(matches!(inner(&read.blocks[3])[0].kind, Kind::Rule));
    let Kind::Table(cards) = &inner(&read.blocks[4])[0].kind else {
        panic!("link cards: {:?}", read.blocks[4]);
    };
    assert_eq!(cards.columns, [Extent::Share(0.5), Extent::Share(0.5)]);
    let button = read
        .blocks
        .iter()
        .flat_map(inner)
        .find_map(|block| match &block.kind {
            Kind::Table(table) if block.frame.width == Extent::Auto => Some(table),
            _ => None,
        })
        .expect("the button");
    assert_eq!(
        button.rows[0][0].frame.ground,
        Some(Ink::Role(Role::Accent))
    );
}

#[test]
fn the_designers_modern_sheet_has_its_row_of_buttons() {
    let read = page(include_str!("samples/modern.html"));
    let panel = &read.blocks[0];
    assert!(panel.frame.wash.is_some() && panel.frame.ground.is_some());
    assert_eq!(panel.frame.radius, Len::px(14.0));
    let row = inner(panel)
        .iter()
        .find_map(|block| match &block.kind {
            Kind::Row(row) => Some(row),
            _ => None,
        })
        .expect("the row of buttons");
    assert!(row.centred);
    assert_eq!(row.items.len(), 2);
    for item in &row.items {
        assert!(item.frame.link.is_some());
        assert_eq!(item.frame.flex.map(|flex| flex.grow), Some(1.0));
    }
    assert_eq!(
        read.pictures().len(),
        2,
        "its two icons, drawn from their lines"
    );
}

#[test]
fn the_banner_reads_as_the_web_client_shows_it() {
    let read = page(include_str!("samples/banner.html"));
    assert_eq!(para(&read.blocks[0]).align, Align::Center);
    let Kind::Table(panel) = &read.blocks[1].kind else {
        panic!("the panel");
    };
    assert!(read.blocks[1].frame.centred);
    let cell = &panel.rows[0][0];
    assert_eq!(cell.frame.padding.top, Len::px(18.0));
    let list = cell
        .body
        .iter()
        .find_map(|block| match &block.kind {
            Kind::List(items) => Some(items),
            _ => None,
        })
        .expect("the links");
    assert_eq!(
        para(&list[0].body[0]).align,
        Align::Center,
        "the words centred, the mark in the gutter"
    );
    let register = cell.body.last().expect("register");
    let look = look_of(words(register), "Register");
    assert_eq!(look.ground, Some(Ink::Rgba([0x42, 0xa5, 0xf5, 255])));
    assert_eq!(look.ink, Some(Ink::Rgba([0, 0, 0, 255])));
    assert_eq!(read.pictures().len(), 1);
}

#[test]
fn an_old_qt_document_loses_what_the_web_client_strips() {
    let read = page(include_str!("samples/qt.html"));
    let text = read.plain();
    assert!(
        text.starts_with("Old Oak Lodge"),
        "the head and its style are gone: {text:?}"
    );
    assert!(!text.contains("white-space"));
    // `<center>` and `align` are not kept: the title is not centred.
    assert_eq!(para(&read.blocks[0]).align, Align::Left);
    assert!(
        read.pictures().is_empty(),
        "the tracker is not fetched or drawn"
    );
    // `bgcolor`, `cellpadding` and `border` are stripped too.
    let table = read
        .blocks
        .iter()
        .find_map(|block| match &block.kind {
            Kind::Table(table) => Some((block, table)),
            _ => None,
        })
        .expect("the table");
    assert!(table.1.rows[0][0].frame.ground.is_none());
    assert_eq!(table.0.frame.border, Sides::default());
}

#[test]
fn a_break_alone_is_an_empty_line_and_a_break_at_the_end_is_none() {
    let read = page("<p>one<br></p><p><br></p><p>two</p><p></p>");
    let texts: Vec<&str> = read
        .blocks
        .iter()
        .map(|block| words(block).text.as_str())
        .collect();
    assert_eq!(
        texts,
        ["one", " ", "two"],
        "the empty paragraph takes no room"
    );
}
