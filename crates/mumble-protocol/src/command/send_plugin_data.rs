//! `SendPluginData` is permanently bricked.
//!
//! `PluginDataTransmission` is forbidden in Fancy Mumble (removed 0.3.2).
//! Replaced by native protobuf messages with stable wire IDs:
//!
//! - Polls: [`crate::command::SendFancyPoll`], [`crate::command::SendFancyPollVote`]
//! - Generic plugin envelope (any payload): [`crate::command::SendPluginMessage`]
//!   (wire ID 200), routed by the server-side plugin host.
//!
//! For new data types: either wrap your payload in a `PluginMessage` envelope
//! (recommended for plugin-scoped features) or add a typed `message Fancy...`
//! to `proto/Mumble.proto`, register it in [`crate::message::ControlMessage`]
//! and [`crate::message::TcpMessageType`], then implement
//! [`crate::command::CommandAction`].
//!
//! The inbound [`crate::message::ControlMessage::PluginDataTransmission`] variant
//! is retained solely to decode legacy peer traffic without erroring.

/// `PluginDataTransmission` is forbidden in Fancy Mumble (removed 0.3.2).
///
/// Replace with a typed native message:
/// - Polls: [`crate::command::SendFancyPoll`] / [`crate::command::SendFancyPollVote`]
/// - Generic plugin envelope: [`crate::command::SendPluginMessage`] (wire ID 200)
/// - New data: add a `message Fancy...` in `proto/Mumble.proto` with a stable wire ID.
#[derive(Debug)]
#[deprecated(
    since = "0.2.19",
    note = "PluginDataTransmission is forbidden. For new types, add a \
            native proto message (wire ID >= 100). See command/send_plugin_data.rs."
)]
pub struct SendPluginData {
    _unconstructable: std::convert::Infallible,
}
