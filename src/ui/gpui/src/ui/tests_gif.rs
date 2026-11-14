//! GIFs in the view: the chip and when it is there, the browser (searched
//! once typing pauses, only what is in view fetched, let go of when it
//! closes, worked from the keyboard), a pick sent as the web client sends
//! it, and a picked GIF drawn in a message, asked about where it would
//! reach a third party.

use std::sync::{Arc, Mutex};

use gpui::{Entity, KeyUpEvent, Keystroke, SharedString, TestAppContext, VisualTestContext};
use mumble_tauri_lib::engine_api::gifs::{MessageLimits, picked_gif_body};

use super::Shell;
use super::embeds::{Embeds, Showing};
use super::gifs::PAUSE;
use super::kit;
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::embed::{Fetch, Fetched};
use crate::engine::Conversation;
use crate::gif::made_up::MadeUp;
use crate::gif::{Refused, Why};

const ROOT: &str = "https://chat.example";

/// Answers every address with an animation, and keeps what it was asked.
#[derive(Default)]
struct Table {
    asked: Mutex<Vec<String>>,
}

impl Table {
    fn asked(&self) -> Vec<String> {
        self.asked.lock().expect("the list").clone()
    }
}

impl Fetch for Table {
    fn fetch(&self, url: &str, _: usize) -> async_channel::Receiver<Fetched> {
        self.asked.lock().expect("the list").push(url.to_owned());
        let (tell, told) = async_channel::bounded(1);
        let _ = tell.try_send(Ok(crate::gif::stand_in::animation(3)));
        told
    }
}

/// A shell whose server serves `count` made-up GIFs itself, fetching
/// through a table.
fn served(
    count: usize,
    cx: &mut TestAppContext,
) -> (
    Entity<Shell>,
    Arc<DemoEngine>,
    Arc<MadeUp>,
    Arc<Table>,
    &mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    let made_up = Arc::new(MadeUp::at(ROOT, count));
    engine.offer_gifs(Some(made_up.service()));
    let table = Arc::new(Table::default());
    let fetch: Arc<dyn Fetch> = table.clone();
    shell.update(cx, |shell, _| {
        shell.panels.embeds = Embeds::fetching_with(Arc::clone(&fetch));
        shell.panels.gifs.fetch = fetch;
    });
    cx.run_until_parked();
    (shell, engine, made_up, table, cx)
}

fn offers(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> bool {
    shell.read_with(cx, |shell, _| shell.offers_gifs())
}

fn open(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> bool {
    shell.read_with(cx, |shell, _| shell.panels.gifs.is_open())
}

/// Press `key` and let it go.
fn press(cx: &mut VisualTestContext, key: &'static str) {
    cx.simulate_keystrokes(key);
    cx.simulate_event(KeyUpEvent {
        keystroke: Keystroke::parse(key).expect("a key"),
    });
    cx.run_until_parked();
}

#[gpui::test]
fn the_chip_is_there_only_where_gifs_reach_nobody_unasked(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(!offers(&shell, cx), "no service, no key");
    assert!(cx.debug_bounds("gif-chip").is_none());
    let made_up = Arc::new(MadeUp::at(ROOT, 4));
    // A service whose pictures are on the provider's addresses: drawing
    // them would tell the provider who is looking.
    let mut on_the_provider = made_up.service();
    on_the_provider.support.media_base = None;
    engine.offer_gifs(Some(on_the_provider.clone()));
    cx.run_until_parked();
    assert!(!offers(&shell, cx));
    // The server says it has none.
    let mut none = made_up.service();
    none.support.available = false;
    engine.offer_gifs(Some(none));
    cx.run_until_parked();
    assert!(!offers(&shell, cx));
    // It serves them itself.
    engine.offer_gifs(Some(made_up.service()));
    cx.run_until_parked();
    assert!(offers(&shell, cx));
    assert!(cx.debug_bounds("gif-chip").is_some());
    // A key of the user's own is consent to the provider.
    engine.offer_gifs(Some(on_the_provider));
    shell.update(cx, |shell, _| {
        shell.panels.gifs.key = Some("own".to_owned())
    });
    cx.run_until_parked();
    assert!(offers(&shell, cx));
}

#[gpui::test]
fn the_browser_opens_on_trending_and_searches_once_typing_pauses(cx: &mut TestAppContext) {
    let (shell, _engine, made_up, _table, cx) = served(40, cx);
    click(cx, "gif-chip");
    assert!(open(&shell, cx));
    assert_eq!(made_up.asked(), [(String::new(), 1)], "trending first");
    assert!(cx.debug_bounds("gif-tile-0").is_some());
    assert!(
        cx.debug_bounds("gif-provider").is_some(),
        "the provider is credited"
    );
    // The field has the keyboard: typing goes there, and is searched for
    // once, after it pauses.
    cx.simulate_input("ca");
    cx.simulate_input("t");
    cx.run_until_parked();
    assert_eq!(made_up.asked().len(), 1, "not while typing");
    cx.executor().advance_clock(PAUSE);
    cx.run_until_parked();
    assert_eq!(made_up.asked(), [(String::new(), 1), ("cat".to_owned(), 1)]);
    // A shortcut is asked at once.
    shell.update(cx, |shell, cx| {
        let _ = shell.close_gifs(cx);
    });
    click(cx, "gif-chip");
    click(cx, "gif-tab-2");
    assert_eq!(made_up.asked().last(), Some(&("Anime".to_owned(), 1)));
}

#[gpui::test]
fn only_the_previews_in_view_are_fetched_and_they_go_when_it_closes(cx: &mut TestAppContext) {
    let (shell, _engine, made_up, table, cx) = served(60, cx);
    click(cx, "gif-chip");
    // Drawn again once the first previews landed.
    cx.run_until_parked();
    let previews: Vec<String> = table
        .asked()
        .into_iter()
        .filter(|url| url.ends_with("&s=xs"))
        .collect();
    assert!(!previews.is_empty());
    assert!(
        previews.len() <= 8,
        "a page is twelve, three rows are in view: {previews:?}"
    );
    assert!(
        table.asked().iter().all(|url| url.ends_with("&s=xs")),
        "nothing full-sized is fetched to browse"
    );
    assert_eq!(made_up.asked().len(), 1, "no further page unasked");
    let first: SharedString = format!("{ROOT}/gif?u=0&s=xs").into();
    let held = |shell: &Entity<Shell>, cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            matches!(
                shell.panels.embeds.showing(&first, true),
                Showing::Picture(_)
            )
        })
    };
    assert!(held(&shell, cx));
    // Escape closes it, and what it fetched is let go of.
    shell.update(cx, Shell::dismiss);
    assert!(!open(&shell, cx));
    assert!(!held(&shell, cx), "its pictures are not held after it");
}

#[gpui::test]
fn a_pick_is_sent_as_the_web_client_sends_it_and_drawn_without_asking(cx: &mut TestAppContext) {
    let (shell, engine, _made_up, table, cx) = served(12, cx);
    click(cx, "gif-chip");
    click(cx, "gif-tile-1");
    assert!(!open(&shell, cx), "picking closes it");
    let url = format!("{ROOT}/gif?u=1");
    assert_eq!(
        engine.gifs_sent(),
        [picked_gif_body(&url, MessageLimits::default())]
    );
    assert_eq!(
        engine.gifs_sent()[0],
        "<img src=\"https://chat.example/gif?u=1\" alt=\"GIF\">\n<!-- FANCY_FALLBACK -->\
         <!-- FANCY_LEGACY --><a href=\"https://chat.example/gif?u=1\">GIF</a><!-- /FANCY_LEGACY -->"
    );
    cx.run_until_parked();
    // The server's own copy: fetched at once, and drawn as a picture.
    let index = shell.read_with(cx, |shell, _| shell.messages.len() - 1);
    assert!(table.asked().contains(&url));
    assert!(cx.debug_bounds(gate(index)).is_none());
    assert!(cx.debug_bounds(picture(index)).is_some());
}

#[gpui::test]
fn a_pick_answers_what_is_being_answered(cx: &mut TestAppContext) {
    let (shell, engine, _made_up, _table, cx) = served(12, cx);
    shell.update(cx, |shell, _| {
        shell.replying = Some(("m-42".into(), "Rin".into()));
    });
    click(cx, "gif-chip");
    click(cx, "gif-tile-0");
    assert!(engine.gifs_sent()[0].starts_with("<!-- FANCY_QUOTE:m-42 --><img src="));
    assert!(shell.read_with(cx, |shell, _| shell.replying.is_none()));
}

fn gate(index: usize) -> &'static str {
    Box::leak(format!("embed-gate-{index}").into_boxed_str())
}

fn picture(index: usize) -> &'static str {
    Box::leak(format!("web-picture-{index}-0").into_boxed_str())
}

#[gpui::test]
fn a_gif_from_the_provider_waits_to_be_let_in(cx: &mut TestAppContext) {
    let (shell, engine, _made_up, table, cx) = served(4, cx);
    // What a web user with a key of their own sends: the provider's address.
    let url = "https://static.klipy.com/ii/4e7bea9f7a3371424e6c16ebc93252fe/cat.gif";
    let body = picked_gif_body(url, MessageLimits::default());
    let read = body.split('\n').next().expect("the picture").to_owned();
    engine.say_as(3, "Rin", Conversation::Channel(1), &read);
    cx.run_until_parked();
    cx.run_until_parked();
    let index = shell.read_with(cx, |shell, _| shell.messages.len() - 1);
    assert!(cx.debug_bounds(gate(index)).is_some(), "asked about");
    assert!(table.asked().is_empty(), "and nothing fetched");
    let load: &'static str = Box::leak(format!("embed-load-{index}").into_boxed_str());
    click(cx, load);
    cx.run_until_parked();
    assert_eq!(table.asked(), [url]);
    assert!(
        cx.debug_bounds(picture(index)).is_some(),
        "drawn once let in"
    );
}

#[gpui::test]
fn a_refusal_is_said_in_the_browser(cx: &mut TestAppContext) {
    let (shell, _engine, made_up, _table, cx) = served(4, cx);
    made_up.refuse(Some(Refused::new(Why::Throttled, "slow down")));
    click(cx, "gif-chip");
    assert!(open(&shell, cx));
    assert!(cx.debug_bounds("gif-said").is_some());
    assert!(cx.debug_bounds("gif-tile-0").is_none());
}

#[gpui::test]
fn the_keyboard_reaches_everything_in_the_browser(cx: &mut TestAppContext) {
    let (shell, engine, _made_up, _table, cx) = served(12, cx);
    click(cx, "gif-chip");
    // From the field, round what the browser holds.
    let mut reached = Vec::new();
    for _ in 0..14 {
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
        reached.push(cx.update(|window, cx| kit::keyboard_at(window, cx)));
    }
    let reached: Vec<String> = reached.into_iter().flatten().collect();
    for wanted in [
        "gif-close",
        "gif-tab-0",
        "gif-tab-1",
        "gif-tab-2",
        "gif-tile-0",
        "gif-tile-1",
    ] {
        assert!(
            reached.iter().any(|id| id == wanted),
            "{wanted} not reached: {reached:?}"
        );
    }
    assert!(open(&shell, cx), "Tab stays inside");
    // Enter on a tile sends it.
    for _ in 0..30 {
        if cx
            .update(|window, cx| kit::keyboard_at(window, cx))
            .as_deref()
            == Some("gif-tile-0")
        {
            break;
        }
        cx.simulate_keystrokes("tab");
        cx.run_until_parked();
    }
    press(cx, "enter");
    assert_eq!(engine.gifs_sent().len(), 1);
    assert!(!open(&shell, cx));
}

#[gpui::test]
fn a_gif_for_a_picture_of_ones_own_is_handed_over_as_its_previews_bytes(cx: &mut TestAppContext) {
    let (shell, engine, _made_up, table, cx) = served(12, cx);
    shell.update_in(cx, |shell, window, cx| {
        shell.pick_gif_picture(
            gpui::point(gpui::px(300.0), gpui::px(500.0)),
            |shell, bytes, _| shell.notice = Some(format!("{} bytes", bytes.len()).into()),
            window,
            cx,
        );
    });
    cx.run_until_parked();
    click(cx, "gif-tile-2");
    cx.run_until_parked();
    let notice = shell.read_with(cx, |shell, _| {
        shell.notice.as_ref().map(ToString::to_string)
    });
    let made = crate::gif::stand_in::animation(3).len();
    assert_eq!(notice.as_deref(), Some(format!("{made} bytes").as_str()));
    assert!(engine.gifs_sent().is_empty(), "nothing is sent");
    assert_eq!(
        table
            .asked()
            .iter()
            .filter(|url| url.as_str() == format!("{ROOT}/gif?u=2&s=xs"))
            .count(),
        1,
        "the preview drawn is the one taken"
    );
}
