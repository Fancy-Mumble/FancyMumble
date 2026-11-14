//! A page a server wrote, as it is laid out and as it behaves: headings at
//! their sizes, centring, lists without gaps, tables by their widths,
//! pictures through `crate::pictures`, links asked about, and the welcome
//! dialog scrolling what does not fit.

use std::sync::Arc;

use gpui::{
    Bounds, Context, IntoElement, ParentElement, Pixels, Render, Styled, TestAppContext,
    VisualTestContext, Window, div, px,
};

use super::Shell;
use super::kit::{PageView, Surface};
use super::tests::{click, shell};
use crate::page::Page;
use crate::theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};

/// A page alone in a window, 400 wide, on a surface of 13 on lines of 1.5.
struct Shown(Arc<Page>);

impl Render for Shown {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div().w(px(400.0)).child(PageView::new(
            "t",
            Arc::clone(&self.0),
            Surface::text(13.0, 1.5, &theme),
        ))
    }
}

fn show<'a>(html: &str, cx: &'a mut TestAppContext) -> &'a mut VisualTestContext {
    cx.update(|cx| {
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let page = Arc::new(Page::read(html));
    let (_, cx) = cx.add_window_view(|_, _| Shown(page));
    cx.run_until_parked();
    cx
}

#[track_caller]
fn bounds(cx: &mut VisualTestContext, tag: &str) -> Bounds<Pixels> {
    cx.debug_bounds(Box::leak(tag.to_owned().into_boxed_str()))
        .unwrap_or_else(|| panic!("nothing is tagged {tag}"))
}

fn near(a: Pixels, b: f32) -> bool {
    (f32::from(a) - b).abs() < 1.5
}

#[gpui::test]
fn headings_are_larger_by_the_browsers_scale(cx: &mut TestAppContext) {
    let cx = show("<h1>One</h1><h2>Two</h2><h3>Three</h3><p>Body</p>", cx);
    let heights: Vec<f32> = (0..4)
        .map(|at| f32::from(bounds(cx, &format!("page-t-text-{at}")).size.height))
        .collect();
    // Each a line of 1.5 its own size: 26, 19.5, 15.2 and 13 high.
    for (height, size) in heights.iter().zip([26.0, 19.5, 15.21, 13.0]) {
        assert!((height - size * 1.5).abs() < 1.5, "{heights:?}");
    }
}

#[gpui::test]
fn what_stands_among_centred_words_is_centred(cx: &mut TestAppContext) {
    let html = format!(
        r#"<p style="text-align:center"><img src="{}" width="40" height="20"></p>"#,
        png(8, 4)
    );
    let cx = show(&html, cx);
    let picture = bounds(cx, "page-t-picture-0");
    assert!(
        near(picture.size.width, 40.0) && near(picture.size.height, 20.0),
        "{picture:?}"
    );
    assert!(
        near(picture.origin.x, 180.0),
        "in the middle of 400: {picture:?}"
    );
}

#[gpui::test]
fn a_list_has_no_gaps_between_its_items(cx: &mut TestAppContext) {
    let cx = show(
        "<ul><li><p>one</p></li><li><p>two</p></li><li>three</li></ul>",
        cx,
    );
    let tops: Vec<f32> = (0..3)
        .map(|at| f32::from(bounds(cx, &format!("page-t-item-{at}")).origin.y))
        .collect();
    let line = 13.0 * 1.5;
    assert!((tops[1] - tops[0] - line).abs() < 1.0, "{tops:?}");
    assert!((tops[2] - tops[1] - line).abs() < 1.0, "{tops:?}");
    // The words stand past the gutter the marks are in.
    let words = bounds(cx, "page-t-text-0");
    assert!(near(words.origin.x, 40.0), "{words:?}");
}

#[gpui::test]
fn a_table_is_laid_out_by_its_widths(cx: &mut TestAppContext) {
    let cx = show(
        r#"<table width="100%" style="border-collapse:collapse"><tr><td width="25%">a</td><td width="75%">b</td></tr></table>"#,
        cx,
    );
    let (a, b) = (bounds(cx, "page-t-cell-0"), bounds(cx, "page-t-cell-1"));
    assert!(near(a.size.width, 100.0), "{a:?}");
    assert!(near(b.size.width, 300.0), "{b:?}");
    assert!(near(b.origin.x, 100.0), "{b:?}");
}

/// A PNG `width` by `height`, as a `data:` URI.
fn png(width: u32, height: u32) -> String {
    use base64::Engine as _;
    let image = image::RgbaImage::from_pixel(width, height, image::Rgba([10, 200, 10, 255]));
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

#[gpui::test]
fn a_picture_is_drawn_from_a_kept_copy_never_wider_than_its_room(cx: &mut TestAppContext) {
    let html = format!(
        r#"<img src="{}" width="900" style="display:block">"#,
        png(90, 30)
    );
    let page = Page::read(&html);
    let image = page.pictures()[0].clone();
    let cx = show(&html, cx);
    let picture = bounds(cx, "page-t-picture-0");
    assert!(
        near(picture.size.width, 400.0),
        "never wider than the room: {picture:?}"
    );
    assert!(
        near(picture.size.height, 400.0 / 3.0),
        "and in its shape: {picture:?}"
    );
    cx.update(|_, cx| {
        assert!(
            crate::pictures::is_read(&image, crate::pictures::Fit::Page, cx),
            "drawn from a copy read at the size it is seen"
        );
    });
}

#[gpui::test]
fn a_link_in_the_welcome_is_asked_about_before_it_opens(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.set_welcome(
        r#"<p>Hello</p><a href="https://example.org/register" style="display:block;padding:8px;background-color:#3399dd">Register</a>"#,
    );
    cx.run_until_parked();
    shell.update(cx, Shell::show_welcome_again);
    cx.run_until_parked();
    click(cx, "page-welcome-link-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.links.asked(),
            Some("https://example.org/register")
        );
        assert!(
            shell.welcome_to_show().is_some(),
            "the welcome stays under the question"
        );
    });
}

#[gpui::test]
fn a_long_welcome_scrolls_inside_its_dialog(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let long = "<p>A line of the house rules, said at some length.</p>".repeat(80);
    engine.set_welcome(&long);
    cx.run_until_parked();
    shell.update(cx, Shell::show_welcome_again);
    cx.run_until_parked();
    let window = cx.update(|window, _| window.viewport_size().height);
    let body = cx.debug_bounds("welcome-body").expect("the welcome's body");
    let page = cx.debug_bounds("page-welcome").expect("the page");
    assert!(body.size.height < window * 0.8, "{body:?} in {window:?}");
    assert!(
        page.size.height > body.size.height,
        "the page is taller than its room"
    );
    click(cx, "dismiss-welcome");
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_none()));
}

#[gpui::test]
fn the_designed_demo_welcome_reads_and_draws(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, Shell::show_welcome_again);
    cx.run_until_parked();
    let page = shell
        .read_with(cx, |shell, _| shell.welcome_to_show())
        .expect("the demo server's welcome");
    assert_eq!(page.pictures().len(), 1, "its logo, drawn from its lines");
    assert!(cx.debug_bounds("page-welcome-picture-0").is_some());
}

#[gpui::test]
fn a_button_keeps_its_label_on_one_line_and_a_narrow_column_its_words_whole(
    cx: &mut TestAppContext,
) {
    let cx = show(
        concat!(
            r#"<table style="border-collapse:collapse"><tr><td style="background-color:#3399dd;padding:8px">"#,
            r#"<a href="https://example.org/status"><b>Read the details</b></a></td></tr></table>"#,
            r#"<table width="100%"><tr><td width="5%">Unbreakable</td><td width="95%">rest</td></tr></table>"#,
        ),
        cx,
    );
    let label = bounds(cx, "page-t-text-0");
    assert!(
        f32::from(label.size.height) < 13.0 * 1.5 * 1.5,
        "one line: {label:?}"
    );
    let narrow = bounds(cx, "page-t-text-1");
    assert!(
        near(narrow.size.height, (13.0_f32 * 1.5).round()),
        "one line: {narrow:?}"
    );
}

/// A page alone at the welcome dialog's measures: 470 wide, 13.5 on 1.55.
struct Welcomed(Arc<Page>);

impl Render for Welcomed {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = ActiveTheme::get(cx);
        div()
            .w(px(470.0))
            .font_family(theme.skin.font.clone())
            .child(PageView::new(
                "t",
                Arc::clone(&self.0),
                Surface::text(13.5, 1.55, &theme).inked(theme.c.muted),
            ))
    }
}

/// Every tagged part of each document in `FANCY_GPUI_PROBES`, as the
/// browser comparison prints them.
#[gpui::test]
#[ignore = "a tool: prints boxes for the browser comparison"]
fn probe_boxes(cx: &mut TestAppContext) {
    cx.update(|cx| {
        cx.text_system()
            .add_fonts(crate::assets::fonts())
            .expect("the bundled faces");
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let dir = std::env::var("FANCY_GPUI_PROBES").expect("FANCY_GPUI_PROBES");
    let mut names: Vec<_> = std::fs::read_dir(&dir)
        .expect("probes")
        .filter_map(|entry| entry.ok()?.file_name().into_string().ok())
        .filter(|name| name.ends_with(".clean.html"))
        .collect();
    names.sort();
    let mut out = String::new();
    for name in names {
        let html = std::fs::read_to_string(format!("{dir}/{name}")).expect("probe");
        let page = Arc::new(Page::read(&html));
        let (_, window) = cx.add_window_view(|_, _| Welcomed(page));
        window.run_until_parked();
        out.push_str(&format!("== {}\n", name.trim_end_matches(".clean.html")));
        let origin = bounds(window, "page-t").origin;
        for kind in ["block", "cell", "picture", "text"] {
            for at in 0.. {
                let tag = format!("page-t-{kind}-{at}");
                let Some(found) = window.debug_bounds(Box::leak(tag.into_boxed_str())) else {
                    break;
                };
                out.push_str(&format!(
                    "{kind}-{at} {} {} {} {}\n",
                    f32::from(found.origin.x - origin.x).round(),
                    f32::from(found.origin.y - origin.y).round(),
                    f32::from(found.size.width).round(),
                    f32::from(found.size.height).round(),
                ));
            }
        }
    }
    std::fs::write(format!("{dir}/gpui-boxes.txt"), out).expect("written");
}

/// Whether, in a box 300 wide, the background of `text` set centred is
/// painted over each of `probes` (points in the box).
fn centred_ground_covers(
    cx: &mut TestAppContext,
    text: &'static str,
    wrap: Option<f32>,
    probes: Vec<gpui::Point<Pixels>>,
) -> Vec<bool> {
    use std::cell::RefCell;
    use std::rc::Rc;
    let found = Rc::new(RefCell::new(Vec::new()));
    let into = Rc::clone(&found);
    let (_, window) =
        cx.add_window_view(move |_, _| Canvas(Rc::clone(&into), text, wrap, probes.clone()));
    window.run_until_parked();
    found.borrow().clone()
}

/// Paints one centred line's background and asks what it covered.
struct Canvas(
    std::rc::Rc<std::cell::RefCell<Vec<bool>>>,
    &'static str,
    Option<f32>,
    Vec<gpui::Point<Pixels>>,
);

impl Render for Canvas {
    fn render(&mut self, _: &mut Window, _: &mut Context<Self>) -> impl IntoElement {
        let (found, text, wrap, probes) = (self.0.clone(), self.1, self.2, self.3.clone());
        div().w(px(300.0)).h(px(100.0)).child(
            gpui::canvas(
                |_, _, _| {},
                move |bounds, (), window, cx| {
                    let run = gpui::TextRun {
                        len: text.len(),
                        font: window.text_style().font(),
                        color: gpui::black(),
                        background_color: Some(gpui::red()),
                        underline: None,
                        strikethrough: None,
                    };
                    let lines = window
                        .text_system()
                        .shape_text(text.into(), px(14.0), &[run], wrap.map(px), None)
                        .expect("shaped");
                    let mark = window.paint_mark();
                    lines[0]
                        .paint_background(
                            bounds.origin,
                            px(20.0),
                            gpui::TextAlign::Center,
                            Some(bounds),
                            window,
                            cx,
                        )
                        .expect("painted");
                    *found.borrow_mut() = probes
                        .iter()
                        .map(|at| {
                            window.painted_over(
                                mark,
                                Bounds::new(bounds.origin + *at, gpui::size(px(1.0), px(1.0))),
                            )
                        })
                        .collect();
                },
            )
            .size_full(),
        )
    }
}

#[gpui::test]
fn a_centred_lines_background_reaches_its_last_letter_and_no_further(cx: &mut TestAppContext) {
    // "Register" at 14 is about 60 wide: centred in 300 it runs from
    // about 120 to 180.
    let point = |x: f32| gpui::point(px(x), px(10.0));
    let covered = centred_ground_covers(
        cx,
        "Register",
        None,
        vec![point(126.0), point(174.0), point(110.0), point(190.0)],
    );
    assert_eq!(covered, [true, true, false, false]);
}

#[gpui::test]
fn a_wrapped_centred_background_goes_on_under_the_next_line_not_from_the_left(
    cx: &mut TestAppContext,
) {
    // Wrapped at 300, the second line is short and centred: its background
    // is under it, not from the box's left edge.
    let text = "A highlighted sentence long enough to wrap onto a second line here.";
    let covered = centred_ground_covers(
        cx,
        text,
        Some(300.0),
        vec![
            gpui::point(px(2.0), px(30.0)),
            gpui::point(px(150.0), px(30.0)),
        ],
    );
    assert_eq!(covered, [false, true]);
}

/// A document at the welcome dialog's measures, for comparing with a
/// browser's rendering of it (the web client's sanitiser and dialog CSS, in
/// headless Chrome with the client's Inter): 470 wide, 13.5 on 1.55. The
/// test platform shapes text with made-up advances, so only what does not
/// hang on a word's width is compared to the pixel.
fn welcomed<'a>(html: &str, cx: &'a mut TestAppContext) -> &'a mut VisualTestContext {
    cx.update(|cx| {
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let page = Arc::new(Page::read(html));
    let (_, cx) = cx.add_window_view(|_, _| Welcomed(page));
    cx.run_until_parked();
    cx
}

/// Where a tagged part stands in the page, and how big it is.
fn placed(cx: &mut VisualTestContext, tag: &str) -> [f32; 4] {
    let origin = bounds(cx, "page-t").origin;
    let found = bounds(cx, tag);
    [
        f32::from(found.origin.x - origin.x),
        f32::from(found.origin.y - origin.y),
        f32::from(found.size.width),
        f32::from(found.size.height),
    ]
}

const PANEL: &str = "background-color:#0d1014;border:2px solid #3c4048;border-collapse:collapse";
const WORDS: &str = "Welcome to our small community website! We are a group of enthusiasts who \
                     love to share knowledge and experiences.";

#[gpui::test]
fn a_table_nobody_gave_a_width_fills_its_room_where_its_words_are_longer(cx: &mut TestAppContext) {
    // The browser: 470 wide, the whole room. Drawn as wide as its longest
    // word, it was a narrow column at the left (the user's welcome).
    let cx = welcomed(
        &format!(r#"<table style="{PANEL}"><tr><td>{WORDS}</td></tr></table>"#),
        cx,
    );
    let [x, _, width, _] = placed(cx, "page-t-block-0");
    assert!(x.abs() < 1.0 && (width - 470.0).abs() < 1.0, "{width}");
}

#[gpui::test]
fn a_table_nobody_gave_a_width_hugs_short_words(cx: &mut TestAppContext) {
    // The browser: 106 wide for "Short words"; here as wide as the words
    // the test platform makes up, which is still far short of the room.
    let cx = welcomed(
        &format!(r#"<table style="{PANEL}"><tr><td>Short words</td></tr></table>"#),
        cx,
    );
    let [_, _, width, _] = placed(cx, "page-t-block-0");
    let [_, _, words, _] = placed(cx, "page-t-text-0");
    assert!(
        width < 200.0 && (width - (words + 2.0 * 12.0 + 2.0 * 2.0)).abs() < 2.0,
        "{width} {words}"
    );
}

#[gpui::test]
fn an_empty_column_takes_no_more_than_its_edges(cx: &mut TestAppContext) {
    // The browser: the words' cell 465 wide, the empty one 3.
    let cx = welcomed(
        &format!(r#"<table width="100%"><tr><td>{WORDS}</td><td> </td></tr></table>"#),
        cx,
    );
    let [_, _, width, _] = placed(cx, "page-t-cell-0");
    assert!(width > 455.0, "{width}");
}

#[gpui::test]
fn a_rows_height_is_the_least_its_cells_are(cx: &mut TestAppContext) {
    // The browser: a row of 300, the table 302 with its edges.
    let cx = welcomed(
        r#"<table width="100%"><tr height="300"><td>Short</td></tr></table>"#,
        cx,
    );
    let [_, _, _, height] = placed(cx, "page-t-cell-0");
    assert!((height - 300.0).abs() < 2.0, "{height}");
}

#[gpui::test]
fn a_drawing_given_no_size_is_shown_at_its_own(cx: &mut TestAppContext) {
    // The browser: an SVG 72 square shown 72 square, not at the finer size
    // it is drawn at here.
    let svg = r#"<svg xmlns="http://www.w3.org/2000/svg" width="72" height="72" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>"#;
    let html = format!(
        r#"<h2 style="text-align:center"><img src="data:image/svg+xml;base64,{}"></h2>"#,
        base64_of(svg.as_bytes())
    );
    let cx = welcomed(&html, cx);
    let [x, _, width, height] = placed(cx, "page-t-picture-0");
    assert!(
        (width - 72.0).abs() < 1.0 && (height - 72.0).abs() < 1.0,
        "{width} x {height}"
    );
    assert!(
        (x - 199.0).abs() < 1.5,
        "centred as the browser has it: {x}"
    );
}

fn base64_of(bytes: &[u8]) -> String {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

#[gpui::test]
fn a_box_the_document_left_without_room_gets_some(cx: &mut TestAppContext) {
    // The web client with the rule: the words 14 in (a 1 px half edge and
    // 0.9em), the line's top at 9 (0.6em) and the paragraph's own margin
    // gone. Here the edge is whole, 2 px, so 14 and 10.
    let cx = welcomed(
        &format!(r#"<table style="{PANEL}"><tr><td><p>{WORDS}</p></td></tr></table>"#),
        cx,
    );
    let [x, y, _, _] = placed(cx, "page-t-text-0");
    assert!((x - 14.0).abs() < 1.5 && (y - 10.0).abs() < 1.5, "{x}, {y}");
    let [_, _, _, cell] = placed(cx, "page-t-cell-0");
    let [_, _, _, words] = placed(cx, "page-t-text-0");
    assert!(
        (cell - (words + 2.0 * 8.0)).abs() < 1.5,
        "as much room below as above: {cell} {words}"
    );
}

#[gpui::test]
fn a_box_keeps_the_room_the_document_gave_it(cx: &mut TestAppContext) {
    // The browser: "padding:10px 20px" puts the words 22 in and 13 down;
    // "padding:0" leaves them against the edge, as the document asked.
    let cx = welcomed(
        &format!(
            r#"<table style="{PANEL}"><tr><td style="padding:10px 20px">Two</td></tr></table><table style="{PANEL}"><tr><td style="padding:0">Flush</td></tr></table>"#
        ),
        cx,
    );
    let [x, y, _, _] = placed(cx, "page-t-text-0");
    assert!((x - 22.0).abs() < 1.5 && (y - 12.0).abs() < 1.5, "{x}, {y}");
    let [x, _, _, _] = placed(cx, "page-t-text-1");
    assert!(x < 3.5, "{x}");
}

#[gpui::test]
fn what_is_not_a_box_gets_no_room(cx: &mut TestAppContext) {
    // A table for layout only, a plain paragraph: as a browser has them.
    let cx = welcomed(
        r#"<table width="100%"><tr><td>Laid out</td></tr></table><p>Plain</p>"#,
        cx,
    );
    let [x, _, _, _] = placed(cx, "page-t-text-0");
    assert!(x < 3.5, "{x}");
    let [x, _, _, _] = placed(cx, "page-t-text-1");
    assert!(x.abs() < 0.5, "{x}");
}

#[gpui::test]
fn a_link_made_into_a_button_gets_room(cx: &mut TestAppContext) {
    let cx = welcomed(
        r#"<p><a href="https://example.org" style="background-color:#42a5f5;color:#000">Register</a></p>"#,
        cx,
    );
    let [_, _, width, _] = placed(cx, "page-t-block-1");
    let [_, _, words, _] = placed(cx, "page-t-text-0");
    assert!(
        (width - (words + 2.0 * 12.0)).abs() < 1.5,
        "{width} {words}"
    );
}
