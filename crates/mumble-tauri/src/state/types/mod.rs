//! UI value types, event payloads, and configuration structs serialised
//! to the React frontend.
//!
//! Organised into per-domain submodules and re-exported flat here so existing
//! `state::types::Foo` paths keep working. Add new types to the matching
//! submodule (or a new one), not to this file - it should only ever list
//! module declarations and re-exports.

mod account;
mod admin;
mod audio;
mod audit;
mod events;
mod onboarding;
mod search;
mod serde_helpers;
mod server;
mod serversettings;
mod ui;

// Serde helpers used by handler code outside this module (the rest are used
// internally by the submodules' `#[serde(...)]` attributes).
pub(crate) use serde_helpers::{blob_marker, serialize_bytes_base64};

pub use account::*;
pub use admin::*;
pub use audio::*;
pub use audit::*;
pub use events::*;
pub use onboarding::*;
pub use search::*;
pub use server::*;
pub use serversettings::*;
pub use ui::*;

#[cfg(test)]
#[allow(
    clippy::expect_used,
    reason = "test code: panicking on failure is the intended behaviour"
)]
mod tests {
    use super::*;
    use mumble_protocol::state::PchatProtocol;

    /// Regression test: the frontend sends `"fancy_v1_full_archive"` etc.
    /// and the parser must accept those exact strings.
    #[test]
    fn parse_pchat_protocol_str_roundtrip() {
        use super::super::parse_pchat_protocol_str;

        // Every variant the UI sends must survive a serialize -> parse roundtrip.
        let cases = [
            (PchatProtocol::None, "none"),
            (PchatProtocol::FancyV1FullArchive, "fancy_v1_full_archive"),
            (PchatProtocol::SignalV1, "signal_v1"),
        ];
        for (expected, input) in cases {
            assert_eq!(
                parse_pchat_protocol_str(input),
                expected,
                "parse_pchat_protocol_str({input:?}) should return {expected:?}",
            );
        }
    }

    #[test]
    fn serialize_channel_entry_with_signal_v1() {
        let entry = ChannelEntry {
            id: 5,
            parent_id: Some(0),
            name: "Secret".into(),
            description: String::new(),
            description_hash: None,
            user_count: 2,
            permissions: None,
            temporary: false,
            position: 0,
            max_users: 0,
            pchat_protocol: Some(PchatProtocol::SignalV1),
            pchat_max_history: Some(1000),
            pchat_retention_days: Some(7),
            pchat_key_custodians: Vec::new(),
            is_enter_restricted: false,
            hidden: false,
            detached: false,
            attributes: 0,
            expiry_mode: 0,
            expiry_duration_secs: 0,
            expires_at: 0,
        };
        let json = serde_json::to_string(&entry).expect("serialize");
        assert!(
            json.contains(r#""pchat_protocol":"signal_v1""#),
            "expected signal_v1 in JSON: {json}",
        );
    }

    /// The `audio-transport-changed` listener in the UI store reads these two
    /// field names; a rename here would silently blank the Server info panel's
    /// transport rows rather than fail a build.
    #[test]
    fn serialize_audio_transport_payload_keys() {
        let json = serde_json::to_string(&AudioTransportPayload {
            udp_active: true,
            cipher: Some("XChaCha20-Poly1305"),
        })
        .expect("serialize");
        assert_eq!(json, r#"{"udp_active":true,"cipher":"XChaCha20-Poly1305"}"#);

        let tcp = serde_json::to_string(&AudioTransportPayload {
            udp_active: false,
            cipher: None,
        })
        .expect("serialize");
        assert_eq!(tcp, r#"{"udp_active":false,"cipher":null}"#);
    }
}
