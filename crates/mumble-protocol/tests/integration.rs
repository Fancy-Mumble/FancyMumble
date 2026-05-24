//! Integration tests for the Mumble protocol client.
//!
//! These tests require a running Mumble server. Start one with:
//!
//! ```sh
//! docker compose -f crates/mumble-protocol/docker-compose.test.yml up -d
//! ```
//!
//! Then run:
//!
//! ```sh
//! cargo test --package mumble-protocol --test integration
//! ```
//!
//! The server is configured (via `test-mumble.ini`) with large message/image
//! limits so that large image tests pass.
//
// Integration tests are separate crate compilation units and will trigger
// `unused_crate_dependencies` for every transitive dep of mumble-protocol
// that is not directly imported in this file.
#![allow(
    unused_crate_dependencies,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::too_many_lines,
    reason = "integration test: transitive deps are not directly imported; unwrap/expect and long test functions are idiomatic"
)]

use std::time::Duration;

use mumble_protocol::command::{
    Authenticate, CommandAction, RequestBlob, SendTextMessage,
    SetComment, SetSelfDeaf, SetSelfMute,
};
use mumble_protocol::message::ControlMessage;
use mumble_protocol::proto::mumble_tcp;
use mumble_protocol::state::ServerState;
use mumble_protocol::transport::tcp::{TcpConfig, TcpTransport};

/// How long to wait for the server to respond.
const TIMEOUT: Duration = Duration::from_secs(10);

/// Server address for Docker container.
const HOST: &str = "127.0.0.1";

/// Port for the test server. Override with `MUMBLE_TEST_PORT` env var
/// when the default 64738 is blocked (e.g. by Windows Hyper-V).
fn port() -> u16 {
    std::env::var("MUMBLE_TEST_PORT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(64738)
}

fn tcp_config() -> TcpConfig {
    // Ensure the rustls crypto provider is installed (once per process).
    let _ = rustls::crypto::ring::default_provider().install_default();
    TcpConfig {
        server_host: HOST.into(),
        server_port: port(),
        accept_invalid_certs: true,
        client_cert_pem: None,
        client_key_pem: None,
    }
}

/// Check if the test server is reachable. Skip tests gracefully if not.
async fn ensure_server_available() -> bool {
    let addr = format!("{HOST}:{}", port());
    match tokio::time::timeout(
        Duration::from_secs(3),
        tokio::net::TcpStream::connect(&addr),
    )
    .await
    {
        Ok(Ok(_)) => true,
        _ => {
            eprintln!(
                "WARNING: Mumble test server not available at {addr}. \
                 Skipping integration test. Start it with:\n  \
                 docker compose -f crates/mumble-protocol/docker-compose.test.yml up -d"
            );
            false
        }
    }
}

/// Helper: connect TLS + send Version + Authenticate, wait for `ServerSync`.
/// Returns the transport and collected state.
async fn connect_and_authenticate(
    username: &str,
) -> (TcpTransport, ServerState) {
    let mut transport = TcpTransport::connect(&tcp_config()).await.unwrap();

    // Send Version
    let version_msg = ControlMessage::Version(mumble_tcp::Version {
        version_v2: Some(0x0001_0005_0000_0000), // 1.5.0
        release: Some("mumble-protocol-test".into()),
        os: Some(std::env::consts::OS.into()),
        os_version: Some("test".into()),
        ..Default::default()
    });
    transport.send(&version_msg).await.unwrap();

    // Send Authenticate
    let auth = Authenticate {
        username: username.into(),
        password: None,
        tokens: vec![],
    };
    let auth_output = auth.execute(&ServerState::new());
    for msg in &auth_output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    let mut state = ServerState::new();
    let mut got_sync = false;

    // Read messages until we get ServerSync
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    while !got_sync && tokio::time::Instant::now() < deadline {
        let msg = tokio::time::timeout(Duration::from_secs(5), transport.recv())
            .await
            .expect("timed out waiting for message")
            .expect("transport error");

        match &msg {
            ControlMessage::ServerSync(sync) => {
                state.apply_server_sync(sync);
                got_sync = true;
            }
            ControlMessage::UserState(us) => {
                state.apply_user_state(us);
            }
            ControlMessage::ChannelState(cs) => {
                state.apply_channel_state(cs);
            }
            ControlMessage::Reject(r) => {
                panic!(
                    "Connection rejected: {:?} - {}",
                    r.r#type,
                    r.reason.as_deref().unwrap_or("no reason")
                );
            }
            _ => {
                // ServerConfig, CodecVersion, CryptSetup, etc. - ignore
            }
        }
    }

    assert!(got_sync, "Never received ServerSync from the server");
    (transport, state)
}

// -- Tests ----------------------------------------------------------

#[tokio::test]
async fn test_tcp_connect_and_version_exchange() {
    if !ensure_server_available().await {
        return;
    }

    let mut transport = TcpTransport::connect(&tcp_config()).await.unwrap();

    // Send our version
    let version_msg = ControlMessage::Version(mumble_tcp::Version {
        version_v2: Some(0x0001_0005_0000_0000),
        release: Some("test-client".into()),
        ..Default::default()
    });
    transport.send(&version_msg).await.unwrap();

    // Server should respond with its own Version
    let response = tokio::time::timeout(TIMEOUT, transport.recv())
        .await
        .expect("timed out")
        .expect("recv error");

    match response {
        ControlMessage::Version(v) => {
            // Server should have a version set
            assert!(
                v.version_v1.is_some() || v.version_v2.is_some(),
                "server should report a version"
            );
        }
        other => {
            // Some servers may send other messages first; just verify we got data
            eprintln!("First message was not Version: {other:?}");
        }
    }
}

#[tokio::test]
async fn test_full_authentication_flow() {
    if !ensure_server_available().await {
        return;
    }

    let (_transport, state) = connect_and_authenticate("IntegTestUser").await;

    // We should have a session ID
    let session_id = state.own_session().expect("should have session ID");
    assert!(session_id > 0);

    // We should see ourselves in the user list
    assert!(
        state.users.values().any(|u| u.name == "IntegTestUser"),
        "our user should appear in state"
    );

    // There should be at least the Root channel
    assert!(
        !state.channels.is_empty(),
        "server should send at least one channel"
    );
}

#[tokio::test]
async fn test_send_text_message() {
    if !ensure_server_available().await {
        return;
    }

    let (mut transport, state) = connect_and_authenticate("TextMsgUser").await;

    // Send a text message to root channel (channel_id=0)
    let cmd = SendTextMessage {
        channel_ids: vec![0],
        user_sessions: vec![],
        tree_ids: vec![],
        message: "Hello from integration test!".into(),
        message_id: None,
        timestamp: None,
        edit_id: None,
    };
    let output = cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // The server typically echoes the text message back.
    // Wait for it with a timeout.
    let mut received_echo = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::TextMessage(tm))) => {
                if tm.message.contains("Hello from integration test!") {
                    received_echo = true;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }

    // Some server configs don't echo; just verify no error occurred
    if !received_echo {
        eprintln!("Note: server did not echo the text message (this may be normal)");
    }

    drop(transport);
}

#[tokio::test]
async fn test_send_large_image_message() {
    if !ensure_server_available().await {
        return;
    }

    let (mut transport, state) = connect_and_authenticate("LargeImgUser").await;

    // Create a large "image" payload (~1 MiB base64-encoded fake PNG).
    // This tests that the server's imagemessagelength limit is large enough.
    let image_bytes = vec![0xAAu8; 512 * 1024]; // 512 KiB raw
    let base64_image = base64_encode(&image_bytes);

    let html_message = format!(
        "<img src=\"data:image/png;base64,{base64_image}\" />"
    );

    let cmd = SendTextMessage {
        channel_ids: vec![0],
        user_sessions: vec![],
        tree_ids: vec![],
        message: html_message.clone(),
        message_id: None,
        timestamp: None,
        edit_id: None,
    };
    let output = cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // If the server accepted it, we should not get a PermissionDenied with TextTooLong.
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut permission_denied = false;
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::PermissionDenied(pd))) => {
                if pd.r#type == Some(mumble_tcp::permission_denied::DenyType::TextTooLong as i32) {
                    permission_denied = true;
                    break;
                }
            }
            Ok(Ok(ControlMessage::TextMessage(_))) => {
                // Got the message back - success
                break;
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }

    assert!(
        !permission_denied,
        "Server rejected the large image message. \
         Ensure imagemessagelength is set high enough in test-mumble.ini"
    );

    drop(transport);
}

#[tokio::test]
async fn test_set_self_mute_and_deaf() {
    if !ensure_server_available().await {
        return;
    }

    let (mut transport, state) = connect_and_authenticate("MuteDeafUser").await;

    // Self-mute
    let mute_cmd = SetSelfMute { muted: true };
    let output = mute_cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // Wait for the server to echo back our UserState
    let mut got_mute_ack = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::UserState(us))) => {
                if us.session == state.own_session() && us.self_mute == Some(true) {
                    got_mute_ack = true;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(got_mute_ack, "Server should acknowledge self-mute");

    // Self-deaf (implies mute)
    let deaf_cmd = SetSelfDeaf { deafened: true };
    let output = deaf_cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    let mut got_deaf_ack = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::UserState(us))) => {
                if us.session == state.own_session() && us.self_deaf == Some(true) {
                    got_deaf_ack = true;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(got_deaf_ack, "Server should acknowledge self-deaf");

    drop(transport);
}

#[tokio::test]
async fn test_set_comment() {
    if !ensure_server_available().await {
        return;
    }

    let (mut transport, state) = connect_and_authenticate("CommentUser").await;

    let cmd = SetComment {
        comment: "Integration test comment".into(),
    };
    let output = cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // Wait for echoed UserState with our comment
    let mut got_comment = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::UserState(us))) => {
                if us.session == state.own_session()
                    && us.comment.as_deref() == Some("Integration test comment")
                {
                    got_comment = true;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(got_comment, "Server should echo our comment");

    drop(transport);
}

#[tokio::test]
async fn test_ping_keepalive() {
    if !ensure_server_available().await {
        return;
    }

    let (mut transport, _state) = connect_and_authenticate("PingUser").await;

    // Send a TCP Ping
    let ping_msg = ControlMessage::Ping(mumble_tcp::Ping {
        timestamp: Some(42),
        ..Default::default()
    });
    transport.send(&ping_msg).await.unwrap();

    // Server should respond with a Ping
    let mut got_pong = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(2), transport.recv()).await {
            Ok(Ok(ControlMessage::Ping(_))) => {
                got_pong = true;
                break;
            }
            Ok(Ok(_)) => continue,
            Ok(Err(_)) | Err(_) => break,
        }
    }
    assert!(got_pong, "Server should respond to TCP ping");

    drop(transport);
}

#[tokio::test]
async fn test_multiple_concurrent_connections() {
    if !ensure_server_available().await {
        return;
    }

    // Connect two users simultaneously
    let (_t1, state1) = connect_and_authenticate("ConcUser1").await;
    let (_t2, state2) = connect_and_authenticate("ConcUser2").await;

    // Both should have valid sessions
    assert!(state1.own_session().is_some());
    assert!(state2.own_session().is_some());
    assert_ne!(state1.own_session(), state2.own_session());

    // User2 should see User1 already connected
    // (The server sends UserState for existing users during handshake)
    let user1_visible = state2.users.values().any(|u| u.name == "ConcUser1");
    assert!(
        user1_visible,
        "User2 should see User1 in the state after connecting"
    );
}

#[tokio::test]
async fn test_server_config_has_large_limits() {
    if !ensure_server_available().await {
        return;
    }

    let mut transport = TcpTransport::connect(&tcp_config()).await.unwrap();

    // Send Version + Auth
    transport
        .send(&ControlMessage::Version(mumble_tcp::Version {
            version_v2: Some(0x0001_0005_0000_0000),
            ..Default::default()
        }))
        .await
        .unwrap();
    let auth = Authenticate {
        username: "ConfigCheckUser".into(),
        password: None,
        tokens: vec![],
    };
    for msg in &auth.execute(&ServerState::new()).tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // Read messages until we find ServerConfig
    let mut server_config = None;
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), transport.recv()).await {
            Ok(Ok(ControlMessage::ServerConfig(sc))) => {
                server_config = Some(sc);
                break;
            }
            Ok(Ok(ControlMessage::ServerSync(_))) => break,
            Ok(Ok(_)) => continue,
            _ => break,
        }
    }

    if let Some(config) = server_config {
        // Verify the server is configured with large image limits
        if let Some(img_len) = config.image_message_length {
            assert!(
                img_len >= 1_048_576,
                "image_message_length should be >= 1 MiB, got {img_len}"
            );
        }
        if let Some(msg_len) = config.message_length {
            assert!(
                msg_len >= 65536,
                "message_length should be >= 64 KiB, got {msg_len}"
            );
        }
    } else {
        eprintln!("Note: server did not send ServerConfig before ServerSync");
    }

    drop(transport);
}

// -- PluginDataTransmission tests removed (feature bricked) ----------
// PluginDataTransmission is permanently forbidden in Fancy Mumble.
// The polls/live-doc functionality moved to typed protobuf messages
// (FancyPoll, FancyPollVote, FancyLiveDoc*) - see proto/Mumble.proto.
// Add new integration tests for the typed messages once the server
// side lands the matching handlers.


/// When the server has a channel with a large description it sends only
/// `description_hash` during the initial handshake.  A subsequent
/// `RequestBlob` with the channel ID should cause the server to send
/// a `ChannelState` containing the full `description`.
#[tokio::test]
async fn test_channel_description_blob_request() {
    if !ensure_server_available().await {
        return;
    }

    // Build a description large enough that the server will defer it
    // and only send `description_hash`.  The threshold is typically
    // around 128 bytes.
    let large_description = format!(
        "<p>{}</p><p><a href=\"https://example.com\">Link</a></p>",
        "A".repeat(256),
    );

    // 1) SuperUser creates a channel with a large description.
    let channel_name = "DescBlobTest";
    let mut su = TcpTransport::connect(&tcp_config()).await.unwrap();
    su.send(&ControlMessage::Version(mumble_tcp::Version {
        version_v2: Some(0x0001_0005_0000_0000),
        ..Default::default()
    }))
    .await
    .unwrap();
    let auth = Authenticate {
        username: "SuperUser".into(),
        password: Some("testpassword".into()),
        tokens: vec![],
    };
    for msg in &auth.execute(&ServerState::new()).tcp_messages {
        su.send(msg).await.unwrap();
    }
    let deadline = tokio::time::Instant::now() + TIMEOUT;
    let mut synced = false;
    while !synced && tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), su.recv()).await {
            Ok(Ok(ControlMessage::ServerSync(_))) => synced = true,
            Ok(Ok(ControlMessage::Reject(r))) => {
                eprintln!("SuperUser rejected: {:?}", r.reason);
                return;
            }
            Ok(Ok(_)) => continue,
            _ => break,
        }
    }
    if !synced {
        eprintln!("WARNING: could not authenticate as SuperUser. Skipping.");
        return;
    }

    su.send(&ControlMessage::ChannelState(mumble_tcp::ChannelState {
        parent: Some(0),
        name: Some(channel_name.into()),
        description: Some(large_description.clone()),
        temporary: Some(true),
        ..Default::default()
    }))
    .await
    .unwrap();

    // Wait for the server to echo the ChannelState with the assigned ID.
    let mut new_channel_id: Option<u32> = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), su.recv()).await {
            Ok(Ok(ControlMessage::ChannelState(cs))) => {
                if cs.name.as_deref() == Some(channel_name) {
                    new_channel_id = cs.channel_id;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            _ => break,
        }
    }
    let Some(channel_id) = new_channel_id else {
        eprintln!("WARNING: could not create temp channel. Skipping.");
        return;
    };

    // 2) A regular client connects and collects channels.
    let (mut transport, state) = connect_and_authenticate("DescBlobUser").await;

    // Check whether the server deferred the description (sent hash only).
    let ch = state.channels.get(&channel_id);
    let description_was_deferred =
        ch.is_some_and(|c| c.description.is_empty() && c.description_hash.is_some());

    if !description_was_deferred {
        // Some server versions inline all descriptions.  If the
        // description is already present, there is nothing to test; just
        // verify it matches and return.
        if let Some(c) = ch {
            assert_eq!(
                c.description, large_description,
                "description should match what was set"
            );
        }
        eprintln!(
            "Note: server inlined the description (no hash). \
             RequestBlob path not exercised."
        );
        drop(transport);
        drop(su);
        return;
    }

    // 3) Send RequestBlob to fetch the full description.
    let cmd = RequestBlob {
        session_texture: Vec::new(),
        session_comment: Vec::new(),
        channel_description: vec![channel_id],
        user_id_comment: Vec::new(),
    };
    let output = cmd.execute(&state);
    for msg in &output.tcp_messages {
        transport.send(msg).await.unwrap();
    }

    // 4) The server responds with a ChannelState containing the full
    //    description.
    let mut got_description = false;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), transport.recv()).await {
            Ok(Ok(ControlMessage::ChannelState(cs))) => {
                if let Some(desc) = cs.description.filter(|_| cs.channel_id == Some(channel_id)) {
                    assert_eq!(
                        desc, large_description,
                        "description blob should match the original"
                    );
                    got_description = true;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(e)) => panic!("transport error: {e}"),
            Err(_) => break,
        }
    }

    assert!(
        got_description,
        "Server should respond with the full channel description after RequestBlob"
    );

    drop(transport);
    drop(su);
}

// -- TextMessage message_id preservation tests ----------------------

/// Regression test: the server must preserve a client-provided `message_id`
/// in `TextMessage` rather than replacing it with a server-generated UUID.
///
/// Without this, each user ends up with a different `message_id` for the
/// same message, causing reactions (keyed by `message_id`) to be invisible
/// across users.
#[tokio::test]
async fn test_text_message_preserves_client_message_id() {
    if !ensure_server_available().await {
        return;
    }

    let (mut t1, state1) = connect_and_authenticate("MsgIdUser1").await;
    let (mut t2, _state2) = connect_and_authenticate("MsgIdUser2").await;

    // Drain any pending messages on t2 so we start clean.
    let drain_deadline = tokio::time::Instant::now() + Duration::from_millis(500);
    while tokio::time::Instant::now() < drain_deadline {
        if tokio::time::timeout(Duration::from_millis(200), t2.recv())
            .await
            .is_err()
        {
            break;
        }
    }

    // User1 sends a TextMessage with a client-provided message_id.
    let client_message_id = "client-uuid-deadbeef-1234";
    let client_timestamp = 1_700_000_000_000_u64;
    let cmd = SendTextMessage {
        channel_ids: vec![0],
        user_sessions: vec![],
        tree_ids: vec![],
        message: "hello with id".into(),
        message_id: Some(client_message_id.to_owned()),
        timestamp: Some(client_timestamp),
        edit_id: None,
    };
    for msg in &cmd.execute(&state1).tcp_messages {
        t1.send(msg).await.unwrap();
    }

    // User2 should receive the TextMessage with the SAME message_id.
    // NOTE: `message_id` is a Fancy Mumble proto extension (field 6).
    // Standard murmur reconstructs the TextMessage and drops unknown fields,
    // so we separate "did User2 receive the message?" from "was message_id
    // preserved?" to avoid a misleading panic.
    let mut received_msg = false;
    let mut received_id: Option<String> = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), t2.recv()).await {
            Ok(Ok(ControlMessage::TextMessage(tm))) => {
                if tm.message.contains("hello with id") {
                    received_msg = true;
                    received_id = tm.message_id;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(e)) => panic!("recv error: {e}"),
            Err(_) => break,
        }
    }

    assert!(received_msg, "User2 should receive the TextMessage");

    // If the server doesn't preserve message_id (standard murmur), skip.
    let Some(received_id) = received_id else {
        eprintln!(
            "NOTE: server did not preserve message_id (standard murmur). \
             Skipping assertion."
        );
        return;
    };
    assert_eq!(
        received_id, client_message_id,
        "server must preserve client-provided message_id, got {received_id}"
    );

    drop(t1);
    drop(t2);
}

/// Verify the server still generates a `message_id` when the client omits it
/// (legacy client compatibility).
#[tokio::test]
async fn test_text_message_generates_id_when_omitted() {
    if !ensure_server_available().await {
        return;
    }

    let (mut t1, state1) = connect_and_authenticate("MsgIdGen1").await;
    let (mut t2, _state2) = connect_and_authenticate("MsgIdGen2").await;

    let drain_deadline = tokio::time::Instant::now() + Duration::from_millis(500);
    while tokio::time::Instant::now() < drain_deadline {
        if tokio::time::timeout(Duration::from_millis(200), t2.recv())
            .await
            .is_err()
        {
            break;
        }
    }

    // Send without message_id (legacy client behaviour).
    let cmd = SendTextMessage {
        channel_ids: vec![0],
        user_sessions: vec![],
        tree_ids: vec![],
        message: "hello no id".into(),
        message_id: None,
        timestamp: None,
        edit_id: None,
    };
    for msg in &cmd.execute(&state1).tcp_messages {
        t1.send(msg).await.unwrap();
    }

    // NOTE: `message_id` generation is a Fancy Mumble extension.  Standard
    // murmur does not add a message_id, so we separate delivery from the
    // extension assertion.
    let mut received_msg = false;
    let mut received_id: Option<String> = None;
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    while tokio::time::Instant::now() < deadline {
        match tokio::time::timeout(Duration::from_secs(3), t2.recv()).await {
            Ok(Ok(ControlMessage::TextMessage(tm))) => {
                if tm.message.contains("hello no id") {
                    received_msg = true;
                    received_id = tm.message_id;
                    break;
                }
            }
            Ok(Ok(_)) => continue,
            Ok(Err(e)) => panic!("recv error: {e}"),
            Err(_) => break,
        }
    }

    assert!(received_msg, "User2 should receive the TextMessage");

    // If the server doesn't generate a message_id (standard murmur), skip.
    let Some(received_id) = received_id else {
        eprintln!(
            "NOTE: server did not generate a message_id (standard murmur). \
             Skipping assertion."
        );
        return;
    };
    assert!(
        !received_id.is_empty(),
        "server should generate a non-empty message_id when the client omits it"
    );

    drop(t1);
    drop(t2);
}

// -- Helpers --------------------------------------------------------

/// Minimal base64 encoder (avoids adding a `base64` dependency just for tests).
fn base64_encode(data: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity(data.len().div_ceil(3) * 4);

    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARS[((triple >> 18) & 0x3F) as usize] as char);
        result.push(CHARS[((triple >> 12) & 0x3F) as usize] as char);

        if chunk.len() > 1 {
            result.push(CHARS[((triple >> 6) & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[(triple & 0x3F) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}
