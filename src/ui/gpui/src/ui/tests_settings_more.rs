//! The settings pages built after the first round, worked as a person
//! works them: the Account page against the demo server's account desk,
//! which answers as Starling does.

use gpui::{Entity, TestAppContext, VisualTestContext, px};

use super::Shell;
use super::settings::Page;
use super::tests::{click, shell, shell_on};
use crate::demo::DemoEngine;
use crate::engine::{AccountSettings, Engine};

/// Scroll the open page until `selector` is in view.
fn bring(shell: &Entity<Shell>, cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("nothing on the page is tagged `{selector}`"));
    shell.update(cx, |shell, cx| {
        if let Some(search) = &shell.panels.settings.search {
            let (view, at) = (search.scroll.bounds(), search.scroll.offset());
            let y = at.y - (bounds.top() - view.top() - px(60.0));
            search.scroll.set_offset(gpui::point(at.x, y.min(px(0.0))));
        }
        cx.notify();
    });
    cx.run_until_parked();
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
}

/// Scroll to `selector` and click it.
fn reach(shell: &Entity<Shell>, cx: &mut VisualTestContext, selector: &'static str) {
    bring(shell, cx, selector);
    click(cx, selector);
}

/// Click into the field tagged `selector` and type `text` there, over what
/// it held.
fn type_into(shell: &Entity<Shell>, cx: &mut VisualTestContext, selector: &'static str, text: &str) {
    reach(shell, cx, selector);
    cx.simulate_keystrokes("ctrl-a");
    cx.simulate_input(text);
    cx.run_until_parked();
}

/// The account as the shell's page holds it.
fn shown(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> AccountSettings {
    shell.read_with(cx, |shell, _| {
        shell
            .panels
            .settings
            .account
            .as_ref()
            .and_then(|page| page.snapshot().cloned())
            .expect("the account is shown")
    })
}

/// A shell on the demo server with the Account page open.
fn on_account(cx: &mut TestAppContext) -> (Entity<Shell>, std::sync::Arc<DemoEngine>, &mut VisualTestContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-account");
    (shell, engine, cx)
}

#[gpui::test]
fn the_account_page_is_offered_to_a_registered_user_on_a_server_that_answers(
    cx: &mut TestAppContext,
) {
    let (shell, _engine, cx) = on_account(cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.settings.page, Page::Account);
        assert!(shell.account_offered());
    });
    let overview = cx.debug_bounds("account-overview").expect("the overview");
    assert!(overview.size.height > px(40.0));
    let account = shown(&shell, cx);
    assert_eq!(account.name.as_deref(), Some("Alex"));
    assert!(!account.has_password);
}

#[gpui::test]
fn a_server_without_fancy_mumble_has_no_account_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::plain(), cx);
    cx.simulate_keystrokes("ctrl-,");
    shell.read_with(cx, |shell, _| assert!(!shell.account_offered()));
    // Searching for it finds nothing either: the page is not there.
    click(cx, "input-Search settings");
    cx.simulate_input("2fa");
    cx.run_until_parked();
    shell.read_with(cx, |shell, cx| {
        let typed = shell.panels.settings.search.as_ref().map(|s| s.field.read(cx).text().to_owned());
        assert_eq!(typed.as_deref(), Some("2fa"));
    });
    assert!(cx.debug_bounds("found-account").is_none());
}

#[gpui::test]
fn a_password_set_from_the_page_then_proves_every_change(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    type_into(&shell, cx, "account-password", "short");
    type_into(&shell, cx, "account-repeat", "short");
    // Too short: the button does nothing.
    reach(&shell, cx, "account-password-save");
    assert!(!engine.account().expect("held").has_password);
    for field in ["account-password", "account-repeat"] {
        type_into(&shell, cx, field, "short and long enough");
    }
    reach(&shell, cx, "account-password-save");
    assert!(engine.account().expect("held").has_password);
    assert!(shown(&shell, cx).has_password, "the page shows what the server said");
    // The fields that were typed are let go of once it is done.
    shell.read_with(cx, |shell, cx| {
        let page = shell.panels.settings.account.as_ref().expect("open");
        assert!(page.typed_password(cx).is_empty());
    });
    // From now on a change waits for the password.
    type_into(&shell, cx, "account-name", "Kim");
    reach(&shell, cx, "account-rename");
    assert_eq!(engine.account().expect("held").name.as_deref(), Some("Alex"));
    type_into(&shell, cx, "account-current", "short and long enough");
    reach(&shell, cx, "account-rename");
    assert_eq!(engine.account().expect("held").name.as_deref(), Some("Kim"));
    // The server says so of the user, and the overview reads it.
    shell.read_with(cx, |shell, _| {
        let own = shell.snapshot.users.iter().find(|user| Some(user.session) == shell.snapshot.own_session);
        assert_eq!(own.map(|user| user.name.as_ref()), Some("Kim"));
    });
}

#[gpui::test]
fn a_wrong_password_is_said_on_the_row_of_the_change(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    for field in ["account-password", "account-repeat"] {
        type_into(&shell, cx, field, "correct horse");
    }
    reach(&shell, cx, "account-password-save");
    type_into(&shell, cx, "account-current", "wrong horse");
    type_into(&shell, cx, "account-email", "alex@example.org");
    reach(&shell, cx, "account-email-save");
    assert_eq!(engine.account().expect("held").email, None);
    shell.read_with(cx, |shell, _| {
        let page = shell.panels.settings.account.as_ref().expect("open");
        assert_eq!(
            page.refusal_of(super::settings::account::ids::SET_EMAIL).as_deref(),
            Some("the current password is wrong")
        );
    });
}

#[gpui::test]
fn two_factor_is_enrolled_from_its_code_and_turned_off_with_another(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    reach(&shell, cx, "account-totp-begin");
    assert!(cx.debug_bounds("account-totp-qr").is_some(), "the code to scan");
    // The ways in for those who cannot scan, one behind the other.
    reach(&shell, cx, "account-totp-cant-scan");
    assert!(cx.debug_bounds("account-totp-uri").is_some());
    reach(&shell, cx, "account-totp-reveal");
    assert!(cx.debug_bounds("account-totp-secret").is_some());
    // A wrong code is refused on its row; letters are not typed.
    type_into(&shell, cx, "account-totp-code", "000a000");
    reach(&shell, cx, "account-totp-verify");
    assert!(!engine.account().expect("held").totp_enabled);
    shell.read_with(cx, |shell, _| {
        let page = shell.panels.settings.account.as_ref().expect("open");
        assert_eq!(
            page.refusal_of(super::settings::account::ids::TOTP_VERIFY).as_deref(),
            Some("totp_wrong_code")
        );
    });
    type_into(&shell, cx, "account-totp-code", "123456");
    reach(&shell, cx, "account-totp-verify");
    assert!(engine.account().expect("held").totp_enabled);
    type_into(&shell, cx, "account-totp-off-code", "654321");
    reach(&shell, cx, "account-totp-disable");
    assert!(!engine.account().expect("held").totp_enabled);
}

#[gpui::test]
fn a_device_is_renamed_and_another_signed_out_only_once_asked(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    // This device first, then the phone online, then the old desktop.
    let names = |engine: &DemoEngine| -> Vec<String> {
        let account = engine.account().expect("held");
        super::settings::account::device_names(&account)
    };
    assert_eq!(names(&engine), ["This laptop", "Phone", "Old desktop"]);
    reach(&shell, cx, "account-device-rename-1");
    type_into(&shell, cx, "account-device-name", "Phone 2");
    reach(&shell, cx, "account-device-save");
    assert_eq!(names(&engine)[1], "Phone 2");
    // The device one is on cannot be signed out from here.
    assert!(cx.debug_bounds("account-device-sign-out-0").is_none());
    reach(&shell, cx, "account-device-sign-out-2");
    assert_eq!(names(&engine).len(), 3, "asked first");
    reach(&shell, cx, "account-device-sign-out-confirm");
    assert_eq!(names(&engine), ["This laptop", "Phone 2"]);
    assert!(engine.account().expect("held").devices_locked);
}

#[gpui::test]
fn the_registration_is_deleted_only_once_its_name_is_typed(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    reach(&shell, cx, "account-doom");
    type_into(&shell, cx, "account-doom", "Alix");
    reach(&shell, cx, "account-doom-confirm");
    assert!(engine.account().expect("held").registered, "the wrong name");
    type_into(&shell, cx, "account-doom", "Alex");
    reach(&shell, cx, "account-doom-confirm");
    assert!(!engine.account().expect("held").registered);
    // A guest now: the page is no longer offered.
    shell.read_with(cx, |shell, _| assert!(!shell.account_offered()));
}

#[gpui::test]
fn a_new_device_is_offered_the_account_and_the_offer_withdrawn(cx: &mut TestAppContext) {
    let (shell, engine, cx) = on_account(cx);
    reach(&shell, cx, "account-link-begin");
    assert!(cx.debug_bounds("account-link-qr").is_some());
    assert!(cx.debug_bounds("account-link-code").is_some());
    let waiting = |engine: &DemoEngine| {
        engine
            .account()
            .expect("held")
            .devices
            .iter()
            .any(|device| device.last_seen_ms == 0)
    };
    assert!(waiting(&engine), "registered ahead");
    reach(&shell, cx, "account-link-close");
    assert!(!waiting(&engine), "withdrawn");
}

/// The questions as the demo server keeps the answers to them.
fn kept(engine: &DemoEngine) -> Vec<(String, Vec<String>)> {
    engine
        .questions()
        .response
        .iter()
        .flat_map(|response| response.selections.iter())
        .map(|selection| (selection.question_id.clone(), selection.answer_ids.clone()))
        .collect()
}

/// The words of the chips tagged `tag` on the page, as drawn.
fn asking_step(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> Option<usize> {
    shell.read_with(cx, |shell, _| {
        shell.panels.settings.onboarding.asking.as_ref().map(|asking| asking.step)
    })
}

#[gpui::test]
fn channels_and_roles_show_what_the_answers_give_and_are_answered_again(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-channels-roles");
    assert!(cx.debug_bounds("visible-channels").is_some());
    assert!(cx.debug_bounds("your-roles").is_some());
    shell.read_with(cx, |shell, _| {
        let response = shell.panels.settings.onboarding.response.as_ref();
        let config = shell.engine.onboarding_config().expect("questions");
        assert_eq!(crate::engine::visible_channels(&config, response), [1, 2]);
        assert_eq!(crate::engine::role_labels(&config, response), ["musicians"]);
    });
    // Changed: the answers kept are ticked to begin with.
    reach(&shell, cx, "onboarding-change");
    assert_eq!(asking_step(&shell, cx), Some(0));
    click(cx, "onboarding-next");
    click(cx, "onboarding-answer-1");
    click(cx, "onboarding-next");
    click(cx, "onboarding-answer-1");
    click(cx, "onboarding-next");
    assert_eq!(asking_step(&shell, cx), None, "finished");
    assert_eq!(
        kept(&engine),
        [
            ("why".to_owned(), vec!["listen".to_owned(), "music".to_owned()]),
            ("when".to_owned(), vec!["weekends".to_owned()]),
        ]
    );
    shell.read_with(cx, |shell, _| {
        let response = shell.panels.settings.onboarding.response.as_ref();
        let config = shell.engine.onboarding_config().expect("questions");
        assert_eq!(crate::engine::visible_channels(&config, response), [1, 2, 3]);
        assert_eq!(
            crate::engine::role_labels(&config, response),
            ["musicians", "listeners"]
        );
    });
}

#[gpui::test]
fn starting_over_asks_with_nothing_ticked_and_a_required_question_holds_the_way_on(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-channels-roles");
    reach(&shell, cx, "onboarding-reset");
    click(cx, "onboarding-next");
    // Required, and nothing chosen: Next does nothing.
    click(cx, "onboarding-next");
    assert_eq!(asking_step(&shell, cx), Some(1));
    click(cx, "onboarding-answer-0");
    click(cx, "onboarding-next");
    click(cx, "onboarding-back");
    assert_eq!(asking_step(&shell, cx), Some(1));
    // The demo kept its answers until the new ones are finished.
    assert_eq!(kept(&engine), [("why".to_owned(), vec!["music".to_owned()])]);
}

#[gpui::test]
fn the_questions_are_asked_by_themselves_until_skipped(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert_eq!(asking_step(&shell, cx), None, "answered: not asked on connecting");
    engine.questions().response = None;
    shell.update(cx, |shell, cx| {
        shell.onboarding_news(crate::engine::OnboardingNews::Response(None), cx);
    });
    cx.run_until_parked();
    assert_eq!(asking_step(&shell, cx), Some(0), "owed: asked");
    assert!(cx.debug_bounds("onboarding-title").is_some());
    click(cx, "onboarding-skip");
    assert_eq!(asking_step(&shell, cx), None);
    shell.update(cx, |shell, cx| {
        shell.onboarding_news(crate::engine::OnboardingNews::Config, cx);
    });
    cx.run_until_parked();
    assert_eq!(asking_step(&shell, cx), None, "skipped on this server");
}

#[gpui::test]
fn a_server_without_onboarding_has_no_channels_and_roles_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::plain(), cx);
    cx.simulate_keystrokes("ctrl-,");
    shell.read_with(cx, |shell, _| {
        assert!(!Page::ChannelsRoles.shown(shell));
        assert!(!shell.engine.onboarding_offered());
    });
}

#[gpui::test]
fn the_plugins_page_lists_what_the_server_runs_and_where_the_bridge_stands(
    cx: &mut TestAppContext,
) {
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-plugins");
    assert!(cx.debug_bounds("signal-bridge").is_some());
    assert!(cx.debug_bounds("plugin-0").is_some());
    assert!(cx.debug_bounds("plugin-1").is_some());
    shell.read_with(cx, |shell, _| {
        let plugins = &shell.panels.settings.plugins;
        assert_eq!(plugins.listed[0].capabilities, ["slash_commands", "settings_panel"]);
        assert!(plugins.bridge.is_some_and(|bridge| !bridge.installed));
    });
}

#[gpui::test]
fn a_server_without_plugins_has_no_plugins_page(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::plain(), cx);
    cx.simulate_keystrokes("ctrl-,");
    shell.read_with(cx, |shell, _| assert!(!Page::Plugins.shown(shell)));
}

#[gpui::test]
fn a_jump_key_finds_somebody_on_another_server_and_turns_to_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine
        .elsewhere()
        .people
        .push(("other-server".to_owned(), 42, "far-hash".to_owned()));
    shell.update(cx, |shell, _| {
        shell.panels.settings.jumps.push(crate::store::UserShortcut {
            id: "us-1".to_owned(),
            hotkey: "Ctrl+Alt+2".to_owned(),
            user_name: "Wanderer".to_owned(),
            user_hash: Some("far-hash".to_owned()),
            server_id: None,
            server_label: None,
        });
    });
    let pressed = gpui::Keystroke::parse("ctrl-alt-2").expect("a key");
    let heard = shell.update(cx, |shell, cx| shell.hear_jump_key(&pressed, cx));
    assert!(heard);
    assert_eq!(engine.elsewhere().turned_to.as_deref(), Some("other-server"));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(crate::engine::Conversation::Direct(42)));
    });
}

#[gpui::test]
fn a_named_whisper_target_is_made_bound_held_and_kept(cx: &mut TestAppContext) {
    let dir = std::env::temp_dir().join(format!("fancy-gpui-more-whispers-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, _| shell.store = Some(crate::store::Store::new(&dir)));
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-shortcuts");
    reach(&shell, cx, "whisper-add");
    // Somebody picked from who is here: the second choice is the first of
    // them, Flora.
    reach(&shell, cx, "whisper-pick");
    click(cx, "whisper-pick-1");
    reach(&shell, cx, "whisper-save");
    let target = shell.read_with(cx, |shell, _| shell.panels.settings.whispers.targets[0].clone());
    assert_eq!(target.name, "Whisper 1");
    assert_eq!(target.users[0].name, "Flora");
    assert_eq!(target.users[0].hash.as_deref(), Some("h2"), "kept by certificate");
    // Registered ahead in its own slot, the first after the menu's whisper.
    assert_eq!(engine.elsewhere().slots.get(&2).map(|reach| reach.sessions.clone()), Some(vec![2]));
    // Its key chosen by pressing it, then held to whisper and let go.
    reach(&shell, cx, "whisper-key-0");
    cx.simulate_keystrokes("ctrl-alt-3");
    let kept = shell.read_with(cx, |shell, _| shell.panels.settings.whispers.targets[0].hotkey.clone());
    assert_eq!(kept, "Ctrl+Alt+3");
    let pressed = gpui::Keystroke::parse("ctrl-alt-3").expect("a key");
    assert!(shell.update(cx, |shell, cx| shell.hear_whisper_key(&pressed, cx)));
    assert_eq!(engine.elsewhere().whispering, Some(2));
    assert!(shell.update(cx, |shell, _| shell.release_whisper_key(&pressed)));
    assert_eq!(engine.elsewhere().whispering, None);
    // Kept across a restart.
    let stored = crate::store::Store::new(&dir).settings().whisper_targets;
    assert_eq!(stored, [crate::store::WhisperBinding { hotkey: "Ctrl+Alt+3".into(), ..target }]);
    let _ = std::fs::remove_dir_all(dir);
}

#[gpui::test]
fn a_shout_to_the_current_channel_follows_the_user_and_a_removed_target_frees_its_slot(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-shortcuts");
    reach(&shell, cx, "whisper-add");
    reach(&shell, cx, "whisper-kind-1");
    reach(&shell, cx, "whisper-mode-1");
    reach(&shell, cx, "whisper-links");
    reach(&shell, cx, "whisper-save");
    let reach_now = engine.elsewhere().slots.get(&2).cloned().expect("registered");
    assert_eq!((reach_now.channel, reach_now.links), (Some(1), true));
    reach(&shell, cx, "whisper-remove-0");
    assert!(engine.elsewhere().slots.is_empty(), "its slot emptied");
}
