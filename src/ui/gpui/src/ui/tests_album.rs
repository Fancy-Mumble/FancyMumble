//! Several pictures shared in one message, drawn as the web client's
//! `AttachmentGallery` draws them: one block of tiles in its layouts, the
//! chip that says what the batch is, "Save all", the "+n" that shows the
//! rest, and a tile opened large that steps through the album.

use std::sync::Arc;

use gpui::{TestAppContext, VisualTestContext};

use super::album::{summary, tile_size};
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::engine::{Attachment, Conversation, Engine as _, Lasts, Reach, ShareAs};

/// A selector made at run time, as GPUI wants one: for the life of the test.
fn named(selector: String) -> &'static str {
    Box::leak(selector.into_boxed_str())
}

/// `count` pictures in a folder of their own, each a colour of its own.
fn pictures(count: usize, tag: &str) -> (std::path::PathBuf, Vec<std::path::PathBuf>) {
    let folder =
        std::env::temp_dir().join(format!("fancy-gpui-album-{tag}-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let files = (0..count)
        .map(|n| {
            let path = folder.join(format!("p{n:02}.png"));
            let shade = u8::try_from(n * 20 % 256).unwrap_or(0);
            image::RgbImage::from_pixel(300, 200, image::Rgb([shade, 90, 200 - shade / 2]))
                .save(&path)
                .expect("a png");
            path
        })
        .collect();
    (folder, files)
}

/// The pictures shared in one message, as the local user does, and drawn.
fn album<'a>(
    count: usize,
    tag: &str,
    cx: &'a mut TestAppContext,
) -> (
    gpui::Entity<super::Shell>,
    Arc<DemoEngine>,
    &'a mut VisualTestContext,
    std::path::PathBuf,
    usize,
) {
    let (shell, engine, cx) = shell(cx);
    let (folder, files) = pictures(count, tag);
    engine.share(
        Conversation::Channel(1),
        String::new(),
        files,
        ShareAs {
            reach: Reach::Link,
            lasts: Lasts::Week,
            full: false,
        },
    );
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    let index = shell.read_with(cx, |shell, _| shell.messages.len() - 1);
    (shell, engine, cx, folder, index)
}

fn size_of(selector: String, cx: &mut VisualTestContext) -> (f32, f32) {
    let bounds = cx.debug_bounds(named(selector)).expect("on screen");
    (f32::from(bounds.size.width), f32::from(bounds.size.height))
}

#[test]
fn tiles_take_the_web_clients_shapes() {
    assert_eq!(tile_size(2, 0), (228.0, 152.0));
    assert_eq!(tile_size(3, 0), (228.0, 228.0));
    assert_eq!(tile_size(3, 2), (460.0, 230.0));
    assert_eq!(tile_size(4, 3), (228.0, 228.0));
}

#[test]
fn the_chip_says_how_many_how_heavy_and_how_long() {
    let now = 1_800_000_000;
    let file = |size, expires| Attachment {
        size: Some(size),
        expires_at: expires,
        ..Attachment::default()
    };
    let files = [
        file(20 << 20, Some(now + 6 * 86_400 + 5)),
        file(11 << 20, Some(now + 9 * 86_400)),
        file(0, None),
    ];
    let refs: Vec<&Attachment> = files.iter().collect();
    let said: Vec<String> = summary(&refs, now)
        .iter()
        .map(ToString::to_string)
        .collect();
    assert_eq!(said, ["3 items", "31 MiB", "6d left"]);
}

#[gpui::test]
fn two_three_and_four_pictures_are_one_block_in_the_web_layouts(cx: &mut TestAppContext) {
    for (count, sizes) in [
        (2, vec![(228.0, 152.0), (228.0, 152.0)]),
        (3, vec![(228.0, 228.0), (228.0, 228.0), (460.0, 230.0)]),
        (4, vec![(228.0, 228.0); 4]),
    ] {
        let mut app = cx.clone();
        let (_shell, _engine, cx, folder, index) = album(count, &format!("n{count}"), &mut app);
        assert!(
            cx.debug_bounds(named(format!("album-{index}"))).is_some(),
            "{count}"
        );
        for (at, size) in sizes.into_iter().enumerate() {
            assert_eq!(
                size_of(format!("album-tile-{index}-{at}"), cx),
                size,
                "{count}: {at}"
            );
        }
        assert!(
            cx.debug_bounds(named(format!("shared-picture-{index}-0")))
                .is_none(),
            "no lone cards"
        );
        assert!(
            cx.debug_bounds(named(format!("save-all-{index}")))
                .is_some()
        );
        let _ = std::fs::remove_dir_all(folder);
    }
}

#[gpui::test]
fn eleven_show_four_and_a_plus_seven_that_shows_the_rest(cx: &mut TestAppContext) {
    let (_shell, _engine, cx, folder, index) = album(11, "eleven", cx);
    assert!(
        cx.debug_bounds(named(format!("album-tile-{index}-3")))
            .is_some()
    );
    assert!(
        cx.debug_bounds(named(format!("album-tile-{index}-4")))
            .is_none()
    );
    let more = cx
        .debug_bounds(named(format!("album-more-{index}")))
        .expect("+7");
    let fourth = cx
        .debug_bounds(named(format!("album-tile-{index}-3")))
        .expect("the fourth");
    assert_eq!(more, fourth, "over the fourth tile");
    // Every picture of a public share has its flag.
    assert!(
        cx.debug_bounds(named(format!("copy-link-{index}-0")))
            .is_some()
    );
    click(cx, named(format!("album-more-{index}")));
    cx.run_until_parked();
    assert!(
        cx.debug_bounds(named(format!("album-tile-{index}-10")))
            .is_some(),
        "all eleven"
    );
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_tile_opens_its_own_picture_and_the_lightbox_steps_through_the_album(cx: &mut TestAppContext) {
    let (shell, _engine, cx, folder, index) = album(3, "steps", cx);
    let picture = |n: usize| std::fs::read(folder.join(format!("p{n:02}.png"))).expect("the file");
    let open = |cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            shell.lightbox.as_ref().map(|open| open.bytes().to_vec())
        })
    };
    click(cx, named(format!("album-tile-{index}-1")));
    cx.run_until_parked();
    assert_eq!(open(cx), Some(picture(1)), "the second, as clicked");
    shell.update(cx, |shell, cx| {
        assert!(shell.step_lightbox(true, cx));
    });
    assert_eq!(open(cx), Some(picture(2)), "then the third");
    shell.update(cx, |shell, cx| {
        assert!(!shell.step_lightbox(true, cx), "the album ends there");
        assert!(shell.step_lightbox(false, cx));
        assert!(shell.step_lightbox(false, cx));
    });
    assert_eq!(open(cx), Some(picture(0)), "and back to the first");
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn pictures_sent_where_no_files_are_kept_are_one_message_drawn_as_one_block(
    cx: &mut TestAppContext,
) {
    let (shell, _engine, cx) = shell(cx);
    let (folder, files) = pictures(3, "inline");
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.send_files(files, cx));
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    let html = shell.read_with(cx, |shell, _| {
        shell
            .messages
            .last()
            .map(|message| message.html.to_string())
            .unwrap_or_default()
    });
    assert_eq!(
        html.matches("<img").count(),
        3,
        "one message with all three"
    );
    let row = shell.read_with(cx, |shell, _| shell.rows.item_count() - 1);
    assert!(
        cx.debug_bounds(named(format!("pictures-{row}"))).is_some(),
        "one block"
    );
    let _ = std::fs::remove_dir_all(folder);
}
