//! Voice messages with a made-up recorder and player: when the microphone
//! is offered, a take recorded and thrown away or sent, the server's limit,
//! and a voice message that arrived played, paused, sought, sped up, one at
//! a time, stopped on leaving, and fetched only once it is played.

use std::sync::Arc;
use std::time::Duration;

use gpui::{Entity, Modifiers, TestAppContext, VisualTestContext};

use super::Shell;
use super::tests::{click, shell};
use crate::demo::DemoEngine;
use crate::engine::{Conversation, Engine as _};
use crate::voice::Support;
use crate::voice::made_up::Done;

/// What a server that takes voice messages of up to two minutes says.
const TAKES: Support = Support {
    available: true,
    max_seconds: 120,
    max_bytes: 0,
};

/// A shell on the demo server, which takes voice messages as `support`
/// says.
fn taking(
    support: Option<Support>,
    cx: &mut TestAppContext,
) -> (Entity<Shell>, Arc<DemoEngine>, &mut VisualTestContext) {
    let (shell, engine, cx) = shell(cx);
    engine.voice().allow(support);
    // Drawn again, as a server's answer is.
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
    (shell, engine, cx)
}

/// Let `ms` go by, on the made-up clock and the view's.
fn wait(engine: &DemoEngine, ms: u64, cx: &mut VisualTestContext) {
    engine.voice().advance(ms);
    cx.executor()
        .advance_clock(Duration::from_millis(ms.max(100)));
    cx.run_until_parked();
}

/// Whether the microphone button is offered, as the composer asks.
fn offered(shell: &Entity<Shell>, cx: &mut VisualTestContext) -> bool {
    shell.read_with(cx, |shell, cx| {
        let armed = shell.has_staged() || !shell.composer.read(cx).text().trim().is_empty();
        shell.voice_offered(armed)
    })
}

/// The voice messages of the lounge, as the server holds them: each with
/// what it is kept under and how long it is.
fn voice_messages(engine: &DemoEngine) -> Vec<(String, u32)> {
    engine
        .messages(Conversation::Channel(1))
        .iter()
        .flat_map(|message| &message.files)
        .filter_map(|file| {
            Some((
                file.key.clone()?.to_string(),
                file.voice.as_ref()?.duration_ms,
            ))
        })
        .collect()
}

#[gpui::test]
fn the_microphone_is_offered_only_where_a_voice_message_may_be_sent(cx: &mut TestAppContext) {
    // A server that has said nothing takes none: Send stays.
    let (shell, engine, cx) = taking(None, cx);
    assert!(!offered(&shell, cx));
    assert!(cx.debug_bounds("send").is_some());
    engine.voice().allow(Some(Support {
        available: false,
        ..TAKES
    }));
    assert!(!offered(&shell, cx), "one that said no takes none either");

    engine.voice().allow(Some(TAKES));
    shell.update(cx, |_, cx| cx.notify());
    cx.run_until_parked();
    assert!(offered(&shell, cx));
    assert!(cx.debug_bounds("voice-record").is_some(), "where Send was");

    // Something typed keeps Send: the button there sends it.
    click(cx, "input-Message #lounge");
    cx.simulate_keystrokes("h i");
    assert!(!offered(&shell, cx));
    click(cx, "voice-record");
    let said = engine.messages(Conversation::Channel(1));
    assert_eq!(
        said.last().map(|message| message.body.to_string()),
        Some("hi".to_owned())
    );
    assert!(engine.voice().done().is_empty(), "nothing recorded");
    assert!(
        offered(&shell, cx),
        "and once it is sent, the microphone is back"
    );

    // Not while answering somebody.
    shell.update(cx, |shell, _| {
        shell.replying = Some(("m1".into(), "Rin".into()))
    });
    assert!(!offered(&shell, cx));
    shell.update(cx, |shell, _| shell.replying = None);

    // Not where the channel withholds the right; offered while it is not
    // known, as the server checks anyway.
    engine.alter_channel(1, |channel| {
        channel.rights = crate::rights::Rights::only(&[crate::rights::Right::WRITE]);
    });
    cx.run_until_parked();
    assert!(!offered(&shell, cx));
    engine.alter_channel(1, |channel| {
        channel.rights = crate::rights::Rights::default()
    });
    cx.run_until_parked();
    assert!(offered(&shell, cx));

    // To one user, it goes up through the channel the local user is in.
    shell.update(cx, |shell, cx| {
        shell.open_conversation(Conversation::Direct(3), cx)
    });
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.open, Some(Conversation::Direct(3)))
    });
    assert!(offered(&shell, cx));
}

#[gpui::test]
fn a_take_is_recorded_and_thrown_away_and_nothing_is_made_before_it_is_wanted(
    cx: &mut TestAppContext,
) {
    let (shell, engine, cx) = taking(Some(TAKES), cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.voice.made(), (false, false))
    });
    click(cx, "voice-record");
    shell.read_with(cx, |shell, _| assert_eq!(shell.voice.made(), (true, false)));
    assert_eq!(engine.voice().done(), [Done::Started(120_000)]);
    wait(&engine, 1_500, cx);
    shell.read_with(cx, |shell, _| {
        let (elapsed, limit, sending, levels) = shell.voice.take().expect("a take");
        assert_eq!(elapsed, 1_500);
        assert!(!limit && !sending);
        assert!(levels > 0, "the strip draws its level");
    });
    assert!(
        cx.debug_bounds("voice-take").is_some(),
        "in place of the field"
    );
    assert!(cx.debug_bounds("voice-send").is_some(), "and Send sends it");

    click(cx, "voice-discard");
    assert_eq!(
        engine.voice().done(),
        [Done::Started(120_000), Done::Cancelled]
    );
    shell.read_with(cx, |shell, _| assert!(shell.voice.take().is_none()));
    assert!(voice_messages(&engine).is_empty(), "nothing was sent");
    assert!(offered(&shell, cx), "and the microphone is back");
}

#[gpui::test]
fn a_take_sent_arrives_as_a_voice_message_and_is_drawn_as_one(cx: &mut TestAppContext) {
    let (shell, engine, cx) = taking(Some(TAKES), cx);
    click(cx, "voice-record");
    wait(&engine, 2_300, cx);
    click(cx, "voice-send");
    assert!(engine.voice().done().contains(&Done::Finished));
    let sent = voice_messages(&engine);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].1, 2_300);
    let file = engine
        .messages(Conversation::Channel(1))
        .last()
        .and_then(|message| message.files.first().cloned())
        .expect("the file");
    assert_eq!(file.name.as_ref(), "voice-message.ogg");
    assert_eq!(
        file.voice.as_ref().map(|note| note.waveform.len()),
        Some(48)
    );
    shell.read_with(cx, |shell, _| assert!(shell.voice.take().is_none()));
    // The sixth message, its first file: drawn as a card, nothing fetched.
    cx.run_until_parked();
    assert!(cx.debug_bounds("voice-note-80").is_some());
    assert!(cx.debug_bounds("file-5-0").is_none(), "not as a file");
    assert!(
        !engine
            .voice()
            .done()
            .iter()
            .any(|done| matches!(done, Done::Fetched(_)))
    );
}

#[gpui::test]
fn a_take_stops_itself_at_the_limit_and_one_too_large_is_not_sent(cx: &mut TestAppContext) {
    let (shell, engine, cx) = taking(
        Some(Support {
            max_seconds: 1,
            ..TAKES
        }),
        cx,
    );
    click(cx, "voice-record");
    assert_eq!(engine.voice().done(), [Done::Started(1_000)]);
    wait(&engine, 1_500, cx);
    shell.read_with(cx, |shell, _| {
        let (elapsed, limit, _, _) = shell.voice.take().expect("a take");
        assert_eq!((elapsed, limit), (1_000, true), "held at the limit");
    });
    assert!(cx.debug_bounds("voice-take-said").is_some(), "and says so");
    click(cx, "voice-send");
    assert_eq!(voice_messages(&engine)[0].1, 1_000);

    // A server that takes no more than ten bytes is not sent a take.
    engine.voice().allow(Some(Support {
        max_bytes: 10,
        ..TAKES
    }));
    click(cx, "voice-record");
    wait(&engine, 1_000, cx);
    click(cx, "voice-send");
    assert_eq!(voice_messages(&engine).len(), 1, "not sent");
    assert_eq!(engine.voice().done().last(), Some(&Done::Discarded));
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.chrome.toasts.said().len(),
            1,
            "{:?}",
            shell.chrome.toasts.said()
        );
        assert!(shell.chrome.toasts.said()[0].starts_with("Voice message failed:"));
    });
}

#[gpui::test]
fn a_microphone_that_cannot_be_opened_is_said_and_no_take_starts(cx: &mut TestAppContext) {
    let (shell, engine, cx) = taking(Some(TAKES), cx);
    engine.voice().refuse_next("no microphone");
    click(cx, "voice-record");
    shell.read_with(cx, |shell, _| {
        assert!(shell.voice.take().is_none());
        assert_eq!(
            shell.chrome.toasts.said(),
            ["Voice message failed: no microphone"]
        );
    });
}

/// The lounge with two voice messages in it, Rin's (4 s) and Alex's: the
/// sixth and seventh messages, cards `80` and `96`.
fn two_voice_messages(
    cx: &mut TestAppContext,
) -> (
    Entity<Shell>,
    Arc<DemoEngine>,
    &mut VisualTestContext,
    [String; 2],
) {
    let engine = DemoEngine::new();
    engine.voice_messages(2);
    let (shell, engine, cx) = super::tests::shell_on(engine, cx);
    let keys = voice_messages(&engine);
    assert_eq!(keys.len(), 2);
    (shell, engine, cx, [keys[0].0.clone(), keys[1].0.clone()])
}

#[gpui::test]
fn a_voice_message_is_drawn_from_its_message_and_fetched_only_when_played(cx: &mut TestAppContext) {
    let (shell, engine, cx, [first, _]) = two_voice_messages(cx);
    assert!(cx.debug_bounds("voice-note-80").is_some());
    assert!(cx.debug_bounds("voice-note-96").is_some());
    assert!(
        engine.voice().done().is_empty(),
        "nothing fetched to draw them"
    );
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.voice.made(), (false, false), "nor a player made");
        let standing = shell.voice_standing(&first, 1_000);
        assert!(!standing.playing);
        assert_eq!(
            (standing.at_ms, standing.length_ms),
            (0, 1_000),
            "its length"
        );
    });

    click(cx, "voice-play-80");
    assert_eq!(
        engine.voice().done(),
        [
            Done::Fetched(first.clone().into()),
            Done::Played(first.clone().into())
        ]
    );
    wait(&engine, 400, cx);
    shell.read_with(cx, |shell, _| {
        let standing = shell.voice_standing(&first, 1_000);
        assert!(standing.playing);
        assert_eq!(standing.at_ms, 400);
    });
    click(cx, "voice-play-80");
    assert_eq!(engine.voice().done().last(), Some(&Done::Paused));
    wait(&engine, 400, cx);
    shell.read_with(cx, |shell, _| {
        let standing = shell.voice_standing(&first, 1_000);
        assert_eq!(
            (standing.playing, standing.at_ms),
            (false, 400),
            "held where paused"
        );
    });
    click(cx, "voice-play-80");
    let fetched = engine
        .voice()
        .done()
        .iter()
        .filter(|done| matches!(done, Done::Fetched(_)))
        .count();
    assert_eq!(fetched, 1, "fetched once, played twice");
    // Played to its end, it is back at its start.
    wait(&engine, 700, cx);
    shell.read_with(cx, |shell, _| {
        let standing = shell.voice_standing(&first, 1_000);
        assert_eq!((standing.playing, standing.at_ms), (false, 0));
    });
}

#[gpui::test]
fn a_voice_message_is_sought_sped_up_and_plays_one_at_a_time(cx: &mut TestAppContext) {
    let (shell, engine, cx, [first, second]) = two_voice_messages(cx);
    click(cx, "voice-play-80");
    // A press halfway along its bars goes halfway into it.
    let wave = cx.debug_bounds("voice-wave-80").expect("its bars");
    cx.simulate_click(wave.center(), Modifiers::none());
    cx.run_until_parked();
    assert_eq!(engine.voice().done().last(), Some(&Done::Sought(500)));
    shell.read_with(cx, |shell, _| {
        assert_eq!(shell.voice_standing(&first, 1_000).at_ms, 500);
    });
    // The speeds go round: one and a half, two, one.
    click(cx, "voice-speed-80");
    assert_eq!(engine.voice().done().last(), Some(&Done::Speed(150)));
    wait(&engine, 200, cx);
    shell.read_with(cx, |shell, _| {
        assert_eq!(
            shell.voice_standing(&first, 1_000).at_ms,
            800,
            "at one and a half"
        );
    });
    click(cx, "voice-speed-80");
    click(cx, "voice-speed-80");
    assert_eq!(engine.voice().done().last(), Some(&Done::Speed(100)));

    // The other one played, the first stops and keeps its place.
    click(cx, "voice-play-96");
    assert_eq!(
        engine.voice().done().last(),
        Some(&Done::Played(second.clone().into()))
    );
    shell.read_with(cx, |shell, _| {
        assert!(!shell.voice_standing(&first, 1_000).playing);
        assert_eq!(shell.voice_standing(&first, 1_000).at_ms, 800);
        assert!(shell.voice_standing(&second, 8_919).playing);
    });

    // Leaving the conversation stops it.
    click(cx, "channel-2");
    assert_eq!(engine.voice().done().last(), Some(&Done::Stopped));
    shell.read_with(cx, |shell, _| {
        assert!(!shell.voice_standing(&second, 8_919).playing);
    });
}

#[gpui::test]
fn a_voice_message_is_worked_from_the_keyboard(cx: &mut TestAppContext) {
    let (_shell, engine, cx, [_, second]) = two_voice_messages(cx);
    let at =
        |cx: &mut VisualTestContext| cx.update(|window, cx| super::kit::keyboard_at(window, cx));
    let mut reached = Vec::new();
    for _ in 0..150 {
        cx.simulate_keystrokes("tab");
        if let Some(id) = at(cx).filter(|id| id.contains("voice-") && id.contains("96"))
            && !reached.contains(&id)
        {
            reached.push(id);
        }
        if reached.len() == 3 {
            break;
        }
    }
    assert_eq!(
        reached.len(),
        3,
        "play, its bars and its speed are stops: {reached:?}"
    );
    // From the bars: Space plays, the arrows move five seconds, Home and
    // End go to either end.
    for _ in 0..150 {
        if at(cx).is_some_and(|id| id.contains("voice-wave") && id.contains("96")) {
            break;
        }
        cx.simulate_keystrokes("tab");
    }
    cx.simulate_keystrokes("space");
    assert_eq!(
        engine.voice().done().last(),
        Some(&Done::Played(second.into()))
    );
    cx.simulate_keystrokes("right");
    assert_eq!(engine.voice().done().last(), Some(&Done::Sought(5_000)));
    cx.simulate_keystrokes("home");
    assert_eq!(engine.voice().done().last(), Some(&Done::Sought(0)));
    cx.simulate_keystrokes("end");
    assert_eq!(engine.voice().done().last(), Some(&Done::Sought(8_919)));
}
