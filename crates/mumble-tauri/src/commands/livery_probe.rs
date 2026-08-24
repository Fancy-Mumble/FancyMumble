//! Ask a server what it looks like without joining it.
//!
//! A livery is presentation, and the whole point of presentation is that it is
//! read *before* the decision it informs. Starling says so in as many words -
//! "livery is presentation an operator supplies and a client renders before it
//! has authenticated anything" (`starling_runtime::livery`) - and its
//! `ServerConfigService` answers a `LiveryQuery` without consulting
//! `permissions`, unlike the `LiveryUpdate` next to it, which requires `Write`
//! on the root channel. So the document is available to anyone who can open the
//! control connection, exactly like the user count is available to anyone who
//! can send a UDP ping.
//!
//! This does that and nothing else: connect, announce a version, ask, take the
//! first answer, hang up. No `Authenticate` is ever sent, so no session is
//! created, nothing is registered, and the server sees a connection that asked
//! one question and left.
//!
//! # Why the ping still comes first
//!
//! The ping carries an eight-byte digest of the document. It is one UDP
//! round-trip against this probe's TLS handshake, and it answers the two
//! questions that make a probe unnecessary: a server with no livery says so
//! with an empty digest, and a server that is not Fancy at all says nothing -
//! and would leave this waiting for a reply to a message type it silently
//! ignored. A caller that has a digest and a cached document matching it needs
//! neither. See `resolveLivery` on the frontend, which owns that decision.

use std::collections::HashMap;
use std::time::Duration;

use mumble_protocol::client::{version_announcement, MumbleVersion};
use mumble_protocol::message::ControlMessage;
use mumble_protocol::proto::fancy;
use mumble_protocol::transport::tcp::{TcpConfig, TcpTransport};

use crate::state::{data_uri, to_snapshot, LiverySnapshot};

/// The whole exchange, TLS handshake included.
///
/// Generous enough for a distant server on a slow link, short enough that a
/// connect screen does not sit on a spinner: the ping beside it has already
/// established that the server is up and has a livery to send.
const PROBE_TIMEOUT: Duration = Duration::from_secs(6);

/// How many frames to read before giving up on finding the answer.
///
/// A server is free to send other things first - a `Version`, a `Reject`, a
/// `CryptSetup` - and a bounded scan is the difference between "the reply is
/// not the first frame" and an unbounded read against a peer that talks
/// forever.
const MAX_FRAMES: usize = 32;

/// What a server says it looks like, asked without joining it.
///
/// `Ok(None)` is a server that answered the connection but not the question:
/// it accepted the frame and sent something else, which is what a non-Fancy
/// server does with a message type it does not know. `Err` is a failure to ask
/// at all - unreachable, TLS refused, or out of time.
#[tauri::command]
pub(crate) async fn probe_livery(
    host: String,
    port: u16,
    have_keys: Option<Vec<String>>,
) -> Result<Option<LiverySnapshot>, String> {
    tokio::time::timeout(PROBE_TIMEOUT, ask(host, port, have_keys.unwrap_or_default()))
        .await
        .map_err(|_| "the server did not answer in time".to_owned())?
}

async fn ask(
    host: String,
    port: u16,
    have_keys: Vec<String>,
) -> Result<Option<LiverySnapshot>, String> {
    let config = TcpConfig {
        server_host: host,
        server_port: port,
        // No client certificate. A probe is deliberately anonymous: presenting
        // the user's identity to every server on the connect screen would tell
        // each of them who is browsing, which is more than the user asked.
        ..Default::default()
    };

    let mut tcp = TcpTransport::connect(&config)
        .await
        .map_err(|error| format!("could not reach the server: {error}"))?;

    // Version first, before anything else touches the stream - the same order
    // the real connection uses, and what lets the server decide which dialect
    // the frame after this is in.
    tcp.send(&ControlMessage::Version(version_announcement(
        MumbleVersion::default(),
    )))
    .await
    .map_err(|error| format!("could not greet the server: {error}"))?;

    tcp.send(&ControlMessage::FancyLiveryQuery(
        fancy::domain::LiveryQuery { have_keys },
    ))
    .await
    .map_err(|error| format!("could not ask for the livery: {error}"))?;

    for _ in 0..MAX_FRAMES {
        match tcp.recv().await {
            Ok(ControlMessage::FancyServerLivery(doc)) => return Ok(Some(snapshot(&doc))),
            // Anything else on the way to the answer is not this probe's
            // business. It asked one question.
            Ok(_) => continue,
            // A server that hangs up mid-scan has answered as much as it is
            // going to. Not an error the user needs a sentence about: the
            // caller's digest already said whether to expect a document.
            Err(_) => return Ok(None),
        }
    }
    Ok(None)
}

/// The document, with the artwork it arrived with folded in.
///
/// A probe holds no cache of its own, so whatever the server chose to send in
/// answer to `have_keys` is all the art there is. Keys named by the document
/// but absent from the reply simply resolve to nothing, which is the same thing
/// `to_snapshot` does on the connected path for art it has not been given.
fn snapshot(doc: &fancy::domain::LiveryDoc) -> LiverySnapshot {
    let art: HashMap<&str, String> = doc
        .art
        .iter()
        .filter(|art| !art.key.is_empty() && !art.bytes.is_empty())
        .map(|art| (art.key.as_str(), data_uri(&art.content_type, &art.bytes)))
        .collect();
    to_snapshot(doc, |key| art.get(key).cloned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artwork_the_server_sent_becomes_a_data_uri_and_never_a_url_it_chose() {
        let doc = fancy::domain::LiveryDoc {
            version: 3,
            digest: vec![0xab, 0xcd],
            banner_key: "bk".to_owned(),
            art: vec![fancy::domain::livery_doc::Art {
                key: "bk".to_owned(),
                content_type: "image/png".to_owned(),
                bytes: vec![1, 2, 3],
            }],
            ..Default::default()
        };
        let banner = snapshot(&doc).banner_src.expect("a banner");
        assert!(banner.starts_with("data:image/png;base64,"));
        assert!(!banner.contains("http"));
    }

    #[test]
    fn a_key_the_server_did_not_send_art_for_resolves_to_nothing() {
        // The `have_keys` case: the server leaves out art the caller said it
        // holds. A probe that asked for everything and still got none of it
        // must render unbranded rather than half-drawn.
        let doc = fancy::domain::LiveryDoc {
            version: 3,
            digest: vec![0xab],
            banner_key: "bk".to_owned(),
            ..Default::default()
        };
        assert!(snapshot(&doc).banner_src.is_none());
    }

    /// Drive the real probe against a running server.
    ///
    /// Ignored by default because it needs one. `LIVERY_PROBE_ADDR=host:port
    /// cargo test -p mumble-tauri -- --ignored probe_against` runs it. This is
    /// the assertion the whole module rests on: that a server answers the
    /// question on a connection that never authenticated.
    #[tokio::test]
    #[ignore = "needs a live server; set LIVERY_PROBE_ADDR"]
    async fn probe_against_a_live_server_without_joining_it() {
        let Ok(addr) = std::env::var("LIVERY_PROBE_ADDR") else {
            panic!("set LIVERY_PROBE_ADDR=host:port");
        };
        // `lib.rs` does this at startup; a test binary is its own process.
        let _ = rustls::crypto::ring::default_provider().install_default();
        let (host, port) = addr.rsplit_once(':').expect("host:port");
        let answer = probe_livery(host.to_owned(), port.parse().expect("a port"), None)
            .await
            .expect("the probe ran");
        println!("{answer:#?}");
        let doc = answer.expect("a document from an unauthenticated query");
        assert!(!doc.digest.is_empty(), "a document always carries its digest");
    }

    #[test]
    fn the_digest_survives_so_a_cached_copy_can_be_checked_against_a_ping() {
        let doc = fancy::domain::LiveryDoc {
            version: 3,
            digest: vec![0xde, 0xad, 0xbe, 0xef],
            ..Default::default()
        };
        assert_eq!(snapshot(&doc).digest, "deadbeef");
    }
}
