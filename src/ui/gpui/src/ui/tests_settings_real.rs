//! The settings that change something, each checked where it changes it:
//! a control on its page is worked, the thing it controls is looked at,
//! and a second shell started on the same data directory finds it as it
//! was left.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext, point, px};

use super::Shell;
use super::conversation::Row;
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::engine::Engine;
use crate::store::{BubbleStyle, ChannelViewer, ServerSwitcher, Store, TextSize, UserMode};

/// A data directory of the test's own, emptied.
fn data_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("fancy-gpui-real-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    dir
}

/// A shell keeping what it is told in `dir`, with the settings open.
fn open_keeping<'a>(
    dir: &Path,
    cx: &'a mut TestAppContext,
) -> (Entity<Shell>, &'a mut VisualTestContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.store = Some(Store::new(dir)));
    cx.simulate_keystrokes("ctrl-,");
    (shell, cx)
}

/// The shell started again on `dir`: what it reads there is what the user
/// left.
fn restarted<'a>(
    dir: &Path,
    cx: &'a mut TestAppContext,
) -> (Entity<Shell>, &'a mut VisualTestContext) {
    let engine: Arc<dyn Engine> = Arc::new(DemoEngine::new());
    let store = Store::new(dir);
    // The keys at their defaults first, as the application binds them
    // before its window: the shell binds the chosen ones over them. And
    // the default theme, where no shell was started before.
    cx.update(|cx| {
        super::keys::bind(cx);
        if !cx.has_global::<crate::theme::ActiveTheme>() {
            let theme = crate::theme::Catalog::get()
                .resolve(crate::theme::DEFAULT_THEME, crate::theme::Mode::Dark, &[])
                .expect("the default theme");
            cx.set_global(crate::theme::ActiveTheme(Arc::new(theme)));
        }
    });
    let (shell, cx) = cx.add_window_view(|window, cx| Shell::new(engine, Some(store), window, cx));
    cx.update(|window, cx| {
        window.activate_window();
        let window = window.window_handle().downcast::<Shell>();
        super::keys::act_on(window.expect("the shell's window"), cx);
    });
    cx.run_until_parked();
    (shell, cx)
}

/// `name` with `n` after it, as a selector.
fn tag(name: &str, n: impl std::fmt::Display) -> &'static str {
    Box::leak(format!("{name}-{n}").into_boxed_str())
}

/// Say `words` in the lounge, and the row the message is drawn on and its
/// place among the messages.
fn say(shell: &Entity<Shell>, cx: &mut VisualTestContext, words: &str) -> (usize, usize) {
    click(cx, "input-Message #lounge");
    let keys: Vec<String> = words.chars().map(String::from).collect();
    cx.simulate_keystrokes(&keys.join(" "));
    cx.simulate_keystrokes("enter");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let index = shell
            .messages
            .iter()
            .rposition(|message| message.own && message.body.as_ref() == words)
            .expect("the message said");
        (row_of(shell, index), index)
    })
}

/// The row message `index` is drawn on.
fn row_of(shell: &Shell, index: usize) -> usize {
    shell
        .row_model
        .iter()
        .position(|row| matches!(row, Row::Message(at) if *at == index))
        .expect("the message has a row")
}

/// The row of the newest message somebody else said, and its place.
fn theirs(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> (usize, usize) {
    shell.read_with(cx, |shell, _| {
        let index = (0..shell.messages.len())
            .rev()
            .find(|at| !shell.messages[*at].own)
            .expect("somebody else said something");
        (row_of(shell, index), index)
    })
}

/// Scroll the open page of the settings until `selector` is in view, and
/// click it.
fn reach(shell: &Entity<Shell>, cx: &mut VisualTestContext, selector: &'static str) {
    bring(shell, cx, selector);
    click(cx, selector);
}

/// Scroll the open page of the settings until `selector` is in view.
fn bring(shell: &Entity<Shell>, cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("nothing on the page is tagged `{selector}`"));
    shell.update(cx, |shell, cx| {
        if let Some(search) = &shell.panels.settings.search {
            let (view, at) = (search.scroll.bounds(), search.scroll.offset());
            let y = at.y - (bounds.top() - view.top() - px(60.0));
            search.scroll.set_offset(point(at.x, y.min(px(0.0))));
        }
        cx.notify();
    });
    cx.run_until_parked();
    // Drawn once more: what the page was scrolled to is where its parts
    // are noted as being from the frame after.
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
}

/// Press the bar tagged `bar` at `along` its length.
fn press_bar(cx: &mut VisualTestContext, bar: &'static str, along: f32) {
    let bounds = cx
        .debug_bounds(bar)
        .unwrap_or_else(|| panic!("the bar `{bar}`"));
    let x = bounds.left() + (bounds.size.width - px(1.0)) * along;
    cx.simulate_click(point(x, bounds.center().y), Modifiers::none());
    cx.run_until_parked();
}

/// A small picture of one colour, encoded as the wall keeps them.
fn wall_picture(rgb: [u8; 3], (width, height): (u32, u32)) -> Vec<u8> {
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(width, height, image::Rgb(rgb)))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    crate::picture::wallpaper(&png).expect("a wallpaper")
}

#[gpui::test]
fn flat_puts_ones_own_messages_in_the_river_and_it_is_kept(cx: &mut TestAppContext) {
    let dir = data_dir("style");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let (row, _) = say(&shell, cx, "bubbled");
        // As a bubble on the right: no name over it.
        assert!(cx.debug_bounds(tag("sender", row)).is_none());
        assert!(cx.debug_bounds("own-foot").is_some());
        cx.simulate_keystrokes("ctrl-,");
        click(cx, "settings-personalize");
        reach(&shell, cx, "message-style-1");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        // Headed by the user's name, at the left edge somebody else's is at.
        let own = cx
            .debug_bounds(tag("sender", row))
            .expect("named, in the river");
        let (their_row, _) = theirs(&shell, cx);
        let their = cx
            .debug_bounds(tag("sender", their_row))
            .expect("their name");
        assert_eq!(own.left(), their.left());
        assert!(
            cx.debug_bounds("own-marks").is_some(),
            "its tick beside the name"
        );
    }
    assert_eq!(
        Store::new(&dir).settings().look.bubble_style,
        BubbleStyle::Flat
    );
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.look.bubble_style, BubbleStyle::Flat);
    });
    // The user's own, from the lounge's history: headed by their name.
    let row = shell.read_with(cx, |shell, _| {
        let own = shell
            .messages
            .iter()
            .position(|message| message.own)
            .expect("the lounge holds one of the user's own");
        row_of(shell, own)
    });
    assert!(
        cx.debug_bounds(tag("sender", row)).is_some(),
        "still in the river"
    );
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn compact_drops_the_faces_and_the_compact_style_runs_the_name_in(cx: &mut TestAppContext) {
    let dir = data_dir("compact");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let (row, _) = theirs(&shell, cx);
        let roomy = cx.debug_bounds(tag("sender", row)).expect("a name");
        cx.simulate_keystrokes("ctrl-,");
        click(cx, "settings-personalize");
        reach(&shell, cx, "compact-mode");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let dense = cx.debug_bounds(tag("sender", row)).expect("the name");
        // The face's column, 38 and its gap, is gone from before the name.
        assert!(
            roomy.left() - dense.left() > px(40.0),
            "{roomy:?} {dense:?}"
        );
        // The compact style: the time runs before the name.
        cx.simulate_keystrokes("ctrl-,");
        click(cx, "settings-personalize");
        reach(&shell, cx, "compact-mode");
        reach(&shell, cx, "message-style-2");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let inline = cx.debug_bounds(tag("sender", row)).expect("the name");
        assert!(inline.left() > dense.left(), "after the time");
        shell.read_with(cx, |shell, _| assert!(shell.panels.settings.look.dense()));
    }
    let kept = Store::new(&dir).settings();
    assert!(!kept.look.compact_mode);
    assert_eq!(kept.look.bubble_style, BubbleStyle::Compact);
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.settings.look.inline_name())
    });
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_actions_stand_under_every_message_when_asked_and_stay_asked(cx: &mut TestAppContext) {
    let dir = data_dir("actions");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        click(cx, "settings-personalize");
        reach(&shell, cx, "always-show-actions");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        // The pointer, left where the settings' button was, off the
        // conversation: the view under it now is taken as hovered.
        cx.simulate_mouse_move(point(px(1.0), px(1.0)), None, Modifiers::none());
        cx.executor().advance_clock(std::time::Duration::from_secs(2));
        cx.run_until_parked();
        let (_, index) = theirs(&shell, cx);
        // Not pointed at, and there.
        assert!(cx.debug_bounds(tag("pinned-actions", index)).is_some());
        shell.read_with(cx, |shell, _| assert_eq!(shell.hovered_message(), None));
        // A click on one does what the pill's does: Reply.
        let actions = cx
            .debug_bounds(tag("pinned-actions", index))
            .expect("there");
        let reply = cx.debug_bounds("pill-Reply").expect("reply");
        assert!(actions.contains(&reply.center()));
    }
    assert!(Store::new(&dir).settings().look.always_show_message_actions);
    let (shell, cx) = restarted(&dir, cx);
    let (_, index) = theirs(&shell, cx);
    assert!(cx.debug_bounds(tag("pinned-actions", index)).is_some());
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn an_expert_sets_large_a_pixel_at_a_time_and_the_text_follows(cx: &mut TestAppContext) {
    let dir = data_dir("custom-size");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        click(cx, "settings-personalize");
        // Not offered until the finer settings are.
        assert!(cx.debug_bounds("custom-size").is_none());
        shell.update(cx, |shell, cx| {
            shell.panels.settings.user_mode = UserMode::Expert;
            cx.notify();
        });
        cx.run_until_parked();
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let (_, index) = theirs(&shell, cx);
        let before = cx.debug_bounds(tag("message", index)).expect("a message");
        cx.simulate_keystrokes("ctrl-,");
        bring(&shell, cx, "custom-size");
        press_bar(cx, "custom-size", 1.0);
        shell.read_with(cx, |shell, _| {
            let format = shell.panels.settings.format;
            assert_eq!((format.text, format.custom_px()), (TextSize::Large, 24));
        });
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let after = cx.debug_bounds(tag("message", index)).expect("the message");
        assert!(
            after.size.height > before.size.height,
            "{before:?} {after:?}"
        );
    }
    let kept = Store::new(&dir).settings();
    assert_eq!(kept.format.font_size_custom_px, Some(24));
    assert_eq!(kept.user_mode, UserMode::Expert);
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| {
        assert!((shell.panels.settings.format.text_px() - 24.0).abs() < f32::EPSILON);
    });
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_shelf_keeps_the_pictures_their_focus_and_the_dim(cx: &mut TestAppContext) {
    let dir = data_dir("shelf");
    let first;
    {
        let (shell, cx) = open_keeping(&dir, cx);
        shell.update(cx, |shell, cx| {
            shell.set_wall(Some(wall_picture([200, 30, 30], (64, 32))), cx);
            shell.set_wall(Some(wall_picture([30, 200, 30], (32, 64))), cx);
        });
        click(cx, "settings-personalize");
        super::tests_settings::scroll_to_foot(&shell, cx);
        // Two on the shelf, the last chosen behind the conversation.
        assert!(cx.debug_bounds("wall-current").is_some());
        assert!(cx.debug_bounds("wall-saved-1").is_some());
        reach(&shell, cx, "wall-saved-1");
        first = shell.read_with(cx, |shell, _| {
            assert_eq!(shell.chrome.walls.recents.len(), 2);
            let shown = shell.chrome.walls.shown.clone().expect("one shown");
            assert_eq!(
                shown, shell.chrome.walls.recents[1].file,
                "the older one, now"
            );
            assert!(shell.chrome.wall.is_some());
            shown
        });
        // Its subject at its top left corner.
        bring(&shell, cx, "wall-focus");
        let picker = cx.debug_bounds("wall-focus").expect("the focus point");
        let corner = picker.origin + point(px(1.0), px(1.0));
        cx.simulate_click(corner, Modifiers::none());
        cx.run_until_parked();
        bring(&shell, cx, "wall-dim");
        press_bar(cx, "wall-dim", 0.0);
        shell.read_with(cx, |shell, _| {
            let current = shell.chrome.walls.current().expect("shown");
            assert!(
                current.focus_x < 0.05 && current.focus_y < 0.05,
                "{current:?}"
            );
            assert!(shell.chrome.wall_dim < 0.01);
        });
        // The other taken off the shelf, and off the disk.
        let other = shell.read_with(cx, |shell, _| shell.chrome.walls.recents[0].file.clone());
        reach(&shell, cx, "wall-remove-0");
        assert!(Store::new(&dir).chat_background(&other).is_none());
    }
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.chrome.walls.recents.len(), 1);
        assert_eq!(shell.chrome.walls.shown.as_ref(), Some(&first));
        assert!(shell.chrome.wall.is_some(), "drawn again");
        assert!(shell.chrome.wall_dim < 0.01);
        assert!(
            shell
                .chrome
                .walls
                .current()
                .is_some_and(|current| current.focus_x < 0.05)
        );
    });
    assert!(cx.debug_bounds("wall").is_some(), "behind the conversation");
    // The window's own ground, the picture kept on the shelf.
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-personalize");
    reach(&shell, cx, "wall-default");
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.wall.is_none() && shell.chrome.walls.recents.len() == 1);
    });
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_servers_go_to_the_band_as_tabs_and_the_rail_goes(cx: &mut TestAppContext) {
    let dir = data_dir("switcher");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        click(cx, "settings-personalize");
        reach(&shell, cx, "server-list-1");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        assert!(cx.debug_bounds("server-tabs").is_some());
        // A saved server's tab shows the way onto it, as its tile did.
        click(cx, "tab-kumo.jp");
        shell.read_with(cx, |shell, _| {
            assert!(shell.adding_server);
            assert_eq!(shell.selected_server.as_deref(), Some("kumo.jp:64738"));
        });
        click(cx, "band-friends");
        shell.read_with(cx, |shell, _| assert!(shell.panels.friends.open));
    }
    assert_eq!(
        Store::new(&dir).settings().server_switcher,
        ServerSwitcher::Titlebar
    );
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.settings.server_switcher,
            ServerSwitcher::Titlebar
        );
    });
    assert!(cx.debug_bounds("server-tabs").is_some());
    // This window never drew the rail.
    assert!(cx.debug_bounds("rail-widen").is_none());
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_modern_viewer_puts_faces_on_the_channels_row(cx: &mut TestAppContext) {
    let dir = data_dir("viewer");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        click(cx, "settings-personalize");
        reach(&shell, cx, "channel-viewer-1");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        shell.read_with(cx, |shell, _| {
            assert!(
                !shell
                    .column
                    .iter()
                    .any(|row| matches!(row, super::sidebar::Row::People { .. })),
                "nobody listed by name"
            );
        });
        assert!(cx.debug_bounds("faces-1").is_some(), "the lounge's faces");
    }
    assert_eq!(
        Store::new(&dir).settings().look.channel_viewer_style,
        ChannelViewer::Modern
    );
    let (_shell, cx) = restarted(&dir, cx);
    assert!(cx.debug_bounds("faces-1").is_some());
    let _ = std::fs::remove_dir_all(dir);
}

/// The clock a message's time is read on, as the conversation reads it.
fn clock_of(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> super::widgets::Clock {
    shell.update(cx, |shell, cx| {
        let viewer = cx.weak_entity();
        shell.setting_of(0, &viewer).1
    })
}

#[gpui::test]
fn the_clock_and_utc_change_how_a_time_reads_and_are_kept(cx: &mut TestAppContext) {
    use super::widgets::Zone;
    use crate::store::Hours;
    // 21:37 UTC.
    let at = Some(1_760_045_820_000);
    let dir = data_dir("clock");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-localization");
        reach(&shell, cx, "hours-1");
        reach(&shell, cx, "local-time");
        let clock = clock_of(&shell, cx);
        assert_eq!((clock.hours, clock.zone), (Hours::Twelve, Zone::Utc));
        assert_eq!(clock.read(at), "09:37 PM");
        reach(&shell, cx, "hours-2");
        assert_eq!(clock_of(&shell, cx).read(at), "21:37");
    }
    let kept = Store::new(&dir).settings().format;
    assert_eq!(
        (kept.hours, kept.convert_to_local_time),
        (Hours::TwentyFour, false)
    );
    let (shell, cx) = restarted(&dir, cx);
    assert_eq!(clock_of(&shell, cx).zone, Zone::Utc);
    assert_eq!(clock_of(&shell, cx).read(at), "21:37");
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn dates_and_numbers_are_written_as_chosen_and_stay_so(cx: &mut TestAppContext) {
    use crate::formats::{DateFormat, NumberFormat};
    let dir = data_dir("written");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-localization");
        assert_eq!(super::size_in_words(1_536), "1.5 KB");
        reach(&shell, cx, "number-format-2");
        // A shared file's size, as its card and the composer's tray say it.
        assert_eq!(super::size_in_words(1_536), "1,5 KB");
        reach(&shell, cx, "date-format-3");
        assert_eq!(crate::formats::current().date, DateFormat::Ymd);
        let ago = chrono::NaiveDate::from_ymd_opt(2026, 1, 2).expect("a day");
        assert_eq!(
            crate::formats::current()
                .date
                .day(ago, crate::words::spoken()),
            "Fri, 2026-01-02"
        );
    }
    let kept = Store::new(&dir).settings().format;
    assert_eq!(
        (kept.date_format, kept.number_format),
        (DateFormat::Ymd, NumberFormat::PeriodComma)
    );
    // Back to the defaults on this thread, then a start reads them again.
    crate::formats::set(crate::formats::Formats::default());
    let (_shell, _cx) = restarted(&dir, cx);
    assert_eq!(super::size_in_words(1_536), "1,5 KB");
    assert_eq!(crate::formats::current().date, DateFormat::Ymd);
    crate::formats::set(crate::formats::Formats::default());
    let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn auto_reads_the_systems_clock_and_else_the_languages() {
    use crate::store::Hours;
    use crate::words::Language;
    assert_eq!(
        Hours::Auto.in_force(Some(true), Language::English),
        Hours::TwentyFour
    );
    assert_eq!(
        Hours::Auto.in_force(Some(false), Language::German),
        Hours::Twelve
    );
    assert_eq!(Hours::Auto.in_force(None, Language::English), Hours::Twelve);
    assert_eq!(
        Hours::Auto.in_force(None, Language::French),
        Hours::TwentyFour
    );
    assert_eq!(
        Hours::Twelve.in_force(Some(true), Language::German),
        Hours::Twelve
    );
}

#[gpui::test]
fn a_key_chosen_does_the_thing_takes_it_from_another_and_is_kept(cx: &mut TestAppContext) {
    use crate::store::Bound;
    let dir = data_dir("keys");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-shortcuts");
        // The sidebar's key, chosen by pressing it.
        reach(&shell, cx, "toggleChannelSidebar");
        cx.simulate_keystrokes("ctrl-alt-k");
        shell.read_with(cx, |shell, _| {
            assert_eq!(
                shell
                    .panels
                    .settings
                    .shortcuts
                    .key(Bound::ToggleChannelSidebar),
                Some("Ctrl+Alt+K")
            );
        });
        // Ctrl+B is the activation mode's now; the sidebar had it no more.
        reach(&shell, cx, "toggleActivationMode");
        cx.simulate_keystrokes("ctrl-shift-b");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        let ptt = shell.read_with(cx, |shell, _| shell.voice_settings.push_to_talk);
        cx.simulate_keystrokes("ctrl-shift-b");
        shell.read_with(cx, |shell, _| {
            assert_ne!(shell.voice_settings.push_to_talk, ptt)
        });
        cx.simulate_keystrokes("ctrl-b");
        shell.read_with(cx, |shell, _| {
            assert!(!shell.chrome.column_hidden, "not its key")
        });
        cx.simulate_keystrokes("ctrl-alt-k");
        shell.read_with(cx, |shell, _| assert!(shell.chrome.column_hidden));
        cx.simulate_keystrokes("ctrl-alt-k");
        // A key taken from one action by another: mute's, for deafen.
        cx.simulate_keystrokes("ctrl-,");
        reach(&shell, cx, "toggleDeafen");
        cx.simulate_keystrokes("ctrl-shift-m");
        shell.read_with(cx, |shell, _| {
            let keys = &shell.panels.settings.shortcuts;
            assert_eq!(keys.key(Bound::ToggleDeafen), Some("Ctrl+Shift+M"));
            assert_eq!(keys.key(Bound::ToggleMute), None);
        });
        // Escape while choosing keeps the key there was.
        reach(&shell, cx, "openSettings");
        cx.simulate_keystrokes("escape");
        shell.read_with(cx, |shell, _| {
            assert_eq!(
                shell.panels.settings.shortcuts.key(Bound::OpenSettings),
                Some("Ctrl+,")
            );
            assert!(shell.panels.settings.recording.is_none());
        });
    }
    let kept = Store::new(&dir).settings().shortcuts;
    assert_eq!(kept.key(Bound::ToggleChannelSidebar), Some("Ctrl+Alt+K"));
    let (shell, cx) = restarted(&dir, cx);
    cx.simulate_keystrokes("ctrl-alt-k");
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.column_hidden, "bound at start")
    });
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_voice_priority_key_speaks_while_it_is_held(cx: &mut TestAppContext) {
    use crate::store::Bound;
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, cx| {
        let _ = shell
            .panels
            .settings
            .shortcuts
            .set(Bound::VoicePriority, Some("F8"));
        super::keys::rebind(&shell.panels.settings.shortcuts, cx);
    });
    let voice = || engine.snapshot().voice;
    let before = voice();
    cx.simulate_keystrokes("f8");
    // A key press in a test is down and up at once: it spoke, and stopped.
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.priority_held));
    let held = gpui::Keystroke::parse("f8").expect("a key");
    shell.update(cx, |shell, cx| assert!(shell.hear_chosen_key(&held, cx)));
    assert_eq!(voice(), crate::engine::Voice::On, "speaking while held");
    shell.update(cx, |shell, _| assert!(shell.release_chosen_key(&held)));
    assert_ne!(voice(), crate::engine::Voice::On);
    let _ = before;
}

#[gpui::test]
fn the_systems_notifications_are_switched_off_and_stay_off(cx: &mut TestAppContext) {
    let dir = data_dir("notify");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-notifications");
        let before = crate::notify::would_show();
        crate::notify::show("Rin", "hello");
        assert_eq!(crate::notify::would_show(), before + 1, "shown while on");
        reach(&shell, cx, "native-notifications");
        crate::notify::show("Rin", "hello again");
        assert_eq!(crate::notify::would_show(), before + 1, "not while off");
    }
    assert!(!Store::new(&dir).settings().enable_notifications.0);
    crate::notify::allow(true);
    let (shell, _cx) = restarted(&dir, cx);
    assert!(!crate::notify::allowed(), "off from the start");
    let _ = shell;
    crate::notify::allow(true);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn the_welcome_is_shown_once_always_or_never_as_chosen(cx: &mut TestAppContext) {
    use crate::store::WelcomeDisplay;
    let dir = data_dir("welcome");
    let welcomed = |shell: &Entity<Shell>, cx: &mut VisualTestContext| {
        cx.run_until_parked();
        shell.read_with(cx, |shell, _| shell.welcome_to_show().is_some())
    };
    // Once: shown at the first start, not after it was closed.
    std::fs::create_dir_all(&dir).expect("writable");
    {
        let (shell, cx) = restarted(&dir, cx);
        assert!(welcomed(&shell, cx), "the first time");
        shell.update(cx, Shell::close_welcome);
    }
    {
        let (shell, cx) = restarted(&dir, cx);
        assert!(!welcomed(&shell, cx), "once is once, across a start");
        // Always: shown again.
        cx.simulate_keystrokes("ctrl-,");
        reach(&shell, cx, "settings-notifications");
        reach(&shell, cx, "welcome-display");
        click(cx, "welcome-display-2");
        shell.read_with(cx, |shell, _| {
            assert_eq!(
                shell.panels.settings.welcome_display,
                WelcomeDisplay::Always
            );
        });
    }
    {
        let (shell, cx) = restarted(&dir, cx);
        assert!(welcomed(&shell, cx), "always");
        shell.update(cx, |shell, cx| {
            shell.panels.settings.welcome_display = WelcomeDisplay::Hide;
            shell.remember_settings(cx);
        });
    }
    let (shell, cx) = restarted(&dir, cx);
    assert!(!welcomed(&shell, cx), "never");
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn a_happenings_sound_is_chosen_by_an_expert_only(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.panels.settings.sounds.on = true);
    cx.simulate_keystrokes("ctrl-,");
    reach(&shell, cx, "settings-notifications");
    // Heard, with its own sound, and nothing to choose.
    assert!(cx.debug_bounds("sound-message").is_some());
    assert!(cx.debug_bounds("sound-message-sound").is_none());
    shell.update(cx, |shell, cx| {
        shell.panels.settings.user_mode = UserMode::Expert;
        cx.notify();
    });
    cx.run_until_parked();
    assert!(cx.debug_bounds("sound-message-sound").is_some());
}

#[gpui::test]
fn expert_and_developer_mode_offer_the_finer_settings_and_are_kept(cx: &mut TestAppContext) {
    let dir = data_dir("modes");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-advanced");
        assert!(cx.debug_bounds("developer-mode").is_none(), "an expert's");
        reach(&shell, cx, "expert-mode");
        reach(&shell, cx, "developer-mode");
        shell.read_with(cx, |shell, _| {
            assert_eq!(shell.panels.settings.user_mode, UserMode::Developer);
        });
        assert!(cx.debug_bounds("open-logs").is_some(), "a developer's");
        // What it offers elsewhere: a text size a pixel at a time.
        reach(&shell, cx, "settings-personalize");
        bring(&shell, cx, "custom-size");
        assert!(cx.debug_bounds("custom-size").is_some());
    }
    assert_eq!(Store::new(&dir).settings().user_mode, UserMode::Developer);
    let (shell, _cx) = restarted(&dir, cx);
    let _ = shell;
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn dual_path_is_off_until_switched_on_and_the_engine_is_told(cx: &mut TestAppContext) {
    let dir = data_dir("dual");
    {
        let (shell, engine, cx) = shell(cx);
        shell.update(cx, |shell, _| shell.store = Some(Store::new(&dir)));
        // As the web client starts: no plain copy of an encrypted message.
        assert!(!engine.dual_path(), "off from the start");
        cx.simulate_keystrokes("ctrl-,");
        reach(&shell, cx, "settings-privacy");
        reach(&shell, cx, "dual-path");
        assert!(engine.dual_path());
    }
    assert!(Store::new(&dir).settings().enable_dual_path);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn a_developer_keeps_the_log_as_asked_and_it_is_kept(cx: &mut TestAppContext) {
    let dir = data_dir("logs");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        shell.update(cx, |shell, _| shell.panels.settings.user_mode = UserMode::Developer);
        reach(&shell, cx, "settings-advanced");
        reach(&shell, cx, "log-level");
        click(cx, "log-level-4");
        reach(&shell, cx, "log-to-file");
        // With no file, nothing to compress: the switch does nothing.
        reach(&shell, cx, "auto-zip-logs");
        reach(&shell, cx, "terminal-logging");
        shell.read_with(cx, |shell, _| {
            let logs = &shell.panels.settings.logs;
            assert_eq!(logs.level(), "trace");
            assert!(!logs.log_to_file && logs.auto_zip_logs && logs.terminal_logging);
        });
    }
    let kept = Store::new(&dir).settings().logs;
    assert_eq!((kept.level(), kept.log_to_file), ("trace", false));
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| assert!(shell.panels.settings.logs.terminal_logging));
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn leaving_is_not_asked_about_once_switched_off(cx: &mut TestAppContext) {
    let dir = data_dir("leave");
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-advanced");
        reach(&shell, cx, "disconnect-warning");
        shell.update(cx, Shell::close_settings);
        cx.run_until_parked();
        click(cx, "leave");
        shell.read_with(cx, |shell, _| {
            assert!(shell.prompt.is_none(), "not asked");
            assert_ne!(shell.snapshot.connection, crate::engine::Connection::Connected);
        });
    }
    assert!(!Store::new(&dir).settings().show_disconnect_warning.0);
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.disconnect_warning));
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn reset_asks_first_then_deletes_everything_kept_in_its_own_directory(cx: &mut TestAppContext) {
    let dir = data_dir("reset");
    let (shell, cx) = open_keeping(&dir, cx);
    shell.update(cx, |shell, cx| {
        shell.set_wall(Some(wall_picture([1, 2, 3], (8, 8))), cx);
    });
    std::fs::create_dir_all(dir.join("identities").join("alex")).expect("writable");
    std::fs::write(dir.join("not-ours.txt"), b"kept").expect("writable");
    assert!(dir.join("view.json").exists());
    reach(&shell, cx, "settings-advanced");
    reach(&shell, cx, "reset-all");
    assert!(dir.join("view.json").exists(), "asked, not done");
    reach(&shell, cx, "reset-cancel");
    assert!(dir.join("view.json").exists());
    reach(&shell, cx, "reset-all");
    reach(&shell, cx, "reset-confirm");
    assert!(!dir.join("view.json").exists() && !dir.join("walls").exists());
    assert!(!dir.join("identities").exists(), "the engine's identities too");
    assert!(dir.join("not-ours.txt").exists(), "nothing else");
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn a_share_starting_is_heard_as_the_web_ui_hears_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.panels.settings.sounds.on = true);
    let before = crate::sounds::played().len();
    engine.share_screens(1);
    cx.run_until_parked();
    let played = crate::sounds::played();
    assert!(played[before..].contains(&"univ-051"), "{played:?}");
    // Switched off on the Notifications page: not heard.
    shell.update(cx, |shell, _| {
        shell.panels.settings.sounds.change(crate::sounds::Event::StreamStart, |chosen| {
            crate::sounds::Chosen {
                enabled: false,
                ..chosen
            }
        });
    });
    let before = crate::sounds::played().len();
    engine.share_screens(2);
    cx.run_until_parked();
    assert!(!crate::sounds::played()[before..].contains(&"univ-051"));
}

#[gpui::test]
fn streamer_mode_stars_out_addresses_and_silences_notifications(cx: &mut TestAppContext) {
    let dir = data_dir("streamer");
    let facts: Vec<(gpui::SharedString, gpui::SharedString)> = vec![
        ("Ping".into(), "18 ms".into()),
        ("Address".into(), "203.0.113.7:51234".into()),
    ];
    {
        let (shell, cx) = open_keeping(&dir, cx);
        reach(&shell, cx, "settings-privacy");
        reach(&shell, cx, "streamer-mode");
        shell.read_with(cx, |shell, _| {
            let shown = shell.shown_facts(&facts);
            assert_eq!(shown[0].1.as_ref(), "18 ms");
            assert_eq!(shown[1].1.as_ref(), "************");
        });
        assert!(!crate::notify::allowed(), "notifications go with it");
    }
    crate::notify::allow(true);
    assert!(Store::new(&dir).settings().streamer_mode);
    let (shell, cx) = restarted(&dir, cx);
    shell.read_with(cx, |shell, _| assert!(shell.panels.settings.streamer));
    assert!(!crate::notify::allowed(), "and from the start");
    let _ = cx;
    crate::notify::allow(true);
    let _ = std::fs::remove_dir_all(dir);
}
