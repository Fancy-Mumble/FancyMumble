//! `XChaCha20-Poly1305` UDP encryption, for servers that offer it.
//!
//! The upgrade path away from OCB2-AES128. A stock Mumble server offers only
//! OCB2 and always will; a Fancy Mumble server at 0.4.0 or later offers this,
//! and the gate ([`crate::gate`]) decides which we get.
//!
//! # Why it is worth the fourteen extra bytes
//!
//! | | OCB2-AES128 | this |
//! |---|---|---|
//! | tag | 3 bytes | 16 bytes |
//! | forgery odds per attempt | 2^-24 | 2^-128 |
//! | wire overhead | 4 bytes | 18 bytes |
//!
//! OCB2's three-byte tag is one accepted forgery per 2^24 attempts. At the 50
//! packets a second a voice stream already sends, an attacker gets there in
//! about four days. OCB2 also needed a mitigation for a 2019 break of the mode
//! itself, which changes one bit of the plaintext on silent frames.
//!
//! # The construction, which must match the server byte for byte
//!
//! ```text
//! directional = HKDF-SHA256(salt = salt, ikm = master, info = label)
//! nonce       = salt ‖ counter as 8 bytes big-endian        (24 bytes)
//! packet      = counter as 2 bytes big-endian ‖ XChaCha20-Poly1305(nonce, frame)
//! ```
//!
//! with `label` being `starling-voice-v1 c2s` for what the client sends and
//! `starling-voice-v1 s2c` for what it receives.
//!
//! The server derives the same keys and then hoists `HChaCha20` out of its
//! per-packet path, which is an optimisation and not a different construction —
//! its own test proves the two produce identical bytes. This uses the stock
//! `XChaCha20Poly1305` because there is no per-packet budget here worth the
//! extra machinery.
//!
//! # Two implementations of one wire format
//!
//! This crate and the server's `starling-crypto` are in separate repositories,
//! so this is a second implementation rather than a shared one. That is a real
//! risk, and `KNOWN_VECTOR` below is the mitigation: the same constants and the
//! same expected ciphertext are pinned in both, so a change to either that would
//! break interoperability fails a test instead of a call.

use chacha20poly1305::aead::{Aead, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use hkdf::Hkdf;
use sha2::Sha256;
use zeroize::Zeroize;

use crate::error::{Error, Result};
use crate::transport::udp::CryptState;

/// Length of the master secret `CryptSetup` carries for this cipher.
///
/// Twice OCB2's key, which is how a client can sanity-check that the server
/// gave it material for the cipher it thinks it negotiated.
pub const MASTER_KEY_LEN: usize = 32;

/// Length of each per-direction salt.
pub const SALT_LEN: usize = 16;

/// The Poly1305 tag.
pub const TAG_LEN: usize = 16;

/// Counter bytes placed on the wire.
///
/// Two. The rest is reconstructed from the receiver's own count, which tolerates
/// a gap of just under 32 768 packets — around eleven minutes of continuous loss
/// at 50 packets a second.
pub const WIRE_COUNTER_BYTES: usize = 2;

/// Bytes a packet grows by.
pub const OVERHEAD: usize = WIRE_COUNTER_BYTES + TAG_LEN;

/// How far back a late packet may be and still be checked for replay.
const REPLAY_WINDOW: u64 = 64;

/// HKDF label for packets the client sends.
const LABEL_C2S: &[u8] = b"starling-voice-v1 c2s";

/// HKDF label for packets the client receives.
const LABEL_S2C: &[u8] = b"starling-voice-v1 s2c";

/// One direction of an encrypted voice stream.
///
/// Private: a caller holding one of these could seal and open with the same
/// keystream, which is exactly the mistake [`ModernCryptState`] exists to make
/// unrepresentable.
struct Stream {
    cipher: XChaCha20Poly1305,
    salt: [u8; SALT_LEN],
    /// Next counter to issue, for the sending half.
    next: u64,
    /// Highest counter accepted, for the receiving half.
    highest: u64,
    /// Bit `n` is set when `highest - 1 - n` has been seen.
    seen: u64,
    /// Whether anything has been accepted yet.
    started: bool,
}

impl Stream {
    /// Derive one direction's key.
    fn derive(master: &[u8; MASTER_KEY_LEN], salt: &[u8; SALT_LEN], label: &[u8]) -> Self {
        let mut directional = [0_u8; MASTER_KEY_LEN];
        // Infallible for a 32-byte output; HKDF only fails past 255 hash lengths.
        Hkdf::<Sha256>::new(Some(salt), master)
            .expand(label, &mut directional)
            .unwrap_or_else(|_| unreachable!("32 bytes is within HKDF's output limit"));

        let cipher = XChaCha20Poly1305::new(Key::from_slice(&directional));
        directional.zeroize();

        Self {
            cipher,
            salt: *salt,
            next: 0,
            highest: 0,
            seen: 0,
            started: false,
        }
    }

    /// The full 24-byte nonce for a counter.
    fn nonce(&self, counter: u64) -> XNonce {
        let mut bytes = [0_u8; SALT_LEN + 8];
        bytes[..SALT_LEN].copy_from_slice(&self.salt);
        bytes[SALT_LEN..].copy_from_slice(&counter.to_be_bytes());
        XNonce::from(bytes)
    }

    /// Encrypt one frame.
    fn seal(&mut self, frame: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        let counter = self.next;
        self.next = self
            .next
            .checked_add(1)
            .ok_or_else(|| Error::InvalidState("voice counter exhausted".into()))?;

        let ciphertext = self
            .cipher
            .encrypt(&self.nonce(counter), Payload { msg: frame, aad })
            .map_err(|_| Error::InvalidState("voice encryption failed".into()))?;

        let truncated = u16::try_from(counter & 0xFFFF).unwrap_or(0);
        let mut packet = Vec::with_capacity(OVERHEAD + frame.len());
        packet.extend_from_slice(&truncated.to_be_bytes());
        packet.extend_from_slice(&ciphertext);
        Ok(packet)
    }

    /// Decrypt one packet.
    ///
    /// The replay window is consulted against a *copy* and only committed once
    /// the tag verifies, so a forged packet cannot advance it — the bug that
    /// would let one attacker silence a stream with a single datagram.
    fn open(&mut self, packet: &[u8], aad: &[u8]) -> Result<Vec<u8>> {
        if packet.len() < OVERHEAD {
            return Err(Error::InvalidState(format!(
                "voice packet is {} bytes; at least {OVERHEAD} are needed",
                packet.len()
            )));
        }
        let (header, body) = packet.split_at(WIRE_COUNTER_BYTES);
        let truncated = u16::from_be_bytes([header[0], header[1]]);

        let counter = self.reconstruct(truncated);
        self.check_replay(counter)?;

        let plain = self
            .cipher
            .decrypt(&self.nonce(counter), Payload { msg: body, aad })
            .map_err(|_| Error::InvalidState("voice packet failed authentication".into()))?;

        self.record(counter);
        Ok(plain)
    }

    /// The full counter a truncated value most likely means.
    ///
    /// Picks the candidate nearest the highest seen, so a wire value that
    /// wrapped past `0xFFFF` resolves to the next window up rather than to a
    /// counter far in the past.
    fn reconstruct(&self, truncated: u16) -> u64 {
        const WINDOW: u64 = 1 << (WIRE_COUNTER_BYTES * 8);
        const HALF: u64 = WINDOW / 2;

        if !self.started {
            return u64::from(truncated);
        }

        let base = self.highest & !(WINDOW - 1);
        let candidate = base | u64::from(truncated);

        if candidate > self.highest && candidate - self.highest > HALF {
            // The value is behind us, in the previous window.
            candidate.saturating_sub(WINDOW)
        } else if candidate < self.highest && self.highest - candidate > HALF {
            // The value is ahead of us, in the next window.
            candidate.saturating_add(WINDOW)
        } else {
            candidate
        }
    }

    /// Whether `counter` may be accepted, without recording it.
    fn check_replay(&self, counter: u64) -> Result<()> {
        if !self.started || counter > self.highest {
            return Ok(());
        }
        if counter == self.highest {
            return Err(Error::InvalidState("voice packet is a replay".into()));
        }
        let age = self.highest - counter;
        if age > REPLAY_WINDOW {
            return Err(Error::InvalidState(
                "voice packet is too old to verify".into(),
            ));
        }
        if self.seen & (1_u64 << (age - 1)) != 0 {
            return Err(Error::InvalidState("voice packet is a replay".into()));
        }
        Ok(())
    }

    /// Record an authenticated counter.
    fn record(&mut self, counter: u64) {
        if !self.started {
            self.started = true;
            self.highest = counter;
            return;
        }
        if counter > self.highest {
            let advance = counter - self.highest;
            self.seen = if advance >= REPLAY_WINDOW {
                0
            } else {
                (self.seen << advance) | (1_u64 << (advance - 1))
            };
            self.highest = counter;
        } else {
            let age = self.highest - counter;
            if age <= REPLAY_WINDOW && age > 0 {
                self.seen |= 1_u64 << (age - 1);
            }
        }
    }
}

/// The client's `XChaCha20-Poly1305` voice state, both directions.
///
/// Two streams, never one. A single stream sealing and opening would use one
/// keystream for both halves of a two-party conversation, and the failure is
/// silent — everything round-trips against itself and nothing against the
/// server.
pub struct ModernCryptState {
    sending: Stream,
    receiving: Stream,
}

impl ModernCryptState {
    /// Build from the material `CryptSetup` carried.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidState`] if any field is the wrong length. Lengths are
    /// checked here rather than at the cipher, so a server offering OCB2-shaped
    /// material cannot reach key scheduling with it.
    pub fn new(key: &[u8], client_salt: &[u8], server_salt: &[u8]) -> Result<Self> {
        let master = exact::<MASTER_KEY_LEN>(key, "key")?;
        let client = exact::<SALT_LEN>(client_salt, "client_nonce")?;
        let server = exact::<SALT_LEN>(server_salt, "server_nonce")?;

        Ok(Self {
            // The client sends c2s and receives s2c. The server's mirror of this
            // is the other way round; getting either backwards produces a
            // handshake that looks perfect and a session in which no packet
            // ever authenticates.
            sending: Stream::derive(&master, &client, LABEL_C2S),
            receiving: Stream::derive(&master, &server, LABEL_S2C),
        })
    }

    /// Whether `key` is the right length for this cipher.
    ///
    /// A cross-check on the gate: both ends compute the same capability from the
    /// same announced version, and this catches the case where they disagree —
    /// which would otherwise show up as every packet failing its tag.
    #[must_use]
    pub fn accepts_key(key: &[u8]) -> bool {
        key.len() == MASTER_KEY_LEN
    }
}

impl CryptState for ModernCryptState {
    fn is_initialized(&self) -> bool {
        // Always: this type cannot be constructed without key material, unlike
        // `Ocb2CryptState`, which is built empty and keyed later.
        true
    }

    fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        self.sending.seal(plaintext, &[])
    }

    fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        self.receiving.open(ciphertext, &[])
    }
}

impl std::fmt::Debug for ModernCryptState {
    /// Prints no key material.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ModernCryptState")
            .field("sent", &self.sending.next)
            .field("highest_received", &self.receiving.highest)
            .finish_non_exhaustive()
    }
}

/// Read exactly `N` bytes, or say which field was wrong.
fn exact<const N: usize>(bytes: &[u8], field: &str) -> Result<[u8; N]> {
    <[u8; N]>::try_from(bytes).map_err(|_| {
        Error::InvalidState(format!(
            "{field} is {} bytes; {N} are required for XChaCha20-Poly1305",
            bytes.len()
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const MASTER: [u8; MASTER_KEY_LEN] = [0x11; MASTER_KEY_LEN];
    const CLIENT_SALT: [u8; SALT_LEN] = [0x22; SALT_LEN];
    const SERVER_SALT: [u8; SALT_LEN] = [0x33; SALT_LEN];

    fn client() -> ModernCryptState {
        ModernCryptState::new(&MASTER, &CLIENT_SALT, &SERVER_SALT).expect("well-formed")
    }

    /// The server's half, so a test can play both ends.
    ///
    /// The exact mirror of `ModernCryptState::new`: what one side sends under is
    /// what the other expects.
    fn server() -> ModernCryptState {
        ModernCryptState {
            sending: Stream::derive(&MASTER, &SERVER_SALT, LABEL_S2C),
            receiving: Stream::derive(&MASTER, &CLIENT_SALT, LABEL_C2S),
        }
    }

    /// The interoperability anchor.
    ///
    /// These bytes are what a server implementing the same construction produces
    /// for counter 0 of the c2s direction under the constants above. The same
    /// vector is pinned in `starling-crypto`. If either implementation changes in
    /// a way that would break the other, one of the two tests fails — which is
    /// the only protection two implementations of one wire format can have.
    #[test]
    fn the_known_vector_still_holds() {
        let mut state = client();
        let packet = state.encrypt(b"opus frame bytes").expect("sealed");

        assert_eq!(packet.len(), OVERHEAD + 16, "the wire layout changed shape");
        assert_eq!(
            &packet[..2],
            &[0x00, 0x00],
            "counter 0 must lead the packet"
        );

        // The full ciphertext, hex, so a diff shows exactly what moved.
        let hex: String = packet.iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(
            hex, KNOWN_VECTOR,
            "the wire bytes changed; the server will not understand this build"
        );
    }

    /// Counter 0, c2s, master `0x11`×32, client salt `0x22`×16, frame
    /// `b"opus frame bytes"`, no associated data.
    ///
    /// Confirmed against `starling-crypto`'s independent implementation, which
    /// derives the same keys and then hoists `HChaCha20` out of its per-packet
    /// path — different code, identical bytes.
    const KNOWN_VECTOR: &str =
        "0000e67fe8959303117e9c1b5efcc120278f6013774c9545d68cbcd545bfaff3793a";

    /// A packet the *server* produced, which this client must be able to open.
    ///
    /// The other half of the anchor. `KNOWN_VECTOR` proves what this client
    /// sends is what the server expects; this proves what the server sends is
    /// what this client can read. A sending-only vector passes even when the
    /// receiving direction is keyed wrongly, because nothing in this crate would
    /// ever try to open it.
    ///
    /// Counter 0, `s2c`, master `0x11`x32, server salt `0x33`x16, frame
    /// `b"server to client"`. Produced by `starling-crypto`, which pins the same
    /// constant.
    const SERVER_VECTOR: &str =
        "0000fc76c7db29e4b5854fc9a6801d1531d84dafd1d79a1c8f8b999fcc399d680b52";

    /// Decode a hex string into bytes.
    fn unhex(hex: &str) -> Vec<u8> {
        (0..hex.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).expect("valid hex"))
            .collect()
    }

    #[test]
    fn a_real_server_packet_opens() {
        let mut state = client();
        let opened = state
            .decrypt(&unhex(SERVER_VECTOR))
            .expect("a genuine server packet did not open; the receiving key is wrong");
        assert_eq!(opened, b"server to client");
    }

    #[test]
    fn a_frame_survives_the_round_trip() {
        let (mut client, mut server) = (client(), server());
        let packet = client.encrypt(b"hello from the client").expect("sealed");
        assert_eq!(
            server
                .decrypt(&packet)
                .expect("the server could not open it"),
            b"hello from the client"
        );
    }

    #[test]
    fn the_server_can_be_heard_too() {
        // The other direction, on an entirely different subkey. A test of one
        // direction alone passes even when the roles are swapped.
        let (mut client, mut server) = (client(), server());
        let packet = server.encrypt(b"hello from the server").expect("sealed");
        assert_eq!(
            client
                .decrypt(&packet)
                .expect("the client could not open it"),
            b"hello from the server"
        );
    }

    #[test]
    fn a_peer_cannot_open_its_own_packets() {
        // What makes two streams worth having: even holding the master key, the
        // sending keystream cannot read itself.
        let mut client = client();
        let packet = client.encrypt(b"outbound").expect("sealed");
        assert!(
            client.decrypt(&packet).is_err(),
            "the client opened its own packet, so both directions share a key"
        );
    }

    #[test]
    fn every_frame_length_survives() {
        let (mut client, mut server) = (client(), server());
        for len in 0..128 {
            let frame: Vec<u8> = (0..len).map(|i| u8::try_from(i + 1).unwrap_or(1)).collect();
            let packet = client.encrypt(&frame).expect("sealed");
            assert_eq!(server.decrypt(&packet).expect("opened"), frame, "len {len}");
        }
    }

    #[test]
    fn a_reordered_packet_still_opens() {
        // UDP reorders. Refusing a late packet the jitter buffer still wants
        // makes a client sound worse than it needs to.
        let (mut client, mut server) = (client(), server());
        let first = client.encrypt(b"one").expect("sealed");
        let second = client.encrypt(b"two").expect("sealed");

        assert_eq!(server.decrypt(&second).expect("opened"), b"two");
        assert_eq!(
            server.decrypt(&first).expect("the late packet was refused"),
            b"one"
        );
    }

    #[test]
    fn a_replay_is_refused() {
        let (mut client, mut server) = (client(), server());
        let packet = client.encrypt(b"once").expect("sealed");
        assert!(server.decrypt(&packet).is_ok());
        assert!(server.decrypt(&packet).is_err(), "a replay was accepted");
    }

    #[test]
    fn a_forged_packet_does_not_advance_the_window() {
        // The attack: send a forgery with a plausible counter and drag the
        // peer's window past the real packets.
        let (mut client, mut server) = (client(), server());
        let good = client.encrypt(b"genuine").expect("sealed");

        let mut forged = good.clone();
        let last = forged.len() - 1;
        forged[last] ^= 0xFF;
        assert!(server.decrypt(&forged).is_err());

        assert_eq!(
            server.decrypt(&good).expect("the real packet was lost"),
            b"genuine"
        );
    }

    #[test]
    fn every_flipped_bit_is_detected() {
        let (mut client, mut server) = (client(), server());
        let packet = client.encrypt(b"a frame of audio").expect("sealed");

        for byte in 0..packet.len() {
            let mut tampered = packet.clone();
            tampered[byte] ^= 0x01;
            assert!(
                server.decrypt(&tampered).is_err(),
                "a flipped bit at offset {byte} was accepted"
            );
        }
    }

    #[test]
    fn a_short_packet_is_refused() {
        let mut server = server();
        for len in 0..OVERHEAD {
            assert!(server.decrypt(&vec![0; len]).is_err(), "len {len}");
        }
    }

    #[test]
    fn a_long_run_stays_in_step_across_the_counter_wrap() {
        // Only two counter bytes reach the wire. Past 65 536 packets — about 22
        // minutes of talking — a broken reconstruction goes silent, and nothing
        // before that would have shown it.
        let (mut client, mut server) = (client(), server());
        for i in 0..70_000_u32 {
            let packet = client.encrypt(&i.to_be_bytes()).expect("sealed");
            assert_eq!(
                server.decrypt(&packet).expect("opened"),
                i.to_be_bytes(),
                "packet {i}"
            );
        }
    }

    #[test]
    fn ocb2_sized_material_is_refused() {
        // What a stock Mumble server sends. Accepting it would key this cipher
        // with half the entropy it needs and fail on the first packet instead
        // of at setup, where the message is useful.
        assert!(ModernCryptState::new(&[0; 16], &[0; 16], &[0; 16]).is_err());
        assert!(!ModernCryptState::accepts_key(&[0; 16]));
        assert!(ModernCryptState::accepts_key(&[0; 32]));
    }

    #[test]
    fn a_wrong_length_salt_is_refused() {
        assert!(ModernCryptState::new(&MASTER, &[0; 8], &SERVER_SALT).is_err());
        assert!(ModernCryptState::new(&MASTER, &CLIENT_SALT, &[0; 24]).is_err());
    }

    #[test]
    fn the_overhead_is_eighteen_bytes() {
        let mut client = client();
        assert_eq!(
            client.encrypt(b"payload").expect("sealed").len(),
            7 + OVERHEAD
        );
    }

    #[test]
    fn it_prints_no_key_material() {
        let printed = format!("{:?}", client());
        assert!(!printed.contains("17"), "{printed}");
        assert!(!printed.contains("11"), "{printed}");
    }
}
