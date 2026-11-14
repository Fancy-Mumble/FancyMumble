//! The windows a share opens beside the main one: a feed popped out, and
//! the overlay of viewers' drawings over one's own shared screen, where
//! that lies only where the test says (a made-up boundary).

use gpui::{AnyWindowHandle, Bounds, Entity, TestAppContext, VisualTestContext, point, px, size};

use super::Shell;
use super::kit;
use super::tests::{click, shell};
use crate::share::SignalKind;
use crate::share::stroke::Stroke;
use crate::share::whereabouts::{Area, Lies};
use crate::store::Placed;

/// Rin, who shares in the demo.
const RIN: u32 = 3;
/// The pop-out's name, and the overlay's.
const STREAM: &str = "stream";
const OVERLAY: &str = "overlay";
/// The stage menu's entries, as they are numbered for another's share and
/// for one's own.
const POP_OUT: &str = "stage-menu-7";
const SHOW_OVERLAY: &str = "stage-menu-7";

fn aside(shell: &Entity<Shell>, name: &str, cx: &mut VisualTestContext) -> Option<AnyWindowHandle> {
    shell.read_with(cx, |shell, _| shell.chrome.asides.window(name))
}

/// Rin shares, and the stage has a frame of it.
fn rin_shares(shell: &Entity<Shell>, engine: &crate::demo::DemoEngine, cx: &mut VisualTestContext) {
    engine.say_share(RIN, SignalKind::Start);
    for _ in 0..200 {
        cx.run_until_parked();
        let pictured = shell.read_with(cx, |shell, _| {
            shell
                .stage
                .feeds
                .get(&RIN)
                .is_some_and(|watched| watched.main().screen.borrow().has_picture())
        });
        if pictured {
            return;
        }
        shell.update(cx, |_, cx| cx.notify());
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("Rin's share never came on screen");
}

/// Draw the windows again until `done` says so.
fn until(cx: &mut VisualTestContext, shell: &Entity<Shell>, done: impl Fn(&Shell) -> bool) {
    for _ in 0..200 {
        shell.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        if shell.read_with(cx, |shell, _| done(shell)) {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("it never came to be");
}

#[gpui::test]
fn a_feed_pops_out_decoded_once_for_its_window_and_comes_back(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    rin_shares(&shell, &engine, cx);
    assert_eq!(
        cx.windows().len(),
        1,
        "no window beside before one is asked for"
    );
    click(cx, "stage-more");
    click(cx, POP_OUT);
    let window = aside(&shell, STREAM, cx).expect("the feed's own window");
    assert_eq!(cx.windows().len(), 2);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.popped_feed(), Some((RIN, false)))
    });
    assert!(
        cx.debug_bounds("stage-popped").is_some(),
        "the stage says where it went"
    );
    // Drawn there, at that window's size (960 by 540, twice over on the
    // test's screen), and nowhere else: one decoding, for that window.
    let popped = VisualTestContext::from_window(window, cx).into_mut();
    assert!(popped.debug_bounds("popout").is_some());
    // The pattern stands still in a test: the next frame is asked for.
    engine.made_up().advance();
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].main().screen.borrow().has_picture()
    });
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.stage.feeds[&RIN].main().wanted.size(),
            Some((1920, 1080))
        );
    });
    // Laid otherwise there, not on the stage.
    let popped = VisualTestContext::from_window(window, cx).into_mut();
    click(popped, "popout-fit-1");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.stage.popped.map(|popped| popped.fit),
            Some(crate::share::Fit::Fill)
        );
        assert_eq!(shell.stage.shares.fit, crate::share::Fit::Whole);
    });
    // Taken back from the stage: the window closes.
    click(cx, "stage-bring-back");
    assert_eq!(cx.windows().len(), 1);
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.popped_feed(), None));
    // Back on the stage, drawn there again.
    engine.made_up().advance();
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].main().screen.borrow().has_picture()
    });
}

#[gpui::test]
fn escape_and_the_close_button_bring_it_back_and_tab_walks_its_controls(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    rin_shares(&shell, &engine, cx);
    shell.update(cx, Shell::pop_out);
    cx.run_until_parked();
    let window = aside(&shell, STREAM, cx).expect("open");
    let popped = VisualTestContext::from_window(window, cx).into_mut();
    let walked: Vec<String> = (0..6)
        .filter_map(|_| {
            popped.simulate_keystrokes("tab");
            popped.update(|window, cx| kit::keyboard_at(window, cx))
        })
        .collect();
    assert!(walked.iter().any(|at| at == "popout-close"), "{walked:?}");
    assert!(walked.iter().any(|at| at == "popout-whole"), "{walked:?}");
    // Its keys are its own: the main window's stage is not touched.
    shell.read_with(cx, |shell, _| assert!(shell.stage.popped_feed().is_some()));
    popped.simulate_keystrokes("escape");
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1, "Escape closed it");
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.popped_feed(), None));
    shell.update(cx, Shell::pop_out);
    cx.run_until_parked();
    let window = aside(&shell, STREAM, cx).expect("open again");
    click(
        VisualTestContext::from_window(window, cx).into_mut(),
        "popout-close",
    );
    assert_eq!(cx.windows().len(), 1, "its close button closed it");
}

#[gpui::test]
fn a_popped_feed_whose_share_ends_takes_its_window_and_the_main_window_takes_all(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    rin_shares(&shell, &engine, cx);
    shell.update(cx, Shell::pop_out);
    cx.run_until_parked();
    engine.say_share(RIN, SignalKind::Stop);
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1, "the share ended: its window went");
    rin_shares(&shell, &engine, cx);
    shell.update(cx, Shell::pop_out);
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 2);
    cx.update(|window, _| window.remove_window());
    cx.run_until_parked();
    assert!(
        cx.windows().is_empty(),
        "closing the main window closed the one beside it"
    );
}

#[gpui::test]
fn a_window_beside_opens_where_it_was_left(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    rin_shares(&shell, &engine, cx);
    let left = Placed {
        x: 40.0,
        y: 60.0,
        width: 800.0,
        height: 450.0,
        maximized: false,
    };
    shell.update(cx, |shell, cx| shell.aside_moved(STREAM, left, cx));
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(1));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.chrome.asides.places().get(STREAM),
            Some(&left),
            "kept to be remembered"
        );
    });
    shell.update(cx, Shell::pop_out);
    cx.run_until_parked();
    let window = aside(&shell, STREAM, cx).expect("open");
    let bounds = window
        .update(cx, |_, window, _| window.bounds())
        .expect("its bounds");
    assert_eq!(
        bounds,
        Bounds::new(point(px(40.0), px(60.0)), size(px(800.0), px(450.0)))
    );
}

/// Share the pattern's first screen from here.
fn share_own(shell: &Entity<Shell>, cx: &mut VisualTestContext) {
    click(cx, "share-screen");
    for _ in 0..100 {
        cx.run_until_parked();
        let listed = shell.read_with(cx, |shell, _| {
            shell
                .stage
                .picker
                .as_ref()
                .is_some_and(|picker| picker.sources.is_some())
        });
        if listed {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    click(cx, "share-source-0");
    click(cx, "share-confirm");
}

fn bounds_of(window: AnyWindowHandle, cx: &mut VisualTestContext) -> Bounds<gpui::Pixels> {
    window
        .update(cx, |_, window, _| window.bounds())
        .expect("open")
}

/// What the overlay shows: how many strokes.
fn overlay_shows(window: AnyWindowHandle, count: usize, cx: &mut VisualTestContext) -> bool {
    let overlay = VisualTestContext::from_window(window, cx).into_mut();
    overlay.update(|window, _| window.refresh());
    overlay.run_until_parked();
    overlay
        .debug_bounds(Box::leak(
            format!("overlay-strokes-{count}").into_boxed_str(),
        ))
        .is_some()
}

#[gpui::test]
fn the_overlay_lies_over_ones_share_follows_it_and_shows_the_viewers_strokes(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    let lies_at = |x, y| {
        Lies::At(Area {
            x,
            y,
            width: 640,
            height: 360,
        })
    };
    engine.made_up().lie(lies_at(100, 200));
    share_own(&shell, cx);
    assert_eq!(cx.windows().len(), 1, "not open before it is asked for");
    click(cx, "stage-more");
    click(cx, SHOW_OVERLAY);
    let window = aside(&shell, OVERLAY, cx).expect("the overlay");
    // On the screen's pixels, at the test screen's scale of two.
    let at = |x: f32, y: f32| Bounds::new(point(px(x), px(y)), size(px(320.0), px(180.0)));
    assert_eq!(bounds_of(window, cx), at(50.0, 100.0));
    assert!(overlay_shows(window, 0, cx));
    // A viewer draws: it shows on the overlay.
    engine.draw_on_share();
    cx.run_until_parked();
    assert!(overlay_shows(window, 2, cx), "Rin's ring and stroke");
    // The window shared moves: the overlay follows within a tick.
    engine.made_up().lie(lies_at(400, 300));
    cx.executor().advance_clock(super::stage::FOLLOW_EVERY);
    cx.run_until_parked();
    assert_eq!(bounds_of(window, cx), at(200.0, 150.0));
    // Minimized: nothing shown; back: shown again.
    engine.made_up().lie(Lies::Hidden);
    cx.executor().advance_clock(super::stage::FOLLOW_EVERY);
    assert!(overlay_shows(window, 0, cx));
    engine.made_up().lie(lies_at(400, 300));
    cx.executor().advance_clock(super::stage::FOLLOW_EVERY);
    assert!(overlay_shows(window, 2, cx));
    // The viewer clears what they drew: gone from the overlay too.
    shell.update(cx, |shell, cx| {
        shell.hear_share(
            crate::share::Heard::Stroke(Stroke {
                sender: RIN,
                channel: 1,
                id: String::new(),
                colour: 0,
                width: 0.0,
                width_frac: None,
                points: Vec::new(),
                end: true,
                clear: true,
                clear_all: false,
            }),
            cx,
        );
    });
    assert!(overlay_shows(window, 0, cx));
    // The share stops: the overlay goes with it.
    click(cx, "stage-stop");
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1);
}

#[gpui::test]
fn the_overlay_closes_when_the_window_shared_is_closed_and_is_not_opened_where_nothing_lies(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    // Nowhere: not opened, and said why.
    share_own(&shell, cx);
    shell.update(cx, Shell::toggle_overlay);
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1);
    shell.read_with(cx, |shell, _| assert!(shell.stage.notice.is_some()));
    engine.made_up().lie(Lies::At(Area {
        x: 0,
        y: 0,
        width: 200,
        height: 100,
    }));
    shell.update(cx, Shell::toggle_overlay);
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 2);
    engine.made_up().lie(Lies::Gone);
    cx.executor().advance_clock(super::stage::FOLLOW_EVERY);
    cx.run_until_parked();
    assert_eq!(cx.windows().len(), 1, "what it lay over is gone");
    assert!(aside(&shell, OVERLAY, cx).is_none());
}
