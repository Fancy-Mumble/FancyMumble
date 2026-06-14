use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Send a generic `PluginMessage` envelope to the server.  The server
/// routes inbound envelopes to the matching plugin (selected by
/// `plugin_name`) which then chooses whether to consume the message
/// or relay it to other clients via `target_sessions` / `channel_id`.
///
/// The payload bytes are opaque to the protocol layer; plugins choose
/// their own encoding (typically protobuf or JSON).
#[derive(Debug, Default)]
pub struct SendPluginMessage {
    /// Stable plugin identifier (e.g. `"fancy-live-doc"`).
    pub plugin_name: String,
    /// Plugin-defined inner message type (e.g. `"OpenRequest"`).
    pub payload_type: String,
    /// Opaque payload bytes encoded by the plugin.
    pub payload: Vec<u8>,
    /// Explicit recipient sessions (for client-initiated server -> client
    /// requests where the server is expected to forward to peers).
    /// Empty for plain client -> server requests handled by the plugin.
    pub target_sessions: Vec<u32>,
    /// Channel-scoped routing hint.  When `Some` and `target_sessions`
    /// is empty, the server fans out to every user in the channel.
    pub channel_id: Option<u32>,
}

impl CommandAction for SendPluginMessage {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::PluginMessage(mumble_tcp::PluginMessage {
                plugin_name: Some(self.plugin_name.clone()),
                plugin_slot: None,
                payload_type: Some(self.payload_type.clone()),
                payload: Some(self.payload.clone()),
                target_sessions: self.target_sessions.clone(),
                channel_id: self.channel_id,
                sender_session: None,
                sender_name: None,
            })],
            ..Default::default()
        }
    }
}
