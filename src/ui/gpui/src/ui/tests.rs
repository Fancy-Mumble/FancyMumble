//! The shell, driven the way a person drives it: clicks and keys against a
//! window that exists only in memory.

use std::sync::Arc;

use gpui::Focusable as _;
use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use crate::demo::DemoEngine;
use crate::engine::{Action, Connection, Conversation, Engine, Voice};
use crate::theme::{ActiveTheme, Catalog, DEFAULT_THEME, Mode};

/// A shell on a fresh demo server, in the default theme.
pub(super) fn shell(cx: &mut TestAppContext) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    shell_on(DemoEngine::new(), cx)
}

/// A shell on `engine`, in the default theme.
pub(super) fn shell_on(
    engine: DemoEngine,
    cx: &mut TestAppContext,
) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    super::stage::textures_for_tests();
    // The demo engine's shares, decoders and timers run on threads of their
    // own, as the real ones do, and wake the view from there: the test
    // scheduler would take that for a test that is not deterministic.
    cx.executor().allow_parking();
    cx.update(|cx| {
        let theme = Catalog::get()
            .resolve(DEFAULT_THEME, Mode::Dark, &[])
            .expect("the default theme");
        cx.set_global(ActiveTheme(Arc::new(theme)));
    });
    let engine = Arc::new(engine);
    let for_shell: Arc<dyn Engine> = engine.clone();
    let (shell, cx) = cx.add_window_view(|window, cx| Shell::new(for_shell, None, window, cx));
    // The keys, as the application binds them: without them a test types
    // into a window whose keys do less than the real one's.
    cx.update(|window, cx| {
        super::keys::bind(cx);
        let window = window.window_handle().downcast::<Shell>();
        super::keys::act_on(window.expect("the shell's window"), cx);
    });
    cx.run_until_parked();
    (shell, engine, cx)
}

/// Click the middle of the element tagged `selector`.
#[track_caller]
pub(super) fn click(cx: &mut VisualTestContext, selector: &'static str) {
    let bounds = cx
        .debug_bounds(selector)
        .unwrap_or_else(|| panic!("nothing on screen is tagged `{selector}`"));
    cx.simulate_click(bounds.center(), Modifiers::none());
    cx.run_until_parked();
}

/// Choose `entry` from the local user's own menu, on their tile: the way to
/// the view's panels.
#[track_caller]
pub(super) fn own_menu(cx: &mut VisualTestContext, entry: &'static str) {
    // The tile's sheet has what the web UI's has; what it had besides is
    // reached where the web UI has it now, and is reached there.
    let shell = |cx: &mut VisualTestContext| {
        cx.update(|window, _| window.root::<Shell>().flatten())
            .expect("the shell is the window's root")
    };
    match entry {
        // The panel over the tile, still the voice panel's own way in.
        "menu-Voice settings…" => {
            let shell = shell(cx);
            shell.update(cx, Shell::toggle_devices);
        }
        // The picker the connect screen opens.
        "menu-Themes…" => {
            let shell = shell(cx);
            shell.update(cx, Shell::toggle_picker);
        }
        "menu-Certificates…" => {
            let shell = shell(cx);
            shell.update(cx, Shell::toggle_certificates);
        }
        // The rail's Friends.
        "menu-Friends…" => click(cx, "friends"),
        // On the Voice page of the settings.
        "menu-Turn voice off" => {
            cx.simulate_keystrokes("ctrl-,");
            click(cx, "settings-voice");
            click(cx, "voice-power");
            click(cx, "settings-close");
        }
        // The editor as its dialog, which the card's "Convert to the new
        // format…" still opens; the Profile page draws it as a field.
        "menu-Edit about…" | "menu-Change comment…" => {
            let shell = shell(cx);
            shell.update(cx, Shell::open_about_editor);
        }
        "menu-Settings…" => {
            click(cx, "own-menu");
            click(cx, "menu-Settings");
        }
        "menu-Record what is heard…" => {
            click(cx, "own-menu");
            click(cx, "menu-record");
        }
        _ => {
            click(cx, "own-menu");
            click(cx, entry);
        }
    }
    cx.run_until_parked();
}

/// Right-click the middle of the element tagged `selector`.
#[track_caller]
pub(super) fn right_click(cx: &mut VisualTestContext, selector: &'static str) {
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
fn a_click_on_somebody_keeps_their_card_and_its_line_writes_to_them(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "user-3");
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("her card");
        assert!(card.hover.is_none(), "kept, not passing");
        assert_eq!(
            shell.open,
            Some(Conversation::Channel(1)),
            "and the channel is still what is read"
        );
    });
    assert!(cx.debug_bounds("card").is_some());
    // The card is where to write to her: it is said, and the conversation
    // with her is where it is seen to land.
    click(cx, "input-Message @Rin");
    cx.simulate_keystrokes("h i enter");
    assert_eq!(engine.messages(Conversation::Direct(3)).len(), 1);
    assert_eq!(
        engine.messages(Conversation::Channel(1)).len(),
        5,
        "not in the channel"
    );
    shell.read_with(cx, |shell, cx| {
        assert!(shell.info.is_none(), "the card has done its work");
        assert_eq!(shell.open, Some(Conversation::Direct(3)));
        assert_eq!(shell.open_title().as_deref(), Some("@Rin"));
        assert_eq!(shell.composer.read(cx).placeholder(), "Message @Rin");
        assert_eq!(shell.messages.len(), 1);
    });
    // One's own card can be looked at too, from the list and from the tile.
    click(cx, "user-1");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_some()));
    click(cx, "send");
    click(cx, "own-face");
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("their own card");
        assert_eq!(card.subject, crate::engine::Subject::User(1));
    });
    // A press anywhere else puts a kept card away.
    click(cx, "send");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
}

#[gpui::test]
fn a_rule_marks_where_reading_left_off_in_a_conversation_come_back_to(cx: &mut TestAppContext) {
    use super::conversation::Row;

    let (shell, engine, cx) = shell(cx);
    let studio = Conversation::Channel(3);
    click(cx, "channel-3");
    engine.say_as(3, "Rin", studio, "seen as it arrived");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(
            !shell.row_model.contains(&Row::Unread),
            "nothing was missed"
        );
    });
    // Back in the lounge, two things are said in the studio.
    click(cx, "channel-1");
    engine.say_as(3, "Rin", studio, "first of two");
    engine.say_as(3, "Rin", studio, "second of two");
    cx.run_until_parked();
    click(cx, "channel-3");
    shell.read_with(cx, |shell, _| {
        let at = shell.row_model.iter().position(|row| *row == Row::Unread);
        let Some(Row::Message(first)) = at.and_then(|at| shell.row_model.get(at + 1)) else {
            panic!("no rule above a message: {:?}", shell.row_model);
        };
        assert_eq!(shell.messages[*first].body.as_ref(), "first of two");
    });
    assert!(cx.debug_bounds("unread-rule").is_some());
    // It stays while the conversation is open, whatever else arrives.
    engine.say_as(3, "Rin", studio, "a third");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell
                .row_model
                .iter()
                .filter(|row| **row == Row::Unread)
                .count(),
            1
        );
    });
}

#[gpui::test]
fn a_click_on_how_many_are_in_a_channel_joins_them(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Somebody is in the studio; the user is in the lounge.
    engine.act(Action::MoveUser {
        session: 3,
        channel: 3,
    });
    cx.run_until_parked();
    assert_eq!(engine.snapshot().current_channel, Some(1));
    click(cx, "join-3");
    assert_eq!(engine.snapshot().current_channel, Some(3));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(Conversation::Channel(3)));
    });
}

#[gpui::test]
fn the_cards_bar_sets_how_loud_somebody_is_here_and_its_button_silences_them(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "user-3");
    let bar = cx.debug_bounds("card-volume").expect("the bar");
    // Three quarters of the way along a bar that ends at twice as loud.
    let at = gpui::point(bar.left() + bar.size.width * 0.75, bar.center().y);
    cx.simulate_click(at, Modifiers::none());
    cx.run_until_parked();
    let volume = shell.read_with(cx, |shell, _| shell.volumes.get(&3).copied());
    assert!(
        volume.is_some_and(|volume| (volume - 1.5).abs() < 0.08),
        "{volume:?}"
    );
    assert!(matches!(
        engine.actions().last(),
        Some(Action::SetUserVolume { session: 3, .. })
    ));
    shell.read_with(cx, |shell, _| {
        assert!(shell.info.is_some(), "the card stays")
    });
    click(cx, "card-silence");
    shell.read_with(cx, |shell, _| assert_eq!(shell.volumes.get(&3), Some(&0.0)));
    click(cx, "card-silence");
    shell.read_with(cx, |shell, _| assert_eq!(shell.volumes.get(&3), Some(&1.0)));
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
    right_click(cx, "user-3");
    click(cx, "menu-Message");
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
    // The button never turns voice off again; the tile's menu does, and
    // offers it only while there is voice to turn off.
    own_menu(cx, "menu-Turn voice off");
    assert_eq!(engine.snapshot().voice, Voice::Off);
    click(cx, "own-menu");
    assert!(cx.debug_bounds("menu-Hide empty channels").is_some());
    shell.read_with(cx, |shell, _| {
        let offered = shell.menu.as_ref().expect("the menu");
        assert!(
            offered
                .items
                .iter()
                .all(|item| item.name.as_ref() != "Turn voice off")
        );
    });
}

#[gpui::test]
fn a_button_that_is_only_an_icon_says_what_it_does_when_rested_on(cx: &mut TestAppContext) {
    let (_shell, _engine, cx) = shell(cx);
    let rest_on = |cx: &mut VisualTestContext, selector: &'static str| {
        let at = cx.debug_bounds(selector).expect("the button").center();
        cx.simulate_mouse_move(at, None, Modifiers::none());
        cx.executor()
            .advance_clock(std::time::Duration::from_secs(1));
        cx.run_until_parked();
    };
    // Voice is off: the microphone button turns it on, and says so.
    rest_on(cx, "mute");
    assert!(cx.debug_bounds("tip-Turn voice on").is_some());
    // Once it is on, the same button mutes.
    click(cx, "mute");
    rest_on(cx, "deafen");
    rest_on(cx, "mute");
    assert!(cx.debug_bounds("tip-Mute").is_some());
}

#[gpui::test]
fn the_keys_mute_deafen_step_through_channels_and_open_what_they_name(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-shift-m");
    assert_eq!(
        engine.snapshot().voice,
        Voice::On,
        "voice on at the first press"
    );
    cx.simulate_keystrokes("ctrl-shift-m");
    assert_eq!(engine.snapshot().voice, Voice::Muted);
    cx.simulate_keystrokes("ctrl-shift-d");
    assert!(engine.snapshot().deafened);

    // The lounge is the third of four channels in the column.
    let here = |engine: &DemoEngine| engine.snapshot().current_channel;
    let lounge = here(&engine);
    cx.simulate_keystrokes("alt-down");
    let below = here(&engine);
    assert_ne!(below, lounge, "moved to the channel below");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.open,
            below.map(Conversation::Channel),
            "and reading it"
        );
    });
    cx.simulate_keystrokes("alt-down");
    assert_eq!(here(&engine), below, "no step past the last");
    cx.simulate_keystrokes("alt-up");
    assert_eq!(here(&engine), lounge);
    cx.simulate_keystrokes("alt-home");
    assert_eq!(here(&engine), Some(0), "the server's first channel");

    cx.simulate_keystrokes("ctrl-,");
    shell.read_with(cx, |shell, _| assert!(shell.panels.settings.open));
    cx.simulate_keystrokes("escape");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));

    // The column of channels is put away and brought back; while
    // writing, the same key is the composer's and sets bold.
    cx.simulate_keystrokes("ctrl-b");
    shell.read_with(cx, |shell, _| assert!(shell.chrome.column_hidden));
    cx.simulate_keystrokes("ctrl-b");
    shell.read_with(cx, |shell, _| assert!(!shell.chrome.column_hidden));
    click(cx, "input-Message #Root");
    cx.simulate_keystrokes("ctrl-b");
    shell.read_with(cx, |shell, _| assert!(!shell.chrome.column_hidden));
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
    // The third choice is whichever the system is in, and is stored as
    // that and not as what it came to.
    click(cx, "mode");
    shell.read_with(cx, |shell, _| assert!(shell.follows_system()));
    cx.update(|window, cx| {
        assert_eq!(ActiveTheme::get(cx).mode, Mode::of(window.appearance()));
    });
    // And round to dark again, by hand.
    click(cx, "mode");
    shell.read_with(cx, |shell, _| assert!(!shell.follows_system()));
    cx.update(|_, cx| assert_eq!(ActiveTheme::get(cx).mode, Mode::Dark));
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
    click(cx, "prompt-ok");
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
fn what_the_web_client_holds_is_offered_once_and_brought_over_or_left(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    assert!(cx.debug_bounds("carry").is_none(), "nothing to bring");
    let saved = engine.saved_servers().len();
    engine.offer_carry(2, 1);
    cx.run_until_parked();
    assert!(cx.debug_bounds("carry").is_some());
    click(cx, "carry-now");
    assert_eq!(engine.saved_servers().len(), saved + 2);
    // Said in passing, and gone by itself.
    assert!(cx.debug_bounds("toast").is_some());
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.chrome.toasts.said(), ["Brought over 2 servers."]);
        assert!(shell.notice.is_none(), "nothing to answer");
    });
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(5));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.toasts.said().is_empty())
    });
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.servers.len(), saved + 2, "and listed");
        assert!(shell.chrome.carry.is_none(), "nothing left to offer");
        assert!(!shell.chrome.carry_declined);
    });
    // Declined, it is not offered again, however much there is.
    engine.offer_carry(1, 0);
    cx.run_until_parked();
    click(cx, "carry-decline");
    assert_eq!(engine.saved_servers().len(), saved + 2, "left where it is");
    engine.offer_carry(5, 5);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.carry.is_none() && shell.chrome.carry_declined);
    });
}

#[gpui::test]
fn a_saved_server_nobody_is_on_has_a_tile_that_shows_the_way_onto_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // On magical.rocks; kumo.jp is saved and not connected.
    assert!(cx.debug_bounds("session-magical.rocks").is_some());
    let other = engine
        .saved_servers()
        .into_iter()
        .find(|server| server.host.as_ref() == "kumo.jp")
        .expect("the demo saves it");
    let tile: &'static str = Box::leak(format!("saved-{}", other.label).into_boxed_str());
    click(cx, tile);
    shell.read_with(cx, |shell, _| {
        assert!(shell.shows_connect_screen(), "its way in, over the server");
        assert_eq!(shell.selected_server.as_deref(), Some("kumo.jp:64738"));
        assert_eq!(
            shell.snapshot.connection,
            Connection::Connected,
            "nothing was left to get there"
        );
    });
    // The server one is on is a click on its own tile away.
    click(cx, "session-magical.rocks");
    shell.read_with(cx, |shell, _| assert!(!shell.shows_connect_screen()));
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
    // The panel scrolls, and this row reaches past its foot: pressed where
    // it is seen.
    let row = cx.debug_bounds("output-USB Headset").expect("the row");
    cx.simulate_click(gpui::point(row.center().x, row.top() + gpui::px(4.0)), Modifiers::none());
    cx.run_until_parked();
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
        prefer_character_input: false,
    });
    cx.run_until_parked();
    assert_eq!(engine.snapshot().voice, Voice::On, "held: transmitting");
    cx.simulate_event(gpui::KeyUpEvent { keystroke: key });
    cx.run_until_parked();
    assert_eq!(engine.snapshot().voice, Voice::Muted, "released: silent");
}

#[gpui::test]
fn a_key_struck_in_another_program_does_what_it_does_here(cx: &mut TestAppContext) {
    use crate::hotkeys::{Does, Struck};
    let (shell, engine, cx) = shell(cx);
    let strike = |cx: &mut VisualTestContext, does, down| {
        shell.update(cx, |shell, cx| shell.global_key(Struck { does, down }, cx));
        cx.run_until_parked();
    };
    // Nothing is bound with the system until it is asked for.
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.global_keys && shell.chrome.hotkeys.is_none());
    });
    // Mute and deafen are a press; the release says nothing.
    strike(cx, Does::Mute, true);
    assert_eq!(
        engine.snapshot().voice,
        Voice::On,
        "voice on at the first press"
    );
    strike(cx, Does::Mute, false);
    assert_eq!(engine.snapshot().voice, Voice::On);
    strike(cx, Does::Deafen, true);
    assert!(engine.snapshot().deafened);
    strike(cx, Does::Deafen, true);
    assert!(!engine.snapshot().deafened);
    // The talk key transmits while it is held, where talking takes a key,
    strike(cx, Does::Talk, true);
    shell.read_with(cx, |shell, _| {
        assert!(!shell.ptt.held, "it does not: nothing to hold")
    });
    own_menu(cx, "menu-Voice settings…");
    click(cx, "push-to-talk");
    strike(cx, Does::Talk, true);
    assert_eq!(engine.snapshot().voice, Voice::On);
    shell.read_with(cx, |shell, _| assert!(shell.ptt.held));
    // said twice it is held once, and its release always lets go.
    strike(cx, Does::Talk, true);
    strike(cx, Does::Talk, false);
    assert_eq!(engine.snapshot().voice, Voice::Muted, "released: silent");
    shell.read_with(cx, |shell, _| assert!(!shell.ptt.held));
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
        // Kept by who she is, not by this connection's number for her.
        assert_eq!(shell.volumes.kept().get("h3"), Some(&0.0));
    });
    // Back as she is sent: nothing left to keep.
    right_click(cx, "user-3");
    click(cx, "menu-Volume 100%");
    shell.read_with(cx, |shell, _| assert!(shell.volumes.kept().is_empty()));
}

#[gpui::test]
fn what_was_being_written_waits_in_the_conversation_it_was_written_in(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let written = |shell: &Shell, cx: &gpui::App| shell.composer.read(cx).text().to_owned();
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h a l f");
    click(cx, "channel-2");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(written(shell, cx), "", "not carried over")
    });
    click(cx, "input-Message #studio");
    cx.simulate_keystrokes("o t h e r");
    click(cx, "channel-1");
    shell.read_with(cx, |shell, cx| assert_eq!(written(shell, cx), "half"));
    click(cx, "channel-2");
    shell.read_with(cx, |shell, cx| assert_eq!(written(shell, cx), "other"));
}

#[gpui::test]
fn a_channel_whose_history_is_sealed_says_which_way_on_its_row(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("sealed-2").is_none());
    engine.alter_channel(2, |channel| {
        channel.history = true;
        channel.encrypted = true;
        channel.signal = true;
    });
    cx.run_until_parked();
    assert!(cx.debug_bounds("sealed-2").is_some());
}

#[gpui::test]
fn somebody_is_moved_to_a_channel_chosen_from_the_tree(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "user-3");
    click(cx, "menu-Move to…");
    shell.read_with(cx, |shell, _| assert!(shell.panels.mover.is_some()));
    // Where she is now is not somewhere to move her to.
    assert!(cx.debug_bounds("move-to-1").is_none());
    assert!(cx.debug_bounds("move-to-3").is_some());
    // What is typed narrows the tree.
    cx.simulate_keystrokes("s t u");
    click(cx, "move-to-2");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::MoveUser {
            session: 3,
            channel: 2
        })
    );
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.mover.is_none());
        assert_eq!(shell.chrome.toasts.said(), ["Moved Rin to #studio"]);
    });
    // Everybody in a channel, the same way: what its menu's entry opens.
    shell.update_in(cx, |shell, window, cx| {
        shell.ask_where_to_move(super::mover::Moved::Everyone(1), window, cx);
    });
    cx.run_until_parked();
    click(cx, "move-to-3");
    assert_eq!(
        engine.actions().last(),
        Some(&Action::MoveEveryone { from: 1, to: 3 })
    );
}

#[gpui::test]
fn an_account_is_given_only_once_that_was_said_to_be_meant(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Scout has no account here yet.
    right_click(cx, "user-4");
    click(cx, "menu-Register…");
    assert!(engine.actions().is_empty(), "asked first");
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_some()));
    click(cx, "prompt-ok");
    assert_eq!(engine.actions(), [Action::Register { session: 4 }]);
    // Rin has one: it is taken away, not given, and that is asked too.
    right_click(cx, "user-3");
    assert!(cx.debug_bounds("menu-Deregister…").is_some());
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
    // No name is no channel: the form stays.
    click(cx, "channel-create");
    shell.read_with(cx, |shell, _| assert!(shell.panels.channel_form.is_some()));
    cx.simulate_keystrokes("g a m e s");
    click(cx, "channel-create");
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
    click(cx, "menu-User information");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("the card is open");
        assert_eq!(info.title.as_ref(), "Rin");
        let body = info.body.as_ref().expect("the comment arrived");
        assert!(!body.is_empty());
    });
    click(cx, "info-close");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
    // Somebody with no comment gets a sheet that says so, not one that waits.
    right_click(cx, "user-2");
    click(cx, "menu-User information");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let body = shell.info.as_ref().and_then(|info| info.body.as_ref());
        assert!(body.is_some_and(|body| body.is_empty()));
    });
}

#[gpui::test]
fn the_welcome_shows_when_a_connection_is_made_until_closed(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Already on the server when the view opened: not arrived just now.
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_none()));
    shell.update(cx, Shell::show_welcome_again);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_some()));
    click(cx, "dismiss-welcome");
    shell.read_with(cx, |shell, _| assert!(shell.welcome_to_show().is_none()));
}

#[gpui::test]
fn a_room_behind_a_password_shows_its_lock_and_asks_before_it_is_joined(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("locked-2").is_none());
    engine.alter_channel(2, |channel| channel.restricted = true);
    cx.run_until_parked();
    assert!(cx.debug_bounds("locked-2").is_some());
    // A plain join would be refused without a word: it asks instead.
    right_click(cx, "channel-2");
    assert!(cx.debug_bounds("menu-Join with a password…").is_none());
    click(cx, "menu-Join");
    assert_eq!(engine.snapshot().current_channel, Some(1), "not yet");
    shell.read_with(cx, |shell, _| assert!(shell.prompt.is_some()));
    cx.simulate_keystrokes("s 3 enter");
    assert_eq!(
        engine.actions(),
        [Action::JoinWithPassword {
            channel: 2,
            password: "s3".to_owned()
        }]
    );
    // What it is, is in its sheet.
    right_click(cx, "channel-2");
    click(cx, "menu-About this channel");
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("its sheet");
        let kind = info.facts.iter().find(|(name, _)| name.as_ref() == "Kind");
        assert_eq!(
            kind.map(|(_, value)| value.as_ref()),
            Some("Behind a password")
        );
    });
}

#[gpui::test]
fn the_header_joins_to_talk_and_somebody_without_rights_is_offered_no_moderation(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    // Reading the studio from the lounge, with voice never turned on.
    engine.turn_voice_off();
    click(cx, "channel-2");
    assert_eq!(engine.snapshot().voice, Voice::Off);
    click(cx, "join");
    assert_eq!(engine.snapshot().current_channel, Some(2));
    assert_ne!(
        engine.snapshot().voice,
        Voice::Off,
        "voice comes on with it"
    );
    // The server takes every right away: the menus follow.
    for id in 0..=3 {
        engine.alter_channel(id, |channel| {
            channel.rights = crate::rights::Rights::only(&[])
        });
    }
    cx.run_until_parked();
    right_click(cx, "user-3");
    assert!(cx.debug_bounds("menu-Message").is_some());
    assert!(cx.debug_bounds("menu-Kick…").is_none());
    shell.update(cx, |shell, cx| {
        shell.menu = None;
        cx.notify();
    });
    right_click(cx, "channel-3");
    assert!(cx.debug_bounds("menu-Open").is_some());
    assert!(cx.debug_bounds("menu-Rename…").is_none());
    assert!(cx.debug_bounds("menu-Delete…").is_none());
}

#[gpui::test]
fn a_lost_connection_says_it_is_tried_again_and_can_be_retried_or_given_up(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("reconnect").is_none());
    engine.lose_connection(std::time::Duration::from_secs(30));
    cx.run_until_parked();
    assert!(cx.debug_bounds("reconnect").is_some());
    shell.read_with(cx, |shell, _| assert!(shell.shows_connect_screen()));
    // Not waiting the pause out.
    click(cx, "retry-now");
    assert_eq!(engine.snapshot().connection, Connection::Connected);
    shell.read_with(cx, |shell, _| assert!(shell.snapshot.retry.is_none()));
    // Or not coming back at all.
    engine.lose_connection(std::time::Duration::from_secs(30));
    cx.run_until_parked();
    click(cx, "retry-cancel");
    shell.read_with(cx, |shell, _| assert!(shell.snapshot.retry.is_none()));
    assert_eq!(engine.snapshot().connection, Connection::Disconnected);
    assert!(engine.snapshot().retry.is_none());
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
fn a_selection_in_the_composer_is_set_apart_by_key_and_by_button(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let typed = |shell: &Entity<Shell>, cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, cx| shell.composer.read(cx).text().to_owned())
    };
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("l o u d");
    assert!(
        cx.debug_bounds("format-bold").is_none(),
        "nothing selected, nothing to set apart"
    );
    cx.simulate_keystrokes("ctrl-a ctrl-b");
    assert_eq!(typed(&shell, cx), "**loud**");
    // The buttons are over what is selected, clear of the field.
    let button = cx.debug_bounds("format-italic").expect("the buttons");
    let field = cx
        .debug_bounds("input-Message #lounge")
        .expect("the composer");
    assert!(button.bottom() < field.top(), "above the field, not on it");
    // One of them does what its key does, and takes neither the keyboard
    // nor the selection from the field: what is typed next replaces it.
    click(cx, "format-italic");
    assert_eq!(typed(&shell, cx), "***loud***");
    cx.simulate_keystrokes("x");
    assert_eq!(typed(&shell, cx), "***x***");
    // Gone with the selection: a press where a button was sets nothing.
    assert!(cx.debug_bounds("format-italic").is_none(), "gone");
    cx.simulate_click(button.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(typed(&shell, cx), "***x***");
    click(cx, "input-Message #lounge");
    // The marks are what the engine reads: heavier and slanted, with the
    // stars themselves faint.
    let read = Engine::typed(engine.as_ref(), "***x***");
    assert_eq!(read.len(), 3);
    assert!(read[0].1.mark && read[2].1.mark);
    assert!(read[1].1.bold && read[1].1.italic && !read[1].1.mark);
    cx.simulate_keystrokes("ctrl-a ctrl-shift-x ctrl-a ctrl-e");
    assert_eq!(typed(&shell, cx), "`~~***x***~~`");
    // A field that is not the composer has no marks to set.
    click(cx, "input-Search channels");
    cx.simulate_keystrokes("a ctrl-a ctrl-b");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.search.read(cx).text(), "a")
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
            ["Reply", "Copy text", "Pin", "Select…", "Delete"],
            "not the local user's to edit; theirs to delete, as a moderator"
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
fn a_quote_code_a_heading_and_a_list_are_each_set_apart(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    for apart in ["prose-quote", "prose-code", "prose-heading", "prose-item"] {
        assert!(cx.debug_bounds(apart).is_none());
    }
    engine.say_as(
        3,
        "Rin",
        Conversation::Channel(1),
        "<h2>Plan</h2>as she said<blockquote>not before noon</blockquote>         <pre><code>let a_long_line_of_code = that_would_not_fit(the_bubble, however_wide, it_is_drawn);</code></pre>         <ol><li>first</li><li>second</li></ol>",
    );
    cx.run_until_parked();
    let quote = cx.debug_bounds("prose-quote").expect("the quote");
    let code = cx.debug_bounds("prose-code").expect("the code");
    let heading = cx.debug_bounds("prose-heading").expect("the heading");
    let item = cx.debug_bounds("prose-item").expect("an item");
    // In the order they were written, one under another.
    assert!(heading.bottom() <= quote.top());
    assert!(quote.bottom() <= code.top());
    assert!(code.bottom() <= item.top());
    // Code is one line however long: it scrolls, it does not wrap.
    assert!(code.size.height < gpui::px(40.0), "{:?}", code.size);
}

#[gpui::test]
fn the_message_under_the_pointer_has_a_pill_of_what_can_be_done_to_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("message-actions").is_none());
    // Somebody else's message: the pill stands just above it.
    let theirs = cx.debug_bounds("message-1").expect("their message");
    let on_it = gpui::point(
        theirs.left() + gpui::px(200.0),
        theirs.bottom() - gpui::px(8.0),
    );
    cx.simulate_mouse_move(on_it, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.hovered_message(), Some(1)));
    let pill = cx.debug_bounds("message-actions").expect("its pill");
    assert!(pill.bottom() <= theirs.bottom() && pill.left() > theirs.left());
    assert!(cx.debug_bounds("pill-Reply").is_some());
    assert!(cx.debug_bounds("pill-Edit").is_none(), "not theirs to edit");
    assert!(
        cx.debug_bounds("pill-Delete").is_none(),
        "nor a click from gone"
    );
    // A click on one of its buttons does what the menu's entry would.
    click(cx, "pill-Reply");
    shell.read_with(cx, |shell, _| assert!(shell.replying.is_some()));
    shell.update(cx, |shell, cx| {
        shell.replying = None;
        cx.notify();
    });
    click(cx, "pill-Pin");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Pin { pinned: true, .. })
    ));
    // The pointer gone elsewhere, the pill goes after it; not at once,
    // or it could never be reached.
    let elsewhere = cx.debug_bounds("send").expect("the composer").center();
    cx.simulate_mouse_move(elsewhere, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.hovered_message(), Some(1)));
    cx.executor()
        .advance_clock(std::time::Duration::from_millis(400));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.hovered_message(), None));
    // One's own: it can be edited, and deleted past the divider.
    let own = cx.debug_bounds("message-0").expect("an own message");
    let on_own = gpui::point(own.right() - gpui::px(120.0), own.bottom() - gpui::px(30.0));
    cx.simulate_mouse_move(on_own, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.hovered_message(), Some(0)));
    click(cx, "pill-Edit");
    shell.read_with(cx, |shell, _| assert!(shell.editing.is_some()));
}

#[gpui::test]
fn what_a_message_hides_is_shown_at_a_click_on_it(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Long enough to fill its bubble, so the middle of the row is on it.
    let ending = "and then everybody went home ".repeat(14);
    engine.say_as(
        3,
        "Rin",
        Conversation::Channel(1),
        &format!(r#"<span class="spoiler">{ending}</span>"#),
    );
    cx.run_until_parked();
    let hides = |shell: &Shell| {
        let index = shell.messages.len() - 1;
        shell.bodies.get(&index).map(|body| body.shows_hidden())
    };
    shell.read_with(cx, |shell, _| {
        assert_eq!(hides(shell), Some(false), "drawn, and hidden");
    });
    let row = shell.read_with(cx, |shell, _| shell.messages.len() - 1);
    let frame = cx
        .debug_bounds(Box::leak(format!("message-{row}").into_boxed_str()))
        .expect("the message, on screen");
    // The bubble is at the leading side of a row that is as wide as the pane.
    let on_it = gpui::point(frame.left() + gpui::px(200.0), frame.center().y);
    cx.simulate_click(on_it, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(hides(shell), Some(true)));
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
        window.focus(&shell.composer.focus_handle(cx), cx)
    });
    cx.simulate_keystrokes("h");
    assert_eq!(engine.typed(), 1);
}

#[gpui::test]
fn a_pinned_message_is_marked_and_listed_under_the_headers_pin(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    assert!(cx.debug_bounds("pin-count").is_none(), "nothing pinned yet");
    right_click(cx, "message-2");
    click(cx, "menu-Pin");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Pin { pinned: true, .. })
    ));
    shell.read_with(cx, |shell, _| {
        assert_eq!((shell.pins.len(), shell.messages.len()), (1, 5));
        assert!(shell.messages[2].pinned);
    });
    assert!(cx.debug_bounds("pin-count").is_some());
    // The pin in the header lists what is pinned; the conversation stays
    // whole behind it.
    click(cx, "pins");
    assert!(cx.debug_bounds("pins-panel").is_some());
    shell.read_with(cx, |shell, _| {
        assert!(shell.pins_open);
        assert_eq!(shell.messages.len(), 5);
        let said = shell.pins[0].said.as_ref().expect("held");
        assert_eq!(said.from_newest, 3, "the third from the newest of five");
    });
    // A click on one goes to its message, which stands out for a moment,
    // and the list is put away.
    click(cx, "pin-0");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.pins_open);
        assert_eq!(shell.seen.flashed, shell.messages[2].id);
        assert!(!shell.at_tail.get(), "where they asked to be");
    });
    cx.executor()
        .advance_clock(std::time::Duration::from_secs(2));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.seen.flashed.is_none()));
    // Its corner takes the pin off.
    click(cx, "pins");
    click(cx, "unpin-0");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::Pin { pinned: false, .. })
    ));
    shell.read_with(cx, |shell, _| assert!(shell.pins.is_empty()));
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
        window.focus(&shell.composer.focus_handle(cx), cx)
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
fn a_picture_sent_is_in_view_at_its_size_and_on_no_plate(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let room = Conversation::Channel(1);
    // Enough said that the conversation is longer than the window.
    for line in 0..60 {
        engine.send_message(room, format!("line {line}"));
    }
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(300, 200, image::Rgb([9, 9, 9])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    engine.send_picture(room, png);
    cx.run_until_parked();
    let row = shell.read_with(cx, |shell, _| shell.rows.item_count() - 1);
    let selector: &'static str = format!("picture-{row}-0").leak();
    let picture = cx.debug_bounds(selector).expect("the picture, on screen");
    assert_eq!(
        (
            f32::from(picture.size.width),
            f32::from(picture.size.height)
        ),
        (300.0, 200.0),
        "as large as its file says"
    );
    let composer = cx
        .debug_bounds("input-Message #lounge")
        .expect("the composer");
    assert!(
        picture.bottom() <= composer.top(),
        "the picture ends at {:?}, under the composer's top at {:?}",
        picture.bottom(),
        composer.top()
    );
    // Nothing around it but the row: no plate's padding beside it.
    let message: &'static str = format!("message-{}", 5 + 60).leak();
    let frame = cx.debug_bounds(message).expect("its row");
    assert_eq!(
        f32::from(frame.right() - picture.right()),
        19.0,
        "only the row's own gutter is between the picture and the edge"
    );
}

#[gpui::test]
fn certificates_are_listed_with_who_uses_them_and_deleted_on_the_second_click(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "leave");
    click(cx, "prompt-ok");
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
    // The first thing to change on the server does not start the
    // conversation over: what was found behind the link is still held.
    right_click(cx, "message-4");
    click(cx, "menu-Pin");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.previews.contains_key("https://example.org/walk"));
        assert_eq!(
            shell.active_session.as_ref().map(AsRef::as_ref),
            Some("demo")
        );
    });
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
        assert_eq!(shell.below.get(), 1, "and told that it is there");
    });
    engine.say_as(3, "Rin", lounge, "and again");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(shell.below.get(), 2));
    // The pill that says so takes them to it.
    click(cx, "new-messages");
    shell.read_with(cx, |shell, _| {
        assert!(shell.at_tail.get());
        assert_eq!(shell.below.get(), 0);
        assert!(top(shell) > 3);
    });
    // Their own message takes them to it as well, with nothing to be told.
    shell.update(cx, |shell, _| {
        shell.at_tail.set(false);
        shell.rows.scroll_to(gpui::ListOffset {
            item_ix: 3,
            offset_in_item: gpui::px(0.0),
        });
    });
    engine.send_message(lounge, "back".to_owned());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.at_tail.get());
        assert_eq!(shell.below.get(), 0);
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
        assert_eq!(shell.open, Some(Conversation::Channel(1)));
        // And to the message itself, which stands out for a moment.
        let found = shell.found[0].at.as_ref().map(|(id, _)| id.clone());
        assert!(found.is_some() && shell.seen.flashed == found);
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
    assert_eq!(super::size_in_words(1_536), "1.5 KiB");
    assert_eq!(super::size_in_words(3 * 1024 * 1024 + 200_000), "3.2 MiB");
    assert_eq!(super::size_in_words(5 * 1024 * 1024 * 1024), "5 GiB");
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
        window.focus(&shell.composer.focus_handle(cx), cx)
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
fn an_at_sign_opens_a_list_of_names_taken_by_key_or_by_click(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    shell.update_in(cx, |shell, window, cx| {
        window.focus(&shell.composer.focus_handle(cx), cx)
    });
    cx.simulate_keystrokes("@");
    shell.read_with(cx, |shell, _| {
        let offered = shell.panels.mention.as_ref().expect("the list").names();
        // Everybody but oneself, then the two that are for everybody.
        assert_eq!(
            offered,
            ["Flora", "Rin", "Scout", "Torque", "everyone", "here"]
        );
    });
    assert!(cx.debug_bounds("mentions").is_some());
    // The arrows move through it, round its ends; Enter takes one and does
    // not send what is written.
    cx.simulate_keystrokes("up up down down enter");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "@Flora ");
        assert!(shell.panels.mention.is_none(), "taken: put away");
    });
    assert!(
        engine.messages(Conversation::Channel(1)).len() == 5,
        "nothing sent"
    );
    // What is typed narrows it; a click takes one too.
    cx.simulate_keystrokes("@ e");
    shell.read_with(cx, |shell, _| {
        let offered = shell.panels.mention.as_ref().expect("the list").names();
        assert_eq!(offered, ["everyone"]);
    });
    click(cx, "mention-everyone");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.composer.read(cx).text(), "@Flora @everyone ");
    });
    // Escape puts it away and leaves what was typed.
    cx.simulate_keystrokes("@ r escape");
    shell.read_with(cx, |shell, cx| {
        assert!(shell.panels.mention.is_none());
        assert_eq!(shell.composer.read(cx).text(), "@Flora @everyone @r");
    });
    // With the list away, Enter sends as it always did.
    cx.simulate_keystrokes("enter");
    assert_eq!(engine.messages(Conversation::Channel(1)).len(), 6);
}

#[gpui::test]
fn a_message_that_names_the_reader_is_marked(cx: &mut TestAppContext) {
    let (_shell, engine, cx) = shell(cx);
    engine.say_as(
        3,
        "Rin",
        Conversation::Channel(1),
        r#"look, <span class="mention mention-user" data-mention-session="1">@Alex</span>"#,
    );
    engine.say_as(3, "Rin", Conversation::Channel(1), "and this names nobody");
    cx.run_until_parked();
    assert!(cx.debug_bounds("mentioned-5").is_some());
    assert!(cx.debug_bounds("mentioned-6").is_none());
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
            prefer_character_input: false,
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
    shell.read_with(cx, |shell, _| {
        let said = shell.chrome.toasts.said();
        assert!(
            said.iter().any(|toast| toast.starts_with("Saved ")),
            "{said:?}"
        );
        assert!(shell.notice.is_none(), "said in passing, nothing to answer");
    });
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(shell.lightbox.is_none()));
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn the_arrows_go_from_one_picture_of_the_conversation_to_the_next(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let picture = |shade: u8| {
        let mut png = Vec::new();
        image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(4, 4, image::Rgb([shade; 3])))
            .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
            .expect("a png");
        png
    };
    let (first, second) = (picture(10), picture(200));
    let lounge = Conversation::Channel(1);
    engine.send_picture(lounge, first.clone());
    engine.send_message(lounge, "words between them".to_owned());
    engine.send_picture(lounge, second.clone());
    cx.run_until_parked();
    let open = |shell: &Shell| {
        shell
            .lightbox
            .as_ref()
            .map(|picture| picture.bytes().to_vec())
    };
    click(cx, "picture-6-0");
    shell.read_with(cx, |shell, _| assert_eq!(open(shell), Some(first.clone())));
    // Nothing before the first: the way back is not offered, the way on is.
    assert!(cx.debug_bounds("lightbox-next").is_some());
    cx.simulate_keystrokes("left");
    shell.read_with(cx, |shell, _| {
        assert_eq!(open(shell), Some(first.clone()), "stays")
    });
    // On, over the message with no picture, to the second; and back.
    cx.simulate_keystrokes("right");
    shell.read_with(cx, |shell, _| assert_eq!(open(shell), Some(second.clone())));
    cx.simulate_keystrokes("right");
    shell.read_with(cx, |shell, _| {
        assert_eq!(open(shell), Some(second.clone()), "the last")
    });
    click(cx, "lightbox-previous");
    shell.read_with(cx, |shell, _| {
        assert_eq!(open(shell), Some(first.clone()));
        assert!(shell.lightbox.is_some(), "stepping is not closing");
    });

    // A click on the picture looks closer and does not close; plus goes
    // closer still, nought puts it back.
    click(cx, "lightbox-picture");
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_some());
        assert!((shell.lightbox_view().scale() - 2.0).abs() < 1e-5);
    });
    cx.simulate_keystrokes("=");
    shell.read_with(cx, |shell, _| assert!(shell.lightbox_view().scale() > 2.0));
    // Another picture starts as it fits.
    cx.simulate_keystrokes("right");
    shell.read_with(cx, |shell, _| {
        assert_eq!(open(shell), Some(second.clone()));
        assert!(!shell.lightbox_view().enlarged());
    });
    cx.simulate_keystrokes("= 0");
    shell.read_with(cx, |shell, _| assert!(!shell.lightbox_view().enlarged()));
    // Copied: the picture itself is on the clipboard.
    click(cx, "copy-picture");
    let copied = cx.read_from_clipboard().expect("something was copied");
    let pictures: Vec<Vec<u8>> = copied
        .entries()
        .iter()
        .filter_map(|entry| match entry {
            gpui::ClipboardEntry::Image(image) => Some(image.bytes().to_vec()),
            _ => None,
        })
        .collect();
    assert_eq!(pictures.as_slice(), std::slice::from_ref(&second));
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_some(), "copying is not closing")
    });
}

#[gpui::test]
fn an_emoji_is_picked_into_the_composer_or_onto_a_message(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i space");
    click(cx, "compose-more");
    click(cx, "menu-Emoji…");
    shell.read_with(cx, |shell, _| assert!(shell.emoji_for.is_some()));
    // Far down the list: found by what people call it.
    assert!(
        cx.debug_bounds("emoji-😀").is_some(),
        "the list opens on its first group"
    );
    cx.simulate_keystrokes("t a d a");
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
    // What was used last is at the head of the list, with nothing typed.
    shell.read_with(cx, |shell, _| assert_eq!(shell.panels.emoji.recent, ["🎉"]));
    cx.simulate_keystrokes("r o c k e t");
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
    // Nothing is sealed here, so there is nothing to be told first.
    shell.read_with(cx, |shell, _| {
        assert!(shell.prompt.as_ref().expect("asked").caution.is_none());
    });
    // Where messages are sealed, one that waits is said not to be.
    shell.update(cx, Shell::close_prompt);
    engine.alter_channel(1, |channel| channel.encrypted = true);
    cx.run_until_parked();
    click(cx, "compose-more");
    click(cx, "menu-Send later…");
    shell.read_with(cx, |shell, _| {
        let caution = shell.prompt.as_ref().expect("asked").caution.clone();
        assert!(caution.is_some_and(|says| says.contains("as written")));
    });
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
fn an_enlarged_picture_is_moved_by_holding_it_and_stays_open(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Larger than any window: enlarged, some of it hangs over.
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(2400, 2400, image::Rgb([9; 3])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    engine.send_picture(Conversation::Channel(1), png);
    cx.run_until_parked();
    click(cx, "picture-6-0");
    click(cx, "lightbox-picture");
    shell.read_with(cx, |shell, _| assert!(shell.lightbox_view().enlarged()));
    let middle = cx.debug_bounds("lightbox").expect("the veil").center();
    let moved = middle + gpui::point(gpui::px(40.0), gpui::px(-25.0));
    cx.simulate_mouse_down(middle, gpui::MouseButton::Left, Modifiers::none());
    cx.simulate_mouse_move(moved, gpui::MouseButton::Left, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.lightbox_view().offset(), (40.0, -25.0));
    });
    // Letting go where it was moved to is not a click: it stays as it is.
    cx.simulate_mouse_up(moved, gpui::MouseButton::Left, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.lightbox.is_some(), "moving is not closing");
        assert!(
            shell.lightbox_view().enlarged(),
            "nor a click on the picture"
        );
        assert_eq!(shell.lightbox_view().offset(), (40.0, -25.0));
    });
    // The pointer moving with nothing held moves nothing.
    cx.simulate_mouse_move(middle, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.lightbox_view().offset(), (40.0, -25.0));
    });
}

#[gpui::test]
fn a_channel_is_made_in_one_form_with_its_options_together(cx: &mut TestAppContext) {
    use crate::engine::Kept;
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-New channel inside…");
    // Nothing entered is not a channel: said, and nothing asked for.
    click(cx, "channel-create");
    shell.read_with(cx, |shell, _| assert!(shell.panels.channel_form.is_some()));
    // The name first; Tab goes on through what it is for, its password,
    // how many, and its place.
    cx.simulate_keystrokes("R a i d tab f o r space f r i d a y s tab s e s a m e tab 1 2 tab 3");
    click(cx, "channel-temporary");
    click(cx, "channel-hidden");
    click(cx, "channel-kept-1");
    click(cx, "channel-create");
    let Some(Action::MakeChannel(made)) = engine.actions().last().cloned() else {
        panic!("the channel is asked for");
    };
    assert_eq!(made.parent, 1);
    assert_eq!(
        (made.name.as_str(), made.about.as_str()),
        ("Raid", "for fridays")
    );
    assert_eq!(made.password, "sesame");
    assert_eq!((made.most, made.position), (Some(12), Some(3)));
    assert!(made.temporary && made.hidden);
    assert_eq!(made.kept, Kept::OnServer);
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.channel_form.is_none(), "put away");
        let raid = shell
            .snapshot
            .channels
            .iter()
            .find(|c| c.name.as_ref() == "Raid");
        let raid = raid.expect("the channel is there");
        assert_eq!((raid.parent, raid.max_users), (Some(1), 12));
        assert!(raid.temporary && raid.restricted && raid.history);
    });
    // Escape puts the form away.
    right_click(cx, "channel-1");
    click(cx, "menu-New channel inside…");
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(shell.panels.channel_form.is_none()));
}

#[gpui::test]
fn a_channel_sealed_the_signal_way_is_made_from_a_channels_menu(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "channel-1");
    click(cx, "menu-New channel inside…");
    cx.simulate_keystrokes("v a u l t");
    // The last way of keeping what is said: offered where it can be done.
    click(cx, "channel-kept-3");
    click(cx, "channel-create");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::MakeChannel(made))
            if made.parent == 1 && made.name == "vault" && made.kept == crate::engine::Kept::Signal
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
    click(cx, "menu-New channel inside…");
    cx.simulate_keystrokes("h u d d l e");
    click(cx, "channel-temporary");
    click(cx, "channel-create");
    assert!(matches!(
        engine.actions().last(),
        Some(Action::MakeChannel(made)) if made.parent == 2 && made.name == "huddle" && made.temporary
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
    // The same switch is on any channel's menu, where the list is.
    right_click(cx, "channel-1");
    click(cx, "menu-Hide empty channels");
    shell.read_with(cx, |shell, cx| {
        assert_eq!(names(shell, cx), ["Root", "lounge", "studio"]);
    });
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

#[gpui::test]
fn what_is_heard_is_recorded_into_a_chosen_folder_until_stopped(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Starting asks the system for a folder, which no test can answer:
    // this is the folder picker's answer arriving.
    let folder = std::env::temp_dir();
    shell.update(cx, |shell, _| shell.engine.record(Some(folder)));
    cx.run_until_parked();
    assert!(engine.is_recording());
    // The entry is ticked now, and stops it.
    own_menu(cx, "menu-Record what is heard…");
    assert!(!engine.is_recording());
}

#[gpui::test]
fn writing_and_reading_are_kept_to_oneself_when_switched_off(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h");
    let told = engine.typed();
    assert!(told > 0, "others are told by default");
    own_menu(cx, "menu-Settings…");
    click(cx, "settings-privacy");
    click(cx, "tell-writing");
    click(cx, "tell-reading");
    click(cx, "settings-close");
    shell.read_with(cx, |shell, _| {
        let privacy = shell.panels.settings.privacy;
        assert!(privacy.hide_writing && privacy.hide_reading && !privacy.leave_links);
    });
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("i");
    assert_eq!(engine.typed(), told, "nothing more is said about writing");
    // And nothing is shown of who else is writing: it is one bargain.
    engine.emit(crate::engine::EngineEvent::Typing {
        channel: 1,
        session: 3,
    });
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.writers().is_empty()));
    // Somebody says something: it is read, and nobody is told so.
    let before = engine.read_up_to_id();
    engine.say_as(3, "Rin", Conversation::Channel(1), "still there?");
    cx.run_until_parked();
    assert_eq!(engine.read_up_to_id(), before);
}

#[gpui::test]
fn a_second_factor_code_is_asked_for_after_a_refusal_and_sent_once(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell_on(DemoEngine::disconnected(), cx);
    engine.refuse(
        crate::engine::Wanted::Code,
        "This account wants its one-time code",
    );
    cx.run_until_parked();
    click(cx, "input-6-digit code from your authenticator app");
    cx.simulate_keystrokes("1 2 3 4 5 6 enter");
    assert_eq!(engine.code().as_deref(), Some("123456"));
    shell.read_with(cx, |shell, cx| {
        assert_eq!(shell.secrets.code.read(cx).text(), "", "not kept on screen");
    });
}

#[gpui::test]
fn somebody_with_a_profile_gets_a_card_that_says_what_it_says(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    right_click(cx, "user-3");
    click(cx, "menu-User information");
    assert!(cx.debug_bounds("profile-head").is_some());
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("the sheet");
        let profile = info.profile.as_ref().expect("Rin has a profile");
        assert_eq!(profile.status.as_deref(), Some("Sketching"));
        assert_eq!(profile.pronouns.as_deref(), Some("she/her"));
        assert!(profile.banner_color.is_some() && info.banner.is_none());
        // What she wrote about herself is still there, without the head.
        assert!(info.body.as_ref().is_some_and(|body| !body.is_empty()));
    });
    assert!(cx.debug_bounds("profile-line").is_some());
}

#[gpui::test]
fn a_click_on_a_face_beside_a_message_opens_that_persons_card(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Row 2 is Rin's message: the day rule, Alex's own, then hers.
    click(cx, "face-2");
    shell.read_with(cx, |shell, _| {
        let info = shell.info.as_ref().expect("the card");
        assert_eq!(info.title.as_ref(), "Rin");
        assert!(info.profile.is_some());
    });
    // Her name beside it does the same.
    shell.update(cx, |shell, cx| {
        shell.info = None;
        cx.notify();
    });
    click(cx, "sender-2");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.info.as_ref().map(|info| info.title.as_ref()),
            Some("Rin")
        );
    });
}

#[gpui::test]
fn a_link_is_asked_about_before_it_opens_unless_its_host_is_trusted(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let link = gpui::SharedString::from("https://example.org/walk?utm=1");
    shell.update(cx, |shell, cx| shell.follow_link(link.clone(), cx));
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.links.asked(), Some(link.as_ref()), "in full");
    });
    assert!(cx.debug_bounds("link-warning-url").is_some());
    // Not this time.
    click(cx, "link-cancel");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.links.asked().is_none());
        assert!(shell.panels.links.trusted.is_empty());
    });
    // This time, and from now on for that host.
    shell.update(cx, |shell, cx| shell.follow_link(link.clone(), cx));
    cx.run_until_parked();
    click(cx, "link-trust");
    click(cx, "link-open");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.links.asked().is_none());
        assert_eq!(shell.panels.links.trusted, ["example.org"]);
    });
    let elsewhere = gpui::SharedString::from("https://EXAMPLE.org/other");
    shell.update(cx, |shell, cx| shell.follow_link(elsewhere, cx));
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.links.asked().is_none(), "trusted: not asked");
    });
    // Another host is another question; and trust can be taken back.
    let other = gpui::SharedString::from("https://example.org@other.example/");
    shell.update(cx, |shell, cx| shell.follow_link(other.clone(), cx));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.links.asked(), Some(other.as_ref()));
    });
    click(cx, "link-cancel");
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-privacy");
    click(cx, "distrust-0");
    shell.read_with(cx, |shell, _| {
        assert!(shell.panels.links.trusted.is_empty())
    });
}

#[gpui::test]
fn the_size_of_message_text_the_clock_and_reconnecting_are_settings(cx: &mut TestAppContext) {
    use crate::store::{Hours, TextSize};
    let (shell, _engine, cx) = shell(cx);
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-personalize");
    click(cx, "text-size-2");
    click(cx, "settings-localization");
    click(cx, "hours-1");
    click(cx, "settings-advanced");
    click(cx, "reconnect");
    shell.read_with(cx, |shell, _| {
        let settings = &shell.panels.settings;
        assert_eq!(settings.format.text, TextSize::Large);
        assert_eq!(settings.format.hours, Hours::Twelve);
        assert!(settings.stay_disconnected);
    });
    // Back on, the same way.
    click(cx, "reconnect");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.stay_disconnected)
    });
}

#[gpui::test]
fn a_conversation_nobody_has_said_anything_in_says_so(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    assert!(
        cx.debug_bounds("nothing-said").is_none(),
        "the lounge has messages"
    );
    click(cx, "channel-3");
    shell.read_with(cx, |shell, _| assert!(shell.messages.is_empty()));
    assert!(cx.debug_bounds("nothing-said").is_some());
}

#[gpui::test]
fn several_messages_are_picked_and_deleted_together(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    right_click(cx, "message-1");
    click(cx, "menu-Select…");
    click(cx, "message-3");
    click(cx, "message-4");
    // A second click lets one go again.
    click(cx, "message-4");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.chrome.picked.as_ref().map(Vec::len), Some(2));
    });
    click(cx, "delete-picked");
    let Some(Action::DeleteMessages { channel: 1, ids }) = engine.actions().last().cloned() else {
        panic!("nothing was deleted: {:?}", engine.actions().last());
    };
    assert_eq!(ids, ["demo-1", "demo-3"]);
    shell.read_with(cx, |shell, _| {
        assert!(shell.chrome.picked.is_none());
        assert_eq!(shell.messages.len(), 3);
    });
}

#[gpui::test]
fn a_press_on_the_band_is_left_for_the_system_to_move_the_window_by(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let focus = shell.read_with(cx, |shell, _| shell.focus.clone());
    cx.update(|window, cx| window.blur(cx));
    let at = cx
        .debug_bounds("band")
        .expect("the default theme draws the band")
        .center();
    cx.simulate_mouse_down(at, gpui::MouseButton::Left, Modifiers::none());
    // Windows drags a window by its caption only if nothing claimed the
    // press, and taking the focus on it is a claim.
    assert!(
        !cx.update(|window, _| focus.is_focused(window)),
        "the press was claimed for the focus before the system could have it"
    );
}

#[gpui::test]
fn a_card_floats_beside_whoever_the_pointer_rests_on(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    let row = cx.debug_bounds("user-3").expect("somebody's row").center();
    cx.simulate_mouse_move(row, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        assert!(shell.info.is_none(), "passing over a name is not asking");
    });
    cx.executor().advance_clock(super::hover_card::REST);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("their card");
        assert!(card.hover.is_some(), "floating, not in the middle");
    });
    let card = cx.debug_bounds("card").expect("the card, drawn");
    assert!(card.left() > row.x, "beside the pointer, not over it");
    // However much they wrote, it shows what the web UI's card has room
    // for: the pointer cannot reach it to scroll.
    shell.update(cx, |shell, cx| {
        let card = shell.info.as_mut().expect("their card");
        let long = "<p>a paragraph long enough to need the next line as well as its own</p>";
        super::card::read_comment(card, &long.repeat(12));
        cx.notify();
    });
    cx.run_until_parked();
    cx.run_until_parked();
    let written = cx.debug_bounds("card-about").expect("what they wrote");
    assert_eq!(written.size.height, gpui::px(208.0), "the web card's room");
    // A click on the row keeps the card that was only passing, and from
    // then on the pointer going elsewhere does not take it away.
    click(cx, "user-3");
    let elsewhere = cx.debug_bounds("send").expect("the composer").center();
    cx.simulate_mouse_move(elsewhere, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| {
        let card = shell.info.as_ref().expect("still there");
        assert!(card.hover.is_none(), "kept");
    });
    // A press somewhere else does.
    click(cx, "send");
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
    // Rested on and left alone, it goes when the pointer does.
    cx.simulate_mouse_move(row, None, Modifiers::none());
    cx.executor().advance_clock(super::hover_card::REST);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.info.is_some()));
    cx.simulate_mouse_move(elsewhere, None, Modifiers::none());
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
    // A pointer that only passed is not shown a card afterwards.
    cx.simulate_mouse_move(row, None, Modifiers::none());
    cx.simulate_mouse_move(elsewhere, None, Modifiers::none());
    cx.executor().advance_clock(super::hover_card::REST);
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert!(shell.info.is_none()));
}

#[gpui::test]
fn the_settings_page_gathers_what_can_be_changed_a_section_at_a_time(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    own_menu(cx, "menu-Settings…");
    assert!(cx.debug_bounds("settings").is_some(), "the page, on screen");
    // It opens on how the window looks, and a theme is chosen there.
    click(cx, "theme-rose");
    cx.update(|_, cx| assert_eq!(ActiveTheme::get(cx).id.as_ref(), "rose"));
    // The voice section asks for the devices it lists.
    click(cx, "settings-voice");
    shell.read_with(cx, |shell, _| {
        assert!(shell.devices.is_some(), "asked for on turning to it");
        assert!(!shell.devices_open, "the page, not the panel over the tile");
    });
    click(cx, "noise-suppression-0");
    // The certificates are a page of their own, read afresh on turning to it.
    click(cx, "settings-identities");
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.panels.certs.held, ["alex", "work"]);
        assert!(!shell.panels.certs.open, "the page, not the panel");
    });
    // Closing goes back to the conversation; opening again, to the section
    // it was left on.
    click(cx, "settings-close");
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));
    assert!(cx.debug_bounds("input-Message #lounge").is_some());
    own_menu(cx, "menu-Settings…");
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.panels.settings.page,
            super::settings::Page::Identities
        );
    });
    // Escape closes it as it closes anything that is open.
    shell.update(cx, Shell::dismiss);
    shell.read_with(cx, |shell, _| assert!(!shell.panels.settings.open));
}

#[gpui::test]
fn a_click_on_a_link_in_a_message_asks_where_it_leads(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    // Scout's message has a link in it; where exactly its words fall
    // depends on the face they are set in, so the line is swept.
    let frame = cx.debug_bounds("message-4").expect("the message");
    let asked = |cx: &mut VisualTestContext| {
        shell.read_with(cx, |shell, _| {
            shell.panels.links.asked().map(ToOwned::to_owned)
        })
    };
    let mut found = None;
    'sweep: for down in (40..80).step_by(8) {
        for along in (150..330).step_by(12) {
            let at = gpui::point(
                frame.left() + gpui::px(along as f32),
                frame.top() + gpui::px(down as f32),
            );
            cx.simulate_click(at, Modifiers::none());
            cx.run_until_parked();
            if let Some(url) = asked(cx) {
                found = Some(url);
                break 'sweep;
            }
            // A click that landed on a face or a name opened something else.
            shell.update(cx, |shell, cx| {
                shell.info = None;
                cx.notify();
            });
        }
    }
    assert_eq!(found.as_deref(), Some("https://example.org/walk"));
}

#[gpui::test]
fn a_large_picture_is_held_at_the_size_it_is_seen_at(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    // Eight megapixels, as a phone takes them: thirty-two megabytes drawn
    // from its file.
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        4000,
        2000,
        image::Rgb([40, 90, 160]),
    ))
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("a png");
    engine.send_picture(Conversation::Channel(1), png);
    cx.executor().allow_parking();
    let settle = |cx: &mut VisualTestContext| {
        // Read on another thread, then drawn: twice round.
        for _ in 0..3 {
            cx.run_until_parked();
            cx.update(|window, _| window.refresh());
        }
        cx.run_until_parked();
    };
    settle(cx);
    let kept = cx.update(|_, cx| crate::pictures::kept_bytes(cx));
    // No larger than the room a conversation gives it, on a sharp screen.
    assert!(kept > 0, "it was read");
    assert!(kept <= 920 * 460 * 4, "{kept}");

    // Opened large it is read larger, and still not as it was sent.
    click(cx, "picture-6-0");
    settle(cx);
    let large = cx.update(|_, cx| crate::pictures::kept_bytes(cx)) - kept;
    assert!(large > kept, "{large}");
    assert!(large <= 8 << 22, "{large}");
    // Closed, what was read for looking closely is let go of.
    shell.update(cx, Shell::dismiss);
    settle(cx);
    assert_eq!(cx.update(|_, cx| crate::pictures::kept_bytes(cx)), kept);
}

#[gpui::test]
fn sounds_are_turned_on_and_what_each_happening_plays_is_chosen(cx: &mut TestAppContext) {
    use crate::sounds::Event;
    let (shell, _engine, cx) = shell(cx);
    // Which sound each plays is an expert's to choose (Advanced).
    shell.update(cx, |shell, _| {
        shell.panels.settings.user_mode = crate::store::UserMode::Expert;
    });
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-notifications");
    shell.read_with(cx, |shell, _| {
        assert!(!shell.panels.settings.sounds.on, "off until asked for");
    });
    click(cx, "sounds-on");
    // A message in a channel is no longer heard; one to the user alone
    // plays the sound after the one it played.
    click(cx, "sound-message");
    click(cx, "sound-direct-sound");
    click(cx, "sound-direct-sound-3");
    shell.read_with(cx, |shell, _| {
        let sounds = &shell.panels.settings.sounds;
        assert!(sounds.on);
        assert_eq!(sounds.heard(Event::Message), None);
        let (direct, _) = sounds.heard(Event::Direct).expect("still heard");
        assert_eq!(direct.name, "Pop");
        assert!(
            sounds.heard(Event::Mention).is_some(),
            "the rest as they were"
        );
    });
}

#[gpui::test]
fn a_banner_set_on_ones_own_profile_is_across_the_head_of_ones_card(cx: &mut TestAppContext) {
    let (shell, engine, cx) = shell(cx);
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        900,
        900,
        image::Rgb([20, 120, 90]),
    ))
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("a png");
    let banner = crate::picture::banner(&png).expect("a banner");
    engine.act(Action::SetBanner(banner.clone()));
    cx.run_until_parked();
    let on_card = |shell: &Shell| {
        let info = shell.info.as_ref()?;
        Some(info.banner.as_ref()?.bytes().to_vec())
    };
    click(cx, "user-1");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(on_card(shell), Some(banner)));
    // Taken off again, the card is back to its colours.
    shell.update(cx, Shell::dismiss);
    engine.act(Action::SetBanner(Vec::new()));
    click(cx, "user-1");
    cx.run_until_parked();
    shell.read_with(cx, |shell, _| assert_eq!(on_card(shell), None));
}

#[gpui::test]
fn a_picture_is_put_behind_the_conversation_washed_and_taken_away(cx: &mut TestAppContext) {
    let (shell, _engine, cx) = shell(cx);
    assert!(
        cx.debug_bounds("wall").is_none(),
        "none until one is chosen"
    );
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(
        64,
        64,
        image::Rgb([200, 30, 30]),
    ))
    .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
    .expect("a png");
    let wall = crate::picture::wallpaper(&png).expect("a wallpaper");
    shell.update(cx, |shell, cx| shell.set_wall(Some(wall), cx));
    cx.run_until_parked();
    // Behind the whole conversation, not a part of it.
    let behind = cx.debug_bounds("wall").expect("the picture");
    assert!(behind.size.height > gpui::px(300.0), "{behind:?}");
    // How much of it shows is a bar on the Personalize page, with the
    // way to take the picture away.
    cx.simulate_keystrokes("ctrl-,");
    click(cx, "settings-personalize");
    super::tests_settings::scroll_to_foot(&shell, cx);
    let bar = cx.debug_bounds("wall-opacity").expect("the bar");
    cx.simulate_click(
        gpui::point(bar.right() - gpui::px(1.0), bar.center().y),
        Modifiers::none(),
    );
    shell.read_with(cx, |shell, _| assert!(shell.chrome.wall_wash < 0.1));
    // Beside it, how far the picture is blurred: all the way.
    let bar = cx.debug_bounds("wall-blur").expect("the other bar");
    cx.simulate_click(
        gpui::point(bar.right() - gpui::px(1.0), bar.center().y),
        Modifiers::none(),
    );
    shell.read_with(cx, |shell, _| assert_eq!(shell.chrome.wall_blur, 40));
    click(cx, "wall-remove");
    shell.read_with(cx, |shell, _| assert!(shell.chrome.wall.is_none()));
}

/// A folder with a text file and a picture in it, for sending.
fn files_to_send(name: &str) -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
    let folder = std::env::temp_dir().join(format!("fancy-gpui-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&folder).expect("writable");
    let (notes, picture) = (folder.join("notes.txt"), folder.join("cat.png"));
    std::fs::write(&notes, b"not a picture").expect("writable");
    let mut png = Vec::new();
    image::DynamicImage::ImageRgb8(image::RgbImage::from_pixel(600, 300, image::Rgb([1, 2, 3])))
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .expect("a png");
    std::fs::write(&picture, &png).expect("writable");
    (folder, notes, picture)
}

#[gpui::test]
fn files_wait_above_the_composer_and_go_out_with_the_message_as_chosen(cx: &mut TestAppContext) {
    use crate::engine::{Lasts, OpenTo, Reach, ShareAs};
    let (shell, engine, cx) = shell(cx);
    let (folder, notes, picture) = files_to_send("staged");
    cx.executor().allow_parking();
    let stage = |paths: Vec<std::path::PathBuf>, cx: &mut VisualTestContext| {
        shell.update(cx, |shell, cx| shell.stage_files(paths, cx));
        cx.run_until_parked();
    };
    stage(vec![notes.clone(), picture.clone()], cx);
    assert!(cx.debug_bounds("staged-0").is_some() && cx.debug_bounds("staged-1").is_some());
    assert_eq!(
        engine.messages(Conversation::Channel(1)).len(),
        5,
        "chosen is not sent"
    );
    // The first is taken back, and put with them again: now the second.
    click(cx, "staged-remove-0");
    stage(vec![notes.clone()], cx);

    // Unfolded: behind a password, for a day. (A picture that comes out no
    // smaller compressed has no quality to choose, as in the web UI.)
    click(cx, "staged-options");
    assert!(cx.debug_bounds("share-quality-1").is_none());
    click(cx, "share-to-2");
    click(cx, "share-lasts-1");
    // A link that is to have a password and has none does not go.
    click(cx, "send");
    shell.read_with(cx, |shell, _| {
        assert!(shell.has_staged() && shell.notice.is_some());
    });
    assert!(engine.shares().is_empty());
    click(cx, "input-Password for the link");
    cx.simulate_keystrokes("s e s a m e");
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("l o o k");
    click(cx, "send");
    cx.run_until_parked();

    let shares = engine.shares();
    let [(said, files, how)] = &shares[..] else {
        panic!("one message: {shares:?}");
    };
    assert_eq!(said, "look");
    assert_eq!(files, &[picture, notes]);
    assert_eq!(
        *how,
        ShareAs {
            reach: Reach::Password("sesame".to_owned()),
            lasts: Lasts::Day,
            full: false,
        }
    );
    let sent = engine
        .messages(Conversation::Channel(1))
        .pop()
        .expect("the message");
    assert_eq!(sent.files.len(), 2, "both in the one message");
    assert!(
        sent.files
            .iter()
            .all(|file| file.open_to == OpenTo::Password)
    );
    shell.read_with(cx, |shell, cx| {
        assert!(!shell.has_staged(), "gone with it");
        assert!(shell.composer.read(cx).text().is_empty());
    });
    let _ = std::fs::remove_dir_all(folder);
}

#[gpui::test]
fn a_picture_shared_as_a_file_goes_as_usual_and_is_shown_as_a_picture(cx: &mut TestAppContext) {
    use crate::engine::ShareAs;
    let (shell, engine, cx) = shell(cx);
    let (folder, _notes, picture) = files_to_send("shown");
    cx.executor().allow_parking();
    shell.update(cx, |shell, cx| shell.stage_files(vec![picture], cx));
    cx.run_until_parked();
    // Nothing typed and nothing chosen: it goes by itself, the usual way.
    click(cx, "send");
    cx.run_until_parked();
    let shares = engine.shares();
    assert_eq!(shares.len(), 1);
    assert_eq!(shares[0].2, ShareAs::default());
    // The sixth message: its file is fetched and stands there as a picture,
    // which opens large.
    cx.update(|window, _| window.refresh());
    cx.run_until_parked();
    click(cx, "shared-picture-5-0");
    shell.read_with(cx, |shell, _| assert!(shell.lightbox.is_some()));
    let _ = std::fs::remove_dir_all(folder);
}
