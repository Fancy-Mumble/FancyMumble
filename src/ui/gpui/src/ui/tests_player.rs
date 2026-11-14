//! A video played in place, with a made-up player: asked about first,
//! laid over its card, with what floats drawn above it, given the keyboard
//! back, and stopped and let go of when its card goes.

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::Arc;
use std::time::Duration;

use gpui::{Entity, TestAppContext, VisualTestContext};

use super::Shell;
use super::embeds::Embeds;
use crate::demo::DemoEngine;
use crate::embed::{Fetch, Fetched, youtube};
use crate::engine::Conversation;
use crate::player::{Page, Placement, Said, Screen, Screens};

const VIDEO: &str = "aqz-KE-bpKQ";

/// What happened to the made-up players, in order.
#[derive(Debug, Clone, PartialEq)]
enum Done {
    Opened(String),
    Started,
    PlayedOn,
    Placed(Placement),
    Keys,
    Rest(bool),
    Closed,
}

/// Opens made-up players, or none at all.
struct Made {
    plays: bool,
    log: Rc<RefCell<Vec<Done>>>,
    /// What the last page opened says through.
    said: RefCell<Option<async_channel::Sender<Said>>>,
}

impl Made {
    fn playing(plays: bool) -> Rc<Self> {
        Rc::new(Self {
            plays,
            log: Rc::default(),
            said: RefCell::default(),
        })
    }

    fn log(&self) -> Vec<Done> {
        self.log.borrow().clone()
    }

    fn opened(&self) -> usize {
        self.log()
            .iter()
            .filter(|done| matches!(done, Done::Opened(_)))
            .count()
    }

    fn last_placed(&self) -> Option<Placement> {
        self.log().iter().rev().find_map(|done| match done {
            Done::Placed(placement) => Some(*placement),
            _ => None,
        })
    }
}

impl Screens for Made {
    fn plays_in_place(&self) -> bool {
        self.plays
    }

    fn open(
        &self,
        page: &Page,
        _: &mut gpui::Window,
        said: async_channel::Sender<Said>,
    ) -> Result<Box<dyn Screen>, String> {
        self.log.borrow_mut().push(Done::Opened(page.embed()));
        *self.said.borrow_mut() = Some(said);
        Ok(Box::new(MadeScreen(Rc::clone(&self.log))))
    }
}

struct MadeScreen(Rc<RefCell<Vec<Done>>>);

impl Screen for MadeScreen {
    fn start(&mut self) {
        self.0.borrow_mut().push(Done::Started);
    }

    fn play_on(&mut self) {
        self.0.borrow_mut().push(Done::PlayedOn);
    }

    fn place(&mut self, placement: Placement) {
        self.0.borrow_mut().push(Done::Placed(placement));
    }

    fn release_keys(&mut self) {
        self.0.borrow_mut().push(Done::Keys);
    }

    fn rest(&mut self, resting: bool) {
        self.0.borrow_mut().push(Done::Rest(resting));
    }

    fn overlay(&self) -> Option<gpui::CompositionSurfaceId> {
        Some(gpui::CompositionSurfaceId::default())
    }
}

impl Drop for MadeScreen {
    fn drop(&mut self) {
        self.0.borrow_mut().push(Done::Closed);
    }
}

/// Fetches nothing: the tests reach no network.
struct Nowhere;

impl Fetch for Nowhere {
    fn fetch(&self, _: &str, _: usize) -> async_channel::Receiver<Fetched> {
        async_channel::bounded(1).1
    }
}

/// A shell playing through `made`, with Rin's message linking the video:
/// its index is 5.
fn with_video<'a>(
    made: &Rc<Made>,
    trusted: bool,
    cx: &'a mut TestAppContext,
) -> (Entity<Shell>, Arc<DemoEngine>, &'a mut VisualTestContext) {
    let (shell, engine, cx) = super::tests::shell(cx);
    let screens: Rc<dyn Screens> = made.clone();
    shell.update(cx, |shell, _| {
        shell.panels.embeds = Embeds::fetching_with(Arc::new(Nowhere)).playing_with(screens);
        if trusted {
            shell
                .panels
                .links
                .trusted
                .push("www.youtube.com".to_owned());
        }
    });
    let link = format!("https://youtu.be/{VIDEO}");
    engine.say_as(
        3,
        "Rin",
        Conversation::Channel(1),
        &format!(r#"<a href="{link}">watch</a>"#),
    );
    cx.run_until_parked();
    cx.run_until_parked();
    assert_eq!(shell.read_with(cx, |shell, _| shell.messages.len()), 6);
    (shell, engine, cx)
}

/// Draw a frame, and say where the player went.
fn frame(made: &Made, cx: &mut VisualTestContext) -> Option<Placement> {
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    made.last_placed()
}

#[gpui::test]
fn play_asks_before_youtube_is_reached_then_plays_on_the_card(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, false, cx);
    super::tests::click(cx, "embed-play-5");
    assert_eq!(
        made.opened(),
        0,
        "nothing of the player before the reader agrees"
    );
    assert!(cx.debug_bounds("embed-gate-5").is_some(), "the question");

    super::tests::click(cx, "embed-load-5");
    assert_eq!(made.opened(), 1);
    assert!(made.log().iter().any(|done| matches!(done,
        Done::Opened(page) if page.starts_with("https://www.youtube-nocookie.com/embed/aqz-KE-bpKQ?autoplay=1"))));
    assert_eq!(
        shell.read_with(cx, |shell, _| shell.video_playing().map(str::to_owned)),
        Some(VIDEO.to_owned())
    );

    // Laid exactly over the card's still.
    let stage = cx.debug_bounds("embed-play-5").expect("the still");
    let scale = cx.update(|window, _| window.scale_factor());
    let Some(Placement::Shown {
        frame: placed,
        shows: None,
    }) = frame(&made, cx)
    else {
        panic!("shown whole: {:?}", made.log())
    };
    let edge = |at: gpui::Pixels| (f32::from(at) * scale).round() as i32;
    assert_eq!(
        (placed.x, placed.y),
        (edge(stage.left()), edge(stage.top()))
    );
    assert_eq!(placed.x + placed.width, edge(stage.right()));
}

#[gpui::test]
fn the_video_starts_only_once_its_window_is_placed_and_seen(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    // Not trusted, so that opening it in the browser asks first.
    let (_shell, _engine, cx) = with_video(&made, false, cx);
    super::tests::click(cx, "embed-play-5");
    super::tests::click(cx, "embed-load-5");
    let started = |made: &Made| {
        made.log()
            .iter()
            .filter(|done| **done == Done::Started)
            .count()
    };
    // Every start comes after the window was placed where it is seen.
    let in_order = |log: &[Done]| {
        let shown = log
            .iter()
            .position(|done| matches!(done, Done::Placed(Placement::Shown { .. })));
        let start = log.iter().position(|done| *done == Done::Started);
        match (shown, start) {
            (_, None) => true,
            (Some(shown), Some(start)) => shown < start,
            (None, Some(_)) => false,
        }
    };
    assert!(in_order(&made.log()), "{:?}", made.log());
    let _ = frame(&made, cx);
    assert!(in_order(&made.log()), "{:?}", made.log());
    assert_eq!(started(&made), 1, "placed, it starts: {:?}", made.log());
    // Hidden and shown again, it is not asked twice.
    super::tests::click(cx, "video-browser-5");
    let _ = frame(&made, cx);
    super::tests::click(cx, "link-cancel");
    let _ = frame(&made, cx);
    assert_eq!(started(&made), 1, "{:?}", made.log());
}

#[gpui::test]
fn a_trusted_youtube_plays_at_once_and_not_twice(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (_shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    assert_eq!(made.opened(), 1);
    assert!(
        made.log().contains(&Done::Keys),
        "the keyboard stays with the client"
    );
}

#[gpui::test]
fn where_nothing_plays_in_place_the_link_is_asked_about(cx: &mut TestAppContext) {
    let made = Made::playing(false);
    let (shell, _engine, cx) = with_video(&made, false, cx);
    super::tests::click(cx, "embed-play-5");
    assert_eq!(made.opened(), 0);
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.links.asked(),
            Some(youtube::watch(VIDEO).as_str())
        );
    });
}

#[gpui::test]
fn what_floats_is_drawn_over_the_player_which_stays(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    // Not trusted, so that opening it in the browser asks first.
    let (_shell, _engine, cx) = with_video(&made, false, cx);
    let _ = super::kit::floating::tests::asked();
    let _ = frame(&made, cx);
    assert!(
        super::kit::floating::tests::asked().iter().all(Option::is_none),
        "nothing playing: drawn as everything else"
    );
    super::tests::click(cx, "embed-play-5");
    super::tests::click(cx, "embed-load-5");
    assert!(matches!(frame(&made, cx), Some(Placement::Shown { .. })));
    // The question a link asks lies over the whole window: it is drawn on
    // the player's overlay, and the player stays where it is under it.
    super::tests::click(cx, "video-browser-5");
    let _ = super::kit::floating::tests::asked();
    let placed = frame(&made, cx);
    assert!(matches!(placed, Some(Placement::Shown { .. })), "{placed:?}");
    let asked = super::kit::floating::tests::asked();
    assert!(
        !asked.is_empty() && asked.iter().all(|surface| *surface == Some(gpui::CompositionSurfaceId::default())),
        "on the overlay: {asked:?}"
    );
    super::tests::click(cx, "link-cancel");
    assert!(
        matches!(frame(&made, cx), Some(Placement::Shown { .. })),
        "still there"
    );
}

#[gpui::test]
fn a_press_in_the_client_takes_the_keyboard_back(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (_shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    let _ = frame(&made, cx);
    made.log.borrow_mut().clear();
    super::tests::click(cx, "send");
    assert!(made.log().contains(&Done::Keys), "{:?}", made.log());
}

#[gpui::test]
fn stop_leaving_and_a_long_pause_let_the_player_go(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    super::tests::click(cx, "video-stop-5");
    assert!(
        made.log().contains(&Done::Closed),
        "stopped, it is let go of"
    );
    assert!(shell.read_with(cx, |shell, _| shell.video_playing().is_none()));

    // Leaving the conversation.
    super::tests::click(cx, "embed-play-5");
    made.log.borrow_mut().clear();
    shell.update(cx, |shell, cx| {
        shell.open_conversation(Conversation::Channel(2), cx)
    });
    cx.run_until_parked();
    assert!(made.log().contains(&Done::Closed), "{:?}", made.log());
    shell.update(cx, |shell, cx| {
        shell.open_conversation(Conversation::Channel(1), cx)
    });
    cx.run_until_parked();

    // Paused: it holds less, and after five minutes it goes.
    super::tests::click(cx, "embed-play-5");
    made.log.borrow_mut().clear();
    let said = made.said.borrow().clone().expect("a page");
    said.try_send(Said::Paused).expect("heard");
    cx.run_until_parked();
    assert!(made.log().contains(&Done::Rest(true)));
    cx.executor().advance_clock(Duration::from_secs(4 * 60));
    cx.run_until_parked();
    assert!(!made.log().contains(&Done::Closed), "not yet");
    said.try_send(Said::Playing).expect("heard");
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_secs(10 * 60));
    cx.run_until_parked();
    assert!(
        !made.log().contains(&Done::Closed),
        "playing again, it stays"
    );
    said.try_send(Said::Ended).expect("heard");
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_secs(5 * 60 + 1));
    cx.run_until_parked();
    assert!(
        made.log().contains(&Done::Closed),
        "over and left: let go of"
    );
}

#[gpui::test]
fn paused_a_while_it_is_put_away_behind_the_still_and_a_press_plays_on(
    cx: &mut TestAppContext,
) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    assert!(matches!(frame(&made, cx), Some(Placement::Shown { .. })));
    let said = made.said.borrow().clone().expect("a page");
    said.try_send(Said::Paused).expect("heard");
    cx.run_until_parked();
    cx.executor().advance_clock(Duration::from_secs(5));
    assert!(
        matches!(frame(&made, cx), Some(Placement::Shown { .. })),
        "a short pause stays in sight"
    );
    cx.executor().advance_clock(Duration::from_secs(6));
    assert_eq!(frame(&made, cx), Some(Placement::Hidden), "put away");
    assert!(shell.read_with(cx, |shell, _| shell.video_playing().is_some()));
    made.log.borrow_mut().clear();
    super::tests::click(cx, "embed-play-5");
    let _ = frame(&made, cx);
    let log = made.log();
    let shown = log
        .iter()
        .position(|done| matches!(done, Done::Placed(Placement::Shown { .. })));
    let on = log.iter().position(|done| *done == Done::PlayedOn);
    assert!(
        shown.is_some() && on.is_some() && shown < on,
        "back in sight, then playing on: {log:?}"
    );
    assert_eq!(made.opened(), 0, "the same player, not a new one");
    assert!(!log.contains(&Done::Closed));
}

#[gpui::test]
fn the_wheel_over_the_player_scrolls_the_conversation_unless_enlarged(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    let top = |cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            let at = shell.rows.logical_scroll_top();
            (at.item_ix, at.offset_in_item)
        })
    };
    let before = top(cx);
    let said = made.said.borrow().clone().expect("a page");
    said.try_send(Said::Wheel(-200)).expect("heard");
    cx.run_until_parked();
    let after = top(cx);
    assert_ne!(after, before, "scrolled up");
    super::tests::click(cx, "video-enlarge-5");
    said.try_send(Said::Wheel(-200)).expect("heard");
    cx.run_until_parked();
    assert_eq!(top(cx), after, "enlarged, the conversation stays");
}

#[gpui::test]
fn enlarged_it_fills_the_window_and_escape_brings_it_back(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, true, cx);
    super::tests::click(cx, "embed-play-5");
    let card = cx.debug_bounds("embed-play-5").expect("the still");
    let scale = cx.update(|window, _| window.scale_factor());
    super::tests::click(cx, "video-enlarge-5");
    let large = cx.debug_bounds("video-large").expect("the large stage");
    let Some(Placement::Shown { frame: placed, .. }) = frame(&made, cx) else {
        panic!("shown: {:?}", made.log())
    };
    let on_card = (f32::from(card.size.width) * scale).round() as i32;
    assert!(
        large.size.width > card.size.width && placed.width > on_card,
        "{placed:?}"
    );
    shell.update(cx, Shell::dismiss);
    let Some(Placement::Shown { frame: placed, .. }) = frame(&made, cx) else {
        panic!("shown: {:?}", made.log())
    };
    assert_eq!(placed.width, on_card, "back on its card");
}

#[gpui::test]
fn a_player_that_cannot_be_made_hands_the_video_to_the_browser(cx: &mut TestAppContext) {
    let made = Made::playing(true);
    let (shell, _engine, cx) = with_video(&made, false, cx);
    super::tests::click(cx, "embed-play-5");
    super::tests::click(cx, "embed-load-5");
    let said = made.said.borrow().clone().expect("a page");
    said.try_send(Said::Failed).expect("heard");
    cx.run_until_parked();
    assert!(made.log().contains(&Done::Closed), "let go of");
    shell.read_with(cx, |shell, _| {
        assert!(shell.video_playing().is_none());
        assert_eq!(
            shell.panels.links.asked(),
            Some(youtube::watch(VIDEO).as_str()),
            "asked about, as any link is"
        );
    });
}
