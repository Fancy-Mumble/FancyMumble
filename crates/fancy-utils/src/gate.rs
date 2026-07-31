//! Feature gating by announced Fancy Mumble version.
//!
//! The client mirror of the server's `starling-gate` crate. One table maps each
//! capability to the version that introduced it; everything that varies by peer
//! version asks here rather than deciding for itself.
//!
//! # Both directions
//!
//! The same gate answers two questions:
//!
//! * *what may we send this server* — built from `server_fancy_version`;
//! * *what may a server give us* — the server builds the same gate from the
//!   `fancy_version` we announced.
//!
//! Because the table is duplicated in two crates it can drift, so the versions
//! below are the same literals as `starling-gate`'s `capabilities!` table and
//! each cites the other. A mismatch shows up as a peer offering something its
//! counterpart will not accept, which is why the encoding test pins the wire
//! layout rather than recomputing it.
//!
//! # Absent means oldest, never newest
//!
//! No announced version means a stock Mumble peer. Every capability is then
//! `false`, so a new one is opt-in by construction and cannot be assumed of a
//! peer that never claimed it.

use crate::version::{fancy_version_decode, fancy_version_encode};

/// Something a peer can only do from a particular version.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
#[non_exhaustive]
pub enum Capability {
    /// Fancy extension message types (100+) understood natively, rather than
    /// tunnelled through `PluginDataTransmission`.
    NativeFancyMessages,

    /// Modern voice encryption instead of Mumble's OCB2-AES128.
    ///
    /// OCB2 has a practical forgery attack (Inoue, Iwata, Minematsu and
    /// Poettering, CRYPTO 2019). A breaking wire change, which is why it lands on
    /// a minor bump.
    ModernVoiceCrypto,
}

impl Capability {
    /// The first version that has it.
    ///
    /// These literals must match `starling-gate`'s table exactly.
    #[must_use]
    pub const fn since(self) -> u64 {
        match self {
            Self::NativeFancyMessages => fancy_version_encode(0, 2, 12),
            Self::ModernVoiceCrypto => fancy_version_encode(0, 4, 0),
        }
    }

    /// Every capability, for diagnostics and exhaustiveness tests.
    #[must_use]
    pub const fn all() -> &'static [Self] {
        &[Self::NativeFancyMessages, Self::ModernVoiceCrypto]
    }

    /// A stable name for logs.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::NativeFancyMessages => "NativeFancyMessages",
            Self::ModernVoiceCrypto => "ModernVoiceCrypto",
        }
    }
}

/// What one peer may be given, decided from the version it announced.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Gate {
    announced: Option<u64>,
}

impl Gate {
    /// The gate for a peer that announced `fancy_version`. `None` is a stock
    /// Mumble peer.
    #[must_use]
    pub const fn for_peer(fancy_version: Option<u64>) -> Self {
        Self {
            announced: fancy_version,
        }
    }

    /// A gate that allows nothing: a stock peer.
    #[must_use]
    pub const fn stock() -> Self {
        Self { announced: None }
    }

    /// Whether the peer announced the Fancy extensions at all.
    ///
    /// Rarely the right question — prefer [`Self::allows`], which distinguishes
    /// *which* version.
    #[must_use]
    pub const fn is_fancy(&self) -> bool {
        self.announced.is_some()
    }

    /// The announced version as `(major, minor, patch)`, if any.
    #[must_use]
    pub fn version(&self) -> Option<(u16, u16, u16)> {
        self.announced.map(fancy_version_decode)
    }

    /// Whether the peer is new enough for `capability`.
    #[must_use]
    pub fn allows(&self, capability: Capability) -> bool {
        self.announced
            .is_some_and(|announced| announced >= capability.since())
    }

    /// Every capability this peer has, for one log line at handshake.
    #[must_use]
    pub fn granted(&self) -> Vec<Capability> {
        Capability::all()
            .iter()
            .copied()
            .filter(|c| self.allows(*c))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stock_peer_is_allowed_nothing() {
        let stock = Gate::stock();
        assert!(!stock.is_fancy());
        for capability in Capability::all() {
            assert!(
                !stock.allows(*capability),
                "{} was granted to a stock peer",
                capability.name()
            );
        }
    }

    #[test]
    fn an_absent_version_is_the_same_as_stock() {
        assert_eq!(Gate::for_peer(None), Gate::stock());
    }

    #[test]
    fn an_old_fancy_peer_does_not_get_a_newer_capability() {
        let old = Gate::for_peer(Some(fancy_version_encode(0, 1, 0)));
        assert!(old.is_fancy());
        assert!(!old.allows(Capability::NativeFancyMessages));
        assert!(!old.allows(Capability::ModernVoiceCrypto));
    }

    #[test]
    fn the_introducing_version_itself_qualifies() {
        for capability in Capability::all() {
            assert!(
                Gate::for_peer(Some(capability.since())).allows(*capability),
                "{} excluded the version that introduced it",
                capability.name()
            );
        }
    }

    #[test]
    fn the_previous_release_keeps_ocb2() {
        let previous = Gate::for_peer(Some(fancy_version_encode(0, 3, 0)));
        assert!(previous.allows(Capability::NativeFancyMessages));
        assert!(!previous.allows(Capability::ModernVoiceCrypto));
    }

    #[test]
    fn the_thresholds_match_the_servers_table() {
        // The same literals `starling-gate` uses. Duplicated on purpose and
        // pinned here, so drift fails a test rather than a handshake.
        assert_eq!(Capability::NativeFancyMessages.since(), 0x0000_0002_000C_0000);
        assert_eq!(Capability::ModernVoiceCrypto.since(), 0x0000_0004_0000_0000);
    }
}
