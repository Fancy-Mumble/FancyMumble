//! Profiles on cards, in the new format and the older one; converting one's
//! own; the full profile; the about's editor. On the demo engine.

use gpui::{Entity, TestAppContext, VisualTestContext, px};
use mumble_tauri_lib::engine_api::about::{About, Align, Block, Run, Written, with_about};

use super::Shell;
use super::tests::{click, own_menu, shell};
use crate::profile::Said;

/// A picture of `width` by `height`, as PNG: big enough that decoding it
/// would show.
fn png(width: u32, height: u32) -> Vec<u8> {
    let image = image::RgbImage::from_fn(width, height, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, 90])
    });
    let mut out = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut out, image::ImageFormat::Png)
        .expect("a PNG");
    out.into_inner()
}

/// A comment carrying `about`, as a client of the new format writes one.
fn carrying(about: &About) -> String {
    with_about(r#"<!--FANCY:{"v":1}-->"#, about, None, 0)
        .expect("written")
        .comment
}

/// Keep `session`'s card on screen, and let what it fetches arrive.
fn pin(shell: &Entity<Shell>, cx: &mut VisualTestContext, session: u32) {
    shell.update(cx, |shell, cx| shell.pin_card(session, None, cx));
    cx.run_until_parked();
    // The room for what they wrote is measured once it is laid out, and
    // its fade drawn in the frame after: a test window draws that frame
    // when asked to.
    redraw(shell, cx);
}

fn redraw(shell: &Entity<Shell>, cx: &mut VisualTestContext) {
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
}

fn said(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Said {
    shell.read_with(cx, |shell, _| {
        shell.info.as_ref().expect("the card").written.said.clone()
    })
}

#[gpui::test]
fn an_older_profile_shows_only_its_words_says_so_and_reads_no_picture(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let big = png(1600, 1200);
    let address = crate::picture::data_uri(&big).expect("an address");
    engine.set_comment_of(
        2,
        format!(
            r#"<!--FANCY:{{"v":1}}--><p style="text-align:center"><strong>Hello World!</strong></p><p><a href="https://example.org/x">a link</a> <span style="color:red;font-size:30px">red</span></p><table><tr><td>cell</td></tr></table><ul><li>one</li><li>two</li></ul><p><img src="{address}"><img src="{address}"></p>"#
        ),
    );
    pin(&shell, cx, 2);
    let Said::Older { words, flagged } = said(&shell, cx) else {
        panic!("the older format");
    };
    assert!(flagged, "it came with a Fancy profile");
    assert!(words.images.is_empty(), "no picture is read");
    assert!(words.text.contains("Hello World!") && words.text.contains("\u{2022} one"));
    assert_eq!(words.links.len(), 1);
    assert!(
        words.spans.iter().all(|(_, style)| style.color.is_none()),
        "no colours"
    );
    assert!(words.blocks.is_empty(), "nothing set apart: basics only");
    assert!(cx.debug_bounds("card-older-format").is_some(), "says so");
    assert!(cx.debug_bounds("card-about").is_some());
    assert!(
        cx.debug_bounds("card-about-picture-0").is_none(),
        "no pictures drawn"
    );
    assert!(
        cx.debug_bounds("card-convert").is_none(),
        "only its owner converts it"
    );
    // The sheet of what the server knows shows the same words, no pictures.
    shell.read_with(cx, |shell, _| {
        let body = shell.info.as_ref().and_then(|info| info.body.as_ref());
        let body = body.expect("the words");
        assert_eq!(body.pictures().count(), 0);
        assert!(!body.is_empty());
    });
}

#[gpui::test]
fn a_comment_of_another_client_is_read_the_same_way_without_the_line(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.set_comment_of(2, "<b>Plain</b> Mumble comment".to_owned());
    pin(&shell, cx, 2);
    assert!(matches!(
        said(&shell, cx),
        Said::Older { flagged: false, .. }
    ));
    assert!(cx.debug_bounds("card-older-format").is_none());
}

#[gpui::test]
fn a_new_format_card_draws_its_blocks_with_small_pictures(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Scout's is the model profile, converted.
    pin(&shell, cx, 4);
    let Said::About(shown) = said(&shell, cx) else {
        panic!("the new format");
    };
    assert!(matches!(
        shown.about.blocks[0],
        Block::Text {
            align: Align::Center,
            ..
        }
    ));
    assert!(
        shown
            .about
            .blocks
            .iter()
            .any(|block| matches!(block, Block::List { .. }))
    );
    assert_eq!(shown.thumbs.len(), 2);
    for thumb in &shown.thumbs {
        let thumb = thumb.as_ref().expect("a thumbnail");
        assert!(
            thumb.bytes().len() <= 4096,
            "small: {}",
            thumb.bytes().len()
        );
    }
    assert!(cx.debug_bounds("card-about-picture-0").is_some());
    assert!(cx.debug_bounds("card-about-picture-1").is_some());
    assert!(cx.debug_bounds("card-older-format").is_none());
    assert!(cx.debug_bounds("card-full-profile").is_some(), "it has one");
}

#[gpui::test]
fn the_card_wears_its_badges_role_letters_then_how_they_are(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Rin is a moderator.
    pin(&shell, cx, 3);
    assert!(cx.debug_bounds("card-badges").is_some());
    shell.read_with(cx, |shell, _| {
        let rin = shell
            .snapshot
            .users
            .iter()
            .find(|user| user.session == 3)
            .expect("Rin");
        let roles: Vec<_> = shell.roles_of(rin).map(|role| role.name.clone()).collect();
        assert_eq!(roles, ["moderators"]);
    });
    assert!(
        cx.debug_bounds("card-roles").is_some(),
        "and her role's chip"
    );
}

#[gpui::test]
fn a_long_about_is_held_to_its_room_and_fades_where_there_is_more(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let line = |at: usize| Block::Text {
        runs: vec![Run::plain(format!(
            "Line {at} of a long about, long enough to wrap"
        ))],
        align: Align::Center,
    };
    engine.set_comment_of(
        2,
        carrying(&About {
            blocks: (0..30).map(line).collect(),
        }),
    );
    pin(&shell, cx, 2);
    let room = cx.debug_bounds("card-about").expect("the room");
    assert_eq!(room.size.height, px(208.0), "as tall as the web card's");
    assert!(
        cx.debug_bounds("card-about-fade-bottom").is_some(),
        "more below"
    );
    assert!(
        cx.debug_bounds("card-about-fade-top").is_none(),
        "nothing above"
    );
    // Scrolled down, there is more above as well.
    shell.update(cx, |shell, cx| {
        let info = shell.info.as_ref().expect("the card");
        info.written
            .scroll
            .set_offset(gpui::point(px(0.0), px(-120.0)));
        cx.notify();
    });
    cx.run_until_parked();
    redraw(&shell, cx);
    assert!(
        cx.debug_bounds("card-about-fade-top").is_some(),
        "more above"
    );
}

#[gpui::test]
fn a_short_about_is_not_faded(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let short = About {
        blocks: vec![Block::Text {
            runs: vec![Run::plain("Short.")],
            align: Align::Left,
        }],
    };
    engine.set_comment_of(2, carrying(&short));
    pin(&shell, cx, 2);
    let room = cx.debug_bounds("card-about").expect("the room");
    assert!(room.size.height < px(40.0));
    assert!(cx.debug_bounds("card-about-fade-bottom").is_none());
}

#[gpui::test]
fn the_full_profile_is_fetched_only_when_asked_for_and_let_go_of_on_close(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    pin(&shell, cx, 4);
    assert_eq!(engine.pages_fetched(), 0, "a card fetches nothing");
    click(cx, "card-full-profile");
    assert_eq!(engine.pages_fetched(), 1);
    shell.read_with(cx, |shell, _| {
        let full = shell.panels.profiles.full.as_ref().expect("open");
        assert!(full.arrived());
        assert_eq!(full.session(), 4);
        assert!(shell.info.is_none(), "the card gave way to it");
    });
    // Its gallery: a click looks at the full picture, fetched then.
    click(cx, "full-profile-picture-0");
    shell.read_with(cx, |shell, _| {
        let large = shell.lightbox.as_ref().expect("looked at large");
        // The thumbnails are JPEG; the full pictures the PNGs they were.
        assert!(
            large.bytes().starts_with(b"\x89PNG"),
            "the full picture, not the thumbnail"
        );
        assert!(shell.panels.profiles.opening.is_none());
        assert!(
            shell.panels.shared.is_empty(),
            "held by the lightbox and nothing else"
        );
    });
    shell.update(cx, |shell, cx| {
        shell.lightbox = None;
        cx.notify();
    });
    cx.run_until_parked();
    // Its links are asked about before they open.
    click(cx, "full-profile-link-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.links.asked(),
            Some("https://example.org/halb-acht")
        );
    });
    shell.update(cx, Shell::close_full_profile);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.panels.profiles.full.is_none()));
    assert_eq!(engine.pages_fetched(), 1, "nothing fetched after");
}

#[gpui::test]
fn ones_own_older_profile_is_converted_after_a_preview_and_saved(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    pin(&shell, cx, 1);
    assert!(cx.debug_bounds("card-older-format").is_some());
    click(cx, "card-convert");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let editor = shell.panels.profiles.editor.as_ref().expect("open");
        assert!(editor.converting() && editor.converted(), "read, not saved");
    });
    assert!(cx.debug_bounds("convert-before").is_some());
    assert!(cx.debug_bounds("convert-after").is_some());
    assert!(cx.debug_bounds("convert-after-picture-0").is_some());
    let before = engine.comment_of(1).expect("a comment");
    assert!(!before.contains("\"about\""), "nothing changes until saved");
    click(cx, "about-keep-full");
    click(cx, "about-save");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.profiles.editor.is_none(), "closed once saved");
    });
    let after = engine.comment_of(1).expect("a comment");
    let written = Written::read(&after);
    let about = written.about().expect("the new format");
    assert!(
        about.pictures().all(|picture| picture.key.is_some()),
        "kept"
    );
    assert!(
        written.page().is_some(),
        "with a full profile of its pictures"
    );
    assert!(written.html.contains("<strong>Plays</strong>"));
    assert!(
        !written.html.contains("data:"),
        "no pictures for other clients"
    );
    let profile = written.profile.expect("a profile");
    assert_eq!(profile["pronouns"], "they/them", "the rest is kept");
    // Its own card shows the new format, and no longer offers converting.
    pin(&shell, cx, 1);
    assert!(matches!(said(&shell, cx), Said::About(_)));
}

#[gpui::test]
fn the_editor_adds_moves_and_removes_blocks_and_saves_them(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let start = About {
        blocks: vec![Block::Text {
            runs: vec![Run::plain("Was here.")],
            align: Align::Left,
        }],
    };
    engine.set_comment_of(1, carrying(&start));
    own_menu(cx, "menu-Edit about…");
    let count = |shell: &Entity<Shell>, cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            let editor = shell.panels.profiles.editor.as_ref().expect("open");
            editor.drafts().map_or(0, <[_]>::len)
        })
    };
    assert_eq!(count(&shell, cx), 1, "what was there");
    click(cx, "about-add-heading");
    click(cx, "about-add-divider");
    assert_eq!(count(&shell, cx), 3);
    // Typed with the composer's marks.
    shell.update(cx, |shell, cx| {
        let editor = shell.panels.profiles.editor.as_ref().expect("open");
        let drafts = editor.drafts().expect("editing");
        let fields: Vec<_> = drafts
            .iter()
            .filter_map(|draft| draft.field.clone())
            .collect();
        fields[0].update(cx, |field, _| field.set_text("**Loud** words"));
        fields[1].update(cx, |field, _| field.set_text("Quotes"));
        cx.notify();
    });
    cx.run_until_parked();
    // The heading goes first; the divider goes.
    click(cx, "about-up-1");
    click(cx, "about-remove-2");
    assert_eq!(count(&shell, cx), 2);
    assert!(cx.debug_bounds("about-preview").is_some());
    click(cx, "about-save");
    let saved = engine.comment_of(1).expect("a comment");
    let written = Written::read(&saved);
    let about = written.about().expect("an about");
    assert_eq!(
        about.blocks[0],
        Block::Heading {
            text: "Quotes".into(),
            align: Align::Left
        }
    );
    let Block::Text { runs, .. } = &about.blocks[1] else {
        panic!("the text");
    };
    assert!(runs[0].bold && runs[0].text == "Loud");
    assert!(written.html.contains("<strong>Loud</strong> words"));
}
