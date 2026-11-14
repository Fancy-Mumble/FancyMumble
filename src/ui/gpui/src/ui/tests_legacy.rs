//! A picture shared as a file, as a stock Mumble client is shown it: the
//! message that goes on the wire carries a copy of the picture fenced in
//! for such a client, within the server's limit, and the view, a Fancy
//! client, never draws or decodes that copy.

use gpui::TestAppContext;

use super::tests::{click, shell};

/// A test card larger than any copy: 2000 by 1200, three colours.
fn test_card(folder: &std::path::Path) -> std::path::PathBuf {
    let card = image::RgbImage::from_fn(2000, 1200, |x, y| match (x / 400 + y / 400) % 3 {
        0 => image::Rgb([200, 30, 30]),
        1 => image::Rgb([240, 240, 240]),
        _ => image::Rgb([20, 20, 120]),
    });
    let path = folder.join("card.png");
    card.save(&path).expect("a png");
    path
}

#[gpui::test]
fn a_shared_picture_goes_with_a_copy_for_stock_clients_that_the_view_never_draws(
    cx: &mut TestAppContext,
) {
    let folder = std::env::temp_dir().join(format!("fancy-gpui-legacy-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let picture = test_card(&folder);
    let (shell, engine, cx) = shell(cx);
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.stage_files(vec![picture], cx));
    cx.run_until_parked();
    click(cx, "send");
    cx.run_until_parked();

    let sent = engine.shares_sent();
    assert_eq!(sent.len(), 1);
    let wire = &sent[0];
    let (marks, copy) = wire
        .split_once('\n')
        .unwrap_or_else(|| panic!("no copy after the marks: {wire}"));
    assert_eq!(
        marks, "<!-- FANCY_FILE:demo/card.png -->",
        "the line gives way to it"
    );
    assert!(copy.starts_with(r#"<!-- FANCY_LEGACY --><img src="data:image/"#));
    assert!(copy.ends_with(r#"" alt="card.png" /><!-- /FANCY_LEGACY -->"#));
    // Within the demo server's limit (Mumble's own), and most of it.
    let length = wire.encode_utf16().count();
    assert!(length <= 131_072, "{length}");

    // What a stock client decodes: large, held to the box.
    use base64::Engine as _;
    let start = copy.find(";base64,").expect("data") + ";base64,".len();
    let end = start + copy[start..].find('"').expect("its end");
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&copy[start..end])
        .expect("base64");
    let shown = image::load_from_memory(&bytes).expect("a picture");
    assert!(
        shown.width() >= 1200 && shown.width() <= 1600,
        "{}",
        shown.width()
    );

    // The view draws the message from what a Fancy client reads: no copy.
    shell.read_with(cx, |shell, _| {
        let drawn = shell
            .messages
            .iter()
            .any(|message| message.html.contains("data:image"));
        assert!(!drawn, "the copy reached the view");
    });
    let rich = crate::rich::Rich::parse(marks);
    assert!(rich.images.is_empty());
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_password_share_goes_without_a_copy(cx: &mut TestAppContext) {
    let folder = std::env::temp_dir().join(format!("fancy-gpui-legacy-pw-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("a folder");
    let picture = test_card(&folder);
    let (_shell, engine, _cx) = shell(cx);
    use crate::engine::{Conversation, Engine as _, Reach, ShareAs};
    engine.share(
        Conversation::Channel(1),
        String::new(),
        vec![picture],
        ShareAs {
            reach: Reach::Password("secret".into()),
            ..ShareAs::default()
        },
    );
    let sent = engine.shares_sent();
    assert!(!sent[0].contains("<img"), "{}", &sent[0]);
    assert!(sent[0].contains("<!-- FANCY_LEGACY -->") && sent[0].contains(" card.png ("), "named instead");
    let _ = std::fs::remove_dir_all(folder);
}
