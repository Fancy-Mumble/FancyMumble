//! Screen sharing on the demo engine, whose shares show the test pattern:
//! the stage with one, two and three shares, its fit, a share ending, one's
//! own account sharing from another device, the picker, starting and
//! stopping, drawing each way, and the keyboard reaching it all.

use std::sync::Arc;

use gpui::{Entity, Modifiers, MouseButton, TestAppContext, VisualTestContext, point, px};

use super::Shell;
use super::kit;
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::engine::EngineEvent;
use crate::share::shares::Whose;
use crate::share::stroke::{self, Stroke};
use crate::share::{Fit, Heard, SignalKind};

/// Rin, Flora and Torque, who share in the demo, in that order.
const RIN: u32 = 3;
const FLORA: u32 = 2;
const TORQUE: u32 = 5;
/// The local user.
const OWN: u32 = 1;

/// Have `session` say START (or STOP) in the lounge, and let it land.
fn says(engine: &DemoEngine, session: u32, kind: SignalKind, cx: &mut VisualTestContext) {
    engine.say_share(session, kind);
    cx.run_until_parked();
}

/// Who the stage shows, in order.
fn on_stage(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Vec<(u32, Whose)> {
    shell.read_with(cx, |shell, _| {
        shell
            .shown_shares()
            .iter()
            .map(|each| (each.session, each.whose))
            .collect()
    })
}

/// The share shown large.
fn large(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Option<u32> {
    shell.read_with(cx, |shell, _| {
        let shown = shell.shown_shares();
        shell.stage.shares.focused(&shown).map(|each| each.session)
    })
}

/// Wait until `session`'s share has a frame on screen: its made-up stream
/// makes one on a thread of its own once the stage has drawn it.
#[track_caller]
fn wait_for_picture(shell: &Entity<Shell>, session: u32, cx: &mut VisualTestContext) {
    for _ in 0..200 {
        cx.run_until_parked();
        let pictured = shell.read_with(cx, |shell, _| {
            shell
                .stage
                .feeds
                .get(&session)
                .is_some_and(|watched| watched.main().screen.borrow().laid.is_some())
        });
        if pictured {
            return;
        }
        // Drawn again, so a frame that came is taken.
        shell.update(cx, |_, cx| cx.notify());
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("no frame of {session}'s share came on screen");
}

#[gpui::test]
fn a_share_in_the_channel_comes_on_the_stage_with_its_live_mark(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("stage").is_none(), "nobody shares");
    assert!(cx.debug_bounds("live-badge").is_none());
    says(&engine, RIN, SignalKind::Start, cx);
    assert_eq!(on_stage(&shell, cx), [(RIN, Whose::Theirs)]);
    assert!(cx.debug_bounds("stage").is_some());
    assert!(cx.debug_bounds("stage-caption").is_some());
    assert!(cx.debug_bounds("live-badge").is_some(), "on Rin's row");
    assert!(cx.debug_bounds("stage-strip").is_none(), "one share: no strip");
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.feeds.contains_key(&RIN), "watched at once");
    });
    wait_for_picture(&shell, RIN, cx);
    // The next frame goes into the picture already on screen.
    let drawn = |cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| shell.stage.feeds[&RIN].main().screen.borrow().drawn)
    };
    let before = drawn(cx);
    engine.made_up().advance();
    for _ in 0..200 {
        shell.update(cx, |_, cx| cx.notify());
        cx.run_until_parked();
        if drawn(cx) > before {
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(10));
    }
    panic!("the next frame never came");
}

#[gpui::test]
fn several_share_at_once_one_large_and_the_others_in_the_strip(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    says(&engine, FLORA, SignalKind::Start, cx);
    assert!(cx.debug_bounds("stage-strip").is_some(), "two: a strip");
    says(&engine, TORQUE, SignalKind::Start, cx);
    assert_eq!(
        on_stage(&shell, cx),
        [(RIN, Whose::Theirs), (FLORA, Whose::Theirs), (TORQUE, Whose::Theirs)]
    );
    assert_eq!(large(&shell, cx), Some(RIN), "the first, until another is picked");
    for tile in ["stage-tile-0", "stage-tile-1", "stage-tile-2"] {
        assert!(cx.debug_bounds(tile).is_some(), "{tile}");
    }
    click(cx, "stage-tile-2");
    assert_eq!(large(&shell, cx), Some(TORQUE));
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.feeds.len(), 3, "all three watched"));
    // The one shown large ends: the first is large again.
    says(&engine, TORQUE, SignalKind::Stop, cx);
    assert_eq!(large(&shell, cx), Some(RIN));
    shell.read_with(cx, |shell, _| {
        assert!(!shell.stage.feeds.contains_key(&TORQUE), "no longer watched");
    });
}

#[gpui::test]
fn a_share_that_ends_leaves_the_stage_and_takes_its_drawings(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    engine.draw_on_share();
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.strokes.of(1).count(), 2));
    says(&engine, RIN, SignalKind::Stop, cx);
    assert!(on_stage(&shell, cx).is_empty());
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.feeds.is_empty());
        assert_eq!(shell.stage.shares.strokes.of(1).count(), 0, "Rin's strokes went with it");
    });
}

#[gpui::test]
fn a_sharer_who_leaves_the_channel_leaves_the_stage(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    crate::engine::Engine::act(
        engine.as_ref(),
        crate::engine::Action::MoveUser {
            session: RIN,
            channel: 2,
        },
    );
    cx.run_until_parked();
    assert!(on_stage(&shell, cx).is_empty(), "not in the user's channel");
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.feeds.is_empty());
        assert!(shell.stage.shares.is_live(RIN, Some(OWN)), "still sharing, elsewhere");
    });
}

#[gpui::test]
fn the_fit_is_chosen_on_the_stage_and_in_its_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    click(cx, "stage-fit-1");
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.fit, Fit::Fill));
    click(cx, "stage-more");
    assert!(cx.debug_bounds("stage-menu-backdrop").is_some());
    click(cx, "stage-menu-2");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.shares.fit, Fit::Actual);
        assert!(shell.stage.menu.is_none(), "taken: put away");
    });
    click(cx, "stage-fit-0");
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.fit, Fit::Whole));
}

#[gpui::test]
fn the_stage_goes_over_the_whole_window_and_escape_brings_it_back(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    click(cx, "stage-whole");
    shell.read_with(cx, |shell, _| assert!(shell.stage.expanded));
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(!shell.stage.expanded));
}

#[gpui::test]
fn ones_own_account_sharing_from_another_device_is_shown_as_ones_own(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Starling names a sibling device's share as this device's own session.
    engine.share_from_elsewhere();
    cx.run_until_parked();
    assert_eq!(on_stage(&shell, cx), [(OWN, Whose::MineElsewhere)]);
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.feeds.contains_key(&OWN), "it can be watched");
        assert!(!shell.stage.sharing(), "it is not this device's");
    });
    assert!(cx.debug_bounds("stage-stop").is_none(), "not stopped from here");
    // Nor is a second share started here while it runs.
    click(cx, "share-screen");
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.picker.is_none());
        assert!(
            shell
                .stage
                .notice
                .as_ref()
                .is_some_and(|notice| notice.contains("another device")),
            "{:?}",
            shell.stage.notice
        );
    });
    assert!(engine.made_up().said().is_empty(), "nothing said for it");
    // The sharing device stops, or leaves: Starling tells this one so.
    says(&engine, OWN, SignalKind::Stop, cx);
    assert!(on_stage(&shell, cx).is_empty());
}

/// Open the picker and wait for what it offers.
fn open_picker(shell: &Entity<Shell>, cx: &mut VisualTestContext) {
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
            return;
        }
        std::thread::sleep(std::time::Duration::from_millis(5));
    }
    panic!("the picker listed nothing");
}

#[gpui::test]
fn a_screen_is_picked_shared_and_stopped(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    open_picker(&shell, cx);
    assert!(cx.debug_bounds("share-picker").is_some());
    shell.read_with(cx, |shell, _| {
        let picker = shell.stage.picker.as_ref().expect("open");
        assert!(picker.made_up, "the pattern, not this computer's screens");
        assert_eq!(picker.sources.as_ref().and_then(|s| s.as_ref().ok()).map(Vec::len), Some(4));
    });
    click(cx, "share-source-1");
    click(cx, "share-quality-0");
    click(cx, "share-confirm");
    let made_up = engine.made_up();
    assert_eq!(
        made_up.said(),
        [(
            SignalKind::Start,
            r#"{"v":1,"tracks":[{"mid":"0","content":"screen"}]}"#.to_owned()
        )],
        "the web client's START, before anything else"
    );
    let started = made_up.started();
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].sources[0].id, 2, "the second screen");
    assert_eq!(started[0].settings.quality, crate::share::Quality::SD);
    assert_eq!(on_stage(&shell, cx), [(OWN, Whose::Mine)], "its own preview");
    assert!(cx.debug_bounds("live-badge").is_some(), "on the user's own row");
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.sharing());
        assert!(shell.stage.picker.is_none());
    });
    click(cx, "stage-stop");
    assert_eq!(made_up.said().last().map(|said| said.0), Some(SignalKind::Stop));
    assert!(on_stage(&shell, cx).is_empty());
    shell.read_with(cx, |shell, _| assert!(!shell.stage.sharing()));
}

#[gpui::test]
fn the_picker_takes_a_window_and_a_camera_together_and_its_stream_mode(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    open_picker(&shell, cx);
    click(cx, "share-tab-1");
    click(cx, "share-source-0");
    click(cx, "share-tab-2");
    click(cx, "share-source-0");
    assert!(cx.debug_bounds("share-chosen").is_some());
    click(cx, "share-mode");
    click(cx, "share-preset-1");
    shell.read_with(cx, |shell, _| {
        let picker = shell.stage.picker.as_ref().expect("open");
        assert_eq!(picker.picked().len(), 2);
        assert_eq!(picker.settings.quality, crate::share::Quality::TEXT);
    });
    click(cx, "share-rate-1");
    click(cx, "share-confirm");
    let said = engine.made_up().said();
    assert_eq!(
        said[0].1, r#"{"v":1,"tracks":[{"mid":"0","content":"screen"},{"mid":"1","content":"camera"}]}"#,
        "the window first, then the camera"
    );
    let started = engine.made_up().started();
    assert_eq!(started[0].settings.quality.fps, 30);
}

#[gpui::test]
fn the_picker_is_put_away_by_cancel_and_by_escape(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    open_picker(&shell, cx);
    click(cx, "share-cancel");
    shell.read_with(cx, |shell, _| assert!(shell.stage.picker.is_none()));
    open_picker(&shell, cx);
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(shell.stage.picker.is_none()));
}

#[gpui::test]
fn a_server_that_relays_no_shares_is_said_to_before_anything_is_shared(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.made_up().set_relays(false);
    click(cx, "share-screen");
    shell.read_with(cx, |shell, _| {
        assert!(shell.stage.picker.is_none());
        assert!(shell.stage.notice.is_some());
    });
    assert!(cx.debug_bounds("stage-notice").is_some());
    click(cx, "stage-notice-dismiss");
    shell.read_with(cx, |shell, _| assert!(shell.stage.notice.is_none()));
}

/// Press, drag across and let go over the middle of the large share.
fn draw_across(cx: &mut VisualTestContext) {
    let bounds = cx.debug_bounds("stage-large").expect("the large share");
    let middle = bounds.center();
    cx.simulate_mouse_down(middle, MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_move(
        point(middle.x + px(20.0), middle.y),
        Some(MouseButton::Left),
        Modifiers::none(),
    );
    cx.simulate_mouse_move(
        point(middle.x + px(40.0), middle.y + px(10.0)),
        Some(MouseButton::Left),
        Modifiers::none(),
    );
    cx.simulate_mouse_up(point(middle.x + px(40.0), middle.y + px(10.0)), MouseButton::Left, Modifiers::none());
    cx.run_until_parked();
}

#[gpui::test]
fn a_viewer_draws_on_a_share_and_it_goes_out_as_the_web_client_sends_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    wait_for_picture(&shell, RIN, cx);
    click(cx, "stage-draw");
    assert!(cx.debug_bounds("draw-tools").is_some());
    click(cx, "draw-colour-2");
    draw_across(cx);
    let drawn = engine.made_up().drawn();
    let last = drawn.last().expect("sent");
    assert!(last.end, "the stroke's end went out");
    assert_eq!((last.sender, last.channel, last.colour), (OWN, 1, stroke::COLOURS[2]));
    let all: Vec<f32> = drawn.iter().flat_map(|packet| packet.points.clone()).collect();
    // Where it began, two moves, and where the pen came up, as the web
    // client sends a stroke: x and y each.
    assert_eq!(all.len(), 8);
    assert!(all.iter().all(|at| (0.0..=1.0).contains(at)), "fractions of the picture");
    assert!((all[0] - 0.5).abs() < 0.05 && (all[1] - 0.5).abs() < 0.05, "began in the middle");
    assert!(last.width_frac.is_some_and(|frac| frac > 0.0));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.stage.shares.strokes.of(1).count(), 1, "kept here too");
    });
    // Clearing one's own, as a viewer: not everybody's.
    click(cx, "draw-clear");
    let clear = engine.made_up().drawn().last().cloned().expect("sent");
    assert!(clear.clear && !clear.clear_all);
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.strokes.of(1).count(), 0));
    click(cx, "stage-draw");
    assert!(shell.read_with(cx, |shell, _| shell.stage.drawing.is_empty()));
}

/// A stroke `sender` drew, whole.
fn stroke_by(sender: u32, id: &str) -> Stroke {
    Stroke {
        sender,
        channel: 1,
        id: id.to_owned(),
        colour: stroke::COLOURS[1],
        width: 4.0,
        width_frac: Some(0.01),
        points: vec![0.2, 0.2, 0.4, 0.3],
        end: true,
        clear: false,
        clear_all: false,
    }
}

#[gpui::test]
fn the_sharer_sees_what_viewers_draw_and_only_the_sharer_clears_it_all(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    open_picker(&shell, cx);
    click(cx, "share-source-0");
    click(cx, "share-confirm");
    // Two viewers draw on the user's share.
    for (sender, id) in [(RIN, "a"), (FLORA, "b")] {
        engine.emit(EngineEvent::Share(Heard::Stroke(stroke_by(sender, id))));
    }
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.strokes.of(1).count(), 2));
    // A viewer's "clear all" clears only their own.
    engine.emit(EngineEvent::Share(Heard::Stroke(stroke::clearing(RIN, 1, true))));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.strokes.of(1).count(), 1));
    // The sharer's clears everybody's, here and for the channel.
    click(cx, "stage-draw");
    click(cx, "draw-clear");
    let clear = engine.made_up().drawn().last().cloned().expect("sent");
    assert!(clear.clear && clear.clear_all, "the sharer's clear is everybody's");
    shell.read_with(cx, |shell, _| assert_eq!(shell.stage.shares.strokes.of(1).count(), 0));
}

#[gpui::test]
fn the_statistics_open_from_the_menu_and_close(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    click(cx, "stage-more");
    click(cx, "stage-menu-6");
    shell.read_with(cx, |shell, _| assert!(shell.stage.stats_open));
    assert!(cx.debug_bounds("stage-stats").is_some());
    click(cx, "stage-stats-close");
    shell.read_with(cx, |shell, _| assert!(!shell.stage.stats_open));
}

#[gpui::test]
fn a_frame_is_copied_to_the_clipboard(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    wait_for_picture(&shell, RIN, cx);
    click(cx, "stage-copy");
    let copied = cx.read_from_clipboard().expect("something on the clipboard");
    let image = copied.entries().iter().find_map(|entry| match entry {
        gpui::ClipboardEntry::Image(image) => Some(image.clone()),
        _ => None,
    });
    let image = image.expect("a picture");
    assert_eq!(image.format(), gpui::ImageFormat::Png);
    let decoded = image::load_from_memory(image.bytes()).expect("a PNG").to_rgba8();
    let pattern = crate::share::pattern::Pattern::new(decoded.width(), decoded.height());
    assert!(pattern.read(decoded.as_raw()).is_some(), "the pattern, read back");
    let _ = Arc::clone(&engine);
}

#[gpui::test]
fn the_keyboard_reaches_every_control_of_the_stage_and_the_picker(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    says(&engine, RIN, SignalKind::Start, cx);
    says(&engine, FLORA, SignalKind::Start, cx);
    let reached = walk(cx, 200);
    for control in ["stage-fit-0", "stage-fit-1", "stage-fit-2", "stage-copy", "stage-draw", "stage-more", "stage-whole", "share-screen"] {
        assert!(reached.iter().any(|at| at == control), "Tab never reached {control}: {reached:?}");
    }
    click(cx, "stage-draw");
    let reached = walk(cx, 200);
    for control in ["draw-colour-0", "draw-colour-6", "draw-width", "draw-clear"] {
        assert!(reached.iter().any(|at| at == control), "Tab never reached {control}");
    }
    click(cx, "stage-draw");
    says(&engine, RIN, SignalKind::Stop, cx);
    says(&engine, FLORA, SignalKind::Stop, cx);
    open_picker(&shell, cx);
    click(cx, "share-mode");
    let reached = walk(cx, 60);
    for control in [
        "share-tab-0", "share-tab-2", "share-source-0", "share-quality-1", "share-mode", "share-preset-0",
        "share-size-3", "share-rate-2", "share-audio", "share-cancel", "share-confirm",
    ] {
        assert!(reached.iter().any(|at| at == control), "Tab never reached {control}: {reached:?}");
    }
}

/// Press Tab `times` times, and say where the keyboard was each time.
fn walk(cx: &mut VisualTestContext, times: usize) -> Vec<String> {
    (0..times)
        .filter_map(|_| {
            cx.simulate_keystrokes("tab");
            cx.update(|window, cx| kit::keyboard_at(window, cx))
        })
        .collect()
}
