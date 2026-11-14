//! The window driven from the keyboard alone: Tab from control to control
//! in the order they are drawn, Enter and Space to work the one that has
//! the keyboard, the arrows through an open menu, and a dialog that keeps
//! Tab inside itself.

use gpui::{Focusable, KeyUpEvent, Keystroke, TestAppContext, VisualTestContext};

use super::kit;
use super::settings::Page;
use super::tests::{click, shell, shell_on};
use crate::demo::DemoEngine;
use crate::theme::{Catalog, Mode};

/// The id of the control that has the keyboard: `None` when that is a
/// text field, or nothing.
fn at(cx: &mut VisualTestContext) -> Option<String> {
    cx.update(|window, cx| kit::keyboard_at(window, cx))
}

/// Press `key` and let it go, as a hand does: a control is worked when
/// the key comes up.
fn press(cx: &mut VisualTestContext, key: &str) {
    cx.simulate_keystrokes(key);
    cx.simulate_event(KeyUpEvent {
        keystroke: Keystroke::parse(key).expect("a key"),
    });
}

/// Press Tab until the control with the id `name` has the keyboard.
#[track_caller]
fn tab_to(cx: &mut VisualTestContext, name: &str) {
    for _ in 0..80 {
        if at(cx).as_deref() == Some(name) {
            return;
        }
        cx.simulate_keystrokes("tab");
    }
    panic!("Tab never reached `{name}`");
}

/// Press `key` `times` times, and say where the keyboard was after each.
fn walk(cx: &mut VisualTestContext, key: &str, times: usize) -> Vec<Option<String>> {
    (0..times)
        .map(|_| {
            cx.simulate_keystrokes(key);
            at(cx)
        })
        .collect()
}

#[gpui::test]
fn tab_walks_the_settings_page_in_the_order_it_is_drawn_and_shift_tab_walks_back(
    cx: &mut TestAppContext,
) {
    let (_shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    // Round the whole window once, and once more to see where it closes.
    let walked = walk(cx, "tab", 200);
    let begin = walked
        .iter()
        .position(Option::is_some)
        .expect("a control reached");
    let round = 1 + walked[begin + 1..]
        .iter()
        .position(|stop| *stop == walked[begin])
        .expect("Tab comes round again");
    let cycle = &walked[begin..begin + round];
    // The page's own controls, one after the other as they are drawn: the
    // way out, its pages, then the open page's themes, light or dark, its
    // text sizes and its picture.
    let mut page: Vec<String> = vec!["settings-close".to_owned()];
    page.extend(Page::ALL.map(|entry| format!("settings-{}", entry.id())));
    // What the demo's administrator may look after.
    page.extend(["admin-users", "admin-bans", "admin-acl"].map(String::from));
    page.extend(
        Catalog::get()
            .entries(Mode::Dark)
            .into_iter()
            .map(|entry| entry.id.to_string()),
    );
    page.extend(
        [
            "mode-0",
            "mode-1",
            "mode-2",
            "message-style-0",
            "message-style-1",
            "message-style-2",
            "text-size-0",
            "text-size-1",
            "text-size-2",
            "compact-mode",
            "always-show-actions",
            "wall-default",
            "wall-choose",
            "wall-blur",
            "wall-opacity",
            "wall-dim",
            "server-list-0",
            "server-list-1",
            "server-list-2",
            "channel-viewer-0",
            "channel-viewer-1",
        ]
        .map(String::from),
    );
    let named: Vec<&str> = cycle.iter().flatten().map(String::as_str).collect();
    let first = named
        .iter()
        .position(|name| *name == page[0])
        .unwrap_or_else(|| panic!("no section entry in {named:?}"));
    assert_eq!(
        named[first..first + page.len()],
        page.iter().map(String::as_str).collect::<Vec<_>>(),
        "the page's controls, in order"
    );
    // Shift+Tab goes back the same way, a stop at a time.
    let back = walk(cx, "shift-tab", round);
    let ended = (walked.len() - 1 - begin) % round;
    let expected: Vec<Option<String>> = (1..=round)
        .map(|step| cycle[(ended + round - step % round) % round].clone())
        .collect();
    assert_eq!(back, expected);
}

#[gpui::test]
fn enter_works_a_button_and_space_a_switch_that_has_the_keyboard(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    tab_to(cx, "settings-privacy");
    press(cx, "enter");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.page, Page::Privacy);
    });
    tab_to(cx, "tell-writing");
    press(cx, "space");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.settings.privacy.hide_writing, "switched off");
    });
    assert_eq!(at(cx).as_deref(), Some("tell-writing"), "and still there");
    press(cx, "enter");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.privacy.hide_writing, "and on again");
    });
    tab_to(cx, "settings-close");
    press(cx, "enter");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));
}

#[gpui::test]
fn a_press_of_the_pointer_works_a_control_without_handing_it_the_keyboard(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let composer_has_it = |cx: &mut VisualTestContext| {
        shell.update_in(cx, |shell, window, cx| {
            shell.composer.focus_handle(cx).is_focused(window)
        })
    };
    shell.update_in(cx, |shell, window, cx| {
        shell.composer.read(cx).focus(window)
    });
    click(cx, "own-menu");
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_some()));
    assert!(composer_has_it(cx), "the field still has the keyboard");
    assert_eq!(at(cx), None, "and no control wears the ring");
}

#[gpui::test]
fn an_open_menu_is_walked_with_the_arrows_taken_with_enter_and_put_away_with_escape(
    cx: &mut TestAppContext,
) {
    let (shell, _engine, cx) = shell(cx);
    let composer_has_it = |cx: &mut VisualTestContext| {
        shell.update_in(cx, |shell, window, cx| {
            shell.composer.focus_handle(cx).is_focused(window)
        })
    };
    shell.update_in(cx, |shell, window, cx| {
        shell.composer.read(cx).focus(window)
    });
    click(cx, "own-menu");
    // Each entry is known by its place.
    let (names, settings) = shell.read_with(cx, |shell, _| {
        let items = &shell.menu.as_ref().expect("the menu").items;
        let names: Vec<String> = (0..items.len())
            .map(|at| format!("menu-item-{at}"))
            .collect();
        let settings = items
            .iter()
            .position(|item| item.name.as_ref() == "Settings")
            .expect("settings on the menu");
        (names, settings)
    });
    let first = Some(names[0].clone());
    let last = names.last().cloned();
    assert_eq!(walk(cx, "down", 2), [first.clone(), Some(names[1].clone())]);
    assert_eq!(
        walk(cx, "up", 2),
        [first.clone(), last.clone()],
        "round its top"
    );
    assert_eq!(walk(cx, "down", 1), [first], "and its bottom");
    // Escape puts it away, and the keyboard goes back where it came from.
    cx.simulate_keystrokes("escape");
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_none()));
    assert!(composer_has_it(cx), "back in the field");
    // Up from outside comes in at the bottom; Enter takes what has it.
    click(cx, "own-menu");
    assert_eq!(walk(cx, "up", 1), [last]);
    for _ in settings..names.len() - 1 {
        cx.simulate_keystrokes("up");
    }
    assert_eq!(at(cx), Some(format!("menu-item-{settings}")));
    press(cx, "enter");
    shell.read_with(cx, |shell, _| {
        assert!(shell.menu.is_none(), "taken: put away");
        assert!(shell.panels.settings.open);
    });
}

#[gpui::test]
fn tab_does_not_leave_an_open_dialog(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "add-server");
    shell.read_with(cx, |shell, _| assert!(shell.editor.is_some()));
    let inside = |cx: &mut VisualTestContext| cx.update(|window, cx| kit::held_inside(window, cx));
    let mut seen = Vec::new();
    for key in ["tab", "shift-tab"] {
        for _ in 0..14 {
            cx.simulate_keystrokes(key);
            assert!(inside(cx), "{key} stayed in the dialog");
            seen.push(at(cx));
        }
    }
    // Its fields, and the buttons under them: all reached, nothing else.
    for button in ["cancel", "save"] {
        assert!(seen.contains(&Some(button.to_owned())), "{button} reached");
    }
    assert!(seen.contains(&None), "a field reached");
    assert!(
        seen.iter()
            .flatten()
            .all(|name| name == "cancel" || name == "save"),
        "{seen:?}"
    );
}
