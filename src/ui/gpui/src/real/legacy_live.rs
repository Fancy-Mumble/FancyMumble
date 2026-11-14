//! A picture shared as a file on a live Fancy server, with the copy a stock
//! Mumble client is shown beside it.
//!
//! ```text
//! FANCY_GPUI_TEST_FANCY=127.0.0.1:64920 FANCY_GPUI_TEST_SUPERUSER=<password> \
//!   cargo test -- --ignored live_fancy_a_shared_picture
//! ```
//!
//! The sender is `SuperUser`, who may keep files on any server. The message
//! with its copy fills most of what the server takes of one message: that
//! it arrives at all is the server's word that it was not too long. What a
//! stock client is handed of it is read from the server's own archive, or
//! from a stock client, by whoever runs this (see the report).

use std::time::{Duration, Instant};

use super::RealEngine;
use crate::engine::{Conversation, Engine, Lasts, Reach, SavedServer, ShareAs};

fn client(name: &str, password: Option<String>) -> (RealEngine, std::path::PathBuf) {
    let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
    let (host, port) = address.rsplit_once(':').expect("host:port");
    let dir = std::env::temp_dir().join(format!(
        "fancy-gpui-legacy-{}-{}",
        name.to_lowercase(),
        std::process::id()
    ));
    let _ = std::fs::remove_dir_all(&dir);
    let engine = RealEngine::start(&dir).expect("the engine starts");
    engine.save_server(SavedServer {
        id: "live".into(),
        label: "live".into(),
        host: host.to_owned().into(),
        port: port.parse().expect("a port"),
        username: name.to_owned().into(),
        certificate: Some(name.to_lowercase().into()),
        favorite: false,
    });
    engine.connect("live", password);
    (engine, dir)
}

#[track_caller]
fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(90);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// A test card that says nothing: 2000 by 1200, bands of colour and grain,
/// heavy enough that its copy has to be fitted.
fn test_card(path: &std::path::Path) {
    let mut seed = 0x9e37_79b9_u32;
    let card = image::RgbImage::from_fn(2000, 1200, |x, y| {
        seed ^= seed << 13;
        seed ^= seed >> 17;
        seed ^= seed << 5;
        let grain = (seed & 0x0f) as u8;
        let band = match (x / 250 + y / 300) % 4 {
            0 => [200, 40, 40],
            1 => [235, 235, 235],
            2 => [30, 60, 160],
            _ => [40, 150, 70],
        };
        image::Rgb(band.map(|c: u8| c.saturating_add(grain)))
    });
    card.save(path).expect("a png");
}

#[test]
#[ignore = "needs a live Fancy server that keeps files, and its SuperUser password"]
fn live_fancy_a_shared_picture_goes_with_its_copy_and_is_taken() {
    let password = std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
    let (sender, sender_dir) = client("SuperUser", Some(password));
    let (reader, reader_dir) = client("LegacyReader", None);
    wait_for("both to connect", || {
        [&sender, &reader]
            .iter()
            .all(|engine| engine.snapshot().users.len() >= 2)
    });
    let root = reader.snapshot().current_channel.expect("a channel");
    let room = Conversation::Channel(root);
    let folder =
        std::env::temp_dir().join(format!("fancy-gpui-legacy-card-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("writable");
    let card = folder.join("legacy-card.png");
    test_card(&card);

    sender.share(
        room,
        "legacy card".to_owned(),
        vec![card],
        ShareAs {
            reach: Reach::Here,
            lasts: Lasts::Week,
            full: false,
        },
    );
    wait_for("the message with its file", || {
        reader
            .messages(room)
            .iter()
            .any(|message| message.body.contains("legacy card") && message.files.len() == 1)
    });
    let message = reader
        .messages(room)
        .into_iter()
        .find(|message| message.body.contains("legacy card"))
        .expect("the message");
    // A Fancy client reads the card, never the copy.
    assert!(
        !message.html.contains("data:image"),
        "the copy reached a Fancy client"
    );
    assert!(!message.html.contains("FANCY_LEGACY"));
    assert_eq!(message.files[0].pixels, Some((2000, 1200)));
    for (engine, dir) in [(sender, sender_dir), (reader, reader_dir)] {
        engine.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
    let _ = std::fs::remove_dir_all(folder);
}
