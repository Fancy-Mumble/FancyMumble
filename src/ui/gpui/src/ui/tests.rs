//! The shell, driven the way a person drives it: clicks and keys against a
//! window that exists only in memory.

use std::sync::Arc;

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use crate::demo::DemoEngine;
use crate::engine::{Connection, Conversation, Engine, Voice};
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
    let (shell, cx) = cx.add_window_view(|_, cx| Shell::new(for_shell, None, cx));
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
    click(cx, "themes");
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
    click(cx, "themes");
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
    click(cx, "audio-devices");
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
    click(cx, "audio-devices");
    shell.read_with(cx, |shell, _| assert!(!shell.devices_open));
}

#[gpui::test]
fn push_to_talk_transmits_while_its_key_is_held(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "audio-devices");
    click(cx, "push-to-talk");
    assert!(engine.voice_settings().push_to_talk);
    // Choose the key: the next one pressed.
    click(cx, "push-to-talk-key");
    cx.simulate_keystrokes("f9");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.ptt_key.as_ref().map(AsRef::as_ref), Some("f9"));
        assert!(!shell.choosing_ptt_key);
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
    click(cx, "audio-devices");
    click(cx, "push-to-talk");
    click(cx, "push-to-talk-key");
    cx.simulate_keystrokes("f9");
    click(cx, "audio-devices");
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
    click(cx, "audio-devices");
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
}
