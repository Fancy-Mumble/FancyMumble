//! The shell, driven the way a person drives it: clicks and keys against a
//! window that exists only in memory.

use std::sync::Arc;

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use crate::demo::DemoEngine;
use crate::engine::Engine;
use crate::theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};

/// A shell on a fresh demo server, in the default theme.
fn shell(cx: &mut TestAppContext) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    cx.update(|cx| {
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let engine = Arc::new(DemoEngine::new());
    let for_shell: Arc<dyn Engine> = engine.clone();
    let (shell, cx) = cx.add_window_view(|_, cx| Shell::new(for_shell, cx));
    cx.run_until_parked();
    (shell, engine, cx)
}

/// Click the middle of the element tagged `selector`.
#[track_caller]
fn click(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("nothing on screen is tagged `{selector}`"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    cx.run_until_parked();
}

#[gpui::test]
fn opens_on_the_current_channel_and_its_history(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.current_channel_name(), Some("lounge"));
        assert_eq!(shell.messages.len(), 5);
        assert_eq!(shell.rows.item_count(), 6, "five messages under a day rule");
        assert_eq!(shell.composer.read(cx).placeholder(), "Message #lounge");
    });
}

#[gpui::test]
fn clicking_a_channel_joins_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "channel-2");
    assert_eq!(engine.snapshot().current_channel, Some(2));
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.current_channel_name(), Some("studio"));
        assert!(shell.messages.is_empty(), "the studio has no history");
        assert_eq!(shell.rows.item_count(), 0);
        assert_eq!(shell.composer.read(cx).placeholder(), "Message #studio");
    });
}

#[gpui::test]
fn typing_and_enter_sends_a_message_and_empties_the_composer(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i space t h e r e enter");
    let sent = engine.messages(1);
    assert_eq!(sent.len(), 6);
    assert_eq!(sent[5].body.as_ref(), "hi there");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.messages.len(), 6, "the conversation shows it");
        assert_eq!(shell.rows.item_count(), 7);
        assert_eq!(shell.composer.read(cx).text(), "");
    });
}

#[gpui::test]
fn keys_go_to_the_field_that_was_clicked(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Search channels");
    cx.simulate_keystrokes("s t u");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.search.read(cx).text(), "stu");
        assert_eq!(shell.composer.read(cx).text(), "");
    });
    // The list is narrowed to what matches.
    shell.read_with(cx, |shell, cx| {
        let listed: Vec<_> = shell
            .listed_channels(cx)
            .iter()
            .map(|channel| channel.name.as_ref())
            .collect();
        assert_eq!(listed, ["studio"]);
    });
    // Enter in the search field sends nothing.
    cx.simulate_keystrokes("enter");
    assert_eq!(engine.messages(1).len(), 5);
}

#[gpui::test]
fn the_voice_buttons_mute_and_deafen(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    let own = |engine: &DemoEngine| {
        let snapshot = engine.snapshot();
        let own = snapshot.own_session;
        snapshot
            .users
            .into_iter()
            .find(|user| Some(user.session) == own)
            .expect("the local user")
    };
    assert!(own(&engine).self_mute, "the demo starts muted");
    click(cx, "mute");
    assert!(!own(&engine).self_mute);
    click(cx, "deafen");
    assert!(own(&engine).self_deaf && own(&engine).self_mute);
    click(cx, "deafen");
    assert!(!own(&engine).self_deaf);
}

#[gpui::test]
fn the_picker_opens_switches_theme_and_mode(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, _| {
        assert!(!shell.picker_open, "closed at first")
    });
    click(cx, "themes");
    shell.read_with(cx, |shell, _| assert!(shell.picker_open));
    click(cx, "theme-rose");
    cx.update(|_, cx| {
        let theme = ActiveTheme::get(cx);
        assert_eq!(theme.id.as_ref(), "rose");
        assert_eq!(theme.mode, Mode::Dark, "the mode is kept");
    });
    click(cx, "mode");
    cx.update(|_, cx| {
        let theme = ActiveTheme::get(cx);
        assert_eq!(theme.id.as_ref(), "rose", "the theme is kept");
        assert_eq!(theme.mode, Mode::Light);
    });
    click(cx, "themes");
    shell.read_with(cx, |shell, _| assert!(!shell.picker_open));
}

#[gpui::test]
fn a_talking_user_is_tracked_until_they_stop(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.talk(3, true);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.talking.contains(&3)));
    engine.talk(3, false);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.talking.is_empty()));
}

/// Layout and paint run for all twenty-six without a panic. What they look
/// like is checked by eye, from screenshots.
#[gpui::test]
fn every_theme_draws_in_both_modes(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    for entry in Catalog::get().entries(Mode::Dark) {
        for mode in [Mode::Light, Mode::Dark] {
            cx.update(|_, cx| ActiveTheme::set(&entry.id, mode, cx));
            cx.run_until_parked();
            cx.update(|_, cx| {
                let theme = ActiveTheme::get(cx);
                assert_eq!((theme.id.as_ref(), theme.mode), (entry.id.as_ref(), mode));
            });
        }
    }
}
