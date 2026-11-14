//! The page of a saved server, before connecting.

use gpui::{Modifiers, ScrollDelta, ScrollWheelEvent, TestAppContext, TouchPhase, point, px};

use super::tests::{click, shell_on};
use crate::demo::DemoEngine;
use crate::engine::{Connection, Engine, SavedServer, Wanted};

/// With more identities than the window is high, the way onto the server is
/// below its edge, and the wheel brings it up.
#[gpui::test]
fn a_server_with_many_identities_scrolls_down_to_its_way_in(cx: &mut TestAppContext) {
    let engine = DemoEngine::disconnected();
    for number in 0..40 {
        engine.save_server(SavedServer {
            id: format!("magical-{number}").into(),
            label: "Magical Rocks".into(),
            host: "magical.rocks".into(),
            port: 64738,
            username: format!("Alex {number}").into(),
            certificate: None,
            favorite: false,
        });
    }
    let (_shell, engine, cx) = shell_on(engine, cx);
    let room = cx.update(|window, _| window.viewport_size());
    let way_in = |cx: &mut gpui::VisualTestContext| cx.debug_bounds("connect").expect("the button");
    assert!(way_in(cx).bottom() > room.height, "below the window's edge");

    let over = point(room.width - px(300.0), room.height / 2.0);
    cx.simulate_mouse_move(over, None, Modifiers::none());
    for _ in 0..40 {
        cx.simulate_event(ScrollWheelEvent {
            position: over,
            delta: ScrollDelta::Pixels(point(px(0.0), px(-200.0))),
            modifiers: Modifiers::none(),
            touch_phase: TouchPhase::Moved,
            ..ScrollWheelEvent::default()
        });
    }
    cx.run_until_parked();
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    assert!(way_in(cx).bottom() < room.height, "brought up by the wheel");
    click(cx, "connect");
    assert_eq!(engine.snapshot().connection, Connection::Connected);
}

/// A double click on an identity goes onto the server as it; a single one
/// only chooses it.
#[gpui::test]
fn a_double_click_on_an_identity_connects_as_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "identity-magical-work");
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);
    let at = cx
        .debug_bounds("identity-magical-work")
        .expect("the identity")
        .center();
    for click_count in [1, 2] {
        cx.simulate_event(gpui::MouseDownEvent {
            position: at,
            modifiers: Modifiers::none(),
            button: gpui::MouseButton::Left,
            click_count,
            first_mouse: false,
        });
        cx.simulate_event(gpui::MouseUpEvent {
            position: at,
            modifiers: Modifiers::none(),
            button: gpui::MouseButton::Left,
            click_count,
        });
    }
    cx.run_until_parked();
    assert_eq!(engine.snapshot().connection, Connection::Connected);
    shell.read_with(cx, |shell, _| {
        let identity = shell.selected_identity().expect("an identity is chosen");
        assert_eq!(identity.username.as_ref(), "Alex (work)");
    });
}

/// Nothing is asked for until a server has turned the user away for want
/// of it, and then only that: a password where the password was wrong, a
/// code where the account has a second factor. Both are asked for in the
/// card of the identity they are wanted of.
#[gpui::test]
fn what_a_server_wants_is_asked_for_in_the_identitys_own_card(cx: &mut TestAppContext) {
    const PASSWORD: &str = "input-Password";
    const CODE: &str = "input-6-digit code from your authenticator app";
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "identity-magical-work");
    assert!(cx.debug_bounds(PASSWORD).is_none());
    assert!(cx.debug_bounds(CODE).is_none());

    // Something typing would not mend: said, and nothing asked.
    engine.notify(Some("The server is full"));
    cx.run_until_parked();
    assert!(cx.debug_bounds(PASSWORD).is_none());
    assert!(cx.debug_bounds(CODE).is_none());
    assert!(cx.debug_bounds("refusal").is_none());

    engine.refuse(Wanted::Password, "wrong password");
    cx.run_until_parked();
    let card = cx.debug_bounds("identity-magical-work").expect("the card");
    let field = cx.debug_bounds(PASSWORD).expect("the password is asked for");
    assert!(card.contains(&field.origin) && card.contains(&field.bottom_right()));
    let said = cx.debug_bounds("refusal").expect("why, beside it");
    assert!(card.contains(&said.origin));
    assert!(cx.debug_bounds(CODE).is_none(), "no second factor was asked for");

    // The password was right and the account has a second factor: the
    // code is asked for, and the password is still there to go with it.
    click(cx, PASSWORD);
    cx.simulate_keystrokes("s e s a m e");
    engine.refuse(Wanted::Code, "a code is needed");
    cx.run_until_parked();
    assert!(cx.debug_bounds(CODE).is_some());
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.secrets.password.read(cx).text(), "sesame");
    });
    // A double click in a field is not a double click on the identity.
    let at = cx.debug_bounds(CODE).expect("the field").center();
    for click_count in [1, 2] {
        cx.simulate_event(gpui::MouseDownEvent {
            position: at,
            modifiers: Modifiers::none(),
            button: gpui::MouseButton::Left,
            click_count,
            first_mouse: false,
        });
        cx.simulate_event(gpui::MouseUpEvent {
            position: at,
            modifiers: Modifiers::none(),
            button: gpui::MouseButton::Left,
            click_count,
        });
    }
    cx.run_until_parked();
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);

    // A wrong password is not kept for the next try.
    engine.refuse(Wanted::Password, "wrong password");
    cx.run_until_parked();
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.secrets.password.read(cx).text(), "");
    });

    // Another server: nothing was asked of that one.
    // (Asked of the shell: where a field once stood is remembered by the
    // test window after it has gone.)
    click(cx, "server-kumo.jp:64738");
    shell.read_with(cx, |shell, _| assert!(!shell.secrets.asks()));
}
