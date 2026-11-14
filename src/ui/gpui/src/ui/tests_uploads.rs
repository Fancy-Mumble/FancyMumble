//! The files a message is to carry and the files going up, as the web UI
//! draws them: the tray of tiles with its folded options, one row for each
//! file on its way, and the composer a drawn theme stands as plates.

use gpui::{TestAppContext, VisualTestContext, px};

use super::tests::{click, shell};
use crate::engine::Conversation;
use crate::theme::{ActiveTheme, Mode};

/// A folder with a text file and a picture in it.
fn files(name: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let folder = std::env::temp_dir().join(format!("fancy-gpui-up-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("writable");
    let (notes, picture) = (folder.join("notes.txt"), folder.join("cat.png"));
    std::fs::write(&notes, b"not a picture").expect("writable");
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(600, 300, image::Rgb([1, 2, 3])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    std::fs::write(&picture, &png).expect("writable");
    (folder, notes, picture)
}

fn stage(
    shell: &gpui::Entity<super::Shell>,
    paths: Vec<std::path::PathBuf>,
    cx: &mut VisualTestContext,
) {
    shell.update(cx, |shell, cx| shell.stage_files(paths, cx));
    cx.run_until_parked();
}

fn size_of(cx: &mut VisualTestContext, name: &'static str) -> gpui::Size<gpui::Pixels> {
    cx.debug_bounds(name).expect(name).size
}

#[gpui::test]
fn files_wait_on_tiles_as_large_as_the_web_uis_with_their_options_folded(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let (folder, notes, picture) = files("tray");
    cx.executor().allow_parking();
    stage(&shell, vec![picture, notes], cx);
    // A picture is its own square; a file is its kind, name and size.
    assert_eq!(size_of(cx, "staged-0"), gpui::size(px(150.0), px(150.0)));
    assert_eq!(size_of(cx, "staged-1").height, px(150.0));
    assert_eq!(size_of(cx, "staged-remove-0"), gpui::size(px(22.0), px(22.0)));
    // Folded, the options say how they stand: the web UI's defaults.
    // A picture that comes out no smaller compressed has no quality to
    // choose, so the line names only who can see them.
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.staged_summary().as_deref(), Some("This channel"));
    });
    click(cx, "staged-options");
    // Unfolded, the tiles make room, and each choice is a chip.
    assert_eq!(size_of(cx, "staged-0"), gpui::size(px(54.0), px(54.0)));
    for chip in ["share-to-0", "share-to-1", "share-to-2", "share-lasts-0", "share-lasts-1", "share-lasts-2"] {
        assert!(cx.debug_bounds(chip).is_some(), "{chip}");
    }
    // They belong to the conversation they were chosen in.
    shell.update(cx, |shell, cx| {
        shell.open = Some(Conversation::Channel(0));
        cx.notify();
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(!shell.has_staged()));
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_file_going_up_has_a_row_that_moves_and_holds_the_next_message(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let (folder, notes, picture) = files("going");
    cx.executor().allow_parking();
    engine.hold_uploads();
    stage(&shell, vec![picture.clone(), notes.clone()], cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i");
    click(cx, "send");
    cx.run_until_parked();
    // One row: the file going, with its size and nothing gone yet.
    assert!(cx.debug_bounds("uploads").is_some());
    shell.read_with(cx, |shell, _| {
        let lines = shell.upload_lines();
        assert_eq!(lines.len(), 1, "{lines:?}");
        assert!(lines[0].ends_with("0%"), "{lines:?}");
        assert!(shell.uploading());
    });
    // Nothing more goes meanwhile.
    cx.simulate_keystrokes("m o r e");
    click(cx, "send");
    cx.run_until_parked();
    assert!(engine.shares().is_empty());
    // Half of it gone, and a time left to tell.
    engine.upload_sent(50, 100);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let lines = shell.upload_lines();
        assert!(lines[0].contains("50%") && lines[0].contains("s left"), "{lines:?}");
    });
    // Up: the rows go and the message names both files.
    engine.uploads_done();
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.upload_lines().is_empty() && !shell.uploading());
    });
    let shares = engine.shares();
    assert_eq!(shares.len(), 1);
    assert_eq!(shares[0].1, vec![picture, notes]);
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_cancelled_file_is_not_sent_and_a_failed_one_says_why(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let (folder, notes, picture) = files("stopped");
    cx.executor().allow_parking();
    engine.hold_uploads();
    stage(&shell, vec![picture, notes.clone()], cx);
    click(cx, "send");
    cx.run_until_parked();
    // The first is stopped: the next is the one going.
    click(cx, "upload-cancel-0");
    shell.read_with(cx, |shell, _| assert_eq!(shell.upload_lines().len(), 1));
    engine.uploads_done();
    cx.run_until_parked();
    let shares = engine.shares();
    assert_eq!(shares.len(), 1);
    assert_eq!(shares[0].1, vec![notes.clone()], "only the one not stopped");

    // A file the server refuses keeps its row, saying why, and holds
    // nothing back; taken away, it is gone.
    stage(&shell, vec![notes], cx);
    click(cx, "send");
    cx.run_until_parked();
    engine.upload_failed("The server refused it.");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.upload_lines(), ["The server refused it."]);
        assert!(!shell.uploading());
    });
    click(cx, "upload-cancel-0");
    shell.read_with(cx, |shell, _| assert!(shell.upload_lines().is_empty()));
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_drawn_theme_stands_the_composer_as_three_plates_with_a_worded_send(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    // The default theme: one panel, Send a disc inside it, no hint.
    assert!(cx.debug_bounds("composer-hint").is_none());
    assert_eq!(size_of(cx, "send"), gpui::size(px(32.0), px(32.0)));
    cx.update(|_, cx| ActiveTheme::set("nimbus", Mode::Dark, cx));
    cx.run_until_parked();
    let tools = cx.debug_bounds("composer-tools").expect("the attach plate");
    let field = cx.debug_bounds("composer-field").expect("the field's plate");
    let send = cx.debug_bounds("send").expect("Send's plate");
    assert_eq!(tools.size.height, px(56.0));
    assert_eq!(send.size.height, px(56.0));
    assert!(send.size.width > px(80.0), "worded: {send:?}");
    // In that order, each overlapping the last by three pixels.
    assert_eq!(field.left(), tools.right() - px(3.0));
    assert_eq!(send.left(), field.right() - px(3.0));
    assert!(cx.debug_bounds("composer-hint").is_some());
}
