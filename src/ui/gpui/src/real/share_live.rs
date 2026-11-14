//! Screen sharing between real engines on a live server.
//!
//! ```text
//! FANCY_GPUI_TEST_FANCY=127.0.0.1:64976 cargo test -- --ignored live_fancy_share
//! ```
//!
//! The first three need only signalling, which a server relays with or
//! without an SFU. The last needs the server's SFU reachable
//! (`[services.screenshare] public_url` and `media_port` set) and is run
//! with `FANCY_GPUI_TEST_SFU=1` and `FANCY_GPUI_SHARE_PATTERN=1`: it shares
//! the test pattern, never a screen. The one of two devices needs
//! `FANCY_GPUI_TEST_SUPERUSER` to register the account.

use std::sync::Arc;
use std::time::{Duration, Instant};

use super::RealEngine;
use crate::engine::{Action, CertificateTask, Engine, EngineEvent, SavedServer, Session};
use crate::share::pattern::Pattern;
use crate::share::stroke::{self, Pen, Stroke};
use crate::share::tracks::Content;
use crate::share::{Fit, FrameSlot, Heard, Signal, SignalKind, Tracks, Wake, Wanted, Watch};

/// A client of the live server `FANCY_GPUI_TEST_FANCY` names, as `name`,
/// with an identity of `certificate`, its files in a folder of its own.
fn client(name: &str, certificate: &str, password: Option<String>) -> (RealEngine, std::path::PathBuf) {
    let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
    let (host, port) = address.rsplit_once(':').expect("host:port");
    let dir = std::env::temp_dir().join(format!("fancy-gpui-share-{}-{}", name.to_lowercase(), std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    let engine = RealEngine::start(&dir).expect("the engine starts");
    engine.save_server(SavedServer {
        id: "live".into(),
        label: "live".into(),
        host: host.to_owned().into(),
        port: port.parse().expect("a port"),
        username: name.to_owned().into(),
        certificate: Some(certificate.to_owned().into()),
        favorite: false,
    });
    engine.connect("live", password);
    (engine, dir)
}

#[track_caller]
fn wait_for(what: &str, mut done: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !done() {
        assert!(Instant::now() < deadline, "timed out waiting for {what}");
        std::thread::sleep(Duration::from_millis(50));
    }
}

/// What one engine hears of sharing, kept until it is looked for.
struct Ear {
    events: async_channel::Receiver<EngineEvent>,
    heard: Vec<Heard>,
}

impl Ear {
    /// Listen to `engine` from now on: what it heard before is let go.
    fn of(engine: &RealEngine) -> Self {
        let events = engine.events();
        while events.try_recv().is_ok() {}
        Self {
            events,
            heard: Vec::new(),
        }
    }

    fn listen(&mut self) {
        while let Ok(event) = self.events.try_recv() {
            if let EngineEvent::Share(heard) = event {
                self.heard.push(heard);
            }
        }
    }

    /// Wait until `kind` from `sender` was heard, and take it.
    #[track_caller]
    fn hears(&mut self, kind: SignalKind, sender: Session) -> Signal {
        let deadline = Instant::now() + Duration::from_secs(30);
        loop {
            self.listen();
            let at = self.heard.iter().position(|heard| {
                matches!(heard, Heard::Signal(signal) if signal.kind == kind && signal.sender == Some(sender))
            });
            if let Some(at) = at
                && let Heard::Signal(signal) = self.heard.remove(at)
            {
                return signal;
            }
            assert!(Instant::now() < deadline, "no {kind:?} from {sender}; heard {:?}", self.heard);
            std::thread::sleep(Duration::from_millis(50));
        }
    }

    /// Every stroke heard so far, taken.
    fn strokes(&mut self) -> Vec<Stroke> {
        self.listen();
        let (strokes, rest): (Vec<Heard>, Vec<Heard>) =
            self.heard.drain(..).partition(|heard| matches!(heard, Heard::Stroke(_)));
        self.heard = rest;
        strokes
            .into_iter()
            .filter_map(|heard| match heard {
                Heard::Stroke(stroke) => Some(stroke),
                _ => None,
            })
            .collect()
    }

    /// Whether a START was heard at all.
    fn any_start(&mut self) -> bool {
        self.listen();
        self.heard
            .iter()
            .any(|heard| matches!(heard, Heard::Signal(signal) if signal.kind == SignalKind::Start))
    }
}

fn session(engine: &RealEngine) -> Session {
    engine.snapshot().own_session.expect("connected")
}

/// Each to be on and to see the others.
fn all_on(engines: &[&RealEngine]) {
    wait_for("everybody to be on", || {
        engines
            .iter()
            .all(|engine| engine.snapshot().users.len() >= engines.len())
    });
}

fn done(engines: Vec<(RealEngine, std::path::PathBuf)>) {
    for (engine, dir) in engines {
        engine.disconnect();
        engine.shutdown();
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// A share is announced to those in the channel, the web client's START
/// word for word; who comes later hears it when it is said again; its STOP
/// reaches them all.
#[test]
#[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
fn live_fancy_share_announced_to_who_is_there_and_again_to_who_comes() {
    let (alice, alice_dir) = client("ShareAlice", "sharealice", None);
    let (bob, bob_dir) = client("ShareBob", "sharebob", None);
    all_on(&[&alice, &bob]);
    let tracks = Tracks::of([Content::Screen]).payload();
    let mut bob_hears = Ear::of(&bob);
    alice.media().announce(None, SignalKind::Start, tracks.clone());
    let start = bob_hears.hears(SignalKind::Start, session(&alice));
    assert_eq!(start.payload, tracks, "relayed word for word");
    // Somebody new is told nothing until it is said again.
    let (carol, carol_dir) = client("ShareCarol", "sharecarol", None);
    all_on(&[&alice, &bob, &carol]);
    let mut carol_hears = Ear::of(&carol);
    std::thread::sleep(Duration::from_secs(2));
    assert!(!carol_hears.any_start(), "the server tells nobody who comes later");
    alice.media().announce(None, SignalKind::Start, tracks);
    let _ = carol_hears.hears(SignalKind::Start, session(&alice));
    alice.media().announce(None, SignalKind::Stop, String::new());
    let _ = bob_hears.hears(SignalKind::Stop, session(&alice));
    let _ = carol_hears.hears(SignalKind::Stop, session(&alice));
    done(vec![(alice, alice_dir), (bob, bob_dir), (carol, carol_dir)]);
}

/// Two share at once, and a stroke drawn by one reaches the others as it
/// was sent: its id, colour, width and points; the sharer's clear is
/// everybody's.
#[test]
#[ignore = "needs a live Fancy server; set FANCY_GPUI_TEST_FANCY=host:port"]
fn live_fancy_share_two_at_once_and_a_stroke_reaches_the_others() {
    let (alice, alice_dir) = client("DrawAlice", "drawalice", None);
    let (bob, bob_dir) = client("DrawBob", "drawbob", None);
    let (carol, carol_dir) = client("DrawCarol", "drawcarol", None);
    all_on(&[&alice, &bob, &carol]);
    let (mut bob_hears, mut carol_hears) = (Ear::of(&bob), Ear::of(&carol));
    alice.media().announce(None, SignalKind::Start, String::new());
    bob.media().announce(None, SignalKind::Start, String::new());
    let _ = carol_hears.hears(SignalKind::Start, session(&alice));
    let _ = carol_hears.hears(SignalKind::Start, session(&bob));

    let channel = alice.snapshot().current_channel.expect("a channel");
    let mut pen = Pen::down(channel, stroke::COLOURS[2], 6, 540.0, (0.25, 0.5));
    pen.to((0.5, 0.55));
    let first = pen.packet(session(&alice)).expect("a packet");
    pen.to((0.75, 0.5));
    let last = pen.up(session(&alice));
    for packet in [first.clone(), last.clone()] {
        alice.media().stroke(packet);
        // No faster than a server takes them.
        std::thread::sleep(Duration::from_millis(300));
    }
    for ear in [&mut bob_hears, &mut carol_hears] {
        let mut strokes: Vec<Stroke> = Vec::new();
        wait_for("both packets", || {
            strokes.extend(ear.strokes());
            strokes.len() >= 2
        });
        // Field for field: its drawer, channel, id, end, colour with its
        // alpha, both widths and its points. (A Starling before 0.2.21
        // carried only drawer, channel, points, fractional width and colour
        // without alpha, which the receiving side still copes with in
        // `Strokes::take`.)
        assert_eq!(strokes.len(), 2, "{strokes:?}");
        for (got, sent) in strokes.iter().zip([&first, &last]) {
            assert_eq!(got, sent, "the stroke as it was drawn");
        }
    }
    // The sharer's clear is everybody's, and arrives as a clear.
    alice.media().stroke(stroke::clearing(session(&alice), channel, true));
    for ear in [&mut bob_hears, &mut carol_hears] {
        let mut cleared = Vec::new();
        wait_for("the clear", || {
            cleared.extend(ear.strokes());
            !cleared.is_empty()
        });
        assert!(
            cleared.iter().all(|got| got.clear && got.clear_all && got.sender == session(&alice)),
            "{cleared:?}"
        );
    }
    done(vec![(alice, alice_dir), (bob, bob_dir), (carol, carol_dir)]);
}

/// One account on two devices: a share from the second is told to the
/// others as the user they know (the first device's session), and to the
/// first device as itself; when the sharing device leaves, the share ends
/// for everybody.
#[test]
#[ignore = "needs a live Starling and its SuperUser password"]
fn live_fancy_share_from_a_second_device_is_told_as_the_user() {
    let password = std::env::var("FANCY_GPUI_TEST_SUPERUSER").expect("FANCY_GPUI_TEST_SUPERUSER");
    let (admin, admin_dir) = client("SuperUser", "shareadmin", Some(password));
    let (first, first_dir) = client("TwoDevices", "twodevices", None);
    let (bob, bob_dir) = client("ShareWatcher", "sharewatcher", None);
    all_on(&[&admin, &first, &bob]);
    let account = first.snapshot().own_session.expect("on");
    admin.act(Action::Register { session: account });
    wait_for("the account", || {
        first.snapshot().users.iter().any(|user| user.session == account && user.account.is_some())
    });
    // Grouped by account as it arrives: the first device comes back as the
    // account it now is.
    first.disconnect();
    wait_for("the first device off", || first.snapshot().own_session.is_none());
    first.connect("live", None);
    wait_for("the first device back", || first.snapshot().users.len() >= 3);
    // The same identity, on another engine: another device of the account.
    let carried = first_dir.join("carried.json");
    first.manage_certificate(CertificateTask::Export {
        label: "twodevices".to_owned(),
        to: carried.clone(),
    });
    wait_for("the export", || carried.exists());
    let second_dir = std::env::temp_dir().join(format!("fancy-gpui-share-second-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&second_dir);
    let second = RealEngine::start(&second_dir).expect("the engine starts");
    second.manage_certificate(CertificateTask::Import(carried));
    wait_for("the import", || second.certificates().iter().any(|label| label == "twodevices"));
    let address = std::env::var("FANCY_GPUI_TEST_FANCY").expect("FANCY_GPUI_TEST_FANCY");
    let (host, port) = address.rsplit_once(':').expect("host:port");
    second.save_server(SavedServer {
        id: "live".into(),
        label: "live".into(),
        host: host.to_owned().into(),
        port: port.parse().expect("a port"),
        username: "TwoDevices".into(),
        certificate: Some("twodevices".into()),
        favorite: false,
    });
    let (mut bob_hears, mut first_hears) = (Ear::of(&bob), Ear::of(&first));
    second.connect("live", None);
    wait_for("the second device on", || second.snapshot().own_session.is_some());
    let shown_as = session(&first);
    eprintln!(
        "first device {shown_as}, second {}; bob sees {:?}",
        session(&second),
        bob.snapshot().users.iter().map(|user| (user.session, user.name.clone())).collect::<Vec<_>>()
    );
    assert_ne!(session(&second), shown_as, "two sessions");
    std::thread::sleep(Duration::from_secs(1));
    second.media().announce(None, SignalKind::Start, Tracks::of([Content::Screen]).payload());
    let _ = bob_hears.hears(SignalKind::Start, shown_as);
    let _ = first_hears.hears(SignalKind::Start, shown_as);
    // The sharing device leaves: the server ends its share for everybody.
    second.disconnect();
    let _ = bob_hears.hears(SignalKind::Stop, shown_as);
    second.shutdown();
    let _ = std::fs::remove_dir_all(second_dir);
    done(vec![(admin, admin_dir), (first, first_dir), (bob, bob_dir)]);
}

/// Watch `sharer`'s share from `viewer`, frames as large as sent.
fn watch(viewer: &RealEngine, sharer: Session) -> (Box<dyn crate::share::Feed>, FrameSlot, Arc<Wanted>) {
    let wanted = Wanted::new();
    let slot = FrameSlot::default();
    let feed = viewer
        .media()
        .watch(Watch {
            server: None,
            session: sharer,
            own: false,
            tracks: vec![crate::share::WatchTrack {
                mid: "0".to_owned(),
                wanted: Arc::clone(&wanted),
                slot: slot.clone(),
            }],
            wake: Wake::new().0,
            ear: Arc::new(crate::share::audio::Ear {
                hearing: viewer.media().hearing(),
                loudness: Arc::default(),
            }),
        })
        .expect("a viewer");
    (feed, slot, wanted)
}

/// The numbers of the pattern frames `slot` gets in `secs` seconds.
fn read_back(slot: &FrameSlot, wanted: &Wanted, secs: u64) -> Vec<u32> {
    let until = Instant::now() + Duration::from_secs(secs);
    let mut read = Vec::new();
    while Instant::now() < until {
        // Drawn, as a window would: in sight, pixel for pixel.
        wanted.drawn(1280, 720, 30, Fit::Actual);
        if let Some(frame) = slot.take() {
            let mut rgba = frame.bgra;
            for pixel in rgba.as_chunks_mut::<4>().0 {
                pixel.swap(0, 2);
            }
            read.extend(Pattern::new(frame.width, frame.height).read(&rgba));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    read
}

/// The pattern shared by one is watched by another, whose decoded frames
/// read back the counter rising; one who comes later watches too; and two
/// share at once.
#[test]
#[ignore = "needs a live Starling with its SFU reachable; FANCY_GPUI_TEST_SFU=1 FANCY_GPUI_SHARE_PATTERN=1"]
fn live_fancy_share_sfu_frames_of_the_pattern_are_read_back() {
    assert!(std::env::var_os("FANCY_GPUI_TEST_SFU").is_some(), "FANCY_GPUI_TEST_SFU");
    assert!(crate::share::real::pattern_only(), "FANCY_GPUI_SHARE_PATTERN, or a screen is captured");
    let (alice, alice_dir) = client("SfuAlice", "sfualice", None);
    let (bob, bob_dir) = client("SfuBob", "sfubob", None);
    all_on(&[&alice, &bob]);
    assert!(alice.media().relays(), "the server has an SFU");
    let source = crate::share::made_up::pattern_sources().remove(1);
    let start = |engine: &RealEngine| {
        engine.media().announce(None, SignalKind::Start, Tracks::of([Content::Screen]).payload());
        engine
            .media()
            .broadcast(crate::share::Start {
                server: None,
                sources: vec![source.clone()],
                settings: crate::share::Settings::default(),
            })
            .expect("a broadcast")
    };
    let alices = start(&alice);
    let (feed, slot, wanted) = watch(&bob, session(&alice));
    let read = read_back(&slot, &wanted, 8);
    assert!(read.len() >= 30, "frames came: {}", read.len());
    assert!(read.windows(2).all(|pair| pair[1] > pair[0]), "rising: {read:?}");
    // Somebody later watches as well.
    let (carol, carol_dir) = client("SfuCarol", "sfucarol", None);
    all_on(&[&alice, &bob, &carol]);
    let (late, late_slot, late_wanted) = watch(&carol, session(&alice));
    assert!(read_back(&late_slot, &late_wanted, 6).len() >= 20, "the late one sees it");
    // Bob shares too; Carol watches both.
    let bobs = start(&bob);
    let (both, both_slot, both_wanted) = watch(&carol, session(&bob));
    assert!(read_back(&both_slot, &both_wanted, 6).len() >= 20, "two at once");
    assert!(!read_back(&late_slot, &late_wanted, 2).is_empty(), "and the first still");
    for feed in [feed, late, both] {
        feed.stop();
    }
    alices.stop();
    bobs.stop();
    done(vec![(alice, alice_dir), (bob, bob_dir), (carol, carol_dir)]);
}
