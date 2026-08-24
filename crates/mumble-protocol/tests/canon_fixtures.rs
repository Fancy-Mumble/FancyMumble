//! The client half of the epoch-honesty check: we still write what Starling reads.
//!
//! `tests/canon-fixtures.json` is a mirror of `scripts/canon-fixtures.json` in
//! Starling, and Starling has the other half of this test - it decodes these
//! same bytes and asserts they mean what the fixture names. Together the pair
//! says the two codecs agree, which is the one thing the structural checks
//! cannot establish: they prove the `.proto` files are identical, the frozen
//! tags have not moved and the outer types match. None of that is evidence
//! about the encoders.
//!
//! # Why bytes rather than a shared helper
//!
//! Because a helper both sides imported would agree with itself while
//! disagreeing with the wire - which is not hypothetical, it is exactly D1 in
//! Starling's `docs/PROTOCOL-REDESIGN.md` §0, where both ends were confident
//! and wrong for months.
//!
//! # When this fails
//!
//! Either the canon changed and both fixtures are stale, or this end drifted.
//! Establish which before regenerating: a codec that can re-baseline its own
//! expectations is a codec with no test at all. Both copies move in one commit.

#![allow(
    unused_crate_dependencies,
    reason = "integration test: it links the whole crate's dependency set and uses a few"
)]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "concise failure reporting in tests"
)]

use mumble_protocol::message::ControlMessage;
use mumble_protocol::proto::mumble_tcp;
use mumble_protocol::transport::codec::encode;

/// The fixture, as `(name, hex)` pairs.
///
/// Scanned rather than parsed with a JSON crate: the file is ours, its shape is
/// fixed, and a dependency that exists only to read a test's own input is one
/// the shipped client would carry for nothing.
fn fixtures() -> Vec<(String, String)> {
    let text = include_str!("canon-fixtures.json");
    let mut out = Vec::new();
    let mut name = String::new();
    for line in text.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("\"name\":") {
            name = rest
                .trim()
                .trim_end_matches(',')
                .trim_matches('"')
                .to_owned();
        } else if let Some(rest) = line.strip_prefix("\"hex\":") {
            let hex = rest
                .trim()
                .trim_end_matches(',')
                .trim_matches('"')
                .to_owned();
            out.push((std::mem::take(&mut name), hex));
        }
    }
    assert!(!out.is_empty(), "the fixture file yielded nothing");
    out
}

fn hex_of(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn fixture(needle: &str) -> String {
    fixtures()
        .into_iter()
        .find(|(name, _)| name.contains(needle))
        .unwrap_or_else(|| panic!("no fixture matching {needle:?}"))
        .1
}

#[test]
fn a_typing_indicator_is_still_the_bytes_starling_reads() {
    let typing = ControlMessage::FancyTypingIndicator(mumble_tcp::FancyTypingIndicator {
        channel_id: Some(4),
        actor: None,
    });
    let framed = encode(&typing).expect("encodes");
    assert_eq!(
        hex_of(&framed),
        fixture("typing"),
        "the canon encoding changed; Starling's half of this test decodes the \
         recorded bytes, so one of the two ends has drifted"
    );
}

#[test]
fn a_reaction_is_still_the_bytes_starling_reads() {
    let reaction = ControlMessage::PchatReaction(mumble_tcp::PchatReaction {
        channel_id: Some(4),
        message_id: Some("m-1".into()),
        emoji: Some(mumble_tcp::pchat_reaction::Emoji::UnicodeEmoji(
            mumble_tcp::UnicodeEmoji {
                grapheme: Some("\u{1f44d}".into()),
            },
        )),
        action: Some(0),
        ..Default::default()
    });
    let framed = encode(&reaction).expect("encodes");
    assert_eq!(hex_of(&framed), fixture("reaction"));
}

#[test]
fn a_poll_is_still_the_bytes_starling_reads() {
    let poll = ControlMessage::FancyPoll(mumble_tcp::FancyPoll {
        poll_id: Some("p-1".into()),
        channel_id: Some(4),
        question: Some("lunch?".into()),
        options: vec!["yes".into(), "no".into()],
        multiple: Some(false),
        ..Default::default()
    });
    assert_eq!(hex_of(&encode(&poll).expect("encodes")), fixture("poll"));
}

#[test]
fn an_encrypted_message_is_still_the_bytes_starling_reads() {
    // The one frame where a byte out of place is unrecoverable: the ciphertext
    // is opaque to the server, so nothing between here and the recipient's
    // decryption can notice it was mangled.
    let message = ControlMessage::PchatMessage(mumble_tcp::PchatMessage {
        channel_id: Some(4),
        message_id: Some("m-7".into()),
        envelope: Some(vec![0xde, 0xad, 0xbe, 0xef]),
        timestamp: Some(1_700_000_000_000),
        epoch: Some(2),
        chain_index: Some(9),
        ..Default::default()
    });
    assert_eq!(
        hex_of(&encode(&message).expect("encodes")),
        fixture("encrypted message")
    );
}

#[test]
fn a_history_fetch_is_still_the_bytes_starling_reads() {
    let fetch = ControlMessage::PchatFetch(mumble_tcp::PchatFetch {
        channel_id: Some(4),
        limit: Some(50),
        ..Default::default()
    });
    assert_eq!(hex_of(&encode(&fetch).expect("encodes")), fixture("fetch"));
}

#[test]
fn our_copy_of_the_fixture_is_starlings_copy() {
    // Two copies of one file, checked into two trees, and until this test
    // nothing compared them - the same shape as the outer-type table that
    // `check-proto-hygiene.py` had to grow a check for.
    //
    // Without it the pair is only as strong as the weaker copy: editing this
    // side alone makes both halves pass while the two ends assert different
    // bytes, which is the agreement failing quietly rather than loudly.
    let sibling = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../../starling/scripts/canon-fixtures.json");
    let Ok(theirs) = std::fs::read_to_string(&sibling) else {
        // The client is vendored on its own often enough that a hard failure
        // here would be a check people delete rather than fix.
        eprintln!("skip: no sibling Starling tree at {}", sibling.display());
        return;
    };
    assert_eq!(
        theirs.replace("\r\n", "\n"),
        include_str!("canon-fixtures.json").replace("\r\n", "\n"),
        "the two copies of the fixture have diverged; both move in one commit"
    );
}

#[test]
fn a_key_announce_is_still_the_bytes_starling_reads() {
    // The identity proof, whole. A recipient refuses an announce whose Ed25519
    // self-signature does not verify over exactly these fields, so a
    // translation that quietly dropped `signing_public`, `signature` or
    // `announced_at_ms` would produce a frame that relays perfectly and fails
    // at the far end as a crypto error. That is what this pins.
    let announce = ControlMessage::PchatKeyAnnounce(mumble_tcp::PchatKeyAnnounce {
        algorithm_version: Some(1),
        identity_public: Some(vec![0x11; 32]),
        signing_public: Some(vec![0x22; 32]),
        cert_hash: Some("aabbccdd".into()),
        timestamp: Some(1_700_000_000_000),
        signature: Some(vec![0x33; 64]),
        tls_signature: Some(vec![0x44; 8]),
        channel_id: Some(4),
    });
    assert_eq!(
        hex_of(&encode(&announce).expect("encodes")),
        fixture("key announce")
    );
}

#[test]
fn a_key_delivery_is_still_the_bytes_starling_reads() {
    // `sender_cert` is the field this arm was unusable without: the recipient
    // resolves the sealer's key-agreement and signing keys from it, so a
    // delivery missing it cannot be opened however intact the ciphertext is.
    let exchange = ControlMessage::PchatKeyExchange(mumble_tcp::PchatKeyExchange {
        channel_id: Some(4),
        protocol: Some(2),
        epoch: Some(3),
        encrypted_key: Some(vec![0xde, 0xad, 0xbe, 0xef]),
        sender_hash: Some("aabbccdd".into()),
        recipient_hash: Some("11223344".into()),
        request_id: Some("r-1".into()),
        timestamp: Some(1_700_000_000_000),
        algorithm_version: Some(1),
        signature: Some(vec![0x55; 64]),
        parent_fingerprint: Some(vec![0x66; 8]),
        epoch_fingerprint: Some(vec![0x77; 8]),
        countersignature: Some(vec![0x88; 8]),
        countersigner_hash: Some("55667788".into()),
    });
    assert_eq!(
        hex_of(&encode(&exchange).expect("encodes")),
        fixture("key delivery")
    );
}

#[test]
fn a_certificate_hash_survives_the_round_trip_to_the_canon_and_back() {
    // The canon carries certificate hashes as bytes; this client keys its whole
    // ladder on the lowercase hex string, and the announce signature is
    // computed over *that string*. So hex -> bytes -> hex has to be exact:
    // a single case or padding difference verifies as a forged announce, which
    // reads as a crypto failure and is really a codec one.
    let cert = "aabbccdd00112233445566778899aabbccddeeff";
    let announce = ControlMessage::PchatKeyAnnounce(mumble_tcp::PchatKeyAnnounce {
        algorithm_version: Some(1),
        identity_public: Some(vec![0x11; 32]),
        signing_public: Some(vec![0x22; 32]),
        cert_hash: Some(cert.into()),
        timestamp: Some(7),
        signature: Some(vec![0x33; 64]),
        tls_signature: Some(vec![0x44; 8]),
        channel_id: Some(4),
    });
    let framed = encode(&announce).expect("encodes");
    let decoded = mumble_protocol::canon::from_canon(1006, &framed[6..])
        .expect("decodes")
        .expect("a key announce");
    let ControlMessage::PchatKeyAnnounce(back) = decoded else {
        panic!("expected a key announce");
    };
    assert_eq!(back.cert_hash.as_deref(), Some(cert));
    assert_eq!(back.signing_public, Some(vec![0x22; 32]));
    assert_eq!(back.signature, Some(vec![0x33; 64]));
    assert_eq!(back.timestamp, Some(7));
    assert_eq!(back.channel_id, Some(4));
}
