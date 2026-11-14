//! A message heavy with pictures is read on another thread, not in the
//! frame that scrolls it into view: until it is back its row draws what
//! stands in for it, at the size it had.

use std::sync::Arc;

use gpui::TestAppContext;

use super::tests::shell;
use crate::engine::Conversation;

/// A picture of noise, so large that a message carrying it is heavy.
fn heavy_picture() -> String {
    use base64::Engine as _;
    let mut seed: u32 = 7;
    let noise = image::RgbaImage::from_fn(200, 200, |_, _| {
        seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        image::Rgba(seed.to_le_bytes())
    });
    let mut png = Vec::new();
    noise
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a picture");
    base64::engine::general_purpose::STANDARD.encode(png)
}

#[gpui::test]
fn a_body_heavy_with_pictures_is_read_off_the_frame_that_draws_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let html = format!(
        r#"<p>Look</p><img src="data:image/png;base64,{}">"#,
        heavy_picture()
    );
    assert!(html.len() > 64 * 1024, "heavy");
    engine.say_as(3, "Rin", Conversation::Channel(1), &html);
    cx.run_until_parked();
    let index = shell.read_with(cx, |shell, _| shell.messages.len() - 1);
    // Drawn again from nothing: what comes back at once stands in, and
    // asked again before the read is back, it is the same read.
    let first = shell.update(cx, |shell, cx| {
        let _ = shell.bodies.remove(&index);
        shell.drawn_body_soon(index, cx)
    });
    assert!(!first.is_whole(), "not read in the frame");
    let again = shell.update(cx, |shell, cx| shell.drawn_body_soon(index, cx));
    assert!(Arc::ptr_eq(&first, &again), "read once");
    cx.run_until_parked();
    let read = shell
        .read_with(cx, |shell, _| shell.bodies.get(&index).cloned())
        .expect("kept");
    assert!(read.is_whole());
    assert_eq!(read.pictures().count(), 1);
    // Put away to save memory, it keeps its room while it is read again.
    let back = shell.update(cx, |shell, cx| {
        if let Some(body) = shell.bodies.get_mut(&index) {
            *body = Arc::new(body.stand_in());
        }
        shell.drawn_body_soon(index, cx)
    });
    assert!(!back.is_whole());
    assert_eq!(back.picture_sizes(), read.picture_sizes(), "the same room");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.bodies.get(&index).is_some_and(|body| body.is_whole()));
    });
}
