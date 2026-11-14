use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// Admin -> Server: persist a new onboarding config.
///
/// The server validates admin permission, stamps `revision`, `updated_at`
/// and `updated_by`, then broadcasts the resulting `FancyOnboardingConfig`
/// to every connected client.
#[derive(Debug)]
pub struct SendFancyOnboardingConfigUpdate {
    /// New onboarding configuration to persist.
    pub config: mumble_tcp::FancyOnboardingConfig,
}

impl CommandAction for SendFancyOnboardingConfigUpdate {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyOnboardingConfigUpdate(
                mumble_tcp::FancyOnboardingConfigUpdate {
                    config: Some(self.config.clone()),
                },
            )],
            ..Default::default()
        }
    }
}
