//! The settings as the web UI builds them: the column of pages beside the
//! rail, each page from the kit's controls, the search over them, every
//! setting kept for the next start, and every control reached from the
//! keyboard.

use gpui::{KeyUpEvent, Keystroke, TestAppContext, VisualTestContext};

use super::settings::Page;
use super::tests::{click, shell};
use super::{Panels, Shell, kit};
use crate::engine::Engine as _;
use crate::store::{Hours, Store, TextSize};
use crate::theme::{ActiveTheme, Mode};

/// A data directory of the test's own, emptied.
fn data_dir(name: &str) -> std::path::PathBuf {
    let dir =
        std::env::temp_dir().join(format!("fancy-gpui-settings-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// The settings open, with what they keep written to `dir`.
fn open_keeping<'a>(
    dir: &std::path::Path,
    cx: &'a mut TestAppContext,
) -> (
    gpui::Entity<Shell>,
    std::sync::Arc<crate::demo::DemoEngine>,
    &'a mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.store = Some(Store::new(dir)));
    cx.simulate_keystrokes("ctrl-,");
    (shell, engine, cx)
}

/// Scroll the open page of the settings to its foot.
pub(super) fn scroll_to_foot(shell: &gpui::Entity<Shell>, cx: &mut VisualTestContext) {
    shell.update(cx, |shell, cx| {
        if let Some(search) = &shell.panels.settings.search {
            search
                .scroll
                .set_offset(gpui::point(gpui::px(0.0), gpui::px(-4000.0)));
        }
        cx.notify();
    });
    cx.run_until_parked();
}

/// The id of the control that has the keyboard.
fn at(cx: &mut VisualTestContext) -> Option<String> {
    cx.update(|window, cx| kit::keyboard_at(window, cx))
}

/// Type `text` into whatever field has the keyboard.
fn type_in(cx: &mut VisualTestContext, text: &str) {
    for c in text.chars() {
        cx.simulate_input(&c.to_string());
    }
    cx.run_until_parked();
}

#[gpui::test]
fn the_column_lists_the_web_uis_pages_in_its_order_and_each_opens(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    // Beside the rail, as the channel column is on the main screen.
    let rail = cx.update(|_, cx| ActiveTheme::get(cx).skin.rail_width);
    let back = cx.debug_bounds("settings-close").expect("the way back");
    assert!(back.left() >= rail, "the column is right of the rail");
    let mut above = back.bottom();
    for page in Page::ALL {
        let selector: &'static str = Box::leak(format!("settings-{}", page.id()).into_boxed_str());
        let entry = cx.debug_bounds(selector).expect("an entry for every page");
        assert!(
            entry.top() >= above,
            "{selector} comes after the one before"
        );
        above = entry.bottom();
        click(cx, selector);
        shell.read_with(cx, |shell, _| assert_eq!(shell.panels.settings.page, page));
        assert!(cx.debug_bounds("page-title").is_some());
    }
    // Back is where it came from.
    click(cx, "settings-close");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));
    assert!(cx.debug_bounds("input-Message #lounge").is_some());
}

#[gpui::test]
fn personalize_sets_the_theme_its_mode_the_text_and_keeps_them(cx: &mut TestAppContext) {
    let dir = data_dir("personalize");
    let (shell, _engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-personalize");
    click(cx, "theme-rose");
    click(cx, "mode-1");
    click(cx, "text-size-0");
    cx.update(|_, cx| {
        let theme = ActiveTheme::get(cx);
        assert_eq!((theme.id.as_ref(), theme.mode), ("rose", Mode::Light));
    });
    // The picture behind the conversation: as blurred as it goes, and
    // shown whole. Its bars are at the foot of the page.
    scroll_to_foot(&shell, cx);
    for (bar, end) in [("wall-blur", true), ("wall-opacity", true)] {
        let bounds = cx.debug_bounds(bar).expect("the bar");
        let x = if end {
            bounds.right() - gpui::px(1.0)
        } else {
            bounds.left()
        };
        cx.simulate_click(gpui::point(x, bounds.center().y), gpui::Modifiers::none());
    }
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.format.text, TextSize::Small);
        assert_eq!(shell.chrome.wall_blur, 40);
        assert!(shell.chrome.wall_wash < 0.01);
    });
    // Following the system is a choice of its own.
    click(cx, "mode-0");
    shell.read_with(cx, |shell, _| assert!(shell.follows_system()));
    let kept = Store::new(&dir).settings();
    assert_eq!(kept.theme.as_deref(), Some("rose"));
    assert_eq!(kept.mode.as_deref(), Some(crate::theme::SYSTEM));
    assert_eq!(kept.wall_blur, Some(40));
    assert_eq!(Panels::keeping(&kept).settings.format.text, TextSize::Small);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn voice_sets_the_devices_the_mode_and_what_is_done_to_the_voice(cx: &mut TestAppContext) {
    let dir = data_dir("voice");
    let (shell, engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-voice");
    // A device from its dropdown.
    click(cx, "input-device");
    click(cx, "input-device-2");
    assert_eq!(
        engine.chosen_devices().input.as_deref().map(AsRef::as_ref),
        Some("USB Headset")
    );
    // Continuous has no gate to set; voice activation has.
    click(cx, "activation-1");
    assert_eq!(engine.voice_settings().threshold, 0.0);
    click(cx, "activation-0");
    assert!(engine.voice_settings().threshold > 0.0);
    // The gate's opening level, set on its meter: a press near its loud
    // end takes the open marker there.
    let meter = cx.debug_bounds("gate-meter").expect("the gate's meter");
    let near_the_end = gpui::point(meter.right() - gpui::px(4.0), meter.top() + gpui::px(27.0));
    cx.simulate_click(near_the_end, gpui::Modifiers::none());
    cx.run_until_parked();
    assert!(engine.voice_settings().threshold > 0.5, "{}", engine.voice_settings().threshold);
    click(cx, "activation-2");
    assert!(engine.voice_settings().push_to_talk);
    click(cx, "automatic-gain");
    click(cx, "noise-suppression-0");
    click(cx, "voice-over-tcp");
    let voice = engine.voice_settings();
    assert!(!voice.automatic_gain && !voice.noise_suppression && voice.voice_over_tcp);
    // Voice is turned on from the page's title.
    click(cx, "voice-power");
    shell.read_with(cx, |shell, _| {
        assert_ne!(shell.snapshot.voice, crate::engine::Voice::Off);
    });
    let kept = Store::new(&dir).settings();
    assert_eq!(kept.voice, Some(voice));
    assert_eq!(kept.input_device.as_deref(), Some("USB Headset"));
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn notifications_hear_all_or_none_and_each_its_own_sound(cx: &mut TestAppContext) {
    use crate::sounds::Event;
    let dir = data_dir("notifications");
    let (shell, _engine, cx) = open_keeping(&dir, cx);
    // Which sound each plays is an expert's to choose.
    shell.update(cx, |shell, _| shell.panels.settings.user_mode = crate::store::UserMode::Expert);
    click(cx, "settings-notifications");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.sounds.on));
    click(cx, "sounds-on");
    click(cx, "sounds-none");
    shell.read_with(cx, |shell, _| {
        let sounds = &shell.panels.settings.sounds;
        assert!(Event::ALL.iter().all(|event| !sounds.of(*event).enabled));
    });
    click(cx, "sounds-all");
    click(cx, "sound-mention-sound");
    click(cx, "sound-mention-sound-1");
    shell.read_with(cx, |shell, _| {
        let (sound, _) = shell
            .panels
            .settings
            .sounds
            .heard(Event::Mention)
            .expect("heard");
        assert_eq!(sound.name, "Chime");
    });
    let kept = Store::new(&dir).settings();
    assert!(kept.sounds.on);
    assert_eq!(kept.sounds.of(Event::Mention).sound, "dragon-3");
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn privacy_keeps_reading_writing_and_links_to_oneself(cx: &mut TestAppContext) {
    let dir = data_dir("privacy");
    let (_shell, _engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-privacy");
    click(cx, "tell-reading");
    click(cx, "tell-writing");
    click(cx, "look-behind-links");
    let kept = Store::new(&dir).settings().privacy;
    assert!(kept.hide_reading && kept.hide_writing && kept.leave_links);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_clock_and_reconnecting_are_kept(cx: &mut TestAppContext) {
    let dir = data_dir("format");
    let (_shell, _engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-localization");
    click(cx, "hours-2");
    click(cx, "settings-advanced");
    click(cx, "reconnect");
    let kept = Store::new(&dir).settings();
    assert_eq!(kept.format.hours, Hours::TwentyFour);
    assert!(kept.stay_disconnected);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn shortcuts_take_the_next_key_and_clear_it(cx: &mut TestAppContext) {
    let dir = data_dir("shortcuts");
    let (shell, _engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-shortcuts");
    click(cx, "push-to-talk-key");
    shell.read_with(cx, |shell, _| assert!(shell.ptt.choosing));
    cx.simulate_keystrokes("f9");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.ptt.key.as_ref().map(AsRef::as_ref), Some("f9"));
    });
    assert_eq!(
        Store::new(&dir).settings().push_to_talk_key.as_deref(),
        Some("f9")
    );
    click(cx, "push-to-talk-key-clear");
    shell.read_with(cx, |shell, _| assert!(shell.ptt.key.is_none()));
    assert!(Store::new(&dir).settings().push_to_talk_key.is_none());
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn an_identity_is_deleted_only_once_confirmed(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-identities");
    click(cx, "identity-delete-1");
    assert_eq!(engine.certificates(), ["alex", "work"], "asked first");
    click(cx, "identity-cancel-1");
    click(cx, "identity-delete-1");
    click(cx, "identity-confirm-1");
    assert_eq!(engine.certificates(), ["alex"]);
    shell.read_with(cx, |shell, _| assert_eq!(shell.panels.certs.held, ["alex"]));
}

#[gpui::test]
fn the_search_finds_a_setting_by_a_word_not_on_it_and_lights_it(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    let field = shell.read_with(cx, |shell, _| {
        shell
            .panels
            .settings
            .search
            .as_ref()
            .expect("a search")
            .field
            .clone()
    });
    cx.update(|window, cx| window.focus(&field.focus_handle(cx), cx));
    type_in(cx, "wallpaper");
    assert!(cx.debug_bounds("found-personalize").is_some());
    click(cx, "settings-voice");
    click(cx, "found-personalize");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.panels.settings.page, Page::Personalize);
        assert!(shell.panels.settings.lit.lights("Chat background"));
        assert!(field.read(cx).text().is_empty(), "the search is emptied");
    });
    // Enter takes the first; a word on no setting finds nothing.
    cx.update(|window, cx| window.focus(&field.focus_handle(cx), cx));
    type_in(cx, "ptt");
    cx.simulate_keystrokes("enter");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.page, Page::Voice)
    });
}

#[gpui::test]
fn the_keyboard_reaches_every_control_of_every_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    for (page, wanted) in [
        (
            Page::Voice,
            &[
                "input-device",
                "activation-2",
                "gate-meter-marker-0",
                "gate-meter-marker-1",
                "noise-suppression-1",
                "bitrate",
                "voice-over-tcp",
            ][..],
        ),
        (Page::Notifications, &["sounds-on"][..]),
        (
            Page::Privacy,
            &["tell-reading", "tell-writing", "look-behind-links"][..],
        ),
        (Page::Localization, &["language", "hours-2"][..]),
        (Page::Shortcuts, &["push-to-talk-key", "whisper-key"][..]),
        (Page::Identities, &["identity-import"][..]),
        (Page::Advanced, &["reconnect", "open-logs"][..]),
    ] {
        // The log folder is a developer's (Advanced, Developer Mode).
        shell.update(cx, |shell, cx| {
            shell.panels.settings.user_mode = crate::store::UserMode::Developer;
            shell.turn_to(page, cx);
        });
        cx.run_until_parked();
        let mut seen = Vec::new();
        for _ in 0..140 {
            cx.simulate_keystrokes("tab");
            seen.extend(at(cx));
        }
        for control in wanted {
            assert!(
                seen.iter().any(|stop| stop == control),
                "{page:?}: Tab never reached {control}"
            );
        }
    }
    // And a stop is worked from the keyboard: Space on a switch.
    shell.update(cx, |shell, cx| shell.turn_to(Page::Advanced, cx));
    for _ in 0..80 {
        if at(cx).as_deref() == Some("reconnect") {
            break;
        }
        cx.simulate_keystrokes("tab");
    }
    cx.simulate_keystrokes("space");
    cx.simulate_event(KeyUpEvent {
        keystroke: Keystroke::parse("space").expect("a key"),
    });
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.settings.stay_disconnected)
    });
}

#[gpui::test]
fn a_klipy_key_of_ones_own_is_typed_on_advanced_and_kept(cx: &mut TestAppContext) {
    let dir = data_dir("klipy");
    let (shell, _engine, cx) = open_keeping(&dir, cx);
    click(cx, "settings-advanced");
    // Behind expert mode, as in the web UI.
    click(cx, "expert-mode");
    let field = shell.read_with(cx, |shell, _| {
        shell
            .panels
            .settings
            .klipy
            .as_ref()
            .expect("the field")
            .field
            .clone()
    });
    cx.update(|window, cx| window.focus(&field.focus_handle(cx), cx));
    type_in(cx, "a-key");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.gifs.key.as_deref(), Some("a-key"));
    });
    assert_eq!(
        Store::new(&dir).settings().klipy_key.as_deref(),
        Some("a-key")
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_about_editor_is_drawn_on_the_profile_page_and_goes_with_it(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-profile");
    shell.read_with(cx, |shell, _| {
        assert!(
            shell.panels.profiles.editor.is_some(),
            "opened with the page"
        );
        assert!(shell.about_on_settings_page(), "in the page, not over it");
    });
    click(cx, "settings-voice");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.profiles.editor.is_none())
    });
}
