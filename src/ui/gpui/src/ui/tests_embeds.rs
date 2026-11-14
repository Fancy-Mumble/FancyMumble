//! Links that show what they lead to: nothing is fetched before the
//! reader asks or trusts the host, and a video plays through the question
//! every link asks.

use std::sync::{Arc, Mutex};

use gpui::{Entity, TestAppContext, VisualTestContext};

use super::Shell;
use super::embeds::{Embeds, Showing};
use crate::demo::DemoEngine;
use crate::embed::{Fetch, Fetched, youtube};
use crate::engine::Conversation;

const CAT: &str = "https://cats.example/cat.png";
const VIDEO: &str = "dQw4w9WgXcQ";

/// Fetches from a table of answers, and keeps what it was asked for.
#[derive(Default)]
struct Table {
    answers: Vec<(String, Vec<u8>)>,
    asked: Mutex<Vec<String>>,
}

impl Table {
    fn answering(answers: &[(&str, Vec<u8>)]) -> Arc<Self> {
        Arc::new(Self {
            answers: answers
                .iter()
                .map(|(url, bytes)| ((*url).to_owned(), bytes.clone()))
                .collect(),
            asked: Mutex::default(),
        })
    }

    fn asked(&self) -> Vec<String> {
        self.asked.lock().expect("the list").clone()
    }
}

impl Fetch for Table {
    fn fetch(&self, url: &str, _: usize) -> async_channel::Receiver<Fetched> {
        self.asked.lock().expect("the list").push(url.to_owned());
        let answer = self
            .answers
            .iter()
            .find(|(known, _)| known == url)
            .map(|(_, bytes)| bytes.clone())
            .ok_or_else(|| "not here".to_owned());
        let (tell, told) = async_channel::bounded(1);
        let _ = tell.try_send(answer);
        told
    }
}

fn png() -> Vec<u8> {
    let mut bytes = Vec::new();
    image::RgbaImage::new(40, 30)
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .expect("a picture");
    bytes
}

/// Rin says `html` in the lounge, which is open; the message's index.
fn say(
    shell: &Entity<Shell>,
    engine: &DemoEngine,
    html: &str,
    cx: &mut VisualTestContext,
) -> usize {
    engine.say_as(3, "Rin", Conversation::Channel(1), html);
    cx.run_until_parked();
    // Drawn once more, for what the first drawing asked for.
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| shell.messages.len() - 1)
}

/// A shell whose fetching goes to `table`.
fn fetching_from(table: &Arc<Table>, shell: &Entity<Shell>, cx: &mut VisualTestContext) {
    let fetch: Arc<dyn Fetch> = table.clone();
    shell.update(cx, |shell, _| {
        shell.panels.embeds = Embeds::fetching_with(fetch)
    });
}

#[gpui::test]
fn a_picture_link_asks_before_anything_is_fetched(cx: &mut TestAppContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let table = Table::answering(&[(CAT, png())]);
    fetching_from(&table, &shell, cx);
    let index = say(
        &shell,
        &engine,
        &format!(r#"<a href="{CAT}">a cat</a>"#),
        cx,
    );
    assert_eq!(index, 5, "the selectors below name the sixth message");
    assert!(cx.debug_bounds("embed-gate-5").is_some(), "the question");
    assert!(
        table.asked().is_empty(),
        "nothing fetched before the reader asks"
    );

    super::tests::click(cx, "embed-load-5");
    assert_eq!(table.asked(), [CAT]);
    assert!(cx.debug_bounds("embed-picture-5").is_some(), "the picture");
    shell.read_with(cx, |shell, _| {
        assert!(matches!(
            shell.panels.embeds.showing(CAT, false),
            Showing::Picture(_)
        ));
    });
}

#[gpui::test]
fn a_trusted_host_is_fetched_without_asking(cx: &mut TestAppContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let table = Table::answering(&[(CAT, png())]);
    fetching_from(&table, &shell, cx);
    shell.update(cx, |shell, _| {
        shell.panels.links.trusted.push("cats.example".to_owned());
    });
    let index = say(
        &shell,
        &engine,
        &format!(r#"<a href="{CAT}">a cat</a>"#),
        cx,
    );
    assert_eq!(index, 5);
    assert_eq!(table.asked(), [CAT], "once");
    assert!(cx.debug_bounds("embed-picture-5").is_some());
}

#[gpui::test]
fn a_video_is_a_card_and_plays_through_the_question_links_ask(cx: &mut TestAppContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let table = Table::answering(&[]);
    fetching_from(&table, &shell, cx);
    let link = format!("https://youtu.be/{VIDEO}");
    let index = say(
        &shell,
        &engine,
        &format!(r#"<a href="{link}">watch</a>"#),
        cx,
    );
    assert_eq!(index, 5);
    assert!(cx.debug_bounds("embed-youtube-5").is_some(), "the card");
    // The demo server's card has a title and no still: YouTube's still
    // is offered, not fetched.
    assert!(cx.debug_bounds("embed-gate-5").is_some());
    assert!(table.asked().is_empty());
    assert!(
        cx.debug_bounds("preview-5").is_none(),
        "the card stands in for the server's"
    );

    super::tests::click(cx, "embed-play-5");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.links.asked(),
            Some(youtube::watch(VIDEO).as_str()),
            "asked about, as any link is"
        );
    });
}

#[gpui::test]
fn loading_a_video_fetches_its_still_and_title_from_youtube(cx: &mut TestAppContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let about = br#"{"title":"Never gonna"}"#.to_vec();
    let table = Table::answering(&[
        (&youtube::still(VIDEO), png()),
        (&youtube::about(VIDEO), about),
    ]);
    fetching_from(&table, &shell, cx);
    let link = format!("https://www.youtube.com/watch?v={VIDEO}");
    let index = say(
        &shell,
        &engine,
        &format!(r#"<a href="{link}">watch</a>"#),
        cx,
    );
    assert_eq!(index, 5);
    super::tests::click(cx, "embed-load-5");
    assert_eq!(
        table.asked(),
        [youtube::still(VIDEO), youtube::about(VIDEO)]
    );
    shell.read_with(cx, |shell, _| {
        assert!(matches!(
            shell.panels.embeds.showing(&youtube::still(VIDEO), false),
            Showing::Picture(_)
        ));
    });
}

#[gpui::test]
fn without_the_server_asked_a_link_is_still_known_and_still_asks(cx: &mut TestAppContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let table = Table::answering(&[(CAT, png())]);
    fetching_from(&table, &shell, cx);
    shell.update(cx, |shell, _| {
        shell.panels.settings.privacy.leave_links = true
    });
    let index = say(
        &shell,
        &engine,
        &format!(r#"<a href="{CAT}">a cat</a>"#),
        cx,
    );
    assert_eq!(index, 5);
    assert!(cx.debug_bounds("embed-gate-5").is_some());
    assert!(table.asked().is_empty());
}
