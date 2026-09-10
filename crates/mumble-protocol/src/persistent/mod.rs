//! Persistent encrypted chat for Fancy Mumble.
//!
//! This module implements the client-side architecture for persistent,
//! end-to-end encrypted chat history. Communication uses native
//! protobuf messages (`PchatMessage`, `PchatFetch`, etc.) defined in
//! `Mumble.proto`.
//!
//! Core types: [`PchatProtocol`], [`KeyTrustLevel`].

pub mod encryption;
pub mod keys;
pub mod protocol;
pub mod wire;

use serde::{Deserialize, Serialize};

// ---- Core domain types ----------------------------------------------

// Re-export the unified protocol enum from state.rs so persistent/
// sub-modules can use `crate::persistent::PchatProtocol`.
pub use crate::state::PchatProtocol;

// Extension methods for wire serialization (kept here because they
// are a persistent-chat concern, not a core state concern).
impl PchatProtocol {
    /// Protocol string used in wire format payloads (`MessagePack`).
    #[must_use]
    pub fn as_wire_str(&self) -> &'static str {
        match self {
            Self::None => "NONE",
            Self::FancyV1FullArchive => "FANCY_V1_FULL_ARCHIVE",
            Self::ServerManaged => "SERVER_MANAGED",
            Self::SignalV1 => "SIGNAL_V1",
        }
    }

    /// Parse from wire format string.
    ///
    /// Accepts both current names (`"FANCY_V1_POST_JOIN"`,
    /// `"FANCY_V1_FULL_ARCHIVE"`) and legacy names (`"POST_JOIN"`,
    /// `"FULL_ARCHIVE"`) for backward compatibility with stored messages
    /// and older clients/servers.
    #[must_use]
    pub fn from_wire_str(s: &str) -> Self {
        match s {
            "FANCY_V1_FULL_ARCHIVE" | "FULL_ARCHIVE" => Self::FancyV1FullArchive,
            "SERVER_MANAGED" => Self::ServerManaged,
            "SIGNAL_V1" => Self::SignalV1,
            _ => Self::None,
        }
    }
}

/// Trust level for a received encryption key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum KeyTrustLevel {
    /// Key fingerprint confirmed via out-of-band comparison.
    ManuallyVerified,
    /// Multi-confirmed or validated by key custodian / countersignature.
    Verified,
    /// Single source, accepted on first use (TOFU).
    Unverified,
    /// Conflicting keys received from different members.
    Disputed,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pchat_protocol_proto_roundtrip() {
        for protocol in [
            PchatProtocol::None,
            PchatProtocol::FancyV1FullArchive,
            PchatProtocol::SignalV1,
        ] {
            assert_eq!(PchatProtocol::from_proto(protocol.to_proto()), protocol);
        }
    }

    #[test]
    fn pchat_protocol_wire_str_roundtrip() {
        for protocol in [
            PchatProtocol::None,
            PchatProtocol::FancyV1FullArchive,
            PchatProtocol::SignalV1,
        ] {
            assert_eq!(
                PchatProtocol::from_wire_str(protocol.as_wire_str()),
                protocol
            );
        }
    }

    #[test]
    fn pchat_protocol_is_encrypted() {
        assert!(!PchatProtocol::None.is_encrypted());
        assert!(PchatProtocol::FancyV1FullArchive.is_encrypted());
        assert!(PchatProtocol::SignalV1.is_encrypted());
    }

    #[test]
    fn unknown_proto_value_defaults_to_none() {
        assert_eq!(PchatProtocol::from_proto(99), PchatProtocol::None);
    }

    #[test]
    fn unknown_wire_str_defaults_to_none() {
        assert_eq!(PchatProtocol::from_wire_str("INVALID"), PchatProtocol::None);
    }

    #[test]
    fn protocol_version_is_correct() {
        assert_eq!(PchatProtocol::None.protocol_version(), None);
        assert_eq!(
            PchatProtocol::FancyV1FullArchive.protocol_version(),
            Some(1)
        );
        assert_eq!(PchatProtocol::SignalV1.protocol_version(), Some(2));
    }
}
