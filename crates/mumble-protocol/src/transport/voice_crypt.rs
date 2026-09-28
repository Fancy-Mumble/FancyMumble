//! Which voice cipher this connection got.
//!
//! The client mirror of the server's `ProfileFactory`: one place that maps what
//! the server announced onto the cipher this connection uses, so nothing on the
//! packet path re-derives it from a version number.
//!
//! # Who decides, and how this end finds out
//!
//! The server decides. It generates every byte of key material - the key and
//! both nonces - from the Fancy version *this client* announced, and sends the
//! result in `CryptSetup`. There is no round trip and nothing to agree on.
//!
//! So this end does not re-derive the decision from the server's version. It
//! reads the decision it was handed, from the shape of the material: OCB2 takes
//! a 16-byte AES key, `XChaCha20-Poly1305` a 32-byte master secret. The material
//! *is* the announcement, which is why there is no cipher identifier on the
//! wire - an identifier would be a second source of truth about a decision
//! already made, and could disagree with the bytes beside it.
//!
//! ## Why not the server's announced version
//!
//! It was that, and it was wrong twice over.
//!
//! It reads a decision off a proxy while the decision itself is in hand. And the
//! proxy is not even faithful: a server legitimately downgrades a client to OCB2
//! when the client's *Mumble* version forces legacy audio framing, because the
//! legacy packet type is the codec and has nowhere to name a cipher. A modern
//! Fancy server serving a 1.4 client therefore announces a version that says
//! "modern" and sends material that says "OCB2" - and version-based selection
//! refuses a session that is perfectly correct.
//!
//! The gate is still consulted, as corroboration rather than as the decision:
//! see [`VoiceCrypt::negotiate`].
//!
//! ## What this does not open up
//!
//! A downgrade needs the attacker to *be* the server: `CryptSetup` arrives
//! inside TLS, so nothing between the two ends can change a key's length. A
//! stock Mumble server sends sixteen bytes and gets OCB2, which is the only
//! thing it can do.
//!
//! # Why an enum and not a boxed trait
//!
//! `UdpSender` and the reader loop hold this by value across an `await`, and the
//! set of ciphers is closed and small. An enum keeps both monomorphic and adds
//! one predictable branch per packet; a `Box<dyn CryptState>` would add a
//! pointer chase to the same place for no benefit.

use fancy_utils::gate::{Capability, Gate};
use tracing::info;

use crate::error::Result;
use crate::transport::modern_crypt::ModernCryptState;
use crate::transport::ocb2::{Ocb2CryptState, PacketStats};
use crate::transport::udp::CryptState;

/// The voice cipher in use on one connection.
#[derive(Debug)]
pub enum VoiceCrypt {
    /// OCB2-AES128 - every stock Mumble server, and every Fancy server before
    /// 0.4.0.
    ///
    /// Boxed: it carries a 256-entry replay history, and an unboxed variant
    /// would size the whole enum for it whichever cipher is actually live.
    Ocb2(Box<Ocb2CryptState>),

    /// `XChaCha20-Poly1305` - a Fancy server at 0.4.0 or later.
    Modern(ModernCryptState),
}

impl VoiceCrypt {
    /// Build the cipher the server's key material calls for.
    ///
    /// `gate` is what the *server* announced. It does not decide anything here -
    /// the material does - but a server that announced the modern cipher and
    /// then sent OCB2-shaped material is worth a line in the log, because the
    /// two legitimate reasons for it (a legacy-framed client, or a server bug)
    /// look identical from here and only one is fine.
    ///
    /// # Errors
    ///
    /// [`Error::InvalidState`] if the material is not a valid length for either
    /// cipher. Refusing at setup is the point: keying anything on a bad length
    /// produces a session in which every packet silently fails its tag, which
    /// looks like a network fault and is close to undiagnosable.
    pub fn negotiate(
        gate: &Gate,
        key: &[u8],
        client_nonce: &[u8],
        server_nonce: &[u8],
    ) -> Result<Self> {
        if ModernCryptState::accepts_key(key) {
            return ModernCryptState::new(key, client_nonce, server_nonce).map(Self::Modern);
        }

        if gate.allows(Capability::ModernVoiceCrypto) {
            // Legitimate when this client's Mumble version forced legacy audio
            // framing, which has nowhere to name a cipher. Not legitimate
            // otherwise, and indistinguishable from here - so it is recorded
            // rather than judged.
            info!(
                key_len = key.len(),
                "server offers modern voice crypto but keyed OCB2 for this connection"
            );
        }

        let mut state = Ocb2CryptState::new();
        state.set_key(key, client_nonce, server_nonce)?;
        Ok(Self::Ocb2(Box::new(state)))
    }

    /// A short name for logs.
    #[must_use]
    pub const fn name(&self) -> &'static str {
        match self {
            Self::Ocb2(_) => "OCB2-AES128",
            Self::Modern(_) => "XChaCha20-Poly1305",
        }
    }

    /// Adopt a server nonce sent in a partial `CryptSetup` resync.
    ///
    /// Only OCB2 has anywhere to put one. Its nonce is a full 128-bit counter of
    /// which one byte reaches the wire, so a receiver that falls too far behind
    /// cannot catch up on its own and the server has to tell it where it is.
    ///
    /// `XChaCha20-Poly1305` reconstructs its counter from the two bytes every
    /// packet carries, over a window of ~32 768 packets. Nothing to resync, so
    /// this is a no-op rather than an error - the server may still send one, and
    /// refusing it would turn a harmless message into a disconnect.
    pub fn adopt_resync(&mut self, server_nonce: &[u8]) {
        match self {
            Self::Ocb2(state) => state.set_decrypt_iv(server_nonce),
            Self::Modern(_) => {}
        }
    }

    /// Decrypt counters, for the `Ping` message the client sends the server.
    ///
    /// The modern cipher does not keep them yet, and reports zeros rather than
    /// inventing numbers: an operator reading a dashboard needs "not measured"
    /// to look different from "nothing went wrong". Both are plausible values,
    /// which is exactly why they must not be confused, so this is recorded here
    /// rather than left to the reader of a graph.
    #[must_use]
    pub fn stats(&self) -> PacketStats {
        match self {
            Self::Ocb2(state) => state.stats.clone(),
            Self::Modern(_) => PacketStats::default(),
        }
    }

    /// Whether this cipher can use a resync at all.
    ///
    /// The reader asks before sending a resync *request*: asking for something
    /// that cannot help would be a message per second at exactly the moment the
    /// connection is already struggling.
    #[must_use]
    pub const fn resync_helps(&self) -> bool {
        matches!(self, Self::Ocb2(_))
    }
}

impl CryptState for VoiceCrypt {
    fn is_initialized(&self) -> bool {
        match self {
            Self::Ocb2(state) => state.is_initialized(),
            Self::Modern(state) => state.is_initialized(),
        }
    }

    fn encrypt(&mut self, plaintext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Ocb2(state) => state.encrypt(plaintext),
            Self::Modern(state) => state.encrypt(plaintext),
        }
    }

    fn decrypt(&mut self, ciphertext: &[u8]) -> Result<Vec<u8>> {
        match self {
            Self::Ocb2(state) => state.decrypt(ciphertext),
            Self::Modern(state) => state.decrypt(ciphertext),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use fancy_utils::version::fancy_version_encode;

    /// A gate for a server announcing `major.minor.patch`.
    fn server(major: u16, minor: u16, patch: u16) -> Gate {
        Gate::for_peer(Some(fancy_version_encode(major, minor, patch)))
    }

    const OCB2_KEY: [u8; 16] = [0x11; 16];
    const MODERN_KEY: [u8; 32] = [0x11; 32];
    const NONCE: [u8; 16] = [0x22; 16];

    #[test]
    fn a_stock_server_gets_ocb2() {
        // No Fancy version at all - the overwhelming majority of servers,
        // forever. Anything else here is a client that cannot decrypt a packet.
        let crypt =
            VoiceCrypt::negotiate(&Gate::stock(), &OCB2_KEY, &NONCE, &NONCE).expect("stock keying");
        assert!(matches!(crypt, VoiceCrypt::Ocb2(_)));
        assert_eq!(crypt.name(), "OCB2-AES128");
    }

    #[test]
    fn an_old_fancy_server_gets_ocb2() {
        // Fancy, but from before the modern cipher existed. The gate's whole job.
        let crypt =
            VoiceCrypt::negotiate(&server(0, 3, 9), &OCB2_KEY, &NONCE, &NONCE).expect("keying");
        assert!(matches!(crypt, VoiceCrypt::Ocb2(_)));
    }

    #[test]
    fn a_modern_fancy_server_gets_xchacha() {
        // The upgrade path, and the reason this module exists.
        let crypt =
            VoiceCrypt::negotiate(&server(0, 4, 0), &MODERN_KEY, &NONCE, &NONCE).expect("keying");
        assert!(
            matches!(crypt, VoiceCrypt::Modern(_)),
            "a 0.4.0 server was downgraded to OCB2"
        );
        assert_eq!(crypt.name(), "XChaCha20-Poly1305");
    }

    #[test]
    fn a_newer_fancy_server_still_gets_xchacha() {
        // `since` is a floor, not an equality test.
        let crypt =
            VoiceCrypt::negotiate(&server(1, 2, 3), &MODERN_KEY, &NONCE, &NONCE).expect("keying");
        assert!(matches!(crypt, VoiceCrypt::Modern(_)));
    }

    #[test]
    fn the_boundary_version_is_included() {
        // Exactly 0.4.0 must be modern and 0.3.999 must not. An off-by-one here
        // splits the fleet in half with no symptom until someone talks.
        assert!(matches!(
            VoiceCrypt::negotiate(&server(0, 4, 0), &MODERN_KEY, &NONCE, &NONCE),
            Ok(VoiceCrypt::Modern(_))
        ));
        assert!(matches!(
            VoiceCrypt::negotiate(&server(0, 3, 999), &OCB2_KEY, &NONCE, &NONCE),
            Ok(VoiceCrypt::Ocb2(_))
        ));
    }

    #[test]
    fn the_two_ciphers_are_told_apart_by_key_length_alone() {
        // The whole selection rule, stated once: nothing else is consulted.
        for (key, expected) in [
            (&OCB2_KEY[..], "OCB2-AES128"),
            (&MODERN_KEY[..], "XChaCha20-Poly1305"),
        ] {
            for gate in [
                Gate::stock(),
                server(0, 3, 9),
                server(0, 4, 0),
                server(9, 9, 9),
            ] {
                let crypt = VoiceCrypt::negotiate(&gate, key, &NONCE, &NONCE).expect("keying");
                assert_eq!(
                    crypt.name(),
                    expected,
                    "a {}-byte key was read differently for {gate:?}",
                    key.len()
                );
            }
        }
    }

    #[test]
    fn a_resync_reaches_ocb2_and_is_ignored_by_the_modern_cipher() {
        // OCB2 needs it: one byte of its counter reaches the wire, so a receiver
        // that falls behind cannot recover alone. XChaCha carries two bytes and
        // reconstructs the rest, so there is nothing to adopt.
        let mut ocb2 =
            VoiceCrypt::negotiate(&Gate::stock(), &OCB2_KEY, &NONCE, &NONCE).expect("keying");
        assert!(ocb2.resync_helps());
        ocb2.adopt_resync(&[0x77; 16]);

        let mut modern =
            VoiceCrypt::negotiate(&server(0, 4, 0), &MODERN_KEY, &NONCE, &NONCE).expect("keying");
        assert!(!modern.resync_helps());
        // Must not panic, and must leave a working cipher behind.
        modern.adopt_resync(&[0x77; 16]);
        assert!(modern.encrypt(b"still working").is_ok());
    }

    #[test]
    fn both_variants_round_trip_through_the_trait() {
        // The enum has to be a real `CryptState`, not just hold two of them.
        for mut crypt in [
            VoiceCrypt::negotiate(&Gate::stock(), &OCB2_KEY, &NONCE, &NONCE).expect("keying"),
            VoiceCrypt::negotiate(&server(0, 4, 0), &MODERN_KEY, &NONCE, &NONCE).expect("keying"),
        ] {
            assert!(crypt.is_initialized(), "{}", crypt.name());
            let sealed = crypt.encrypt(b"a frame").expect("sealed");
            assert!(sealed.len() > 7, "{} produced no overhead", crypt.name());
        }
    }

    #[test]
    fn the_modern_cipher_reports_zeroed_stats_rather_than_inventing_them() {
        let crypt =
            VoiceCrypt::negotiate(&server(0, 4, 0), &MODERN_KEY, &NONCE, &NONCE).expect("keying");
        let stats = crypt.stats();
        assert_eq!(stats.good, 0);
        assert_eq!(stats.late, 0);
        assert_eq!(stats.lost, 0);
    }
}
