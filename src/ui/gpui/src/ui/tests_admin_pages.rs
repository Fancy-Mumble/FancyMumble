//! The server's administration as pages of the settings, the way the web
//! UI's are: each opens in the settings' pane and not over it, lists what
//! the server sends, and changes the server through the engine with the
//! list following.

use gpui::{Entity, TestAppContext, VisualTestContext};

use super::Shell;
use super::admin_pages::AdminPage;
use super::kit;
use super::tests::{click, right_click, shell};
use crate::demo::DemoEngine;
use crate::engine::{Action, Engine};
use crate::rights::{Right, Rights};

/// The settings, on the Users page, as a click on its entry opens them.
fn users_page(
    cx: &mut TestAppContext,
) -> (
    Entity<Shell>,
    std::sync::Arc<DemoEngine>,
    &mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "admin-users");
    (shell, engine, cx)
}

/// The names the table lists, top to bottom.
fn listed(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Vec<String> {
    shell.read_with(cx, |shell, _| {
        let users = shell.users_page().expect("the Users page");
        (0..users.shown.len())
            .filter_map(|row| users.at_row(row))
            .map(|account| account.name.to_string())
            .collect()
    })
}

/// The id of the control that has the keyboard.
fn at(cx: &mut VisualTestContext) -> Option<String> {
    cx.update(|window, cx| kit::keyboard_at(window, cx))
}

#[gpui::test]
fn users_open_as_a_page_of_the_settings_not_a_dialog(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = users_page(cx);
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.settings.open);
        assert_eq!(shell.admin_page(), Some(AdminPage::Users));
    });
    assert!(cx.debug_bounds("users").is_some(), "the table");
    assert!(cx.debug_bounds("admin-sheet").is_none());
    // In order of name to begin with, as the server sent them.
    assert_eq!(
        listed(&shell, cx),
        ["Alex", "Flora", "Otto", "Rin", "Torque", "Wren"]
    );
    // Another page of the settings takes the pane back.
    click(cx, "settings-voice");
    shell.read_with(cx, |shell, _| assert_eq!(shell.admin_page(), None));
}

#[gpui::test]
fn the_rows_are_put_in_order_by_a_column_head_and_turned_by_it_again(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = users_page(cx);
    click(cx, "users-sort-0");
    assert_eq!(
        listed(&shell, cx),
        ["Wren", "Torque", "Rin", "Otto", "Flora", "Alex"],
        "the other way"
    );
    // Never seen first, then the longest ago: Otto, Wren, then those here.
    click(cx, "users-sort-1");
    let by_seen = listed(&shell, cx);
    assert_eq!(&by_seen[..2], ["Otto", "Wren"]);
    // By the channel's name, nowhere last.
    click(cx, "users-sort-2");
    assert_eq!(listed(&shell, cx).last().map(String::as_str), Some("Otto"));
}

#[gpui::test]
fn the_search_narrows_the_list_and_refresh_reads_it_again(cx: &mut TestAppContext) {
    let (shell, engine, cx) = users_page(cx);
    click(cx, "input-Search users...");
    cx.simulate_keystrokes("R");
    assert_eq!(listed(&shell, cx), ["Flora", "Rin", "Torque", "Wren"]);
    cx.simulate_keystrokes("i");
    assert_eq!(listed(&shell, cx), ["Rin"]);
    // A name the server has now is listed once it is read again.
    engine.act(Action::RenameRegistered {
        id: 103,
        name: "Rinna".to_owned(),
    });
    assert_eq!(listed(&shell, cx), ["Rin"], "not before");
    click(cx, "users-refresh");
    assert_eq!(listed(&shell, cx), ["Rinna"]);
}

#[gpui::test]
fn an_account_is_renamed_in_its_row_and_the_list_follows(cx: &mut TestAppContext) {
    let (shell, engine, cx) = users_page(cx);
    click(cx, "users-menu-3");
    click(cx, "menu-account-rename");
    shell.read_with(cx, |shell, _| {
        let users = shell.users_page().expect("the page");
        assert_eq!(
            users.renaming.as_ref().map(|renaming| renaming.id),
            Some(103)
        );
    });
    cx.simulate_keystrokes("ctrl-a R i n n a enter");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::RenameRegistered {
            id: 103,
            name: "Rinna".to_owned(),
        })
    );
    assert!(
        listed(&shell, cx).contains(&"Rinna".to_owned()),
        "read again"
    );
    // Escape puts a field away, the name as it was.
    click(cx, "users-menu-0");
    click(cx, "menu-account-rename");
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| {
        assert!(shell.users_page().expect("the page").renaming.is_none());
        assert!(shell.panels.settings.open, "the page stays");
    });
}

#[gpui::test]
fn an_account_is_unregistered_once_the_dialog_is_answered(cx: &mut TestAppContext) {
    let (shell, engine, cx) = users_page(cx);
    click(cx, "users-menu-5");
    click(cx, "menu-account-unregister");
    assert!(cx.debug_bounds("unregister").is_some(), "asked first");
    assert!(
        !engine
            .actions()
            .iter()
            .any(|action| matches!(action, Action::Unregister { .. })),
        "not before the answer"
    );
    click(cx, "unregister-cancel");
    click(cx, "users-menu-5");
    click(cx, "menu-account-unregister");
    click(cx, "unregister-confirm");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::Unregister { id: 120 })
    );
    assert_eq!(
        listed(&shell, cx),
        ["Alex", "Flora", "Otto", "Rin", "Torque"],
        "Wren is gone from the server's list"
    );
}

#[gpui::test]
fn the_roles_of_an_account_are_written_to_the_roots_groups(cx: &mut TestAppContext) {
    let (shell, engine, cx) = users_page(cx);
    // Torque: no roles yet.
    click(cx, "users-menu-4");
    click(cx, "menu-account-roles");
    assert!(cx.debug_bounds("roles").is_some(), "the dialog");
    click(cx, "role-moderators");
    click(cx, "roles-save");
    let Some(Action::SetAcl(acl)) = engine.actions().last().cloned() else {
        panic!("the root's rules are written");
    };
    assert_eq!(acl.channel, 0);
    let moderators = acl
        .groups
        .iter()
        .find(|group| group.name.as_ref() == "moderators")
        .expect("the role");
    assert_eq!(moderators.added, [103, 105]);
    // The chips follow: Torque is a moderator now.
    let held = Engine::roles(engine.as_ref());
    assert!(held[0].members.contains(&105));
    shell.read_with(cx, |shell, _| {
        assert!(
            shell.users_page().expect("the page").managing.is_none(),
            "put away"
        );
    });
}

#[gpui::test]
fn every_control_of_the_page_is_reached_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = users_page(cx);
    let mut reached = Vec::new();
    for _ in 0..80 {
        cx.simulate_keystrokes("tab");
        if let Some(id) = at(cx) {
            reached.push(id);
        }
    }
    for wanted in [
        "users-refresh",
        "users-sort-0",
        "users-sort-1",
        "users-sort-2",
        "users-menu-0",
        "users-menu-5",
    ] {
        assert!(
            reached.iter().any(|id| id.contains(wanted)),
            "Tab never reached `{wanted}`: {reached:?}"
        );
    }
}

#[gpui::test]
fn rights_hide_what_the_server_would_refuse(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Registering, but not writing the root's rules: no roles to manage.
    engine.alter_channel(0, |channel| {
        channel.rights = Rights::only(&[Right::REGISTER]);
    });
    cx.run_until_parked();
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "admin-users");
    click(cx, "users-menu-0");
    assert!(cx.debug_bounds("menu-account-rename").is_some());
    assert!(cx.debug_bounds("menu-account-roles").is_none());
    shell.update(cx, |shell, cx| {
        shell.menu = None;
        cx.notify();
    });
    // Nothing at all, anywhere: no page, and no way to it.
    for id in 0..=3 {
        engine.alter_channel(id, |channel| channel.rights = Rights::only(&[]));
    }
    cx.run_until_parked();
    shell.update(cx, |shell, cx| {
        shell.close_settings(cx);
        shell.open_settings(cx);
        shell.open_admin_page(AdminPage::Users, cx);
    });
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), None);
        assert!(!shell.may_administer());
    });
}

#[gpui::test]
fn the_servers_menu_and_the_own_menu_open_the_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    right_click(cx, "session-magical.rocks");
    click(cx, "menu-Registered users…");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Users));
    });
    // Escape closes the settings, page and all.
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));
    shell.update(cx, Shell::administer);
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.admin_page(),
            Some(AdminPage::Users),
            "the first entry"
        );
    });
}

#[gpui::test]
fn the_page_opens_by_the_web_uis_id(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update(cx, |shell, cx| shell.open_settings_at("users", cx));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Users));
    });
    assert_eq!(listed(&shell, cx).len(), 6);
}

/// The settings, on the Ban List page, as a click on its entry opens them.
fn bans_page(
    cx: &mut TestAppContext,
) -> (
    Entity<Shell>,
    std::sync::Arc<DemoEngine>,
    &mut VisualTestContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "admin-bans");
    (shell, engine, cx)
}

/// The list the engine was last sent.
fn sent(engine: &DemoEngine) -> Option<Vec<crate::engine::Ban>> {
    engine
        .actions()
        .into_iter()
        .rev()
        .find_map(|action| match action {
            Action::SetBans(bans) => Some(bans),
            _ => None,
        })
}

#[gpui::test]
fn bans_open_as_a_page_with_the_list_beside_the_form(cx: &mut TestAppContext) {
    let (shell, engine, cx) = bans_page(cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Bans));
        let bans = shell.bans_page().expect("the page");
        assert_eq!(bans.bans.len(), 2);
        assert!(bans.form.is_none() && !bans.dirty);
    });
    assert!(cx.debug_bounds("ban-1").is_some());
    // Choosing one fills the form; Escape puts it away, not the page.
    click(cx, "ban-0");
    assert!(cx.debug_bounds("ban-reason").is_some());
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| {
        assert!(shell.bans_page().expect("the page").form.is_none());
        assert!(shell.panels.settings.open);
    });
    // Nothing changed is nothing to save.
    assert!(sent(&engine).is_none());
}

#[gpui::test]
fn a_ban_changed_in_its_form_is_saved_with_the_whole_list(cx: &mut TestAppContext) {
    let (shell, engine, cx) = bans_page(cx);
    click(cx, "ban-0");
    click(cx, "ban-reason");
    cx.simulate_keystrokes("ctrl-a f l o o d i n g");
    shell.read_with(cx, |shell, _| {
        let bans = shell.bans_page().expect("the page");
        assert!(bans.dirty);
        assert_eq!(
            bans.bans[0].reason.as_ref(),
            "flooding",
            "the list shows it"
        );
    });
    assert!(sent(&engine).is_none(), "not before it is saved");
    click(cx, "bans-save");
    let list = sent(&engine).expect("the whole list is sent");
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].reason.as_ref(), "flooding");
    assert_eq!(
        (list[0].name.as_ref(), list[0].mask, list[0].start.as_ref()),
        ("Mallory", 32, "2026-01-02"),
        "the rest as it was"
    );
    // Read again: what the server holds, nothing waiting.
    shell.read_with(cx, |shell, _| {
        let bans = shell.bans_page().expect("the page");
        assert!(!bans.dirty && bans.form.is_none());
        assert_eq!(bans.bans[0].reason.as_ref(), "flooding");
    });
}

#[gpui::test]
fn a_ban_is_added_for_one_address_or_a_network_and_removed(cx: &mut TestAppContext) {
    let (shell, engine, cx) = bans_page(cx);
    click(cx, "bans-add");
    // The address has the keyboard; its mask follows it.
    cx.simulate_keystrokes("1 9 2 . 0 . 2 . 0");
    shell.read_with(cx, |shell, _| {
        let bans = shell.bans_page().expect("the page");
        let new = bans.bans.last().expect("the new entry");
        assert_eq!((new.address.as_ref(), new.mask), ("192.0.2.0", 32));
    });
    cx.simulate_keystrokes("tab ctrl-a 2 4");
    click(cx, "bans-save");
    let list = sent(&engine).expect("sent");
    assert_eq!(list.len(), 3);
    let new = &list[2];
    assert_eq!((new.address.as_ref(), new.mask), ("192.0.2.0", 24));
    assert!(new.start.is_empty(), "the server starts it");
    // Lifted: chosen, removed, saved.
    click(cx, "ban-1");
    click(cx, "bans-remove");
    click(cx, "bans-save");
    let list = sent(&engine).expect("sent");
    assert_eq!(list.len(), 2);
    assert_eq!(list[1].address.as_ref(), "192.0.2.0");
}

#[gpui::test]
fn an_entry_without_an_address_is_said_and_nothing_is_sent(cx: &mut TestAppContext) {
    let (shell, engine, cx) = bans_page(cx);
    click(cx, "bans-add");
    click(cx, "bans-save");
    assert!(sent(&engine).is_none());
    shell.read_with(cx, |shell, _| {
        assert!(shell.bans_page().expect("the page").refusal.is_some());
    });
    assert!(cx.debug_bounds("bans-refusal").is_some());
    click(cx, "bans-refusal");
    shell.read_with(cx, |shell, _| {
        assert!(shell.bans_page().expect("the page").refusal.is_none());
    });
}

#[gpui::test]
fn the_ban_list_is_offered_only_to_who_may_ban_and_the_servers_menu_opens_it(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "session-magical.rocks");
    click(cx, "menu-Bans…");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Bans))
    });
    engine.alter_channel(0, |channel| {
        channel.rights = Rights::only(&[Right::REGISTER]);
    });
    cx.run_until_parked();
    shell.update(cx, |shell, cx| {
        shell.close_settings(cx);
        shell.open_admin_page(AdminPage::Bans, cx);
    });
    shell.read_with(cx, |shell, _| assert_eq!(shell.admin_page(), None));
}

#[gpui::test]
fn the_ban_page_is_reached_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = bans_page(cx);
    let mut reached = Vec::new();
    for _ in 0..60 {
        cx.simulate_keystrokes("tab");
        if let Some(id) = at(cx) {
            reached.push(id);
        }
    }
    for wanted in ["bans-refresh", "bans-add", "ban-0", "ban-1"] {
        assert!(
            reached.iter().any(|id| id.contains(wanted)),
            "Tab never reached `{wanted}`: {reached:?}"
        );
    }
}

#[gpui::test]
fn a_ban_list_the_server_refuses_is_said_and_the_servers_list_shown(cx: &mut TestAppContext) {
    let (shell, engine, cx) = bans_page(cx);
    click(cx, "ban-0");
    click(cx, "ban-reason");
    cx.simulate_keystrokes("ctrl-a f l o o d i n g");
    // The right to ban is taken away while the page is open.
    engine.alter_channel(0, |channel| channel.rights = Rights::only(&[Right::REGISTER]));
    cx.run_until_parked();
    click(cx, "bans-save");
    shell.read_with(cx, |shell, _| {
        let bans = shell.bans_page().expect("the page");
        let refusal = bans.refusal.as_ref().expect("the server's words");
        assert!(refusal.contains("ban list"), "{refusal}");
        assert_eq!(bans.bans[0].reason.as_ref(), "spam", "the server's list, as it was");
        assert!(!bans.dirty && !bans.saving);
    });
    assert!(cx.debug_bounds("bans-refusal").is_some());
}

/// The words of a name, where there is one.
fn words(name: &gpui::SharedString) -> &str {
    name.as_ref()
}

/// The settings, on the Roles page, as a click on its entry opens them.
fn roles_page(cx: &mut TestAppContext) -> (Entity<Shell>, std::sync::Arc<DemoEngine>, &mut VisualTestContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "admin-roles");
    (shell, engine, cx)
}

/// The root's rules the engine was last sent.
fn written_root(engine: &DemoEngine) -> crate::engine::Acl {
    engine
        .actions()
        .into_iter()
        .rev()
        .find_map(|action| match action {
            Action::SetAcl(acl) if acl.channel == 0 => Some(acl),
            _ => None,
        })
        .expect("the root's rules are written")
}

#[gpui::test]
fn roles_open_as_a_page_listing_the_roots_groups(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = roles_page(cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Roles));
        let page = shell.roles_page().expect("the page");
        let names: Vec<_> = page.listed("").iter().map(|role| role.name.to_string()).collect();
        assert_eq!(names, ["moderators"]);
    });
    click(cx, "role-row-0");
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert_eq!(page.editing.as_ref().map(words), Some("moderators"));
        assert!(page.form.is_some());
    });
    // Escape goes back to the list, not out of the settings.
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| {
        assert!(shell.roles_page().expect("the page").editing.is_none());
        assert!(shell.panels.settings.open);
    });
}

#[gpui::test]
fn a_role_is_made_renamed_coloured_and_styled_and_saved_whole(cx: &mut TestAppContext) {
    let (shell, engine, cx) = roles_page(cx);
    click(cx, "roles-create");
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert_eq!(page.editing.as_ref().map(words), Some("Role"));
        assert!(page.dirty);
    });
    click(cx, "role-name");
    cx.simulate_keystrokes("ctrl-a W a r d e n s");
    click(cx, "role-swatch-0");
    click(cx, "role-style");
    click(cx, "role-style-1");
    click(cx, "role-save");
    let acl = written_root(&engine);
    let wardens = acl
        .groups
        .iter()
        .find(|group| group.name.as_ref() == "Wardens")
        .expect("the new role, renamed");
    assert_eq!(wardens.look.color.as_ref().map(words), Some("#5865f2"));
    assert_eq!(wardens.look.style.as_ref().map(words), Some("neon"));
    assert!(acl.groups.iter().any(|group| group.name.as_ref() == "moderators"), "the others kept");
    // Read back: what the server holds, nothing waiting.
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert!(!page.dirty);
        assert_eq!(page.role().map(|role| role.name.to_string()), Some("Wardens".to_owned()));
    });
    let held = Engine::roles(engine.as_ref());
    assert!(held.iter().any(|role| role.name.as_ref() == "Wardens" && role.color.is_some()));
}

#[gpui::test]
fn what_a_role_grants_is_its_own_rule_on_the_root(cx: &mut TestAppContext) {
    let (shell, engine, cx) = roles_page(cx);
    click(cx, "role-row-0");
    click(cx, "role-tab-1");
    click(cx, "grant-kick");
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert_eq!(page.rule().map(|rule| rule.grant), Some(0x1_0000), "made by the first switch");
    });
    click(cx, "grant-kick");
    click(cx, "grant-ban");
    click(cx, "role-save");
    let acl = written_root(&engine);
    let rule = acl
        .rules
        .iter()
        .find(|rule| rule.group.as_ref().map(words) == Some("moderators") && !rule.inherited)
        .expect("the role's rule");
    assert_eq!((rule.grant, rule.deny), (0x2_0000, 0));
}

#[gpui::test]
fn a_roles_members_are_added_by_name_taken_out_and_its_inheritance_set(cx: &mut TestAppContext) {
    let (shell, engine, cx) = roles_page(cx);
    // The registered accounts arrive with the page; Torque is 105.
    click(cx, "role-row-0");
    click(cx, "role-tab-2");
    click(cx, "role-members");
    cx.simulate_keystrokes("T o r");
    click(cx, "role-members-pick-105");
    click(cx, "role-members-remove-103");
    click(cx, "role-excluded");
    cx.simulate_keystrokes("1 2 1 enter");
    click(cx, "role-inherit");
    click(cx, "role-save");
    let acl = written_root(&engine);
    let moderators = acl
        .groups
        .iter()
        .find(|group| group.name.as_ref() == "moderators")
        .expect("the role");
    assert_eq!(moderators.added, [105]);
    assert_eq!(moderators.removed, [121], "kept out, by number");
    assert!(!moderators.inherit);
    shell.read_with(cx, |shell, _| assert!(!shell.roles_page().expect("the page").dirty));
}

#[gpui::test]
fn a_role_is_deleted_with_its_rule(cx: &mut TestAppContext) {
    let (shell, engine, cx) = roles_page(cx);
    click(cx, "role-row-0");
    click(cx, "role-tab-1");
    click(cx, "grant-kick");
    click(cx, "role-save");
    click(cx, "role-row-0");
    click(cx, "role-delete");
    let acl = written_root(&engine);
    assert!(acl.groups.iter().all(|group| group.name.as_ref() != "moderators"));
    assert!(acl.rules.iter().all(|rule| rule.group.as_ref().map(words) != Some("moderators")));
    shell.read_with(cx, |shell, _| {
        assert!(shell.roles_page().expect("the page").editing.is_none(), "back to the list");
    });
}

#[gpui::test]
fn a_role_pill_on_the_users_page_opens_that_role(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = users_page(cx);
    // Rin, fourth by name, is a moderator.
    click(cx, "users-role-3-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Roles));
        let page = shell.roles_page().expect("the page");
        assert_eq!(page.editing.as_ref().map(words), Some("moderators"));
        assert!(page.form.is_some(), "its fields, once the rules came");
    });
}

#[gpui::test]
fn roles_are_offered_only_to_who_may_write_the_roots_rules(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.alter_channel(0, |channel| {
        channel.rights = Rights::only(&[Right::REGISTER, Right::BAN]);
    });
    cx.run_until_parked();
    shell.update(cx, |shell, cx| {
        shell.open_settings(cx);
        shell.open_admin_page(AdminPage::Roles, cx);
    });
    shell.read_with(cx, |shell, _| assert_eq!(shell.admin_page(), None));
}

#[gpui::test]
fn the_roles_page_is_reached_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = roles_page(cx);
    let mut reached = Vec::new();
    for _ in 0..60 {
        cx.simulate_keystrokes("tab");
        if let Some(id) = at(cx) {
            reached.push(id);
        }
    }
    for wanted in ["roles-create", "role-row-0"] {
        assert!(
            reached.iter().any(|id| id.contains(wanted)),
            "Tab never reached `{wanted}`: {reached:?}"
        );
    }
}

#[gpui::test]
fn a_roles_icon_is_set_shown_and_taken_away_within_the_servers_limit(cx: &mut TestAppContext) {
    let (shell, engine, cx) = roles_page(cx);
    click(cx, "role-row-0");
    // A picture file wider than it is tall: its middle, square, is taken.
    let mut file = Vec::new();
    image::RgbaImage::from_pixel(300, 200, image::Rgba([90, 160, 220, 255]))
        .write_to(&mut std::io::Cursor::new(&mut file), image::ImageFormat::Png)
        .expect("a picture file");
    let icon = crate::picture::role_icon(&file).expect("an icon");
    shell.update(cx, |shell, cx| shell.icon_role(Some(icon.clone()), cx));
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert!(page.form.as_ref().expect("the fields").icon.is_some(), "drawn");
        assert_eq!(page.role().and_then(|role| role.look.icon.as_deref()), Some(&icon[..]));
    });
    assert!(cx.debug_bounds("role-icon-remove").is_some());
    click(cx, "role-save");
    let acl = written_root(&engine);
    assert!(acl.groups[0].look.icon.is_some(), "sent");
    // Heavier than the server takes: said, and not given.
    let heavy = vec![0_u8; 2 * 1024 * 1024];
    shell.update(cx, |shell, cx| shell.icon_role(Some(heavy), cx));
    shell.read_with(cx, |shell, _| assert!(shell.notice.is_some()));
    click(cx, "role-icon-remove");
    shell.read_with(cx, |shell, _| {
        let page = shell.roles_page().expect("the page");
        assert!(page.role().is_some_and(|role| role.look.icon.is_none()));
    });
}

/// The Channels / ACL page on the channel `id`, as the channel's menu
/// opens it.
fn acl_page_on<'a>(
    id: &'static str,
    cx: &'a mut TestAppContext,
) -> (Entity<Shell>, std::sync::Arc<DemoEngine>, &'a mut VisualTestContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, id);
    click(cx, "menu-Permissions…");
    (shell, engine, cx)
}

/// The rules of a channel the engine was last sent.
fn written_rules(engine: &DemoEngine, channel: u32) -> crate::engine::Acl {
    engine
        .actions()
        .into_iter()
        .rev()
        .find_map(|action| match action {
            Action::SetAcl(acl) if acl.channel == channel => Some(acl),
            _ => None,
        })
        .expect("the rules are written")
}

#[gpui::test]
fn a_channels_permissions_open_as_a_page_on_that_channel(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = acl_page_on("channel-2", cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.admin_page(), Some(AdminPage::Acl));
        let page = shell.acl_page().expect("the page");
        assert_eq!(page.selected, Some(2));
        assert_eq!(page.acl.as_ref().map(|acl| acl.rules.len()), Some(2));
        assert!(!page.dirty);
    });
    // The tree, from the column's entry: the root open, its channels shown.
    assert!(cx.debug_bounds("acl-channel-3").is_some());
    click(cx, "acl-channel-1");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.acl_page().expect("the page").selected, Some(1));
    });
    click(cx, "acl-branch-0");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.acl_page().expect("the page").expanded.contains(&0), "closed");
    });
}

#[gpui::test]
fn a_rule_is_changed_in_its_card_and_the_rules_saved_whole(cx: &mut TestAppContext) {
    let (shell, engine, cx) = acl_page_on("channel-2", cx);
    // The parent's rule cannot be changed.
    click(cx, "acl-rule-0");
    click(cx, "acl-allow-40");
    shell.read_with(cx, |shell, _| assert!(!shell.acl_page().expect("the page").dirty));
    // The channel's own: speak allowed, enter denied, not for sub-channels.
    click(cx, "acl-rule-1");
    click(cx, "acl-allow-8");
    click(cx, "acl-deny-4");
    click(cx, "acl-subs");
    // What means something at the root only is offered there only.
    assert!(cx.debug_bounds("acl-allow-10000").is_none());
    // A new rule, for a group typed in.
    click(cx, "acl-add-rule");
    click(cx, "acl-rule-2");
    click(cx, "acl-rule-group");
    cx.simulate_keystrokes("ctrl-a m o d s");
    click(cx, "acl-allow-1000");
    click(cx, "acl-save");
    let saved = written_rules(&engine, 2);
    assert_eq!(saved.rules.len(), 3);
    let auth = &saved.rules[1];
    assert_eq!((auth.grant, auth.deny), (0x40 | 0x8, 0x4));
    assert!(auth.here && !auth.subs);
    let mods = &saved.rules[2];
    assert_eq!(mods.group.as_ref().map(AsRef::as_ref), Some("mods"));
    assert_eq!(mods.grant, 0x1000);
    // Taken out again: the rule's own way out.
    click(cx, "acl-rule-remove-2");
    shell.read_with(cx, |shell, _| {
        let page = shell.acl_page().expect("the page");
        assert_eq!(page.acl.as_ref().map(|acl| acl.rules.len()), Some(2));
        assert!(page.dirty);
    });
}

#[gpui::test]
fn a_channels_groups_are_made_named_and_filled_by_name_or_number(cx: &mut TestAppContext) {
    let (shell, engine, cx) = acl_page_on("channel-1", cx);
    click(cx, "acl-tab-1");
    // The parent's group is read here, not changed.
    assert!(cx.debug_bounds("acl-group-remove-0").is_none());
    click(cx, "acl-add-group");
    click(cx, "acl-group-name-1");
    cx.simulate_keystrokes("ctrl-a w a r d e n s");
    click(cx, "acl-group-add-1");
    cx.simulate_keystrokes("F l o r a enter");
    click(cx, "acl-group-exclude-1");
    cx.simulate_keystrokes("1 0 3 enter");
    click(cx, "acl-group-inheritable-1");
    click(cx, "acl-save");
    let saved = written_rules(&engine, 1);
    let wardens = saved
        .groups
        .iter()
        .find(|group| group.name.as_ref() == "wardens")
        .expect("the new group, named");
    assert_eq!((&wardens.added, &wardens.removed), (&vec![102], &vec![103]));
    assert!(!wardens.inheritable);
    assert!(saved.groups.iter().any(|group| group.name.as_ref() == "moderators"), "the parent's kept");
    shell.read_with(cx, |shell, _| assert!(!shell.acl_page().expect("the page").dirty));
}

#[gpui::test]
fn who_a_channels_rules_let_in_is_shown_and_its_inheritance_switched(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = acl_page_on("channel-1", cx);
    click(cx, "acl-tab-2");
    // Everybody may enter the lounge, by its parent's rule.
    assert!(cx.debug_bounds("acl-access-everybody").is_some());
    click(cx, "acl-inherit");
    click(cx, "acl-save");
    assert!(!written_rules(&engine, 1).inherit);
}

#[gpui::test]
fn the_tree_is_narrowed_and_a_channel_deleted_from_its_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "admin-acl");
    // Nobody is in the studio or afk: hidden with the empty channels.
    click(cx, "acl-hide-empty");
    shell.read_with(cx, |shell, _| {
        assert!(shell.acl_page().expect("the page").filters.empty);
    });
    click(cx, "acl-hide-empty");
    // Rules of their own: every channel's rules are asked for.
    click(cx, "acl-own-rules");
    shell.read_with(cx, |shell, _| {
        assert!(shell.acl_page().expect("the page").own_rules.len() >= 4, "each channel's, read");
    });
    click(cx, "acl-own-rules");
    right_click(cx, "acl-channel-3");
    click(cx, "menu-acl-delete");
    click(cx, "prompt-ok");
    assert_eq!(engine.actions().last(), Some(&Action::DeleteChannel { channel: 3 }));
}

#[gpui::test]
fn the_acl_page_is_offered_only_to_who_may_write_a_channels_rules(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    for id in 0..=3 {
        engine.alter_channel(id, |channel| channel.rights = Rights::only(&[Right::REGISTER]));
    }
    cx.run_until_parked();
    shell.update(cx, |shell, cx| {
        shell.open_settings(cx);
        shell.open_admin_page(AdminPage::Acl, cx);
    });
    shell.read_with(cx, |shell, _| assert_eq!(shell.admin_page(), None));
}

#[gpui::test]
fn the_acl_page_is_reached_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = acl_page_on("channel-1", cx);
    let mut reached = Vec::new();
    for _ in 0..80 {
        cx.simulate_keystrokes("tab");
        if let Some(id) = at(cx) {
            reached.push(id);
        }
    }
    for wanted in ["acl-channel-1", "acl-inherit", "acl-add-rule", "acl-rule-1", "acl-hide-empty"] {
        assert!(
            reached.iter().any(|id| id.contains(wanted)),
            "Tab never reached `{wanted}`: {reached:?}"
        );
    }
}
