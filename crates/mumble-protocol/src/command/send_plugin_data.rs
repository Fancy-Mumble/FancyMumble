//! `SendPluginData` is permanently bricked.
//!
//! `PluginDataTransmission` is forbidden in Fancy Mumble (removed 0.3.2).
//! Replaced by native protobuf messages with stable wire IDs:
//!
//! - Live docs: [`crate::command::SendFancyLiveDocOpen`], [`crate::command::SendFancyLiveDocAnnounce`]
//! - Polls: [`crate::command::SendFancyPoll`], [`crate::command::SendFancyPollVote`]
//!
//! For new data types: add a `message Fancy...` to `proto/Mumble.proto` (ID >= 146),
//! regenerate bindings, register in [`crate::message::ControlMessage`] and
//! [`crate::message::TcpMessageType`], then implement [`crate::command::CommandAction`].
//!
//! The inbound [`crate::message::ControlMessage::PluginDataTransmission`] variant
//! is retained solely to decode legacy peer traffic without erroring.

/// `PluginDataTransmission` is forbidden in Fancy Mumble (removed 0.3.2).
///
/// Replace with a typed native message:
/// - Polls: [`crate::command::SendFancyPoll`] / [`crate::command::SendFancyPollVote`]
/// - Live docs: [`crate::command::SendFancyLiveDocOpen`] / [`crate::command::SendFancyLiveDocAnnounce`]
/// - New data: add a `message Fancy...` in `proto/Mumble.proto` (wire ID >= 146).
#[derive(Debug)]
#[deprecated(
    since = "0.2.19",
    note = "PluginDataTransmission is forbidden. For new types, add a \
            native proto message (wire ID >= 100). See command/send_plugin_data.rs."
)]
pub struct SendPluginData {
    _unconstructable: std::convert::Infallible,
}
