//! The user's own dock at the foot of the channel column, and the sheet
//! that grows out of it, as the web UI's `VoiceDock` has them.

use gpui::{Modifiers, TestAppContext, VisualTestContext};

use super::kit;
use crate::engine::Engine as _;
use super::menu::Command;
use super::tests::{click, shell};

/// The names the open sheet offers, in order.
fn offered(shell: &gpui::Entity<super::Shell>, cx: &mut VisualTestContext) -> Vec<String> {
    shell.read_with(cx, |shell, _| {
        shell
            .menu
            .as_ref()
            .expect("the sheet")
            .items
            .iter()
            .map(|item| item.name.to_string())
            .collect()
    })
}

#[gpui::test]
fn the_sheet_grows_out_of_the_dock_with_what_the_web_uis_has(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "own-menu");
    assert_eq!(
        offered(&shell, cx),
        [
            "Share your camera",
            "Hide empty channels",
            "Settings",
            "Server admin",
            "Record audio",
            "Leave server",
        ]
    );
    shell.read_with(cx, |shell, _| {
        let menu = shell.menu.as_ref().expect("the sheet");
        let (server, caption) = menu.head.clone().expect("a head");
        assert_eq!(server.as_ref(), "magical.rocks");
        assert_eq!(caption.as_ref(), "Server & app options");
        // Rules where the web UI draws them: after the camera, and before
        // the way off the server.
        let rules: Vec<bool> = menu.items.iter().map(|item| item.rule).collect();
        assert_eq!(rules, [false, true, false, false, false, true]);
        assert_eq!(menu.items[1].switch, Some(false), "the filter's state");
        assert!(menu.items[2].chevron && menu.items[3].chevron);
        assert!(menu.items[5].danger);
    });
    // As wide as the dock, standing on its top edge.
    let dock = cx.debug_bounds("own-dock").expect("the dock");
    let sheet = cx.debug_bounds("menu-sheet").expect("the sheet");
    assert_eq!(sheet.size.width, dock.size.width);
    assert_eq!(sheet.left(), dock.left());
    assert_eq!(sheet.bottom(), dock.top() - gpui::px(4.0));
    assert!(cx.debug_bounds("menu-head").is_some());
}

#[gpui::test]
fn escape_and_a_press_outside_put_the_sheet_away(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "own-menu");
    cx.simulate_keystrokes("escape");
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_none(), "Escape"));
    click(cx, "own-menu");
    let outside = cx.debug_bounds("menu-backdrop").expect("the backdrop").top_right()
        + gpui::point(gpui::px(-20.0), gpui::px(20.0));
    cx.simulate_mouse_down(outside, gpui::MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_up(outside, gpui::MouseButton::Left, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_none(), "a press outside"));
}

#[gpui::test]
fn each_row_of_the_sheet_does_what_the_web_uis_does(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // The camera: the share picker, on its cameras.
    click(cx, "own-menu");
    click(cx, "menu-Share your camera");
    shell.read_with(cx, |shell, _| {
        let picker = shell.stage.picker.as_ref().expect("the picker");
        assert_eq!(picker.tab, crate::share::SourceKind::Device);
    });
    shell.update(cx, |shell, cx| {
        shell.stage.picker = None;
        cx.notify();
    });
    // The filter: switched, and the sheet put away.
    click(cx, "own-menu");
    click(cx, "menu-Hide empty channels");
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.hide_empty);
        assert!(shell.menu.is_none());
    });
    // Server admin: the settings, on what the administration lists first.
    click(cx, "own-menu");
    click(cx, "menu-Server admin");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.settings.open, "the settings, under the panel");
        assert!(shell.admin_page().is_some(), "the page the column lists first");
    });
}

#[gpui::test]
fn leaving_from_the_sheet_asks_as_the_leave_button_does(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "own-menu");
    click(cx, "menu-Leave server");
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_some(), "asked first"));
    assert_eq!(
        engine.snapshot().connection,
        crate::engine::Connection::Connected,
        "not before the answer"
    );
}

#[gpui::test]
fn every_row_of_the_sheet_is_a_stop_for_the_keyboard(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "own-menu");
    let rows = offered(&shell, cx).len();
    let mut seen = Vec::new();
    for _ in 0..rows {
        cx.simulate_keystrokes("down");
        seen.extend(cx.update(|window, cx| kit::keyboard_at(window, cx)));
    }
    for at in 0..rows {
        let stop = format!("menu-item-{at}");
        assert!(seen.contains(&stop), "{stop} never had the keyboard: {seen:?}");
    }
    // Walking it chose nothing.
    shell.read_with(cx, |shell, _| {
        let menu = shell.menu.as_ref().expect("still open");
        assert!(matches!(menu.items[0].command, Command::ShareCamera));
    });
}
