//! End-to-end tests for the presence service, including the coexistence
//! behaviour that is the whole point of the crate.
//!
//! These tests drive real sockets. They redirect `XDG_RUNTIME_DIR` at a
//! temporary directory so they bind throwaway slots instead of the ones a
//! real Discord client on the developer's machine is using, and they
//! serialise on [`TEST_LOCK`] because that environment variable and the slot
//! numbers under it are process-wide.

#![cfg(unix)]
#![allow(
    clippy::expect_used,
    reason = "test setup: a failure here should abort the test loudly"
)]

// Dependencies of the library that this test binary links but does not name.
use serde as _;
use tracing as _;

use std::path::Path;
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Duration;

use fancy_presence::codec::{self, IpcFrame, Opcode};
use fancy_presence::transport::{self, Listener};
use fancy_presence::{BridgeState, PresenceConfig, PresenceEvent, PresenceService};
use serde_json::{json, Value};
use tokio::time::timeout;

/// Serialises tests: `XDG_RUNTIME_DIR` and the slots beneath it are global.
static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Long enough to absorb scheduling jitter, short enough to fail fast.
const SETTLE: Duration = Duration::from_secs(5);

/// Poll interval used by the tests, so "Discord started" is noticed promptly.
const FAST_POLL: Duration = Duration::from_millis(50);

fn test_config() -> PresenceConfig {
    PresenceConfig {
        discord_poll_interval: FAST_POLL,
        ..PresenceConfig::default()
    }
}

fn handshake_frame(client_id: &str) -> IpcFrame {
    IpcFrame::from_json(
        Opcode::Handshake,
        &json!({ "v": 1, "client_id": client_id }),
    )
}

fn set_activity_frame(nonce: &str, details: &str) -> IpcFrame {
    IpcFrame::from_json(
        Opcode::Frame,
        &json!({
            "cmd": "SET_ACTIVITY",
            "nonce": nonce,
            "args": {
                "pid": 4321,
                "activity": {
                    "details": details,
                    "state": "In a test",
                    "timestamps": { "start": 1_700_000_000 },
                },
            },
        }),
    )
}

/// A stand-in for the real Discord client, recording everything it is sent.
struct FakeDiscord {
    received: Arc<Mutex<Vec<Value>>>,
    task: tokio::task::JoinHandle<()>,
}

impl FakeDiscord {
    /// Bind `path` and start answering handshakes.
    async fn start(path: &Path) -> Self {
        let mut listener = Listener::bind(path).await.expect("fake Discord bind");
        let received = Arc::new(Mutex::new(Vec::new()));
        let sink = Arc::clone(&received);

        let task = tokio::spawn(async move {
            while let Ok(endpoint) = listener.accept().await {
                let sink = Arc::clone(&sink);
                let _connection = tokio::spawn(serve_fake_client(endpoint, sink));
            }
        });
        Self { received, task }
    }

    fn frames(&self) -> Vec<Value> {
        self.received
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .clone()
    }

    /// Wait until a recorded frame satisfies `predicate`.
    async fn wait_for(&self, predicate: impl Fn(&Value) -> bool) -> Value {
        let found = timeout(SETTLE, async {
            loop {
                if let Some(frame) = self.frames().into_iter().find(&predicate) {
                    return frame;
                }
                tokio::time::sleep(FAST_POLL).await;
            }
        })
        .await;
        found.expect("fake Discord never received a matching frame")
    }
}

impl Drop for FakeDiscord {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn serve_fake_client(endpoint: transport::Endpoint, sink: Arc<Mutex<Vec<Value>>>) {
    let (mut reader, mut writer) = tokio::io::split(endpoint);

    // The real client answers a handshake with a READY carrying its user.
    let Ok(handshake) = codec::read_frame(&mut reader).await else {
        return;
    };
    record(&sink, &handshake);
    let ready = IpcFrame::from_json(
        Opcode::Frame,
        &json!({
            "cmd": "DISPATCH",
            "evt": "READY",
            "data": { "v": 1, "user": { "username": "real-discord" } },
        }),
    );
    if codec::write_frame(&mut writer, &ready).await.is_err() {
        return;
    }

    while let Ok(frame) = codec::read_frame(&mut reader).await {
        record(&sink, &frame);
        let Ok(value) = frame.to_json() else { continue };
        let response = IpcFrame::from_json(
            Opcode::Frame,
            &json!({
                "cmd": value.get("cmd").cloned().unwrap_or(Value::Null),
                "data": Value::Null,
                "evt": Value::Null,
                "nonce": value.get("nonce").cloned().unwrap_or(Value::Null),
            }),
        );
        if codec::write_frame(&mut writer, &response).await.is_err() {
            return;
        }
    }
}

fn record(sink: &Arc<Mutex<Vec<Value>>>, frame: &IpcFrame) {
    if let Ok(value) = frame.to_json() {
        sink.lock()
            .unwrap_or_else(PoisonError::into_inner)
            .push(value);
    }
}

/// Connect to a slot and complete the handshake, returning the READY frame.
async fn connect_client(
    dir: &Path,
    slot: u8,
    client_id: &str,
) -> (transport::Endpoint, Value) {
    let mut endpoint = transport::connect(&dir.join(format!("discord-ipc-{slot}")))
        .await
        .expect("client connect");
    codec::write_frame(&mut endpoint, &handshake_frame(client_id))
        .await
        .expect("send handshake");
    let ready = timeout(SETTLE, codec::read_frame(&mut endpoint))
        .await
        .expect("READY timed out")
        .expect("read READY")
        .to_json()
        .expect("READY json");
    (endpoint, ready)
}

async fn await_bridge_state(service: &PresenceService, expected: BridgeState) {
    let reached = timeout(SETTLE, async {
        while service.bridge_state() != expected {
            tokio::time::sleep(FAST_POLL).await;
        }
    })
    .await;
    assert!(
        reached.is_ok(),
        "expected {expected:?}, still {:?}",
        service.bridge_state()
    );
}

/// Redirect the IPC directory at a fresh temporary directory.
fn redirect_runtime_dir() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("tempdir");
    std::env::set_var("XDG_RUNTIME_DIR", dir.path());
    dir
}

#[tokio::test]
async fn records_activity_from_a_client_when_discord_is_absent() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    assert_eq!(service.slot(), 0, "should take slot 0 when it is free");
    assert_eq!(service.bridge_state(), BridgeState::Standalone);
    let mut events = service.subscribe();

    let (mut client, ready) = connect_client(dir.path(), 0, "12345").await;
    assert_eq!(ready["evt"], "READY", "standalone mode must answer READY");

    codec::write_frame(&mut client, &set_activity_frame("n1", "Testing"))
        .await
        .expect("send activity");
    let response = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("response timed out")
        .expect("read response")
        .to_json()
        .expect("response json");
    assert_eq!(response["nonce"], "n1", "response must echo the nonce");

    let event = timeout(SETTLE, events.recv())
        .await
        .expect("event timed out")
        .expect("event");
    let PresenceEvent::Updated(entry) = event else {
        panic!("expected an Updated event, got {event:?}");
    };
    assert_eq!(entry.application_id, "12345");
    assert_eq!(entry.pid, Some(4321));
    assert_eq!(entry.activity.details.as_deref(), Some("Testing"));
    assert_eq!(
        entry
            .activity
            .timestamps
            .as_ref()
            .and_then(|t| t.start),
        Some(1_700_000_000_000),
        "second-precision timestamps should be promoted to millis"
    );

    assert_eq!(service.snapshot().len(), 1);
}

#[tokio::test]
async fn drops_an_entry_when_its_client_disconnects() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    let (mut client, _ready) = connect_client(dir.path(), 0, "12345").await;
    codec::write_frame(&mut client, &set_activity_frame("n1", "Testing"))
        .await
        .expect("send activity");
    let _response = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("response timed out")
        .expect("read response");
    assert_eq!(service.snapshot().len(), 1);

    drop(client);

    let emptied = timeout(SETTLE, async {
        while !service.snapshot().is_empty() {
            tokio::time::sleep(FAST_POLL).await;
        }
    })
    .await;
    assert!(emptied.is_ok(), "entry outlived its client");
}

#[tokio::test]
async fn clears_an_entry_when_the_application_sends_an_empty_activity() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    let (mut client, _ready) = connect_client(dir.path(), 0, "12345").await;

    codec::write_frame(&mut client, &set_activity_frame("n1", "Testing"))
        .await
        .expect("send activity");
    let _first = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("timeout")
        .expect("response");
    assert_eq!(service.snapshot().len(), 1);

    let clear = IpcFrame::from_json(
        Opcode::Frame,
        &json!({ "cmd": "SET_ACTIVITY", "nonce": "n2", "args": { "pid": 4321 } }),
    );
    codec::write_frame(&mut client, &clear)
        .await
        .expect("send clear");
    let _second = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("timeout")
        .expect("response");

    assert!(service.snapshot().is_empty(), "null activity should clear");
}

#[tokio::test]
async fn forwards_to_discord_and_still_observes_the_activity() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    // Discord is already on slot 1 - as it would be if it started after us.
    let discord = FakeDiscord::start(&dir.path().join("discord-ipc-1")).await;
    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    assert_eq!(service.slot(), 0);
    await_bridge_state(&service, BridgeState::Bridged).await;

    let (mut client, ready) = connect_client(dir.path(), 0, "12345").await;
    assert_eq!(
        ready["data"]["user"]["username"], "real-discord",
        "bridged clients must receive Discord's own READY, not ours"
    );

    codec::write_frame(&mut client, &set_activity_frame("n1", "Bridged"))
        .await
        .expect("send activity");

    let forwarded = discord
        .wait_for(|value| value.get("cmd").and_then(Value::as_str) == Some("SET_ACTIVITY"))
        .await;
    assert_eq!(
        forwarded["args"]["activity"]["details"], "Bridged",
        "Discord must receive the activity unmodified"
    );
    assert_eq!(forwarded["nonce"], "n1");

    let response = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("response timed out")
        .expect("read response")
        .to_json()
        .expect("response json");
    assert_eq!(
        response["nonce"], "n1",
        "Discord's response must reach the client"
    );

    // The point of the exercise: we saw it too.
    let snapshot = service.snapshot();
    assert_eq!(snapshot.len(), 1);
    assert_eq!(snapshot[0].activity.details.as_deref(), Some("Bridged"));
}

#[tokio::test]
async fn attaches_to_discord_when_it_starts_mid_session() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    let (mut client, ready) = connect_client(dir.path(), 0, "12345").await;
    assert_eq!(ready["evt"], "READY");

    codec::write_frame(&mut client, &set_activity_frame("n1", "Started early"))
        .await
        .expect("send activity");
    let _response = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("timeout")
        .expect("response");

    // Discord launches now, after the application is already running.
    let discord = FakeDiscord::start(&dir.path().join("discord-ipc-1")).await;
    await_bridge_state(&service, BridgeState::Bridged).await;

    let replayed = discord
        .wait_for(|value| value.get("cmd").and_then(Value::as_str) == Some("SET_ACTIVITY"))
        .await;
    assert_eq!(
        replayed["args"]["activity"]["details"], "Started early",
        "Discord should be caught up with the activity it missed"
    );
    assert!(
        discord
            .frames()
            .iter()
            .any(|value| value.get("client_id").is_some()),
        "the client's handshake should have been replayed"
    );

    // The client must not see the consequences of that catch-up: it already
    // had a READY and already had its nonce answered.
    let stray = timeout(Duration::from_millis(750), codec::read_frame(&mut client)).await;
    assert!(
        stray.is_err(),
        "client received an unexpected frame after the bridge attached: {:?}",
        stray.map(|f| f.map(|f| f.to_json()))
    );
}

#[tokio::test]
async fn keeps_serving_a_client_after_discord_exits() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let discord = FakeDiscord::start(&dir.path().join("discord-ipc-1")).await;
    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    await_bridge_state(&service, BridgeState::Bridged).await;

    let (mut client, _ready) = connect_client(dir.path(), 0, "12345").await;
    drop(discord);
    // Whichever of us gets there first, the socket has to be gone before the
    // watcher can tell that Discord left.
    let _removed = std::fs::remove_file(dir.path().join("discord-ipc-1"));
    await_bridge_state(&service, BridgeState::Standalone).await;

    // With Discord gone we have to answer for it, or the client hangs.
    codec::write_frame(&mut client, &set_activity_frame("n2", "After Discord"))
        .await
        .expect("send activity");
    let response = timeout(SETTLE, codec::read_frame(&mut client))
        .await
        .expect("response timed out")
        .expect("read response")
        .to_json()
        .expect("response json");
    assert_eq!(response["nonce"], "n2");
    assert_eq!(
        service.snapshot()[0].activity.details.as_deref(),
        Some("After Discord")
    );
}

#[tokio::test]
async fn stands_aside_when_discord_already_holds_slot_zero() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    // Discord got there first.
    let discord_path = dir.path().join("discord-ipc-0");
    let _discord = FakeDiscord::start(&discord_path).await;

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");

    assert_eq!(service.slot(), 1, "must not displace the occupant of slot 0");
    await_bridge_state(&service, BridgeState::Blocked).await;
    assert!(
        transport::connect(&discord_path).await.is_ok(),
        "Discord's socket must still work"
    );
}

#[tokio::test]
async fn releases_its_slot_on_shutdown_so_a_restart_still_gets_slot_zero() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();
    let slot_zero = dir.path().join("discord-ipc-0");

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    assert!(transport::connect(&slot_zero).await.is_ok());

    service.shutdown().await;
    assert!(
        !slot_zero.exists(),
        "the socket file must not outlive an awaited shutdown"
    );

    // The point of awaiting: an immediate restart must not be pushed onto a
    // higher slot by our own leftovers.
    let restarted = PresenceService::start(test_config())
        .await
        .expect("restart");
    assert_eq!(restarted.slot(), 0);
}

#[tokio::test]
async fn hangs_up_on_a_client_that_never_handshakes() {
    let _guard = TEST_LOCK.lock().await;
    let dir = redirect_runtime_dir();

    let service = PresenceService::start(test_config())
        .await
        .expect("service start");
    let mut endpoint = transport::connect(&dir.path().join("discord-ipc-0"))
        .await
        .expect("connect");

    // A frame in the wrong place: the protocol requires a handshake first.
    codec::write_frame(&mut endpoint, &set_activity_frame("n1", "No handshake"))
        .await
        .expect("send");

    let frame = timeout(SETTLE, codec::read_frame(&mut endpoint))
        .await
        .expect("close timed out")
        .expect("read close");
    assert_eq!(frame.opcode, Opcode::Close);
    assert!(service.snapshot().is_empty());
}
