//! The tray icon's side of the shell, without a tray: what is picked in it
//! is handed to the shell as the tray would hand it, and what the tray is
//! to show is read from the shell.

use std::cell::Cell;
use std::rc::Rc;

use gpui::{TestAppContext, VisualTestContext};

use super::Shell;
use super::tests::shell;
use crate::engine::{Connection, Engine, Voice};
use crate::tray::{Picked, Row, Shown};

/// Hand `picked` to the shell, as the tray does.
fn pick(shell: &gpui::Entity<Shell>, cx: &mut VisualTestContext, picked: Picked) {
    shell.update_in(cx, |shell, window, cx| {
        shell.tray_picked(picked, window, cx)
    });
    cx.run_until_parked();
}

fn shows(shell: &gpui::Entity<Shell>, cx: &mut VisualTestContext) -> Shown {
    shell.read_with(cx, |shell, _| shell.tray_shows())
}

#[gpui::test]
fn what_is_picked_in_the_tray_is_done(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Mute is the microphone button: voice on first, then muted.
    pick(&shell, cx, Picked::Mute);
    assert_eq!(engine.snapshot().voice, Voice::On);
    pick(&shell, cx, Picked::Mute);
    assert_eq!(engine.snapshot().voice, Voice::Muted);
    pick(&shell, cx, Picked::Deafen);
    assert!(engine.snapshot().deafened);
    pick(&shell, cx, Picked::Deafen);
    assert!(!engine.snapshot().deafened);

    // Show brings the window up.
    cx.deactivate_window();
    assert!(!cx.update(|window, _| window.is_window_active()));
    pick(&shell, cx, Picked::Show);
    assert!(cx.update(|window, _| window.is_window_active()));

    // Quit is the application's quit, as Ctrl+Q is; nothing else is done.
    let quits = Rc::new(Cell::new(0));
    let heard = Rc::clone(&quits);
    cx.update(|_, cx| {
        let _ = cx.on_action(move |_: &super::keys::Quit, _| heard.set(heard.get() + 1));
    });
    pick(&shell, cx, Picked::Quit);
    assert_eq!(quits.get(), 1);
    assert_eq!(engine.snapshot().connection, Connection::Connected);

    pick(&shell, cx, Picked::Disconnect);
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);
    // Off the server, muting and deafening are not offered, and a pick
    // that comes anyway does nothing.
    let before = engine.snapshot();
    pick(&shell, cx, Picked::Mute);
    pick(&shell, cx, Picked::Deafen);
    pick(&shell, cx, Picked::Disconnect);
    let after = engine.snapshot();
    assert_eq!(
        (after.voice, after.deafened, after.connection),
        (before.voice, before.deafened, before.connection)
    );
}

#[gpui::test]
fn the_tray_shows_what_the_server_says(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert_eq!(
        shows(&shell, cx),
        Shown {
            connected: true,
            muted: false,
            deafened: false,
            talking: false,
        }
    );
    // Changed from the window, not the tray: the tray follows all the same.
    engine.toggle_microphone();
    engine.toggle_microphone();
    cx.run_until_parked();
    assert!(shows(&shell, cx).muted);
    engine.toggle_deafen();
    cx.run_until_parked();
    let deaf = shows(&shell, cx);
    assert!(deaf.deafened && deaf.muted);
    // The menu ticks both, and offers them.
    let ticked: Vec<_> = deaf
        .menu()
        .into_iter()
        .filter_map(|row| match row {
            Row::Entry(entry) => Some((entry.picks, entry.enabled, entry.ticked)),
            Row::Rule => None,
        })
        .take(3)
        .collect();
    assert_eq!(
        ticked,
        [
            (Picked::Mute, true, Some(true)),
            (Picked::Deafen, true, Some(true)),
            (Picked::Disconnect, true, None),
        ]
    );

    // Somebody else talking is no dot; the user talking is.
    let own = shell
        .read_with(cx, |shell, _| shell.snapshot.own_session)
        .expect("on the server");
    let other = engine
        .snapshot()
        .users
        .iter()
        .map(|user| user.session)
        .find(|session| *session != own)
        .expect("somebody else");
    engine.talk(other, true);
    cx.run_until_parked();
    assert!(!shows(&shell, cx).talking);
    engine.talk(own, true);
    cx.run_until_parked();
    assert!(shows(&shell, cx).talking);
    engine.talk(own, false);
    cx.run_until_parked();
    assert!(!shows(&shell, cx).talking);

    // Off the server nothing that needs one is offered.
    engine.disconnect();
    cx.run_until_parked();
    let off = shows(&shell, cx);
    assert!(!off.connected && !off.talking);
    assert!(off.menu().into_iter().all(|row| match row {
        Row::Entry(entry) => {
            entry.enabled == matches!(entry.picks, Picked::Show | Picked::Quit)
        }
        Row::Rule => true,
    }));
}
