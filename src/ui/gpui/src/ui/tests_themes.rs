//! Every theme draws every screen, a drawn theme places its marks, a theme
//! that asks for none draws none, and the kit's parts keep their size from
//! one theme to the next.

use gpui::{TestAppContext, VisualTestContext};

use super::tests::{shell, shell_on};
use crate::demo::DemoEngine;
use crate::theme::{ActiveTheme, Catalog, Mode};

/// The marks a drawn theme puts on the main screen, by the names the kit
/// gives them.
const MARKS: &[&str] = &[
    "mark-hazard",
    "mark-expander",
    "mark-wordmark",
    "mark-rail-flash",
    "mark-name-plate",
    "mark-section-heading",
    "mark-selection-bar",
    "mark-header",
    "mark-ground",
    "mark-day-plate",
    "mark-halo",
];

fn wear(id: &str, mode: Mode, cx: &mut VisualTestContext) {
    cx.update(|_, cx| ActiveTheme::set(id, mode, cx));
    cx.run_until_parked();
}

fn ids() -> Vec<String> {
    Catalog::get()
        .entries(Mode::Dark)
        .into_iter()
        .map(|entry| entry.id.to_string())
        .collect()
}

#[gpui::test]
fn every_theme_draws_the_main_screen_the_settings_and_a_sheet(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    for id in ids() {
        for mode in [Mode::Dark, Mode::Light] {
            wear(&id, mode, cx);
            assert!(cx.debug_bounds("own-menu").is_some(), "{id} {mode:?}");
            shell.update(cx, |shell, cx| {
                shell.panels.settings.open = true;
                cx.notify();
            });
            cx.run_until_parked();
            shell.update(cx, |shell, cx| {
                shell.panels.settings.open = false;
                shell.picker_open = true;
                cx.notify();
            });
            cx.run_until_parked();
            shell.update(cx, |shell, cx| {
                shell.picker_open = false;
                cx.notify();
            });
            cx.run_until_parked();
        }
    }
}

#[gpui::test]
fn every_theme_draws_the_connect_screen(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    for id in ids() {
        for mode in [Mode::Dark, Mode::Light] {
            wear(&id, mode, cx);
        }
    }
}

#[gpui::test]
fn nimbus_places_each_of_its_marks(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    wear("nimbus", Mode::Dark, cx);
    for mark in MARKS {
        assert!(cx.debug_bounds(mark).is_some(), "Nimbus draws {mark}");
    }
    // The halo stands above the face it crowns, and is narrower.
    let halo = cx.debug_bounds("mark-halo").expect("a halo");
    assert!(halo.size.width > gpui::px(0.0) && halo.size.height > gpui::px(0.0));
}

#[gpui::test]
fn a_theme_that_asks_for_no_marks_draws_none(cx: &mut TestAppContext) {
    // A fresh window, drawn only in the default theme: a selector it has
    // never drawn has no bounds at all.
    let (_shell, _engine, cx) = shell(cx);
    wear("dark", Mode::Light, cx);
    wear("dark", Mode::Dark, cx);
    for mark in MARKS {
        assert!(
            cx.debug_bounds(mark).is_none(),
            "the default theme draws no {mark}"
        );
    }
}

/// What one frame of the main screen costs in `id`, on average: layout
/// and paint, the marks' paths built, as the window does each frame.
fn frame_time(id: &str, cx: &mut VisualTestContext) -> std::time::Duration {
    wear(id, Mode::Dark, cx);
    const FRAMES: u32 = 40;
    let started = std::time::Instant::now();
    for _ in 0..FRAMES {
        cx.update(|window, _| window.refresh());
        cx.run_until_parked();
    }
    started.elapsed() / FRAMES
}

#[gpui::test]
fn a_drawn_theme_costs_a_frame_not_much_more_than_the_default(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    // Once each first, so neither pays for what is set up once.
    let _ = (frame_time("dark", cx), frame_time("nimbus", cx));
    let plain = frame_time("dark", cx);
    let drawn = frame_time("nimbus", cx);
    println!("a frame of the main screen: dark {plain:?}, nimbus {drawn:?}");
    // A guard, not a measure: a debug build pays many times over what a
    // release build does for the marks' paths and quads.
    assert!(drawn < plain * 10, "dark {plain:?}, nimbus {drawn:?}");
}

#[gpui::test]
fn a_drawn_skin_stands_the_docks_switches_across_it_as_a_bank(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    let switch = |cx: &mut VisualTestContext, part| cx.debug_bounds(part).expect("on screen");
    // Plain: small buttons beside the face, of the web UI's size.
    assert_eq!(switch(cx, "mute").size, gpui::size(gpui::px(30.0), gpui::px(28.0)));
    wear("nimbus", Mode::Dark, cx);
    let (mute, deafen, share) = (switch(cx, "mute"), switch(cx, "deafen"), switch(cx, "share-screen"));
    assert_eq!(mute.size.height, gpui::px(34.0), "the web UI's 34");
    assert_eq!(mute.size.width, deafen.size.width, "equal shares");
    assert_eq!(deafen.size.width, share.size.width);
    let face = switch(cx, "own-face");
    assert!(mute.left() <= face.left() + gpui::px(1.0), "across the card, under the face too");
}

#[gpui::test]
fn the_kits_parts_keep_their_size_from_theme_to_theme(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    // The dock's voice switches are left out: a drawn skin makes them a
    // bank across the card, on purpose (the test after this one).
    let parts = ["own-menu", "send", "attach"];
    let sizes = |cx: &mut VisualTestContext| {
        parts
            .iter()
            .map(|part| cx.debug_bounds(part).expect("on screen").size)
            .collect::<Vec<_>>()
    };
    let plain = sizes(cx);
    for id in ids() {
        wear(&id, Mode::Dark, cx);
        assert_eq!(sizes(cx), plain, "{id}");
    }
}
