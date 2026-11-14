//! A watched share's camera, its sound, and moving round it pixel for
//! pixel, on the demo engine's made-up shares.

use gpui::{
    Entity, Modifiers, ScrollDelta, ScrollWheelEvent, TestAppContext, VisualTestContext, point, px,
};

use super::Shell;
use super::tests::{click, shell};
use crate::share::{Fit, SignalKind};

/// Rin, who shares in the demo.
const RIN: u32 = 3;

/// Draw the window again until `done` says so.
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
fn a_camera_beside_a_screen_is_a_feed_of_its_own_drawn_at_its_tiles_size(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.share_with_camera(RIN);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let feeds = shell.stage_feeds();
        assert_eq!(
            feeds.iter().map(|feed| feed.camera).collect::<Vec<_>>(),
            [false, true]
        );
        assert_eq!(
            shell.stage.feeds[&RIN].tracks.len(),
            2,
            "both tracks watched"
        );
    });
    assert!(
        cx.debug_bounds("stage-strip").is_some(),
        "the camera has a tile"
    );
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].tracks[1]
            .screen
            .borrow()
            .has_picture()
    });
    let tile = cx.debug_bounds("stage-tile-1").expect("the camera's tile");
    shell.read_with(cx, |shell, _| {
        let camera = &shell.stage.feeds[&RIN].tracks[1];
        // Sent at 640 by 480, made as large as its tile is drawn (twice over
        // on the test's screen).
        assert_eq!(camera.screen.borrow().sent(), Some((640, 480)));
        let (width, _) = camera.wanted.size().expect("drawn");
        assert!(
            f32::from(tile.size.width) * 2.0 - width as f32 <= 4.0,
            "{width} for {tile:?}"
        );
        assert_eq!(camera.wanted.rate(), 5, "a tile's rate");
    });
    // Shown large in its turn: drawn at the stage's size and rate.
    click(cx, "stage-tile-1");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.large_camera, Some(RIN));
        assert!(shell.large_track().is_some_and(|track| track.mid == "1"));
    });
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].tracks[1].wanted.rate() == 30
    });
}

#[gpui::test]
fn a_camera_out_of_sight_is_not_made_until_it_is_in_sight(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // The settings page covers the conversation, and the stage with it.
    shell.update(cx, Shell::open_settings);
    engine.share_with_camera(RIN);
    cx.run_until_parked();
    std::thread::sleep(std::time::Duration::from_millis(100));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let camera = &shell.stage.feeds[&RIN].tracks[1];
        assert_eq!(camera.wanted.size(), None, "never drawn");
        assert_eq!(camera.slot.counts().0, 0, "so no frame was made");
    });
    shell.update(cx, Shell::dismiss);
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].tracks[1].slot.counts().0 > 0
    });
}

#[gpui::test]
fn a_watched_shares_sound_is_heard_as_loud_as_set_and_stops_with_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.say_share(RIN, SignalKind::Start);
    cx.run_until_parked();
    assert!(
        cx.debug_bounds("stage-mute").is_none(),
        "no sound yet: no control"
    );
    let made_up = engine.made_up();
    let tone: Vec<f32> = (0..1920).map(|at| (at as f32 * 0.01).sin() * 0.2).collect();
    made_up.sound(RIN, &tone);
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
    assert!(
        cx.debug_bounds("stage-mute").is_some(),
        "the web client's mute"
    );
    assert!(cx.debug_bounds("stage-volume").is_some(), "and its volume");
    assert_eq!(made_up.played(RIN), tone, "heard as it came");
    // At half.
    shell.update(cx, |shell, cx| shell.set_share_volume(RIN, 0.5, cx));
    made_up.sound(RIN, &tone);
    let played = made_up.played(RIN);
    assert!(
        played[1920..]
            .iter()
            .zip(&tone)
            .all(|(heard, sent)| (heard - sent * 0.5).abs() < 1e-6)
    );
    // Muted from the stage: nothing.
    click(cx, "stage-mute");
    made_up.sound(RIN, &tone);
    assert!(
        made_up.played(RIN)[3840..]
            .iter()
            .all(|sample| *sample == 0.0)
    );
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.loudness.of(RIN), (0.5, true))
    });
    // The share ends: its sound stops.
    engine.say_share(RIN, SignalKind::Stop);
    cx.run_until_parked();
    assert!(made_up.played(RIN).is_empty(), "stopped with it");
}

/// Where the large share is moved from the middle.
fn offset(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> (f32, f32) {
    shell.read_with(cx, |shell, _| shell.stage.pan.offset())
}

#[gpui::test]
fn a_share_shown_pixel_for_pixel_is_moved_by_keys_wheel_and_drag_and_never_lost(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    engine.say_share(RIN, SignalKind::Start);
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN].main().screen.borrow().has_picture()
    });
    // Whole: nothing moves.
    shell.update(cx, |shell, cx| shell.pan_by((-50.0, 0.0), cx));
    assert_eq!(offset(&shell, cx), (0.0, 0.0));
    click(cx, "stage-fit-2");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.shares.fit, Fit::Actual)
    });
    until(cx, &shell, |shell| {
        shell.stage.feeds[&RIN]
            .main()
            .screen
            .borrow()
            .laid
            .is_some()
    });
    // How far it can move each way: half of what it is larger than the
    // stage by (1920 by 1080 at half on the test's screen).
    let reach = shell.read_with(cx, |shell, _| {
        let screen = shell.stage.feeds[&RIN].main().screen.borrow();
        let (laid, room) = (screen.laid.expect("laid"), screen.room.expect("drawn"));
        (
            ((laid.width - f32::from(room.size.width)) / 2.0).max(0.0),
            ((laid.height - f32::from(room.size.height)) / 2.0).max(0.0),
        )
    });
    assert!(reach.1 > 80.0, "it is taller than the stage: {reach:?}");
    let kept = |x: f32, y: f32| (x.clamp(-reach.0, reach.0), y.clamp(-reach.1, reach.1));
    // The arrows, on the stage once Tab has given it the keyboard (a
    // click works the stage and leaves the keyboard where it was).
    for _ in 0..80 {
        cx.simulate_keystrokes("tab");
        if cx
            .update(|window, cx| super::kit::keyboard_at(window, cx))
            .as_deref()
            == Some("stage-large")
        {
            break;
        }
    }
    cx.simulate_keystrokes("right right down");
    assert_eq!(offset(&shell, cx), kept(-80.0, -40.0));
    // The wheel, as a page scrolls; with Shift, across.
    let large = cx.debug_bounds("stage-large").expect("the stage");
    cx.simulate_event(ScrollWheelEvent {
        position: large.center(),
        delta: ScrollDelta::Lines(point(0.0, 1.0)),
        modifiers: Modifiers::none(),
        ..ScrollWheelEvent::default()
    });
    assert_eq!(offset(&shell, cx), kept(-80.0, 0.0));
    cx.simulate_event(ScrollWheelEvent {
        position: large.center(),
        delta: ScrollDelta::Lines(point(0.0, 1.0)),
        modifiers: Modifiers::shift(),
        ..ScrollWheelEvent::default()
    });
    assert_eq!(offset(&shell, cx), kept(kept(-80.0, 0.0).0 + 40.0, 0.0));
    // Dragged further than it reaches: no further than the picture's edge
    // reaches the stage's.
    cx.simulate_mouse_down(large.center(), gpui::MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_move(
        large.center() + point(px(0.0), px(140.0)),
        Some(gpui::MouseButton::Left),
        Modifiers::none(),
    );
    cx.simulate_mouse_up(large.center(), gpui::MouseButton::Left, Modifiers::none());
    assert_eq!(offset(&shell, cx), reach, "kept in sight");
    // Another fit: back in the middle.
    click(cx, "stage-fit-0");
    assert_eq!(offset(&shell, cx), (0.0, 0.0));
}
