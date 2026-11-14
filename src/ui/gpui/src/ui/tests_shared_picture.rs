//! A picture shared as a file, drawn as the web client draws one: the
//! picture is the card, its facts ride its corner, a public link has the
//! flag that copies it, and an expired share says so.

use gpui::{TestAppContext, VisualTestContext};

use super::shared_picture::{coarse, expired, facts, picture_box};
use super::tests::{click, shell};
use crate::engine::{Attachment, Conversation, Engine as _, Lasts, OpenTo, Reach, ShareAs};

/// A selector made at run time, as GPUI wants one: for the life of the test.
fn named(selector: String) -> &'static str {
    Box::leak(selector.into_boxed_str())
}

fn words(file: &Attachment, now: u64) -> Vec<String> {
    facts(file, now).iter().map(ToString::to_string).collect()
}

#[test]
fn the_chip_says_size_reach_and_when_it_goes_as_the_web_client_does() {
    let now = 1_800_000_000;
    let mut file = Attachment {
        name: "a.png".into(),
        size: Some(3_984_588),
        expires_at: Some(now + 7 * 86_400),
        ..Attachment::default()
    };
    let session = words(&file, now);
    assert_eq!(session[..2], ["3.8 MiB", "session"]);
    assert!(session[2].starts_with("expires "), "{session:?}");
    // A public link says no reach: its flag does.
    file.open_to = OpenTo::Link;
    assert_eq!(words(&file, now)[..1], ["3.8 MiB"]);
    assert_eq!(words(&file, now).len(), 2);
    // Inside two days a countdown, rounded down.
    file.expires_at = Some(now + 23 * 3_600 + 59 * 60);
    assert_eq!(words(&file, now)[1], "23h left");
    // Kept for as long as the server keeps anything: no expiry at all.
    file.expires_at = None;
    file.open_to = OpenTo::Password;
    assert_eq!(words(&file, now), ["3.8 MiB", "password"]);
    assert_eq!(coarse(2 * 86_400 + 5), "2d");
    assert_eq!(coarse(0), "1s");
    // Gone is gone.
    file.expires_at = Some(now - 1);
    assert!(expired(&file, now));
}

#[test]
fn a_picture_keeps_its_shape_within_the_box_and_a_long_one_is_framed() {
    let (width, height, framed) = picture_box(Some((1600, 900)));
    assert!((width - 420.0).abs() < 0.01 && (height - 236.25).abs() < 0.01 && !framed);
    assert!(picture_box(Some((900, 1600))).2, "a phone screenshot");
    assert_eq!(picture_box(Some((900, 1600))), (300.0, 400.0, true));
    assert_eq!(
        picture_box(Some((200, 100))),
        (200.0, 100.0, false),
        "never grown"
    );
}

/// A picture file, 900 by 600, in a folder of its own.
fn picture_file(name: &str) -> (std::path::PathBuf, std::path::PathBuf) {
    let folder =
        std::env::temp_dir().join(format!("fancy-gpui-card-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let path = folder.join(format!("{name}.png"));
    image::RgbImage::from_fn(900, 600, |x, y| {
        image::Rgb([(x % 256) as u8, (y % 256) as u8, 90])
    })
    .save(&path)
    .expect("a png");
    (folder, path)
}

/// Share the picture `name` as `reach`, and let it be fetched and drawn.
fn shared<'a>(
    name: &str,
    reach: Reach,
    lasts: Lasts,
    cx: &'a mut TestAppContext,
) -> (
    gpui::Entity<super::Shell>,
    std::sync::Arc<crate::demo::DemoEngine>,
    &'a mut VisualTestContext,
    std::path::PathBuf,
) {
    let (shell, engine, cx) = shell(cx);
    let (folder, path) = picture_file(name);
    engine.share(
        Conversation::Channel(1),
        String::new(),
        vec![path],
        ShareAs {
            reach,
            lasts,
            full: false,
        },
    );
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    (shell, engine, cx, folder)
}

/// The index of the newest message.
fn newest(shell: &gpui::Entity<super::Shell>, cx: &mut VisualTestContext) -> usize {
    shell.read_with(cx, |shell, _| shell.messages.len() - 1)
}

#[gpui::test]
fn a_public_picture_is_the_card_with_its_facts_and_the_flag_that_copies_its_link(
    cx: &mut TestAppContext,
) {
    let (shell, _engine, cx, folder) = shared("public", Reach::Link, Lasts::Always, cx);
    let index = newest(&shell, cx);
    let card = cx
        .debug_bounds(named(format!("shared-picture-{index}-0")))
        .expect("the picture is the card");
    // 900 by 600 held to 420 wide: its own shape.
    assert!((f32::from(card.size.width) - 420.0).abs() < 0.5, "{card:?}");
    assert!(
        (f32::from(card.size.height) - 280.0).abs() < 0.5,
        "{card:?}"
    );
    assert!(
        cx.debug_bounds(named(format!("file-{index}-0"))).is_none(),
        "no file row under it"
    );
    let facts = cx.debug_bounds("picture-facts").expect("the facts chip");
    assert!(
        f32::from(facts.origin.x - card.origin.x) <= 9.0,
        "lower left"
    );
    assert!(
        f32::from(card.bottom() - facts.bottom()) <= 9.0,
        "lower left"
    );
    // The flag copies the link.
    click(cx, named(format!("copy-link-{index}-0")));
    let copied = cx.read_from_clipboard().and_then(|item| item.text());
    assert_eq!(
        copied.as_deref(),
        Some("https://files.example/s/demo/public.png")
    );
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_none(), "not the picture's click")
    });
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_session_picture_has_no_link_to_copy(cx: &mut TestAppContext) {
    let (shell, _engine, cx, folder) = shared("session", Reach::Here, Lasts::Week, cx);
    let index = newest(&shell, cx);
    assert!(
        cx.debug_bounds(named(format!("shared-picture-{index}-0")))
            .is_some()
    );
    assert!(
        cx.debug_bounds(named(format!("copy-link-{index}-0")))
            .is_none()
    );
    assert!(
        cx.debug_bounds(named(format!("open-picture-{index}-0")))
            .is_none()
    );
    // Save is there for every reach but a sealed one.
    assert!(
        cx.debug_bounds(named(format!("save-picture-{index}-0")))
            .is_some()
    );
    // A click on the picture opens it large.
    click(cx, named(format!("shared-picture-{index}-0")));
    shell.read_with(cx, |shell, _| assert!(shell.lightbox.is_some()));
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn an_expired_share_is_a_card_that_says_so(cx: &mut TestAppContext) {
    let (shell, _engine, cx, folder) = shared("gone", Reach::Here, Lasts::Week, cx);
    let index = newest(&shell, cx);
    shell.update(cx, |shell, cx| {
        shell.messages[index].files[0].expires_at = Some(1);
        cx.notify();
    });
    cx.run_until_parked();
    assert!(
        cx.debug_bounds(named(format!("expired-file-{index}-0")))
            .is_some()
    );
    let _ = std::fs::remove_dir_all(folder);
}

/// A picture shared as a file whose conversation shows a small copy of it,
/// as a real server's does: the copy is 300 by 200, the picture 900 by 600.
fn shared_with_a_small_copy(
    cx: &mut TestAppContext,
) -> (
    gpui::Entity<super::Shell>,
    std::sync::Arc<crate::demo::DemoEngine>,
    &mut VisualTestContext,
    std::path::PathBuf,
    usize,
) {
    let (shell, engine, cx, folder) = shared("whole", Reach::Here, Lasts::Always, cx);
    let mut small = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(300, 200, image::Rgb([9, 9, 9])))
        .write_to(
            &mut std::io::Cursor::new(&mut small),
            image::ImageFormat::Png,
        )
        .expect("a png");
    let copy = std::sync::Arc::new(crate::picture::picture(small.clone()).expect("a picture"));
    engine.keep_shared("demo/whole-small", small);
    let index = newest(&shell, cx);
    shell.update(cx, |shell, cx| {
        shell.messages[index].files[0].stand_in = Some("demo/whole-small".into());
        // As fetched for the row.
        let _ = shell
            .panels
            .shared
            .insert("demo/whole-small".into(), Some(copy));
        cx.notify();
    });
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    (shell, engine, cx, folder, index)
}

#[gpui::test]
fn opened_large_a_shared_picture_is_the_whole_picture_fitted_to_the_window(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx, folder, index) = shared_with_a_small_copy(cx);
    let asked = |engine: &crate::demo::DemoEngine| {
        engine
            .shared_fetched()
            .iter()
            .filter(|key| key.as_ref() == "demo/whole.png")
            .count()
    };
    let before = asked(&engine);
    click(cx, named(format!("shared-picture-{index}-0")));
    cx.run_until_parked();
    assert_eq!(
        asked(&engine),
        before + 1,
        "the whole picture is asked for once"
    );
    let (open, whole_size) = shell.read_with(cx, |shell, _| {
        let open = shell.lightbox.clone().expect("open");
        (open.clone(), crate::picture::dimensions(open.bytes()))
    });
    assert_eq!(
        whole_size,
        Some((900, 600)),
        "the whole picture, not the small copy"
    );
    // Fitted to the window: as large as the room lets it be, never
    // larger than it is.
    let viewport = cx.update(|window, _| window.viewport_size());
    let room = (
        f32::from(viewport.width) * 0.9,
        f32::from(viewport.height) * 0.9 - 56.0,
    );
    let fitted = crate::picture::fitted((900, 600), room);
    let drawn = cx.debug_bounds("lightbox-picture").expect("the picture");
    assert!(
        (f32::from(drawn.size.width) - fitted.0).abs() < 1.0,
        "{drawn:?} {fitted:?}"
    );
    assert!(
        f32::from(drawn.size.width) > 300.0,
        "larger than the small copy"
    );

    // Copy hands over the whole picture's bytes.
    click(cx, "copy-picture");
    let copied = cx
        .read_from_clipboard()
        .and_then(|item| match item.entries().first() {
            Some(gpui::ClipboardEntry::Image(image)) => Some(image.bytes().to_vec()),
            _ => None,
        });
    assert_eq!(copied.as_deref(), Some(open.bytes()));
    // Save saves the file the server keeps.
    click(cx, "save-picture");
    assert!(cx.did_prompt_for_new_path());
    cx.simulate_new_path_selection(|folder| Some(folder.join("whole.png")));
    cx.run_until_parked();
    assert_eq!(
        engine
            .saved()
            .last()
            .map(|(key, _)| key.to_string())
            .as_deref(),
        Some("demo/whole.png")
    );

    // Closed, the whole picture is let go of.
    shell.update(cx, super::Shell::dismiss);
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_none());
        assert!(shell.large.is_none(), "still held");
    });
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn while_the_whole_picture_comes_its_small_copy_stands_in_at_the_whole_size(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx, folder, index) = shared_with_a_small_copy(cx);
    // The server has lost the file: nothing comes, the copy stays.
    engine.keep_shared("demo/whole.png", Vec::new());
    click(cx, named(format!("shared-picture-{index}-0")));
    cx.run_until_parked();
    let open = shell.read_with(cx, |shell, _| shell.lightbox.clone().expect("open"));
    assert_eq!(crate::picture::dimensions(open.bytes()), Some((300, 200)));
    let viewport = cx.update(|window, _| window.viewport_size());
    let room = (
        f32::from(viewport.width) * 0.9,
        f32::from(viewport.height) * 0.9 - 56.0,
    );
    let fitted = crate::picture::fitted((900, 600), room);
    let drawn = cx.debug_bounds("lightbox-picture").expect("the picture");
    assert!(
        (f32::from(drawn.size.width) - fitted.0).abs() < 1.0,
        "at the whole size"
    );
    let _ = std::fs::remove_dir_all(folder);
}
