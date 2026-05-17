use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// User -> Server: submit answers to the onboarding questionnaire.
///
/// The server stores the response keyed by the user's certificate hash
/// and applies the resulting ACL group memberships across the affected
/// channels.  `user_hash` and `submitted_at` are server-stamped on
/// storage and are therefore left unset by the client.
#[derive(Debug)]
pub struct SendFancyOnboardingResponse {
    /// Selected answers per question.
    pub selections: Vec<mumble_tcp::fancy_onboarding_response::Selection>,
    /// Revision of the config the user answered against.
    pub config_revision: Option<u64>,
}

impl CommandAction for SendFancyOnboardingResponse {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyOnboardingResponse(
                mumble_tcp::FancyOnboardingResponse {
                    user_hash: None,
                    submitted_at: None,
                    selections: self.selections.clone(),
                    config_revision: self.config_revision,
                },
            )],
            ..Default::default()
        }
    }
}
