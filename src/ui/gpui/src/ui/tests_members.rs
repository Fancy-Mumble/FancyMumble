//! The member panel as the web client's: who is on and who is registered,
//! grouped under the channel on screen and the server's roles, with the
//! switch that brings in the people who are not on.

use gpui::{KeyUpEvent, Keystroke, TestAppContext, VisualTestContext};

use super::Shell;
use super::members::{Group, Row, Who};
use super::tests::{click, shell, shell_on};
use crate::demo::DemoEngine;
use crate::engine::{Action, Conversation, Engine as _, Subject};
use crate::store::{Settings, Store};

/// The headings of the panel, in order, with their counts.
fn headings(shell: &Shell) -> Vec<(Group, usize)> {
    shell
        .panels
        .members
        .rows
        .iter()
        .filter_map(|row| match row {
            Row::Heading { group, count } => Some((*group, *count)),
            _ => None,
        })
        .collect()
}

/// The names of the people listed under `group`, in order.
fn under(shell: &Shell, group: Group) -> Vec<String> {
    let members = &shell.panels.members;
    let start = members
        .rows
        .iter()
        .position(|row| matches!(row, Row::Heading { group: at, .. } if *at == group));
    let Some(start) = start else {
        return Vec::new();
    };
    members.rows[start + 1..]
        .iter()
        .take_while(|row| matches!(row, Row::Member { .. }))
        .filter_map(|row| match row {
            Row::Member {
                who: Who::On(session),
                ..
            } => shell
                .snapshot
                .users
                .iter()
                .find(|user| user.session == *session)
                .map(|user| user.name.to_string()),
            Row::Member {
                who: Who::Away(at), ..
            } => members
                .accounts()
                .get(*at)
                .map(|account| account.name.to_string()),
            _ => None,
        })
        .collect()
}

/// How many rows are of somebody who is not on.
fn away(shell: &Shell) -> usize {
    let rows = &shell.panels.members.rows;
    rows.iter()
        .filter(|row| {
            matches!(
                row,
                Row::Member {
                    who: Who::Away(_),
                    ..
                }
            )
        })
        .count()
}

/// Press `key` and let it go, as a hand does.
fn press(cx: &mut VisualTestContext, key: &'static str) {
    cx.simulate_keystrokes(key);
    cx.simulate_event(KeyUpEvent {
        keystroke: Keystroke::parse(key).expect("a key"),
    });
    cx.run_until_parked();
}

/// Press Tab until the control `name` has the keyboard.
#[track_caller]
fn tab_to(cx: &mut VisualTestContext, name: &str) {
    for _ in 0..120 {
        if cx
            .update(|window, cx| super::kit::keyboard_at(window, cx))
            .as_deref()
            == Some(name)
        {
            return;
        }
        cx.simulate_keystrokes("tab");
    }
    panic!("Tab never reached `{name}`");
}

#[gpui::test]
fn nothing_is_asked_before_the_panel_opens_and_all_is_let_go_when_it_closes(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    assert_eq!(engine.directory_asked(), (0, Vec::new(), 0));
    shell.read_with(cx, |shell, _| assert!(shell.panels.members.rows.is_empty()));
    click(cx, "people");
    assert_eq!(engine.directory_asked().0, 1, "asked once, on opening");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.members.accounts().len(), 6);
        // Wren and Otto are registered and not on.
        assert_eq!(away(shell), 2);
    });
    // Anything that happens while it is open asks nothing more.
    engine.act(Action::MoveUser {
        session: 3,
        channel: 2,
    });
    cx.run_until_parked();
    assert_eq!(engine.directory_asked().0, 1);
    click(cx, "members-close");
    assert_eq!(engine.directory_asked().2, 1, "the pictures are let go of");
    shell.read_with(cx, |shell, _| {
        let members = &shell.panels.members;
        assert!(!members.open && members.rows.is_empty() && members.accounts().is_empty());
        assert_eq!(members.faces_held(), 0);
    });
    // Opened again, it asks again.
    click(cx, "people");
    assert_eq!(engine.directory_asked().0, 2);
}

#[gpui::test]
fn the_channel_comes_first_then_each_role_in_the_servers_order_then_members_and_guests(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    engine.fill_directory(20, 2);
    cx.run_until_parked();
    click(cx, "people");
    shell.read_with(cx, |shell, _| {
        // The demo's five are in the lounge; the twenty made up are away:
        // four in five under the three made-up roles, after "moderators".
        assert_eq!(
            headings(shell),
            [
                (Group::Channel, 5),
                (Group::Role(0), 1),
                (Group::Role(1), 5),
                (Group::Role(2), 6),
                (Group::Role(3), 5),
                (Group::Members, 3 + 4 + 2),
                (Group::Guests, 1),
            ]
        );
        // Rin is in the channel and under her role both; who is on comes
        // before who is not.
        assert_eq!(under(shell, Group::Role(0)), ["Rin"]);
        assert_eq!(
            under(shell, Group::Members),
            [
                "Alex",
                "Flora",
                "Torque",
                "Ash Morrow",
                "Fenn Morrow",
                "Kes Morrow",
                "Otto",
                "Pell Morrow",
                "Wren"
            ]
        );
        assert_eq!(under(shell, Group::Guests), ["Scout"]);
        assert_eq!(
            under(shell, Group::Channel),
            ["Alex", "Flora", "Rin", "Scout", "Torque"]
        );
    });
    // A role's colour is its heading pill's and its people's names.
    shell.read_with(cx, |shell, _| {
        let rin = shell.snapshot.users.iter().find(|user| user.session == 3);
        let color = shell.role_color(rin.expect("Rin"));
        assert_eq!(color, Some(gpui::rgb(0xe0_9a4b).into()));
        let stewards = engine
            .roles()
            .into_iter()
            .find(|role| role.name == "Stewards");
        let first = stewards.and_then(|role| role.members.first().copied());
        let named = crate::engine::User {
            account: first,
            ..shell.snapshot.users[0].clone()
        };
        assert_eq!(shell.role_color(&named), Some(gpui::rgb(0x5d_b0e8).into()));
    });
    assert!(cx.debug_bounds("members-heading-role-1").is_some());
}

#[gpui::test]
fn the_switch_leaves_out_who_is_not_on_and_is_kept(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let dir = std::env::temp_dir().join(format!("fancy-gpui-members-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    shell.update(cx, |shell, _| shell.store = Some(Store::new(&dir)));
    click(cx, "people");
    click(cx, "members-offline");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.members.show_offline);
        assert_eq!(away(shell), 0);
        assert!(shell.panels.members.accounts().is_empty());
    });
    assert_eq!(engine.directory_asked().2, 1, "let go of at once");
    assert!(Store::new(&dir).settings().hide_offline);
    // Closed and opened again, nobody away is asked for.
    click(cx, "members-close");
    click(cx, "people");
    assert_eq!(engine.directory_asked().0, 1);
    click(cx, "members-offline");
    assert_eq!(engine.directory_asked().0, 2);
    shell.read_with(cx, |shell, _| assert_eq!(away(shell), 2));
    assert!(!Store::new(&dir).settings().hide_offline);
    let _ = std::fs::remove_dir_all(dir);
    // A panel starts as the kept settings say.
    let stored = Settings {
        hide_offline: true,
        ..Settings::default()
    };
    assert!(!super::members::Panel::remembering(&stored).show_offline);
    assert!(super::members::Panel::remembering(&Settings::default()).show_offline);
}

#[gpui::test]
fn what_is_typed_finds_people_on_and_away(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "people");
    click(cx, "input-Find a member");
    cx.simulate_keystrokes("w r");
    shell.read_with(cx, |shell, _| {
        assert_eq!(headings(shell), [(Group::Members, 1)]);
        assert_eq!(under(shell, Group::Members), ["Wren"]);
    });
    cx.simulate_keystrokes("backspace backspace r i");
    shell.read_with(cx, |shell, _| {
        assert_eq!(headings(shell), [(Group::Channel, 1), (Group::Role(0), 1)]);
    });
}

#[gpui::test]
fn the_list_says_while_the_accounts_are_on_their_way(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, |shell, cx| {
        shell.toggle_members(cx);
        // Who is on is listed at once, with a line for the rest.
        assert_eq!(shell.panels.members.rows.last(), Some(&Row::Loading));
        assert!(headings(shell).contains(&(Group::Channel, 5)));
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.members.rows.contains(&Row::Loading));
    });
}

#[gpui::test]
fn without_leave_to_list_the_accounts_the_panel_lists_who_is_on(cx: &mut TestAppContext) {
    let engine = DemoEngine::new();
    engine.refuse_directory();
    let (shell, engine, cx) = shell_on(engine, cx);
    click(cx, "people");
    assert_eq!(engine.directory_asked().0, 1);
    shell.read_with(cx, |shell, _| {
        let rows = &shell.panels.members.rows;
        assert!(!rows.contains(&Row::Loading), "nothing is on its way");
        assert_eq!(away(shell), 0);
        assert_eq!(under(shell, Group::Guests), ["Scout"]);
        assert!(shell.notice.is_none(), "a refusal is no news");
    });
    // It is not asked again while the panel stays open.
    engine.act(Action::MoveUser {
        session: 3,
        channel: 2,
    });
    cx.run_until_parked();
    assert_eq!(engine.directory_asked().0, 1);
}

#[gpui::test]
fn only_the_rows_on_screen_have_their_pictures_read(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.fill_directory(500, 2);
    cx.run_until_parked();
    click(cx, "people");
    let first = engine.directory_asked().1;
    let held = shell.read_with(cx, |shell, _| shell.panels.members.faces_held());
    assert!(!first.is_empty(), "the rows in view have theirs read");
    assert!(first.len() < 40, "{} read", first.len());
    assert!(held <= first.len());
    // Down the list, the rows that come into view have theirs read too,
    // and no more than those.
    shell.update(cx, |shell, cx| {
        shell.panels.members.scroll_to(300);
        cx.notify();
    });
    cx.run_until_parked();
    let then = engine.directory_asked().1;
    assert!(then.len() > first.len(), "scrolled rows read");
    assert!(then.len() < 2 * first.len() + 10, "{} read", then.len());
    // Each once, however often it is drawn.
    let mut once = then.clone();
    once.sort_unstable();
    once.dedup();
    assert_eq!(once.len(), then.len());
}

#[gpui::test]
fn a_member_row_does_what_the_web_clients_does(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.act(Action::MoveUser {
        session: 5,
        channel: 2,
    });
    cx.run_until_parked();
    click(cx, "people");
    // Somebody elsewhere: a click keeps their card.
    click(cx, "member-5");
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("their card");
        assert_eq!(card.subject, Subject::User(5));
        assert!(!card.sheet);
        assert_eq!(shell.open, Some(Conversation::Channel(1)));
    });
    shell.update(cx, Shell::dismiss);
    // In the channel, the (i) opens the whole sheet, and only that.
    click(cx, "member-info-2");
    shell.read_with(cx, |shell, _| {
        let sheet = shell.info.as_ref().expect("the sheet");
        assert_eq!(sheet.subject, Subject::User(2));
        assert!(sheet.sheet);
    });
    shell.update(cx, Shell::dismiss);
    // Somebody who is not on: nothing to click.
    click(cx, "member-away-120");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
}

#[gpui::test]
fn the_keyboard_reaches_the_switch_and_the_people(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "people");
    tab_to(cx, "members-offline");
    press(cx, "space");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.members.show_offline));
    tab_to(cx, "member-here-2");
    press(cx, "enter");
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("their card");
        assert_eq!(card.subject, Subject::User(2));
    });
}
