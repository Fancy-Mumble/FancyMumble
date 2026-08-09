//! Two real peers on one server, one per cipher, hearing each other.
//!
//! The combination nothing else covers: a stock Mumble client keyed with OCB2
//! and a Fancy client keyed with `XChaCha20-Poly1305`, in one channel. A frame
//! crossing between them is decrypted under one cipher and re-encrypted under
//! the other, so this exercises the entire relay rather than a passthrough.
//!
//! Skips when no server is listening, so it is safe in the suite; when one is,
//! it opens two sessions against it - one announcing nothing (stock Mumble: OCB2) and one announcing Fancy
//! 0.4.0 (XChaCha20-Poly1305) - proves each one's UDP path with a ping, then has
//! the legacy peer speak and checks whether the frame reaches the modern one.
//!
//! Every step prints, because the point is to find *which* one stops.

use std::net::UdpSocket;
use std::time::Duration;

use mumble_protocol::command::{Authenticate, CommandAction};
use mumble_protocol::message::ControlMessage;
use mumble_protocol::proto::{mumble_tcp, mumble_udp};
use mumble_protocol::state::ServerState;
use mumble_protocol::transport::tcp::{TcpConfig, TcpTransport};
use mumble_protocol::transport::udp::CryptState;
use mumble_protocol::transport::voice_crypt::VoiceCrypt;
use prost::Message as _;

fn port() -> u16 {
    std::env::var("MUMBLE_TEST_PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(64738)
}

/// One connected peer: its control connection, its cipher, and its UDP socket.
struct Peer {
    label: &'static str,
    transport: TcpTransport,
    crypt: VoiceCrypt,
    socket: UdpSocket,
    session: u32,
}

impl Peer {
    /// Connect, authenticate, and key the voice path.
    async fn connect(label: &'static str, username: &str, fancy: Option<u64>) -> Option<Self> {
        let _ = rustls::crypto::ring::default_provider().install_default();
        let config = TcpConfig {
            server_host: "127.0.0.1".into(),
            server_port: port(),
            accept_invalid_certs: true,
            client_cert_pem: None,
            client_key_pem: None,
        };

        let mut transport = TcpTransport::connect(&config).await.ok()?;
        transport
            .send(&ControlMessage::Version(mumble_tcp::Version {
                version_v2: Some(0x0001_0005_0359_0000),
                release: Some("1.5.857".into()),
                fancy_version: fancy,
                ..Default::default()
            }))
            .await
            .expect("send version");

        let auth = Authenticate {
            username: username.into(),
            password: None,
            tokens: vec![],
            totp: None,
        };
        for msg in &auth.execute(&ServerState::new()).tcp_messages {
            transport.send(msg).await.expect("send auth");
        }

        // Both `ServerSync` (for the session id) and `CryptSetup` (for the keys).
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        let (mut setup, mut session) = (None, None);
        while (setup.is_none() || session.is_none()) && tokio::time::Instant::now() < deadline {
            let Ok(Ok(msg)) = tokio::time::timeout(Duration::from_secs(3), transport.recv()).await
            else {
                break;
            };
            match msg {
                ControlMessage::CryptSetup(cs) => setup = Some(cs),
                ControlMessage::ServerSync(sync) => session = sync.session,
                _ => {}
            }
        }

        let cs = setup.expect("no CryptSetup");
        let crypt = VoiceCrypt::negotiate(
            &fancy_utils::gate::Gate::stock(),
            &cs.key.expect("key"),
            &cs.client_nonce.expect("client_nonce"),
            &cs.server_nonce.expect("server_nonce"),
        )
        .expect("negotiate");

        let socket = UdpSocket::bind("127.0.0.1:0").expect("bind udp");
        socket
            .set_read_timeout(Some(Duration::from_secs(4)))
            .expect("timeout");

        let session = session.expect("no ServerSync session");
        println!("PROBE[{label}]: session={session} cipher={}", crypt.name());
        Some(Self {
            label,
            transport,
            crypt,
            socket,
            session,
        })
    }

    /// Send an encrypted datagram.
    fn send(&mut self, payload: &[u8]) {
        let encrypted = self.crypt.encrypt(payload).expect("encrypt");
        let _ = self
            .socket
            .send_to(&encrypted, ("127.0.0.1", port()))
            .expect("send");
    }

    /// Prove this peer's UDP path by pinging, so the server binds its address.
    fn prove_udp(&mut self) -> bool {
        let mut payload = vec![1_u8];
        mumble_udp::Ping {
            timestamp: 0x0123_4567,
            ..Default::default()
        }
        .encode(&mut payload)
        .expect("encode ping");
        self.send(&payload);

        let mut buffer = [0_u8; 2048];
        match self.socket.recv_from(&mut buffer) {
            Ok((len, _)) => {
                let ok = self.crypt.decrypt(&buffer[..len]).is_ok();
                println!("PROBE[{}]: udp path proven={ok}", self.label);
                ok
            }
            Err(e) => {
                println!("PROBE[{}]: *** no ping reply ({e}) ***", self.label);
                false
            }
        }
    }

    /// Speak one frame of (fake) Opus at normal-speech target.
    fn speak(&mut self, opus: &[u8]) {
        let mut payload = vec![0_u8]; // Audio
        mumble_udp::Audio {
            header: Some(mumble_udp::audio::Header::Target(0)),
            frame_number: 1,
            opus_data: opus.to_vec(),
            ..Default::default()
        }
        .encode(&mut payload)
        .expect("encode audio");
        println!("PROBE[{}]: speaking {} bytes", self.label, payload.len());
        self.send(&payload);
    }

    /// Speak one frame through `UDPTunnel` over TCP instead of UDP.
    ///
    /// What a real Mumble client does the moment it decides its UDP path is
    /// unreliable - and it never goes back for the rest of the session. The
    /// payload is byte-identical to the UDP one; only the transport differs.
    ///
    /// Note it is **not** encrypted: the TLS connection already protects it, and
    /// upstream sends the bare audio frame inside the tunnel.
    async fn speak_tunnelled(&mut self, opus: &[u8]) {
        let mut payload = vec![0_u8]; // Audio
        mumble_udp::Audio {
            header: Some(mumble_udp::audio::Header::Target(0)),
            frame_number: 2,
            opus_data: opus.to_vec(),
            ..Default::default()
        }
        .encode(&mut payload)
        .expect("encode audio");

        println!("PROBE[{}]: speaking {} bytes through UDPTunnel", self.label, payload.len());
        self.transport
            .send(&ControlMessage::UdpTunnel(payload.into()))
            .await
            .expect("send tunnel");
    }

    /// Whether an audio frame arrives, and from whom.
    fn listen(&mut self) -> Option<mumble_udp::Audio> {
        let mut buffer = [0_u8; 2048];
        let (len, _) = self.socket.recv_from(&mut buffer).ok()?;
        let plain = match self.crypt.decrypt(&buffer[..len]) {
            Ok(plain) => plain,
            Err(e) => {
                println!("PROBE[{}]: *** received {len} bytes that did NOT decrypt: {e} ***", self.label);
                return None;
            }
        };
        if plain.first() != Some(&0) {
            println!("PROBE[{}]: received a non-audio datagram (prefix {:?})", self.label, plain.first());
            return None;
        }
        mumble_udp::Audio::decode(&plain[1..]).ok()
    }
}

#[tokio::test]
async fn legacy_and_modern_peers_can_hear_each_other() {
    let Some(mut legacy) = Peer::connect("legacy", "probe-legacy", None).await else {
        println!("PROBE: no server on {}; nothing to do", port());
        return;
    };
    let modern = Peer::connect("modern", "probe-modern", Some(mumble_protocol::FANCY_VERSION)).await;
    let Some(mut modern) = modern else {
        println!("PROBE: the modern peer could not connect");
        return;
    };

    assert!(legacy.prove_udp(), "the legacy peer has no UDP path");
    assert!(modern.prove_udp(), "the modern peer has no UDP path");

    // Legacy speaks; modern must hear it, re-encrypted under its own cipher.
    // The frame that leaves is never the frame that arrived - different cipher,
    // different keys - so this is the whole relay path, not a passthrough.
    let (legacy_session, modern_session) = (legacy.session, modern.session);
    legacy.speak(b"legacy opus payload");
    let heard = modern
        .listen()
        .expect("the modern peer heard nothing from the legacy one");
    assert_eq!(
        heard.opus_data, b"legacy opus payload",
        "the payload was altered in relay"
    );
    assert_eq!(
        heard.sender_session, legacy_session,
        "the frame was attributed to the wrong speaker"
    );

    // And the other way, which uses entirely different keys again.
    modern.speak(b"modern opus payload");
    let heard = legacy
        .listen()
        .expect("the legacy peer heard nothing from the modern one");
    assert_eq!(heard.opus_data, b"modern opus payload");
    assert_eq!(heard.sender_session, modern_session);

    // The fallback path. A real Mumble client that decides UDP is unreliable
    // switches to this and never switches back, so a server that routes UDP
    // perfectly and drops tunnelled audio is silent for exactly those clients -
    // and looks healthy in every aggregate counter.
    legacy.speak_tunnelled(b"tunnelled opus payload").await;
    match modern.listen() {
        Some(audio) => {
            assert_eq!(audio.opus_data, b"tunnelled opus payload");
            assert_eq!(audio.sender_session, legacy_session);
            println!("PROBE: *** tunnelled audio WAS relayed ***");
        }
        None => panic!("PROBE: *** tunnelled audio was NOT relayed - this is the bug ***"),
    }

    // Keep the connections alive until the end; dropping them mid-test would
    // make a routing failure indistinguishable from a disconnect.
    drop(legacy.transport);
    drop(modern.transport);
}
