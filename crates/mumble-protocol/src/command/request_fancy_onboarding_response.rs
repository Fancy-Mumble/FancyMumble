use crate::command::core::{CommandAction, CommandOutput};
use crate::message::ControlMessage;
use crate::proto::mumble_tcp;
use crate::state::ServerState;

/// User -> Server: request the user's previously-stored onboarding response.
///
/// The server looks up the response by the session's certificate hash and
/// replies with `FancyOnboardingResponseDeliver`.  An absent response in
/// the reply means the user has not completed onboarding yet.
#[derive(Debug, Default)]
pub struct RequestFancyOnboardingResponse;

impl CommandAction for RequestFancyOnboardingResponse {
    fn execute(&self, _state: &ServerState) -> CommandOutput {
        CommandOutput {
            tcp_messages: vec![ControlMessage::FancyOnboardingResponseQuery(
                mumble_tcp::FancyOnboardingResponseQuery {},
            )],
            ..Default::default()
        }
    }
}
