//! The format, the migration and the HTML written for other clients.

use serde_json::{Value, json};

use super::*;

fn run(text: &str) -> Run {
    Run::plain(text)
}

fn bold(text: &str) -> Run {
    Run {
        bold: true,
        ..Run::plain(text)
    }
}

/// A small picture, `width` by `height`, as PNG.
fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, ((x * y) % 256) as u8])
    });
    let mut out = std::io::Cursor::new(Vec::new());
    image.write_to(&mut out, image::ImageFormat::Png).expect("a PNG");
    out.into_inner()
}

fn data_uri(bytes: &[u8]) -> String {
    use base64::Engine as _;
    format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(bytes)
    )
}

/// One of every kind of block.
fn every_kind() -> About {
    About {
        blocks: vec![
            Block::Heading {
                text: "Quotes".into(),
                align: Align::Center,
            },
            Block::Text {
                runs: vec![
                    bold("Hello"),
                    run(" "),
                    Run {
                        italic: true,
                        underline: true,
                        strike: true,
                        code: true,
                        link: Some("https://example.org/a?b=1&c=2".into()),
                        ..run("world")
                    },
                ],
                align: Align::Right,
            },
            Block::List {
                numbered: true,
                items: vec![vec![run("one")], vec![run("\u{3046}\u{308b}\u{3055}\u{3044}")]],
                align: Align::Left,
            },
            Block::Quote {
                runs: vec![run("said once\nand again")],
            },
            Block::Divider,
            Block::Pictures {
                pictures: vec![Picture {
                    thumb: Some(data_uri(b"tiny")),
                    width: 800,
                    height: 600,
                    key: Some("0/abc/sunset.jpg".into()),
                    size: Some(123_456),
                    alt: "Sunset".into(),
                }],
            },
        ],
    }
}

#[test]
fn an_about_reads_back_as_it_was_written() {
    let about = every_kind();
    let value = about.to_value();
    assert_eq!(value["v"], 1);
    assert_eq!(About::read(&value), about);
    // Through a comment and back, with what else the profile said.
    let fitted = with_about(r#"<!--FANCY:{"v":1}-->old"#, &about, None, 0).expect("written");
    assert_eq!(Written::read(&fitted.comment).about(), Some(about));
}

#[test]
fn what_a_reader_does_not_know_is_skipped_one_thing_at_a_time() {
    let value = json!({ "v": 7, "blocks": [
        { "t": "poem", "lines": ["roses"] },
        { "t": "p", "r": [ { "x": "kept", "glow": "pink" } ], "a": "justify" },
        { "t": "h", "x": 12 },
        "not even an object",
        { "t": "hr", "thickness": 3 },
    ] });
    let about = About::read(&value);
    assert_eq!(
        about.blocks,
        [
            Block::Text {
                runs: vec![run("kept")],
                align: Align::Left
            },
            Block::Divider
        ]
    );
}

#[test]
fn an_about_is_held_to_its_bounds() {
    let many = |count: usize, block: Block| vec![block; count];
    let blocks = many(40, Block::Divider);
    assert_eq!(Limits::CARD.bound(blocks).len(), Limits::CARD.blocks);
    // Text: cut at three thousand characters, counted as characters.
    let long = "\u{e9}".repeat(5000);
    let cut = Limits::CARD.bound([Block::Text {
        runs: vec![run(&long)],
        align: Align::Left,
    }]);
    let Block::Text { runs, .. } = &cut[0] else {
        panic!("text");
    };
    assert_eq!(runs[0].text.chars().count(), Limits::CARD.text);
    // A link that is not to the web is words, and only words.
    let linked = Limits::CARD.bound([Block::Text {
        runs: vec![
            Run {
                link: Some("javascript:alert(1)".into()),
                ..run("a")
            },
            Run {
                link: Some(format!("https://x.example/{}", "a".repeat(2000))),
                ..run("b")
            },
        ],
        align: Align::Left,
    }]);
    let Block::Text { runs, .. } = &linked[0] else {
        panic!("text");
    };
    assert!(runs.iter().all(|run| run.link.is_none()));
    // Pictures: three a row, six in all, a thumbnail no heavier than 4 KiB.
    let picture = |thumb: &[u8]| Picture {
        thumb: Some(data_uri(thumb)),
        ..Picture::default()
    };
    let row = Block::Pictures {
        pictures: vec![picture(b"x"); 5],
    };
    let bounded = Limits::CARD.bound(vec![row; 3]);
    let counts: Vec<usize> = bounded
        .iter()
        .map(|block| match block {
            Block::Pictures { pictures } => pictures.len(),
            _ => 0,
        })
        .collect();
    assert_eq!(counts, [3, 3]);
    let heavy = Limits::CARD.bound([Block::Pictures {
        pictures: vec![
            picture(&[0; 5000]),
            Picture {
                key: Some("0/a/b.png".into()),
                ..picture(&[0; 5000])
            },
            Picture {
                thumb: Some("https://tracker.example/pixel.png".into()),
                ..Picture::default()
            },
        ],
    }]);
    let Block::Pictures { pictures } = &heavy[0] else {
        panic!("pictures");
    };
    assert_eq!(pictures.len(), 1, "too heavy, and no full copy: gone");
    assert!(pictures[0].thumb.is_none() && pictures[0].key.is_some());
}

#[test]
fn what_else_the_profile_says_is_kept_when_an_about_is_written() {
    let held = r##"<!--FANCY:{"v":1,"status":"Out","sticker":{"id":7},"page":{"k":"0/a/p.json","n":9}}-->
<p><b>old</b> bio</p>"##;
    let about = About {
        blocks: vec![Block::Text {
            runs: vec![run("ends here --> and goes on")],
            align: Align::Left,
        }],
    };
    let fitted = with_about(held, &about, None, 0).expect("written");
    let read = Written::read(&fitted.comment);
    let profile = read.profile.as_ref().expect("a profile");
    assert_eq!(profile["status"], "Out");
    assert_eq!(profile["sticker"]["id"], 7, "what is not read here is kept");
    assert!(profile.get("page").is_none(), "no page: none named");
    assert_eq!(read.about(), Some(about), "an arrow in the words ends nothing");
    assert!(!fitted.comment.contains("old"), "the HTML is written anew");
    // A comment of another client's becomes a profile.
    let first = with_about("just words", &every_kind(), None, 0).expect("written");
    assert!(first.comment.starts_with("<!--FANCY:{"));
}

#[test]
fn a_comment_is_made_to_fit_the_server_by_leaving_thumbnails_out() {
    let thumb = |size| Picture {
        thumb: Some(data_uri(&vec![1; size])),
        key: Some("0/k/full.jpg".into()),
        ..Picture::default()
    };
    let about = About {
        blocks: vec![
            Block::Text {
                runs: vec![run("words")],
                align: Align::Left,
            },
            Block::Pictures {
                pictures: vec![thumb(3000), thumb(1000)],
            },
        ],
    };
    let roomy = with_about("", &about, None, 0).expect("no limit");
    assert_eq!(roomy.dropped, 0);
    let tight = with_about("", &about, None, roomy.comment.len() - 100).expect("fits");
    assert_eq!(tight.dropped, 1, "the heaviest went");
    let left: Vec<_> = tight.about.pictures().map(Picture::thumb_weight).collect();
    assert_eq!(left, [None, Some(1000)]);
    assert!(tight.about.pictures().all(|p| p.key.is_some()), "keys kept");
    assert!(tight.comment.len() <= roomy.comment.len() - 100);
    let refused = with_about("", &about, None, 50);
    assert!(refused.is_err_and(|why| why.contains("50")));
}

#[test]
fn the_html_for_other_clients_holds_only_what_a_bio_may() {
    let html = every_kind().html();
    let mut rest = html.as_str();
    while let Some(at) = rest.find('<') {
        let name: String = rest[at + 1..]
            .trim_start_matches('/')
            .chars()
            .take_while(char::is_ascii_alphabetic)
            .collect();
        assert!(
            ["p", "br", "strong", "em", "u", "a", "span"].contains(&name.as_str()),
            "{name} in {html}"
        );
        rest = &rest[at + 1..];
    }
    assert!(!html.contains("data:"), "no pictures");
    assert!(html.contains(r#"<p style="text-align:center"><strong>Quotes</strong></p>"#));
    assert!(html.contains(r#"href="https://example.org/a?b=1&amp;c=2""#));
    assert!(html.contains("1. one<br>2. "), "a list as lines: {html}");
    assert!(html.contains("said once<br>and again"));
    // Words that look like markup are words.
    let sneaky = About {
        blocks: vec![Block::Text {
            runs: vec![run("<script>x</script> & co")],
            align: Align::Left,
        }],
    };
    assert_eq!(sneaky.html(), "<p>&lt;script&gt;x&lt;/script&gt; &amp; co</p>");
}

#[test]
fn each_thing_a_bio_may_hold_is_migrated() {
    let picture = data_uri(&png(4, 4));
    let html = format!(
        concat!(
            r#"<!--FANCY:{{"v":1}}--><p style="text-align:center"><strong>Hello</strong> <em>you</em> <u>there</u><br>"#,
            r#"<span style="font-weight:bold;color:red">heavy</span> <span style="text-decoration: line-through">gone</span></p>"#,
            r#"<p><a href="https://example.org/x" target="_blank">site</a> <a href="javascript:alert(1)">trap</a></p>"#,
            r#"<p><img src="{0}" alt="one"><img src="https://tracker.example/p.png"><img src="{0}"></p>"#,
        ),
        picture
    );
    let read = Migration::read(&html);
    let blocks = &read.about.blocks;
    let Block::Text { runs, align } = &blocks[0] else {
        panic!("a paragraph first: {blocks:?}");
    };
    assert_eq!(*align, Align::Center);
    let said: Vec<(&str, bool, bool, bool, bool)> = runs
        .iter()
        .map(|r| (r.text.as_str(), r.bold, r.italic, r.underline, r.strike))
        .collect();
    assert_eq!(
        said,
        [
            ("Hello", true, false, false, false),
            (" ", false, false, false, false),
            ("you", false, true, false, false),
            (" ", false, false, false, false),
            ("there", false, false, true, false),
            ("\n", false, false, false, false),
            ("heavy", true, false, false, false),
            (" ", false, false, false, false),
            ("gone", false, false, false, true),
        ]
    );
    let Block::Text { runs, .. } = &blocks[1] else {
        panic!("the links");
    };
    assert_eq!(runs[0].link.as_deref(), Some("https://example.org/x"));
    assert_eq!(runs.last().map(|r| (r.text.as_str(), r.link.is_none())), Some((" trap", true)));
    let Block::Pictures { pictures } = &blocks[2] else {
        panic!("the pictures: {blocks:?}");
    };
    assert_eq!(pictures.len(), 2, "a picture from elsewhere is not one");
    assert_eq!(pictures[0].alt, "one");
    assert_eq!(read.embedded.len(), 2);
}

#[test]
fn what_older_editors_wrote_is_migrated_as_it_plainly_meant() {
    let html = concat!(
        "<h2 align=\"center\">Quotes</h2>",
        "<center><ul><li>Make the world <b>more</b> exciting<li>her smile",
        "<ol><li>inner</li></ol></li><li>\u{3046}\u{308b}\u{3055}\u{3044}</li></ul></center>",
        "<blockquote><p>said</p><p>twice</p></blockquote><hr>",
        "<table><tr><td>a</td><td>b</td></tr></table><script>alert(1)</script>",
    );
    let blocks = Migration::read(html).about.blocks;
    assert_eq!(
        blocks[0],
        Block::Heading {
            text: "Quotes".into(),
            align: Align::Center
        }
    );
    let Block::List { items, align, numbered } = &blocks[1] else {
        panic!("a list: {blocks:?}");
    };
    assert_eq!((*align, *numbered), (Align::Center, false));
    let texts: Vec<String> = items
        .iter()
        .map(|item| item.iter().map(|r| r.text.as_str()).collect())
        .collect();
    assert_eq!(
        texts,
        ["Make the world more exciting", "her smile", "inner", "\u{3046}\u{308b}\u{3055}\u{3044}"]
    );
    assert_eq!(
        blocks[2],
        Block::Quote {
            runs: vec![run("said\ntwice")]
        }
    );
    assert_eq!(blocks[3], Block::Divider);
    let Block::Text { runs, .. } = &blocks[4] else {
        panic!("the table's words");
    };
    assert_eq!(runs[0].text, "a b");
    assert_eq!(blocks.len(), 5, "a script is no text");
}

#[test]
fn hostile_html_is_read_within_bounds_and_without_a_fuss() {
    let nested = "<ul><li>".repeat(5000) + "deep" + &"</li></ul>".repeat(5000);
    let rules = "<hr>".repeat(100_000);
    let words = "<p>".to_owned() + &"w".repeat(200_000);
    for html in [
        nested.as_str(),
        rules.as_str(),
        words.as_str(),
        "<",
        "<b",
        "</p></ul></li></blockquote>x",
        "<a href=",
        "&#xZZ; &bogus; <img src=\"data:image/png;base64,!!!\">",
        "<p style=\"text-align:center\"><span style=\"font-weight:9999999999999\">x</span>",
        "<img src=\"data:image/svg+xml;base64,PHN2Zz4=\">",
    ] {
        let read = Migration::read(html);
        let card = read.card();
        assert!(card.blocks.len() <= Limits::CARD.blocks);
        assert!(read.about.blocks.len() <= Limits::PAGE.blocks);
        let text: usize = card
            .blocks
            .iter()
            .map(|block| match block {
                Block::Text { runs, .. } => runs.iter().map(|r| r.text.chars().count()).sum(),
                _ => 0,
            })
            .sum();
        assert!(text <= Limits::CARD.text);
    }
    let read = Migration::read(&nested);
    assert!(matches!(&read.about.blocks[..], [Block::List { .. }]));
}

#[test]
fn pictures_pasted_whole_become_small_thumbnails() {
    let big = png(800, 600);
    let html = format!(r#"<p><img src="{0}"><img src="{0}"></p>"#, data_uri(&big));
    let mut read = Migration::read(&html);
    read.thumbnail(Limits::CARD.thumbs);
    let card = read.card();
    let pictures: Vec<&Picture> = card.pictures().collect();
    assert_eq!(pictures.len(), 2);
    for picture in pictures {
        let weight = picture.thumb_weight().expect("a thumbnail");
        assert!(weight <= Limits::CARD.thumb, "{weight}");
        assert_eq!((picture.width, picture.height), (800, 600), "the full size");
        let small = image::load_from_memory(&picture.thumb_bytes().expect("bytes")).expect("a picture");
        assert!(small.width() <= Limits::THUMB_EDGE && small.height() <= Limits::THUMB_EDGE);
    }
    // Kept in the store: the key goes in, and a full profile shows them.
    read.kept(1, "0/x/two.png".into(), big.len() as u64);
    let page = read.page("About", "Pictures");
    assert!(matches!(&page.sections[..], [Section::Gallery { pictures, .. }] if pictures.len() == 1));
    // What cannot be read gets no thumbnail and, unkept, is lost to the card.
    let mut broken = Migration::read(r#"<img src="data:image/png;base64,aGkh">"#);
    broken.thumbnail(Limits::CARD.thumbs);
    assert_eq!(broken.lost(), 1);
}

#[test]
fn text_the_card_cannot_hold_goes_to_the_full_profile() {
    let html = "<p>".to_owned() + &"long ".repeat(1000) + "</p>";
    let read = Migration::read(&html);
    assert!(read.cut());
    let page = read.page("About", "Pictures");
    let Some(Section::Text { blocks, .. }) = page.sections.first() else {
        panic!("the text");
    };
    let Block::Text { runs, .. } = &blocks[0] else {
        panic!("a paragraph");
    };
    assert_eq!(runs[0].text.len(), "long ".repeat(1000).trim_end().len());
    assert!(!Migration::read("<p>short</p>").cut());
}

#[test]
fn a_full_profile_reads_back_and_is_held_to_its_bounds() {
    let page = Page {
        sections: vec![
            Section::Text {
                title: "About".into(),
                blocks: every_kind().blocks,
            },
            Section::Links {
                title: "Elsewhere".into(),
                links: vec![Link {
                    text: "Blog".into(),
                    url: "https://example.org".into(),
                }],
            },
        ],
    };
    assert_eq!(Page::read(&page.to_bytes()), Some(page));
    let odd = json!({ "v": 2, "sections": [
        { "t": "video", "src": "x" },
        { "t": "links", "title": "L", "links": [ { "x": "bad", "l": "file:///etc/passwd" } ] },
        { "t": "links", "title": "M", "links": [ { "x": "good", "l": "https://a.example" } ] },
    ] });
    let read = Page::read(odd.to_string().as_bytes()).expect("a page");
    assert_eq!(read.sections.len(), 1, "unknown and emptied sections go");
    let huge = vec![b' '; (Page::MOST_BYTES + 1) as usize];
    assert_eq!(Page::read(&huge), None);
    // A reference too large, or naming nothing, is no reference.
    assert!(PageRef::read(&json!({ "k": "0/a/p.json", "n": 10 })).is_some());
    assert!(PageRef::read(&json!({ "k": "0/a/p.json", "n": Page::MOST_BYTES + 1 })).is_none());
    assert!(PageRef::read(&json!({ "k": "", "n": 10 })).is_none());
    assert!(PageRef::read(&Value::Null).is_none());
}

#[test]
fn what_is_typed_in_an_editor_reads_as_runs_and_back() {
    let typed = "**Hello** *you* __there__ ~~gone~~ `code` [site](https://example.org/x)\nnext";
    let runs = runs_of_typed(typed);
    let bolds: Vec<&str> = runs.iter().filter(|r| r.bold).map(|r| r.text.as_str()).collect();
    assert_eq!(bolds, ["Hello"]);
    assert!(runs.iter().any(|r| r.strike && r.text == "gone"));
    assert!(runs.iter().any(|r| r.code && r.text == "code"));
    assert!(runs.iter().any(|r| r.link.as_deref() == Some("https://example.org/x")));
    assert!(runs.iter().any(|r| r.text.contains('\n')));
    assert_eq!(typed_of_runs(&runs), typed);
}

#[test]
fn a_comment_without_a_profile_is_html_and_nothing_else() {
    let read = Written::read("<b>plain</b>");
    assert!(read.profile.is_none() && read.about().is_none());
    assert_eq!(read.html, "<b>plain</b>");
    let broken = Written::read("<!--FANCY:{nope}-->x");
    assert!(broken.profile.is_none());
    let older = Written::read("<!--FANCY:{\"v\":1}-->\n<p>bio</p>");
    assert_eq!(older.html, "<p>bio</p>");
    assert!(older.about().is_none(), "the older format");
}
