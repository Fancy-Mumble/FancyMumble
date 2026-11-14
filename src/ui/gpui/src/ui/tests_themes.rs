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
    // A guard, not a measure: the marks' paths are built once and kept, so
    // a drawn theme's frame stays within a small multiple of the default's
    // (about twice, in a debug build).
    assert!(drawn < plain * 3, "dark {plain:?}, nimbus {drawn:?}");
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
        let theme = cx.update(|_, cx| ActiveTheme::get(cx));
        let now = sizes(cx);
        if !theme.skin.marks.composer_plates {
            assert_eq!(now, plain, "{id}");
            continue;
        }
        // A theme that plates the composer sizes its tools as the web UI's
        // drawn skin does: the clip filling its 56px plate inside the
        // plate's edge, twelve pixels either side of its glyph, and Send a
        // worded plate as tall. The rest keep their size.
        assert_eq!(now[0], plain[0], "{id}: own-menu");
        assert_eq!(now[1].height, gpui::px(56.0), "{id}: send");
        let edge = f32::from(theme.skin.line_width);
        assert_eq!(
            now[2],
            gpui::size(gpui::px(40.0), gpui::px(56.0 - 2.0 * edge)),
            "{id}: attach"
        );
    }
}

/// The same sentence plain and spaced, and spaced in a box that holds it
/// only plain.
struct Spacing(f32);

impl gpui::Render for Spacing {
    fn render(&mut self, _: &mut gpui::Window, _: &mut gpui::Context<Self>) -> impl gpui::IntoElement {
        use gpui::{div, prelude::*, px};
        const SENTENCE: &str = "Speak to hear yourself";
        let line = |name: &'static str| div().flex_none().debug_selector(move || name.to_owned());
        div()
            .text_size(px(10.0))
            .line_height(px(14.0))
            .font_family("Inter")
            .child(div().flex().child(line("plain").child(SENTENCE)))
            .child(div().flex().letter_spacing(0.1).child(line("spaced").child(SENTENCE)))
            .child(
                div()
                    .w(px(self.0 + 2.0))
                    .letter_spacing(0.1)
                    .child(line("wrapped").child(SENTENCE)),
            )
    }
}

/// What the voice agent measured: in Nimbus a sentence came out narrower
/// than the browser sets it, the theme's letter spacing not applied. The
/// text style carries it now: one tenth of 10px after each of the 22
/// characters, and a line that no longer fits wraps.
#[gpui::test]
fn a_sentence_takes_the_letter_spacing_it_inherits(cx: &mut TestAppContext) {
    cx.update(|cx| {
        cx.text_system()
            .add_fonts(crate::assets::fonts())
            .expect("the bundled faces");
    });
    let (_, window) = cx.add_window_view(|_, _| Spacing(0.0));
    window.run_until_parked();
    let width = |window: &mut VisualTestContext, name: &'static str| {
        window.debug_bounds(name).expect(name).size
    };
    let plain = width(window, "plain");
    let spaced = width(window, "spaced");
    let added = f32::from(spaced.width - plain.width);
    assert!((added - 22.0).abs() < 0.5, "{plain:?} {spaced:?}");
    let (_, window) = cx.add_window_view(move |_, _| Spacing(f32::from(plain.width)));
    window.run_until_parked();
    let wrapped = width(window, "wrapped");
    assert!(wrapped.height > plain.height * 1.5, "{wrapped:?}");
}

/// A drawn theme's poster labels are set at 900 (the voice dock's name in
/// Nimbus), which the web UI's variable Inter has: the bundled faces have
/// it too, named so the system lists it as Inter's black, not the bold
/// standing in for it. (Tests lay text out with no real faces, so the face
/// itself is looked at.)
#[test]
fn inter_is_bundled_at_the_weight_poster_labels_ask_for() {
    let blacks: Vec<_> = crate::assets::fonts()
        .iter()
        .filter_map(|bytes| {
            let face = ttf_parser::Face::parse(bytes, 0).ok()?;
            let named = |id: u16| {
                face.names()
                    .into_iter()
                    .find(|name| name.name_id == id && name.is_unicode())
                    .and_then(|name| name.to_string())
            };
            (face.weight().to_number() == 900).then(|| (named(16), named(17)))
        })
        .collect();
    assert_eq!(blacks, [(Some("Inter".to_owned()), Some("Black".to_owned()))]);
}
/// What the window is held by at `x`, `y` (window pixels).
fn area_at(cx: &mut VisualTestContext, x: f32, y: f32) -> Option<gpui::WindowControlArea> {
    cx.update(|window, _| window.window_control_area_at(gpui::point(gpui::px(x), gpui::px(y))))
}

/// The user could not move the window in Nimbus: with the band went the
/// thing it was held by. A theme with no band is held, as the web UI holds
/// it, by a strip along the top edge over every column (and by the corner
/// tab's plate); what takes presses there keeps them, and a theme with a
/// band is held by the band as before.
#[gpui::test]
fn a_window_without_a_band_is_held_along_its_top(cx: &mut TestAppContext) {
    use gpui::WindowControlArea::Drag;
    let (_shell, _engine, cx) = shell(cx);
    wear("nimbus", Mode::Dark, cx);
    let strip = cx.debug_bounds("drag-strip").expect("a strip");
    let corner = cx.debug_bounds("corner-controls").expect("the corner tab");
    assert!((f32::from(strip.size.height) - 24.0).abs() < 0.5, "{strip:?}");
    // Across every column, rail, channels and conversation, up to the
    // corner tab.
    let mut x = f32::from(strip.left()) + 4.0;
    while x < f32::from(corner.left()) {
        assert_eq!(area_at(cx, x, 8.0), Some(Drag), "at {x}");
        x += 37.0;
    }
    // The tab's name holds it too.
    let name = (f32::from(corner.left()) + 30.0, f32::from(corner.center().y));
    assert_eq!(area_at(cx, name.0, name.1), Some(Drag));
    // Below the strip a control takes its own press.
    let widen = cx.debug_bounds("rail-widen").expect("the rail's expander");
    assert!(widen.top() >= strip.bottom(), "{widen:?} clears the strip");
    let (wx, wy) = (f32::from(widen.center().x), f32::from(widen.center().y));
    assert_ne!(area_at(cx, wx, wy), Some(Drag));

    wear("dark", Mode::Dark, cx);
    let band = cx.debug_bounds("band").expect("the band");
    let middle = (f32::from(band.center().x), f32::from(band.center().y));
    assert_eq!(area_at(cx, middle.0, middle.1), Some(Drag), "held by its band");
    assert_eq!(area_at(cx, middle.0, f32::from(band.bottom()) + 10.0), None);
}
