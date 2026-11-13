//! The shell, driven the way a person drives it: clicks and keys against a
//! window that exists only in memory.

use std::sync::Arc;

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use crate::demo::DemoEngine;
use crate::engine::{Action, Connection, Conversation, Engine, Voice};
use crate::theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};

/// A shell on a fresh demo server, in the default theme.
fn shell(cx: &mut TestAppContext) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    shell_on(DemoEngine::new(), cx)
}

/// A shell on `engine`, in the default theme.
fn shell_on(
    engine: DemoEngine,
    cx: &mut TestAppContext,
) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    cx.update(|cx| {
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let engine = Arc::new(engine);
    let for_shell: Arc<dyn Engine> = engine.clone();
    let (shell, cx) = cx.add_window_view(|window, cx| Shell::new(for_shell, None, window, cx));
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

/// Choose `entry` from the local user's own menu, on their tile: the way to
/// the view's panels.
#[track_caller]
fn own_menu(cx: &mut VisualTestContext, entry: &'static str) {
    click(cx, "own-menu");
    click(cx, entry);
}

/// Right-click the middle of the element tagged `selector`.
#[track_caller]
fn right_click(cx: &mut VisualTestContext, selector: &'static str) {
    let at = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("nothing on screen is tagged `{selector}`"))
        .center();
    cx.simulate_mouse_down(at, gpui::MouseButton::Right, Modifiers::none());
    cx.simulate_mouse_up(at, gpui::MouseButton::Right, Modifiers::none());
    cx.run_until_parked();
}

#[gpui::test]
fn opens_on_the_current_channel_and_its_history(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.open_title().as_deref(), Some("#lounge"));
        assert_eq!(shell.messages.len(), 5);
        assert_eq!(shell.rows.item_count(), 6, "five messages under a day rule");
        assert_eq!(shell.composer.read(cx).placeholder(), "Message #lounge");
    });
}

#[gpui::test]
fn clicking_a_channel_reads_it_and_join_moves_into_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "channel-2");
    assert_eq!(
        engine.snapshot().current_channel,
        Some(1),
        "still in the lounge"
    );
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.open, Some(Conversation::Channel(2)));
        assert_eq!(shell.open_title().as_deref(), Some("#studio"));
        assert!(shell.messages.is_empty(), "the studio has no history");
        assert_eq!(shell.rows.item_count(), 0);
        assert_eq!(shell.composer.read(cx).placeholder(), "Message #studio");
    });
    click(cx, "join");
    assert_eq!(engine.snapshot().current_channel, Some(2));
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.open,
            Some(Conversation::Channel(2)),
            "and still reading it"
        );
    });
}

#[gpui::test]
fn clicking_a_user_opens_a_direct_conversation(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "user-3");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.open, Some(Conversation::Direct(3)));
        assert_eq!(shell.open_title().as_deref(), Some("@Rin"));
        assert_eq!(shell.composer.read(cx).placeholder(), "Message @Rin");
        assert!(shell.messages.is_empty());
    });
    click(cx, "input-Message @Rin");
    cx.simulate_keystrokes("h i enter");
    let direct = engine.messages(Conversation::Direct(3));
    assert_eq!(direct.len(), 1);
    assert_eq!(
        engine.messages(Conversation::Channel(1)).len(),
        5,
        "not in the channel"
    );
    shell.read_with(cx, |shell, _| assert_eq!(shell.messages.len(), 1));
    // Clicking oneself opens nothing.
    click(cx, "user-1");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(Conversation::Direct(3)))
    });
}

#[gpui::test]
fn the_channel_conversation_follows_the_user_unless_they_read_elsewhere(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.join_channel(2);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.open,
            Some(Conversation::Channel(2)),
            "followed the move"
        );
    });
    click(cx, "user-3");
    engine.join_channel(3);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.open,
            Some(Conversation::Direct(3)),
            "the direct message stays"
        );
    });
}

#[gpui::test]
fn typing_and_enter_sends_a_message_and_empties_the_composer(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i space t h e r e enter");
    let sent = engine.messages(Conversation::Channel(1));
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
            .map(|(channel, _)| channel.name.as_ref())
            .collect();
        assert_eq!(listed, ["studio"]);
    });
    // Enter in the search field sends nothing.
    cx.simulate_keystrokes("enter");
    assert_eq!(engine.messages(Conversation::Channel(1)).len(), 5);
}

#[gpui::test]
fn the_voice_buttons_turn_voice_on_mute_and_deafen(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert_eq!(
        engine.snapshot().voice,
        Voice::Off,
        "the demo starts with voice off"
    );
    click(cx, "mute");
    assert_eq!(
        engine.snapshot().voice,
        Voice::On,
        "the first press turns voice on"
    );
    click(cx, "mute");
    assert_eq!(engine.snapshot().voice, Voice::Muted);
    click(cx, "deafen");
    assert!(engine.snapshot().deafened);
    shell.read_with(cx, |shell, _| {
        assert!(shell.snapshot.deafened, "the view has seen it");
    });
    click(cx, "deafen");
    assert!(!engine.snapshot().deafened);
}

#[gpui::test]
fn the_picker_opens_switches_theme_and_mode(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, _| {
        assert!(!shell.picker_open, "closed at first")
    });
    own_menu(cx, "menu-Themes…");
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
    own_menu(cx, "menu-Themes…");
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

#[gpui::test]
fn a_launch_lands_on_the_first_saved_server(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.snapshot.connection, Connection::Disconnected);
        let listed: Vec<_> = shell
            .listed_servers(cx)
            .iter()
            .map(|server| (server.key.clone(), server.identities.len()))
            .collect();
        assert_eq!(
            listed,
            [
                ("magical.rocks:64738".to_owned(), 2),
                ("kumo.jp:64738".to_owned(), 1),
                ("localhost:64738".to_owned(), 1),
            ]
        );
        let server = shell.selected_server().expect("a server is showing");
        assert_eq!(server.key, "magical.rocks:64738");
        let identity = shell.selected_identity().expect("an identity is chosen");
        assert_eq!(identity.id.as_ref(), "magical-alex");
    });
}

#[gpui::test]
fn picking_an_identity_and_connecting_arrives_on_the_server(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "identity-magical-work");
    shell.read_with(cx, |shell, _| {
        let identity = shell.selected_identity().expect("an identity is chosen");
        assert_eq!(identity.username.as_ref(), "Alex (work)");
    });
    click(cx, "connect");
    assert_eq!(engine.snapshot().connection, Connection::Connected);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.snapshot.connection, Connection::Connected);
        assert_eq!(shell.open_title().as_deref(), Some("#lounge"));
        assert_eq!(shell.messages.len(), 5, "the channel's history is loaded");
    });
}

#[gpui::test]
fn picking_another_server_forgets_the_identity_picked_before(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "identity-magical-work");
    click(cx, "server-kumo.jp:64738");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.selected_server().map(|server| server.key),
            Some("kumo.jp:64738".to_owned())
        );
        // Not the identity of the server left behind: this one's own.
        let identity = shell.selected_identity().expect("an identity is chosen");
        assert_eq!(identity.id.as_ref(), "kumo");
    });
}

#[gpui::test]
fn leaving_returns_to_the_saved_servers(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "leave");
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.snapshot.connection, Connection::Disconnected);
        assert!(
            shell.messages.is_empty(),
            "nothing of the server is kept on screen"
        );
        assert_eq!(shell.rows.item_count(), 0);
    });
}

#[gpui::test]
fn the_server_search_narrows_the_list(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "input-Search servers");
    cx.simulate_keystrokes("k u m");
    shell.read_with(cx, |shell, cx| {
        let listed: Vec<_> = shell
            .listed_servers(cx)
            .iter()
            .map(|server| server.host.to_string())
            .collect();
        assert_eq!(listed, ["kumo.jp"]);
    });
}

#[gpui::test]
fn the_channel_column_lists_the_tree_in_order(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, cx| {
        let listed: Vec<_> = shell
            .listed_channels(cx)
            .iter()
            .map(|(channel, depth)| (channel.name.to_string(), *depth))
            .collect();
        assert_eq!(
            listed,
            [
                ("Root".to_owned(), 0),
                ("afk".to_owned(), 1),
                ("lounge".to_owned(), 1),
                ("studio".to_owned(), 1),
            ]
        );
    });
}

#[gpui::test]
fn adding_a_server_through_the_dialog_saves_and_selects_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let before = engine.saved_servers().len();
    click(cx, "add-server");
    shell.read_with(cx, |shell, _| assert!(shell.editor.is_some()));
    // The address has the keyboard; tab reaches the port, then the name.
    cx.simulate_keystrokes("n e w . e x a m p l e tab 1 2 3 4 tab z o e");
    click(cx, "editor-save");
    let saved = engine.saved_servers();
    assert_eq!(saved.len(), before + 1);
    let added = saved.last().expect("the new identity");
    assert_eq!(
        (added.host.as_ref(), added.port, added.username.as_ref()),
        ("new.example", 1234, "zoe")
    );
    assert_eq!(added.certificate.as_ref().map(AsRef::as_ref), Some("zoe"));
    shell.read_with(cx, |shell, _| {
        assert!(shell.editor.is_none(), "the dialog closed");
        assert_eq!(shell.servers.len(), before + 1, "the list has it");
        assert_eq!(
            shell.selected_server().map(|server| server.key),
            Some("new.example:1234".to_owned())
        );
    });
}

#[gpui::test]
fn the_dialog_refuses_what_cannot_be_connected_to(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let before = engine.saved_servers().len();
    click(cx, "add-server");
    click(cx, "editor-save");
    assert_eq!(engine.saved_servers().len(), before, "nothing was saved");
    shell.read_with(cx, |shell, _| {
        assert!(shell.editor.is_some(), "the dialog stays open")
    });
    cx.simulate_keystrokes("escape");
    shell.read_with(cx, |shell, _| {
        assert!(shell.editor.is_none(), "escape closes it")
    });
}

#[gpui::test]
fn an_identity_can_be_edited_and_forgotten(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let before = engine.saved_servers().len();
    click(cx, "edit-magical-work");
    // The address has the keyboard; two tabs on is the name.
    cx.simulate_keystrokes(
        "tab tab backspace backspace backspace backspace backspace backspace enter",
    );
    let renamed = engine
        .saved_servers()
        .into_iter()
        .find(|saved| saved.id == "magical-work")
        .expect("still saved");
    assert_eq!(
        renamed.username.as_ref(),
        "Alex",
        "the suffix went, and the space with it"
    );
    click(cx, "edit-magical-work");
    click(cx, "editor-delete");
    assert_eq!(engine.saved_servers().len(), before - 1);
    shell.read_with(cx, |shell, _| assert!(shell.editor.is_none()));
}

#[gpui::test]
fn a_notice_from_the_engine_is_shown_until_cleared(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    engine.notify(Some("Wrong password"));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.notice.as_ref().map(AsRef::as_ref),
            Some("Wrong password")
        );
    });
    engine.notify(None);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.notice.is_none()));
}

#[gpui::test]
fn a_notice_while_connected_can_be_dismissed(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.notify(Some("The microphone could not be opened"));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.notice.is_some()));
    click(cx, "dismiss-notice");
    shell.read_with(cx, |shell, _| assert!(shell.notice.is_none()));
}

#[gpui::test]
fn the_send_button_sends_what_was_typed(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "send");
    assert_eq!(
        engine.messages(Conversation::Channel(1)).len(),
        5,
        "an empty composer sends nothing"
    );
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("o k");
    click(cx, "send");
    let sent = engine.messages(Conversation::Channel(1));
    assert_eq!(
        sent.last().map(|message| message.body.to_string()),
        Some("ok".to_owned())
    );
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "")
    });
}

#[gpui::test]
fn focus_search_goes_to_the_list_that_is_showing(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update_in(cx, Shell::focus_search);
    cx.simulate_keystrokes("a f");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.search.read(cx).text(), "af");
        assert_eq!(shell.server_search.read(cx).text(), "");
    });
}

#[gpui::test]
fn dismiss_closes_the_dialog_before_the_picker(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    click(cx, "themes");
    click(cx, "add-server");
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| {
        assert!(
            shell.editor.is_none() && shell.picker_open,
            "the dialog first"
        );
    });
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(!shell.picker_open));
}

#[gpui::test]
fn the_device_panel_lists_devices_and_takes_a_choice(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    own_menu(cx, "menu-Voice settings…");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let devices = shell.devices.as_ref().expect("the devices arrived");
        assert_eq!(devices.inputs.len(), 2);
        assert_eq!(devices.outputs.len(), 2);
    });
    click(cx, "output-USB Headset");
    assert_eq!(
        engine.chosen_devices().output.as_ref().map(AsRef::as_ref),
        Some("USB Headset")
    );
    assert_eq!(
        engine.chosen_devices().input,
        None,
        "the microphone is untouched"
    );
    click(cx, "input-USB Headset");
    click(cx, "output-default");
    let chosen = engine.chosen_devices();
    assert_eq!(
        chosen.input.as_ref().map(AsRef::as_ref),
        Some("USB Headset")
    );
    assert_eq!(chosen.output, None, "back to the system's default");
    own_menu(cx, "menu-Voice settings…");
    shell.read_with(cx, |shell, _| assert!(!shell.devices_open));
}

#[gpui::test]
fn push_to_talk_transmits_while_its_key_is_held(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    own_menu(cx, "menu-Voice settings…");
    click(cx, "push-to-talk");
    assert!(engine.voice_settings().push_to_talk);
    // Choose the key: the next one pressed.
    click(cx, "push-to-talk-key");
    cx.simulate_keystrokes("f9");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.ptt.key.as_ref().map(AsRef::as_ref), Some("f9"));
        assert!(!shell.ptt.choosing);
    });
    assert_eq!(
        engine.snapshot().voice,
        Voice::Off,
        "choosing the key is not pressing it"
    );

    let key = gpui::Keystroke::parse("f9").expect("a key");
    cx.simulate_event(gpui::KeyDownEvent {
        keystroke: key.clone(),
        is_held: false,
    });
    cx.run_until_parked();
    assert_eq!(engine.snapshot().voice, Voice::On, "held: transmitting");
    cx.simulate_event(gpui::KeyUpEvent { keystroke: key });
    cx.run_until_parked();
    assert_eq!(engine.snapshot().voice, Voice::Muted, "released: silent");
}

#[gpui::test]
fn another_key_is_not_push_to_talk_and_still_types(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    own_menu(cx, "menu-Voice settings…");
    click(cx, "push-to-talk");
    click(cx, "push-to-talk-key");
    cx.simulate_keystrokes("f9");
    own_menu(cx, "menu-Voice settings…");
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i");
    assert_eq!(engine.snapshot().voice, Voice::Off);
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "hi")
    });
}

#[gpui::test]
fn the_voice_switches_and_the_activation_level_reach_the_engine(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    own_menu(cx, "menu-Voice settings…");
    let before = engine.voice_settings();
    click(cx, "noise-suppression");
    click(cx, "automatic-gain");
    click(cx, "threshold-up");
    let after = engine.voice_settings();
    assert_eq!(after.noise_suppression, !before.noise_suppression);
    assert_eq!(after.automatic_gain, !before.automatic_gain);
    assert!(after.threshold > before.threshold);
    click(cx, "threshold-down");
    assert!((engine.voice_settings().threshold - before.threshold).abs() < 1e-6);

    click(cx, "input-volume-up");
    click(cx, "output-volume-down");
    click(cx, "output-volume-down");
    click(cx, "bitrate-down");
    click(cx, "voice-over-tcp");
    let after = engine.voice_settings();
    assert!((after.input_volume - 1.1).abs() < 1e-6);
    assert!((after.output_volume - 0.8).abs() < 1e-6);
    assert_eq!(after.bitrate_bps, 56_000);
    assert!(after.voice_over_tcp);
}

#[gpui::test]
fn a_users_menu_sets_their_volume_and_remembers_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "user-3");
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_some()));
    click(cx, "menu-Mute here");
    assert_eq!(
        engine.actions(),
        [Action::SetUserVolume {
            session: 3,
            volume: 0.0
        }]
    );
    shell.read_with(cx, |shell, _| {
        assert!(shell.menu.is_none(), "choosing closes the menu");
        assert_eq!(shell.volumes.get(&3), Some(&0.0));
    });
}

#[gpui::test]
fn kicking_asks_for_a_reason_first(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "user-3");
    click(cx, "menu-Kick…");
    assert!(
        engine.actions().is_empty(),
        "nothing happens before the answer"
    );
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_some()));
    cx.simulate_keystrokes("s p a m enter");
    assert_eq!(
        engine.actions(),
        [Action::Kick {
            session: 3,
            reason: "spam".to_owned()
        }]
    );
    shell.read_with(cx, |shell, _| {
        assert!(shell.prompt.is_none());
        assert!(
            shell.snapshot.users.iter().all(|user| user.session != 3),
            "gone from the list"
        );
    });
}

#[gpui::test]
fn a_channels_menu_creates_renames_and_deletes(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-New channel inside…");
    // No name is no channel: the dialog stays.
    click(cx, "prompt-ok");
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_some()));
    cx.simulate_keystrokes("g a m e s enter");
    let created = engine
        .snapshot()
        .channels
        .into_iter()
        .find(|channel| channel.name.as_ref() == "games")
        .expect("the new channel");
    assert_eq!(created.parent, Some(1));

    right_click(cx, "channel-2");
    click(cx, "menu-Rename…");
    // The field starts from the name there is.
    cx.simulate_keystrokes("2 enter");
    assert!(
        engine
            .snapshot()
            .channels
            .iter()
            .any(|c| c.name.as_ref() == "studio2")
    );

    right_click(cx, "channel-3");
    click(cx, "menu-Delete…");
    assert!(
        engine.snapshot().channels.iter().any(|c| c.id == 3),
        "not before the yes"
    );
    click(cx, "prompt-ok");
    assert!(engine.snapshot().channels.iter().all(|c| c.id != 3));
}

#[gpui::test]
fn a_menu_closes_on_a_click_elsewhere_and_a_prompt_on_cancel(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "user-3");
    click(cx, "menu-backdrop");
    shell.read_with(cx, |shell, _| assert!(shell.menu.is_none()));
    right_click(cx, "user-3");
    click(cx, "menu-Ban…");
    click(cx, "prompt-cancel");
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_none()));
    assert!(engine.actions().is_empty());
}

#[gpui::test]
fn a_users_comment_is_fetched_and_shown(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    right_click(cx, "user-3");
    click(cx, "menu-View comment");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("the card is open");
        assert_eq!(info.title.as_ref(), "Rin");
        let body = info.body.as_ref().expect("the comment arrived");
        assert!(!body.is_empty());
    });
    click(cx, "info-close");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
    // Somebody with no comment gets a card that says so, not one that waits.
    right_click(cx, "user-2");
    click(cx, "menu-View comment");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let body = shell.info.as_ref().and_then(|info| info.body.as_ref());
        assert!(body.is_some_and(|body| body.is_empty()));
    });
}

#[gpui::test]
fn the_welcome_shows_over_the_own_channel_until_dismissed(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_some()));
    click(cx, "channel-2");
    shell.read_with(cx, |shell, _| {
        assert!(
            shell.welcome_to_show().is_none(),
            "not over a channel being read"
        );
    });
    click(cx, "channel-1");
    click(cx, "dismiss-welcome");
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_none()));
}

#[gpui::test]
fn joining_with_a_password_sends_it(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    right_click(cx, "channel-2");
    click(cx, "menu-Join with a password…");
    cx.simulate_keystrokes("s 3 enter");
    assert_eq!(
        engine.actions(),
        [Action::JoinWithPassword {
            channel: 2,
            password: "s3".to_owned()
        }]
    );
    assert_eq!(engine.snapshot().current_channel, Some(2));
}

#[test]
fn the_title_leads_with_the_unread_count_when_there_is_one() {
    assert_eq!(super::window_title(0), "Fancy Mumble");
    assert_eq!(super::window_title(3), "(3) Fancy Mumble");
}

#[gpui::test]
fn shift_enter_starts_a_line_and_enter_sends_them_all(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("o n e shift-enter t w o");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "one\ntwo")
    });
    cx.simulate_keystrokes("enter");
    let sent = engine.messages(Conversation::Channel(1));
    assert_eq!(
        sent.last().map(|message| message.body.to_string()),
        Some("one\ntwo".to_owned())
    );
    // A one-line field has no second line to start.
    click(cx, "input-Search channels");
    cx.simulate_keystrokes("a shift-enter b");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.search.read(cx).text(), "ab")
    });
}

#[gpui::test]
fn a_click_in_the_text_places_the_caret_there(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h e l l o");
    // Click at the very start of the field: typing now goes in front.
    let field = cx
        .debug_bounds("input-Message #lounge")
        .expect("the composer");
    cx.simulate_click(
        field.origin + gpui::point(gpui::px(1.0), field.size.height / 2.0),
        Modifiers::none(),
    );
    cx.simulate_keystrokes(">");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), ">hello")
    });
}

#[gpui::test]
fn the_rail_adds_a_server_over_a_connection_and_goes_back(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    shell.read_with(cx, |shell, _| assert!(!shell.shows_connect_screen()));
    click(cx, "add-session");
    shell.read_with(cx, |shell, _| {
        assert!(
            shell.shows_connect_screen(),
            "the saved servers, over the connection"
        );
    });
    assert_eq!(
        engine.snapshot().connection,
        Connection::Connected,
        "still on the server"
    );
    // Search goes to the list that is showing.
    shell.update_in(cx, Shell::focus_search);
    cx.simulate_keystrokes("k");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.server_search.read(cx).text(), "k")
    });
    // The server's tile goes back to it.
    click(cx, "session-magical.rocks");
    shell.read_with(cx, |shell, _| assert!(!shell.shows_connect_screen()));
}

#[gpui::test]
fn a_message_takes_a_reaction_from_its_menu_and_gives_it_back_at_its_chip(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "message-1");
    // Somebody else's: nothing to change, only to react to and copy.
    assert!(cx.debug_bounds("menu-Copy text").is_some());
    shell.read_with(cx, |shell, _| {
        let menu = shell.menu.as_ref().expect("the menu");
        let names: Vec<_> = menu.items.iter().map(|item| item.name.as_ref()).collect();
        assert_eq!(
            names,
            ["Reply", "Copy text", "Pin"],
            "not the local user's to edit"
        );
        assert_eq!(
            menu.quick.len(),
            super::menu::QUICK_REACTIONS.len() + 1,
            "and the way to the rest"
        );
    });
    click(cx, "react-👍");
    shell.read_with(cx, |shell, _| {
        assert!(shell.menu.is_none());
        let reactions = &shell.messages[1].reactions;
        assert_eq!(reactions.len(), 1);
        assert!(reactions[0].own && reactions[0].count == 1);
    });
    assert!(matches!(
        engine.actions().last(),
        Some(Action::React { add: true, .. })
    ));
    // The chip under the message takes it off again.
    click(cx, "chip-1-👍");
    shell.read_with(cx, |shell, _| {
        assert!(shell.messages[1].reactions.is_empty())
    });
    assert!(matches!(
        engine.actions().last(),
        Some(Action::React { add: false, .. })
    ));
}

#[gpui::test]
fn an_own_message_is_edited_in_the_composer_and_deleted_from_its_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "message-0");
    click(cx, "menu-Edit");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.editing.is_some());
        assert_eq!(
            shell.composer.read(cx).text(),
            "Welcome to our creative lounge!"
        );
    });
    assert!(cx.debug_bounds("editing").is_some());
    cx.simulate_keystrokes("! enter");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.editing.is_none());
        assert_eq!(shell.composer.read(cx).text(), "");
        assert_eq!(shell.messages.len(), 5, "changed, not sent again");
        assert!(shell.messages[0].edited);
        assert_eq!(
            shell.messages[0].body.as_ref(),
            "Welcome to our creative lounge!!"
        );
    });

    // Escape leaves a message as it was.
    right_click(cx, "message-0");
    click(cx, "menu-Edit");
    cx.simulate_keystrokes("x escape");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.editing.is_none());
        assert_eq!(shell.composer.read(cx).text(), "");
    });
    assert_eq!(
        engine
            .actions()
            .iter()
            .filter(|action| matches!(action, Action::EditMessage { .. }))
            .count(),
        1
    );

    right_click(cx, "message-0");
    click(cx, "menu-Delete");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.messages.len(), 4);
        assert!(!shell.messages[0].own);
    });
}

#[gpui::test]
fn somebody_writing_is_named_and_the_local_user_writing_is_passed_on(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let Some(Conversation::Channel(lounge)) = shell.read_with(cx, |shell, _| shell.open) else {
        panic!("a channel is open");
    };
    engine.emit(crate::engine::EngineEvent::Typing {
        channel: lounge,
        session: 3,
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.writers(), ["Rin"]);
    });
    assert!(cx.debug_bounds("writing").is_some());
    // In another channel: not this conversation's business.
    engine.emit(crate::engine::EngineEvent::Typing {
        channel: lounge + 1,
        session: 2,
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.writers().len(), 1));

    assert_eq!(engine.typed(), 0);
    shell.update_in(cx, |shell, window, cx| {
        shell.composer.read(cx).focus(window)
    });
    cx.simulate_keystrokes("h");
    assert_eq!(engine.typed(), 1);
}

#[gpui::test]
fn a_pinned_message_is_marked_and_the_header_shows_only_the_pins(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("pin-count").is_none(), "nothing pinned yet");
    right_click(cx, "message-2");
    click(cx, "menu-Pin");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Pin { pinned: true, .. })
    ));
    shell.read_with(cx, |shell, _| {
        assert_eq!((shell.pins, shell.messages.len()), (1, 5));
        assert!(shell.messages[2].pinned);
    });
    click(cx, "pins");
    shell.read_with(cx, |shell, _| {
        assert!(shell.only_pinned);
        assert_eq!(shell.messages.len(), 1);
        assert_eq!(shell.held, 5, "the rest are held, not shown");
    });
    // Taking the last pin off leaves nothing to show only pins of.
    right_click(cx, "message-0");
    click(cx, "menu-Unpin");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.only_pinned);
        assert_eq!(shell.messages.len(), 5);
    });
}

#[gpui::test]
fn a_channel_is_listened_to_from_its_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-2");
    click(cx, "menu-Listen without joining");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::ToggleListen { channel: 2 })
    );
    assert!(cx.debug_bounds("listening-2").is_some());
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.snapshot.current_channel,
            Some(1),
            "still where they were"
        );
    });
}

#[gpui::test]
fn a_servers_tile_says_what_the_server_is_and_leaves_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "session-magical.rocks");
    click(cx, "menu-Server information");
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("the card");
        assert_eq!(info.title.as_ref(), "magical.rocks");
        assert_eq!(info.facts.len(), 1);
        assert!(info.body.is_some(), "the welcome message");
    });
    assert!(cx.debug_bounds("info-facts").is_some());
    click(cx, "info-close");
    right_click(cx, "session-magical.rocks");
    click(cx, "menu-Disconnect");
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);
}

#[gpui::test]
fn a_picture_on_the_clipboard_is_sent_when_pasted_into_the_composer(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb([9, 9, 9])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    cx.write_to_clipboard(gpui::ClipboardItem::new_image(&gpui::Image::from_bytes(
        gpui::ImageFormat::Png,
        png.clone(),
    )));
    assert!(cx.debug_bounds("attach").is_some());
    shell.update_in(cx, |shell, window, cx| {
        shell.composer.read(cx).focus(window)
    });
    cx.simulate_keystrokes("ctrl-v");
    let sent = engine.messages(Conversation::Channel(1));
    assert_eq!(sent.len(), 6);
    assert!(
        sent[5]
            .html
            .starts_with(r#"<img src="data:image/png;base64,"#)
    );
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.messages.len(), 6);
        assert_eq!(shell.composer.read(cx).text(), "", "nothing typed");
    });
}

#[gpui::test]
fn certificates_are_listed_with_who_uses_them_and_deleted_on_the_second_click(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "leave");
    click(cx, "open-certificates");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.certs.open);
        assert_eq!(shell.panels.certs.held, ["alex", "work"]);
    });
    click(cx, "delete-work");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.certs.doomed.as_ref().map(AsRef::as_ref),
            Some("work")
        );
    });
    assert_eq!(engine.certificates().len(), 2, "armed, not gone");
    click(cx, "delete-work");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.certs.held, ["alex"]);
        assert!(shell.panels.certs.doomed.is_none());
    });
    click(cx, "certificates-close");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.certs.open));
}

#[gpui::test]
fn the_ban_list_is_filtered_and_a_ban_lifted_on_the_second_click(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "session-magical.rocks");
    click(cx, "menu-Bans…");
    shell.read_with(cx, |shell, _| {
        let admin = shell.panels.admin.as_ref().expect("the panel");
        assert_eq!(admin.bans.as_ref().map(Vec::len), Some(2));
    });
    click(cx, "input-Filter");
    cx.simulate_keystrokes("m a l");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.admin.as_ref().expect("the panel").shown,
            [0],
            "the other is filtered out"
        );
    });
    click(cx, "admin-remove-0");
    assert!(
        !engine
            .actions()
            .iter()
            .any(|action| matches!(action, Action::SetBans(_))),
        "armed, not lifted"
    );
    click(cx, "admin-remove-0");
    let Some(Action::SetBans(left)) = engine.actions().last().cloned() else {
        panic!("the list that is left is sent");
    };
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].mask, 24, "the other ban stays");

    click(cx, "admin-registered");
    shell.read_with(cx, |shell, _| {
        let admin = shell.panels.admin.as_ref().expect("the panel");
        assert_eq!(admin.registered.as_ref().map(Vec::len), Some(5));
    });
    // A registered account is called something else.
    click(cx, "input-Filter");
    cx.simulate_keystrokes("backspace backspace backspace");
    click(cx, "admin-rename-2");
    cx.simulate_keystrokes("R i n n a enter");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::RenameRegistered {
            id: 3,
            name: "Rinna".to_owned(),
        })
    );
    click(cx, "admin-close");
    shell.read_with(cx, |shell, _| assert!(shell.panels.admin.is_none()));
}

#[gpui::test]
fn a_long_conversation_opens_on_its_newest_page_and_steps_back(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let lounge = Conversation::Channel(1);
    for line in 0..150 {
        engine.send_message(lounge, format!("line {line}"));
    }
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.messages.len(), 100, "a page, not all 155");
        assert_eq!(shell.held, 155);
        assert!(shell.earlier);
        assert_eq!(shell.messages[99].body.as_ref(), "line 149");
        assert_eq!(shell.row_model[0], super::conversation::Row::Earlier);
    });
    shell.update(cx, Shell::show_earlier);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.messages.len(), 155);
        assert!(!shell.earlier, "that was all of it");
        assert_ne!(shell.row_model[0], super::conversation::Row::Earlier);
    });
    // Another conversation, and back: the newest page again.
    click(cx, "channel-2");
    click(cx, "channel-1");
    shell.read_with(cx, |shell, _| assert_eq!(shell.messages.len(), 100));
}

#[gpui::test]
fn a_link_drawn_for_the_first_time_is_looked_behind_and_gets_a_card(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Scout's message, the one with a link in it, is on screen.
    shell.read_with(cx, |shell, _| {
        let card = shell
            .previews
            .get("https://example.org/walk")
            .expect("asked about")
            .as_ref()
            .expect("answered");
        assert_eq!(
            card.title.as_ref().map(AsRef::as_ref),
            Some("A walk by the river")
        );
        assert_eq!(shell.previews.len(), 1, "only links are asked about");
    });
    assert!(cx.debug_bounds("preview-4").is_some());
}

#[gpui::test]
fn an_arrival_does_not_move_a_reader_who_has_scrolled_up(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let lounge = Conversation::Channel(1);
    for line in 0..40 {
        engine.send_message(lounge, format!("line {line}"));
    }
    cx.run_until_parked();
    let top = |shell: &Shell| shell.rows.logical_scroll_top().item_ix;
    // The reader goes back up the conversation.
    shell.update(cx, |shell, _| {
        shell.at_tail.set(false);
        shell.rows.scroll_to(gpui::ListOffset {
            item_ix: 3,
            offset_in_item: gpui::px(0.0),
        });
    });
    engine.emit(crate::engine::EngineEvent::Typing {
        channel: 1,
        session: 3,
    });
    // Somebody else's message arrives below.
    engine.say_as(3, "Rin", lounge, "meanwhile");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.messages.last().map(|m| m.body.as_ref()),
            Some("meanwhile")
        );
        assert_eq!(top(shell), 3, "left where they were reading");
    });
    // Their own message takes them to it.
    engine.send_message(lounge, "back".to_owned());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.at_tail.get());
        assert!(top(shell) > 3);
    });
}

#[gpui::test]
fn a_burst_of_state_changes_reads_the_server_once(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let before = engine.snapshots();
    for _ in 0..50 {
        engine.emit(crate::engine::EngineEvent::StateChanged);
    }
    // A message for the open conversation in the middle of more of them.
    engine.say_as(3, "Rin", Conversation::Channel(1), "hello");
    for _ in 0..50 {
        engine.emit(crate::engine::EngineEvent::StateChanged);
    }
    cx.run_until_parked();
    assert_eq!(
        engine.snapshots() - before,
        2,
        "once before the message, once after"
    );
    shell.read_with(cx, |shell, _| assert_eq!(shell.messages.len(), 6));
}

#[gpui::test]
fn the_search_field_finds_messages_too_and_a_click_opens_where_one_was_said(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    engine.send_message(Conversation::Direct(3), "the dahlias again".to_owned());
    click(cx, "channel-2");
    shell.update_in(cx, Shell::focus_search);
    cx.simulate_keystrokes("d");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.found.is_empty(), "one letter is not searched")
    });
    cx.simulate_keystrokes("a h l");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.found.len(), 2, "one in the channel, one direct");
        assert_eq!(
            shell.column.len(),
            3,
            "no channel is called that: a heading and two"
        );
    });
    click(cx, "found-1");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(Conversation::Direct(3)))
    });
    click(cx, "found-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(Conversation::Channel(1)))
    });
}

#[gpui::test]
fn reading_is_said_once_and_a_message_others_have_read_says_who(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // The newest message, Scout's, was read on opening the channel.
    assert_eq!(
        engine.read_up_to_id().as_ref().map(AsRef::as_ref),
        Some("demo-4")
    );
    // The local user's own newest is nothing to tell anybody about.
    engine.send_message(Conversation::Channel(1), "anyone there?".to_owned());
    cx.run_until_parked();
    assert_eq!(
        engine.read_up_to_id().as_ref().map(AsRef::as_ref),
        Some("demo-4")
    );
    let newest = shell.read_with(cx, |shell, _| {
        assert_eq!(shell.seen.until, None);
        shell.messages[5].id.clone().expect("an id")
    });
    // Rin has read it; Flora only the one before.
    engine.emit(crate::engine::EngineEvent::Readers {
        channel: 1,
        readers: vec![
            crate::engine::Reader {
                name: "Rin".into(),
                read_up_to: newest,
            },
            crate::engine::Reader {
                name: "Flora".into(),
                read_up_to: "demo-4".into(),
            },
        ],
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.seen.until, Some(5));
        assert_eq!(shell.seen_by(5), ["Rin"]);
        assert_eq!(
            shell.seen_by(0).len(),
            2,
            "both have read the first message"
        );
    });
    assert!(cx.debug_bounds("seen-by").is_some());
}

#[gpui::test]
fn a_poll_is_asked_from_the_channels_menu_and_answered_with_a_click(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-New poll: choose one…");
    cx.simulate_keystrokes("T e a ? shift-enter Y e s shift-enter N o enter");
    shell.read_with(cx, |shell, _| {
        assert!(shell.prompt.is_none(), "asked");
        assert_eq!(shell.polls.len(), 1);
        assert_eq!(shell.polls[0].question.as_ref(), "Tea?");
        assert_eq!(shell.polls[0].options.len(), 2);
        assert_eq!(
            shell.row_model.last(),
            Some(&super::conversation::Row::Poll(0)),
            "after the messages there were"
        );
    });
    click(cx, "poll-0-1");
    shell.read_with(cx, |shell, _| {
        let options = &shell.polls[0].options;
        assert!(options[1].own && options[1].votes == 1);
    });
    // One answer each: choosing the other moves the vote.
    click(cx, "poll-0-0");
    shell.read_with(cx, |shell, _| {
        let options = &shell.polls[0].options;
        assert!(options[0].own && !options[1].own);
        assert_eq!((options[0].votes, options[1].votes), (1, 0));
    });
    // And the same again takes it back.
    click(cx, "poll-0-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.polls[0].options[0].votes, 0)
    });
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Vote { selected, .. }) if selected.is_empty()
    ));
}

#[gpui::test]
fn a_shared_file_is_a_card_and_a_click_asks_where_to_save_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.send_file(Conversation::Channel(1), "/somewhere/notes.txt".into());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let files = &shell.messages[5].files;
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].name.as_ref(), "notes.txt");
    });
    click(cx, "file-5-0");
    assert!(cx.did_prompt_for_new_path());
    cx.simulate_new_path_selection(|folder| Some(folder.join("kept.txt")));
    cx.run_until_parked();
    let saved = engine.saved();
    assert_eq!(saved.len(), 1);
    assert_eq!(saved[0].0.as_ref(), "demo/notes.txt");
    assert!(saved[0].1.ends_with("kept.txt"));
}

#[test]
fn a_size_is_said_in_the_unit_that_fits() {
    assert_eq!(super::size_in_words(812), "812 B");
    assert_eq!(super::size_in_words(1_536), "1.5 KB");
    assert_eq!(super::size_in_words(3 * 1024 * 1024 + 200_000), "3.2 MB");
    assert_eq!(super::size_in_words(5 * 1024 * 1024 * 1024), "5.0 GB");
}

#[gpui::test]
fn a_reply_is_begun_from_a_messages_menu_and_shows_what_it_answers(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "message-3");
    click(cx, "menu-Reply");
    shell.read_with(cx, |shell, _| {
        let (to, said) = shell.replying.as_ref().expect("answering");
        assert_eq!(to.as_ref(), "demo-3");
        assert_eq!(
            said.as_ref(),
            "Flora: The dahlias are blooming in the garden."
        );
    });
    assert!(cx.debug_bounds("replying").is_some());
    cx.simulate_keystrokes("l o v e l y enter");
    shell.read_with(cx, |shell, _| {
        assert!(shell.replying.is_none(), "answered");
        let sent = shell.messages.last().expect("the reply");
        assert_eq!(sent.body.as_ref(), "lovely");
        assert_eq!(sent.reply_to.as_ref().map(AsRef::as_ref), Some("demo-3"));
    });
    assert!(cx.debug_bounds("quoted-5").is_some());
    assert_eq!(engine.messages(Conversation::Channel(1)).len(), 6);

    // Escape leaves a message unanswered, and what was typed is kept.
    right_click(cx, "message-1");
    click(cx, "menu-Reply");
    cx.simulate_keystrokes("h m escape");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.replying.is_none());
        assert_eq!(shell.composer.read(cx).text(), "hm");
    });
}

#[gpui::test]
fn a_channels_description_is_edited_from_the_one_it_has(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-Describe…");
    // The demo's lounge is described; the field starts from that.
    shell.read_with(cx, |shell, cx| {
        let prompt = shell.prompt.as_ref().expect("the dialog");
        assert_eq!(
            prompt.field_text(cx).as_deref(),
            Some("Where everybody starts.")
        );
    });
    cx.simulate_keystrokes("space N o w . enter");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::DescribeChannel {
            channel: 1,
            text: "Where everybody starts. Now.".to_owned(),
        })
    );
}

#[gpui::test]
fn tab_finishes_a_name_begun_after_an_at_sign(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    shell.update_in(cx, |shell, window, cx| {
        shell.composer.read(cx).focus(window)
    });
    cx.simulate_keystrokes("h i space @ s c tab");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "hi @Scout ");
    });
    // Nothing begun, or nobody called that: Tab changes nothing.
    cx.simulate_keystrokes("@ z z tab");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "hi @Scout @zz");
    });
}

#[gpui::test]
fn somebody_asking_for_the_channels_key_is_answered_from_a_strip(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    engine.ask_for_key("abc", "Rin");
    engine.ask_for_key("def", "Flora");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.key_requests.len(), 2));
    click(cx, "share-key-Rin");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::AnswerKeyRequest {
            channel: 1,
            hash: "abc".to_owned(),
            share: true,
        })
    );
    // The demo says its state changed, not who is asking: the strip goes
    // when the engine next says so.
    engine.emit(crate::engine::EngineEvent::KeyRequests { channel: 1 });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.key_requests.len(), 1);
        assert_eq!(shell.key_requests[0].name.as_ref(), "Flora");
    });
    click(cx, "refuse-key-Flora");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::AnswerKeyRequest { share: false, .. })
    ));
}

#[gpui::test]
fn a_channels_permissions_are_changed_a_rule_at_a_time_and_saved(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-2");
    click(cx, "menu-Permissions…");
    shell.read_with(cx, |shell, _| {
        let panel = shell.panels.acl.as_ref().expect("the panel");
        let acl = panel.acl.as_ref().expect("the rules");
        assert_eq!(acl.rules.len(), 2);
        assert_eq!(
            panel.selected,
            Some(1),
            "the first rule that is the channel's own"
        );
        assert!(!panel.dirty);
    });
    // The parent's rule cannot be chosen.
    click(cx, "acl-rule-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.acl.as_ref().expect("the panel").selected,
            Some(1)
        );
    });
    click(cx, "acl-Speak");
    click(cx, "acl-Enter");
    click(cx, "acl-Enter");
    click(cx, "acl-subs");
    click(cx, "acl-add");
    cx.simulate_keystrokes("m o d s enter");
    click(cx, "acl-Kick");
    shell.read_with(cx, |shell, _| {
        let panel = shell.panels.acl.as_ref().expect("the panel");
        assert!(panel.dirty);
        assert_eq!(
            panel.selected,
            Some(2),
            "the new rule is the one being edited"
        );
    });
    click(cx, "acl-save");
    let Some(Action::SetAcl(saved)) = engine.actions().last().cloned() else {
        panic!("the rules are sent");
    };
    assert_eq!(saved.channel, 2);
    assert_eq!(saved.rules.len(), 3);
    let auth = &saved.rules[1];
    assert_eq!(
        (auth.grant, auth.deny),
        (0x40 | 0x8, 0x4),
        "speak allowed, enter denied"
    );
    assert!(auth.here && !auth.subs);
    let mods = &saved.rules[2];
    assert_eq!(mods.group.as_ref().map(AsRef::as_ref), Some("mods"));
    assert_eq!(mods.grant, 0x1_0000);

    click(cx, "acl-remove");
    shell.read_with(cx, |shell, _| {
        let panel = shell.panels.acl.as_ref().expect("the panel");
        assert_eq!(panel.acl.as_ref().expect("the rules").rules.len(), 2);
    });
    click(cx, "acl-close");
    shell.read_with(cx, |shell, _| assert!(shell.panels.acl.is_none()));
}

#[gpui::test]
fn the_whisper_key_speaks_to_whoever_was_chosen_while_it_is_held(cx: &mut TestAppContext) {
    use crate::engine::WhisperTarget;
    let (shell, engine, cx) = shell(cx);
    // The key is chosen in the voice panel.
    own_menu(cx, "menu-Voice settings…");
    click(cx, "whisper-key");
    cx.simulate_keystrokes("f10");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.whisper.key.as_ref().map(AsRef::as_ref), Some("f10"));
    });
    own_menu(cx, "menu-Voice settings…");
    shell.read_with(cx, |shell, _| assert!(!shell.devices_open));

    // With nobody chosen, the key does nothing.
    cx.simulate_keystrokes("f10");
    assert_eq!(engine.whisper_state(), (None, false, 0));

    right_click(cx, "user-3");
    click(cx, "menu-Whisper with the whisper key");
    assert_eq!(engine.whisper_state().0, Some(WhisperTarget::User(3)));
    assert!(cx.debug_bounds("whisper-target").is_some());

    // Held, a whisper is going out; a key that repeats starts no second.
    let key = gpui::Keystroke::parse("f10").expect("a key");
    for is_held in [false, true] {
        cx.simulate_event(gpui::KeyDownEvent {
            keystroke: key.clone(),
            is_held,
        });
    }
    cx.run_until_parked();
    assert_eq!(
        engine.whisper_state(),
        (Some(WhisperTarget::User(3)), true, 1)
    );
    shell.read_with(cx, |shell, _| assert!(shell.whisper.active));
    cx.simulate_event(gpui::KeyUpEvent { keystroke: key });
    cx.run_until_parked();
    assert_eq!(
        engine.whisper_state(),
        (Some(WhisperTarget::User(3)), false, 1)
    );
    shell.read_with(cx, |shell, _| {
        assert!(!shell.whisper.active && !shell.whisper.held)
    });

    // Chosen again, they are whispered to no longer; so is somebody who left.
    right_click(cx, "channel-2");
    click(cx, "menu-Shout here with the whisper key");
    assert_eq!(engine.whisper_state().0, Some(WhisperTarget::Channel(2)));
    right_click(cx, "channel-2");
    click(cx, "menu-Shout here with the whisper key");
    assert_eq!(engine.whisper_state().0, None);
    right_click(cx, "user-3");
    click(cx, "menu-Whisper with the whisper key");
    right_click(cx, "user-3");
    click(cx, "menu-Kick…");
    cx.simulate_keystrokes("enter");
    shell.read_with(cx, |shell, _| assert!(shell.whisper.target.is_none()));
    assert_eq!(engine.whisper_state().0, None);
}

#[gpui::test]
fn files_sent_together_go_out_in_order_pictures_as_pictures(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let folder = std::env::temp_dir().join(format!("fancy-gpui-drop-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("writable");
    let (notes, picture) = (folder.join("notes.txt"), folder.join("dot.png"));
    std::fs::write(&notes, b"not a picture").expect("writable");
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2, 2, image::Rgb([1, 2, 3])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    std::fs::write(&picture, &png).expect("writable");

    // As a drop on the conversation hands them over.
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.send_files(vec![notes, picture], cx));
    cx.run_until_parked();
    let sent = engine.messages(Conversation::Channel(1));
    assert_eq!(sent.len(), 7);
    assert_eq!(
        sent[5].files.len(),
        1,
        "what is not a picture is shared as a file"
    );
    assert_eq!(sent[5].files[0].name.as_ref(), "notes.txt");
    assert!(
        sent[6]
            .html
            .starts_with(r#"<img src="data:image/png;base64,"#)
    );
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_picture_in_a_message_opens_large_and_is_saved_from_there(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb([9, 9, 9])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    engine.send_picture(Conversation::Channel(1), png.clone());
    cx.run_until_parked();
    // The message is the sixth; under the day rule it is row six.
    click(cx, "picture-6-0");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.lightbox.as_ref().map(|picture| picture.bytes()),
            Some(&png[..])
        );
    });
    let folder = std::env::temp_dir().join(format!("fancy-gpui-lightbox-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("writable");
    cx.executor().allow_parking();
    click(cx, "save-picture");
    assert!(cx.did_prompt_for_new_path());
    let to = folder.join("kept.png");
    cx.simulate_new_path_selection({
        let to = to.clone();
        move |_| Some(to)
    });
    cx.run_until_parked();
    assert_eq!(std::fs::read(&to).ok().as_deref(), Some(&png[..]));
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_some(), "saving is not closing")
    });
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(shell.lightbox.is_none()));
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn an_emoji_is_picked_into_the_composer_or_onto_a_message(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i space");
    click(cx, "compose-more");
    click(cx, "menu-Emoji…");
    shell.read_with(cx, |shell, _| assert!(shell.emoji_for.is_some()));
    click(cx, "emoji-🎉");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.emoji_for.is_none(), "picked: closed");
        assert_eq!(shell.composer.read(cx).text(), "hi 🎉");
    });
    // And typing goes on after it.
    cx.simulate_keystrokes("!");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "hi 🎉!")
    });

    right_click(cx, "message-1");
    click(cx, "react-…");
    click(cx, "emoji-🚀");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::React { emoji, add: true, .. }) if emoji == "🚀"
    ));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.messages[1].reactions[0].emoji.as_ref(), "🚀");
    });
}

#[gpui::test]
fn the_identity_to_connect_as_at_launch_is_chosen_with_a_switch(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    shell.read_with(cx, |shell, _| assert!(shell.chrome.auto_connect.is_none()));
    click(cx, "auto-connect");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.chrome.auto_connect.as_ref().map(AsRef::as_ref),
            Some("magical-alex"),
            "the identity that is picked"
        );
    });
    // Another identity is not the one: its switch is off, and turns it on.
    click(cx, "identity-magical-work");
    click(cx, "auto-connect");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.chrome.auto_connect.as_ref().map(AsRef::as_ref),
            Some("magical-work")
        );
    });
    click(cx, "auto-connect");
    shell.read_with(cx, |shell, _| assert!(shell.chrome.auto_connect.is_none()));
}

#[gpui::test]
fn a_message_is_sent_later_and_can_be_called_off(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("s e e space y o u");
    click(cx, "compose-more");
    click(cx, "menu-Send later…");
    // Not a time: the question stays, and nothing is sent or lost.
    cx.simulate_keystrokes("s o o n enter");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.prompt.is_some());
        assert_eq!(shell.composer.read(cx).text(), "see you");
    });
    cx.simulate_keystrokes("backspace backspace backspace backspace 2 h enter");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.prompt.is_none());
        assert_eq!(shell.composer.read(cx).text(), "", "it is on its way");
    });
    let Some(Action::SendLater { channel, body, .. }) = engine.actions().last().cloned() else {
        panic!("nothing was scheduled: {:?}", engine.actions().last());
    };
    assert_eq!((channel, body.as_str()), (1, "see you"));

    // It waits in the list, and is called off from there.
    click(cx, "compose-more");
    click(cx, "menu-Messages waiting…");
    shell.read_with(cx, |shell, _| {
        let waiting = shell
            .panels
            .later
            .as_ref()
            .and_then(|panel| panel.waiting.as_ref());
        assert_eq!(waiting.map(Vec::len), Some(1));
    });
    click(cx, "later-cancel-0");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::CancelScheduled(_))
    ));
    shell.read_with(cx, |shell, _| {
        let waiting = shell
            .panels
            .later
            .as_ref()
            .and_then(|panel| panel.waiting.as_ref());
        assert_eq!(waiting.map(Vec::len), Some(0));
    });
    assert!(cx.debug_bounds("later-none").is_some());
}

#[gpui::test]
fn a_plain_server_offers_no_sending_later(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell_on(DemoEngine::plain(), cx);
    click(cx, "compose-more");
    assert!(cx.debug_bounds("menu-Emoji…").is_some());
    assert!(cx.debug_bounds("menu-Send later…").is_none());
}

#[gpui::test]
fn a_groups_members_are_listed_and_changed_under_its_rule(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    shell.update(cx, |shell, cx| shell.open_acl(1, cx));
    cx.run_until_parked();
    let members = |shell: &Shell| {
        let acl = shell
            .panels
            .acl
            .as_ref()
            .and_then(|panel| panel.acl.as_ref());
        acl.and_then(|acl| {
            acl.groups
                .iter()
                .find(|group| group.name.as_ref() == "moderators")
        })
        .map(crate::engine::AclGroup::members)
    };
    // The rule for the group is the last; Rin (account 103) is in it by
    // the parent's say.
    shell.update(cx, |shell, cx| {
        if let Some(panel) = shell.panels.acl.as_mut() {
            panel.selected = Some(2);
        }
        cx.notify();
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(members(shell), Some(vec![103])));
    // Flora (102) is here and registered: a click puts her in.
    click(cx, "acl-member-102");
    shell.read_with(cx, |shell, _| {
        assert_eq!(members(shell), Some(vec![102, 103]))
    });
    // A click on a member takes them out: Rin, though the parent has her.
    click(cx, "acl-member-103");
    shell.read_with(cx, |shell, _| assert_eq!(members(shell), Some(vec![102])));
    // Scout has not registered and cannot be offered.
    assert!(cx.debug_bounds("acl-member-104").is_none());
    click(cx, "acl-save");
    let Some(Action::SetAcl(saved)) = engine.actions().last().cloned() else {
        panic!("nothing was saved");
    };
    let group = &saved.groups[0];
    assert_eq!((&group.added, &group.removed), (&vec![102], &vec![103]));
}

#[gpui::test]
fn a_friend_is_kept_from_their_menu_and_found_in_the_list(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    click(cx, "friends");
    assert!(cx.debug_bounds("friends-none").is_some());
    click(cx, "friends-close");
    right_click(cx, "user-3");
    click(cx, "menu-Add to friends");
    shell.read_with(cx, |shell, _| {
        assert!(shell.is_friend("h3"));
        let kept = &shell.panels.friends.kept;
        assert_eq!(
            (kept[0].name.as_str(), kept[0].server.as_str()),
            ("Rin", "magical.rocks")
        );
    });
    // Their menu now offers the way back out.
    right_click(cx, "user-3");
    assert!(cx.debug_bounds("menu-Remove from friends").is_some());
    click(cx, "menu-backdrop");
    // In the list they are here: a click opens the conversation with them.
    click(cx, "friends");
    click(cx, "friend-0");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.friends.open);
        assert_eq!(shell.open, Some(Conversation::Direct(3)));
    });
    click(cx, "friends");
    click(cx, "friend-remove-0");
    shell.read_with(cx, |shell, _| assert!(!shell.is_friend("h3")));
}

#[gpui::test]
fn a_channel_sealed_the_signal_way_is_made_from_a_channels_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-New Signal-sealed channel inside…");
    cx.simulate_keystrokes("v a u l t enter");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::CreateSignalChannel { parent: 1, name }) if name == "vault"
    ));
    shell.read_with(cx, |shell, _| {
        let made = shell
            .snapshot
            .channels
            .iter()
            .find(|c| c.name.as_ref() == "vault");
        assert!(made.is_some_and(|channel| channel.encrypted));
    });
}

#[gpui::test]
fn a_moderator_empties_a_channel_of_one_persons_messages_or_of_all(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // The lounge keeps its messages; Rin said one of the five.
    right_click(cx, "user-3");
    click(cx, "menu-Delete their messages here…");
    click(cx, "prompt-ok");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Purge {
            channel: 1,
            by: Some(3)
        })
    ));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.messages.len(), 4);
        assert!(
            shell
                .messages
                .iter()
                .all(|message| message.sender != Some(3))
        );
    });
    right_click(cx, "channel-1");
    click(cx, "menu-Delete all messages…");
    click(cx, "prompt-ok");
    shell.read_with(cx, |shell, _| assert!(shell.messages.is_empty()));
    // A channel that keeps nothing has nothing to delete.
    right_click(cx, "channel-2");
    shell.read_with(cx, |shell, _| {
        let offered = shell.menu.as_ref().expect("the menu");
        assert!(
            offered
                .items
                .iter()
                .all(|item| item.name.as_ref() != "Delete all messages…")
        );
    });
}

#[gpui::test]
fn everyone_is_moved_along_and_a_channel_is_made_to_last_a_visit(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-2");
    click(cx, "menu-Move everyone with me here");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::MoveEveryone { from: 1, to: 2 })
    ));
    shell.read_with(cx, |shell, _| {
        assert!(shell.snapshot.users.iter().all(|user| user.channel == 2));
    });
    right_click(cx, "channel-2");
    click(cx, "menu-New temporary channel inside…");
    cx.simulate_keystrokes("h u d d l e enter");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::CreateTemporaryChannel { parent: 2, name }) if name == "huddle"
    ));
}

#[gpui::test]
fn empty_channels_are_hidden_on_request_but_never_the_one_on_screen(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let names = |shell: &Shell, cx: &gpui::App| -> Vec<String> {
        shell
            .listed_channels(cx)
            .into_iter()
            .map(|(channel, _)| channel.name.to_string())
            .collect()
    };
    shell.read_with(cx, |shell, cx| {
        assert_eq!(names(shell, cx), ["Root", "afk", "lounge", "studio"]);
    });
    own_menu(cx, "menu-Hide empty channels");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(
            names(shell, cx),
            ["Root", "lounge"],
            "where people are, and above"
        );
    });
    // Reading an empty channel keeps it listed while it is on screen.
    shell.update(cx, |shell, cx| {
        shell.open_conversation(Conversation::Channel(2), cx);
    });
    shell.read_with(cx, |shell, cx| {
        assert_eq!(names(shell, cx), ["Root", "lounge", "studio"]);
    });
    own_menu(cx, "menu-Hide empty channels");
    shell.read_with(cx, |shell, cx| assert_eq!(names(shell, cx).len(), 4));
}

#[gpui::test]
fn a_saved_server_is_made_a_favourite_from_its_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    let favourite = |engine: &DemoEngine, host: &str| {
        engine
            .saved_servers()
            .iter()
            .filter(|saved| saved.host.as_ref() == host)
            .all(|saved| saved.favorite)
    };
    assert!(!favourite(&engine, "kumo.jp"));
    right_click(cx, "server-kumo.jp:64738");
    click(cx, "menu-Favourite");
    assert!(favourite(&engine, "kumo.jp"));
    // Both identities of the other lose the mark together.
    right_click(cx, "server-magical.rocks:64738");
    click(cx, "menu-Favourite");
    assert!(
        engine
            .saved_servers()
            .iter()
            .filter(|saved| saved.host.as_ref() == "magical.rocks")
            .all(|saved| !saved.favorite)
    );
    shell.read_with(cx, |shell, _| assert_eq!(shell.servers.len(), 4));
}
