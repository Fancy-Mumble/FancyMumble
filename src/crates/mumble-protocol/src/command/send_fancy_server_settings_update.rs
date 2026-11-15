use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Admin -> Server: apply changed server settings.
///
/// The server validates root-channel Write permission, persists + applies each
/// setting at runtime, then re-broadcasts the updated `FancyServerSettings` to
/// every admin.
#[derive(Debug)]
pub struct SendFancyServerSettingsUpdate {
    /// The changed settings to apply (key + new value).
    pub settings: Vec<mumble_tcp::Setting>,
}

impl CommandAction for SendFancyServerSettingsUpdate {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyServerSettingsUpdate(
                mumble_tcp::FancyServerSettingsUpdate {
                    settings: self.settings.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
