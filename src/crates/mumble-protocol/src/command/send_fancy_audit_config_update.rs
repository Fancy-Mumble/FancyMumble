use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Admin -> Server: apply changed audit configuration (per-part collect /
/// export toggles, retention, OTLP settings, disclosure).
///
/// The server validates `ConfigureAudit` (today: root-channel Write), applies
/// the change, records it as an audit entry itself, then re-broadcasts the
/// stamped `FancyAuditConfig` snapshot.
#[derive(Debug)]
pub struct SendFancyAuditConfigUpdate {
    /// The changed settings to apply (key + new value).
    pub settings: Vec<mumble_tcp::Setting>,
}

impl CommandAction for SendFancyAuditConfigUpdate {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyAuditConfigUpdate(
                mumble_tcp::FancyAuditConfigUpdate {
                    settings: self.settings.clone(),
                },
            )],
            ..Default::default()
        }
    }
}
